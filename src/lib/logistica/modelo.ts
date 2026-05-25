/**
 * MODELO OPERACIONAL DE LOGÍSTICA · entidad LogisticaOperacionVIN.
 *
 * Logística NO es un módulo separado: es un tramo del ciclo completo del VIN
 *   compra → stock → reserva → factura → inscripción → LOGÍSTICA → llegada
 *   sucursal → entrega cliente → cierre
 * El objetivo del sistema es VELOCIDAD OPERACIONAL, así que logística aporta
 * aging, bloqueos y capital retenido al score del VIN.
 *
 * Este archivo es SOLO el modelo (tipos + lógica pura). NO parsea archivos, no
 * toca el store, no tiene UI. La ingesta de los 2 archivos fuente (parser +
 * store) es la etapa siguiente; este modelo define la forma destino y la lógica
 * operacional (estado, bloqueos, aging, SLA, score) para alimentarla.
 *
 * ───────────────────────────── FUENTES (auditadas) ──────────────────────────
 * Dos archivos, ambos keyed por VIN, complementarios:
 *
 *  A) "Diciembre-Mayo ROMA.xlsx" / hoja ROMA (4842 filas) — AGENDA DEL VENDEDOR.
 *     Pipeline iniciado por la venta. Folio = VentaID. Columnas confirmadas por
 *     la leyenda y el .docx "Vista vendedor en agenda logística":
 *       K FechaSolicitud                  → solicitud del vendedor
 *       V fecha_RespuestaGestionLogistica → logística respondió la solicitud
 *       S FechaETASucursal                → llegada a sucursal (confirmada por logística)
 *       L FechaFactura                    → facturado a cliente ("00-00-0000" = sin facturar)
 *       M FechaEnprocesoIns               → inscripción a cliente (vacío = sin iniciar)
 *       J FechaEstimadaEntrega            → entrega COMPROMETIDA (agendada por vendedor)
 *       PasoActual (state machine: "Respuesta Jefe Sucursal" 3456 / "Finalizada"
 *         1173 / "Respuesta Logistica [Instalación de acc]" 206 / "Respuesta Logistica" 7)
 *       Estado (Pendiente 3498 / Realizada 939 / Anulada 405)
 *       U fecha_RespuestaInstalacionAcc   → respuesta instalación de accesorios
 *     (fecha_recepcion y *_Calcu vienen vacías/no usables → ver GAPS abajo.)
 *
 *  B) "Logistica.xlsx" / hoja Hoja2 (2289 filas) — EJECUCIÓN DE BODEGA (STLI).
 *       Fecha Ingreso APC                 → ingreso a almacenaje/preparación
 *       Fecha de solicitud a STLI         → solicitud de despacho a bodega (col M)
 *       Fecha Planificacion STLI          → planificación del despacho (col Q)
 *       Fecha despacho a sucursal         → despacho efectivo (col O)
 *       Tipo solicitud (VENTA 1665 / VITRINA 561 / TEST CAR / TRASPASO / USADOS / DONANTE)
 *       Cumplimiento despacho (CUMPLIDO 1528 / NO CUMPLIDO 761 = 33% incumplido)
 *       Sucursal Destino · Dias preentrega · Dias de Stock
 *
 * Cobertura de cruce por VIN (auditada): Logística∩ROMA 1491 · ROMA∩FNE 188 ·
 * Logística∩FNE 98 · ROMA∩Base_Stock 63 (1%). Son archivos HISTÓRICOS (dic–may):
 * el universo VIVO se obtiene cruzando con FNE/stock actuales (ver GAPS).
 */

// ───────────────────────────── Hitos del ciclo ──────────────────────────────

export type FuenteLogistica = "ROMA" | "STLI" | "DERIVADO" | "FALTA";

/** Hitos logísticos detectados (orden operacional, no estrictamente secuencial:
 *  factura/inscripción suelen ocurrir ANTES de la llegada física). */
export type HitoLogistico =
  | "solicitud_vendedor"
  | "respuesta_logistica"
  | "ingreso_apc"
  | "solicitud_bodega"
  | "planificacion_despacho"
  | "despacho"
  | "llegada_sucursal"
  | "factura"
  | "inscripcion"
  | "entrega_comprometida"
  | "entrega_real"
  | "cierre";

export interface HitoDef {
  hito: HitoLogistico;
  label: string;
  fuente: FuenteLogistica;
  columna: string | null;
  descripcion: string;
}

/** Mapa hito → fuente/columna real (documenta de dónde sale cada fecha). */
export const HITOS_LOGISTICOS: HitoDef[] = [
  { hito: "solicitud_vendedor", label: "Solicitud vendedor", fuente: "ROMA", columna: "FechaSolicitud", descripcion: "El vendedor solicita la unidad." },
  { hito: "respuesta_logistica", label: "Respuesta logística", fuente: "ROMA", columna: "fecha_RespuestaGestionLogistica", descripcion: "Logística responde la solicitud." },
  { hito: "ingreso_apc", label: "Ingreso APC", fuente: "STLI", columna: "Fecha Ingreso APC", descripcion: "Unidad ingresa a almacenaje/preparación." },
  { hito: "solicitud_bodega", label: "Solicitud a bodega (STLI)", fuente: "STLI", columna: "Fecha de solicitud a STLI", descripcion: "Se pide el despacho a bodega." },
  { hito: "planificacion_despacho", label: "Planificación despacho", fuente: "STLI", columna: "Fecha Planificacion STLI", descripcion: "Bodega planifica el despacho." },
  { hito: "despacho", label: "Despacho a sucursal", fuente: "STLI", columna: "Fecha despacho a sucursal", descripcion: "Despacho efectivo desde bodega." },
  { hito: "llegada_sucursal", label: "Llegada a sucursal", fuente: "ROMA", columna: "FechaETASucursal", descripcion: "Logística confirma la llegada a sucursal." },
  { hito: "factura", label: "Factura a cliente", fuente: "ROMA", columna: "FechaFactura", descripcion: "Se factura al cliente." },
  { hito: "inscripcion", label: "Inscripción a cliente", fuente: "ROMA", columna: "FechaEnprocesoIns", descripcion: "Inscripción del vehículo al cliente." },
  { hito: "entrega_comprometida", label: "Entrega comprometida", fuente: "ROMA", columna: "FechaEstimadaEntrega", descripcion: "Fecha de entrega agendada por el vendedor." },
  { hito: "entrega_real", label: "Entrega real", fuente: "FALTA", columna: null, descripcion: "GAP: la entrega EFECTIVA al cliente no está en estos archivos (sólo la comprometida). Candidato: FNE entrega / Base_Stock fechaVenta." },
  { hito: "cierre", label: "Cierre operación", fuente: "FALTA", columna: null, descripcion: "GAP: no hay fecha de cierre explícita; se infiere de Estado=Realizada / PasoActual=Finalizada." },
];

// ───────────────────────────── Estado y bloqueos ────────────────────────────

/** Etapa operacional actual (dónde está / dónde está detenida la unidad). */
export type EstadoLogistico =
  | "anulada"
  | "entregada"
  | "esperando_respuesta_logistica"
  | "en_preparacion_apc"
  | "esperando_despacho"
  | "en_transito"
  | "esperando_inscripcion"
  | "en_sucursal_sin_entregar"
  | "esperando_jefe_sucursal"
  | "desconocido";

export const ESTADO_LOGISTICO_LABEL: Record<EstadoLogistico, string> = {
  anulada: "Anulada",
  entregada: "Entregada / finalizada",
  esperando_respuesta_logistica: "Esperando respuesta de logística",
  en_preparacion_apc: "En preparación (APC) sin solicitud",
  esperando_despacho: "Esperando despacho de bodega",
  en_transito: "En tránsito a sucursal",
  esperando_inscripcion: "En sucursal · falta inscripción",
  en_sucursal_sin_entregar: "En sucursal · sin entregar",
  esperando_jefe_sucursal: "Esperando respuesta jefe de sucursal",
  desconocido: "Sin clasificar",
};

/** Dependencias / bloqueos operacionales que retienen capital o velocidad. */
export type BloqueoLogistico =
  | "auto_listo_no_solicitado"
  | "sin_respuesta_logistica"
  | "despacho_incumplido"
  | "transito_prolongado"
  | "llegado_no_entregado"
  | "inscripcion_pendiente"
  | "eta_vencida"
  | "jefe_sucursal_no_responde"
  | "pendiente_estancado";

// ───────── Catálogo semántico de bloqueos · ownership operacional real ───────
//
// Cada bloqueo responde, sin ambigüedad: qué significa, quién lo resuelve, qué
// tramo del pipeline está detenido, qué retiene y cuál es la acción que destraba.
// El owner de eta_vencida y pendiente_estancado es CONTEXTUAL (depende de la
// etapa): "ETA vencida" NO es automáticamente logística.

export type OwnerLogistico =
  | "Logística / transporte"
  | "STLI / bodega"
  | "Sucursal"
  | "Vendedor"
  | "Inscripción / Control de Negocios"
  | "Cliente"
  | "Financiero"
  | "Registro Civil";

export type PipelineEtapa =
  | "preparación (APC)"
  | "despacho (bodega)"
  | "tránsito a sucursal"
  | "recepción en sucursal"
  | "inscripción / patente"
  | "entrega al cliente"
  | "transversal";

export interface BloqueoMeta {
  label: string;
  /** Owner principal estático. */
  owner: OwnerLogistico;
  /** Owner contextual (depende de la etapa del VIN). Si no, manda `owner`. */
  ownerContextual?: (op: LogisticaOperacionVIN) => OwnerLogistico;
  /** Tramo del pipeline que está detenido. */
  pipeline: PipelineEtapa;
  /** Qué significa operacionalmente. */
  definicion: string;
  /** Qué retiene (FNE / entrega / capital / usados). */
  impacto: string;
  /** Acción concreta que destraba la caja. */
  accion: string;
}

/** Owner derivado de la etapa actual del VIN (para bloqueos contextuales). */
export function ownerPorEstado(op: LogisticaOperacionVIN): OwnerLogistico {
  switch (derivarEstadoLogistico(op)) {
    case "en_transito":
    case "esperando_respuesta_logistica":
      return "Logística / transporte";
    case "esperando_despacho":
      return "STLI / bodega";
    case "esperando_inscripcion":
      return "Inscripción / Control de Negocios";
    case "en_preparacion_apc":
    case "en_sucursal_sin_entregar":
    case "esperando_jefe_sucursal":
      return "Sucursal";
    default:
      return "Vendedor";
  }
}

export const BLOQUEO_META: Record<BloqueoLogistico, BloqueoMeta> = {
  auto_listo_no_solicitado: {
    label: "Auto en bodega sin solicitud de despacho",
    owner: "Sucursal",
    pipeline: "preparación (APC)",
    definicion:
      "El auto ingresó a APC (preparación) y nadie pidió su despacho a bodega. Está listo pero parado.",
    impacto: "Capital inmóvil en bodega; retrasa toda la cadena hasta la entrega.",
    accion: "Solicitar el despacho a STLI (la sucursal debe pedir el envío).",
  },
  sin_respuesta_logistica: {
    label: "Solicitud sin respuesta de logística",
    owner: "Logística / transporte",
    pipeline: "despacho (bodega)",
    definicion:
      "El vendedor pidió la unidad y logística aún no respondió la solicitud (sobre el objetivo de SLA).",
    impacto: "Frena el inicio del despacho; el cliente espera sin fecha.",
    accion: "Logística debe responder/asignar el despacho a la solicitud.",
  },
  despacho_incumplido: {
    label: "Despacho incumplido (NO CUMPLIDO)",
    owner: "STLI / bodega",
    pipeline: "despacho (bodega)",
    definicion: "Bodega marcó el despacho como NO CUMPLIDO: no salió en la fecha planificada.",
    impacto: "El auto no viaja; retrasa recepción y entrega.",
    accion: "Reprogramar y ejecutar el despacho; revisar la causa del incumplimiento.",
  },
  transito_prolongado: {
    label: "En tránsito sin recepción (ETA vencida)",
    owner: "Logística / transporte",
    pipeline: "tránsito a sucursal",
    definicion:
      "Auto despachado, sin recepción confirmada en sucursal y con la ETA de tránsito vencida — aún no visible en destino.",
    impacto: "Capital en ruta sin confirmar; no se puede inscribir ni entregar.",
    accion: "Confirmar la recepción física en sucursal o escalar al transportista.",
  },
  llegado_no_entregado: {
    label: "En sucursal sin entregar",
    owner: "Sucursal",
    pipeline: "entrega al cliente",
    definicion: "El auto llegó a la sucursal y todavía no se entrega al cliente.",
    impacto: "Caja lista para liberar, retenida en el último tramo.",
    accion: "Coordinar la entrega con el cliente (agendar y cerrar).",
  },
  inscripcion_pendiente: {
    label: "Inscripción / patente pendiente",
    owner: "Inscripción / Control de Negocios",
    pipeline: "inscripción / patente",
    definicion: "Facturado o recepcionado pero sin inscripción/patente cerrada.",
    impacto: "Bloquea la entrega final aunque el auto esté físicamente.",
    accion: "Gestionar la inscripción/patente (Control de Negocios → Registro Civil).",
  },
  eta_vencida: {
    label: "Entrega comprometida vencida",
    owner: "Vendedor",
    ownerContextual: ownerPorEstado,
    pipeline: "entrega al cliente",
    definicion:
      "La fecha de entrega agendada al cliente ya pasó. La causa depende de la etapa: tránsito, inscripción o coordinación con el cliente — no es automáticamente logística.",
    impacto: "Incumplimiento al cliente + caja retenida.",
    accion: "Identificar la causa real (tránsito / inscripción / cliente) y reagendar.",
  },
  jefe_sucursal_no_responde: {
    label: "Sin respuesta del jefe de sucursal",
    owner: "Sucursal",
    pipeline: "recepción en sucursal",
    definicion: "El flujo espera la respuesta del jefe de sucursal (PasoActual).",
    impacto: "Detiene el avance administrativo del caso.",
    accion: "Escalar al jefe de sucursal para destrabar.",
  },
  pendiente_estancado: {
    label: "Pendiente estancado",
    owner: "Vendedor",
    ownerContextual: ownerPorEstado,
    pipeline: "transversal",
    definicion:
      "Operación 'Pendiente' con +30 días sin cierre. Señal de higiene: o está realmente trabada o nunca se cerró en el sistema.",
    impacto: "Ensucia el universo activo; posible caja fantasma.",
    accion: "Revisar: cerrar si ya se entregó, o reactivar la gestión del tramo abierto.",
  },
};

/** ¿Quién resuelve este bloqueo en ESTE VIN? (contextual si corresponde). */
export function ownerDeBloqueo(b: BloqueoLogistico, op: LogisticaOperacionVIN): OwnerLogistico {
  const meta = BLOQUEO_META[b];
  return meta.ownerContextual ? meta.ownerContextual(op) : meta.owner;
}

// Mapas estáticos derivados del catálogo (compatibilidad con consumidores).
export const BLOQUEO_LOGISTICO_LABEL: Record<BloqueoLogistico, string> = Object.fromEntries(
  (Object.keys(BLOQUEO_META) as BloqueoLogistico[]).map((k) => [k, BLOQUEO_META[k].label]),
) as Record<BloqueoLogistico, string>;

/** Owner principal estático por bloqueo (los contextuales: usar ownerDeBloqueo). */
export const BLOQUEO_OWNER: Record<BloqueoLogistico, string> = Object.fromEntries(
  (Object.keys(BLOQUEO_META) as BloqueoLogistico[]).map((k) => [k, BLOQUEO_META[k].owner]),
) as Record<BloqueoLogistico, string>;

// ───────────────────────────── SLA (desde auditoría) ────────────────────────

export interface SLATramo {
  objetivoDias: number;
  alertaDias: number;
}

/**
 * SLA por tramo. objetivoDias ≈ p50 observado; alertaDias ≈ p95 observado.
 * Valores de la auditoría dic–may (calibrables con el negocio):
 *   solicitud→respuesta:  p50 2  / p95 12
 *   apc→solicitud bodega: p50 20 / p95 118   ← TIEMPO MUERTO principal
 *   solicitud→despacho:   p50 5  / p95 12
 *   despacho→llegada:     p50 3  / p95 6
 *   factura→entrega:      p50 12 / p95 26
 *   solicitud→entrega:    p50 12 / p95 22
 */
export const SLA_LOGISTICA: Record<string, SLATramo> = {
  respuesta_logistica: { objetivoDias: 2, alertaDias: 12 },
  apc_a_solicitud_bodega: { objetivoDias: 5, alertaDias: 20 },
  solicitud_bodega_a_despacho: { objetivoDias: 5, alertaDias: 12 },
  transito: { objetivoDias: 3, alertaDias: 6 },
  factura_a_entrega: { objetivoDias: 12, alertaDias: 26 },
  solicitud_a_entrega: { objetivoDias: 12, alertaDias: 22 },
};

/** Umbral de "pendiente estancado": Estado=Pendiente con aging sobre esto.
 *  (La auditoría halló 3498 pendientes con aging promedio 110d → hygiene). */
export const PENDIENTE_ESTANCADO_DIAS = 30;

// ───────────────────────── Entidad LogisticaOperacionVIN ────────────────────

export interface LogisticaOperacionVIN {
  vin: string;
  ventaId: number | null;
  marca: string | null;
  modelo: string | null;
  sucursalDestino: string | null;
  /** VENTA / VITRINA / TEST CAR / TRASPASO / USADOS / DONANTE (Logistica.Tipo solicitud). */
  tipoSolicitud: string | null;

  // Hitos (timestamps; null = no ocurrido / no informado)
  fSolicitudVendedor: Date | null;
  fRespuestaLogistica: Date | null;
  fIngresoApc: Date | null;
  fSolicitudBodega: Date | null;
  fPlanificacion: Date | null;
  fDespacho: Date | null;
  fLlegadaSucursal: Date | null;
  fFactura: Date | null;
  fInscripcion: Date | null;
  fEntregaComprometida: Date | null;

  // Señales del archivo
  estadoArchivo: string | null; // Pendiente / Realizada / Anulada (ROMA.Estado)
  pasoActual: string | null; // ROMA.PasoActual (state machine)
  cumplimientoDespacho: string | null; // CUMPLIDO / NO CUMPLIDO (Logistica)

  // Enriquecimiento (cruce con el pipeline vivo)
  enStock: boolean; // VIN en Base_Stock actual
  enFNE: boolean; // VIN en FNE actual (facturado no entregado)
}

// ───────────────────────────── Lógica operacional ───────────────────────────

const up = (s: string | null | undefined) => (s ?? "").toUpperCase().trim();
const diasEntre = (a: Date | null, b: Date | null): number | null =>
  a && b ? Math.round((b.getTime() - a.getTime()) / 86_400_000) : null;

/** Etapa actual del VIN en el ciclo logístico. */
export function derivarEstadoLogistico(op: LogisticaOperacionVIN): EstadoLogistico {
  if (up(op.estadoArchivo) === "ANULADA") return "anulada";
  if (up(op.estadoArchivo) === "REALIZADA" || up(op.pasoActual) === "FINALIZADA") return "entregada";

  // Flujo físico (la llegada manda sobre factura/inscripción, que pueden ir antes).
  if (op.fLlegadaSucursal) {
    if (!op.fInscripcion) return "esperando_inscripcion";
    return "en_sucursal_sin_entregar";
  }
  if (op.fDespacho) return "en_transito";
  if (op.fSolicitudBodega) return "esperando_despacho";
  if (op.fIngresoApc) return "en_preparacion_apc";
  if (op.fSolicitudVendedor && !op.fRespuestaLogistica) return "esperando_respuesta_logistica";
  if (up(op.pasoActual).includes("JEFE SUCURSAL")) return "esperando_jefe_sucursal";
  return "desconocido";
}

/** Fecha de referencia de la etapa actual (cuándo entró a ese estado). */
export function fechaReferenciaEtapa(op: LogisticaOperacionVIN, estado: EstadoLogistico): Date | null {
  switch (estado) {
    case "en_sucursal_sin_entregar":
    case "esperando_inscripcion":
      return op.fLlegadaSucursal;
    case "en_transito":
      return op.fDespacho;
    case "esperando_despacho":
      return op.fSolicitudBodega;
    case "en_preparacion_apc":
      return op.fIngresoApc;
    case "esperando_respuesta_logistica":
      return op.fSolicitudVendedor;
    case "esperando_jefe_sucursal":
      return op.fSolicitudVendedor;
    default:
      return null;
  }
}

/** Aging en la etapa actual (días desde que entró a su estado hasta hoy). */
export function agingLogistico(op: LogisticaOperacionVIN, hoy: Date = new Date()): number | null {
  const estado = derivarEstadoLogistico(op);
  if (estado === "entregada" || estado === "anulada") return null;
  return diasEntre(fechaReferenciaEtapa(op, estado), hoy);
}

/** Bloqueos/dependencias activos sobre la operación. */
export function bloqueosDe(op: LogisticaOperacionVIN, hoy: Date = new Date()): BloqueoLogistico[] {
  const b: BloqueoLogistico[] = [];
  const estado = derivarEstadoLogistico(op);
  if (estado === "entregada" || estado === "anulada") return b;

  // Auto en APC sin solicitud de despacho (el tiempo muerto principal).
  if (op.fIngresoApc && !op.fSolicitudBodega) {
    const d = diasEntre(op.fIngresoApc, hoy);
    if (d != null && d > SLA_LOGISTICA.apc_a_solicitud_bodega.objetivoDias) b.push("auto_listo_no_solicitado");
  }
  // Solicitud sin respuesta de logística.
  if (op.fSolicitudVendedor && !op.fRespuestaLogistica) {
    const d = diasEntre(op.fSolicitudVendedor, hoy);
    if (d != null && d > SLA_LOGISTICA.respuesta_logistica.objetivoDias) b.push("sin_respuesta_logistica");
  }
  // Despacho marcado NO CUMPLIDO.
  if (up(op.cumplimientoDespacho) === "NO CUMPLIDO") b.push("despacho_incumplido");
  // En tránsito más allá del SLA.
  if (op.fDespacho && !op.fLlegadaSucursal) {
    const d = diasEntre(op.fDespacho, hoy);
    if (d != null && d > SLA_LOGISTICA.transito.alertaDias) b.push("transito_prolongado");
  }
  // Llegó y no se entrega (estado ya excluye entregada/anulada por el return previo).
  if (op.fLlegadaSucursal) b.push("llegado_no_entregado");
  // Inscripción pendiente (facturado o llegado, sin inscripción).
  if ((op.fFactura || op.fLlegadaSucursal) && !op.fInscripcion) b.push("inscripcion_pendiente");
  // Entrega comprometida vencida (ETA pasada y aún no entregada).
  if (op.fEntregaComprometida && op.fEntregaComprometida.getTime() < hoy.getTime()) b.push("eta_vencida");
  // Jefe de sucursal no responde.
  if (up(op.pasoActual).includes("JEFE SUCURSAL")) b.push("jefe_sucursal_no_responde");
  // Pendiente estancado.
  if (up(op.estadoArchivo) === "PENDIENTE") {
    const d = diasEntre(op.fSolicitudVendedor, hoy);
    if (d != null && d > PENDIENTE_ESTANCADO_DIAS) b.push("pendiente_estancado");
  }
  return b;
}

// ───────────────────────────── Score logístico (propuesta) ──────────────────

/** Pesos del score logístico (suman 100). 100 = rápido y limpio. */
export const SCORE_LOGISTICA_PESOS = {
  agingEtapa: 35, // cuánto lleva detenido en su etapa actual
  bloqueos: 30, // cantidad de dependencias activas
  slaIncumplido: 20, // tramos sobre el umbral de alerta
  cumplimiento: 15, // flag NO CUMPLIDO del despacho
} as const;

export interface ScoreLogisticoComp {
  agingEtapa: number;
  bloqueos: number;
  slaIncumplido: number;
  cumplimiento: number;
}

export interface ScoreLogisticoResult {
  score: number; // 0..100 (100 = óptimo)
  componentes: ScoreLogisticoComp;
  estado: EstadoLogistico;
  aging: number | null;
  bloqueos: BloqueoLogistico[];
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

/**
 * Score logístico explicable (propuesta inicial, calibrable):
 *   penaliza aging de la etapa actual (vs alerta del tramo dominante),
 *   nº de bloqueos, tramos SLA incumplidos y despacho no cumplido.
 */
export function scoreLogistico(op: LogisticaOperacionVIN, hoy: Date = new Date()): ScoreLogisticoResult {
  const estado = derivarEstadoLogistico(op);
  const aging = agingLogistico(op, hoy);
  const bloqueos = bloqueosDe(op, hoy);

  // Aging normalizado contra 30d (umbral de estancamiento) — etapas abiertas.
  const pAging = clamp01((aging ?? 0) / PENDIENTE_ESTANCADO_DIAS) * SCORE_LOGISTICA_PESOS.agingEtapa;
  // Bloqueos: cada uno pesa, saturando a 3.
  const pBloq = clamp01(bloqueos.length / 3) * SCORE_LOGISTICA_PESOS.bloqueos;
  // SLA incumplidos: cuántos tramos cerrados superaron su alerta.
  const tramos: Array<[Date | null, Date | null, SLATramo]> = [
    [op.fSolicitudVendedor, op.fRespuestaLogistica, SLA_LOGISTICA.respuesta_logistica],
    [op.fSolicitudBodega, op.fDespacho, SLA_LOGISTICA.solicitud_bodega_a_despacho],
    [op.fDespacho, op.fLlegadaSucursal, SLA_LOGISTICA.transito],
    [op.fFactura, op.fEntregaComprometida, SLA_LOGISTICA.factura_a_entrega],
  ];
  let incumplidos = 0;
  let medibles = 0;
  for (const [a, c, sla] of tramos) {
    const d = diasEntre(a, c);
    if (d == null) continue;
    medibles++;
    if (d > sla.alertaDias) incumplidos++;
  }
  const pSla = (medibles > 0 ? incumplidos / medibles : 0) * SCORE_LOGISTICA_PESOS.slaIncumplido;
  const pCump = (up(op.cumplimientoDespacho) === "NO CUMPLIDO" ? 1 : 0) * SCORE_LOGISTICA_PESOS.cumplimiento;

  const componentes: ScoreLogisticoComp = {
    agingEtapa: pAging,
    bloqueos: pBloq,
    slaIncumplido: pSla,
    cumplimiento: pCump,
  };
  const score = Math.round(Math.max(0, Math.min(100, 100 - pAging - pBloq - pSla - pCump)));
  return { score, componentes, estado, aging, bloqueos };
}

/** Velocidad total del VIN: solicitud → entrega comprometida (o llegada si falta). */
export function velocidadTotal(op: LogisticaOperacionVIN): number | null {
  return diasEntre(op.fSolicitudVendedor, op.fEntregaComprometida ?? op.fLlegadaSucursal);
}

// ───────────────────────── Higiene operacional (pendientes) ─────────────────
//
// La auditoría halló 3498 "Pendiente" con aging promedio 110d (máx 508): mezcla
// de operaciones vivas con basura histórica nunca cerrada. Separamos por días
// SIN MOVIMIENTO (último hito registrado → hoy), no por la fecha de solicitud.

export type EstadoHigieneOperacional = "activo" | "estancado" | "abandonado" | "cerrado";

export const HIGIENE_LABEL: Record<EstadoHigieneOperacional, string> = {
  activo: "Activo (pendiente vivo)",
  estancado: "Estancado (sin movimiento)",
  abandonado: "Abandonado (pendiente muerto)",
  cerrado: "Cerrado",
};

export const HIGIENE_ESTANCADO_DIAS = 30;
export const HIGIENE_ABANDONADO_DIAS = 90;

/** Último hito con fecha registrada (para medir días sin movimiento). */
export function ultimoMovimiento(op: LogisticaOperacionVIN): Date | null {
  const fechas = [
    op.fSolicitudVendedor, op.fRespuestaLogistica, op.fIngresoApc, op.fSolicitudBodega,
    op.fPlanificacion, op.fDespacho, op.fLlegadaSucursal, op.fFactura, op.fInscripcion,
  ].filter((d): d is Date => d != null);
  if (fechas.length === 0) return null;
  return fechas.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
}

/** Días sin movimiento (desde el último hito hasta hoy). */
export function diasSinMovimiento(op: LogisticaOperacionVIN, hoy: Date = new Date()): number | null {
  return diasEntre(ultimoMovimiento(op), hoy);
}

/**
 * Higiene operacional del caso: separa pendiente vivo / estancado / abandonado
 * del cerrado. Permite limpiar la "basura histórica" del universo Pendiente.
 */
export function clasificarHigiene(op: LogisticaOperacionVIN, hoy: Date = new Date()): EstadoHigieneOperacional {
  const estado = derivarEstadoLogistico(op);
  if (estado === "entregada" || estado === "anulada") return "cerrado";
  const sm = diasSinMovimiento(op, hoy);
  if (sm == null) return "estancado"; // sin ninguna fecha → no es confiable
  if (sm > HIGIENE_ABANDONADO_DIAS) return "abandonado";
  if (sm > HIGIENE_ESTANCADO_DIAS) return "estancado";
  return "activo";
}

// ───────────────────────────── Próxima acción / sugerencia ──────────────────

/** Orden de prioridad de bloqueos para sugerir la próxima acción. */
const BLOQUEO_PRIORIDAD: BloqueoLogistico[] = [
  "eta_vencida",
  "llegado_no_entregado",
  "despacho_incumplido",
  "auto_listo_no_solicitado",
  "sin_respuesta_logistica",
  "transito_prolongado",
  "inscripcion_pendiente",
  "jefe_sucursal_no_responde",
  "pendiente_estancado",
];

/** Acción concreta por bloqueo, derivada del catálogo. */
const ACCION_POR_BLOQUEO: Record<BloqueoLogistico, string> = Object.fromEntries(
  (Object.keys(BLOQUEO_META) as BloqueoLogistico[]).map((k) => [k, BLOQUEO_META[k].accion]),
) as Record<BloqueoLogistico, string>;

/** El bloqueo dominante del VIN (por prioridad operacional). */
export function bloqueoDominante(op: LogisticaOperacionVIN, hoy: Date = new Date()): BloqueoLogistico | null {
  const bs = bloqueosDe(op, hoy);
  if (bs.length === 0) return null;
  return BLOQUEO_PRIORIDAD.find((b) => bs.includes(b)) ?? bs[0];
}

/** Próxima acción logística sugerida (del bloqueo dominante). */
export function proximaAccionLogistica(op: LogisticaOperacionVIN, hoy: Date = new Date()): string | null {
  const dom = bloqueoDominante(op, hoy);
  return dom ? ACCION_POR_BLOQUEO[dom] : null;
}

/** Owner del bloqueo dominante — contextual cuando corresponde (ej. ETA vencida). */
export function ownerLogistico(op: LogisticaOperacionVIN, hoy: Date = new Date()): string | null {
  const dom = bloqueoDominante(op, hoy);
  return dom ? ownerDeBloqueo(dom, op) : null;
}

/** Días concretos relevantes a un bloqueo (para la explicación). */
function diasDeBloqueo(b: BloqueoLogistico, op: LogisticaOperacionVIN, hoy: Date): number | null {
  switch (b) {
    case "transito_prolongado":
      return diasEntre(op.fDespacho, hoy);
    case "auto_listo_no_solicitado":
      return diasEntre(op.fIngresoApc, hoy);
    case "sin_respuesta_logistica":
      return diasEntre(op.fSolicitudVendedor, hoy);
    case "eta_vencida":
      return diasEntre(op.fEntregaComprometida, hoy);
    case "pendiente_estancado":
      return diasEntre(op.fSolicitudVendedor, hoy);
    default:
      return null;
  }
}

/**
 * Explicación operacional de un bloqueo en ESTE VIN:
 * "qué pasa · hace cuánto · quién responde · qué hacer". No incluye capital
 * (eso vive a nivel de caso); el llamador puede anteponerlo.
 */
export function explicarBloqueo(
  b: BloqueoLogistico,
  op: LogisticaOperacionVIN,
  hoy: Date = new Date(),
): string {
  const m = BLOQUEO_META[b];
  const owner = ownerDeBloqueo(b, op);
  const d = diasDeBloqueo(b, op, hoy);
  const tiempo = d != null ? ` (${d}d)` : "";
  return `${m.definicion}${tiempo} · Responsable: ${owner}. Próxima acción: ${m.accion}`;
}

/** Explicación del bloqueo dominante del caso (o null si no hay bloqueo). */
export function explicarCasoLogistico(op: LogisticaOperacionVIN, hoy: Date = new Date()): string | null {
  const dom = bloqueoDominante(op, hoy);
  return dom ? explicarBloqueo(dom, op, hoy) : null;
}

// ───────────────────────────── SLA stats (por tramo) ────────────────────────

export interface SLATramoStats {
  tramo: string;
  label: string;
  n: number;
  promedio: number;
  p50: number;
  p95: number;
  max: number;
  /** % de operaciones medibles que superaron alertaDias del tramo. */
  pctIncumplimiento: number;
}

const TRAMOS_SLA: Array<{
  tramo: string;
  label: string;
  desde: (o: LogisticaOperacionVIN) => Date | null;
  hasta: (o: LogisticaOperacionVIN) => Date | null;
  sla: SLATramo;
}> = [
  { tramo: "apc_a_solicitud_bodega", label: "APC → solicitud bodega", desde: (o) => o.fIngresoApc, hasta: (o) => o.fSolicitudBodega, sla: SLA_LOGISTICA.apc_a_solicitud_bodega },
  { tramo: "solicitud_bodega_a_despacho", label: "Solicitud → despacho", desde: (o) => o.fSolicitudBodega, hasta: (o) => o.fDespacho, sla: SLA_LOGISTICA.solicitud_bodega_a_despacho },
  { tramo: "transito", label: "Despacho → llegada", desde: (o) => o.fDespacho, hasta: (o) => o.fLlegadaSucursal, sla: SLA_LOGISTICA.transito },
  { tramo: "factura_a_entrega", label: "Factura → entrega", desde: (o) => o.fFactura, hasta: (o) => o.fEntregaComprometida, sla: SLA_LOGISTICA.factura_a_entrega },
  { tramo: "solicitud_a_entrega", label: "Solicitud → entrega", desde: (o) => o.fSolicitudVendedor, hasta: (o) => o.fEntregaComprometida, sla: SLA_LOGISTICA.solicitud_a_entrega },
];

function percentil(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** Estadística SLA por tramo sobre un conjunto de operaciones. */
export function slaLogisticaStats(ops: LogisticaOperacionVIN[]): SLATramoStats[] {
  return TRAMOS_SLA.map(({ tramo, label, desde, hasta, sla }) => {
    const ds: number[] = [];
    for (const o of ops) {
      const d = diasEntre(desde(o), hasta(o));
      if (d != null && d >= 0) ds.push(d);
    }
    ds.sort((a, b) => a - b);
    const n = ds.length;
    const sum = ds.reduce((a, b) => a + b, 0);
    const incumplidos = ds.filter((d) => d > sla.alertaDias).length;
    return {
      tramo,
      label,
      n,
      promedio: n ? Math.round((sum / n) * 10) / 10 : 0,
      p50: percentil(ds, 0.5),
      p95: percentil(ds, 0.95),
      max: n ? ds[n - 1] : 0,
      pctIncumplimiento: n ? Math.round((incumplidos / n) * 100) : 0,
    };
  });
}
