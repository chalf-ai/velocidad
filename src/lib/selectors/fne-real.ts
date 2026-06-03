/**
 * Selector del módulo FNE Real — fuente oficial "Autos no entregados.xlsx".
 *
 * Hace tres cosas:
 * 1. Cruza el archivo FNE contra Base_Stock por VIN (cuando ambos están cargados).
 * 2. Deriva el estado de entrega real desde las señales del archivo:
 *      auto en sucursal + patente en sucursal = "listo para entregar" (hot).
 * 3. Agrega stats — aging real desde FechaFactura, KPI hot, distribución por etapa.
 *
 * NO toca el módulo VPP/VU en autos sin entregar — ese sigue calculándose desde
 * Base_Stock vía esVPPComprometido. Este selector ignora PatenteVpp del archivo.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * SPLIT HISTÓRICO vs OPERATIVO (regla operacional desde 2026-05):
 *
 * La base "Autos no entregados.xlsx" puede venir como base completa de autos
 * facturados (incluyendo entregados y no entregados). Todos los cálculos del
 * pipeline operacional, KPIs, alertas, listados y drill-downs operan SOLO sobre
 * el universo `entregado=false`. La base completa queda en el store/snapshot
 * para análisis histórico futuro (tiempos promedio, throughput, aging histórico).
 *
 * Punto de filtrado único: `cruzarFNEConStock` aplica `filtrarFNEOperativo`
 * antes de procesar. Quien necesite el universo histórico llama a
 * `filtrarFNEHistorico` explícitamente o pasa `incluirEntregados: true`.
 * ───────────────────────────────────────────────────────────────────────────
 */

import type {
  AgingFNEReal,
  AntigüedadEstado,
  AutoNoEntregado,
  EnSucursalVenta,
  EstadoEntrega,
  EtapaFNE,
  FNERealCruzado,
  FNERealStats,
  Vehiculo,
  VINSupplementary,
} from "../types";
import { sucursalCoincideConBodega } from "../parser/normalize";
import { limpiarVIN } from "../parser/venta-apc";
import { esUsadoOperacional, sucursalEsUsados } from "./owner-operacional";

function agingBucket(dias: number | null): AgingFNEReal {
  if (dias === null || !Number.isFinite(dias)) return "sin_fecha";
  if (dias <= 3) return "0-3";
  if (dias <= 7) return "4-7";
  if (dias <= 15) return "8-15";
  if (dias <= 30) return "16-30";
  if (dias <= 60) return "31-60";
  return "61+";
}

function diasDesde(d: Date | null, hoy: Date): number | null {
  if (!d) return null;
  return Math.floor((hoy.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Chain exhaustivo y mutuamente excluyente — TODOS los registros caen en
 * exactamente UN estado. La suma de porEstado = total.
 *
 * Prioridad operacional (de más cerca de entregar a más lejos), reflejando
 * el pipeline completo: sucursal → CdN → RC → admin → sucursal → entrega.
 *
 *   1. listo_para_entregar          pat. en sucursal + sol=Si + autorización=Si
 *   2. falta_solo_autorizacion      pat. en sucursal + sol=Si + autorización=No
 *   3. patente_en_sucursal          pat. en sucursal, falta solicitud de entrega
 *   4. patente_en_transito          admin envió a sucursal, sin recibir
 *   5. patente_en_admin             admin tiene patente (volvió de RC), sin enviar
 *   6. inscrita_sin_admin           RC ya inscribió, todavía no llega a admin
 *   7. en_registro_civil            CdN mandó a RC, sin inscripción aún
 *   8. en_control_negocios          sucursal pidió, CdN no ha mandado a RC
 *   9. sin_solicitud_inscripcion    sucursal no ha pedido inscripción
 */
/**
 * Fecha que marca cuándo el FNE entró al estado actual del pipeline.
 *   listo / falta_aut / patente_en_sucursal: fechaPatenteRecibida
 *   patente_en_transito: fechaPatenteEnviada
 *   patente_en_admin: patentesAdministracion
 *   inscrita_sin_admin: fechaInscripcion
 *   en_registro_civil: fechaSolicitudInscripcion
 *   en_control_negocios / sin_solicitud_inscripcion: fechaVenta (es lo único anclable)
 */
export function fechaReferenciaEstado(
  fne: AutoNoEntregado,
  estado: EstadoEntrega,
): Date | null {
  switch (estado) {
    case "listo_para_entregar":
    case "falta_solo_autorizacion":
    case "patente_en_sucursal":
      return fne.fechaPatenteRecibida;
    case "patente_en_transito":
      return fne.fechaPatenteEnviada;
    case "patente_en_admin":
      return fne.patentesAdministracion;
    case "inscrita_sin_admin":
      return fne.fechaInscripcion;
    case "en_registro_civil":
      return fne.fechaSolicitudInscripcion;
    case "en_control_negocios":
    case "sin_solicitud_inscripcion":
      return fne.fechaVenta;
  }
}

function deriveEstadoEntrega(fne: AutoNoEntregado): EstadoEntrega {
  const patenteEnSucursal = fne.fechaPatenteRecibida !== null;
  if (patenteEnSucursal) {
    if (fne.solEntrega === true && fne.autorizacionEntrega === true) {
      return "listo_para_entregar";
    }
    if (fne.solEntrega === true && fne.autorizacionEntrega !== true) {
      return "falta_solo_autorizacion";
    }
    return "patente_en_sucursal";
  }
  if (fne.fechaPatenteEnviada !== null) return "patente_en_transito";
  if (fne.patentesAdministracion !== null) return "patente_en_admin";
  if (fne.fechaInscripcion !== null) return "inscrita_sin_admin";
  if (fne.fechaSolicitudInscripcion !== null) return "en_registro_civil";
  if (fne.solicitarInscripcion === true) return "en_control_negocios";
  return "sin_solicitud_inscripcion";
}

/** Subconjunto operativo — universo gestionable vivo. Alimenta TODOS los KPIs. */
export function filtrarFNEOperativo(registros: AutoNoEntregado[]): AutoNoEntregado[] {
  return registros.filter((r) => !r.entregado);
}

/**
 * Alinea el flag `entregado` del archivo FNE con la verdad operacional de
 * ROMA-Actas (decisión usuario 2026-06).
 *
 * Problema operacional: el archivo `Autos no entregados.xlsx` marca
 * `entrega_auto_txt = "Cargado"` cuando el equipo administrativo (APC)
 * carga la patente al sistema. ROMA-Actas marca `entregado = true` cuando
 * el vendedor confirma el acta firmada por el cliente. Son dos eventos
 * del mismo flujo, pero ROMA es más estricto: hasta que el cliente firme,
 * el auto NO está entregado.
 *
 * Regla cruzada:
 *   · Si ROMA tiene una entrada para el VIN y `cruceRoma.entregado === false`
 *     → forzar `entregado=false` aunque el archivo diga "Cargado".
 *   · Si ROMA tiene entrada y dice entregado, mantener flag del archivo
 *     (el archivo también lo marca como entregado típicamente — agree).
 *   · Si el VIN NO está en ROMA, respetar el archivo (caso usados sin ROMA,
 *     o VINs que no llegaron al cruce — son minoritarios).
 *
 * Función pura. Cero side effects. El resultado conserva todos los demás
 * campos intactos; solo recalcula `entregado` / `fechaEntregaReal` /
 * `fuenteEntrega` cuando aplica el override.
 */
export interface CruceRomaMin {
  vin: string;
  entregado: boolean;
  fEntregaReal: Date | null;
}

export function alinearFNEConROMA(
  registros: AutoNoEntregado[],
  cruceRoma: ReadonlyArray<CruceRomaMin>,
): AutoNoEntregado[] {
  // Index por VIN limpio para lookup O(1).
  const byVin = new Map<string, CruceRomaMin>();
  for (const c of cruceRoma) {
    const k = limpiarVIN(c.vin);
    if (k) byVin.set(k, c);
  }

  return registros.map((r) => {
    const k = limpiarVIN(r.vin);
    if (!k) return r;
    const roma = byVin.get(k);
    if (!roma) return r; // sin entrada en ROMA → respetar archivo

    // Override: ROMA dice NO entregado → forzar a no entregado.
    if (!roma.entregado && r.entregado) {
      return {
        ...r,
        entregado: false,
        fechaEntregaReal: null,
        fuenteEntrega: "ninguna" as const,
      };
    }

    // ROMA dice entregado + archivo dice no entregado → tirar de ROMA
    // (caso raro, defensivo: si ROMA tiene fEntregaReal poblada, usarla).
    if (roma.entregado && !r.entregado && roma.fEntregaReal) {
      return {
        ...r,
        entregado: true,
        fechaEntregaReal: roma.fEntregaReal,
        fuenteEntrega: "entrega_auto_txt" as const,
      };
    }

    return r;
  });
}

/** Subconjunto histórico de entregados — fuera del pipeline operacional.
 *  Reservado para módulos futuros de tiempos / throughput / comparativas. */
export function filtrarFNEHistorico(registros: AutoNoEntregado[]): AutoNoEntregado[] {
  return registros.filter((r) => r.entregado);
}

/**
 * Cruza cada registro FNE con info de stock. Estrategia en capas:
 *   1. Match VIN normalizado contra Base_Stock (stock activo) → "vehiculo"
 *   2. Si no hay match, busca contra registry suplementario (Venta APC,
 *      Financiado) que cubre VINs ya facturados/entregados → "vehiculoExtra"
 *
 * Esto recupera ~99% de cobertura vs el 24% que da solo Base_Stock.
 *
 * Por defecto FILTRA los entregados antes de cruzar — el universo retornado
 * es el operativo vivo. Pasá `incluirEntregados: true` solo si necesitás el
 * histórico completo (módulos futuros de tiempos / throughput).
 */
export function cruzarFNEConStock(
  registros: AutoNoEntregado[],
  vehiculos: Vehiculo[],
  vinsExtra: Map<string, VINSupplementary> | null = null,
  hoy: Date = new Date(),
  opts: { incluirEntregados?: boolean } = {},
): FNERealCruzado[] {
  const universo = opts.incluirEntregados === true
    ? registros
    : filtrarFNEOperativo(registros);

  // Indexamos Base_Stock por VIN NORMALIZADO (no por el VIN raw)
  const byVinStock = new Map<string, Vehiculo>();
  for (const v of vehiculos) {
    const k = limpiarVIN(v.vin);
    if (k && !byVinStock.has(k)) byVinStock.set(k, v);
  }

  return universo.map<FNERealCruzado>((fne) => {
    const vinLimpio = limpiarVIN(fne.vin);
    const veh = byVinStock.get(vinLimpio) ?? null;
    const extra = veh ? null : vinsExtra?.get(vinLimpio) ?? null;
    const patenteEnSucursal = fne.fechaPatenteRecibida !== null;

    // Cruce con stock = metadato auxiliar para "auto en bodega de sucursal".
    // NO bloquea "listo para entregar" — solo informa cobertura.
    let autoEnSucursal: EnSucursalVenta = "por_validar";
    if (veh) {
      autoEnSucursal = sucursalCoincideConBodega(fne.sucursal, veh.bodega ?? veh.sucursal);
    }

    const estadoEntrega = deriveEstadoEntrega(fne);
    const listoParaEntregar = estadoEntrega === "listo_para_entregar";
    const dias = diasDesde(fne.fechaFactura, hoy);
    const diasEnEstado = diasDesde(fechaReferenciaEstado(fne, estadoEntrega), hoy);

    return {
      fne,
      vehiculo: veh,
      vehiculoExtra: extra,
      estadoEntrega,
      diasDesdeFactura: dias,
      agingBucket: agingBucket(dias),
      diasEnEstado,
      autoEnSucursal,
      patenteEnSucursal,
      listoParaEntregar,
    };
  });
}

/**
 * ¿El FNE corresponde a la unidad USADOS? Detección por reglas operacionales
 * (el archivo FNE no trae marca). Dos señales complementarias, validadas contra
 * el archivo real:
 *   • VIN cruzado contra Base_Stock y el vehículo es usado (esUsadoOperacional)
 *     → caso preciso, incluye usados vendidos por oficinas de marca.
 *   • Sucursal de usados (USADOS …, AUTOSHOPPING, SEMINUEVO, CPD, OUTLET)
 *     → caso sin cruce de stock (auto ya salió de stock o no matchea).
 * La unión es el universo FNE de usados.
 */
export function esFNEUsado(c: FNERealCruzado): boolean {
  if (c.vehiculo != null && esUsadoOperacional(c.vehiculo)) return true;
  return sucursalEsUsados(c.fne.sucursal);
}

/** Subconjunto de FNE cruzados atribuibles a la unidad USADOS. */
export function filtrarFNEUsados(cruzados: FNERealCruzado[]): FNERealCruzado[] {
  return cruzados.filter(esFNEUsado);
}

/**
 * Enriquece los registros FNE con el flag `esUsado`, cruzando por VIN contra el
 * universo de stock. Misma definición que `esFNEUsado` (sucursal usados ∪ VIN→
 * stock usado), pero baked-in en el registro para que el filtro global
 * (getMarcaOperacional) capture los usados vendidos por oficinas de marca sin
 * tener el stock a mano. Inmutable: solo clona los registros que cambian.
 *
 * Se llama desde el store al cargar/cruzar (data o fne). Si `vehiculos` está
 * vacío, igual marca por sucursal (no rompe; el VIN se sumará al cruzar stock).
 */
export function enriquecerFNEUsados(
  registros: AutoNoEntregado[],
  vehiculos: Vehiculo[],
): AutoNoEntregado[] {
  const usadoVins = new Set<string>();
  for (const v of vehiculos) {
    if (esUsadoOperacional(v)) {
      const k = limpiarVIN(v.vin);
      if (k) usadoVins.add(k);
    }
  }
  return registros.map((r) => {
    const esUsado = sucursalEsUsados(r.sucursal) || usadoVins.has(limpiarVIN(r.vin));
    return r.esUsado === esUsado ? r : { ...r, esUsado };
  });
}

export const ORDEN_ESTADO: EstadoEntrega[] = [
  "listo_para_entregar",
  "falta_solo_autorizacion",
  "patente_en_sucursal",
  "patente_en_transito",
  "patente_en_admin",
  "inscrita_sin_admin",
  "en_registro_civil",
  "en_control_negocios",
  "sin_solicitud_inscripcion",
];

/** Agrupación visual del pipeline para layout. */
export const ESTADOS_ENTREGA_EN_SUCURSAL: EstadoEntrega[] = [
  "listo_para_entregar",
  "falta_solo_autorizacion",
  "patente_en_sucursal",
];
export const ESTADOS_PATENTE_EN_CAMINO: EstadoEntrega[] = [
  "patente_en_transito",
  "patente_en_admin",
  "inscrita_sin_admin",
];
export const ESTADOS_INSCRIPCION_PROCESO: EstadoEntrega[] = [
  "en_registro_civil",
  "en_control_negocios",
  "sin_solicitud_inscripcion",
];

/**
 * Bloqueo artificial: el auto está FÍSICAMENTE LISTO para entregar — patente
 * inscrita y recibida en la sucursal — y SOLO falta un trámite interno
 * (autorización o solicitud de entrega). Todo lo externo (Registro Civil,
 * llegada física de la patente) ya está. La demora es auto-infligida.
 *
 * Por eso la alerta NO depende del aging: cualquier unidad acá es alerta
 * INMEDIATA desde el día 0. Es plata lista para entregar trabada por un clic
 * interno.
 */
export const ESTADOS_BLOQUEO_ARTIFICIAL: EstadoEntrega[] = [
  "falta_solo_autorizacion",
  "patente_en_sucursal",
];

export function statsFNEReal(cruzados: FNERealCruzado[]): FNERealStats {
  const porAging: Record<AgingFNEReal, number> = {
    "0-3": 0,
    "4-7": 0,
    "8-15": 0,
    "16-30": 0,
    "31-60": 0,
    "61+": 0,
    sin_fecha: 0,
  };
  const porEtapa: Record<EtapaFNE, number> = {
    0: 0,
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    6: 0,
    7: 0,
    8: 0,
    12: 0,
    14: 0,
  };
  const porEstado: Record<EstadoEntrega, number> = {
    listo_para_entregar: 0,
    falta_solo_autorizacion: 0,
    patente_en_sucursal: 0,
    patente_en_transito: 0,
    patente_en_admin: 0,
    inscrita_sin_admin: 0,
    en_registro_civil: 0,
    en_control_negocios: 0,
    sin_solicitud_inscripcion: 0,
  };
  const valorPorEstado: Record<EstadoEntrega, number> = {
    listo_para_entregar: 0,
    falta_solo_autorizacion: 0,
    patente_en_sucursal: 0,
    patente_en_transito: 0,
    patente_en_admin: 0,
    inscrita_sin_admin: 0,
    en_registro_civil: 0,
    en_control_negocios: 0,
    sin_solicitud_inscripcion: 0,
  };
  const mkEmpty = (): AntigüedadEstado => ({
    conFecha: 0,
    maxDias: 0,
    mayor3d: 0,
    mayor7d: 0,
    mayor15d: 0,
    mayor30d: 0,
  });
  const antiguedadPorEstado: Record<EstadoEntrega, AntigüedadEstado> = {
    listo_para_entregar: mkEmpty(),
    falta_solo_autorizacion: mkEmpty(),
    patente_en_sucursal: mkEmpty(),
    patente_en_transito: mkEmpty(),
    patente_en_admin: mkEmpty(),
    inscrita_sin_admin: mkEmpty(),
    en_registro_civil: mkEmpty(),
    en_control_negocios: mkEmpty(),
    sin_solicitud_inscripcion: mkEmpty(),
  };

  let valorTotal = 0;
  let cruzadosConStock = 0;
  let cruzadosConHistorico = 0;
  let sinCruceStock = 0;

  const sucMap = new Map<string, { unidades: number; valor: number }>();

  for (const c of cruzados) {
    valorTotal += c.fne.valorFactura;
    porAging[c.agingBucket]++;
    porEtapa[c.fne.etapa]++;
    porEstado[c.estadoEntrega]++;
    valorPorEstado[c.estadoEntrega] += c.fne.valorFactura;

    // Antigüedad en el estado actual del pipeline
    const ant = antiguedadPorEstado[c.estadoEntrega];
    if (c.diasEnEstado !== null) {
      ant.conFecha++;
      if (c.diasEnEstado > ant.maxDias) ant.maxDias = c.diasEnEstado;
      if (c.diasEnEstado > 3) ant.mayor3d++;
      if (c.diasEnEstado > 7) ant.mayor7d++;
      if (c.diasEnEstado > 15) ant.mayor15d++;
      if (c.diasEnEstado > 30) ant.mayor30d++;
    }

    if (c.vehiculo) cruzadosConStock++;
    else if (c.vehiculoExtra) cruzadosConHistorico++;
    else sinCruceStock++;

    const sucKey = c.fne.sucursal ?? "(sin sucursal)";
    if (!sucMap.has(sucKey)) sucMap.set(sucKey, { unidades: 0, valor: 0 });
    const sucEntry = sucMap.get(sucKey)!;
    sucEntry.unidades++;
    sucEntry.valor += c.fne.valorFactura;
  }

  const porSucursal = [...sucMap.entries()]
    .map(([sucursal, v]) => ({ sucursal, unidades: v.unidades, valor: v.valor }))
    .sort((a, b) => b.unidades - a.unidades);

  return {
    total: cruzados.length,
    valorTotal,
    listoParaEntregar: porEstado.listo_para_entregar,
    valorListoParaEntregar: valorPorEstado.listo_para_entregar,
    porEstado,
    valorPorEstado,
    antiguedadPorEstado,
    porAging,
    porEtapa,
    cruzadosConStock,
    cruzadosConHistorico,
    sinCruceStock,
    porSucursal,
  };
}

export const ESTADO_ENTREGA_LABEL: Record<EstadoEntrega, string> = {
  listo_para_entregar: "Listos operacionalmente",
  falta_solo_autorizacion: "Falta solo autorización de entrega",
  patente_en_sucursal: "Falta solicitud de entrega",
  patente_en_transito: "Patente en tránsito a sucursal",
  patente_en_admin: "Patente en administración Pompeyo",
  inscrita_sin_admin: "Patente inscrita · esperando ingreso administrativo",
  en_registro_civil: "Pendiente inscripción Registro Civil",
  en_control_negocios: "En Control de Negocios · sin enviar a Registro Civil",
  sin_solicitud_inscripcion: "Sucursal sin solicitud de inscripción",
};

export const ESTADO_ENTREGA_TONE: Record<
  EstadoEntrega,
  "success" | "warning" | "info" | "muted" | "danger"
> = {
  listo_para_entregar: "success",
  falta_solo_autorizacion: "warning",
  patente_en_sucursal: "warning",
  patente_en_transito: "info",
  patente_en_admin: "info",
  inscrita_sin_admin: "info",
  en_registro_civil: "muted",
  en_control_negocios: "muted",
  sin_solicitud_inscripcion: "danger",
};

export const ESTADO_ENTREGA_DESC: Record<EstadoEntrega, string> = {
  listo_para_entregar:
    "Operacionalmente listos: patente en sucursal + solicitud de entrega + autorización. Pueden entregarse hoy, salvo que tengan un bloqueo financiero (Crédito Pompeyo por cobrar).",
  falta_solo_autorizacion:
    "Bloqueo artificial: el auto está listo para entregar (patente en sucursal + solicitud lista) y solo falta la autorización interna de entrega. Alerta inmediata.",
  patente_en_sucursal:
    "Bloqueo artificial: la patente ya está en la sucursal y solo falta tramitar la solicitud de entrega. Alerta inmediata.",
  patente_en_transito:
    "Administración Pompeyo envió la patente a la sucursal, pero todavía no se confirma su recepción.",
  patente_en_admin:
    "La patente volvió desde Registro Civil a administración Pompeyo; falta enviarla a la sucursal.",
  inscrita_sin_admin:
    "Registro Civil ya inscribió la patente, pero todavía no ingresa a administración Pompeyo.",
  en_registro_civil:
    "La solicitud está en Registro Civil. La patente TODAVÍA NO está inscrita.",
  en_control_negocios:
    "La sucursal pidió la inscripción, pero Control de Negocios todavía no la envió a Registro Civil.",
  sin_solicitud_inscripcion:
    "La sucursal todavía no inicia el proceso de inscripción/patente. Proceso comercial sin empezar.",
};

export const AGING_REAL_LABEL: Record<AgingFNEReal, string> = {
  "0-3": "0-3 días",
  "4-7": "4-7 días",
  "8-15": "8-15 días",
  "16-30": "16-30 días",
  "31-60": "31-60 días",
  "61+": "61+ días",
  sin_fecha: "Sin fecha",
};

export const AGING_REAL_TONE: Record<
  AgingFNEReal,
  "success" | "info" | "warning" | "danger" | "muted"
> = {
  "0-3": "success",
  "4-7": "info",
  "8-15": "warning",
  "16-30": "warning",
  "31-60": "danger",
  "61+": "danger",
  sin_fecha: "muted",
};

export const ETAPA_LABEL: Record<EtapaFNE, string> = {
  0: "(sin etapa)",
  1: "1 · Venta",
  2: "2 · Facturación",
  3: "3 · Solicitud inscripción",
  4: "4 · Inscripción",
  6: "6 · Patente administración",
  7: "7 · Patente en tránsito",
  8: "8 · Patente en sucursal",
  12: "12 · Etapa especial",
  14: "14 · Etapa especial",
};
