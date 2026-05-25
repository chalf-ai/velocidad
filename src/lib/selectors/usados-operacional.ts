/**
 * TAXONOMÍA OPERACIONAL OFICIAL DE USADOS · función madre.
 *
 * USADOS es una UNIDAD OPERACIONAL DE CAPITAL DE TRABAJO. Esta función clasifica
 * cada usado en UNA categoría operacional (mutuamente excluyente) usando
 * Base_Stock como fuente — NO heurísticas visuales.
 *
 * ── STOCK COMERCIALIZABLE (entra al MOS) ──────────────────────────────────
 *   RETAIL · CPD · MAYORISTA/liquidación · JUDICIAL · STOCK B.
 *   Todo eso sigue siendo responsabilidad comercial/operacional de usados
 *   (el gerente puede reparar, lavar, publicar, liquidar, pasar a mayorista),
 *   consume capital y refleja velocidad → cuenta en el MOS.
 *
 * ── FUERA DEL MOS ─────────────────────────────────────────────────────────
 *   CAPITAL PUENTE (VU nuevos + BU) y NO RECEPCIONADO: todavía no son stock
 *   comercializable. TESCAR/demo va aparte (su propio módulo). NO_RETAIL
 *   (renting/company) es residual.
 *
 * Fuente de cada señal (Base_Stock / flags ya parseados):
 *   - es usado: Unidad Negocio = "Usados" · Condicion Vehiculo "USADO…" ·
 *               Marca Pompeyo ∈ {USADOS, VU en Nuevos, VU en Usados}
 *   - puente:   esVPPComprometido · judicial: esJudicial · stock B: esStockB
 *   - tescar:   esTescar / esTescarOperacional · no_retail: destinoOperacional
 *   - estado de flujo comercial: estadoFlujoVO (col 83 "Marca Pompeyo C.") →
 *       "No Recepcionado" · "En Proceso de Liquidacion"/"Mayorista" · "Proceso CPD"
 *       · "Vitrina"/"Proceso de Venta"/resto = retail. Fallback CPD: tipoStockUsados.
 */

import type { Vehiculo } from "../types";
import { ventaMensualPromedio } from "../ventas-q1";
import { MOS_IDEAL, MOS_MAXIMO, CV_IDEAL, CV_MAXIMO } from "./eficiencia-capital";
import { esUsadoOperacional, duenaCapitalPuente, MARCA_USADOS } from "./owner-operacional";

// El predicado "¿es usado?" vive en la función madre (owner-operacional): USADOS
// es una marca operacional y su universo se resuelve UNA sola vez. La taxonomía
// clasifica subcategorías ENCIMA de ese universo. Se reexporta por compatibilidad.
export { esUsadoOperacional };

export type CategoriaUsado =
  | "USADOS_RETAIL" // vitrina / proceso de venta / disponibles
  | "USADOS_CPD" // preparación / reacondicionamiento retail
  | "USADOS_MAYORISTA" // liquidación / salida mayorista
  | "USADOS_JUDICIAL" // judicial / resciliación
  | "USADOS_STOCK_B" // stock B (taller)
  | "USADOS_NO_RECEPCIONADO" // por ingresar — aún no es stock comercializable
  | "USADOS_CAPITAL_PUENTE" // VU/BU recibido en parte de pago
  | "USADOS_TESCAR" // demo / test car
  | "USADOS_NO_RETAIL"; // renting / company / vdr / interno (residual)

export const CATEGORIA_USADO_LABEL: Record<CategoriaUsado, string> = {
  USADOS_RETAIL: "Retail disponible",
  USADOS_CPD: "Preparación (CPD)",
  USADOS_MAYORISTA: "Liquidación / mayorista",
  USADOS_JUDICIAL: "Judicial / resciliación",
  USADOS_STOCK_B: "Stock B (taller)",
  USADOS_NO_RECEPCIONADO: "No recepcionado",
  USADOS_CAPITAL_PUENTE: "Capital puente",
  USADOS_TESCAR: "TESCAR / demo",
  USADOS_NO_RETAIL: "No retail (renting/company)",
};

/**
 * STOCK COMERCIALIZABLE = numerador del MOS. Son las categorías que el gerente
 * de usados puede mover comercialmente (vender, preparar, liquidar) o destrabar
 * (judicial, stock B). Consumen capital y reflejan velocidad operacional.
 */
export const CATEGORIAS_COMERCIALIZABLE: CategoriaUsado[] = [
  "USADOS_RETAIL",
  "USADOS_CPD",
  "USADOS_MAYORISTA",
  "USADOS_JUDICIAL",
  "USADOS_STOCK_B",
];
export const esComercializable = (c: CategoriaUsado | null): boolean =>
  c != null && CATEGORIAS_COMERCIALIZABLE.includes(c);

/** Capital MUERTO/bloqueado (visual): judicial + stock B. Entra al MOS igual. */
export const CATEGORIAS_CAPITAL_MUERTO: CategoriaUsado[] = ["USADOS_JUDICIAL", "USADOS_STOCK_B"];

/** Días sobre los que un usado comercializable se considera capital detenido/lento. */
export const DETENIDO_DIAS = 180;
/** Umbrales de envejecimiento del mayorista/liquidación (alerta operacional). */
export const MAYORISTA_AGING = { warn: 30, alto: 90, critico: 180 } as const;

const up = (s: string | null | undefined) => (s ?? "").toUpperCase();

const esNoRetailDestino = (v: Vehiculo): boolean =>
  v.destinoOperacional === "renting" ||
  v.destinoOperacional === "company" ||
  v.destinoOperacional === "vdr" ||
  v.destinoOperacional === "interno";

export interface ClasifUsado {
  esUsado: boolean;
  categoria: CategoriaUsado | null;
}

/**
 * Clasifica un usado en UNA categoría operacional (prioridad descendente).
 * Devuelve categoria=null si el vehículo no es usado.
 *
 * Prioridad: flags de capital (autoritativos) → destino → estado de flujo.
 */
export function clasificarUsadoOperacional(v: Vehiculo): ClasifUsado {
  if (!esUsadoOperacional(v)) return { esUsado: false, categoria: null };

  let categoria: CategoriaUsado;
  if (v.esVPPComprometido) categoria = "USADOS_CAPITAL_PUENTE";
  else if (v.esJudicial) categoria = "USADOS_JUDICIAL";
  else if (v.esStockB) categoria = "USADOS_STOCK_B";
  else if (v.esTescar || v.esTescarOperacional) categoria = "USADOS_TESCAR";
  else if (esNoRetailDestino(v)) categoria = "USADOS_NO_RETAIL";
  else {
    const flujo = up(v.estadoFlujoVO);
    const t = up(v.tipoStockUsados);
    if (flujo.includes("NO RECEP")) categoria = "USADOS_NO_RECEPCIONADO";
    else if (flujo.includes("LIQUIDA") || flujo.includes("MAYOR")) categoria = "USADOS_MAYORISTA";
    else if (flujo.includes("CPD") || t.includes("CPD")) categoria = "USADOS_CPD";
    else categoria = "USADOS_RETAIL"; // Vitrina / Proceso de Venta / Disponibles / resto
  }

  return { esUsado: true, categoria };
}

// ─────────────────────────────────────────────────────────────────────────
// Auditoría reproducible (mismo cálculo, dentro del sistema)
// ─────────────────────────────────────────────────────────────────────────

export interface CategoriaAudit {
  categoria: CategoriaUsado;
  unidades: number;
  capital: number;
  agingPromedio: number;
}

export interface UsadosAudit {
  totalUsados: number;
  capitalTotal: number;
  porCategoria: CategoriaAudit[];
  /** Usados sin señales mínimas para clasificar (deberían ser 0). */
  ambiguos: number;
}

function uniqByVin(vs: Vehiculo[]): Vehiculo[] {
  const seen = new Set<string>();
  const out: Vehiculo[] = [];
  for (const v of vs) {
    if (seen.has(v.vin)) continue;
    seen.add(v.vin);
    out.push(v);
  }
  return out;
}

const ORDEN: CategoriaUsado[] = [
  "USADOS_RETAIL",
  "USADOS_CPD",
  "USADOS_MAYORISTA",
  "USADOS_JUDICIAL",
  "USADOS_STOCK_B",
  "USADOS_NO_RECEPCIONADO",
  "USADOS_CAPITAL_PUENTE",
  "USADOS_TESCAR",
  "USADOS_NO_RETAIL",
];

export function auditarUsados(vehiculos: Vehiculo[]): UsadosAudit {
  const usados = uniqByVin(vehiculos).filter(esUsadoOperacional);

  const acc = new Map<CategoriaUsado, { u: number; cap: number; dias: number; conDias: number }>();
  let ambiguos = 0;

  for (const v of usados) {
    const { categoria } = clasificarUsadoOperacional(v);
    if (!categoria) {
      ambiguos++;
      continue;
    }
    const e = acc.get(categoria) ?? { u: 0, cap: 0, dias: 0, conDias: 0 };
    e.u++;
    e.cap += v.costoNeto || 0;
    if ((v.diasStock ?? 0) > 0) {
      e.dias += v.diasStock as number;
      e.conDias++;
    }
    acc.set(categoria, e);
  }

  const porCategoria: CategoriaAudit[] = ORDEN.filter((c) => acc.has(c)).map((c) => {
    const e = acc.get(c)!;
    return {
      categoria: c,
      unidades: e.u,
      capital: e.cap,
      agingPromedio: e.conDias > 0 ? Math.round(e.dias / e.conDias) : 0,
    };
  });

  return {
    totalUsados: usados.length,
    capitalTotal: usados.reduce((s, v) => s + (v.costoNeto || 0), 0),
    porCategoria,
    ambiguos,
  };
}

// ════════════════════════════════════════════════════════════════════════
// DASHBOARD OPERACIONAL DE USADOS · capa ejecutiva sobre la taxonomía.
//
// USADOS = UNA unidad operacional de capital de trabajo. El MOS, capital/venta,
// aging y score se miden sobre el STOCK COMERCIALIZABLE (retail + cpd + mayorista
// + judicial + stock B). El capital puente y el no recepcionado quedan FUERA del
// MOS (todavía no rotan), pero el capital puente PROPIO (BU) sí suma al capital.
// Ventas = retail + mayorista (Q1) mensualizadas.
// ════════════════════════════════════════════════════════════════════════

/** Pesos del score de eficiencia de usados (suman 100). */
export const USADOS_SCORE_PESOS = {
  mos: 25,
  capitalVenta: 25,
  detenido: 20,
  judicial: 15,
  puente: 10,
  stockB: 5,
} as const;

export interface UsadosScoreComp {
  mos: number;
  capitalVenta: number;
  detenido: number;
  judicial: number;
  puente: number;
  stockB: number;
}

export interface SucursalUsadoRow {
  sucursal: string;
  unidades: number;
  capital: number;
  agingPromedio: number;
  comercializable: number;
  mayorista: number;
  puente: number;
  muerto: number; // judicial + stock B
}

export interface CasoUsado {
  v: Vehiculo;
  categoria: CategoriaUsado;
  aging: number | null;
}

export interface RefCat {
  u: number;
  cap: number;
}
export interface AgingBucket {
  mas30: RefCat;
  mas90: RefCat;
  mas180: RefCat;
}

export interface DashboardUsados {
  totalUsados: number;
  /** Capital de la UNIDAD (stock usado − VU nuevos). = capitalUnidad. Base del MOS/eficiencia. */
  capitalUtilizado: number;
  /** Capital PROPIO = caja Pompeyo expuesta (stock pagado + tránsito propio + BU). EXCLUYE financiado y VU nuevos. */
  capitalPropio: number;
  /** Capital de TERCEROS (financiado: FloorPlan/Financiado). EXCLUYE VU nuevos. */
  capitalTerceros: number;
  /** Capital de la UNIDAD = propio + terceros (excl VU nuevos). = capitalUtilizado. */
  capitalUnidad: number;
  /** Capital GESTIONADO total = unidad + VU en nuevos visible. NO es caja propia. */
  capitalGestionado: number;
  /** Capital OPERATIVO (comercializable + BU puente propio). Excluye VU nuevos. */
  capitalOperativo: number;
  porCategoria: CategoriaAudit[];
  // refs por categoría
  retail: RefCat;
  cpd: RefCat;
  mayorista: RefCat;
  judicial: RefCat;
  stockB: RefCat;
  noRecepcionado: RefCat;
  noRetail: RefCat;
  tescar: RefCat;
  /** Capital puente TOTAL (VU nuevos + BU usados). */
  puente: RefCat;
  /** VU en nuevos: gestionado por USADOS, capital en la marca originadora. NO suma. */
  puenteNuevos: RefCat;
  /** BU en usados: capital PROPIO de usados. SÍ suma. */
  puenteUsados: RefCat;
  // agrupaciones
  /** Stock comercializable = numerador del MOS (retail+cpd+mayorista+judicial+stockB). */
  comercializable: RefCat;
  /** Capital muerto/bloqueado = judicial + stock B (entra al MOS igual). */
  capitalMuerto: RefCat;
  // ventas + eficiencia
  ventaMensualMonto: number | null;
  ventaMensualUnidades: number | null;
  ventaQ1Monto: number | null;
  ventaQ1Unidades: number | null;
  /** MOS = stock comercializable / venta mensual (u). */
  mos: number | null;
  /** A · capital propio / venta mensual → carga total de caja. */
  capitalVentaPct: number | null;
  /** B · capital operativo / venta mensual → eficiencia operativa limpia. */
  capitalOperativoVentaPct: number | null;
  score: number | null;
  componentes: UsadosScoreComp | null;
  // aging sobre stock comercializable
  agingMas60: number;
  agingMas180: number;
  /** Capital detenido/lento (>180d) dentro del comercializable. */
  capitalDetenido: number;
  /** Envejecimiento del mayorista/liquidación (alerta operacional). */
  mayoristaAging: AgingBucket;
  porSucursal: SucursalUsadoRow[];
  casos: CasoUsado[];
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

export function dashboardUsados(vehiculos: Vehiculo[]): DashboardUsados {
  const audit = auditarUsados(vehiculos);
  const usados = uniqByVin(vehiculos).filter(esUsadoOperacional);

  const casos: CasoUsado[] = usados.map((v) => {
    const { categoria } = clasificarUsadoOperacional(v);
    return { v, categoria: categoria as CategoriaUsado, aging: v.diasStock };
  });

  const ref = (c: CategoriaUsado): RefCat => {
    const e = audit.porCategoria.find((x) => x.categoria === c);
    return { u: e?.unidades ?? 0, cap: e?.capital ?? 0 };
  };
  const retail = ref("USADOS_RETAIL");
  const cpd = ref("USADOS_CPD");
  const mayorista = ref("USADOS_MAYORISTA");
  const judicial = ref("USADOS_JUDICIAL");
  const stockB = ref("USADOS_STOCK_B");
  const noRecepcionado = ref("USADOS_NO_RECEPCIONADO");
  const noRetail = ref("USADOS_NO_RETAIL");
  const tescar = ref("USADOS_TESCAR");
  const puente = ref("USADOS_CAPITAL_PUENTE");

  // Agrupaciones.
  const sumRef = (...rs: RefCat[]): RefCat => ({
    u: rs.reduce((s, r) => s + r.u, 0),
    cap: rs.reduce((s, r) => s + r.cap, 0),
  });
  const comercializable = sumRef(retail, cpd, mayorista, judicial, stockB);
  const capitalMuerto = sumRef(judicial, stockB);

  // ── DOBLE CONTEO DEL PUENTE ────────────────────────────────────────────────
  //  · VU en Nuevos: VPP de operaciones de autos NUEVOS. Originador KIA/MG/etc →
  //    su capital YA está contado en la marca originadora. USADOS lo GESTIONA pero
  //    NO debe sumarlo de nuevo. · BU en Usados: VPP de ventas de USADOS → SÍ suma.
  // La distinción usa la MISMA primitiva que el dashboard (duenaCapitalPuente):
  // dueña ≠ USADOS → VU en nuevos (no suma) · dueña == USADOS → BU propio (suma).
  const sumCap = (cs: CasoUsado[]) => cs.reduce((s, c) => s + (c.v.costoNeto || 0), 0);
  const puenteCasos = casos.filter((c) => c.categoria === "USADOS_CAPITAL_PUENTE");
  const puenteNuevosCasos = puenteCasos.filter((c) => duenaCapitalPuente(c.v) !== MARCA_USADOS);
  const puenteUsadosCasos = puenteCasos.filter((c) => duenaCapitalPuente(c.v) === MARCA_USADOS);
  const puenteNuevos = { u: puenteNuevosCasos.length, cap: sumCap(puenteNuevosCasos) };
  const puenteUsados = { u: puenteUsadosCasos.length, cap: sumCap(puenteUsadosCasos) };

  // Capital de la UNIDAD: stock que gestiona usados EXCLUYENDO el VU en nuevos
  // (ya contado en su marca). Propio + terceros. Base del MOS/eficiencia.
  const capitalUtilizado = audit.capitalTotal - puenteNuevos.cap;
  // Capital GESTIONADO total: unidad + VU en nuevos visible. NO es caja propia.
  const capitalGestionado = audit.capitalTotal;

  // ── CAJA PROPIA (Pompeyo) vs TERCEROS ──────────────────────────────────────
  // Partición por tipoStock sobre el universo usado EXCLUYENDO VU en nuevos (su
  // caja es de la marca originadora). MISMA definición que el Bloque A del
  // dashboard (computeDashboardKPIs):
  //   caja Pompeyo = stock pagado (Propio/FinPropio) + tránsito (VuPorRecibir/Desconocido)
  //   terceros     = financiado (FloorPlan/Financiado)
  // capitalPropio + capitalTerceros = capitalUnidad. capitalPropio es lo que SÍ
  // expone caja de Pompeyo; los $7.88B de la unidad incluyen financiamiento externo.
  const nuevosVins = new Set(puenteNuevosCasos.map((c) => c.v.vin));
  let capitalPropio = 0;
  let capitalTerceros = 0;
  for (const v of usados) {
    if (nuevosVins.has(v.vin)) continue; // VU en nuevos: caja de la marca origen
    const c = v.costoNeto || 0;
    if (v.tipoStock === "FloorPlan" || v.tipoStock === "Financiado") capitalTerceros += c;
    else capitalPropio += c; // Propio / FinPropio / VuPorRecibir / Desconocido = caja Pompeyo
  }
  const capitalUnidad = capitalUtilizado;
  // Capital OPERATIVO = comercializable + BU puente propio. Excluye VU nuevos.
  const capitalOperativo = comercializable.cap + puenteUsados.cap;

  // Ventas usados (retail + mayorista, ya combinadas en VENTAS_Q1["USADOS"]).
  const venta = ventaMensualPromedio("USADOS");
  const ventaMensualMonto = venta?.monto ?? null;
  const ventaMensualUnidades = venta?.unidades ?? null;

  // MOS = stock COMERCIALIZABLE (lo que rota o debe rotar) / venta mensual (u).
  const mos =
    ventaMensualUnidades && ventaMensualUnidades > 0
      ? comercializable.u / ventaMensualUnidades
      : null;
  const capitalVentaPct =
    ventaMensualMonto && ventaMensualMonto > 0 ? (capitalUtilizado / ventaMensualMonto) * 100 : null;
  const capitalOperativoVentaPct =
    ventaMensualMonto && ventaMensualMonto > 0 ? (capitalOperativo / ventaMensualMonto) * 100 : null;

  // Aging sobre el stock comercializable.
  const comercializableCasos = casos.filter((c) => esComercializable(c.categoria));
  const agingMas60 = comercializableCasos.filter((c) => (c.aging ?? 0) > 60).length;
  const agingMas180 = comercializableCasos.filter((c) => (c.aging ?? 0) > DETENIDO_DIAS).length;
  const capitalDetenido = comercializableCasos
    .filter((c) => (c.aging ?? 0) > DETENIDO_DIAS)
    .reduce((s, c) => s + (c.v.costoNeto || 0), 0);

  // Envejecimiento del mayorista/liquidación.
  const mayoristaCasos = casos.filter((c) => c.categoria === "USADOS_MAYORISTA");
  const bucket = (lo: number): RefCat => {
    const f = mayoristaCasos.filter((c) => (c.aging ?? 0) > lo);
    return { u: f.length, cap: f.reduce((s, c) => s + (c.v.costoNeto || 0), 0) };
  };
  const mayoristaAging: AgingBucket = {
    mas30: bucket(MAYORISTA_AGING.warn),
    mas90: bucket(MAYORISTA_AGING.alto),
    mas180: bucket(MAYORISTA_AGING.critico),
  };

  // Score eficiencia usados.
  let score: number | null = null;
  let componentes: UsadosScoreComp | null = null;
  if (mos != null && capitalOperativoVentaPct != null && capitalUtilizado > 0) {
    const pMos = clamp01((mos - MOS_IDEAL) / (MOS_MAXIMO - MOS_IDEAL)) * USADOS_SCORE_PESOS.mos;
    // capital/venta usa el OPERATIVO (limpio); el capital muerto se penaliza aparte.
    const pCv =
      clamp01((capitalOperativoVentaPct - CV_IDEAL) / (CV_MAXIMO - CV_IDEAL)) *
      USADOS_SCORE_PESOS.capitalVenta;
    // capital detenido/lento (>180d) dentro del comercializable.
    const pDetenido = clamp01(capitalDetenido / capitalUtilizado) * USADOS_SCORE_PESOS.detenido;
    const pJud = clamp01(judicial.cap / capitalUtilizado) * USADOS_SCORE_PESOS.judicial;
    // Puente propio (BU usados) — el VU en nuevos no es capital de usados.
    const pPuente = clamp01(puenteUsados.cap / capitalUtilizado) * USADOS_SCORE_PESOS.puente;
    const pStockB = clamp01(stockB.cap / capitalUtilizado) * USADOS_SCORE_PESOS.stockB;
    componentes = {
      mos: pMos,
      capitalVenta: pCv,
      detenido: pDetenido,
      judicial: pJud,
      puente: pPuente,
      stockB: pStockB,
    };
    score = Math.round(
      Math.max(0, Math.min(100, 100 - pMos - pCv - pDetenido - pJud - pPuente - pStockB)),
    );
  }

  // Ranking por sucursal usados.
  const sucMap = new Map<string, SucursalUsadoRow>();
  for (const cs of casos) {
    const k = cs.v.sucursal ?? "(sin sucursal)";
    let e = sucMap.get(k);
    if (!e) {
      e = {
        sucursal: k,
        unidades: 0,
        capital: 0,
        agingPromedio: 0,
        comercializable: 0,
        mayorista: 0,
        puente: 0,
        muerto: 0,
      };
      sucMap.set(k, e);
    }
    const monto = cs.v.costoNeto || 0;
    e.unidades++;
    e.capital += monto;
    if (esComercializable(cs.categoria)) e.comercializable += monto;
    if (cs.categoria === "USADOS_MAYORISTA") e.mayorista += monto;
    else if (cs.categoria === "USADOS_CAPITAL_PUENTE") e.puente += monto;
    if (cs.categoria === "USADOS_JUDICIAL" || cs.categoria === "USADOS_STOCK_B") e.muerto += monto;
  }
  const agingAcc = new Map<string, { d: number; n: number }>();
  for (const cs of casos) {
    if ((cs.aging ?? 0) > 0) {
      const k = cs.v.sucursal ?? "(sin sucursal)";
      const a = agingAcc.get(k) ?? { d: 0, n: 0 };
      a.d += cs.aging as number;
      a.n++;
      agingAcc.set(k, a);
    }
  }
  const porSucursal = [...sucMap.values()]
    .map((row) => {
      const a = agingAcc.get(row.sucursal);
      return { ...row, agingPromedio: a && a.n > 0 ? Math.round(a.d / a.n) : 0 };
    })
    .sort((a, b) => b.capital - a.capital);

  return {
    totalUsados: audit.totalUsados,
    capitalUtilizado,
    capitalPropio,
    capitalTerceros,
    capitalUnidad,
    capitalGestionado,
    capitalOperativo,
    porCategoria: audit.porCategoria,
    retail,
    cpd,
    mayorista,
    judicial,
    stockB,
    noRecepcionado,
    noRetail,
    tescar,
    puente,
    puenteNuevos,
    puenteUsados,
    comercializable,
    capitalMuerto,
    ventaMensualMonto,
    ventaMensualUnidades,
    ventaQ1Monto: ventaMensualMonto != null ? ventaMensualMonto * 3 : null,
    ventaQ1Unidades: ventaMensualUnidades != null ? Math.round(ventaMensualUnidades * 3) : null,
    mos,
    capitalVentaPct,
    capitalOperativoVentaPct,
    score,
    componentes,
    agingMas60,
    agingMas180,
    capitalDetenido,
    mayoristaAging,
    porSucursal,
    casos,
  };
}

// ════════════════════════════════════════════════════════════════════════
// FUENTE ÚNICA · universoOperacionalUsados
//
// Define UNA sola vez el universo USADOS para que el filtro global, /usados, el
// dashboard de capital, saldos, FNE, capital puente, la ficha VIN y los drills
// CONVERSEN. El universo de vehículos es exactamente el que resuelve el filtro
// global (getMarcaOperacional == USADOS, vía esUsadoOperacional). La doble
// dimensión owner/originador se respeta: el VU en nuevos entra como GESTIONADO
// (visible) pero NO como PROPIO (su capital es de la marca originadora).
//
// Dos métricas explícitas:
//   · capitalPropio     → lo que SÍ suma al capital usado (excluye VU en nuevos).
//   · capitalGestionado → lo que USADOS gestiona (propio + VU en nuevos visible).
// ════════════════════════════════════════════════════════════════════════

export interface UniversoUsados {
  /** Universo canónico (uniq por VIN, esUsadoOperacional). MISMO set del filtro global. */
  vehiculos: Vehiculo[];
  /** Taxonomía + MOS + capital propio/gestionado (capa operacional de /usados). */
  dash: DashboardUsados;
}

/**
 * Resuelve el universo operacional de USADOS una sola vez. Acepta cualquier
 * lista de vehículos (todo el stock o ya filtrado): internamente deduplica por
 * VIN y restringe a usados, así el resultado es idéntico venga del filtro global
 * o del pipeline completo.
 */
export function universoOperacionalUsados(vehiculos: Vehiculo[]): UniversoUsados {
  const universo = uniqByVin(vehiculos).filter(esUsadoOperacional);
  return { vehiculos: universo, dash: dashboardUsados(vehiculos) };
}
