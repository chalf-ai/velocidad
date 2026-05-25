/**
 * PARSER · archivos logísticos. Dos fuentes, un único punto de entrada que
 * detecta cuál es por sus columnas (el usuario sube cualquiera de los dos):
 *   - Logistica.xlsx / hoja Hoja2  → STLI (ejecución de bodega)
 *   - Diciembre-Mayo ROMA.xlsx / hoja ROMA → ROMA (agenda del vendedor)
 *
 * Devuelve filas ya tipadas (LogisticaStliRow / LogisticaRomaRow de construir.ts)
 * con fechas normalizadas a Date. NO mergea (eso lo hace construirLogisticaPorVin).
 */

import * as XLSX from "xlsx";
import type { LogisticaRomaRow, LogisticaStliRow } from "../logistica/construir";

export type LogisticaKind = "STLI" | "ROMA";

export interface ParsedLogisticaReport {
  archivoNombre: string;
  archivoSize: number;
  fechaCarga: Date;
  kind: LogisticaKind;
  hoja: string;
  filasTotales: number;
  filasProcesadas: number;
}

export interface ParsedLogistica {
  kind: LogisticaKind;
  stli: LogisticaStliRow[] | null;
  roma: LogisticaRomaRow[] | null;
  report: ParsedLogisticaReport;
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};
const numv = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Normaliza a Date desde Date | número (serial Excel) | "dd-mm-yyyy" | ISO. */
function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim();
  if (!s) return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) {
    const [, d, mo, y] = m;
    if (d === "00" || mo === "00" || y === "0000") return null;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d));
    return isNaN(dt.getTime()) ? null : dt;
  }
  const iso = new Date(s);
  return isNaN(iso.getTime()) ? null : iso;
}

type Row = Record<string, unknown>;
const rowsOf = (ws: XLSX.WorkSheet): Row[] =>
  XLSX.utils.sheet_to_json<Row>(ws, { defval: null, raw: true });

/** Detecta qué hoja/tipo trae el workbook por columnas. */
function detectar(wb: XLSX.WorkBook): { kind: LogisticaKind; hoja: string } | null {
  for (const hoja of wb.SheetNames) {
    const rows = rowsOf(wb.Sheets[hoja]);
    if (rows.length === 0) continue;
    const cols = new Set(Object.keys(rows[0]));
    if (cols.has("VentaID") && cols.has("PasoActual")) return { kind: "ROMA", hoja };
    if (cols.has("Fecha de solicitud a STLI") || (cols.has("VIN") && cols.has("Fecha Ingreso APC")))
      return { kind: "STLI", hoja };
  }
  return null;
}

export function parseSTLI(ws: XLSX.WorkSheet): LogisticaStliRow[] {
  const out: LogisticaStliRow[] = [];
  for (const r of rowsOf(ws)) {
    const vin = str(r["VIN"]);
    if (!vin) continue;
    out.push({
      vin,
      marca: str(r["Marca"]),
      sucursalDestino: str(r["Sucursal Destino"]),
      tipoSolicitud: str(r["Tipo solicitud"]),
      fIngresoApc: toDate(r["Fecha Ingreso APC"]),
      fSolicitudBodega: toDate(r["Fecha de solicitud a STLI"]),
      fPlanificacion: toDate(r["Fecha Planificacion STLI"]),
      fDespacho: toDate(r["Fecha despacho a sucursal"]),
      cumplimientoDespacho: str(r["Cumplimiento despacho"]),
      diasPreentrega: numv(r["Dias preentrega"]),
      diasStock: numv(r["Dias de Stock"]),
    });
  }
  return out;
}

export function parseROMA(ws: XLSX.WorkSheet): LogisticaRomaRow[] {
  const out: LogisticaRomaRow[] = [];
  for (const r of rowsOf(ws)) {
    const vin = str(r["Vin"]);
    if (!vin) continue;
    out.push({
      ventaId: numv(r["VentaID"]),
      vin,
      marca: str(r["Marca"]),
      modelo: str(r["Modelo"]),
      sucursal: str(r["Sucursal"]),
      fSolicitud: toDate(r["FechaSolicitud"]),
      fRespuestaLogistica: toDate(r["fecha_RespuestaGestionLogistica"]),
      fLlegadaSucursal: toDate(r["FechaETASucursal"]),
      fFactura: toDate(r["FechaFactura"]),
      fInscripcion: toDate(r["FechaEnprocesoIns"]),
      fEntregaComprometida: toDate(r["FechaEstimadaEntrega"]),
      fRespuestaInstalacionAcc: toDate(r["fecha_RespuestaInstalacionAcc"]),
      pasoActual: str(r["PasoActual"]),
      estado: str(r["Estado"]),
    });
  }
  return out;
}

export async function parseLogisticaFile(file: File): Promise<ParsedLogistica> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true, cellStyles: false });
  const det = detectar(wb);
  if (!det) {
    throw new Error(
      `No se reconoció el archivo como Logística (STLI) ni ROMA. Hojas: ${wb.SheetNames.join(", ")}`,
    );
  }
  const ws = wb.Sheets[det.hoja];
  const filasTotales = rowsOf(ws).length;
  const stli = det.kind === "STLI" ? parseSTLI(ws) : null;
  const roma = det.kind === "ROMA" ? parseROMA(ws) : null;
  return {
    kind: det.kind,
    stli,
    roma,
    report: {
      archivoNombre: file.name,
      archivoSize: file.size,
      fechaCarga: new Date(),
      kind: det.kind,
      hoja: det.hoja,
      filasTotales,
      filasProcesadas: (stli?.length ?? roma?.length ?? 0),
    },
  };
}
