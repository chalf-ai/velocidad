/**
 * CAPA ÚNICA DE GESTIÓN OPERACIONAL · modelo de caso reutilizable.
 *
 * Un "caso operacional" es la unión, por VIN, de las tres capas que YA existen
 * en el sistema — sin duplicarlas ni reemplazarlas:
 *
 *   1. CONTEXTO operacional   → VehiculoUnificado (aging, capital, FNE, saldos…)
 *   2. SCORE / PRIORIDAD      → ScoreVIN (componentes: financiero, aging,
 *                               operacional, caja, riesgo) — `calcularScore`
 *   3. SEGUIMIENTO PERSISTENTE → GestionVIN (responsable, fecha compromiso,
 *                               próxima acción, estado, historial, override)
 *
 * Todos los módulos (FNE, saldos, provisiones, capital puente, stock pagado,
 * capital inmovilizado, líneas, judicial, …) deben LEER y ESCRIBIR sobre este
 * mismo modelo. La escritura ya está unificada en `useGestionStore` (indexado
 * por VIN); esta capa unifica la LECTURA y el estado derivado del caso
 * (estado de cola, SLA, alertas), para que la visualización y la gestión sean
 * idénticas en todas partes.
 *
 * Es una función PURA: no toca el store ni localStorage. No rompe nada
 * existente — compone lo que ya hay.
 *
 * ── Preparado para NOTIFICACIÓN AUTOMÁTICA futura (NO implementada aún) ──
 * Cada caso expone responsable, email, ownership y timestamps + una lista de
 * `alertas` calculadas (vencido / sin responsable / sin actualización / SLA
 * roto / aging crítico). Un job futuro podrá iterar casos y notificar sin
 * tocar este modelo. Hoy NO se envían correos.
 */

import type { VehiculoUnificado } from "../selectors/vehiculo-unificado";
import type { ScoreVIN, Severidad } from "../selectors/score";
import type { GestionVIN, HistorialEntry, PrioridadManual } from "./types";
import {
  type LogisticaOperacionVIN,
  type EstadoLogistico,
  type BloqueoLogistico,
  type EstadoHigieneOperacional,
  ESTADO_LOGISTICO_LABEL,
  BLOQUEO_LOGISTICO_LABEL,
  derivarEstadoLogistico,
  agingLogistico,
  bloqueosDe,
  clasificarHigiene,
  scoreLogistico,
  proximaAccionLogistica,
  ownerLogistico,
} from "../logistica/modelo";

/**
 * Prioridad efectiva del caso: el override manual de gestión gana sobre la
 * severidad automática del score. "baja" (manual) mapea a "info" en la escala
 * de severidad operacional.
 */
function prioridadEfectiva(manual: PrioridadManual, auto: Severidad): Severidad {
  if (!manual) return auto;
  if (manual === "baja") return "info";
  return manual; // "media" | "alta" | "critica" ya son Severidad válidas
}

// ─────────────────────────────────────────────────────────────────────────
// Compromiso (fecha objetivo vs hoy)
// ─────────────────────────────────────────────────────────────────────────

export type CompromisoEstado = "vigente" | "pronto" | "vencido" | "sin";

export interface CompromisoInfo {
  estado: CompromisoEstado;
  /** Magnitud en días (vencido → días de atraso; vigente → días que faltan). */
  dias: number;
  label: string;
}

/** Evalúa una fecha compromiso (YYYY-MM-DD) contra hoy. Pura. */
export function evalCompromiso(
  fecha: string | null | undefined,
  hoy: Date = new Date(),
): CompromisoInfo {
  if (!fecha) return { estado: "sin", dias: 0, label: "Sin compromiso" };
  const base = new Date(hoy);
  base.setHours(0, 0, 0, 0);
  const f = new Date(`${fecha}T00:00:00`);
  if (isNaN(f.getTime())) return { estado: "sin", dias: 0, label: "Sin compromiso" };
  const dias = Math.round((f.getTime() - base.getTime()) / 86_400_000);
  if (dias < 0) return { estado: "vencido", dias: -dias, label: `Vencido hace ${-dias}d` };
  if (dias === 0) return { estado: "pronto", dias: 0, label: "Vence hoy" };
  if (dias === 1) return { estado: "pronto", dias: 1, label: "Vence mañana" };
  return { estado: "vigente", dias, label: `Vigente · faltan ${dias}d` };
}

// ─────────────────────────────────────────────────────────────────────────
// SLA — días objetivo de respuesta por prioridad
// ─────────────────────────────────────────────────────────────────────────

/** Días objetivo de respuesta/actualización del caso según su prioridad. */
export const SLA_OBJETIVO_DIAS: Record<Severidad, number> = {
  critica: 2,
  alta: 5,
  media: 10,
  info: 20,
};

export interface SLACaso {
  /** Días objetivo según prioridad. */
  objetivoDias: number;
  /** Días desde la última actualización de gestión (0 si nunca se gestionó). */
  diasSinActualizar: number;
  /** El caso está abierto y superó su SLA de respuesta. */
  roto: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Alertas futuras (calculadas, NO persistidas) — base del notificador futuro
// ─────────────────────────────────────────────────────────────────────────

export type TipoAlerta =
  | "sin_responsable"
  | "compromiso_vencido"
  | "sin_actualizacion"
  | "sla_roto"
  | "aging_critico"
  | "logistica_bloqueada"
  | "eta_vencida"
  | "pendiente_abandonado";

export interface AlertaCaso {
  tipo: TipoAlerta;
  descripcion: string;
  severidad: Severidad;
}

// ─────────────────────────────────────────────────────────────────────────
// Estado del caso dentro de la cola operacional
// ─────────────────────────────────────────────────────────────────────────

export type EstadoCaso =
  | "sin_gestion" // requiere acción y nadie lo ha tomado
  | "en_cola" // tomado pero requiere acción AHORA (vencido / sin avance)
  | "en_seguimiento" // responsable + compromiso vigente + activo → fuera del top
  | "resuelto"; // gestión resuelta o cancelada

// ─────────────────────────────────────────────────────────────────────────
// MÁXIMA ALERTA · coincidencia de factores críticos
//
// El score (presión 0-100) sigue siendo la medida fina. Pero "máxima alerta"
// — la cola que lidera el Centro de Acción — NO es un umbral de score: es la
// COINCIDENCIA de varios problemas críticos en el MISMO VIN. Así no se vuelve
// "todo el inventario" (un solo factor flojo no alcanza) ni "casi nada".
//
// Regla: judicial es crítico por sí solo; el resto requiere 2+ factores juntos.
// ─────────────────────────────────────────────────────────────────────────

export interface FactorCritico {
  id: string;
  label: string;
}

/** Mínimo de factores críticos coincidentes para máxima alerta (salvo judicial). */
export const MAXIMA_ALERTA_MIN_FACTORES = 2;

/** Capital considerado "alto" para efectos de factor crítico (CLP). */
const CAPITAL_ALTO_CLP = 30_000_000;

/** Factores críticos presentes en un VIN. Derivados solo de VehiculoUnificado. */
export function factoresCriticosDe(vu: VehiculoUnificado): FactorCritico[] {
  const f: FactorCritico[] = [];
  if (vu.creditoPompeyo > 0) f.push({ id: "credito_pompeyo", label: "Crédito Pompeyo" });
  if (vu.enFNE && vu.fneEstado !== "listo_para_entregar" && (vu.fneDiasEnEstado ?? 0) > 15)
    f.push({ id: "fne_detenido", label: "FNE detenido >15d" });
  if (vu.fneEstado === "listo_para_entregar" && (vu.fneDiasEnEstado ?? 0) > 3)
    f.push({ id: "fne_listo_retenido", label: "Listo, no retirado" });
  if (agingDe(vu) > 180) f.push({ id: "aging_180", label: "Aging >180d" });
  if (vu.capitalComprometido > CAPITAL_ALTO_CLP) f.push({ id: "capital_alto", label: "Capital >$30M" });
  if (vu.lineaSobregirada) f.push({ id: "sobregiro", label: "Línea sobregirada" });
  if (vu.esStockPagadoViejo) f.push({ id: "pagado_180", label: "Pagado +180d" });
  if (vu.esVPP && (vu.diasVPP ?? 0) > 60) f.push({ id: "vu_puente", label: "VU puente +60d" });
  if (vu.esJudicial) f.push({ id: "judicial", label: "Judicial" });
  return f;
}

/**
 * Días desde la fecha de factura del crédito Pompeyo más antiguo del VIN.
 *
 * Busca el saldo con `subTipo === "credito_pompeyo"` y `cPompeyoCLP > 0`
 * más viejo (mayor cantidad de días). Si no existe ningún saldo CP con
 * fecha registrada, devuelve null.
 *
 * El propósito es responder "¿este VIN tiene un CP con factura > 7d?" sin
 * depender del aging del VIN en general (que es el estado del flujo
 * operacional, no la edad del crédito).
 */
export function diasMaxCreditoPompeyo(
  vu: VehiculoUnificado,
  hoy: Date = new Date(),
): number | null {
  const baseMs = hoy.getTime();
  let max: number | null = null;
  for (const s of vu.saldosDetalle ?? []) {
    if (s.subTipo !== "credito_pompeyo") continue;
    if (s.cPompeyoCLP <= 0) continue;
    if (!s.fechaVenta) continue;
    const dias = Math.floor((baseMs - s.fechaVenta.getTime()) / 86_400_000);
    if (max === null || dias > max) max = dias;
  }
  return max;
}

/**
 * Días desde la factura del VIN (mejor referencia disponible).
 *
 * Prioriza `fneDiasFactura` (oficial de FNE), si no usa la `fechaVenta`
 * más antigua entre los saldos vehículo del VIN como proxy. Devuelve null
 * si no hay ninguna referencia.
 */
export function diasDesdeFacturaDe(
  vu: VehiculoUnificado,
  hoy: Date = new Date(),
): number | null {
  if (vu.fneDiasFactura != null) return vu.fneDiasFactura;
  const baseMs = hoy.getTime();
  let max: number | null = null;
  for (const s of vu.saldosDetalle ?? []) {
    if (s.categoria !== "vehiculo") continue;
    if (!s.fechaVenta) continue;
    const dias = Math.floor((baseMs - s.fechaVenta.getTime()) / 86_400_000);
    if (max === null || dias > max) max = dias;
  }
  return max;
}

/**
 * ¿El VIN es gestionable HOY para bloqueos operacionales en vivo?
 *
 * Más estricto que `esOperacionalActivo` (que incluye `enSaldos`): un VIN
 * que ya está entregado pero quedó con saldo pendiente sigue contando como
 * "operacional activo", pero NO debería aparecer en colas de gestión
 * logística viva — eso ya pasó. Para Bloqueos logísticos / Bloqueo vivo
 * solo cuentan los que físicamente están en piso o aún facturados sin
 * entregar.
 *
 * Reglas:
 *  - `enStockActivo`: VIN vivo en stock (en piso).
 *  - `enFNE`: facturado pero todavía no entregado al cliente.
 *
 * NO entran: VINs que solo aparecen en saldos (cobranza histórica), ya
 * entregados con saldo pendiente, ni VINs solo en histórico de ventas.
 */
export function esVinGestionableHoy(vu: VehiculoUnificado): boolean {
  return vu.enStockActivo || vu.enFNE;
}

/**
 * ¿El VIN está en MÁXIMA ALERTA? Judicial cuenta por sí solo; el resto necesita
 * coincidencia de 2+ factores críticos. Puro, derivado de VehiculoUnificado.
 */
export function esMaximaAlertaDe(vu: VehiculoUnificado): boolean {
  const f = factoresCriticosDe(vu);
  if (f.some((x) => x.id === "judicial")) return true;
  return f.length >= MAXIMA_ALERTA_MIN_FACTORES;
}

export const ESTADO_CASO_LABEL: Record<EstadoCaso, string> = {
  sin_gestion: "Sin gestión",
  en_cola: "En cola activa",
  en_seguimiento: "En seguimiento",
  resuelto: "Resuelto",
};

export interface SeguimientoInfo {
  estado: EstadoCaso;
  /** Tiene seguimiento activo vigente (responsable + compromiso + en curso). */
  enSeguimiento: boolean;
  /** Compromiso vencido y caso no cerrado. */
  vencido: boolean;
  compromiso: CompromisoInfo;
}

/**
 * Clasifica el estado de SEGUIMIENTO de un caso usando SOLO la gestión
 * (responsable, fecha compromiso, estado). No necesita score ni VehiculoUnificado,
 * por eso es reutilizable en CUALQUIER módulo/fila que tenga un VIN o clave de
 * gestión — la misma regla del Centro de Acción, en todas partes. Pura.
 *
 * Regla "En seguimiento" (sale del top de trabajo): responsable + compromiso
 * vigente + seguimiento activo (en curso / esperando tercero) y no vencido.
 */
export function clasificarSeguimiento(
  gestion: GestionVIN | null,
  hoy: Date = new Date(),
): SeguimientoInfo {
  const estadoGestion = gestion?.estadoGestion ?? null;
  const compromiso = evalCompromiso(gestion?.fechaCompromiso ?? null, hoy);
  const cerrado = estadoGestion === "resuelto" || estadoGestion === "cancelado";
  const vencido = !cerrado && compromiso.estado === "vencido";
  const compromisoVigente = compromiso.estado === "vigente" || compromiso.estado === "pronto";
  const seguimientoActivo = estadoGestion === "en_curso" || estadoGestion === "esperando";

  let estado: EstadoCaso;
  let enSeguimiento = false;
  if (cerrado) {
    estado = "resuelto";
  } else if (!!gestion?.responsable && compromisoVigente && seguimientoActivo) {
    estado = "en_seguimiento";
    enSeguimiento = true;
  } else {
    estado = gestion ? "en_cola" : "sin_gestion";
  }
  return { estado, enSeguimiento, vencido, compromiso };
}

// ─────────────────────────────────────────────────────────────────────────
// Caso operacional — modelo único
// ─────────────────────────────────────────────────────────────────────────

export interface CasoOperacional {
  /** VIN normalizado — clave única del caso (misma que usa useGestionStore). */
  id: string;

  // Capas compuestas (no se duplican)
  vu: VehiculoUnificado;
  score: ScoreVIN;
  gestion: GestionVIN | null;

  // Derivados de presentación / priorización
  estado: EstadoCaso;
  /** Prioridad efectiva: override manual de gestión, si no la severidad del score. */
  prioridad: Severidad;
  /** Presión operacional 0-100 (score.total). */
  presion: number;
  /** Aging operacional más relevante en días. */
  aging: number;
  /** Capital operacional comprometido. */
  capital: number;

  // Seguimiento / ownership (preparado para notificación futura)
  responsable: string | null;
  responsableEmail: string | null;
  ownership: string | null;
  fechaCompromiso: string | null;
  compromiso: CompromisoInfo;
  /** Próxima acción concreta: la de gestión, si no la sugerida por el score. */
  proximaAccion: string | null;
  /** Contexto / blocker (por qué está detenido). */
  contexto: string | null;
  historial: HistorialEntry[];
  ultimaActualizacion: string | null;

  // Estado operacional derivado
  sla: SLACaso;
  alertas: AlertaCaso[];

  /** Factores críticos coincidentes (base de la máxima alerta). */
  factores: FactorCritico[];
  /** Máxima alerta: judicial, o 2+ factores críticos a la vez. */
  esMaximaAlerta: boolean;

  /** Requiere acción AHORA → entra al top principal del Centro de Acción. */
  enColaActiva: boolean;
  /** Tiene seguimiento activo vigente → sale del top, pasa a "En seguimiento". */
  enSeguimiento: boolean;

  /**
   * Dimensión LOGÍSTICA del caso (cuarto score del VIN, junto a financiero/
   * operacional/entrega). null cuando el VIN no tiene operación logística cruzada.
   * Aditivo: si no se pasa `logistica` a construirCaso, queda null y el caso se
   * comporta exactamente igual que antes.
   */
  logistica: LogisticaCasoResumen | null;
}

/** Resumen logístico embebido en el caso operacional (vocabulario del caso). */
export interface LogisticaCasoResumen {
  estado: EstadoLogistico;
  estadoLabel: string;
  /** Días en la etapa actual. */
  aging: number | null;
  higiene: EstadoHigieneOperacional;
  /** Score logístico 0-100 (100 = rápido y limpio). */
  score: number;
  bloqueos: BloqueoLogistico[];
  /** Algún tramo SLA sobre alerta (tránsito / sin solicitud / sin respuesta / estancado). */
  slaRoto: boolean;
  etaVencida: boolean;
  proximaAccion: string | null;
  ownerLogistico: string | null;
}

/**
 * Bloqueos logísticos que cuentan como FACTOR CRÍTICO (alimentan máxima alerta).
 * NO se incluye "llegado_no_entregado": es el estado normal del FNE (ya contado
 * por los factores FNE de VehiculoUnificado) → evita doble conteo.
 */
const BLOQUEOS_DUROS: BloqueoLogistico[] = [
  "eta_vencida",
  "despacho_incumplido",
  "auto_listo_no_solicitado",
];

const BLOQUEOS_SLA: BloqueoLogistico[] = [
  "transito_prolongado",
  "auto_listo_no_solicitado",
  "sin_respuesta_logistica",
  "pendiente_estancado",
];

/** Construye el resumen logístico del caso desde la operación logística. Puro. */
export function resumirLogistica(
  op: LogisticaOperacionVIN,
  hoy: Date = new Date(),
): LogisticaCasoResumen {
  const estado = derivarEstadoLogistico(op);
  const bloqueos = bloqueosDe(op, hoy);
  const { score } = scoreLogistico(op, hoy);
  return {
    estado,
    estadoLabel: ESTADO_LOGISTICO_LABEL[estado],
    aging: agingLogistico(op, hoy),
    higiene: clasificarHigiene(op, hoy),
    score,
    bloqueos,
    slaRoto: bloqueos.some((b) => BLOQUEOS_SLA.includes(b)),
    etaVencida: bloqueos.includes("eta_vencida"),
    proximaAccion: proximaAccionLogistica(op, hoy),
    ownerLogistico: ownerLogistico(op, hoy),
  };
}

const PRIORIDAD_RANK: Record<Severidad, number> = {
  critica: 4,
  alta: 3,
  media: 2,
  info: 1,
};

function agingDe(vu: VehiculoUnificado): number {
  return Math.max(
    vu.fneDiasFactura ?? 0,
    vu.fneDiasEnEstado ?? 0,
    vu.diasStock ?? 0,
    vu.diasTescar ?? 0,
  );
}

function diasDesde(iso: string | null | undefined, hoy: Date): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, Math.round((hoy.getTime() - t) / 86_400_000));
}

/**
 * Construye el caso operacional único componiendo contexto + score + gestión.
 * `gestion` puede ser null (caso sin gestión todavía). Pura.
 */
export function construirCaso(
  vu: VehiculoUnificado,
  score: ScoreVIN,
  gestion: GestionVIN | null,
  hoy: Date = new Date(),
  logistica: LogisticaOperacionVIN | null = null,
): CasoOperacional {
  const id = vu.vinLimpio;
  const estadoGestion = gestion?.estadoGestion ?? null;
  const responsable = gestion?.responsable ?? null;
  const fechaCompromiso = gestion?.fechaCompromiso ?? null;
  const compromiso = evalCompromiso(fechaCompromiso, hoy);

  // Prioridad efectiva: override manual gana sobre el score automático.
  const prioridad: Severidad = prioridadEfectiva(gestion?.prioridadManual ?? null, score.severidad);

  const aging = agingDe(vu);
  const factores = factoresCriticosDe(vu);
  // ── Dimensión logística (aditiva: solo cuando hay operación cruzada) ──────
  const logisticaResumen = logistica ? resumirLogistica(logistica, hoy) : null;
  if (logisticaResumen) {
    // Un bloqueo logístico DURO cuenta como un factor crítico → puede elevar a
    // máxima alerta combinado con otro factor del VIN.
    if (logisticaResumen.bloqueos.some((b) => BLOQUEOS_DUROS.includes(b))) {
      const dominante = logisticaResumen.bloqueos.find((b) => BLOQUEOS_DUROS.includes(b))!;
      factores.push({ id: `logistica_${dominante}`, label: BLOQUEO_LOGISTICO_LABEL[dominante] });
    }
  }
  const esMaximaAlerta = esMaximaAlertaDe(vu) || factores.length >= MAXIMA_ALERTA_MIN_FACTORES;
  const cerrado = estadoGestion === "resuelto" || estadoGestion === "cancelado";

  // SLA
  const objetivoDias = SLA_OBJETIVO_DIAS[prioridad];
  const diasSinActualizar = diasDesde(gestion?.ultimaActualizacion, hoy);
  const slaRoto = !!gestion && !cerrado && diasSinActualizar > objetivoDias;
  const sla: SLACaso = { objetivoDias, diasSinActualizar, roto: slaRoto };

  // ── Clasificación de cola ──────────────────────────────────────────────
  // Misma regla en todos los módulos vía clasificarSeguimiento (gestión-only):
  // "En seguimiento" (sale del top) = responsable + compromiso vigente +
  // seguimiento activo. Si no, requiere acción AHORA → cola activa.
  const seg = clasificarSeguimiento(gestion, hoy);
  const estado = seg.estado;
  const enSeguimiento = seg.enSeguimiento;
  const enColaActiva = estado !== "resuelto" && !enSeguimiento;

  // ── Alertas futuras (calculadas) ───────────────────────────────────────
  const alertas: AlertaCaso[] = [];
  if (!cerrado) {
    if (compromiso.estado === "vencido") {
      alertas.push({
        tipo: "compromiso_vencido",
        descripcion: `Compromiso vencido hace ${compromiso.dias}d`,
        severidad: "alta",
      });
    }
    if (!responsable && score.total > 0) {
      alertas.push({
        tipo: "sin_responsable",
        descripcion: "Caso activo sin responsable asignado",
        severidad: "media",
      });
    }
    if (slaRoto) {
      alertas.push({
        tipo: "sla_roto",
        descripcion: `SLA roto: ${diasSinActualizar}d sin avanzar (objetivo ${objetivoDias}d)`,
        severidad: "alta",
      });
    }
    if (!!gestion && !slaRoto && diasSinActualizar > objetivoDias * 2) {
      alertas.push({
        tipo: "sin_actualizacion",
        descripcion: `Sin actualización hace ${diasSinActualizar}d`,
        severidad: "media",
      });
    }
    if (aging > 180) {
      alertas.push({
        tipo: "aging_critico",
        descripcion: `Aging crítico: ${aging}d`,
        severidad: "alta",
      });
    }
    // ── Alertas logísticas (cuando hay operación cruzada) ────────────────────
    if (logisticaResumen) {
      if (logisticaResumen.etaVencida) {
        alertas.push({
          tipo: "eta_vencida",
          descripcion: "Entrega comprometida vencida (ETA pasada)",
          severidad: "alta",
        });
      }
      if (logisticaResumen.higiene === "abandonado") {
        alertas.push({
          tipo: "pendiente_abandonado",
          descripcion: "Pendiente abandonado: sin movimiento logístico hace +90d",
          severidad: "media",
        });
      }
      const duros = logisticaResumen.bloqueos.filter((b) => BLOQUEOS_DUROS.includes(b));
      if (duros.length > 0 && !logisticaResumen.etaVencida) {
        alertas.push({
          tipo: "logistica_bloqueada",
          descripcion: `Bloqueo logístico: ${BLOQUEO_LOGISTICO_LABEL[duros[0]]}`,
          severidad: "alta",
        });
      }
    }
  }

  return {
    id,
    vu,
    score,
    gestion,
    estado,
    prioridad,
    presion: score.total,
    aging,
    capital: vu.capitalComprometido,
    responsable,
    responsableEmail: gestion?.responsableEmail ?? null,
    ownership: gestion?.ownership ?? null,
    fechaCompromiso,
    compromiso,
    proximaAccion:
      gestion?.proximaAccion ?? score.accionSugerida ?? logisticaResumen?.proximaAccion ?? null,
    contexto: gestion?.comentario ?? null,
    historial: gestion?.historial ?? [],
    ultimaActualizacion: gestion?.ultimaActualizacion ?? null,
    sla,
    alertas,
    factores,
    esMaximaAlerta,
    enColaActiva,
    enSeguimiento,
    logistica: logisticaResumen,
  };
}

/** Orden canónico: prioridad → presión → capital. Mayor primero. */
export function compararCasos(a: CasoOperacional, b: CasoOperacional): number {
  const pr = PRIORIDAD_RANK[b.prioridad] - PRIORIDAD_RANK[a.prioridad];
  if (pr !== 0) return pr;
  if (b.presion !== a.presion) return b.presion - a.presion;
  return b.capital - a.capital;
}

export interface ColaDividida {
  /** Lo que requiere acción AHORA — top principal. */
  activa: CasoOperacional[];
  /** Casos con seguimiento activo vigente — fuera del top, no desaparecen. */
  seguimiento: CasoOperacional[];
  /** Casos cerrados (resueltos / cancelados). */
  resueltos: CasoOperacional[];
}

/**
 * Divide una lista de casos en cola activa / en seguimiento / resueltos,
 * cada bucket ordenado por prioridad. Es la base del Centro de Acción:
 * el top muestra SOLO la cola activa.
 */
export function dividirCola(casos: CasoOperacional[]): ColaDividida {
  const activa: CasoOperacional[] = [];
  const seguimiento: CasoOperacional[] = [];
  const resueltos: CasoOperacional[] = [];
  for (const c of casos) {
    if (c.estado === "resuelto") resueltos.push(c);
    else if (c.enSeguimiento) seguimiento.push(c);
    else activa.push(c);
  }
  activa.sort(compararCasos);
  seguimiento.sort(compararCasos);
  resueltos.sort(compararCasos);
  return { activa, seguimiento, resueltos };
}
