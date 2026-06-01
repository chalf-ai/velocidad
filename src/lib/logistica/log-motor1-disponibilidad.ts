/**
 * MOTOR 1 · Disponibilidad Comercial (brief V1.0).
 *
 * Mide días entre 1° día Almacenaje en bodega operador (fIngresoApc) y
 * Solicitud de despacho (fSolicitudBodega).
 *
 * Responsable: Sucursal + Comercial (el operador no puede despachar lo
 * que no le piden).
 *
 * Sub-cortes: por tipoSolicitud (VENTA vs VITRINA) — vitrina suele ser
 * más rápida porque no espera a un cliente específico.
 */

import type { LogisticaOperacionVIN } from "./modelo";
import { canonizarTipoSolicitud, type TipoSolicitudCanonico } from "./log-responsables";

const MS_DIA = 86_400_000;

export interface MotorStats {
  /** Cantidad de casos con tramo medible (ambas fechas). */
  n: number;
  mediana: number | null;
  avg: number | null;
  p90: number | null;
  max: number | null;
}

export interface ResultadoMotor1 {
  global: MotorStats;
  porTipo: Record<TipoSolicitudCanonico, MotorStats>;
}

export function calcularMotor1(
  filas: LogisticaOperacionVIN[],
): ResultadoMotor1 {
  const diasGlobal: number[] = [];
  const diasVenta: number[] = [];
  const diasVitrina: number[] = [];

  for (const op of filas) {
    if (!(op.fIngresoApc instanceof Date) || !(op.fSolicitudBodega instanceof Date)) continue;
    const d = (op.fSolicitudBodega.getTime() - op.fIngresoApc.getTime()) / MS_DIA;
    if (d < 0) continue;
    diasGlobal.push(d);
    const tipo = canonizarTipoSolicitud(op.tipoSolicitud);
    if (tipo === "VENTA") diasVenta.push(d);
    else if (tipo === "VITRINA") diasVitrina.push(d);
  }

  return {
    global: stats(diasGlobal),
    porTipo: {
      VENTA: stats(diasVenta),
      VITRINA: stats(diasVitrina),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers estadísticos (compartidos por motores 1 y 2)
// ─────────────────────────────────────────────────────────────────────────────

export function stats(xs: number[]): MotorStats {
  if (xs.length === 0) {
    return { n: 0, mediana: null, avg: null, p90: null, max: null };
  }
  const sorted = [...xs].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    mediana: percentil(sorted, 0.5),
    avg: sum / sorted.length,
    p90: percentil(sorted, 0.9),
    max: sorted[sorted.length - 1],
  };
}

function percentil(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(q * sortedAsc.length));
  return sortedAsc[idx];
}
