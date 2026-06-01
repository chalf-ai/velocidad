/**
 * MOTOR 3 · Cumplimiento del Operador (brief V1.0).
 *
 * Mide % de despachos cumplidos vs fecha prometida (campo
 * `cumplimientoDespacho` con valores "CUMPLIDO" / "NO CUMPLIDO").
 *
 * Responsable: Operador logístico.
 *
 * Sub-cortes:
 *  · global (KAR + SCHIAPP)
 *  · por operador (KAR / SCHIAPP)
 *  · matriz operador × marca (heatmap)
 */

import type { LogisticaOperacionVIN } from "./modelo";
import type { OperadorLog } from "./log-responsables";

export interface CumplimientoStats {
  /** Cumplidos en el universo. */
  cumplidos: number;
  /** Total con cumplimientoDespacho declarado (CUMPLIDO o NO CUMPLIDO). */
  total: number;
  /** % cumplimiento · null si total = 0. */
  pct: number | null;
}

export interface CeldaMatriz {
  operador: OperadorLog;
  marca: string;
  stats: CumplimientoStats;
}

export interface ResultadoMotor3 {
  global: CumplimientoStats;
  porOperador: Record<OperadorLog, CumplimientoStats>;
  /** Brecha KAR - SCHIAPP (en puntos porcentuales). null si alguno no tiene datos. */
  brechaPp: number | null;
  matriz: CeldaMatriz[];
}

function tally(cumplido: boolean, acc: CumplimientoStats) {
  acc.total++;
  if (cumplido) acc.cumplidos++;
}

function finalize(s: CumplimientoStats): CumplimientoStats {
  return {
    ...s,
    pct: s.total > 0 ? (s.cumplidos / s.total) * 100 : null,
  };
}

export function calcularMotor3(
  filas: LogisticaOperacionVIN[],
  minMatriz = 3,
): ResultadoMotor3 {
  const global: CumplimientoStats = { cumplidos: 0, total: 0, pct: null };
  const porOp: Record<OperadorLog, CumplimientoStats> = {
    KAR: { cumplidos: 0, total: 0, pct: null },
    SCHIAPP: { cumplidos: 0, total: 0, pct: null },
  };
  // operador × marca
  const matriz = new Map<string, CumplimientoStats>(); // key = "OP|MARCA"

  for (const op of filas) {
    const c = (op.cumplimientoDespacho ?? "").toUpperCase().trim();
    if (c !== "CUMPLIDO" && c !== "NO CUMPLIDO") continue;
    const cumplido = c === "CUMPLIDO";
    const operador = op.bodegaOrigen;
    if (operador !== "KAR" && operador !== "SCHIAPP") continue;
    const marca = (op.marca ?? "").toUpperCase().trim() || "—";

    tally(cumplido, global);
    tally(cumplido, porOp[operador]);

    const key = `${operador}|${marca}`;
    let cell = matriz.get(key);
    if (!cell) {
      cell = { cumplidos: 0, total: 0, pct: null };
      matriz.set(key, cell);
    }
    tally(cumplido, cell);
  }

  const matrizArr: CeldaMatriz[] = Array.from(matriz.entries())
    .map(([key, stats]) => {
      const [operador, marca] = key.split("|");
      return {
        operador: operador as OperadorLog,
        marca,
        stats: finalize(stats),
      };
    })
    .filter((c) => c.stats.total >= minMatriz)
    .sort((a, b) => (a.stats.pct ?? 100) - (b.stats.pct ?? 100));

  const gKar = finalize(porOp.KAR);
  const gSchiapp = finalize(porOp.SCHIAPP);
  const brechaPp =
    gKar.pct != null && gSchiapp.pct != null ? gKar.pct - gSchiapp.pct : null;

  return {
    global: finalize(global),
    porOperador: { KAR: gKar, SCHIAPP: gSchiapp },
    brechaPp,
    matriz: matrizArr,
  };
}
