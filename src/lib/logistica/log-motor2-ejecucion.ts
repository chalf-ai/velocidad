/**
 * MOTOR 2 · Ejecución del Operador (brief V1.0).
 *
 * Mide días entre Solicitud (fSolicitudBodega) y Despacho efectivo
 * (fDespacho).
 *
 * Responsable: Operador logístico (SCHIAPP o KAR).
 *
 * Sub-cortes: por bodegaOrigen (KAR vs SCHIAPP).
 */

import type { LogisticaOperacionVIN } from "./modelo";
import { stats, type MotorStats } from "./log-motor1-disponibilidad";
import type { OperadorLog } from "./log-responsables";

const MS_DIA = 86_400_000;

export interface ResultadoMotor2 {
  global: MotorStats;
  porOperador: Record<OperadorLog, MotorStats>;
}

export function calcularMotor2(
  filas: LogisticaOperacionVIN[],
): ResultadoMotor2 {
  const diasGlobal: number[] = [];
  const diasKar: number[] = [];
  const diasSchiapp: number[] = [];

  for (const op of filas) {
    if (!(op.fSolicitudBodega instanceof Date) || !(op.fDespacho instanceof Date)) continue;
    const d = (op.fDespacho.getTime() - op.fSolicitudBodega.getTime()) / MS_DIA;
    if (d < 0) continue;
    diasGlobal.push(d);
    if (op.bodegaOrigen === "KAR") diasKar.push(d);
    else if (op.bodegaOrigen === "SCHIAPP") diasSchiapp.push(d);
  }

  return {
    global: stats(diasGlobal),
    porOperador: {
      KAR: stats(diasKar),
      SCHIAPP: stats(diasSchiapp),
    },
  };
}
