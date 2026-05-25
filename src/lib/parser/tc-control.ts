/**
 * Parser ligero de "TC CONTROL" — solo extrae el set de VINs para cruzar con
 * Base_Stock. La hoja tiene 31 columnas con info histórica detallada (Osvaldo);
 * en MVP solo necesitamos saber si un VIN aparece ahí.
 *
 * Importante: 188 de 271 VINs en TC CONTROL ya NO están en stock actual
 * (TESCAR vendidos / retirados / históricos). Solo enriquecemos cuando hay
 * cruce real con Base_Stock.
 */

import type { WorkSheet } from "xlsx";
import * as XLSX from "xlsx";
import type { SheetReport } from "../types";

export function parseTcControl(ws: WorkSheet): { vins: Set<string>; report: SheetReport } {
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    raw: true,
    defval: null,
    blankrows: false,
  });
  // Trim header keys
  const rows = rawRows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) o[k.trim()] = v;
    return o;
  });

  const vins = new Set<string>();
  for (const r of rows) {
    const v = r["Numero VIN"];
    if (v) vins.add(String(v).trim());
  }

  const report: SheetReport = {
    nombre: "TC CONTROL",
    filasTotales: rows.length,
    filasProcesadas: vins.size,
    filasOmitidas: rows.length - vins.size,
    columnasDetectadas: ["Numero VIN"],
    columnasEsperadas: ["Numero VIN"],
    columnasFaltantes: [],
    estado: vins.size > 0 ? "ok" : "parcial",
    mensaje: `${vins.size} VINs únicos — usado para enriquecer TESCAR operacional`,
  };

  return { vins, report };
}
