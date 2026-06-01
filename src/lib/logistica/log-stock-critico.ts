/**
 * Stock crítico · DOS familias separadas (decisión usuario 2026-06).
 *
 * Familia A · En bodega sin solicitud
 *   filtro: fIngresoApc != null  &&  fSolicitudBodega == null
 *   responsable: SUCURSAL_COMERCIAL
 *   mide: stock esperando que la sucursal pida despacho.
 *   aging desde: fIngresoApc → hoy.
 *
 * Familia B · Solicitados sin despacho
 *   filtro: fSolicitudBodega != null  &&  fDespacho == null
 *   responsable: OPERADOR
 *   mide: ejecución pendiente del operador.
 *   aging desde: fSolicitudBodega → hoy.
 *
 * No se mezclan: ambas familias tienen su propio universo, su propio
 * aging y sus propias bandas. La sección las muestra una al lado de
 * la otra.
 *
 * Bandas (compartidas por ambas familias):
 *   · 0-30 d     (normal)
 *   · 31-60 d    (atención)
 *   · >60 d      (crítico)
 */

import type { LogisticaOperacionVIN } from "./modelo";
import type { OwnerLog } from "./log-responsables";

const MS_DIA = 86_400_000;

export type FamiliaStock = "sin_solicitud" | "solicitado_sin_despacho";

export interface BandaAging {
  id: "0-30" | "31-60" | ">60";
  label: string;
  min: number; // inclusivo
  max: number | null; // exclusivo · null = sin tope
  filas: LogisticaOperacionVIN[];
}

export interface ResultadoFamilia {
  familia: FamiliaStock;
  /** Texto humano de qué mide. */
  cubre: string;
  /** Owner principal del cuello. */
  owner: OwnerLog;
  /** Total de casos en la familia (suma de bandas). */
  total: number;
  /** Bandas en orden 0-30, 31-60, >60. */
  bandas: BandaAging[];
}

export interface ResultadoStockCritico {
  familias: ResultadoFamilia[];
}

const BANDAS_DEF: Array<{
  id: BandaAging["id"];
  label: string;
  min: number;
  max: number | null;
}> = [
  { id: "0-30", label: "0–30 días", min: 0, max: 31 },
  { id: "31-60", label: "31–60 días", min: 31, max: 61 },
  { id: ">60", label: "> 60 días · crítico", min: 61, max: null },
];

function clasificar(dias: number): BandaAging["id"] | null {
  if (dias < 0) return null;
  if (dias < 31) return "0-30";
  if (dias < 61) return "31-60";
  return ">60";
}

export function calcularStockCritico(
  filas: LogisticaOperacionVIN[],
  hoy: Date = new Date(),
): ResultadoStockCritico {
  // Familia A · en bodega sin solicitud
  const famA: Record<BandaAging["id"], LogisticaOperacionVIN[]> = {
    "0-30": [], "31-60": [], ">60": [],
  };
  // Familia B · solicitado sin despacho
  const famB: Record<BandaAging["id"], LogisticaOperacionVIN[]> = {
    "0-30": [], "31-60": [], ">60": [],
  };

  for (const op of filas) {
    // Familia A
    if (op.fIngresoApc instanceof Date && !(op.fSolicitudBodega instanceof Date)) {
      const dias = (hoy.getTime() - op.fIngresoApc.getTime()) / MS_DIA;
      const banda = clasificar(dias);
      if (banda) famA[banda].push(op);
    }
    // Familia B (mutuamente excluyente con A — si tiene solicitud cae acá si no
    // despachó)
    if (op.fSolicitudBodega instanceof Date && !(op.fDespacho instanceof Date)) {
      const dias = (hoy.getTime() - op.fSolicitudBodega.getTime()) / MS_DIA;
      const banda = clasificar(dias);
      if (banda) famB[banda].push(op);
    }
  }

  const sortFn = (a: LogisticaOperacionVIN, b: LogisticaOperacionVIN) => {
    // Mayor aging primero · usa la fecha de referencia de cada familia
    const ta =
      (a.fIngresoApc?.getTime() ?? a.fSolicitudBodega?.getTime() ?? Number.POSITIVE_INFINITY);
    const tb =
      (b.fIngresoApc?.getTime() ?? b.fSolicitudBodega?.getTime() ?? Number.POSITIVE_INFINITY);
    return ta - tb;
  };
  for (const k of Object.keys(famA) as BandaAging["id"][]) {
    famA[k].sort(sortFn);
    famB[k].sort(sortFn);
  }

  const bandas = (
    src: Record<BandaAging["id"], LogisticaOperacionVIN[]>,
  ): BandaAging[] =>
    BANDAS_DEF.map((b) => ({ ...b, filas: src[b.id] }));

  const familias: ResultadoFamilia[] = [
    {
      familia: "sin_solicitud",
      cubre: "VINs en bodega operador esperando que la sucursal pida despacho.",
      owner: "SUCURSAL_COMERCIAL",
      bandas: bandas(famA),
      total: famA["0-30"].length + famA["31-60"].length + famA[">60"].length,
    },
    {
      familia: "solicitado_sin_despacho",
      cubre: "VINs solicitados a la bodega que aún no se despacharon.",
      owner: "OPERADOR",
      bandas: bandas(famB),
      total: famB["0-30"].length + famB["31-60"].length + famB[">60"].length,
    },
  ];

  return { familias };
}

export const LABEL_FAMILIA: Record<FamiliaStock, string> = {
  sin_solicitud: "En bodega sin solicitud",
  solicitado_sin_despacho: "Solicitados sin despacho",
};
