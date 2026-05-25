/**
 * Parser ligero de hojas con histórico de operaciones por VIN.
 *
 * Estas hojas NO son stock activo (eso vive en Base_Stock) pero contienen
 * 24,000+ VINs de operaciones ya facturadas/entregadas. Para el cruce con
 * Autos no entregados.xlsx son CRÍTICAS — el ~76% de los VINs FNE no están
 * en Base_Stock pero sí en el histórico de Venta APC.
 *
 * Output: un mapa VIN_LIMPIO → metadata (marca, modelo, cliente, sucursal,
 * patente, fechas, folios). Sirve para enriquecer cualquier cruce contra
 * VIN que el módulo FNE/Capital de Trabajo necesite.
 */

import * as XLSX from "xlsx";

export interface VINSupplementaryRecord {
  vinLimpio: string;
  fuente: "Venta APC Fact VN" | "Venta APC Fact VU" | "Financiado" | "Base Financiamiento";
  marca: string | null;
  modelo: string | null;
  patente: string | null;
  sucursal: string | null;
  cliente: string | null;
  vendedor: string | null;
  folioVenta: string | number | null;
  fechaVenta: Date | null;
  fechaFacturacion: Date | null;
  /** Solo en Financiado / Base Financiamiento. */
  tipoFinanciamiento: string | null;
  fechaVencimientoFin: Date | null;
  statusFinanciamiento: string | null;
  financiera: string | null;
  actualmenteEnStock: string | null;
  enLinea: string | null;
}

export function limpiarVIN(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  let v = String(raw);
  v = v
    .replace(/[ ​‌‍﻿⁠]/g, "")
    .replace(/[\r\n\t]/g, "")
    .replace(/\s+/g, "")
    .replace(/[-_./]/g, "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]/g, "");
  return v;
}

export function esVINValido(v: string): boolean {
  return v.length === 17 && /^[A-Z0-9]{17}$/.test(v);
}

function s(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t.length === 0 ? null : t;
}

function d(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t) : null;
  }
  return null;
}

/**
 * Procesa una hoja Venta APC (VN o VU). Mismo formato: header en fila 0.
 * VIN en columna "Numero VIN" (con fallback a "Numero Chasis").
 */
function parseVentaApc(
  ws: XLSX.WorkSheet | undefined,
  fuente: "Venta APC Fact VN" | "Venta APC Fact VU",
): VINSupplementaryRecord[] {
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: null,
    raw: true,
  });
  const out: VINSupplementaryRecord[] = [];
  for (const r of rows) {
    const vinLimpio = limpiarVIN(r["Numero VIN"] ?? r["Numero Chasis"] ?? r["Numero Serie"]);
    if (!esVINValido(vinLimpio)) continue;
    out.push({
      vinLimpio,
      fuente,
      marca: s(r["Marca"]),
      modelo: s(r["Modelo"]),
      patente: s(r["Placa Patente"]),
      sucursal: s(r["Sucursal"]),
      cliente: s(r["Cliente"]),
      vendedor: s(r["Vendedor"]),
      folioVenta: (r["Folio Venta"] as string | number | null) ?? null,
      fechaVenta: d(r["Fecha Venta"]),
      fechaFacturacion: d(r["Fecha Facturación"]),
      tipoFinanciamiento: null,
      fechaVencimientoFin: null,
      statusFinanciamiento: null,
      financiera: null,
      actualmenteEnStock: null,
      enLinea: null,
    });
  }
  return out;
}

function parseFinanciado(ws: XLSX.WorkSheet | undefined): VINSupplementaryRecord[] {
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: null,
    raw: true,
  });
  const out: VINSupplementaryRecord[] = [];
  for (const r of rows) {
    const vinLimpio = limpiarVIN(r["VIN"]);
    if (!esVINValido(vinLimpio)) continue;
    out.push({
      vinLimpio,
      fuente: "Financiado",
      marca: s(r["Marca"]),
      modelo: s(r["Modelo"]),
      patente: null,
      sucursal: s(r["Sucursal"]),
      cliente: null,
      vendedor: null,
      folioVenta: null,
      fechaVenta: null,
      fechaFacturacion: null,
      tipoFinanciamiento: s(r["Tipo de Financiamiento"]),
      fechaVencimientoFin: d(r["Fecha de Vencimiento"]),
      statusFinanciamiento: s(r["Status"]),
      financiera: s(r["Financiera/Banco"]),
      actualmenteEnStock: s(r["Actualmente en Stock?"]),
      enLinea: s(r["En linea?"]),
    });
  }
  return out;
}

function parseBaseFinanciamiento(ws: XLSX.WorkSheet | undefined): VINSupplementaryRecord[] {
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: null,
    raw: true,
  });
  const out: VINSupplementaryRecord[] = [];
  for (const r of rows) {
    const vinLimpio = limpiarVIN(r["Numero VIN "] ?? r["Numero VIN"]);
    if (!esVINValido(vinLimpio)) continue;
    out.push({
      vinLimpio,
      fuente: "Base Financiamiento",
      marca: s(r["Marca"]),
      modelo: s(r["Version"]),
      patente: null,
      sucursal: null,
      cliente: null,
      vendedor: null,
      folioVenta: null,
      fechaVenta: null,
      fechaFacturacion: null,
      tipoFinanciamiento: s(r["Tipo Financiamiento"]),
      fechaVencimientoFin: d(r["Fecha Vencimiento"]),
      statusFinanciamiento: s(r["Estatus Stock"]),
      financiera: null,
      actualmenteEnStock: null,
      enLinea: null,
    });
  }
  return out;
}

/**
 * Construye un mapa VIN_LIMPIO → mejor metadata disponible.
 * Prioridad de fuentes (la primera que tiene el dato gana):
 *   1. Financiado (tiene info financiera detallada)
 *   2. Venta APC Fact VN (info comercial completa)
 *   3. Venta APC Fact VU (idem para usados)
 *   4. Base Financiamiento
 *
 * Pero el `fuente` reportado en el registry final refleja DÓNDE se encontró
 * primero el VIN — útil para auditoría.
 */
export function buildVINSupplementaryRegistry(wb: XLSX.WorkBook): Map<string, VINSupplementaryRecord> {
  const all: VINSupplementaryRecord[] = [
    ...parseVentaApc(wb.Sheets["Venta APC Fact VN"], "Venta APC Fact VN"),
    ...parseVentaApc(wb.Sheets["Venta APC Fact VU"], "Venta APC Fact VU"),
    ...parseFinanciado(wb.Sheets["Financiado"]),
    ...parseBaseFinanciamiento(wb.Sheets["Base Financiamiento"]),
  ];

  // Consolidar: por cada VIN_LIMPIO, mergeamos todos los hits eligiendo el
  // primer valor no-null de cada campo (las hojas se procesaron en orden de
  // prioridad).
  const map = new Map<string, VINSupplementaryRecord>();
  for (const r of all) {
    const existing = map.get(r.vinLimpio);
    if (!existing) {
      map.set(r.vinLimpio, r);
      continue;
    }
    const merged: VINSupplementaryRecord = { ...existing };
    for (const k of Object.keys(r) as (keyof VINSupplementaryRecord)[]) {
      if ((merged[k] === null || merged[k] === undefined) && r[k] !== null && r[k] !== undefined) {
        // @ts-expect-error mismo tipo via Record copy
        merged[k] = r[k];
      }
    }
    map.set(r.vinLimpio, merged);
  }
  return map;
}
