/**
 * Parser de "3.-Lineas de Credito".
 *
 * El layout es ancho y tiene varios bloques. El bloque PRINCIPAL ocupa
 * columnas 7-12 (1-based) con encabezado en fila 1:
 *   col7 = MARCA  col8 = Linea Autorizada  col9 = Linea Ocupada
 *   col10 = Linea Libre  col11 = Plazo pago FP  col12 = Fecha de Calculo
 *
 * Los datos parten en fila 2 y van por ~12 marcas. Hay bloques secundarios
 * a la derecha (IMPORTADORA, etc.) que IGNORAMOS en MVP — solo nos importa
 * la vista por marca.
 */

import type { WorkSheet } from "xlsx";
import * as XLSX from "xlsx";
import type { LineaCredito, ParseIssue, Semaforo, SheetReport } from "../types";
import { canonicalMarca, parseDate, toNumber } from "./normalize";

function semaforoFor(ocupacion: number, libre: number): Semaforo {
  if (libre < 0 || ocupacion > 1) return "sobregirada";
  if (ocupacion > 0.9) return "rojo";
  if (ocupacion >= 0.8) return "amarillo";
  return "verde";
}

interface ParseLineasResult {
  lineas: LineaCredito[];
  report: SheetReport;
  issues: ParseIssue[];
  fechaCalculo: Date | null;
}

export function parseLineasCredito(
  ws: WorkSheet,
  auxFinanciera: Map<string, { financiera: string | null; diasLibres: number | null }>,
): ParseLineasResult {
  const issues: ParseIssue[] = [];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });

  // Detectar fecha de calculo (suele venir en r1 col12-13 como "Fecha de Calculo")
  let fechaCalculo: Date | null = null;
  for (const row of matrix.slice(0, 5)) {
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c++) {
      if (String(row[c]).toLowerCase().includes("fecha de calculo")) {
        const v = row[c + 1];
        const d = parseDate(v);
        if (d) {
          fechaCalculo = d;
          break;
        }
      }
    }
    if (fechaCalculo) break;
  }

  const lineas: LineaCredito[] = [];

  // Detectar header del bloque principal (columna donde está "MARCA" o
  // donde la fila contiene "Linea Autorizada", "Linea Ocupada", "Linea Libre")
  let headerRow = -1;
  let colMarca = -1;
  let colAut = -1;
  let colOcu = -1;
  let colLib = -1;
  let colPlazo = -1;

  for (let r = 0; r < Math.min(matrix.length, 5); r++) {
    const row = matrix[r];
    if (!Array.isArray(row)) continue;
    let foundAut = -1, foundOcu = -1, foundLib = -1, foundPlazo = -1;
    for (let c = 0; c < row.length; c++) {
      const v = String(row[c] ?? "").toLowerCase().trim();
      if (v === "linea autorizada") foundAut = c;
      if (v === "linea ocupada") foundOcu = c;
      if (v === "linea libre") foundLib = c;
      if (v.startsWith("plazo pago")) foundPlazo = c;
    }
    if (foundAut >= 0 && foundOcu >= 0 && foundLib >= 0) {
      // bloque principal — marca en columna anterior a "Linea Autorizada"
      headerRow = r;
      colMarca = foundAut - 1;
      colAut = foundAut;
      colOcu = foundOcu;
      colLib = foundLib;
      colPlazo = foundPlazo;
      break;
    }
  }

  if (headerRow < 0) {
    return {
      lineas: [],
      fechaCalculo,
      issues: [
        {
          hoja: "3.-Lineas de Credito",
          fila: 1,
          tipo: "valor_no_numerico",
          mensaje: "No se encontró bloque principal (columnas Linea Autorizada/Ocupada/Libre).",
        },
      ],
      report: {
        nombre: "3.-Lineas de Credito",
        filasTotales: matrix.length,
        filasProcesadas: 0,
        filasOmitidas: matrix.length,
        columnasDetectadas: [],
        columnasEsperadas: ["MARCA", "Linea Autorizada", "Linea Ocupada", "Linea Libre"],
        columnasFaltantes: ["MARCA", "Linea Autorizada", "Linea Ocupada", "Linea Libre"],
        estado: "error",
        mensaje: "Layout no detectado",
      },
    };
  }

  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!Array.isArray(row)) continue;
    const marcaRaw = row[colMarca];
    if (!marcaRaw) continue;
    const marca = String(marcaRaw).trim();
    if (!marca || marca.toLowerCase().includes("total")) continue;

    // Validación: marca debe ser texto, no número ni código basura.
    // Filtra filas como "19791001", "63873001", etc.
    if (/^\d+$/.test(marca)) continue; // solo números
    if (marca.length < 2) continue;
    if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(marca)) continue; // sin letras

    const autorizada = toNumber(row[colAut]) ?? 0;
    const ocupada = toNumber(row[colOcu]) ?? 0;
    const libre = toNumber(row[colLib]) ?? (autorizada - ocupada);
    const plazo = colPlazo >= 0 ? toNumber(row[colPlazo]) : null;

    if (autorizada === 0 && ocupada === 0) continue;

    const ocupacion = autorizada > 0 ? ocupada / autorizada : 0;
    const { canon } = canonicalMarca(marca);
    const aux = canon ? auxFinanciera.get(canon) : undefined;

    lineas.push({
      marca,
      marcaPompeyo: canon ?? null,
      financiera: aux?.financiera ?? null,
      diasLibres: aux?.diasLibres ?? null,
      plazoPagoFP: plazo,
      lineaAutorizada: autorizada,
      lineaOcupada: ocupada,
      lineaLibre: libre,
      porcentajeOcupacion: ocupacion,
      semaforo: semaforoFor(ocupacion, libre),
      fechaCalculo,
      rowIndex: r + 1,
    });
  }

  const report: SheetReport = {
    nombre: "3.-Lineas de Credito",
    filasTotales: matrix.length,
    filasProcesadas: lineas.length,
    filasOmitidas: matrix.length - lineas.length,
    columnasDetectadas: ["MARCA", "Linea Autorizada", "Linea Ocupada", "Linea Libre", "Plazo"],
    columnasEsperadas: ["MARCA", "Linea Autorizada", "Linea Ocupada", "Linea Libre"],
    columnasFaltantes: [],
    estado: lineas.length > 0 ? "ok" : "parcial",
  };

  return { lineas, fechaCalculo, issues, report };
}

export function parseAuxFinanciera(
  ws: WorkSheet,
): Map<string, { financiera: string | null; diasLibres: number | null }> {
  const result = new Map<string, { financiera: string | null; diasLibres: number | null }>();
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    raw: true,
    defval: null,
    blankrows: false,
  });
  const rows = rawRows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) out[k.trim()] = v;
    return out;
  });
  for (const r of rows) {
    const marca = r["MARCA"];
    if (!marca) continue;
    const { canon } = canonicalMarca(String(marca));
    if (!canon) continue;
    result.set(canon, {
      financiera: r["FINANCIERA"] ? String(r["FINANCIERA"]) : null,
      diasLibres: toNumber(r["Dias Libres"]),
    });
  }
  return result;
}
