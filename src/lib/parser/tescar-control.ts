/**
 * Parser de la hoja "Control TestCars" — FUENTE OFICIAL de TESCAR.
 *
 * La columna "Tipo Vehículo" identifica el uso real:
 *   - TEST CARS  → TESCAR (demo comercial)
 *   - BDR        → TESCAR (demo de marca; operacionalmente igual a un test car)
 *   - RENTING / COMPANY CAR / VDR → NO son TESCAR (otra lógica, fuera por ahora)
 *
 * La marca se toma de la columna A ("Marca") = la marca que originó/compró el
 * demo (Kia/MG/Geely…), NUNCA USADOS. El VIN vive en "Cajon". El capital es
 * "Valor compra". TESCAR consume capital de trabajo aunque esté financiado.
 *
 * Pura: NO toca Base_Stock, score, ni el flag esTescar (que sigue alimentando el
 * score desde Base_Stock). Esta hoja es la capa OPERACIONAL/visual de TESCAR.
 */

import type { WorkSheet } from "xlsx";
import * as XLSX from "xlsx";
import type { SheetReport, TescarControlRow, TipoTescar } from "../types";
import { limpiarVIN } from "./venta-apc";

const num = (v: unknown): number => {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};

/** Convierte un valor de celda a Date: acepta Date (cellDates) o serial Excel. */
function toDate(v: unknown): Date | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // Serial Excel (días desde 1899-12-30).
    return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000);
  }
  return null;
}

/** ¿El Tipo Vehículo corresponde a TESCAR (TEST CARS o BDR)? */
function tipoTescarDe(tipoVehiculo: string | null): TipoTescar | null {
  const u = (tipoVehiculo ?? "").toUpperCase();
  if (u.includes("TEST CAR")) return "test_car";
  if (u === "BDR" || u.includes("BDR")) return "bdr";
  return null; // RENTING / COMPANY CAR / VDR → no es TESCAR
}

export function parseTescarControl(
  ws: WorkSheet,
  hoy: Date = new Date(),
): { rows: TescarControlRow[]; report: SheetReport } {
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    raw: true,
    defval: null,
    blankrows: false,
  });
  // Los headers pueden traer espacios → trim de keys (defensa).
  const rows = rawRows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) o[String(k).trim()] = v;
    return o;
  });

  const out: TescarControlRow[] = [];
  let excluidos = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const tipoVehiculo = str(r["Tipo Vehículo"]) ?? str(r["Tipo Vehiculo"]);
    const tipo = tipoTescarDe(tipoVehiculo);
    if (!tipo) {
      excluidos++; // renting / company / vdr / otros
      continue;
    }
    const vinRaw = str(r["Cajon"]) ?? str(r["VIN"]) ?? "";
    const fechaPrestamo = toDate(r["Fecha Prestamo"]) ?? toDate(r["Fecha Préstamo"]);
    const diasPrestamo =
      fechaPrestamo != null
        ? Math.max(0, Math.round((hoy.getTime() - fechaPrestamo.getTime()) / 86_400_000))
        : null;
    out.push({
      rowIndex: i + 2,
      marca: str(r["Marca"]),
      modelo: str(r["Modelo"]),
      color: str(r["Color"]),
      vin: vinRaw,
      vinLimpio: limpiarVIN(vinRaw),
      patente: str(r["Patente"]),
      propietario: str(r["Propietario"]),
      rutPropietario: str(r["Rut Propietario"]),
      valorCompra: num(r["Valor compra"]),
      vigencia: str(r["Vigencia"]),
      decisionVenta: str(r["Desición de venta"]) ?? str(r["Decisión de venta"]),
      tipoVehiculo: tipoVehiculo ?? "",
      tipo,
      status: str(r["Status"]),
      sucursal: str(r["Sucursal2"]) ?? str(r["Sucursal"]),
      sucursalInicio: str(r["Sucursal inicio"]),
      responsable: str(r["Responsable"]),
      fechaPrestamo,
      fechaDevolucion: toDate(r["Fecha devolución"]) ?? toDate(r["Fecha devolucion"]),
      diasPrestamo,
      cliente: str(r["Cliente"]),
    });
  }

  const report: SheetReport = {
    nombre: "Control TestCars",
    filasTotales: rows.length,
    filasProcesadas: out.length,
    filasOmitidas: excluidos,
    columnasDetectadas: ["Marca", "Cajon", "Tipo Vehículo", "Valor compra", "Status"],
    columnasEsperadas: ["Marca", "Cajon", "Tipo Vehículo", "Valor compra"],
    columnasFaltantes: [],
    estado: "ok",
    mensaje: `${out.length} TESCAR (TEST CARS + BDR) · ${excluidos} excluidos (renting/company/vdr)`,
  };

  return { rows: out, report };
}
