/**
 * DETECTOR DE FUENTE OPERACIONAL · función pura.
 *
 * El Hub de Ingesta recibe cualquier Excel y necesita saber QUÉ es sin depender
 * del nombre del archivo (los nombres cambian). La detección usa la ESTRUCTURA:
 * nombres de hoja + columnas clave de la fila de encabezado.
 *
 * Caso crítico: TRES fuentes distintas traen una hoja llamada "ROMA"
 *   - FNE (Autos no entregados): Vin + Nombre_Cliente + etapa + entrega_auto_txt
 *   - Provisiones:               montoProvision + Concepto + saldo + EstadoAjuste
 *   - Logística ROMA:            VentaID + PasoActual
 * → por eso la detección es por COLUMNAS, nunca por nombre de hoja solamente.
 *
 * No lee filas de datos (solo el encabezado), así que es barata aun en archivos
 * grandes si el workbook se leyó con { sheetRows: 1 }.
 */

import type { WorkBook, WorkSheet } from "xlsx";
import * as XLSX from "xlsx";

export type FuenteTipo =
  | "stock"
  | "fne"
  | "saldos"
  | "provisiones"
  | "logistica_roma"
  | "logistica_stli"
  | "tescar"
  | "desconocido";

export interface FuenteDeteccion {
  tipo: FuenteTipo;
  /** Hoja que disparó la detección (para diagnóstico). */
  hoja: string | null;
  /** Todas las hojas del workbook. */
  hojas: string[];
  /** Explicación legible de por qué se clasificó así. */
  motivo: string;
}

/** Columnas (encabezado) de una hoja, con keys trimmeadas (SALVING trae espacios). */
function columnasDeHoja(ws: WorkSheet): Set<string> {
  const filas = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
  const header = (filas[0] as unknown[] | undefined) ?? [];
  const set = new Set<string>();
  for (const celda of header) {
    if (celda == null) continue;
    const k = String(celda).trim();
    if (k) set.add(k);
  }
  return set;
}

/** Etiqueta legible de cada tipo de fuente. */
export const FUENTE_LABEL: Record<FuenteTipo, string> = {
  stock: "Stock (Base_Stock)",
  fne: "FNE · facturados no entregados",
  saldos: "Saldos / SALVING",
  provisiones: "Provisiones",
  logistica_roma: "Logística ROMA (agenda)",
  logistica_stli: "Logística STLI (bodega)",
  tescar: "Control TestCars / TESCAR",
  desconocido: "Archivo no reconocido",
};

export function detectarFuente(wb: WorkBook): FuenteDeteccion {
  const hojas = wb.SheetNames;
  const cols = new Map<string, Set<string>>();
  for (const n of hojas) cols.set(n, columnasDeHoja(wb.Sheets[n]));

  const tieneHoja = (nombre: string) =>
    hojas.some((h) => h.trim().toLowerCase() === nombre.toLowerCase());
  /** Devuelve la hoja cuyo encabezado contiene TODAS las columnas dadas. */
  const hojaCon = (...requeridas: string[]): string | null => {
    for (const [name, set] of cols) {
      if (requeridas.every((c) => set.has(c))) return name;
    }
    return null;
  };

  const out = (tipo: FuenteTipo, hoja: string | null, motivo: string): FuenteDeteccion => ({
    tipo,
    hoja,
    hojas,
    motivo,
  });

  // 1) STOCK maestro — hoja "Base_Stock" (incluye también Control TestCars, líneas…).
  if (tieneHoja("Base_Stock"))
    return out("stock", "Base_Stock", 'Hoja "Base_Stock" presente (Excel maestro de stock).');

  // 2) SALDOS / SALVING — hoja "FUSION BD 3.0" o columnas CATEGORIA + Saldo x Documentar.
  const hSaldos = tieneHoja("FUSION BD 3.0")
    ? "FUSION BD 3.0"
    : hojaCon("CATEGORIA", "Saldo x Documentar");
  if (hSaldos) return out("saldos", hSaldos, "Estructura SALVING (CATEGORIA + Saldo x Documentar).");

  // 3) LOGÍSTICA ROMA — VentaID + PasoActual (agenda del vendedor).
  const hRoma = hojaCon("VentaID", "PasoActual");
  if (hRoma) return out("logistica_roma", hRoma, "Columnas VentaID + PasoActual (agenda ROMA).");

  // 4) LOGÍSTICA STLI — ejecución de bodega.
  const hStli = hojaCon("Fecha de solicitud a STLI") ?? hojaCon("VIN", "Fecha Ingreso APC");
  if (hStli) return out("logistica_stli", hStli, "Columnas de ejecución de bodega (STLI).");

  // 5) PROVISIONES — montoProvision, o Concepto + saldo + EstadoAjuste.
  const hProv = hojaCon("montoProvision") ?? hojaCon("Concepto", "saldo", "EstadoAjuste");
  if (hProv) return out("provisiones", hProv, "Columnas de provisiones (montoProvision).");

  // 6) FNE — Vin + (Nombre_Cliente | entrega_auto_txt | etapa+ValorFactura).
  const hFne =
    hojaCon("Vin", "Nombre_Cliente") ??
    hojaCon("Vin", "entrega_auto_txt") ??
    hojaCon("Vin", "etapa", "ValorFactura");
  if (hFne) return out("fne", hFne, "Columnas de facturados no entregados (Vin + cliente/etapa).");

  // 7) TESCAR standalone — hoja Control TestCars o Tipo Vehículo + Valor compra.
  const hTescar = tieneHoja("Control TestCars")
    ? "Control TestCars"
    : hojaCon("Tipo Vehículo", "Valor compra");
  if (hTescar) return out("tescar", hTescar, "Hoja Control TestCars (TEST CARS + BDR).");

  return out("desconocido", null, "No coincide con ninguna fuente conocida.");
}
