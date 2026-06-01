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
 * - `entrega_auto` puede venir poblada cuando la base es completa (incluye
 *   entregados históricos). El parser marca cada registro con `entregado:bool`
 *   pero NO descarta filas: la base completa se conserva en el store. Filtrar
 *   por `entregado=false` ocurre en `cruzarFNEConStock` antes de cualquier
 *   cálculo de pipeline operacional.
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

/**
 * Detecta si la fila representa un auto YA entregado al cliente.
 *
 * Regla canónica oficial (decidida con Operaciones tras revisar "Actas al
 * 28 de Mayo.xlsx" donde la columna `entrega_auto_txt` está 100% poblada):
 *
 *   entregado = (entrega_auto_txt.trim() === "Cargado")
 *
 * "Cargado" significa que el acta de entrega fue cargada en el sistema —
 * o sea, el auto ya fue entregado al cliente. Cualquier otro valor (incluido
 * "No Cargado", vacíos, nulos o variantes) deja el registro en el universo
 * FNE operativo.
 *
 * Red de seguridad: si por alguna razón `entrega_auto_txt` no marca entrega
 * pero `fecha_patente_entregada` sí tiene fecha física de entrega, también
 * lo marcamos entregado (fuente=fecha_patente_entregada). Esto cubre archivos
 * mal poblados sin alterar el comportamiento principal.
 *
 * Devuelve los 4 campos derivados que viven en cada `AutoNoEntregado`.
 */
function detectarEntregado(
  entregaAutoTxt: string | null,
  fechaPatenteEntregada: Date | null,
): {
  entregado: boolean;
  fechaEntregaReal: Date | null;
  estadoEntregaOriginal: string | null;
  fuenteEntrega: "entrega_auto_txt" | "fecha_patente_entregada" | "ninguna";
} {
  const txtNorm = (entregaAutoTxt ?? "").trim();
  if (txtNorm === "Cargado") {
    return {
      entregado: true,
      fechaEntregaReal: fechaPatenteEntregada,
      estadoEntregaOriginal: entregaAutoTxt,
      fuenteEntrega: "entrega_auto_txt",
    };
  }

  // Defensivo: si quedaron filas con fecha de entrega física pero entrega_auto_txt
  // sin "Cargado", las consideramos entregadas igual (red de seguridad).
  if (fechaPatenteEntregada !== null) {
    return {
      entregado: true,
      fechaEntregaReal: fechaPatenteEntregada,
      estadoEntregaOriginal: entregaAutoTxt,
      fuenteEntrega: "fecha_patente_entregada",
    };
  }

  return {
    entregado: false,
    fechaEntregaReal: null,
    estadoEntregaOriginal: entregaAutoTxt,
    fuenteEntrega: "ninguna",
  };
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

    const entregaAutoTxt = toStr(r["entrega_auto_txt"]);
    const fechaPatenteEntregada = toDate(r["fecha_patente_entregada"]);
    const entregaInfo = detectarEntregado(entregaAutoTxt, fechaPatenteEntregada);

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
      fechaPatenteEntregada,

      patenteVpp: toStr(r["PatenteVpp"]),
      etapa: toEtapa(r["etapa"]),
      entregaAutoTxt,

      // Split histórico vs operativo
      entregado: entregaInfo.entregado,
      fechaEntregaReal: entregaInfo.fechaEntregaReal,
      estadoEntregaOriginal: entregaInfo.estadoEntregaOriginal,
      fuenteEntrega: entregaInfo.fuenteEntrega,

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

  // Conteo de la separación operativo/histórico — visible en report para auditoría.
  let entregadosCount = 0;
  let noEntregadosCount = 0;
  for (const r of registros) {
    if (r.entregado) entregadosCount++;
    else noEntregadosCount++;
  }

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
      entregadosCount,
      noEntregadosCount,
    },
  };
}
