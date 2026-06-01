/**
 * Filtro temporal del módulo Control de Negocio.
 *
 * Capa adicional sobre el filtro de "Mes de factura" — permite acumular
 * varios meses para análisis de tendencia y para que los rankings
 * (que requieren volumen mínimo) tengan datos suficientes.
 *
 * NO modifica `universoCN` ni `cn-quebrados` ni `cn-fne-atribuible` —
 * trabaja como filtro adicional sobre el universo ya recortado por marca
 * y sucursal del Header. El consumidor (page.tsx) aplica este filtro
 * después de obtener el universo base.
 */

import type { EntradaConsolidada } from "../historico/cruce-roma-actas";
import type {
  MesFacturaKey,
  MesFacturaOption,
} from "../historico/vista-derivados";

export type ModoPeriodo = "mes" | "3m" | "6m" | "12m" | "todo";

export const LABEL_MODO: Record<ModoPeriodo, string> = {
  mes: "Mes seleccionado",
  "3m": "Últimos 3 meses",
  "6m": "Últimos 6 meses",
  "12m": "Últimos 12 meses",
  todo: "Todo el histórico",
};

/** Cuántos meses acumula cada modo. `null` = todos / sin acumulación. */
const MESES_ACUMULADOS: Record<ModoPeriodo, number | null> = {
  mes: 1,
  "3m": 3,
  "6m": 6,
  "12m": 12,
  todo: null,
};

/**
 * Lista de mesKey que entran al universo final, dado un modo + mes de
 * referencia. Toma el mes de referencia como el más reciente del rango y
 * cuenta hacia atrás N meses dentro de `opcionesDisponibles`.
 *
 *   modo "mes"  + mesRef "2026-05" → ["2026-05"]
 *   modo "3m"   + mesRef "2026-05" → ["2026-05", "2026-04", "2026-03"]
 *   modo "todo" → todas las opciones
 *
 * Si `opcionesDisponibles` no contiene el mesRef (porque el filtro global
 * lo dejó vacío), se toma el más reciente disponible.
 */
export function calcularMesesIncluidos(
  opciones: MesFacturaOption[],
  mesRef: MesFacturaKey | null,
  modo: ModoPeriodo,
): MesFacturaKey[] {
  if (opciones.length === 0) return [];
  if (modo === "todo") return opciones.map((o) => o.key);

  // mesRef efectivo · si no está en opciones, el más reciente.
  const refKey =
    mesRef && opciones.some((o) => o.key === mesRef)
      ? mesRef
      : opciones[0].key;

  const idxRef = opciones.findIndex((o) => o.key === refKey);
  if (idxRef === -1) return [];

  const n = MESES_ACUMULADOS[modo];
  if (n == null) return opciones.map((o) => o.key);

  // `opciones` viene ordenada desc (más reciente primero) — tomamos
  // [idxRef, idxRef + n) que son los N meses incluyendo el ref hacia atrás.
  return opciones.slice(idxRef, idxRef + n).map((o) => o.key);
}

/**
 * Filtra `filas` para que solo queden las cuyo mes de factura está en el
 * set de mesKeys incluidos. Usa la representación canónica YYYY-MM.
 */
export function filtrarPorPeriodo(
  filas: EntradaConsolidada[],
  mesesIncluidos: MesFacturaKey[],
): EntradaConsolidada[] {
  if (mesesIncluidos.length === 0) return [];
  const set = new Set(mesesIncluidos);
  return filas.filter((f) => {
    const d = f.fFactura;
    if (!(d instanceof Date)) return false;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return set.has(`${y}-${m}`);
  });
}

/** Label para presentación · "Mayo 2026" o "Mayo 2026 → Marzo 2026" para rangos. */
export function labelPeriodoActivo(
  opciones: MesFacturaOption[],
  mesesIncluidos: MesFacturaKey[],
  modo: ModoPeriodo,
): string {
  if (mesesIncluidos.length === 0) return "Sin datos";
  if (modo === "todo") {
    return `Todo el histórico · ${mesesIncluidos.length} meses`;
  }
  if (mesesIncluidos.length === 1) {
    return opciones.find((o) => o.key === mesesIncluidos[0])?.label ?? mesesIncluidos[0];
  }
  const first = opciones.find((o) => o.key === mesesIncluidos[0])?.label ?? mesesIncluidos[0];
  const last =
    opciones.find((o) => o.key === mesesIncluidos[mesesIncluidos.length - 1])?.label ??
    mesesIncluidos[mesesIncluidos.length - 1];
  return `${last} → ${first} · ${mesesIncluidos.length} meses`;
}
