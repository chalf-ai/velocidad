/**
 * Stock No Disponible — reclasificación del flag oficial Stock A/B = "B".
 *
 * La auditoría (2026-06) demostró que `stockAB === "B"` NO es "Stock B
 * comercial": mezcla varios estados operativos (CPD, traspaso, resciliación,
 * seguros, taller, donantes y Stock B real). Por eso NO se usa en el score de
 * Stock Propio; se gestiona aparte, desglosado por CAUSA según el Estado
 * Dealer oficial (no heurística).
 */

/** Categorías de causa, en orden de presentación. */
export const CAUSAS_STOCK_NO_DISPONIBLE = [
  "No disponible",
  "Traspaso a tercero",
  "Resciliación",
  "Stock B real",
  "Compañía de seguros",
  "Donantes",
  "Taller",
  "Otros",
] as const;

export type CausaStockNoDisponible = (typeof CAUSAS_STOCK_NO_DISPONIBLE)[number];

/** Mapeo Estado Dealer (Base_Stock col 29) → causa operacional. */
const MAPEO: Record<string, CausaStockNoDisponible> = {
  "NO DISPONIBLE": "No disponible",
  "TRASPASO A 3RO": "Traspaso a tercero",
  "RESCILIACION": "Resciliación",
  "RESCILIACIÓN": "Resciliación",
  "STOCK B": "Stock B real",
  "CIA SEGUROS": "Compañía de seguros",
  "DONANTE": "Donantes",
  "EN TALLER": "Taller",
  "EN TALLER LARGO PLAZO": "Taller",
};

/** Clasifica una unidad Stock A/B="B" por su Estado Dealer. Desconocido → "Otros". */
export function causaStockNoDisponible(estadoDealer: string | null | undefined): CausaStockNoDisponible {
  return MAPEO[(estadoDealer ?? "").trim().toUpperCase()] ?? "Otros";
}
