/**
 * Rankings de Logística:
 *   · Sucursales con peor M1 (Almacén → Solicitud)
 *   · Marcas críticas con peor M3 (Cumplimiento)
 *
 * Mínimos dinámicos para evitar rankings sobre 2 casos (mismo patrón que CN).
 */

import type { LogisticaOperacionVIN } from "./modelo";
import { stats, type MotorStats } from "./log-motor1-disponibilidad";

const MS_DIA = 86_400_000;

export interface RankingSucursalM1 {
  sucursal: string;
  stats: MotorStats;
  /** Cuántos VINs hay en la sucursal en total (denominador del contexto). */
  totalVins: number;
}

export interface RankingMarcaM3 {
  marca: string;
  cumplidos: number;
  total: number;
  pct: number;
  /** Top operador asociado a esos casos (KAR | SCHIAPP) — el peor cumplimiento. */
  operadorDominante: "KAR" | "SCHIAPP" | "MIXTO";
}

export function rankingSucursalesPeorM1(
  filas: LogisticaOperacionVIN[],
  opts: { topN?: number; minN?: number } = {},
): RankingSucursalM1[] {
  const { topN = 10, minN = 5 } = opts;
  const bySuc = new Map<string, { dias: number[]; total: number }>();
  for (const op of filas) {
    const suc = (op.sucursalDestino ?? "—").trim() || "—";
    let acc = bySuc.get(suc);
    if (!acc) {
      acc = { dias: [], total: 0 };
      bySuc.set(suc, acc);
    }
    acc.total++;
    if (op.fIngresoApc instanceof Date && op.fSolicitudBodega instanceof Date) {
      const d = (op.fSolicitudBodega.getTime() - op.fIngresoApc.getTime()) / MS_DIA;
      if (d >= 0) acc.dias.push(d);
    }
  }
  return Array.from(bySuc.entries())
    .map(([sucursal, acc]) => ({
      sucursal,
      stats: stats(acc.dias),
      totalVins: acc.total,
    }))
    .filter((r) => r.stats.n >= minN)
    .sort((a, b) => (b.stats.mediana ?? 0) - (a.stats.mediana ?? 0))
    .slice(0, topN);
}

export function rankingMarcasCriticasM3(
  filas: LogisticaOperacionVIN[],
  opts: { topN?: number; minN?: number; umbralPct?: number } = {},
): RankingMarcaM3[] {
  const { topN = 10, minN = 5, umbralPct = 80 } = opts;
  type Acc = {
    cumplidos: number;
    total: number;
    porOperador: Record<"KAR" | "SCHIAPP", number>;
  };
  const byMarca = new Map<string, Acc>();
  for (const op of filas) {
    const c = (op.cumplimientoDespacho ?? "").toUpperCase().trim();
    if (c !== "CUMPLIDO" && c !== "NO CUMPLIDO") continue;
    const marca = (op.marca ?? "").toUpperCase().trim() || "—";
    let acc = byMarca.get(marca);
    if (!acc) {
      acc = { cumplidos: 0, total: 0, porOperador: { KAR: 0, SCHIAPP: 0 } };
      byMarca.set(marca, acc);
    }
    acc.total++;
    if (c === "CUMPLIDO") acc.cumplidos++;
    if (op.bodegaOrigen === "KAR" || op.bodegaOrigen === "SCHIAPP") {
      acc.porOperador[op.bodegaOrigen]++;
    }
  }
  return Array.from(byMarca.entries())
    .filter(([, a]) => a.total >= minN)
    .map(([marca, a]) => {
      const pct = (a.cumplidos / a.total) * 100;
      const dom =
        a.porOperador.KAR > a.porOperador.SCHIAPP * 2
          ? "KAR"
          : a.porOperador.SCHIAPP > a.porOperador.KAR * 2
            ? "SCHIAPP"
            : "MIXTO";
      return {
        marca,
        cumplidos: a.cumplidos,
        total: a.total,
        pct,
        operadorDominante: dom as "KAR" | "SCHIAPP" | "MIXTO",
      };
    })
    .filter((r) => r.pct < umbralPct)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, topN);
}
