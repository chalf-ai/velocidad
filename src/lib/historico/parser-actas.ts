/**
 * PARSER ACTAS — función pura.
 *
 * Lee UN archivo Excel Actas (corte completo del universo operacional) y
 * produce un corte fechado listo para consumir. El parser NO decide si el
 * corte va al snapshot vivo o al histórico acumulativo — eso es responsabilidad
 * del caller.
 *
 * Reglas operacionales validadas con Operaciones (sección 11 del documento
 * de decisión):
 *   - entregado = (entrega_auto_txt.trim() === "Cargado")
 *     Red de seguridad: fecha_patente_entregada poblada también marca entregado.
 *   - fDocListoDerivado = fPatenteRecibida ?? fInscripcion
 *   - fPatenteRecibida NO es obligatoria. Su ausencia no es problema de datos
 *     ni warning; es una métrica de cumplimiento operacional.
 *
 * Derivados precomputados en la fila para evitar reimplementación en cada
 * consumidor:
 *   - entregado, fEntregaReal, fuenteEntrega
 *   - fDocListoDerivado
 *   - nivelDocumental ("completo" / "parcial" / "minimo")
 *
 * Cero side effects. Cero dependencias de Prisma, store, React, fs ni red.
 * Doble API: `parseActasFile(File)` para browser, `parseActasBuffer(buf)` para
 * Node/scripts/tests offline.
 */

import * as XLSX from "xlsx";

// ─────────────────────────────────────────────────────────────────────────────
// Errores
// ─────────────────────────────────────────────────────────────────────────────

export const ACTAS_PARSER_ERROR_CODES = {
  HOJA_AUSENTE: "ACTAS_HOJA_AUSENTE",
  COLUMNAS_FALTAN: "ACTAS_COLUMNAS_FALTAN",
  SIN_FILAS_VALIDAS: "ACTAS_SIN_FILAS_VALIDAS",
  EXCEL_INVALIDO: "ACTAS_EXCEL_INVALIDO",
} as const;

export type ActasParserErrorCode =
  (typeof ACTAS_PARSER_ERROR_CODES)[keyof typeof ACTAS_PARSER_ERROR_CODES];

export class ActasParserError extends Error {
  code: ActasParserErrorCode;
  details?: Record<string, unknown>;
  constructor(code: ActasParserErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ActasParserError";
    this.code = code;
    this.details = details;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de salida
// ─────────────────────────────────────────────────────────────────────────────

export type RazonDescarteActas =
  | "sin_vin"
  | "vin_invalido"
  | "duplicado_interno_vin"
  | "fechas_incoherentes";

export interface DescarteActas {
  rowIndex: number;
  razon: RazonDescarteActas;
  raw: Record<string, unknown>;
}

export type MetodoDeteccionCorte =
  | "max_fecha_entrega"
  | "max_fecha_patente"
  | "max_fecha_factura"
  | "ninguno";

export type ConfianzaCorte = "alta" | "media" | "baja" | "ninguna";

export type FuenteEntrega = "entrega_auto_txt" | "fecha_patente_entregada" | "ninguna";

/**
 * Nivel documental — alimenta el eje de Cumplimiento Operacional.
 *
 *   "completo" : tiene factura + inscripción + patente recibida.
 *                Si entregado=true, además fEntregaReal.
 *   "parcial"  : tiene factura + inscripción, falta patente recibida.
 *                (Caso operacional típico — los locales que no completan
 *                fecha_patente_recibida pero sí gestionan la inscripción.)
 *   "minimo"   : tiene factura pero falta inscripción.
 *                Es un caso de cumplimiento débil.
 */
export type NivelDocumental = "completo" | "parcial" | "minimo";

export interface ActasRowMerge {
  // Identidad
  vin: string;
  id: number | null;

  // Identidad descriptiva
  sucursal: string | null;
  cliente: string | null;
  vendedor: string | null;

  // Línea documental (eventos de origen)
  valorFactura: number;
  fVenta: Date | null;
  fFactura: Date | null;
  fSolicitudInscripcion: Date | null;
  fInscripcion: Date | null;

  // Patente (cuatro hitos del recorrido)
  fPatenteAdmin: Date | null;
  fPatenteEnviada: Date | null;
  fPatenteRecibida: Date | null;
  fPatenteEntregada: Date | null;

  // Señales operacionales
  autorizacionEntrega: string | null;
  solEntrega: string | null;
  entregaAutoTxt: string | null;

  // Derivados precomputados (recalculables — pueden regenerarse si cambia la regla)
  entregado: boolean;
  fEntregaReal: Date | null;
  fuenteEntrega: FuenteEntrega;
  fDocListoDerivado: Date | null;
  fuenteDocListo: "patente_recibida" | "inscripcion" | "ninguna";
  nivelDocumental: NivelDocumental;
  estadoEntregaOriginal: string | null;
  etapa: number | null;
}

export interface ReporteActas {
  filasTotales: number;
  filasProcesadas: number;
  filasDescartadas: number;
  descartes: DescarteActas[];

  // Detección del corte
  metodoDeteccionCorte: MetodoDeteccionCorte;
  confianzaCorte: ConfianzaCorte;
  detalleCorte: {
    maxFechaEntregaReal: string | null;
    maxFechaPatenteRecibida: string | null;
    maxFechaFactura: string | null;
    corteEstimado: string | null;
  };

  // Métricas del corte
  totalEntregados: number;
  totalNoEntregados: number;
  totalCargadoTxt: number;
  totalRedSeguridad: number;          // entregados detectados por fPatenteEntregada (txt no marca)
  totalSinFechaEntregaReal: number;   // entregado=true pero fEntregaReal=null

  cobertura: {
    fPatenteRecibida: number;
    fInscripcion: number;
    fFactura: number;
    fSolicitudInscripcion: number;
  };

  // Cumplimiento operacional (NO son errores, son métricas para reportería futura)
  cumplimiento: {
    /** Entregados sin `fecha_patente_recibida` cargada en sucursal.
     *  Operacionalmente legítimo (algunos locales no completan ese paso). */
    entregadosSinPatenteRecibida: number;
    /** Entregados sin `autorizacion_entrega = Si` cargada. */
    entregadosSinAutorizacion: number;
    /** Entregados sin `sol_entrega = Si` cargada. */
    entregadosSinSolicitudEntrega: number;
    /** Distribución por nivel documental. */
    porNivelDocumental: Record<NivelDocumental, number>;
  };

  // Huérfanos candidatos (detección rápida; clasificación final fuera del parser)
  huerfanosCandidatos: {
    tipo1ProbableEntregaNoRegistrada: number;
    tipo2EntregadoConCierreInconsistente: number;
  };

  duplicadosInternosVin: string[];
}

export interface CorteActasIdentificacion {
  id: string;
  fecha: Date | null;
  archivoNombre: string;
  archivoSize: number;
  fechaCarga: Date;
}

export interface ResultadoIngestaActas {
  corte: CorteActasIdentificacion;
  filas: ActasRowMerge[];
  report: ReporteActas;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de coerción
// ─────────────────────────────────────────────────────────────────────────────

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
const DMY_RE = /^(\d{2})-(\d{2})-(\d{4})$/;

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "number") {
    if (v === 0) return null;
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    if (s === "0" || s === "00-00-0000") return null;
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

function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const VIN_VALID_RE = /^[A-HJ-NPR-Z0-9]{11,17}$/i;

function limpiarVIN(v: unknown): { ok: true; value: string } | { ok: false; reason: "missing" | "invalid" } {
  if (v === null || v === undefined || v === "") return { ok: false, reason: "missing" };
  const raw = String(v).trim().toUpperCase();
  if (!raw) return { ok: false, reason: "missing" };
  if (!VIN_VALID_RE.test(raw)) return { ok: false, reason: "invalid" };
  return { ok: true, value: raw };
}

function isoDay(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reglas operacionales derivadas (alineadas con auditoría)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detección de entregado. Regla canónica + red de seguridad.
 * Replica la lógica validada en `src/lib/parser/autos-no-entregados.ts`.
 */
function detectarEntregado(
  entregaAutoTxt: string | null,
  fPatenteEntregada: Date | null,
): { entregado: boolean; fEntregaReal: Date | null; fuenteEntrega: FuenteEntrega } {
  const txt = (entregaAutoTxt ?? "").trim();
  if (txt === "Cargado") {
    return { entregado: true, fEntregaReal: fPatenteEntregada, fuenteEntrega: "entrega_auto_txt" };
  }
  if (fPatenteEntregada !== null) {
    return { entregado: true, fEntregaReal: fPatenteEntregada, fuenteEntrega: "fecha_patente_entregada" };
  }
  return { entregado: false, fEntregaReal: null, fuenteEntrega: "ninguna" };
}

/**
 * Regla aprobada en sección 11.2 de DECISION-HISTORICO-ROMA-ACTAS.md:
 *   fDocListoDerivado = fPatenteRecibida ?? fInscripcion
 */
function derivarDocListo(
  fPatenteRecibida: Date | null,
  fInscripcion: Date | null,
): { fDocListoDerivado: Date | null; fuenteDocListo: "patente_recibida" | "inscripcion" | "ninguna" } {
  if (fPatenteRecibida) return { fDocListoDerivado: fPatenteRecibida, fuenteDocListo: "patente_recibida" };
  if (fInscripcion) return { fDocListoDerivado: fInscripcion, fuenteDocListo: "inscripcion" };
  return { fDocListoDerivado: null, fuenteDocListo: "ninguna" };
}

/**
 * Clasificación de nivel documental — alimenta el Eje 2 (Cumplimiento).
 *
 * Reglas (más estricto → más débil):
 *   "completo" : factura + inscripción + patente recibida.
 *                Si entregado, ADEMÁS fEntregaReal.
 *   "parcial"  : factura + inscripción, sin patente recibida.
 *   "minimo"   : factura presente pero sin inscripción.
 */
function derivarNivelDocumental(args: {
  entregado: boolean;
  fFactura: Date | null;
  fInscripcion: Date | null;
  fPatenteRecibida: Date | null;
  fEntregaReal: Date | null;
}): NivelDocumental {
  const { entregado, fFactura, fInscripcion, fPatenteRecibida, fEntregaReal } = args;
  if (fFactura && fInscripcion && fPatenteRecibida && (!entregado || fEntregaReal)) {
    return "completo";
  }
  if (fFactura && fInscripcion) return "parcial";
  return "minimo";
}

// ─────────────────────────────────────────────────────────────────────────────
// Detección del corte
// ─────────────────────────────────────────────────────────────────────────────

const MS_DIA = 86_400_000;

function detectarCorte(filas: ActasRowMerge[]): {
  fecha: Date | null;
  metodo: MetodoDeteccionCorte;
  confianza: ConfianzaCorte;
  detalle: ReporteActas["detalleCorte"];
} {
  const maxOf = (xs: Date[]): Date | null =>
    xs.length === 0 ? null : new Date(Math.max(...xs.map((d) => d.getTime())));

  const entregas = filas.map((f) => f.fEntregaReal).filter((d): d is Date => d !== null);
  const patentes = filas.map((f) => f.fPatenteRecibida).filter((d): d is Date => d !== null);
  const facturas = filas.map((f) => f.fFactura).filter((d): d is Date => d !== null);

  const mE = maxOf(entregas);
  const mP = maxOf(patentes);
  const mF = maxOf(facturas);

  const detalle = {
    maxFechaEntregaReal: isoDay(mE),
    maxFechaPatenteRecibida: isoDay(mP),
    maxFechaFactura: isoDay(mF),
    corteEstimado: null as string | null,
  };

  if (!mE && !mP && !mF) {
    return { fecha: null, metodo: "ninguno", confianza: "ninguna", detalle };
  }

  // El corte real es el MAX absoluto entre las tres
  const candidatos: Array<{ d: Date; m: MetodoDeteccionCorte }> = [];
  if (mE) candidatos.push({ d: mE, m: "max_fecha_entrega" });
  if (mP) candidatos.push({ d: mP, m: "max_fecha_patente" });
  if (mF) candidatos.push({ d: mF, m: "max_fecha_factura" });
  candidatos.sort((a, b) => b.d.getTime() - a.d.getTime());
  const ganador = candidatos[0];

  // Confianza: cuántos de los 3 caen a ±7 días del ganador
  const dentro = candidatos.filter(
    (c) => Math.abs(c.d.getTime() - ganador.d.getTime()) <= 7 * MS_DIA,
  ).length;
  let confianza: ConfianzaCorte;
  if (dentro === 3) confianza = "alta";
  else if (dentro === 2) confianza = "media";
  else confianza = "baja";

  detalle.corteEstimado = isoDay(ganador.d);

  return {
    fecha: ganador.d,
    metodo: ganador.m,
    confianza,
    detalle,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Extracción de fila
// ─────────────────────────────────────────────────────────────────────────────

const COLUMNAS_REQUERIDAS = ["Vin", "FechaVenta", "FechaFactura", "entrega_auto_txt"] as const;

function extraerFila(row: Record<string, unknown>, vin: string): ActasRowMerge {
  const fFactura = toDate(row["FechaFactura"]);
  const fVenta = toDate(row["FechaVenta"]);
  const fSolicitudInscripcion = toDate(row["FechaSolicitudInscripcion"]);
  const fInscripcion = toDate(row["FechaInscripcion"]);
  const fPatenteAdmin = toDate(row["patentes_administracion"]);
  const fPatenteEnviada = toDate(row["fecha_patente_enviada"]);
  const fPatenteRecibida = toDate(row["fecha_patente_recibida"]);
  const fPatenteEntregada = toDate(row["fecha_patente_entregada"]);
  const entregaAutoTxt = toStr(row["entrega_auto_txt"]);

  const det = detectarEntregado(entregaAutoTxt, fPatenteEntregada);
  const doc = derivarDocListo(fPatenteRecibida, fInscripcion);
  const nivelDocumental = derivarNivelDocumental({
    entregado: det.entregado,
    fFactura,
    fInscripcion,
    fPatenteRecibida,
    fEntregaReal: det.fEntregaReal,
  });

  return {
    vin,
    id: toNumOrNull(row["ID"]),
    sucursal: toStr(row["Sucursal"]),
    cliente: toStr(row["Nombre_Cliente"]),
    vendedor: toStr(row["Nombre_Vendedor"]),
    valorFactura: toNum(row["ValorFactura"]),
    fVenta,
    fFactura,
    fSolicitudInscripcion,
    fInscripcion,
    fPatenteAdmin,
    fPatenteEnviada,
    fPatenteRecibida,
    fPatenteEntregada,
    autorizacionEntrega: toStr(row["autorizacion_entrega"]),
    solEntrega: toStr(row["sol_entrega"]),
    entregaAutoTxt,
    entregado: det.entregado,
    fEntregaReal: det.fEntregaReal,
    fuenteEntrega: det.fuenteEntrega,
    fDocListoDerivado: doc.fDocListoDerivado,
    fuenteDocListo: doc.fuenteDocListo,
    nivelDocumental,
    estadoEntregaOriginal: entregaAutoTxt,
    etapa: toNumOrNull(row["etapa"]),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker interno: procesa un workbook ya leído
// ─────────────────────────────────────────────────────────────────────────────

function parseActasWorkbook(
  wb: XLSX.WorkBook,
  archivoNombre: string,
  archivoSize: number,
): ResultadoIngestaActas {
  const hoja = wb.Sheets["ROMA"];
  if (!hoja) {
    throw new ActasParserError(
      ACTAS_PARSER_ERROR_CODES.HOJA_AUSENTE,
      `No se encontró la hoja "ROMA" en el archivo Actas. Hojas: ${wb.SheetNames.join(", ")}`,
      { hojas: wb.SheetNames },
    );
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja, {
    defval: null,
    raw: true,
  });

  if (rows.length === 0) {
    throw new ActasParserError(
      ACTAS_PARSER_ERROR_CODES.SIN_FILAS_VALIDAS,
      "La hoja ROMA está vacía.",
    );
  }
  const headerKeys = new Set(Object.keys(rows[0]));
  const faltantes = COLUMNAS_REQUERIDAS.filter((c) => !headerKeys.has(c));
  if (faltantes.length > 0) {
    throw new ActasParserError(
      ACTAS_PARSER_ERROR_CODES.COLUMNAS_FALTAN,
      `Faltan columnas obligatorias en Actas: ${faltantes.join(", ")}`,
      { faltantes, presentes: [...headerKeys] },
    );
  }

  const filas: ActasRowMerge[] = [];
  const descartes: DescarteActas[] = [];
  const vistosVin = new Map<string, number>();
  const duplicadosVin: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowIndex = i + 2;

    const vin = limpiarVIN(r["Vin"]);
    if (!vin.ok) {
      descartes.push({
        rowIndex,
        razon: vin.reason === "missing" ? "sin_vin" : "vin_invalido",
        raw: r,
      });
      continue;
    }

    if (vistosVin.has(vin.value)) {
      duplicadosVin.push(vin.value);
      descartes.push({ rowIndex, razon: "duplicado_interno_vin", raw: r });
      continue;
    }
    vistosVin.set(vin.value, rowIndex);

    const fila = extraerFila(r, vin.value);

    // Sanity de fechas: entrega anterior a venta es señal de error de datos
    if (
      fila.fEntregaReal &&
      fila.fVenta &&
      fila.fEntregaReal.getTime() < fila.fVenta.getTime() - 365 * MS_DIA
    ) {
      // Caída fuerte: entrega más de 1 año ANTES de la venta es claramente error
      descartes.push({ rowIndex, razon: "fechas_incoherentes", raw: r });
      continue;
    }

    filas.push(fila);
  }

  if (filas.length === 0) {
    throw new ActasParserError(
      ACTAS_PARSER_ERROR_CODES.SIN_FILAS_VALIDAS,
      "Ninguna fila válida tras descartes.",
      { totales: rows.length, descartes: descartes.length },
    );
  }

  // ── Detección del corte
  const det = detectarCorte(filas);

  // ── Métricas
  let totalEntregados = 0;
  let totalNoEntregados = 0;
  let totalCargadoTxt = 0;
  let totalRedSeguridad = 0;
  let totalSinFechaEntregaReal = 0;

  let cPat = 0, cIns = 0, cFac = 0, cSolIns = 0;

  let entregadosSinPatRec = 0;
  let entregadosSinAut = 0;
  let entregadosSinSolE = 0;
  const porNivel: Record<NivelDocumental, number> = { completo: 0, parcial: 0, minimo: 0 };

  let t1 = 0; // tipo 1 huérfano candidato
  let t2 = 0; // tipo 2 huérfano candidato

  for (const f of filas) {
    if (f.entregado) totalEntregados++;
    else totalNoEntregados++;
    if (f.fuenteEntrega === "entrega_auto_txt") totalCargadoTxt++;
    if (f.fuenteEntrega === "fecha_patente_entregada") totalRedSeguridad++;
    if (f.entregado && !f.fEntregaReal) totalSinFechaEntregaReal++;

    if (f.fPatenteRecibida) cPat++;
    if (f.fInscripcion) cIns++;
    if (f.fFactura) cFac++;
    if (f.fSolicitudInscripcion) cSolIns++;

    if (f.entregado) {
      if (!f.fPatenteRecibida) entregadosSinPatRec++;
      const aut = (f.autorizacionEntrega ?? "").trim();
      const sol = (f.solEntrega ?? "").trim();
      if (aut !== "Si") entregadosSinAut++;
      if (sol !== "Si") entregadosSinSolE++;
    }
    porNivel[f.nivelDocumental]++;

    // Huérfanos candidatos (perfil rápido; clasificación final fuera del parser)
    if (!f.entregado && f.fInscripcion) {
      const aut = (f.autorizacionEntrega ?? "").trim();
      const sol = (f.solEntrega ?? "").trim();
      if ((aut === "" || aut === "No") && (sol === "" || sol === "No")) {
        t1++;
      }
    }
    if (f.entregado && !f.fInscripcion) t2++;
  }

  const total = filas.length;
  const pct = (n: number) => (total > 0 ? +((n / total) * 100).toFixed(2) : 0);

  const report: ReporteActas = {
    filasTotales: rows.length,
    filasProcesadas: total,
    filasDescartadas: descartes.length,
    descartes,
    metodoDeteccionCorte: det.metodo,
    confianzaCorte: det.confianza,
    detalleCorte: det.detalle,
    totalEntregados,
    totalNoEntregados,
    totalCargadoTxt,
    totalRedSeguridad,
    totalSinFechaEntregaReal,
    cobertura: {
      fPatenteRecibida: pct(cPat),
      fInscripcion: pct(cIns),
      fFactura: pct(cFac),
      fSolicitudInscripcion: pct(cSolIns),
    },
    cumplimiento: {
      entregadosSinPatenteRecibida: entregadosSinPatRec,
      entregadosSinAutorizacion: entregadosSinAut,
      entregadosSinSolicitudEntrega: entregadosSinSolE,
      porNivelDocumental: porNivel,
    },
    huerfanosCandidatos: {
      tipo1ProbableEntregaNoRegistrada: t1,
      tipo2EntregadoConCierreInconsistente: t2,
    },
    duplicadosInternosVin: [...new Set(duplicadosVin)],
  };

  const corte: CorteActasIdentificacion = {
    id: det.fecha ? isoDay(det.fecha)! : "indeterminado",
    fecha: det.fecha,
    archivoNombre,
    archivoSize,
    fechaCarga: new Date(),
  };

  return { corte, filas, report };
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

export async function parseActasFile(file: File): Promise<ResultadoIngestaActas> {
  let buf: ArrayBuffer;
  try {
    buf = await file.arrayBuffer();
  } catch (e) {
    throw new ActasParserError(
      ACTAS_PARSER_ERROR_CODES.EXCEL_INVALIDO,
      `No se pudo leer el archivo: ${e instanceof Error ? e.message : "error"}`,
    );
  }
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "array", cellDates: true });
  } catch (e) {
    throw new ActasParserError(
      ACTAS_PARSER_ERROR_CODES.EXCEL_INVALIDO,
      `Excel inválido: ${e instanceof Error ? e.message : "error"}`,
    );
  }
  return parseActasWorkbook(wb, file.name, file.size);
}

export function parseActasBuffer(
  buf: ArrayBuffer | Uint8Array,
  archivoNombre: string,
  archivoSize: number,
): ResultadoIngestaActas {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, {
      type: buf instanceof Uint8Array ? "buffer" : "array",
      cellDates: true,
    });
  } catch (e) {
    throw new ActasParserError(
      ACTAS_PARSER_ERROR_CODES.EXCEL_INVALIDO,
      `Excel inválido: ${e instanceof Error ? e.message : "error"}`,
    );
  }
  return parseActasWorkbook(wb, archivoNombre, archivoSize);
}

/** Helper para distribuir descartes por razón. */
export function distribuirDescartesActas(descartes: DescarteActas[]): Record<RazonDescarteActas, number> {
  const out: Record<RazonDescarteActas, number> = {
    sin_vin: 0,
    vin_invalido: 0,
    duplicado_interno_vin: 0,
    fechas_incoherentes: 0,
  };
  for (const d of descartes) out[d.razon]++;
  return out;
}
