/**
 * Caja Inmovilizada · composición ACTUAL en vivo (para /tendencias).
 *
 * Lee los Snapshot vigentes (activo: true) — la MISMA fuente de verdad que el
 * resto del sistema — y recompone el desglose de la Caja Inmovilizada Total con
 * los selectores oficiales (capital-trabajo.ts). READ-ONLY: no escribe nada, no
 * toca DailyCapitalSnapshot ni la generación diaria (PR 2). Cuando PR 2 persista
 * estos campos a diario, el desglose pasará a ser también serie histórica.
 */

import { prisma } from "@/lib/prisma";
import type { Fuente } from "@prisma/client";
import {
  rehidratarStock,
  rehidratarSaldos,
  rehidratarFNE,
} from "@/lib/historico/calcular-score-gerencial-historico";
import {
  desgloseCajaDesdePayloads,
  type DesgloseCajaCorte,
} from "@/lib/historico/capital-por-corte";

export interface CajaInmovilizadaActual {
  desglose: DesgloseCajaCorte;
  /** Fecha de corte del stock vigente (ISO) — null si el snapshot no la trae. */
  fechaCorte: string | null;
}

async function snapshotVigente(fuente: Fuente) {
  return prisma.snapshot.findFirst({
    where: { fuente, activo: true },
    orderBy: { createdAt: "desc" },
    select: { payload: true, fechaCorte: true },
  });
}

/**
 * Desglose de la Caja Inmovilizada para el scope pedido (marca = null → TOTAL).
 * Devuelve null si no hay BASE_STOCK vigente.
 */
export async function cargarCajaInmovilizadaActual(
  marca: string | null,
): Promise<CajaInmovilizadaActual | null> {
  const [stockSnap, fneSnap, saldosSnap] = await Promise.all([
    snapshotVigente("BASE_STOCK"),
    snapshotVigente("FNE"),
    snapshotVigente("SALDOS"),
  ]);
  if (!stockSnap?.payload) return null;

  const stock = rehidratarStock(stockSnap.payload);
  const fne = fneSnap?.payload ? rehidratarFNE(fneSnap.payload) : null;
  const saldos = saldosSnap?.payload ? rehidratarSaldos(saldosSnap.payload) : null;

  const desglose = desgloseCajaDesdePayloads({ stock, saldos, fne, marca });
  if (!desglose) return null;

  return { desglose, fechaCorte: stockSnap.fechaCorte?.toISOString() ?? null };
}
