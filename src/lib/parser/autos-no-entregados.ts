/**
 * Parser de "Autos no entregados.xlsx" — fuente oficial del módulo FNE.
 *
 * Estructura: una sola hoja "ROMA" con 32 columnas.
 * El archivo es independiente del Excel maestro de stock; se carga aparte.
 * El cruce con Base_Stock (para obtener tipoStock / costoNeto / marca) se
 * resuelve en el selector, no acá.
 *
 * Notas importantes:
 * - PatenteVpp existe pero NO se usa como fuente de VPP. El VPP sigue
 *   viviendo en Base_Stock vía Vehiculo.esVPPComprometido.
 * - entrega_auto viene 100% null en el archivo actual (por definición,
 *   son autos no entregados). No se hace dropping basado en eso.
 */

import * as XLSX from "xlsx";
import type { AutoNoEntregado, EtapaFNE, ParsedFNE } from "../types";

const SHEET_NAME = "ROMA";

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "number") {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return new Date(Date.UTC(d.y, (d.m ?? 1) - 1, d.d ?? 1, d.H ?? 0, d.M ?? 0, Math.floor(d.S ?? 0)));
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t) : null;
  }
  return null;
}

function toSiNo(v: unknown): boolean | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (s === "si" || s === "sí" || s === "yes" || s === "true" || s === "1") return true;
  if (s === "no" || s === "false" || s === "0") return false;
  return null;
}

function toEtapa(v: unknown): EtapaFNE {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const valid: EtapaFNE[] = [1, 2, 3, 4, 6, 7, 8, 12, 14, 0];
  return (valid as number[]).includes(n) ? (n as EtapaFNE) : 0;
}

export function parseAutosNoEntregados(ws: XLSX.WorkSheet): ParsedFNE["registros"] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: null,
    raw: true,
  });

  const registros: AutoNoEntregado[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const vin = toStr(r["Vin"]);
    if (!vin) continue;

    registros.push({
      id: toNumOrNull(r["ID"]),
      sucursal: toStr(r["Sucursal"]),
      cliente: toStr(r["Nombre_Cliente"]),
      rut: r["Rut"] != null ? (typeof r["Rut"] === "number" ? (r["Rut"] as number) : toStr(r["Rut"])) : null,
      vendedor: toStr(r["Nombre_Vendedor"]),
      cajon: toStr(r["Cajon"]),
      vin,
      valorFactura: toNum(r["ValorFactura"]),
      fechaVenta: toDate(r["FechaVenta"]),
      fechaFactura: toDate(r["FechaFactura"]),
      fechaFacturaDiff: toNumOrNull(r["fecha_factura_diff"]),

      autorizacionEntrega: toSiNo(r["autorizacion_entrega"]),
      solEntrega: toSiNo(r["sol_entrega"]),
      entregaAuto: toStr(r["entrega_auto"]),

      solicitarInscripcion: toSiNo(r["SolicitarInscripcion"]),
      fechaSolicitudInscripcion: toDate(r["FechaSolicitudInscripcion"]),
      fechaInscripcion: toDate(r["FechaInscripcion"]),

      patentesAdministracion: toDate(r["patentes_administracion"]),
      fechaPatenteEnviada: toDate(r["fecha_patente_enviada"]),
      fechaPatenteRecibida: toDate(r["fecha_patente_recibida"]),
      fechaPatenteEntregada: toDate(r["fecha_patente_entregada"]),

      patenteVpp: toStr(r["PatenteVpp"]),
      etapa: toEtapa(r["etapa"]),
      entregaAutoTxt: toStr(r["entrega_auto_txt"]),

      rowIndex: i + 2, // +2: 1 por header, 1 porque xlsx es 1-indexed
    });
  }

  return registros;
}

export async function parseFNEFile(file: File): Promise<ParsedFNE> {
  const t0 = performance.now();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, {
    type: "array",
    cellDates: true,
    cellStyles: false,
  });
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) {
    throw new Error(
      `No se encontró la hoja "${SHEET_NAME}" en el archivo. Hojas disponibles: ${wb.SheetNames.join(", ")}`,
    );
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: true });
  const filasTotales = rawRows.length;
  const registros = parseAutosNoEntregados(ws);

  // Detectar VINs duplicados (en el archivo de ejemplo hay 2)
  const counts = new Map<string, number>();
  for (const r of registros) counts.set(r.vin, (counts.get(r.vin) ?? 0) + 1);
  const vinsDuplicados = [...counts.entries()].filter(([, n]) => n > 1).map(([v]) => v);

  return {
    registros,
    report: {
      archivoNombre: file.name,
      archivoSize: file.size,
      fechaCarga: new Date(),
      filasTotales,
      filasProcesadas: registros.length,
      filasOmitidas: filasTotales - registros.length,
      vinsDuplicados,
      durMs: Math.round(performance.now() - t0),
    },
  };
}
