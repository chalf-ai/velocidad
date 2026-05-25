/**
 * Definiciones canónicas de segmentos de caja — FUENTE ÚNICA DE VERDAD.
 *
 * Estos predicados se reutilizan en todos los módulos (Dashboard, Recuperación
 * de Caja, Capital de Trabajo, Centro de Acción, Líneas, Explorer) para que un
 * mismo concepto signifique exactamente lo mismo en todas partes.
 *
 * Capital puente — definición única:
 *   ENTRA: vehículos usados recibidos en parte de pago (VPP) + unidades en
 *          preparación/documentación (CPD), asociadas a una operación nueva,
 *          todavía no monetizadas. Equivale a `naturalezaCapital === "puente"`
 *          (VPP_EXPLICITO + PROCESO_CPD), el mismo concepto que usa el Dashboard.
 *   NO ENTRA: stock en rotación comercial, judicial, TESCAR/demo, Stock B.
 *
 * Nota: el número absoluto puede variar entre módulos según el universo que
 * cada uno mire (todo el stock vs solo pagados vs FNE), pero la DEFINICIÓN de
 * qué es "Capital puente" es siempre esta.
 */

import type { Vehiculo } from "../types";

/** Capital legalmente bloqueado — situación legal, no velocidad comercial. */
export function esJudicial(v: Vehiculo): boolean {
  return v.esJudicial || v.stockAB === "Judicial";
}

/** Capital puente = VPP recibido + en preparación (CPD). Definición única. */
export function esCapitalPuente(v: Vehiculo): boolean {
  return v.naturalezaCapital === "puente";
}

/** Demo / TESCAR — uso comercial, no a la venta directa. */
export function esTescar(v: Vehiculo): boolean {
  return v.esTescar || v.esTescarOperacional;
}

/** Stock B — segunda categoría / reacondicionamiento. */
export function esStockB(v: Vehiculo): boolean {
  return v.esStockB || v.stockAB === "B";
}

/**
 * Segmento operacional de un vehículo (NO judicial — el judicial se filtra
 * aparte antes de llamar a esta función). Mutuamente excluyente.
 *
 * Prioridad: Stock B → TESCAR → Capital puente → En rotación.
 */
export type SegCajaKey = "rotacion" | "puente" | "tescar" | "stockB";

export function segmentoCaja(v: Vehiculo): SegCajaKey {
  if (esStockB(v)) return "stockB";
  if (esTescar(v)) return "tescar";
  if (esCapitalPuente(v)) return "puente";
  return "rotacion";
}
