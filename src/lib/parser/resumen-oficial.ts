/**
 * Parser de "Resumen Stock Propio" — referencia oficial de gestión.
 *
 * Robustez:
 *   1) NO asumimos que la hoja arranque en A1. Leemos sheet["!ref"] y nos
 *      movemos celda a celda dentro de ese rango.
 *   2) NO asumimos índices fijos para "Inventario / Activo Fijo / Total".
 *      Detectamos el header buscando esas tres etiquetas en alguna fila.
 *   3) Reportamos merges (aunque en la versión actual del Excel no hay).
 *   4) Generamos cellDump completo para la pantalla de debug.
 *   5) Mapeamos cada fila a un ResumenBlock conocido por contenido del label,
 *      no por posición.
 *
 * Estructura observada (Excel mayo 2026):
 *   Range: B2:E7, sin merges
 *   r2: header  "" | "Inventario" | "Activo Fijo" | "Total"
 *   r3: "Stock A en vitrinas / Test Cars Propios"
 *   r4: "Stock A por facturar"
 *   r5: "Stock B"
 *   r6: "Stock Judicial"
 *   r7: totales (sin label en col B)
 */

import type { WorkSheet, CellObject } from "xlsx";
import * as XLSX from "xlsx";
import type {
  ResumenBlock,
  ResumenBlockKey,
  ResumenCellDump,
  ResumenOficial,
  SheetReport,
} from "../types";

interface ParseResumenResult {
  resumen: ResumenOficial | null;
  report: SheetReport;
}

function toNumberLoose(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/[$.,\s]/g, "").replace(/,/g, "."));
  return Number.isFinite(n) ? n : 0;
}

function classifyLabel(rawLabel: string): ResumenBlockKey | null {
  const l = rawLabel.toLowerCase();
  if (l.includes("vitrina") || l.includes("test car")) return "stockAVitrinas";
  if (l.includes("por facturar")) return "stockAPorFacturar";
  if (l.includes("stock b") || l === "b") return "stockB";
  if (l.includes("judicial")) return "stockJudicial";
  return null;
}

export function parseResumenOficial(ws: WorkSheet): ParseResumenResult {
  if (!ws["!ref"]) {
    return {
      resumen: null,
      report: {
        nombre: "Resumen Stock Propio",
        filasTotales: 0,
        filasProcesadas: 0,
        filasOmitidas: 0,
        columnasDetectadas: [],
        columnasEsperadas: ["Inventario", "Activo Fijo", "Total"],
        columnasFaltantes: ["Inventario", "Activo Fijo", "Total"],
        estado: "error",
        mensaje: "Hoja sin rango (!ref) — vacía o corrupta",
      },
    };
  }

  const range = XLSX.utils.decode_range(ws["!ref"]);
  const sheetRef = ws["!ref"];

  // 1) Cell dump completo (para la pantalla de debug)
  const cellDump: ResumenCellDump[] = [];
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr] as CellObject | undefined;
      cellDump.push({
        addr,
        row: R + 1,
        col: C + 1,
        colLetter: XLSX.utils.encode_col(C),
        type: cell?.t ?? "empty",
        value: cell ? (cell.v ?? null) : null,
        formatted: cell?.w ?? null,
      });
    }
  }

  // 2) Merges
  const merges = (ws["!merges"] ?? []).map((m) => ({
    s: XLSX.utils.encode_cell(m.s),
    e: XLSX.utils.encode_cell(m.e),
  }));

  // 3) Detectar fila de header buscando "Inventario", "Activo Fijo", "Total"
  let headerRow: number | null = null;
  let colInventario = -1;
  let colActivoFijo = -1;
  let colTotal = -1;
  let colLabel = range.s.c; // por defecto la primera columna del rango

  const labelMatches = (s: string, ...needles: string[]) => {
    const u = s.toLowerCase();
    return needles.every((n) => u.includes(n));
  };

  for (let R = range.s.r; R <= range.e.r; R++) {
    let foundInv = -1, foundAF = -1, foundTot = -1;
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })] as CellObject | undefined;
      const v = String(cell?.v ?? "").trim();
      if (!v) continue;
      if (foundInv < 0 && labelMatches(v, "inventario")) foundInv = C;
      if (foundAF < 0 && labelMatches(v, "activo", "fijo")) foundAF = C;
      if (foundTot < 0 && v.toLowerCase() === "total") foundTot = C;
    }
    if (foundInv >= 0 && foundTot >= 0) {
      headerRow = R + 1;
      colInventario = foundInv;
      colTotal = foundTot;
      if (foundAF >= 0) colActivoFijo = foundAF;
      // Label column: primera columna a la izquierda del header de Inventario
      colLabel = foundInv - 1;
      if (colLabel < range.s.c) colLabel = range.s.c;
      break;
    }
  }

  const headerCells: string[] = [];
  if (headerRow !== null) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: headerRow - 1, c: C })] as CellObject | undefined;
      headerCells.push(String(cell?.v ?? "").trim());
    }
  }

  // 4) Extraer bloques fila a fila
  const bloques: ResumenBlock[] = [];
  let totalRow: ResumenBlock | null = null;

  if (headerRow !== null) {
    for (let R = headerRow; R <= range.e.r; R++) {
      // header está en headerRow-1 (índice 0-based), datos arrancan en headerRow
      const labelCell = ws[XLSX.utils.encode_cell({ r: R, c: colLabel })] as CellObject | undefined;
      const invCell = ws[XLSX.utils.encode_cell({ r: R, c: colInventario })] as CellObject | undefined;
      const afCell = colActivoFijo >= 0
        ? (ws[XLSX.utils.encode_cell({ r: R, c: colActivoFijo })] as CellObject | undefined)
        : undefined;
      const totCell = ws[XLSX.utils.encode_cell({ r: R, c: colTotal })] as CellObject | undefined;

      const rawLabel = String(labelCell?.v ?? "").trim();
      const inv = toNumberLoose(invCell?.v);
      const af = toNumberLoose(afCell?.v);
      const tot = toNumberLoose(totCell?.v);

      // Saltar filas completamente vacías
      if (!rawLabel && !inv && !af && !tot) continue;

      const labelAddr = XLSX.utils.encode_cell({ r: R, c: colLabel });
      const cells = {
        inventario: XLSX.utils.encode_cell({ r: R, c: colInventario }),
        activoFijo: colActivoFijo >= 0 ? XLSX.utils.encode_cell({ r: R, c: colActivoFijo }) : "—",
        total: XLSX.utils.encode_cell({ r: R, c: colTotal }),
      };

      if (rawLabel) {
        const key = classifyLabel(rawLabel);
        if (key) {
          bloques.push({
            key,
            label: rawLabel,
            labelCell: labelAddr,
            inventario: inv,
            activoFijo: af,
            total: tot,
            cells,
          });
        } else {
          // fila con label que no clasificamos — log raro pero no romper
          bloques.push({
            key: "total" as ResumenBlockKey, // fallback
            label: rawLabel,
            labelCell: labelAddr,
            inventario: inv,
            activoFijo: af,
            total: tot,
            cells,
          });
        }
      } else if (inv || af || tot) {
        // fila sin label pero con números → totales
        totalRow = {
          key: "total",
          label: "(Total general)",
          labelCell: labelAddr,
          inventario: inv,
          activoFijo: af,
          total: tot,
          cells,
        };
      }
    }
  }

  // Helpers
  const get = (k: ResumenBlockKey) => bloques.find((b) => b.key === k);
  const sa = get("stockAVitrinas");
  const sf = get("stockAPorFacturar");
  const sb = get("stockB");
  const sj = get("stockJudicial");

  const sumInv = bloques
    .filter((b) => b.key !== "total")
    .reduce((s, b) => s + b.inventario, 0);
  const sumAF = bloques
    .filter((b) => b.key !== "total")
    .reduce((s, b) => s + b.activoFijo, 0);
  const sumTot = bloques
    .filter((b) => b.key !== "total")
    .reduce((s, b) => s + b.total, 0);

  const resumen: ResumenOficial = {
    bloques: bloques.filter((b) => b !== totalRow),
    totalRow,
    sheetRef,
    rowStart: range.s.r + 1,
    rowEnd: range.e.r + 1,
    colStart: range.s.c + 1,
    colEnd: range.e.c + 1,
    merges,
    headerRow,
    headerCells,
    cellDump,
    fechaCalculo: null,

    stockAVitrinasInventario: sa?.inventario ?? 0,
    stockAVitrinasActivoFijo: sa?.activoFijo ?? 0,
    stockAVitrinasTotal: sa?.total ?? 0,
    stockAPorFacturar: sf?.total ?? sf?.inventario ?? 0,
    stockB: sb?.total ?? sb?.inventario ?? 0,
    stockJudicial: sj?.total ?? sj?.inventario ?? 0,

    granTotalInventario: totalRow?.inventario ?? sumInv,
    granTotalActivoFijo: totalRow?.activoFijo ?? sumAF,
    granTotalVendible: totalRow?.total ?? sumTot,
  };

  const ok = bloques.length >= 4 && headerRow !== null;
  const report: SheetReport = {
    nombre: "Resumen Stock Propio",
    filasTotales: range.e.r - range.s.r + 1,
    filasProcesadas: bloques.length + (totalRow ? 1 : 0),
    filasOmitidas: 0,
    columnasDetectadas: headerCells.filter(Boolean),
    columnasEsperadas: ["Inventario", "Activo Fijo", "Total"],
    columnasFaltantes: [
      colInventario < 0 && "Inventario",
      colActivoFijo < 0 && "Activo Fijo",
      colTotal < 0 && "Total",
    ].filter(Boolean) as string[],
    estado: ok ? "ok" : "parcial",
    mensaje: ok
      ? undefined
      : headerRow === null
        ? "No se encontró fila de header con 'Inventario'/'Activo Fijo'/'Total'"
        : `Solo ${bloques.length} bloques detectados (esperaban ≥4)`,
  };

  return { resumen, report };
}
