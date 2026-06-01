/**
 * PARSER ROMA MENSUAL — función pura.
 *
 * Lee UN archivo Excel mensual de ROMA (descarga desde FASIL/ROMA) y produce
 * un corte listo para consolidar. NO mergea con cortes previos: solo prepara
 * los datos. El merge lo hace el consolidador en una capa superior.
 *
 * Detección del mes: por contenido, no por nombre. Se usa la moda mensual de
 * `FechaSolicitud` como señal primaria y `max(FechaSolicitud)` como
 * cross-check. Si discrepan en más de 2 días, se reporta confianza "baja".
 *
 * Cero side effects. Cero dependencias de Prisma, store, React, fs ni red.
 * Doble API: `parseRomaMensualFile(File)` para browser, `parseRomaMensual
 * Buffer(buf)` para Node/scripts/tests offline.
 *
 * La forma del resultado está pensada para conectar con MergePolicy:
 * `filas[i]` es directamente un `RomaRowMerge` que puede pasarse a
 * `mergeRomaRows` sin transformación adicional.
 */

import * as XLSX from "xlsx";
import type { RomaRowMerge } from "./merge-policy.js";

// ─────────────────────────────────────────────────────────────────────────────
// Errores
// ─────────────────────────────────────────────────────────────────────────────

export const ROMA_PARSER_ERROR_CODES = {
  HOJA_AUSENTE: "ROMA_HOJA_AUSENTE",
  COLUMNAS_FALTAN: "ROMA_COLUMNAS_FALTAN",
  SIN_FILAS_VALIDAS: "ROMA_SIN_FILAS_VALIDAS",
  EXCEL_INVALIDO: "ROMA_EXCEL_INVALIDO",
} as const;

export type RomaParserErrorCode =
  (typeof ROMA_PARSER_ERROR_CODES)[keyof typeof ROMA_PARSER_ERROR_CODES];

export class RomaParserError extends Error {
  code: RomaParserErrorCode;
  details?: Record<string, unknown>;
  constructor(code: RomaParserErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "RomaParserError";
    this.code = code;
    this.details = details;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del resultado
// ─────────────────────────────────────────────────────────────────────────────

export type RazonDescarte =
  | "sin_ventaId"
  | "sin_vin"
  | "vin_invalido"
  | "ventaId_no_numerico"
  | "duplicado_interno_ventaId"
  | "fecha_solicitud_invalida";

export interface DescarteRoma {
  /** 1-based: fila en el Excel original, contando el header como fila 1. */
  rowIndex: number;
  razon: RazonDescarte;
  /** Snapshot del raw row para auditoría manual. */
  raw: Record<string, unknown>;
}

export type MetodoDeteccionMes =
  | "moda_y_max_coinciden"
  | "moda_gana_max_es_borde"
  | "moda_gana_pero_discrepa_fuerte"
  | "solo_uno_disponible"
  | "ninguno";

export type ConfianzaMesDeteccion = "alta" | "media" | "baja" | "ninguna";

export interface DistribucionMes {
  mes: string; // "2026-03"
  filas: number;
}

export interface DuplicadoInterno {
  ventaId: number;
  vinPrimero: string;
  vinDuplicado: string;
  rowIndexPrimero: number;
  rowIndexDuplicado: number;
}

export interface ReporteRoma {
  filasTotales: number;
  filasProcesadas: number;
  filasDescartadas: number;
  descartes: DescarteRoma[];

  /** Histograma de filas por mes de FechaSolicitud (ordenado por mes). */
  distribucionMesFechaSolicitud: DistribucionMes[];

  mesDetectado: string | null;
  metodoDeteccion: MetodoDeteccionMes;
  confianzaMesDeteccion: ConfianzaMesDeteccion;
  /** Detalle de la detección para auditoría. */
  detalleDeteccion: {
    moda: string | null;
    filasEnModa: number;
    maxFechaSolicitud: string | null;
    maxFechaSolicitudMes: string | null;
    diasEntreModaYMax: number | null;
  };

  duplicadosInternos: DuplicadoInterno[];
}

export interface CorteRomaIdentificacion {
  /** "2026-03" o "indeterminado". Lo decide la capa superior cuando es "indeterminado". */
  id: string;
  /** Último día del mes detectado (UTC) o null si no se pudo determinar. */
  fecha: Date | null;
  archivoNombre: string;
  archivoSize: number;
  fechaCarga: Date;
}

export interface ResultadoIngestaRoma {
  corte: CorteRomaIdentificacion;
  filas: RomaRowMerge[];
  report: ReporteRoma;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de coerción (compatibles con consolidar-historico de auditoría)
// ─────────────────────────────────────────────────────────────────────────────

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
const DMY_RE = /^(\d{2})-(\d{2})-(\d{4})$/;

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "number") {
    if (v === 0) return null;
    // Serial Excel → ms desde 1970. 25569 = días entre 1900-01-01 y 1970-01-01
    // (con corrección del bug del año bisiesto 1900 que Excel asume).
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    // Sentinels conocidos del Excel ROMA
    if (s === "0" || s === "00-00-0000") return null;
    const lower = s.toLowerCase();
    if (lower === "sin salida" || lower === "en proceso" || lower === "por confirmar") return null;
    const m = DMY_RE.exec(s);
    if (m) {
      const d = Number(m[1]);
      const mo = Number(m[2]);
      const y = Number(m[3]);
      if (m[1] === "00" || m[2] === "00" || m[3] === "0000") return null;
      const dt = new Date(y, mo - 1, d);
      return Number.isFinite(dt.getTime()) ? dt : null;
    }
    if (ISO_DATE_RE.test(s)) {
      const dt = new Date(s);
      return Number.isFinite(dt.getTime()) ? dt : null;
    }
    const t = Date.parse(s);
    return Number.isFinite(t) ? new Date(t) : null;
  }
  return null;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function parseVentaID(v: unknown): { ok: true; value: number } | { ok: false; reason: "missing" | "not_number" } {
  if (v === null || v === undefined || v === "") return { ok: false, reason: "missing" };
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || Number.isNaN(n)) return { ok: false, reason: "not_number" };
  return { ok: true, value: Math.trunc(n) };
}

const VIN_VALID_RE = /^[A-HJ-NPR-Z0-9]{11,17}$/i;

function limpiarVIN(v: unknown): { ok: true; value: string } | { ok: false; reason: "missing" | "invalid" } {
  if (v === null || v === undefined || v === "") return { ok: false, reason: "missing" };
  const raw = String(v).trim().toUpperCase();
  if (!raw) return { ok: false, reason: "missing" };
  if (!VIN_VALID_RE.test(raw)) return { ok: false, reason: "invalid" };
  return { ok: true, value: raw };
}

function yearMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function lastDayOfMonth(yyyymm: string): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyymm);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return new Date(y, mo, 0); // último día del mes en local time
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapeo de columnas a campos RomaRowMerge
// ─────────────────────────────────────────────────────────────────────────────

/** Columnas mínimas requeridas en el archivo. */
const COLUMNAS_REQUERIDAS = ["VentaID", "Vin", "FechaSolicitud"] as const;

function extraerFila(
  row: Record<string, unknown>,
  ventaId: number,
  vin: string,
): RomaRowMerge {
  return {
    ventaId,
    vin,
    // INMUTABLES descriptivos
    marca: toStr(row["Marca"]),
    modelo: toStr(row["Modelo"]),
    gerencia: toStr(row["Gerencia"]),
    colorReferencial: toStr(row["ColorReferencial"]),
    cajon: toStr(row["Cajon"]),
    // INMUTABLES de fecha
    fSolicitud: toDate(row["FechaSolicitud"]),
    fFactura: toDate(row["FechaFactura"]),
    fInscripcion: toDate(row["FechaEnprocesoIns"]),
    fVenta: toDate(row["FechaVenta"]),
    // EVOLUTIVOS
    estado: toStr(row["Estado"]),
    pasoActual: toStr(row["PasoActual"]),
    comentario: toStr(row["Comentario"]),
    // EVOLUTIVOS de fecha
    fETASucursal: toDate(row["FechaETASucursal"]),
    fEstimadaEntrega: toDate(row["FechaEstimadaEntrega"]),
    fRespuestaLogistica: toDate(row["fecha_RespuestaGestionLogistica"]),
    fRespuestaInstalacionAcc: toDate(row["fecha_RespuestaInstalacionAcc"]),
    fETALlegadaCalc: toDate(row["FechaEstimadaLLegadaSucursal_Calculo"]),
    // ESTABLES
    sucursal: toStr(row["Sucursal"]),
    ventaAcc: toStr(row["VentaAcc"]),
    varTieneLamina: toStr(row["varTieneLamina"]),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Detección del mes
// ─────────────────────────────────────────────────────────────────────────────

function detectarMes(filas: RomaRowMerge[]): {
  mes: string | null;
  metodo: MetodoDeteccionMes;
  confianza: ConfianzaMesDeteccion;
  distribucion: DistribucionMes[];
  detalle: ReporteRoma["detalleDeteccion"];
} {
  const fechas = filas.map((f) => f.fSolicitud).filter((d): d is Date => d !== null);
  const detalleVacio: ReporteRoma["detalleDeteccion"] = {
    moda: null,
    filasEnModa: 0,
    maxFechaSolicitud: null,
    maxFechaSolicitudMes: null,
    diasEntreModaYMax: null,
  };

  if (fechas.length === 0) {
    return {
      mes: null,
      metodo: "ninguno",
      confianza: "ninguna",
      distribucion: [],
      detalle: detalleVacio,
    };
  }

  // Histograma
  const hist = new Map<string, number>();
  for (const d of fechas) {
    const k = yearMonth(d);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  const distribucion: DistribucionMes[] = [...hist.entries()]
    .map(([mes, filas]) => ({ mes, filas }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  // Moda
  const ordenadoPorVolumen = [...hist.entries()].sort((a, b) => b[1] - a[1]);
  const modaMes = ordenadoPorVolumen[0][0];
  const filasEnModa = ordenadoPorVolumen[0][1];

  // Max
  const maxFs = new Date(Math.max(...fechas.map((d) => d.getTime())));
  const maxMes = yearMonth(maxFs);

  // Cross-check
  const detalleBase = {
    moda: modaMes,
    filasEnModa,
    maxFechaSolicitud: maxFs.toISOString().slice(0, 10),
    maxFechaSolicitudMes: maxMes,
  };

  if (modaMes === maxMes) {
    return {
      mes: modaMes,
      metodo: "moda_y_max_coinciden",
      confianza: "alta",
      distribucion,
      detalle: { ...detalleBase, diasEntreModaYMax: 0 },
    };
  }

  // Calcular distancia: cuántos días entre el último día del mes-moda y maxFs
  const ultimoDiaModa = lastDayOfMonth(modaMes);
  const diasEntre =
    ultimoDiaModa !== null
      ? Math.round((maxFs.getTime() - ultimoDiaModa.getTime()) / 86400000)
      : null;

  // Si max está en el mes inmediatamente siguiente y dentro de los primeros 7 días,
  // es el borde típico documentado en la auditoría → confianza media.
  if (diasEntre !== null && diasEntre > 0 && diasEntre <= 7) {
    return {
      mes: modaMes,
      metodo: "moda_gana_max_es_borde",
      confianza: "media",
      distribucion,
      detalle: { ...detalleBase, diasEntreModaYMax: diasEntre },
    };
  }

  return {
    mes: modaMes,
    metodo: "moda_gana_pero_discrepa_fuerte",
    confianza: "baja",
    distribucion,
    detalle: { ...detalleBase, diasEntreModaYMax: diasEntre },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker interno: procesa un workbook ya leído
// ─────────────────────────────────────────────────────────────────────────────

function parseRomaMensualWorkbook(
  wb: XLSX.WorkBook,
  archivoNombre: string,
  archivoSize: number,
): ResultadoIngestaRoma {
  // 1) Hoja ROMA
  const hoja = wb.Sheets["ROMA"];
  if (!hoja) {
    throw new RomaParserError(
      ROMA_PARSER_ERROR_CODES.HOJA_AUSENTE,
      `No se encontró la hoja "ROMA". Hojas disponibles: ${wb.SheetNames.join(", ")}`,
      { hojas: wb.SheetNames },
    );
  }

  // 2) Cargar filas crudas
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja, {
    defval: null,
    raw: true,
  });

  // 3) Columnas requeridas presentes en la primera fila
  if (rows.length === 0) {
    throw new RomaParserError(
      ROMA_PARSER_ERROR_CODES.SIN_FILAS_VALIDAS,
      "La hoja ROMA está vacía.",
    );
  }
  const headerKeys = new Set(Object.keys(rows[0]));
  const faltantes = COLUMNAS_REQUERIDAS.filter((c) => !headerKeys.has(c));
  if (faltantes.length > 0) {
    throw new RomaParserError(
      ROMA_PARSER_ERROR_CODES.COLUMNAS_FALTAN,
      `Faltan columnas obligatorias: ${faltantes.join(", ")}`,
      { faltantes, presentes: [...headerKeys] },
    );
  }

  // 4) Procesar fila por fila
  const filas: RomaRowMerge[] = [];
  const descartes: DescarteRoma[] = [];
  const vistosPorVentaId = new Map<number, { vin: string; rowIndex: number }>();
  const duplicadosInternos: DuplicadoInterno[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowIndex = i + 2; // +1 por header, +1 porque xlsx es 1-based

    // VentaID
    const venta = parseVentaID(r["VentaID"]);
    if (!venta.ok) {
      descartes.push({
        rowIndex,
        razon: venta.reason === "missing" ? "sin_ventaId" : "ventaId_no_numerico",
        raw: r,
      });
      continue;
    }

    // VIN
    const vin = limpiarVIN(r["Vin"]);
    if (!vin.ok) {
      descartes.push({
        rowIndex,
        razon: vin.reason === "missing" ? "sin_vin" : "vin_invalido",
        raw: r,
      });
      continue;
    }

    // Fecha solicitud opcionalmente validada — el campo es INMUTABLE_MIN_DATE
    // y debería estar siempre, pero si viene en formato no parseable la coercimos
    // a null y aceptamos la fila (otras señales pueden estar).
    const fSol = toDate(r["FechaSolicitud"]);
    // Si el valor crudo era no-nulo pero la coerción dio null, registramos
    // un descarte SOFT (no quitamos la fila — solo dejamos rastro).
    if (r["FechaSolicitud"] != null && r["FechaSolicitud"] !== "" && fSol == null) {
      descartes.push({
        rowIndex,
        razon: "fecha_solicitud_invalida",
        raw: r,
      });
      // Continuamos para preservar la fila como dato — el descarte queda como
      // marca de auditoría.
    }

    // Duplicado interno por VentaID
    const prev = vistosPorVentaId.get(venta.value);
    if (prev) {
      // Si el VIN coincide, no es duplicado real (fila repetida en el mismo archivo).
      // Si difiere, es señal sospechosa.
      if (prev.vin !== vin.value) {
        duplicadosInternos.push({
          ventaId: venta.value,
          vinPrimero: prev.vin,
          vinDuplicado: vin.value,
          rowIndexPrimero: prev.rowIndex,
          rowIndexDuplicado: rowIndex,
        });
      }
      descartes.push({
        rowIndex,
        razon: "duplicado_interno_ventaId",
        raw: r,
      });
      continue;
    }
    vistosPorVentaId.set(venta.value, { vin: vin.value, rowIndex });

    // Extraer
    filas.push(extraerFila(r, venta.value, vin.value));
  }

  if (filas.length === 0) {
    throw new RomaParserError(
      ROMA_PARSER_ERROR_CODES.SIN_FILAS_VALIDAS,
      "Ninguna fila válida tras descartes. Verificá columnas VentaID y Vin.",
      { totales: rows.length, descartes: descartes.length },
    );
  }

  // 5) Detectar mes
  const det = detectarMes(filas);

  // 6) Identificación del corte
  const corte: CorteRomaIdentificacion = {
    id: det.mes ?? "indeterminado",
    fecha: det.mes ? lastDayOfMonth(det.mes) : null,
    archivoNombre,
    archivoSize,
    fechaCarga: new Date(),
  };

  const report: ReporteRoma = {
    filasTotales: rows.length,
    filasProcesadas: filas.length,
    filasDescartadas: descartes.length,
    descartes,
    distribucionMesFechaSolicitud: det.distribucion,
    mesDetectado: det.mes,
    metodoDeteccion: det.metodo,
    confianzaMesDeteccion: det.confianza,
    detalleDeteccion: det.detalle,
    duplicadosInternos,
  };

  return { corte, filas, report };
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lee un archivo Excel ROMA mensual (browser File API) y produce el corte.
 * Compatible con UploadButton estándar.
 */
export async function parseRomaMensualFile(file: File): Promise<ResultadoIngestaRoma> {
  let buf: ArrayBuffer;
  try {
    buf = await file.arrayBuffer();
  } catch (e) {
    throw new RomaParserError(
      ROMA_PARSER_ERROR_CODES.EXCEL_INVALIDO,
      `No se pudo leer el archivo: ${e instanceof Error ? e.message : "error"}`,
    );
  }
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "array", cellDates: true });
  } catch (e) {
    throw new RomaParserError(
      ROMA_PARSER_ERROR_CODES.EXCEL_INVALIDO,
      `Excel inválido: ${e instanceof Error ? e.message : "error"}`,
    );
  }
  return parseRomaMensualWorkbook(wb, file.name, file.size);
}

/**
 * Variante para Node / tests offline: recibe un ArrayBuffer o Buffer y los
 * metadatos del archivo. No depende de la API File del browser.
 */
export function parseRomaMensualBuffer(
  buf: ArrayBuffer | Uint8Array,
  archivoNombre: string,
  archivoSize: number,
): ResultadoIngestaRoma {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: buf instanceof Uint8Array ? "buffer" : "array", cellDates: true });
  } catch (e) {
    throw new RomaParserError(
      ROMA_PARSER_ERROR_CODES.EXCEL_INVALIDO,
      `Excel inválido: ${e instanceof Error ? e.message : "error"}`,
    );
  }
  return parseRomaMensualWorkbook(wb, archivoNombre, archivoSize);
}

/**
 * Helper para distribuir descartes por razón. Útil para UI/reportes.
 */
export function distribuirDescartes(descartes: DescarteRoma[]): Record<RazonDescarte, number> {
  const out: Record<RazonDescarte, number> = {
    sin_ventaId: 0,
    sin_vin: 0,
    vin_invalido: 0,
    ventaId_no_numerico: 0,
    duplicado_interno_ventaId: 0,
    fecha_solicitud_invalida: 0,
  };
  for (const d of descartes) out[d.razon]++;
  return out;
}
