/**
 * TESCAR operacional — capa de capital de trabajo sobre la fuente oficial
 * "Control TestCars" (TEST CARS + BDR). Atribuye por MARCA originadora (col A),
 * nunca a USADOS. TESCAR consume capital de trabajo aunque esté financiado.
 *
 * Pura: no toca score ni Base_Stock. Renting/company/VDR ya quedaron fuera en el
 * parser (solo entran TEST CARS + BDR).
 */

import type { TescarControlRow } from "../types";
import { normalizarMarcaOperacional } from "./owner-operacional";

export interface TescarMarcaRow {
  marca: string; // marca operacional normalizada
  unidades: number;
  capital: number;
  agingPromedio: number;
  mas180: number;
  capitalCritico: number; // capital de los >180d
  rows: TescarControlRow[];
}

export interface TescarConteo {
  label: string;
  n: number;
}

export interface TescarStats {
  totalUnidades: number;
  capitalTotal: number;
  agingPromedio: number;
  mas60: number;
  mas180: number;
  capitalCritico: number;
  testCars: number;
  bdr: number;
  porMarca: TescarMarcaRow[];
  porStatus: TescarConteo[];
  porDecision: TescarConteo[];
  rows: TescarControlRow[];
}

const conteo = (rows: TescarControlRow[], pick: (r: TescarControlRow) => string | null): TescarConteo[] => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = (pick(r) ?? "—").trim() || "—";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
};

/**
 * Estadísticas TESCAR. Si `marca` se pasa (filtro global), restringe a esa marca
 * operacional (col A normalizada). Aging desde `diasPrestamo`.
 */
export function tescarStats(rowsAll: TescarControlRow[], marca?: string | null): TescarStats {
  const rows = marca
    ? rowsAll.filter((r) => normalizarMarcaOperacional(r.marca) === normalizarMarcaOperacional(marca))
    : rowsAll;

  const capitalTotal = rows.reduce((s, r) => s + (r.valorCompra || 0), 0);
  const conDias = rows.filter((r) => r.diasPrestamo != null);
  const agingPromedio =
    conDias.length > 0
      ? Math.round(conDias.reduce((s, r) => s + (r.diasPrestamo as number), 0) / conDias.length)
      : 0;
  const mas60 = rows.filter((r) => (r.diasPrestamo ?? 0) > 60).length;
  const mas180 = rows.filter((r) => (r.diasPrestamo ?? 0) > 180).length;
  const capitalCritico = rows
    .filter((r) => (r.diasPrestamo ?? 0) > 180)
    .reduce((s, r) => s + (r.valorCompra || 0), 0);

  // Por marca operacional.
  const map = new Map<string, TescarControlRow[]>();
  for (const r of rows) {
    const k = normalizarMarcaOperacional(r.marca);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  const porMarca: TescarMarcaRow[] = [...map.entries()]
    .map(([m, rs]) => {
      const cd = rs.filter((r) => r.diasPrestamo != null);
      return {
        marca: m,
        unidades: rs.length,
        capital: rs.reduce((s, r) => s + (r.valorCompra || 0), 0),
        agingPromedio:
          cd.length > 0 ? Math.round(cd.reduce((s, r) => s + (r.diasPrestamo as number), 0) / cd.length) : 0,
        mas180: rs.filter((r) => (r.diasPrestamo ?? 0) > 180).length,
        capitalCritico: rs
          .filter((r) => (r.diasPrestamo ?? 0) > 180)
          .reduce((s, r) => s + (r.valorCompra || 0), 0),
        rows: rs.sort((a, b) => (b.diasPrestamo ?? 0) - (a.diasPrestamo ?? 0)),
      };
    })
    .sort((a, b) => b.capital - a.capital);

  return {
    totalUnidades: rows.length,
    capitalTotal,
    agingPromedio,
    mas60,
    mas180,
    capitalCritico,
    testCars: rows.filter((r) => r.tipo === "test_car").length,
    bdr: rows.filter((r) => r.tipo === "bdr").length,
    porMarca,
    porStatus: conteo(rows, (r) => r.status),
    porDecision: conteo(rows, (r) => r.decisionVenta),
    rows: [...rows].sort((a, b) => (b.diasPrestamo ?? 0) - (a.diasPrestamo ?? 0)),
  };
}
