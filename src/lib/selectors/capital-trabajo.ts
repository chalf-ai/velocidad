/**
 * CAPITAL DE TRABAJO · FUENTE ÚNICA DE VERDAD.
 *
 * Las 4 métricas oficiales (decisión de negocio 2026-06). Score Gerencial y
 * Tendencias DEBEN consumir EXACTAMENTE estas funciones — no recalcular ni
 * mantener definiciones paralelas. Una sola verdad operacional y financiera.
 *
 * Definiciones (validadas con auditoría · scripts/audit-captrabajo-unificacion.ts):
 *   1. Stock Pagado        · `Pagado?`=pagado  ∧  en stock activo  ∧  NO Judicial
 *   2. Provisiones >90d     · saldo ≠ 0  ∧  aging > 90 días
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
 * 2 · PROVISIONES >90d — provisiones con saldo abierto envejecidas.
 * saldo ≠ 0 ∧ aging > 90. Universo completo (todas las áreas), igual que el
 * indicador del Score.
 */
export function provisiones90(
  provisiones: ProvisionRegistro[],
): MetricaCapital<ProvisionRegistro> {
  const items = provisiones.filter(
    (p) => (p.saldo ?? 0) !== 0 && (p.agingDias ?? 0) > 90,
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
