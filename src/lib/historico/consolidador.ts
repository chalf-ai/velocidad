/**
 * CONSOLIDADOR HISTÓRICO ROMA — específico, lógica pura.
 *
 * Toma cortes ROMA parseados por `parseRomaMensualFile` y mantiene un estado
 * consolidado por VentaID aplicando MergePolicy. Inmutable conceptualmente:
 * cada aplicación de corte devuelve una nueva instancia del histórico sin
 * mutar la previa.
 *
 * No es genérico: específico para `RomaRowMerge`. La generalización a Actas
 * se evaluará cuando llegue esa pieza, no antes (premature abstraction).
 *
 * Cero dependencias de Prisma, store, React, fs ni red.
 */

import {
  mergeRomaRows,
  type RomaRowMerge,
  type MergeContext,
  type MergeWarning,
  type WarningKind,
} from "./merge-policy.js";
import type { ResultadoIngestaRoma } from "./parser-roma-mensual.js";

// ─────────────────────────────────────────────────────────────────────────────
// Versionado del esquema
// ─────────────────────────────────────────────────────────────────────────────

export const HISTORICO_SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del histórico
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sidecar opcional con procedencia por campo. Solo se llena si la aplicación
 * fue invocada con `capturarProcedencia=true`. Mapea cada campo de
 * `RomaRowMerge` al `corteId` que aportó el valor actual.
 */
export type ProcedenciaPorCampo = Partial<Record<keyof RomaRowMerge, string>>;

export interface EntradaHistorica {
  /** Estado actual consolidado del VentaID. */
  row: RomaRowMerge;

  /** Corte cuyo timestamp es el más reciente entre los que aportaron datos
   *  (gobierna los campos EVOLUTIVOS según MergePolicy). */
  corteIdEvolutivo: string;
  corteFechaEvolutivo: Date;

  /** Corte que aportó por primera vez este VentaID al histórico
   *  (gobierna los campos INMUTABLE_FIRST y INMUTABLE_MIN_DATE de referencia). */
  corteIdOrigen: string;
  corteFechaOrigen: Date;

  /** Lista de corteIds donde apareció este VentaID, en orden de aplicación. */
  presenteEn: string[];

  /** Procedencia por campo. Solo definido si se capturó. */
  procedencia?: ProcedenciaPorCampo;
}

export interface CorteAplicado {
  corteId: string;
  corteFecha: Date;
  archivoNombre: string;
  archivoSize: number;
  fechaAplicacion: Date;
  filasAplicadas: number;
  warningsGenerados: number;
}

/**
 * Estado consolidado completo. Las operaciones del consolidador retornan
 * nuevas instancias; no mutan in-place.
 */
export interface HistoricoRoma {
  entradas: Map<number, EntradaHistorica>;
  cortes: CorteAplicado[];
  schemaVersion: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Severidad y categoría de warnings
// ─────────────────────────────────────────────────────────────────────────────

export type Severidad = "info" | "advertencia" | "crítica";
export type CategoriaWarning =
  | "conflicto_de_origen"
  | "evolucion_anormal"
  | "preservacion_aplicada"
  | "orden_temporal"
  | "llave_invalida";

export const SEVERIDAD_POR_KIND: Record<WarningKind, Severidad> = {
  INMUTABLE_CHANGED: "crítica",
  INMUTABLE_MIN_DATE_CONFLICT: "advertencia",
  STATE_REGRESSION: "info",
  NULL_OVERWRITE_PREVENTED: "info",
  CORTE_ANTERIOR_OUT_OF_ORDER: "advertencia",
};

export const CATEGORIA_POR_KIND: Record<WarningKind, CategoriaWarning> = {
  INMUTABLE_CHANGED: "llave_invalida",
  INMUTABLE_MIN_DATE_CONFLICT: "conflicto_de_origen",
  STATE_REGRESSION: "evolucion_anormal",
  NULL_OVERWRITE_PREVENTED: "preservacion_aplicada",
  CORTE_ANTERIOR_OUT_OF_ORDER: "orden_temporal",
};

export interface MergeWarningEnriquecido extends MergeWarning {
  severidad: Severidad;
  categoria: CategoriaWarning;
}

function enriquecerWarning(w: MergeWarning): MergeWarningEnriquecido {
  return {
    ...w,
    severidad: SEVERIDAD_POR_KIND[w.kind],
    categoria: CATEGORIA_POR_KIND[w.kind],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resultado de aplicación de un corte
// ─────────────────────────────────────────────────────────────────────────────

/** Razón legible del cambio en un campo, derivada de qué política operó. */
export type RazonCambio =
  | "evolutivo_avanza"
  | "fecha_min_corrige"
  | "estable_actualiza"
  | "fecha_preservada_null"
  | "inmutable_primera_aparicion";

export interface CambioCampo {
  campo: keyof RomaRowMerge;
  valorPrevio: unknown;
  valorNuevo: unknown;
  razon: RazonCambio;
}

export interface CambioVentaId {
  ventaId: number;
  camposCambiados: CambioCampo[];
}

export interface CambiosCorte {
  corteId: string;
  ventaIdsNuevos: number[];
  ventaIdsActualizados: CambioVentaId[];
  ventaIdsSinCambio: number[];
  duracion: number;
}

export interface ResumenAplicacion {
  corteId: string;
  ventaIdsNuevos: number;
  ventaIdsActualizados: number;
  ventaIdsSinCambio: number;
  ventaIdsEnConflicto: number;
  warningsCount: number;
  msec: number;
}

export interface ResultadoAplicacion {
  historico: HistoricoRoma;
  resumen: ResumenAplicacion;
  warnings: MergeWarningEnriquecido[];
  cambios: CambiosCorte;
}

export interface AplicarCorteOpts {
  /** Captura procedencia por campo (memoria extra). Default false. */
  capturarProcedencia?: boolean;
  /** Callback para warnings críticos (severidad="crítica"). Default no-op. */
  onWarningCritico?: (w: MergeWarningEnriquecido) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

function isNullish(v: unknown): boolean {
  return v === null || v === undefined;
}

function isDate(v: unknown): v is Date {
  return v instanceof Date && Number.isFinite(v.getTime());
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isNullish(a) && isNullish(b)) return true;
  if (isDate(a) && isDate(b)) return a.getTime() === b.getTime();
  return false;
}

/** Computa la lista de campos que cambiaron entre dos rows. */
function camposCambiados(
  prev: RomaRowMerge,
  next: RomaRowMerge,
): CambioCampo[] {
  const cambios: CambioCampo[] = [];
  const keys = new Set<keyof RomaRowMerge>([
    ...(Object.keys(prev) as Array<keyof RomaRowMerge>),
    ...(Object.keys(next) as Array<keyof RomaRowMerge>),
  ]);
  for (const k of keys) {
    if (k === "ventaId" || k === "vin") continue;
    const pv = prev[k];
    const nv = next[k];
    if (!valuesEqual(pv, nv)) {
      cambios.push({
        campo: k,
        valorPrevio: pv,
        valorNuevo: nv,
        razon: inferirRazon(pv, nv),
      });
    }
  }
  return cambios;
}

function inferirRazon(prev: unknown, next: unknown): RazonCambio {
  if (isNullish(prev) && !isNullish(next)) return "inmutable_primera_aparicion";
  if (isDate(prev) && isDate(next) && next < prev) return "fecha_min_corrige";
  if (isDate(prev) && isNullish(next)) return "fecha_preservada_null";
  // Si llegamos acá con prev definido y next definido distinto, lo más común
  // es que sea evolutivo (estado/comentario/ETA) o estable (sucursal).
  // Sin meta-info del campo, marcamos genérico:
  return "evolutivo_avanza";
}

/** Construye la procedencia por campo cuando se captura. */
function calcularProcedencia(
  prevProc: ProcedenciaPorCampo | undefined,
  rowAntes: RomaRowMerge,
  rowDespues: RomaRowMerge,
  corteId: string,
): ProcedenciaPorCampo {
  const proc: ProcedenciaPorCampo = { ...(prevProc ?? {}) };
  const cambios = camposCambiados(rowAntes, rowDespues);
  for (const c of cambios) {
    proc[c.campo] = corteId;
  }
  // Para los campos que existen en rowDespues pero no estaban en prevProc,
  // el corte actual es la procedencia inicial.
  for (const k of Object.keys(rowDespues) as Array<keyof RomaRowMerge>) {
    if (!proc[k] && !isNullish(rowDespues[k])) {
      proc[k] = corteId;
    }
  }
  return proc;
}

// ─────────────────────────────────────────────────────────────────────────────
// API: construcción y consulta
// ─────────────────────────────────────────────────────────────────────────────

export function crearHistoricoVacio(): HistoricoRoma {
  return {
    entradas: new Map(),
    cortes: [],
    schemaVersion: HISTORICO_SCHEMA_VERSION,
  };
}

export function obtenerEntrada(
  historico: HistoricoRoma,
  ventaId: number,
): EntradaHistorica | null {
  return historico.entradas.get(ventaId) ?? null;
}

export type OrdenListado = "ventaId" | "fSolicitud" | "corteEvolutivo";

export interface ListarEntradasOpts {
  ordenarPor?: OrdenListado;
  desc?: boolean;
}

export function listarEntradas(
  historico: HistoricoRoma,
  opts: ListarEntradasOpts = {},
): EntradaHistorica[] {
  const arr = [...historico.entradas.values()];
  const orden = opts.ordenarPor ?? "ventaId";
  const desc = opts.desc ?? false;
  const cmp = (a: EntradaHistorica, b: EntradaHistorica): number => {
    let r = 0;
    if (orden === "ventaId") r = a.row.ventaId - b.row.ventaId;
    else if (orden === "fSolicitud") {
      const ta = a.row.fSolicitud?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const tb = b.row.fSolicitud?.getTime() ?? Number.MAX_SAFE_INTEGER;
      r = ta - tb;
    } else if (orden === "corteEvolutivo") {
      r = a.corteFechaEvolutivo.getTime() - b.corteFechaEvolutivo.getTime();
    }
    return desc ? -r : r;
  };
  arr.sort(cmp);
  return arr;
}

export interface DescripcionHistorico {
  totalVentaIds: number;
  totalCortes: number;
  ventaIdsPorCorte: Map<string, number>;
  cortesPorVentaId: { min: number; max: number; mediana: number };
  cubrePeriodo: { desde: Date; hasta: Date } | null;
}

export function describirHistorico(historico: HistoricoRoma): DescripcionHistorico {
  const ventaIdsPorCorte = new Map<string, number>();
  for (const c of historico.cortes) ventaIdsPorCorte.set(c.corteId, 0);
  const cuentaCortesPorVid: number[] = [];
  let minSol: number | null = null;
  let maxSol: number | null = null;

  for (const e of historico.entradas.values()) {
    for (const cid of e.presenteEn) {
      ventaIdsPorCorte.set(cid, (ventaIdsPorCorte.get(cid) ?? 0) + 1);
    }
    cuentaCortesPorVid.push(e.presenteEn.length);
    const t = e.row.fSolicitud?.getTime() ?? null;
    if (t !== null) {
      if (minSol === null || t < minSol) minSol = t;
      if (maxSol === null || t > maxSol) maxSol = t;
    }
  }

  cuentaCortesPorVid.sort((a, b) => a - b);
  const median =
    cuentaCortesPorVid.length === 0
      ? 0
      : cuentaCortesPorVid[Math.floor(cuentaCortesPorVid.length / 2)];

  return {
    totalVentaIds: historico.entradas.size,
    totalCortes: historico.cortes.length,
    ventaIdsPorCorte,
    cortesPorVentaId: {
      min: cuentaCortesPorVid[0] ?? 0,
      max: cuentaCortesPorVid[cuentaCortesPorVid.length - 1] ?? 0,
      mediana: median,
    },
    cubrePeriodo:
      minSol !== null && maxSol !== null
        ? { desde: new Date(minSol), hasta: new Date(maxSol) }
        : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// API: aplicar UN corte
// ─────────────────────────────────────────────────────────────────────────────

export function aplicarCorte(
  historico: HistoricoRoma,
  corte: ResultadoIngestaRoma,
  opts: AplicarCorteOpts = {},
): ResultadoAplicacion {
  const inicio = Date.now();
  const corteId = corte.corte.id;
  const corteFecha = corte.corte.fecha ?? new Date(0);
  const capturar = opts.capturarProcedencia === true;
  const onCritico = opts.onWarningCritico;

  // Clonamos el Map (shallow): las entradas no modificadas se reusan tal cual.
  const entradas = new Map(historico.entradas);
  const warningsAcum: MergeWarningEnriquecido[] = [];
  const nuevos: number[] = [];
  const actualizados: CambioVentaId[] = [];
  const sinCambio: number[] = [];
  let enConflicto = 0;

  for (const fila of corte.filas) {
    const ventaId = fila.ventaId;
    const previa = entradas.get(ventaId);

    if (!previa) {
      // Primera aparición de este VentaID en el histórico.
      const entrada: EntradaHistorica = {
        row: { ...fila },
        corteIdOrigen: corteId,
        corteFechaOrigen: corteFecha,
        corteIdEvolutivo: corteId,
        corteFechaEvolutivo: corteFecha,
        presenteEn: [corteId],
        procedencia: capturar ? calcularProcedencia(undefined, {} as RomaRowMerge, fila, corteId) : undefined,
      };
      entradas.set(ventaId, entrada);
      nuevos.push(ventaId);
      continue;
    }

    // Mismo corte aplicado dos veces: detectamos por presencia en `presenteEn`.
    if (previa.presenteEn.includes(corteId)) {
      // Idempotencia: no aplicamos de nuevo. Conservamos la entrada como está.
      sinCambio.push(ventaId);
      continue;
    }

    // Merge con MergePolicy
    const ctx: MergeContext = {
      corteId,
      corteFecha,
      cortePrevioId: previa.corteIdEvolutivo,
      cortePrevioFecha: previa.corteFechaEvolutivo,
    };
    const { merged, warnings } = mergeRomaRows(previa.row, fila, ctx);
    const enriquecidos = warnings.map(enriquecerWarning);
    warningsAcum.push(...enriquecidos);
    if (onCritico) {
      for (const w of enriquecidos) if (w.severidad === "crítica") onCritico(w);
    }
    if (enriquecidos.some((w) => w.severidad === "crítica")) enConflicto++;

    const cambios = camposCambiados(previa.row, merged);
    if (cambios.length === 0) {
      // No hay cambios efectivos pero igual registramos presencia en el corte.
      const nuevaEntrada: EntradaHistorica = {
        ...previa,
        presenteEn: [...previa.presenteEn, corteId],
      };
      entradas.set(ventaId, nuevaEntrada);
      sinCambio.push(ventaId);
      continue;
    }

    // Determinar si el corte gobierna evolutivos (es más reciente que el previo)
    const esMasReciente = corteFecha.getTime() > previa.corteFechaEvolutivo.getTime();
    const corteIdEvolutivo = esMasReciente ? corteId : previa.corteIdEvolutivo;
    const corteFechaEvolutivo = esMasReciente ? corteFecha : previa.corteFechaEvolutivo;

    const nuevaEntrada: EntradaHistorica = {
      row: merged,
      corteIdOrigen: previa.corteIdOrigen,         // origen se preserva
      corteFechaOrigen: previa.corteFechaOrigen,
      corteIdEvolutivo,
      corteFechaEvolutivo,
      presenteEn: [...previa.presenteEn, corteId],
      procedencia: capturar
        ? calcularProcedencia(previa.procedencia, previa.row, merged, corteId)
        : undefined,
    };
    entradas.set(ventaId, nuevaEntrada);
    actualizados.push({ ventaId, camposCambiados: cambios });
  }

  const duracion = Date.now() - inicio;

  const corteAplicado: CorteAplicado = {
    corteId,
    corteFecha,
    archivoNombre: corte.corte.archivoNombre,
    archivoSize: corte.corte.archivoSize,
    fechaAplicacion: new Date(),
    filasAplicadas: corte.filas.length,
    warningsGenerados: warningsAcum.length,
  };

  const historicoNuevo: HistoricoRoma = {
    entradas,
    cortes: [...historico.cortes, corteAplicado],
    schemaVersion: historico.schemaVersion,
  };

  const resumen: ResumenAplicacion = {
    corteId,
    ventaIdsNuevos: nuevos.length,
    ventaIdsActualizados: actualizados.length,
    ventaIdsSinCambio: sinCambio.length,
    ventaIdsEnConflicto: enConflicto,
    warningsCount: warningsAcum.length,
    msec: duracion,
  };

  const cambiosCorte: CambiosCorte = {
    corteId,
    ventaIdsNuevos: nuevos,
    ventaIdsActualizados: actualizados,
    ventaIdsSinCambio: sinCambio,
    duracion,
  };

  return {
    historico: historicoNuevo,
    resumen,
    warnings: warningsAcum,
    cambios: cambiosCorte,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// API: aplicar N cortes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aplica una serie de cortes en el orden dado. El caller debe pasarlos
 * cronológicamente; si no, se reportan warnings de orden por cada inversión.
 * Retorna el resultado de cada aplicación + el histórico final acumulado.
 */
export function aplicarCortes(
  historico: HistoricoRoma,
  cortes: ResultadoIngestaRoma[],
  opts: AplicarCorteOpts = {},
): {
  historicoFinal: HistoricoRoma;
  resultados: ResultadoAplicacion[];
} {
  let acc = historico;
  const resultados: ResultadoAplicacion[] = [];
  for (const c of cortes) {
    const r = aplicarCorte(acc, c, opts);
    resultados.push(r);
    acc = r.historico;
  }
  return { historicoFinal: acc, resultados };
}

// ─────────────────────────────────────────────────────────────────────────────
// API: agrupación y top de warnings
// ─────────────────────────────────────────────────────────────────────────────

export interface AgrupacionWarnings {
  total: number;
  porSeveridad: Record<Severidad, number>;
  porCategoria: Record<CategoriaWarning, number>;
  porCampo: Record<string, number>;
  porVentaId: Map<number, MergeWarningEnriquecido[]>;
}

export function agruparWarnings(ws: MergeWarningEnriquecido[]): AgrupacionWarnings {
  const porSeveridad: Record<Severidad, number> = { info: 0, advertencia: 0, "crítica": 0 };
  const porCategoria: Record<CategoriaWarning, number> = {
    conflicto_de_origen: 0,
    evolucion_anormal: 0,
    preservacion_aplicada: 0,
    orden_temporal: 0,
    llave_invalida: 0,
  };
  const porCampo: Record<string, number> = {};
  const porVentaId = new Map<number, MergeWarningEnriquecido[]>();
  for (const w of ws) {
    porSeveridad[w.severidad]++;
    porCategoria[w.categoria]++;
    porCampo[w.field] = (porCampo[w.field] ?? 0) + 1;
    if (!porVentaId.has(w.ventaId)) porVentaId.set(w.ventaId, []);
    porVentaId.get(w.ventaId)!.push(w);
  }
  return { total: ws.length, porSeveridad, porCategoria, porCampo, porVentaId };
}

export function topVentaIdsProblematicos(
  ws: MergeWarningEnriquecido[],
  limit: number,
): { ventaId: number; count: number; categorias: CategoriaWarning[] }[] {
  const m = new Map<number, { count: number; categorias: Set<CategoriaWarning> }>();
  for (const w of ws) {
    if (!m.has(w.ventaId)) m.set(w.ventaId, { count: 0, categorias: new Set() });
    const x = m.get(w.ventaId)!;
    x.count++;
    x.categorias.add(w.categoria);
  }
  return [...m.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([ventaId, x]) => ({
      ventaId,
      count: x.count,
      categorias: [...x.categorias],
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialización (JSON-plano)
// ─────────────────────────────────────────────────────────────────────────────

export interface SerializedHistorico {
  schemaVersion: number;
  cortes: Array<Omit<CorteAplicado, "corteFecha" | "fechaAplicacion"> & {
    corteFecha: string;
    fechaAplicacion: string;
  }>;
  entradas: Array<{
    ventaId: number;
    row: SerializedRomaRow;
    corteIdOrigen: string;
    corteFechaOrigen: string;
    corteIdEvolutivo: string;
    corteFechaEvolutivo: string;
    presenteEn: string[];
    procedencia?: ProcedenciaPorCampo;
  }>;
}

/** RomaRowMerge con fechas como ISO strings. */
type SerializedRomaRow = {
  [K in keyof RomaRowMerge]: RomaRowMerge[K] extends Date | null | undefined
    ? string | null
    : RomaRowMerge[K];
};

function rowToSerialized(row: RomaRowMerge): SerializedRomaRow {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row) as Array<keyof RomaRowMerge>) {
    const v = row[k];
    out[k] = v instanceof Date ? v.toISOString() : v ?? null;
  }
  return out as SerializedRomaRow;
}

function rowFromSerialized(s: SerializedRomaRow): RomaRowMerge {
  const out: Record<string, unknown> = {};
  // Campos que sabemos son fechas
  const dateFields: Array<keyof RomaRowMerge> = [
    "fSolicitud", "fFactura", "fInscripcion", "fVenta",
    "fETASucursal", "fEstimadaEntrega", "fRespuestaLogistica",
    "fRespuestaInstalacionAcc", "fETALlegadaCalc",
  ];
  const dateSet = new Set<string>(dateFields as string[]);
  for (const k of Object.keys(s) as Array<keyof RomaRowMerge>) {
    const v = s[k];
    if (dateSet.has(k as string) && typeof v === "string") {
      const d = new Date(v);
      out[k] = Number.isFinite(d.getTime()) ? d : null;
    } else {
      out[k] = v;
    }
  }
  return out as unknown as RomaRowMerge;
}

export function serializarHistorico(historico: HistoricoRoma): SerializedHistorico {
  return {
    schemaVersion: historico.schemaVersion,
    cortes: historico.cortes.map((c) => ({
      corteId: c.corteId,
      corteFecha: c.corteFecha.toISOString(),
      archivoNombre: c.archivoNombre,
      archivoSize: c.archivoSize,
      fechaAplicacion: c.fechaAplicacion.toISOString(),
      filasAplicadas: c.filasAplicadas,
      warningsGenerados: c.warningsGenerados,
    })),
    entradas: [...historico.entradas.entries()].map(([ventaId, e]) => ({
      ventaId,
      row: rowToSerialized(e.row),
      corteIdOrigen: e.corteIdOrigen,
      corteFechaOrigen: e.corteFechaOrigen.toISOString(),
      corteIdEvolutivo: e.corteIdEvolutivo,
      corteFechaEvolutivo: e.corteFechaEvolutivo.toISOString(),
      presenteEn: [...e.presenteEn],
      procedencia: e.procedencia ? { ...e.procedencia } : undefined,
    })),
  };
}

export function deserializarHistorico(json: SerializedHistorico): HistoricoRoma {
  const entradas = new Map<number, EntradaHistorica>();
  for (const e of json.entradas) {
    entradas.set(e.ventaId, {
      row: rowFromSerialized(e.row),
      corteIdOrigen: e.corteIdOrigen,
      corteFechaOrigen: new Date(e.corteFechaOrigen),
      corteIdEvolutivo: e.corteIdEvolutivo,
      corteFechaEvolutivo: new Date(e.corteFechaEvolutivo),
      presenteEn: [...e.presenteEn],
      procedencia: e.procedencia ? { ...e.procedencia } : undefined,
    });
  }
  return {
    schemaVersion: json.schemaVersion,
    cortes: json.cortes.map((c) => ({
      corteId: c.corteId,
      corteFecha: new Date(c.corteFecha),
      archivoNombre: c.archivoNombre,
      archivoSize: c.archivoSize,
      fechaAplicacion: new Date(c.fechaAplicacion),
      filasAplicadas: c.filasAplicadas,
      warningsGenerados: c.warningsGenerados,
    })),
    entradas,
  };
}
