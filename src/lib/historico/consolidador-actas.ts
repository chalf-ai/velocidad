/**
 * CONSOLIDADOR HISTÓRICO ACTAS — específico, lógica pura.
 *
 * Toma cortes Actas parseados por `parseActasBuffer` y mantiene un estado
 * consolidado por VIN aplicando MergePolicy Actas. Inmutable conceptualmente:
 * cada aplicación de corte devuelve una nueva instancia del histórico.
 *
 * Diferencias respecto al consolidador ROMA:
 *   - Llave canónica: VIN (no VentaID).
 *   - Vistas vivo/histórico declarativas, sin duplicar storage.
 *   - Reporte de cumplimiento operacional con desglose por sucursal/marca/
 *     responsable.
 *   - Clasificación de huérfanos en 4 tipos (incluye Tipo 3 "desaparecidos"
 *     que requiere visión histórica).
 *   - Reserva del Eje 3 (Calidad de Cierre) — campo definido pero no
 *     poblado en este sprint.
 *
 * Cero dependencias de Prisma, store, React, fs ni red.
 */

import {
  mergeActasRows,
  type ActasMergeContext,
  type ActasMergeWarning,
  type ActasWarningKind,
  type CalidadCierre,
} from "./merge-policy-actas.js";
import type { ActasRowMerge, NivelDocumental, ResultadoIngestaActas } from "./parser-actas.js";

// ─────────────────────────────────────────────────────────────────────────────
// Versionado del esquema
// ─────────────────────────────────────────────────────────────────────────────

export const HISTORICO_ACTAS_SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Re-export de la reserva del Eje 3
// ─────────────────────────────────────────────────────────────────────────────

export type { CalidadCierre };

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del histórico
// ─────────────────────────────────────────────────────────────────────────────

export interface CambioCampoActas {
  campo: keyof ActasRowMerge;
  valorPrevio: unknown;
  valorNuevo: unknown;
  corteId: string;
}

export interface EntradaActas {
  /** Estado actual consolidado del VIN. */
  row: ActasRowMerge;

  /** Corte cuyo timestamp es el más reciente entre los que aportaron datos. */
  corteIdEvolutivo: string;
  corteFechaEvolutivo: Date;

  /** Corte donde apareció por primera vez este VIN. */
  corteIdOrigen: string;
  corteFechaOrigen: Date;

  /** Corte donde se vio por última vez (no necesariamente == evolutivo). */
  corteIdUltimoVisto: string;
  corteFechaUltimoVisto: Date;

  /** Lista de corteIds donde apareció este VIN, en orden de aplicación. */
  presenteEn: string[];

  /** Cambios clave en campos críticos a lo largo de la vida del VIN. */
  cambiosClave: CambioCampoActas[];

  /**
   * Reserva del Eje 3 (Calidad de Cierre).
   * En este sprint queda en undefined; el cruce ROMA↔Actas lo poblará.
   */
  calidadCierre?: CalidadCierre;
}

export interface CorteActasAplicado {
  corteId: string;
  corteFecha: Date;
  archivoNombre: string;
  archivoSize: number;
  fechaAplicacion: Date;
  filasAplicadas: number;
  warningsGenerados: number;
}

export interface HistoricoActas {
  entradas: Map<string, EntradaActas>;
  cortes: CorteActasAplicado[];
  schemaVersion: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Severidad y categoría de warnings (específicas Actas)
// ─────────────────────────────────────────────────────────────────────────────

export type SeveridadActas = "info" | "advertencia" | "crítica";
export type CategoriaActas =
  | "conflicto_de_origen"
  | "evolucion_anormal"
  | "preservacion_aplicada"
  | "orden_temporal"
  | "llave_invalida"
  | "documental"
  | "valor_factura";

export const SEVERIDAD_POR_KIND_ACTAS: Record<ActasWarningKind, SeveridadActas> = {
  INMUTABLE_CHANGED: "crítica",
  INMUTABLE_MIN_DATE_CONFLICT: "advertencia",
  NULL_OVERWRITE_PREVENTED: "info",
  CORTE_ANTERIOR_OUT_OF_ORDER: "advertencia",
  INSCRIPCION_REGRESSION: "advertencia",
  ENTREGA_REGRESSION_TXT: "crítica",
  VALOR_FACTURA_CAMBIADO: "advertencia",
  ETAPA_RETROCEDIO: "advertencia",
  TRINARIO_DEGRADACION_PREVENIDA: "info",
};

export const CATEGORIA_POR_KIND_ACTAS: Record<ActasWarningKind, CategoriaActas> = {
  INMUTABLE_CHANGED: "llave_invalida",
  INMUTABLE_MIN_DATE_CONFLICT: "conflicto_de_origen",
  NULL_OVERWRITE_PREVENTED: "preservacion_aplicada",
  CORTE_ANTERIOR_OUT_OF_ORDER: "orden_temporal",
  INSCRIPCION_REGRESSION: "documental",
  ENTREGA_REGRESSION_TXT: "evolucion_anormal",
  VALOR_FACTURA_CAMBIADO: "valor_factura",
  ETAPA_RETROCEDIO: "evolucion_anormal",
  TRINARIO_DEGRADACION_PREVENIDA: "preservacion_aplicada",
};

export interface ActasMergeWarningEnriquecido extends ActasMergeWarning {
  severidad: SeveridadActas;
  categoria: CategoriaActas;
}

function enriquecerWarning(w: ActasMergeWarning): ActasMergeWarningEnriquecido {
  return {
    ...w,
    severidad: SEVERIDAD_POR_KIND_ACTAS[w.kind],
    categoria: CATEGORIA_POR_KIND_ACTAS[w.kind],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resultado de aplicación
// ─────────────────────────────────────────────────────────────────────────────

export interface ResumenAplicacionActas {
  corteId: string;
  vinsNuevos: number;
  vinsActualizados: number;
  vinsSinCambio: number;
  vinsEnConflicto: number;
  vinsDesaparecidos: number;
  warningsCount: number;
  msec: number;
}

export interface DesaparecidoEvento {
  vin: string;
  ultimoCorteId: string;
  ultimoCorteFecha: Date;
  entregadoEnUltimoCorte: boolean;
}

export interface ResultadoAplicacionActas {
  historico: HistoricoActas;
  resumen: ResumenAplicacionActas;
  warnings: ActasMergeWarningEnriquecido[];
  desaparecidos: DesaparecidoEvento[];
}

export interface AplicarCorteActasOpts {
  onWarningCritico?: (w: ActasMergeWarningEnriquecido) => void;
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

/** Campos cuyo cambio nos importa registrar en cambiosClave. */
const CAMPOS_CLAVE_REGISTRABLES: Array<keyof ActasRowMerge> = [
  "entregado",
  "fEntregaReal",
  "fPatenteRecibida",
  "fInscripcion",
  "fFactura",
  "entregaAutoTxt",
  "autorizacionEntrega",
  "solEntrega",
  "nivelDocumental",
  "etapa",
];

function detectarCambiosClave(
  prev: ActasRowMerge,
  next: ActasRowMerge,
  corteId: string,
): CambioCampoActas[] {
  const out: CambioCampoActas[] = [];
  for (const k of CAMPOS_CLAVE_REGISTRABLES) {
    if (!valuesEqual(prev[k], next[k])) {
      out.push({ campo: k, valorPrevio: prev[k], valorNuevo: next[k], corteId });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// API: construcción y consulta
// ─────────────────────────────────────────────────────────────────────────────

export function crearHistoricoActasVacio(): HistoricoActas {
  return {
    entradas: new Map(),
    cortes: [],
    schemaVersion: HISTORICO_ACTAS_SCHEMA_VERSION,
  };
}

export function obtenerEntradaActas(historico: HistoricoActas, vin: string): EntradaActas | null {
  return historico.entradas.get(vin) ?? null;
}

/** Vista "vivo": VINs presentes en el último corte aplicado. */
export function vistaActasVivo(historico: HistoricoActas): EntradaActas[] {
  if (historico.cortes.length === 0) return [];
  const ultimo = historico.cortes[historico.cortes.length - 1].corteId;
  const out: EntradaActas[] = [];
  for (const e of historico.entradas.values()) {
    if (e.corteIdUltimoVisto === ultimo) out.push(e);
  }
  return out;
}

/** Vista "histórico": todos los VINs acumulados. */
export function vistaActasHistorico(historico: HistoricoActas): EntradaActas[] {
  return [...historico.entradas.values()];
}

/** VINs desaparecidos en el último corte (estaban antes y ya no). */
export function vinsDesaparecidos(historico: HistoricoActas): DesaparecidoEvento[] {
  if (historico.cortes.length < 2) return [];
  const ultimo = historico.cortes[historico.cortes.length - 1].corteId;
  const out: DesaparecidoEvento[] = [];
  for (const e of historico.entradas.values()) {
    if (e.corteIdUltimoVisto !== ultimo) {
      out.push({
        vin: e.row.vin,
        ultimoCorteId: e.corteIdUltimoVisto,
        ultimoCorteFecha: e.corteFechaUltimoVisto,
        entregadoEnUltimoCorte: e.row.entregado,
      });
    }
  }
  return out;
}

/** Útil para el cruce posterior con ROMA. */
export function mapByVin(historico: HistoricoActas): Map<string, EntradaActas> {
  return new Map(historico.entradas);
}

// ─────────────────────────────────────────────────────────────────────────────
// API: aplicar UN corte
// ─────────────────────────────────────────────────────────────────────────────

export function aplicarCorteActas(
  historico: HistoricoActas,
  corte: ResultadoIngestaActas,
  opts: AplicarCorteActasOpts = {},
): ResultadoAplicacionActas {
  const inicio = Date.now();
  const corteId = corte.corte.id;
  const corteFecha = corte.corte.fecha ?? new Date(0);
  const onCritico = opts.onWarningCritico;

  const entradas = new Map(historico.entradas);
  const warningsAcum: ActasMergeWarningEnriquecido[] = [];
  let nuevos = 0;
  let actualizados = 0;
  let sinCambio = 0;
  let enConflicto = 0;

  // Para detección de desaparecidos: VINs que estaban antes de este corte
  const vinsAntesDeEsteCorte = new Set<string>();
  for (const e of entradas.values()) {
    vinsAntesDeEsteCorte.add(e.row.vin);
  }

  const vinsEnCorteActual = new Set<string>();

  for (const fila of corte.filas) {
    const vin = fila.vin;
    vinsEnCorteActual.add(vin);
    const previa = entradas.get(vin);

    if (!previa) {
      // Primera aparición
      const entrada: EntradaActas = {
        row: { ...fila },
        corteIdOrigen: corteId,
        corteFechaOrigen: corteFecha,
        corteIdEvolutivo: corteId,
        corteFechaEvolutivo: corteFecha,
        corteIdUltimoVisto: corteId,
        corteFechaUltimoVisto: corteFecha,
        presenteEn: [corteId],
        cambiosClave: [],
      };
      entradas.set(vin, entrada);
      nuevos++;
      continue;
    }

    // Mismo corte aplicado dos veces (idempotencia)
    if (previa.presenteEn.includes(corteId)) {
      sinCambio++;
      continue;
    }

    const ctx: ActasMergeContext = {
      corteId,
      corteFecha,
      cortePrevioId: previa.corteIdEvolutivo,
      cortePrevioFecha: previa.corteFechaEvolutivo,
    };
    const { merged, warnings } = mergeActasRows(previa.row, fila, ctx);
    const enriquecidos = warnings.map(enriquecerWarning);
    warningsAcum.push(...enriquecidos);
    if (onCritico) {
      for (const w of enriquecidos) if (w.severidad === "crítica") onCritico(w);
    }
    if (enriquecidos.some((w) => w.severidad === "crítica")) enConflicto++;

    const cambios = detectarCambiosClave(previa.row, merged, corteId);
    const esMasReciente = corteFecha.getTime() > previa.corteFechaEvolutivo.getTime();
    const nuevaEntrada: EntradaActas = {
      row: merged,
      corteIdOrigen: previa.corteIdOrigen,
      corteFechaOrigen: previa.corteFechaOrigen,
      corteIdEvolutivo: esMasReciente ? corteId : previa.corteIdEvolutivo,
      corteFechaEvolutivo: esMasReciente ? corteFecha : previa.corteFechaEvolutivo,
      corteIdUltimoVisto: corteId,
      corteFechaUltimoVisto: corteFecha,
      presenteEn: [...previa.presenteEn, corteId],
      cambiosClave: [...previa.cambiosClave, ...cambios],
      calidadCierre: previa.calidadCierre, // reservado
    };
    entradas.set(vin, nuevaEntrada);
    if (cambios.length > 0) actualizados++;
    else sinCambio++;
  }

  // Detectar desaparecidos: estaban antes pero no en este corte
  const desaparecidos: DesaparecidoEvento[] = [];
  for (const vin of vinsAntesDeEsteCorte) {
    if (!vinsEnCorteActual.has(vin)) {
      const e = entradas.get(vin);
      if (!e) continue;
      desaparecidos.push({
        vin,
        ultimoCorteId: e.corteIdUltimoVisto,
        ultimoCorteFecha: e.corteFechaUltimoVisto,
        entregadoEnUltimoCorte: e.row.entregado,
      });
    }
  }

  const duracion = Date.now() - inicio;

  const corteAplicado: CorteActasAplicado = {
    corteId,
    corteFecha,
    archivoNombre: corte.corte.archivoNombre,
    archivoSize: corte.corte.archivoSize,
    fechaAplicacion: new Date(),
    filasAplicadas: corte.filas.length,
    warningsGenerados: warningsAcum.length,
  };

  const historicoNuevo: HistoricoActas = {
    entradas,
    cortes: [...historico.cortes, corteAplicado],
    schemaVersion: historico.schemaVersion,
  };

  const resumen: ResumenAplicacionActas = {
    corteId,
    vinsNuevos: nuevos,
    vinsActualizados: actualizados,
    vinsSinCambio: sinCambio,
    vinsEnConflicto: enConflicto,
    vinsDesaparecidos: desaparecidos.length,
    warningsCount: warningsAcum.length,
    msec: duracion,
  };

  return {
    historico: historicoNuevo,
    resumen,
    warnings: warningsAcum,
    desaparecidos,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// API: aplicar N cortes
// ─────────────────────────────────────────────────────────────────────────────

export function aplicarCortesActas(
  historico: HistoricoActas,
  cortes: ResultadoIngestaActas[],
  opts: AplicarCorteActasOpts = {},
): {
  historicoFinal: HistoricoActas;
  resultados: ResultadoAplicacionActas[];
} {
  let acc = historico;
  const resultados: ResultadoAplicacionActas[] = [];
  for (const c of cortes) {
    const r = aplicarCorteActas(acc, c, opts);
    resultados.push(r);
    acc = r.historico;
  }
  return { historicoFinal: acc, resultados };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agrupación de warnings
// ─────────────────────────────────────────────────────────────────────────────

export interface AgrupacionWarningsActas {
  total: number;
  porSeveridad: Record<SeveridadActas, number>;
  porCategoria: Record<CategoriaActas, number>;
  porCampo: Record<string, number>;
  porVin: Map<string, ActasMergeWarningEnriquecido[]>;
}

export function agruparWarningsActas(ws: ActasMergeWarningEnriquecido[]): AgrupacionWarningsActas {
  const porSeveridad: Record<SeveridadActas, number> = { info: 0, advertencia: 0, "crítica": 0 };
  const porCategoria: Record<CategoriaActas, number> = {
    conflicto_de_origen: 0,
    evolucion_anormal: 0,
    preservacion_aplicada: 0,
    orden_temporal: 0,
    llave_invalida: 0,
    documental: 0,
    valor_factura: 0,
  };
  const porCampo: Record<string, number> = {};
  const porVin = new Map<string, ActasMergeWarningEnriquecido[]>();
  for (const w of ws) {
    porSeveridad[w.severidad]++;
    porCategoria[w.categoria]++;
    porCampo[w.field as string] = (porCampo[w.field as string] ?? 0) + 1;
    if (!porVin.has(w.vin)) porVin.set(w.vin, []);
    porVin.get(w.vin)!.push(w);
  }
  return { total: ws.length, porSeveridad, porCategoria, porCampo, porVin };
}

export function topVinsProblematicos(
  ws: ActasMergeWarningEnriquecido[],
  limit: number,
): { vin: string; count: number; categorias: CategoriaActas[] }[] {
  const m = new Map<string, { count: number; categorias: Set<CategoriaActas> }>();
  for (const w of ws) {
    if (!m.has(w.vin)) m.set(w.vin, { count: 0, categorias: new Set() });
    const x = m.get(w.vin)!;
    x.count++;
    x.categorias.add(w.categoria);
  }
  return [...m.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([vin, x]) => ({ vin, count: x.count, categorias: [...x.categorias] }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Clasificación de huérfanos (4 tipos)
// ─────────────────────────────────────────────────────────────────────────────

export interface HuerfanosClasificados {
  tipo1ProbableEntregaNoRegistrada: Array<{ vin: string; ultimoCorte: string; razon: string }>;
  tipo2EntregadoConCierreInconsistente: Array<{ vin: string; ultimoCorte: string; razon: string }>;
  tipo3Desaparecidos: Array<{
    vin: string;
    ultimoVisto: string;
    estadoUltimo: string;
    entregadoEnUltimoCorte: boolean;
  }>;
  tipo4InconsistenciaTemporal: Array<{
    vin: string;
    campo: string;
    detalle: string;
    corteId: string;
  }>;
}

export function clasificarHuerfanosActas(historico: HistoricoActas): HuerfanosClasificados {
  const out: HuerfanosClasificados = {
    tipo1ProbableEntregaNoRegistrada: [],
    tipo2EntregadoConCierreInconsistente: [],
    tipo3Desaparecidos: [],
    tipo4InconsistenciaTemporal: [],
  };

  if (historico.cortes.length === 0) return out;
  const ultimoCorteId = historico.cortes[historico.cortes.length - 1].corteId;

  for (const e of historico.entradas.values()) {
    const r = e.row;
    const aut = (r.autorizacionEntrega ?? "").trim();
    const sol = (r.solEntrega ?? "").trim();

    // Tipo 1: no entregado + inscripción + sin autorización ni solicitud
    if (!r.entregado && r.fInscripcion) {
      if ((aut === "" || aut === "No") && (sol === "" || sol === "No")) {
        out.tipo1ProbableEntregaNoRegistrada.push({
          vin: r.vin,
          ultimoCorte: e.corteIdUltimoVisto,
          razon: "fInscripcion presente sin autorización ni solicitud de entrega.",
        });
      }
    }

    // Tipo 2: entregado sin inscripción → cierre inconsistente
    if (r.entregado && !r.fInscripcion) {
      out.tipo2EntregadoConCierreInconsistente.push({
        vin: r.vin,
        ultimoCorte: e.corteIdUltimoVisto,
        razon: "Entregado pero sin fInscripcion (cierre documental inconsistente).",
      });
    }

    // Tipo 3: desaparecido (estaba en cortes previos pero no en el último)
    if (e.corteIdUltimoVisto !== ultimoCorteId) {
      out.tipo3Desaparecidos.push({
        vin: r.vin,
        ultimoVisto: e.corteIdUltimoVisto,
        estadoUltimo: r.estadoEntregaOriginal ?? r.entregaAutoTxt ?? "(sin estado)",
        entregadoEnUltimoCorte: r.entregado,
      });
    }

    // Tipo 4: inconsistencias temporales (fechas que retroceden en cambiosClave)
    for (const c of e.cambiosClave) {
      if (
        (c.campo === "fInscripcion" ||
          c.campo === "fFactura" ||
          c.campo === "fEntregaReal" ||
          c.campo === "fPatenteRecibida") &&
        c.valorPrevio instanceof Date &&
        c.valorNuevo instanceof Date &&
        c.valorNuevo.getTime() < c.valorPrevio.getTime()
      ) {
        out.tipo4InconsistenciaTemporal.push({
          vin: r.vin,
          campo: c.campo as string,
          detalle: `Fecha retrocede ${c.valorPrevio.toISOString().slice(0, 10)} → ${c.valorNuevo.toISOString().slice(0, 10)}.`,
          corteId: c.corteId,
        });
      }
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reporte de cumplimiento operacional con desgloses
// ─────────────────────────────────────────────────────────────────────────────

export interface MetricasCumplimientoBloque {
  universo: number;
  entregados: number;
  noEntregados: number;
  entregadosSinPatenteRecibida: number;
  entregadosSinAutorizacion: number;
  entregadosSinSolicitudEntrega: number;
  entregadosSinFechaEntregaReal: number;
  porNivelDocumental: Record<NivelDocumental, number>;
}

export interface ReporteCumplimientoActas {
  universoEvaluado: number;
  global: MetricasCumplimientoBloque;
  ciclo: {
    medianasDias: {
      ventaAFactura: number | null;
      facturaAInscripcion: number | null;
      inscripcionAPatente: number | null;
      patenteAEntrega: number | null;
      ventaAEntrega: number | null;
    };
    p90Dias: {
      ventaAFactura: number | null;
      facturaAInscripcion: number | null;
      inscripcionAPatente: number | null;
      patenteAEntrega: number | null;
      ventaAEntrega: number | null;
    };
  };
  porSucursal?: Array<MetricasCumplimientoBloque & { sucursal: string }>;
  porResponsable?: Array<MetricasCumplimientoBloque & { responsable: string }>;
}

export interface OpcionesCumplimiento {
  /** Default true. Si false, evalúa todo el histórico. */
  soloVivos?: boolean;
  porSucursal?: boolean;
  porResponsable?: boolean;
}

function bloqueVacio(): MetricasCumplimientoBloque {
  return {
    universo: 0,
    entregados: 0,
    noEntregados: 0,
    entregadosSinPatenteRecibida: 0,
    entregadosSinAutorizacion: 0,
    entregadosSinSolicitudEntrega: 0,
    entregadosSinFechaEntregaReal: 0,
    porNivelDocumental: { completo: 0, parcial: 0, minimo: 0 },
  };
}

function acumularEnBloque(b: MetricasCumplimientoBloque, r: ActasRowMerge): void {
  b.universo++;
  if (r.entregado) b.entregados++;
  else b.noEntregados++;
  b.porNivelDocumental[r.nivelDocumental]++;
  if (r.entregado) {
    if (!r.fPatenteRecibida) b.entregadosSinPatenteRecibida++;
    if ((r.autorizacionEntrega ?? "").trim() !== "Si") b.entregadosSinAutorizacion++;
    if ((r.solEntrega ?? "").trim() !== "Si") b.entregadosSinSolicitudEntrega++;
    if (!r.fEntregaReal) b.entregadosSinFechaEntregaReal++;
  }
}

const MS_DIA = 86_400_000;

function diasEntre(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  const diff = (b.getTime() - a.getTime()) / MS_DIA;
  return diff >= 0 ? diff : null;
}

function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? +(((s[mid - 1] + s[mid]) / 2).toFixed(1)) : +s[mid].toFixed(1);
}

function p90(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor(s.length * 0.9));
  return +s[idx].toFixed(1);
}

export function calcularCumplimientoActas(
  historico: HistoricoActas,
  opts: OpcionesCumplimiento = {},
): ReporteCumplimientoActas {
  const soloVivos = opts.soloVivos !== false;
  const universo = soloVivos ? vistaActasVivo(historico) : vistaActasHistorico(historico);

  const global = bloqueVacio();
  const porSucursal = new Map<string, MetricasCumplimientoBloque>();
  const porResponsable = new Map<string, MetricasCumplimientoBloque>();

  const dVF: number[] = [];
  const dFI: number[] = [];
  const dIP: number[] = [];
  const dPE: number[] = [];
  const dVE: number[] = [];

  for (const e of universo) {
    const r = e.row;
    acumularEnBloque(global, r);

    if (opts.porSucursal) {
      const key = r.sucursal ?? "(sin sucursal)";
      if (!porSucursal.has(key)) porSucursal.set(key, bloqueVacio());
      acumularEnBloque(porSucursal.get(key)!, r);
    }
    if (opts.porResponsable) {
      const key = r.vendedor ?? "(sin vendedor)";
      if (!porResponsable.has(key)) porResponsable.set(key, bloqueVacio());
      acumularEnBloque(porResponsable.get(key)!, r);
    }

    // Métricas de ciclo
    const vf = diasEntre(r.fVenta, r.fFactura);
    const fi = diasEntre(r.fFactura, r.fInscripcion);
    const ip = diasEntre(r.fInscripcion, r.fPatenteRecibida);
    const pe = diasEntre(r.fPatenteRecibida, r.fEntregaReal);
    const ve = diasEntre(r.fVenta, r.fEntregaReal);
    if (vf !== null) dVF.push(vf);
    if (fi !== null) dFI.push(fi);
    if (ip !== null) dIP.push(ip);
    if (pe !== null) dPE.push(pe);
    if (ve !== null) dVE.push(ve);
  }

  return {
    universoEvaluado: universo.length,
    global,
    ciclo: {
      medianasDias: {
        ventaAFactura: mediana(dVF),
        facturaAInscripcion: mediana(dFI),
        inscripcionAPatente: mediana(dIP),
        patenteAEntrega: mediana(dPE),
        ventaAEntrega: mediana(dVE),
      },
      p90Dias: {
        ventaAFactura: p90(dVF),
        facturaAInscripcion: p90(dFI),
        inscripcionAPatente: p90(dIP),
        patenteAEntrega: p90(dPE),
        ventaAEntrega: p90(dVE),
      },
    },
    porSucursal: opts.porSucursal
      ? [...porSucursal.entries()]
          .map(([sucursal, b]) => ({ sucursal, ...b }))
          .sort((a, b) => b.universo - a.universo)
      : undefined,
    porResponsable: opts.porResponsable
      ? [...porResponsable.entries()]
          .map(([responsable, b]) => ({ responsable, ...b }))
          .sort((a, b) => b.universo - a.universo)
      : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Descripción
// ─────────────────────────────────────────────────────────────────────────────

export interface DescripcionHistoricoActas {
  totalVins: number;
  totalCortes: number;
  vinsPorCorte: Map<string, number>;
  cortesPorVin: { min: number; max: number; mediana: number };
  cubrePeriodo: { desde: Date; hasta: Date } | null;
  vinsEnUltimoCorte: number;
  vinsDesaparecidos: number;
}

export function describirHistoricoActas(historico: HistoricoActas): DescripcionHistoricoActas {
  const vinsPorCorte = new Map<string, number>();
  for (const c of historico.cortes) vinsPorCorte.set(c.corteId, 0);
  const cuentaPorVin: number[] = [];
  let minF: number | null = null;
  let maxF: number | null = null;
  const ultimo = historico.cortes.length > 0
    ? historico.cortes[historico.cortes.length - 1].corteId
    : null;
  let vinsEnUltimo = 0;
  let desap = 0;

  for (const e of historico.entradas.values()) {
    for (const cid of e.presenteEn) {
      vinsPorCorte.set(cid, (vinsPorCorte.get(cid) ?? 0) + 1);
    }
    cuentaPorVin.push(e.presenteEn.length);
    const t = e.row.fFactura?.getTime() ?? null;
    if (t !== null) {
      if (minF === null || t < minF) minF = t;
      if (maxF === null || t > maxF) maxF = t;
    }
    if (ultimo) {
      if (e.corteIdUltimoVisto === ultimo) vinsEnUltimo++;
      else desap++;
    }
  }

  cuentaPorVin.sort((a, b) => a - b);
  const med = cuentaPorVin.length === 0 ? 0 : cuentaPorVin[Math.floor(cuentaPorVin.length / 2)];

  return {
    totalVins: historico.entradas.size,
    totalCortes: historico.cortes.length,
    vinsPorCorte,
    cortesPorVin: {
      min: cuentaPorVin[0] ?? 0,
      max: cuentaPorVin[cuentaPorVin.length - 1] ?? 0,
      mediana: med,
    },
    cubrePeriodo:
      minF !== null && maxF !== null
        ? { desde: new Date(minF), hasta: new Date(maxF) }
        : null,
    vinsEnUltimoCorte: vinsEnUltimo,
    vinsDesaparecidos: desap,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialización JSON-plana
// ─────────────────────────────────────────────────────────────────────────────

type SerializedActasRow = {
  [K in keyof ActasRowMerge]: ActasRowMerge[K] extends Date | null | undefined
    ? string | null
    : ActasRowMerge[K];
};

const DATE_FIELDS_ACTAS: Array<keyof ActasRowMerge> = [
  "fVenta",
  "fFactura",
  "fSolicitudInscripcion",
  "fInscripcion",
  "fPatenteAdmin",
  "fPatenteEnviada",
  "fPatenteRecibida",
  "fPatenteEntregada",
  "fEntregaReal",
  "fDocListoDerivado",
];

function rowToSerialized(row: ActasRowMerge): SerializedActasRow {
  const out: Record<string, unknown> = {};
  const dateSet = new Set<string>(DATE_FIELDS_ACTAS as string[]);
  for (const k of Object.keys(row) as Array<keyof ActasRowMerge>) {
    const v = row[k];
    if (dateSet.has(k as string)) {
      out[k] = v instanceof Date ? v.toISOString() : null;
    } else {
      out[k] = v ?? null;
    }
  }
  return out as SerializedActasRow;
}

function rowFromSerialized(s: SerializedActasRow): ActasRowMerge {
  const out: Record<string, unknown> = {};
  const dateSet = new Set<string>(DATE_FIELDS_ACTAS as string[]);
  for (const k of Object.keys(s) as Array<keyof ActasRowMerge>) {
    const v = s[k];
    if (dateSet.has(k as string) && typeof v === "string") {
      const d = new Date(v);
      out[k] = Number.isFinite(d.getTime()) ? d : null;
    } else if (dateSet.has(k as string)) {
      out[k] = null;
    } else {
      out[k] = v;
    }
  }
  return out as unknown as ActasRowMerge;
}

export interface SerializedHistoricoActas {
  schemaVersion: number;
  cortes: Array<{
    corteId: string;
    corteFecha: string;
    archivoNombre: string;
    archivoSize: number;
    fechaAplicacion: string;
    filasAplicadas: number;
    warningsGenerados: number;
  }>;
  entradas: Array<{
    vin: string;
    row: SerializedActasRow;
    corteIdOrigen: string;
    corteFechaOrigen: string;
    corteIdEvolutivo: string;
    corteFechaEvolutivo: string;
    corteIdUltimoVisto: string;
    corteFechaUltimoVisto: string;
    presenteEn: string[];
    cambiosClave: Array<{
      campo: string;
      valorPrevio: unknown;
      valorNuevo: unknown;
      corteId: string;
    }>;
    calidadCierre?: CalidadCierre;
  }>;
}

function serializeCambioClave(c: CambioCampoActas): {
  campo: string;
  valorPrevio: unknown;
  valorNuevo: unknown;
  corteId: string;
} {
  const vp = c.valorPrevio instanceof Date ? c.valorPrevio.toISOString() : c.valorPrevio ?? null;
  const vn = c.valorNuevo instanceof Date ? c.valorNuevo.toISOString() : c.valorNuevo ?? null;
  return { campo: c.campo as string, valorPrevio: vp, valorNuevo: vn, corteId: c.corteId };
}

function deserializeCambioClave(c: {
  campo: string;
  valorPrevio: unknown;
  valorNuevo: unknown;
  corteId: string;
}): CambioCampoActas {
  const tryDate = (v: unknown): unknown => {
    if (typeof v !== "string") return v;
    // Heurística: solo intenta parsear ISO con formato YYYY-MM-DDTHH:MM:SS
    if (!/^\d{4}-\d{2}-\d{2}T/.test(v)) return v;
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : v;
  };
  return {
    campo: c.campo as keyof ActasRowMerge,
    valorPrevio: tryDate(c.valorPrevio),
    valorNuevo: tryDate(c.valorNuevo),
    corteId: c.corteId,
  };
}

export function serializarHistoricoActas(historico: HistoricoActas): SerializedHistoricoActas {
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
    entradas: [...historico.entradas.entries()].map(([vin, e]) => ({
      vin,
      row: rowToSerialized(e.row),
      corteIdOrigen: e.corteIdOrigen,
      corteFechaOrigen: e.corteFechaOrigen.toISOString(),
      corteIdEvolutivo: e.corteIdEvolutivo,
      corteFechaEvolutivo: e.corteFechaEvolutivo.toISOString(),
      corteIdUltimoVisto: e.corteIdUltimoVisto,
      corteFechaUltimoVisto: e.corteFechaUltimoVisto.toISOString(),
      presenteEn: [...e.presenteEn],
      cambiosClave: e.cambiosClave.map(serializeCambioClave),
      calidadCierre: e.calidadCierre,
    })),
  };
}

export function deserializarHistoricoActas(json: SerializedHistoricoActas): HistoricoActas {
  const entradas = new Map<string, EntradaActas>();
  for (const e of json.entradas) {
    entradas.set(e.vin, {
      row: rowFromSerialized(e.row),
      corteIdOrigen: e.corteIdOrigen,
      corteFechaOrigen: new Date(e.corteFechaOrigen),
      corteIdEvolutivo: e.corteIdEvolutivo,
      corteFechaEvolutivo: new Date(e.corteFechaEvolutivo),
      corteIdUltimoVisto: e.corteIdUltimoVisto,
      corteFechaUltimoVisto: new Date(e.corteFechaUltimoVisto),
      presenteEn: [...e.presenteEn],
      cambiosClave: e.cambiosClave.map(deserializeCambioClave),
      calidadCierre: e.calidadCierre,
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
