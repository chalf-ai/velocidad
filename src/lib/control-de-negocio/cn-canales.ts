/**
 * Clasificador de canal (Retail / Flotas / Oficinas) a partir del texto de
 * la sucursal — brief §10.
 *
 * Reglas (en orden):
 *  · Si la sucursal contiene USADOS / MAYORISTA / LIQUIDA → EXCLUIDO (no es CN).
 *    (Estos nunca deberían llegar a CN porque cn-universo.ts los filtra antes,
 *     pero el clasificador es defensivo y los marca explícitamente.)
 *  · Si contiene FLOTAS → FLOTAS.
 *  · Si contiene OFICINA → OFICINAS.
 *  · Sucursales en SUCURSAL_NO_INFERIBLE del parser (CPD, LOGISTICA, SEMINUEVO,
 *    AUTOSHOPPING, TEST CARS, VN CON PATENTE) → OTROS (no son retail puro).
 *  · Resto → RETAIL.
 *
 * No mezclar canales en las medianas/rankings: cada canal tiene su propio
 * universo, su propio cumplimiento, su propio FNE.
 */

export type Canal = "RETAIL" | "FLOTAS" | "OFICINAS" | "OTROS" | "EXCLUIDO";

const NO_INFERIBLES = [
  "LOGISTICA POMPEYO",
  "SEMINUEVOS",
  "AUTOSHOPPING",
  "TEST CARS",
  "VN CON PATENTE",
  "CPD",
];

export function clasificarCanal(sucursal: string | null | undefined): Canal {
  if (!sucursal) return "OTROS";
  const u = String(sucursal).toUpperCase();
  if (u.includes("USADOS") || u.includes("MAYORISTA") || u.includes("LIQUIDA")) {
    return "EXCLUIDO";
  }
  if (u.includes("FLOTAS")) return "FLOTAS";
  if (u.includes("OFICINA")) return "OFICINAS";
  if (NO_INFERIBLES.some((n) => u.includes(n))) return "OTROS";
  return "RETAIL";
}

/** ¿La sucursal pertenece al universo de Control de Negocio (Retail nuevos)? */
export function esRetailNuevos(sucursal: string | null | undefined): boolean {
  return clasificarCanal(sucursal) === "RETAIL";
}

export const LABEL_CANAL: Record<Canal, string> = {
  RETAIL:   "Retail",
  FLOTAS:   "Flotas",
  OFICINAS: "Oficinas",
  OTROS:    "Otros",
  EXCLUIDO: "Excluido",
};
