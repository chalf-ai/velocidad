/**
 * CAPITAL DE TRABAJO · FUENTE ÚNICA DE VERDAD.
 *
 * Las 4 métricas oficiales (decisión de negocio 2026-06). Score Gerencial y
 * Tendencias DEBEN consumir EXACTAMENTE estas funciones — no recalcular ni
 * mantener definiciones paralelas. Una sola verdad operacional y financiera.
 *
 * Definiciones (validadas con auditoría · scripts/audit-captrabajo-unificacion.ts):
 *   1. Stock Pagado        · `Pagado?`=pagado  ∧  en stock activo  ∧  NO Judicial
 *   2. Provisiones >90d Venta · area="ventas" ∧ saldo ≠ 0 ∧ aging > 90 días
 *   3. Crédito Pompeyo >15d · creditoPompeyo > 0  ∧  máx. días desde factura > 15
 *   4. Saldos Vehículo T3+  · categoría "vehiculo"  ∧  statusDPS ∈ {T3..T7}
 *
 * Reemplaza la antigua métrica "Stock Propio" (tipoStock Propio/FinPropio +
 * condición) que mezclaba test cars y no-pagados — NO era capital de trabajo.
 */
import type { SaldoRegistro, ProvisionRegistro } from "../types";
import type { VehiculoUnificado } from "./vehiculo-unificado";
import { diasMaxCreditoPompeyo } from "../gestion/caso";

/** Tramos de aging de saldos que cuentan como "T3+". */
export const TRAMOS_T3PLUS = new Set(["T3", "T4", "T5", "T6", "T7"]);

/** Resultado canónico de una métrica de capital. `items` = universo crudo (drill). */
export interface MetricaCapital<T> {
  unidades: number;
  monto: number;
  items: T[];
}

/**
 * 1 · STOCK PAGADO — capital propio efectivamente inmovilizado.
 * `Pagado?`=pagado ∧ en stock activo ∧ NO Judicial. Sobre VUs ya unificados
 * (un VU = un VIN), así que no hace falta deduplicar acá.
 */
export function stockPagado(vus: VehiculoUnificado[]): MetricaCapital<VehiculoUnificado> {
  const items = vus.filter(
    (vu) => vu.esPagado && vu.enStockActivo && vu.stockAB !== "Judicial",
  );
  return {
    unidades: items.length,
    monto: items.reduce((s, v) => s + (v.costoNeto ?? 0), 0),
    items,
  };
}

/**
 * 2 · PROVISIONES >90d (VENTA) — provisiones de Área Negocio = Venta con saldo
 * abierto envejecidas. area="ventas" ∧ saldo ≠ 0 ∧ aging > 90.
 *
 * Decisión de negocio 2026-06: el indicador oficial de Capital de Trabajo de
 * Venta excluye Post Venta (concepto "Incentivo Post Ventas"). Validado contra
 * ROMA (Provisiones de Ingreso → Área=Venta): la clasificación de área de
 * Velocidad (classifyArea, /post vent/i) coincide 1:1 con ROMA
 * (VT_ProvisionesConcepto.AreaNegocioID). Antes era all-areas (113 casos);
 * ahora Venta = 104 casos · $370,5M (9 Post Venta · $6,7M fuera).
 */
export function provisiones90(
  provisiones: ProvisionRegistro[],
): MetricaCapital<ProvisionRegistro> {
  const items = provisiones.filter(
    (p) =>
      p.area === "ventas" && (p.saldo ?? 0) !== 0 && (p.agingDias ?? 0) > 90,
  );
  return {
    unidades: items.length,
    monto: items.reduce((s, p) => s + (p.saldo ?? 0), 0),
    items,
  };
}

/**
 * 3 · CRÉDITO POMPEYO >15d — diferencia por cobrar al cliente >15 días.
 * creditoPompeyo > 0 ∧ máximo de días desde factura > 15.
 */
export function creditoPompeyo15(
  vus: VehiculoUnificado[],
): MetricaCapital<VehiculoUnificado> {
  const items = vus.filter((vu) => {
    if (vu.creditoPompeyo <= 0) return false;
    const d = diasMaxCreditoPompeyo(vu);
    return d != null && d > 15;
  });
  return {
    unidades: items.length,
    monto: items.reduce((s, v) => s + v.creditoPompeyo, 0),
    items,
  };
}

/**
 * 4 · SALDOS VEHÍCULO T3+ — saldos por documentar en tramos antiguos.
 * categoría "vehiculo" ∧ statusDPS ∈ {T3..T7}.
 */
export function saldosT3(saldos: SaldoRegistro[]): MetricaCapital<SaldoRegistro> {
  const items = saldos.filter(
    (r) => r.categoria === "vehiculo" && TRAMOS_T3PLUS.has(r.statusDPS),
  );
  return {
    unidades: items.length,
    monto: items.reduce((s, r) => s + (r.saldoXDocumentar ?? 0), 0),
    items,
  };
}

/** Universo "stock vehículo" para el denominador del % de Stock Pagado:
 *  stock activo no judicial (mismo universo que numerador, sin el flag pagado). */
export function stockActivoValorizado(vus: VehiculoUnificado[]): MetricaCapital<VehiculoUnificado> {
  const items = vus.filter((vu) => vu.enStockActivo && vu.stockAB !== "Judicial");
  return {
    unidades: items.length,
    monto: items.reduce((s, v) => s + (v.costoNeto ?? 0), 0),
    items,
  };
}

// ────────────────────────────────────────────────────────────────────
// CAJA INMOVILIZADA · dos lentes (auditoría PAGADO vs PROPIO, 2026-06)
//
// La auditoría definitiva demostró que ni `Pagado?` ni `tipoStock=Propio`
// bastan por separado (están desactualizados en direcciones opuestas). La
// VERDAD FINANCIERA de caja propia inmovilizada es la UNIÓN:
//     Caja Inmovilizada = Pagado ∪ Propio ∪ FinPropio   (en stock activo)
//
// Sobre ese universo se separan dos LENTES:
//  • Score Gerencial  → "Caja Comercial Gestionable" (solo lo que el gerente
//    controla: Nuevos/Usados, incl. Stock B; sin Test Cars, Autos Compañía
//    ni Judicial). Principio: Responsabilidad = Capacidad de acción.
//  • Tendencias       → "Caja Inmovilizada Total" con desglose obligatorio
//    (Comercial / Test Cars / Autos Compañía / Judicial). No esconder caja.
//
// La clasificación es VIN a VIN y reproduce EXACTO la auditoría aprobada
// (corte 17-jun: Total 555 · Comercial 320 · Test 132 · Cía 70 · Judicial 33).
// ────────────────────────────────────────────────────────────────────

/** Categoría de gestión de un VIN dentro de la Caja Inmovilizada. */
export type CategoriaCaja =
  | "comercial"
  | "test_car"
  | "autos_compania"
  | "judicial"
  | "otros";

/**
 * BASE financiera: caja propia efectivamente inmovilizada =
 *   Pagado ∪ tipoStock∈{Propio, FinPropio}, en stock activo.
 * (FinPropio entra por la fórmula oficial de la auditoría; la diferencia con la
 *  base Pagado∪Propio son los FinPropio no pagados.)
 */
export function esCajaInmovilizada(vu: VehiculoUnificado): boolean {
  return (
    vu.enStockActivo &&
    (vu.esPagado || vu.tipoStock === "Propio" || vu.tipoStock === "FinPropio")
  );
}

/**
 * Clasifica un VU ACTIVO en su categoría de gestión. Precedencia exclusiva:
 *   Judicial > Test Car > Autos Compañía > Comercial > Otros.
 * Misma lógica (mismos ORs) que la auditoría definitiva PAGADO vs PROPIO por
 * marca responsable — por eso reproduce los conteos VIN a VIN.
 */
export function clasificarCaja(vu: VehiculoUnificado): CategoriaCaja {
  const dealer = (vu.estadoDealer ?? "").toUpperCase();
  const cond = (vu.condicionDeStock ?? "").toUpperCase();
  if (vu.stockAB === "Judicial" || dealer === "JUDICIAL" || vu.esJudicial) {
    return "judicial";
  }
  if (vu.esTescar || dealer === "TEST CAR" || cond.includes("TEST CAR")) {
    return "test_car";
  }
  if (
    vu.unidadNegocio === "AutosCompania" ||
    dealer.includes("COMPANY") ||
    dealer.includes("RENTING")
  ) {
    return "autos_compania";
  }
  if (vu.unidadNegocio === "Nuevos" || vu.unidadNegocio === "Usados") {
    return "comercial";
  }
  return "otros";
}

function agregar(items: VehiculoUnificado[]): MetricaCapital<VehiculoUnificado> {
  return {
    unidades: items.length,
    monto: items.reduce((s, v) => s + (v.costoNeto ?? 0), 0),
    items,
  };
}

/**
 * CAJA INMOVILIZADA TOTAL — verdad financiera (Tendencias). Toda la caja propia
 * inmovilizada, sin importar quién la gestiona. = base `esCajaInmovilizada`.
 */
export function cajaInmovilizadaTotal(
  vus: VehiculoUnificado[],
): MetricaCapital<VehiculoUnificado> {
  return agregar(vus.filter(esCajaInmovilizada));
}

/**
 * CAJA COMERCIAL GESTIONABLE — lente de RESPONSABILIDAD gerencial (Score). Caja
 * inmovilizada que el gerente comercial controla: Nuevos/Usados (incl. Stock B),
 * excluye Test Cars, Autos Compañía y Judicial.
 */
export function cajaComercialGestionable(
  vus: VehiculoUnificado[],
): MetricaCapital<VehiculoUnificado> {
  return agregar(
    vus.filter((vu) => esCajaInmovilizada(vu) && clasificarCaja(vu) === "comercial"),
  );
}

/** Caja inmovilizada en Test Cars (bloque aparte — la marca los ve, no el score). */
export function cajaTestCars(vus: VehiculoUnificado[]): MetricaCapital<VehiculoUnificado> {
  return agregar(
    vus.filter((vu) => esCajaInmovilizada(vu) && clasificarCaja(vu) === "test_car"),
  );
}

/** Caja inmovilizada en Autos Compañía / corporativos (Responsable = Empresa). */
export function cajaAutosCompania(
  vus: VehiculoUnificado[],
): MetricaCapital<VehiculoUnificado> {
  return agregar(
    vus.filter((vu) => esCajaInmovilizada(vu) && clasificarCaja(vu) === "autos_compania"),
  );
}

/** Caja inmovilizada Judicial (Responsable = Legal/Recuperación). */
export function cajaJudicial(vus: VehiculoUnificado[]): MetricaCapital<VehiculoUnificado> {
  return agregar(
    vus.filter((vu) => esCajaInmovilizada(vu) && clasificarCaja(vu) === "judicial"),
  );
}

/** Desglose completo de la Caja Inmovilizada — para el panel de Tendencias.
 *  Garantía: comercial + testCars + autosCompania + judicial + otros = total. */
export interface DesgloseCaja {
  total: MetricaCapital<VehiculoUnificado>;
  comercial: MetricaCapital<VehiculoUnificado>;
  testCars: MetricaCapital<VehiculoUnificado>;
  autosCompania: MetricaCapital<VehiculoUnificado>;
  judicial: MetricaCapital<VehiculoUnificado>;
  otros: MetricaCapital<VehiculoUnificado>;
}

export function desglosarCajaInmovilizada(vus: VehiculoUnificado[]): DesgloseCaja {
  const base = vus.filter(esCajaInmovilizada);
  const por = (c: CategoriaCaja) => agregar(base.filter((vu) => clasificarCaja(vu) === c));
  return {
    total: agregar(base),
    comercial: por("comercial"),
    testCars: por("test_car"),
    autosCompania: por("autos_compania"),
    judicial: por("judicial"),
    otros: por("otros"),
  };
}
