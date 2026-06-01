/**
 * SELECTORES DERIVADOS — Vista Histórica /velocidad-operacional.
 *
 * Funciones puras que reciben un `ResultadoCruce` (más filtros) y producen
 * los agregados que pinta la UI por eje. Cero React, cero side effects.
 *
 * Pensados para reusar fuera de la página (p.ej. validación headless contra
 * `validar-cruce-vs-csv.mjs`).
 */

import type {
  EntradaConsolidada,
  ResultadoCruce,
  CuelloPrincipal,
  BucketVelocidad,
  BandaCumplimiento,
  SegmentoMasLento,
  ConflictoKind,
} from "./cruce-roma-actas.js";
import type { CalidadCierre } from "./consolidador-actas.js";
import type { NivelDocumental } from "./parser-actas.js";
import { normalizarMarcaOperacional } from "../selectors/owner-operacional";

// ─────────────────────────────────────────────────────────────────────────────
// Filtros
// ─────────────────────────────────────────────────────────────────────────────

export type FiltroEntregado = "todos" | "si" | "no";
export type FiltroCalidad = "todas" | CalidadCierre | "no_evaluable";
export type FiltroCuello = "todos" | CuelloPrincipal;

export interface FiltrosVista {
  marca: string | null;        // null = todas
  sucursal: string | null;
  vendedor: string | null;
  entregado: FiltroEntregado;
  calidadCierre: FiltroCalidad;
  cuelloPrincipal: FiltroCuello;
}

export const FILTROS_VACIOS: FiltrosVista = {
  marca: null,
  sucursal: null,
  vendedor: null,
  entregado: "todos",
  calidadCierre: "todas",
  cuelloPrincipal: "todos",
};

export function filtrarFilas(
  cruce: ResultadoCruce,
  f: FiltrosVista,
): EntradaConsolidada[] {
  // Pre-computar el objetivo de marca normalizado UNA vez fuera del loop
  // para que el matching tolere variantes de casing/espacios entre el filtro
  // (que puede venir del header global con valores canónicos como "GEELY"
  // o "KIA MOTORS") y los strings literales del row (que vienen del archivo).
  const marcaObjetivo = f.marca ? normalizarMarcaOperacional(f.marca) : null;
  const out: EntradaConsolidada[] = [];
  for (const r of cruce.filas) {
    if (marcaObjetivo && normalizarMarcaOperacional(r.marca) !== marcaObjetivo) continue;
    if (f.sucursal && r.sucursal !== f.sucursal) continue;
    if (f.vendedor && r.vendedor !== f.vendedor) continue;
    if (f.entregado === "si" && !r.entregado) continue;
    if (f.entregado === "no" && r.entregado) continue;
    if (f.calidadCierre !== "todas") {
      const cc = r.ejeCalidadCierre ?? "no_evaluable";
      if (cc !== f.calidadCierre) continue;
    }
    if (f.cuelloPrincipal !== "todos" && r.cuelloPrincipal !== f.cuelloPrincipal) continue;
    out.push(r);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Estadísticos
// ─────────────────────────────────────────────────────────────────────────────

function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function p90(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
}

function promedio(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Eje 1 — Velocidad
// ─────────────────────────────────────────────────────────────────────────────

export interface AgregadoVelocidad {
  totalCasos: number;
  diasTotales: {
    promedio: number | null;
    mediana: number | null;
    p90: number | null;
    nConDatos: number;
  };
  distribucionCuello: Array<{ cuello: CuelloPrincipal; cantidad: number; pct: number }>;
  distribucionVelocidad: Record<BucketVelocidad, number>;
  distribucionSegmento: Record<SegmentoMasLento, number>;
}

export function agregadosEje1(filas: EntradaConsolidada[]): AgregadoVelocidad {
  const total = filas.length;
  const dias: number[] = [];
  const cuelloCount = new Map<CuelloPrincipal, number>();
  const velCount: Record<BucketVelocidad, number> = {
    rapido: 0, normal: 0, lento: 0, muy_lento: 0, sin_datos: 0,
  };
  const segCount: Record<SegmentoMasLento, number> = {
    logistica: 0, control_negocio: 0, espera_cliente: 0, sin_datos: 0,
  };

  for (const f of filas) {
    if (f.diasTotales != null) dias.push(f.diasTotales);
    cuelloCount.set(f.cuelloPrincipal, (cuelloCount.get(f.cuelloPrincipal) ?? 0) + 1);
    velCount[f.ejeVelocidad.bucket]++;
    segCount[f.ejeVelocidad.segmentoMasLento]++;
  }

  const distribucionCuello = [...cuelloCount.entries()]
    .map(([cuello, cantidad]) => ({
      cuello,
      cantidad,
      pct: total > 0 ? +((cantidad / total) * 100).toFixed(2) : 0,
    }))
    .sort((a, b) => b.cantidad - a.cantidad);

  return {
    totalCasos: total,
    diasTotales: {
      promedio: promedio(dias) !== null ? +promedio(dias)!.toFixed(1) : null,
      mediana: mediana(dias),
      p90: p90(dias),
      nConDatos: dias.length,
    },
    distribucionCuello,
    distribucionVelocidad: velCount,
    distribucionSegmento: segCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Eje 2 — Cumplimiento Operacional
// ─────────────────────────────────────────────────────────────────────────────

export interface BloqueCumplimiento {
  universo: number;
  entregados: number;
  noEntregados: number;
  porNivelDocumental: Record<NivelDocumental, number>;
  porBanda: Record<BandaCumplimiento, number>;
  entregadosSinPatenteRecibida: number;
  entregadosSinAutorizacion: number;
  entregadosSinSolicitudEntrega: number;
}

export interface AgregadoCumplimiento {
  global: BloqueCumplimiento;
  porSucursal: Array<BloqueCumplimiento & { sucursal: string }>;
  porMarca: Array<BloqueCumplimiento & { marca: string }>;
  porResponsable: Array<BloqueCumplimiento & { responsable: string }>;
}

function bloqueVacio(): BloqueCumplimiento {
  return {
    universo: 0,
    entregados: 0,
    noEntregados: 0,
    porNivelDocumental: { completo: 0, parcial: 0, minimo: 0 },
    porBanda: { ok: 0, menor: 0, mayor: 0, no_evaluable: 0 },
    entregadosSinPatenteRecibida: 0,
    entregadosSinAutorizacion: 0,
    entregadosSinSolicitudEntrega: 0,
  };
}

function acumular(b: BloqueCumplimiento, f: EntradaConsolidada): void {
  b.universo++;
  if (f.entregado) b.entregados++; else b.noEntregados++;
  b.porNivelDocumental[f.nivelDocumental]++;
  b.porBanda[f.ejeCumplimiento.banda]++;
  if (f.entregado) {
    if (!f.fPatenteRecibida) b.entregadosSinPatenteRecibida++;
    if ((f.autorizacionEntrega ?? "").trim() !== "Si") b.entregadosSinAutorizacion++;
    if ((f.solEntrega ?? "").trim() !== "Si") b.entregadosSinSolicitudEntrega++;
  }
}

export function agregadosEje2(filas: EntradaConsolidada[]): AgregadoCumplimiento {
  const global = bloqueVacio();
  const porSucursal = new Map<string, BloqueCumplimiento>();
  const porMarca = new Map<string, BloqueCumplimiento>();
  const porResponsable = new Map<string, BloqueCumplimiento>();

  for (const f of filas) {
    acumular(global, f);

    const suc = f.sucursal ?? "(sin sucursal)";
    if (!porSucursal.has(suc)) porSucursal.set(suc, bloqueVacio());
    acumular(porSucursal.get(suc)!, f);

    const mar = f.marca ?? "(sin marca)";
    if (!porMarca.has(mar)) porMarca.set(mar, bloqueVacio());
    acumular(porMarca.get(mar)!, f);

    const ven = f.vendedor ?? "(sin vendedor)";
    if (!porResponsable.has(ven)) porResponsable.set(ven, bloqueVacio());
    acumular(porResponsable.get(ven)!, f);
  }

  return {
    global,
    porSucursal: [...porSucursal.entries()]
      .map(([sucursal, b]) => ({ sucursal, ...b }))
      .sort((a, b) => b.universo - a.universo),
    porMarca: [...porMarca.entries()]
      .map(([marca, b]) => ({ marca, ...b }))
      .sort((a, b) => b.universo - a.universo),
    porResponsable: [...porResponsable.entries()]
      .map(([responsable, b]) => ({ responsable, ...b }))
      .sort((a, b) => b.universo - a.universo),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Eje 3 — Calidad de Cierre
// ─────────────────────────────────────────────────────────────────────────────

export type TipoHuerfano = "tipo1" | "tipo2" | "tipo3" | "tipo4" | "otro";

export interface AgregadoCalidadCierre {
  distribucion: Record<CalidadCierre | "no_evaluable", number>;
  huerfanosPorTipo: Record<TipoHuerfano, number>;
  inconsistentesPorConflicto: Record<ConflictoKind, number>;
  /** Total filas con calidadCierre === "inconsistente". */
  totalInconsistentes: number;
  /** Total filas con calidadCierre === "huerfano". */
  totalHuerfanos: number;
}

/**
 * Reglas locales para mapear una fila huérfana a su tipo. Replican las
 * mismas categorías de `clasificarHuerfanosActas` pero aplicadas a la fila
 * cruzada (no al histórico Actas), y solo cuando `ejeCalidadCierre === "huerfano"`.
 *
 *   tipo1: no entregado + fInscripcion presente + sin aut/sol  → improbable acá,
 *          porque ejeCalidadCierre es undefined si no entregado. Reservado.
 *   tipo2: entregado sin fInscripcion (cierre inconsistente)
 *   tipo3: desaparecido en el último corte Actas (esActasUltimo === false).
 *          No tenemos esa señal en la fila cruzada; queda para fase futura.
 *          Aquí lo dejamos como "otro" hasta que se exponga.
 *   tipo4: entregado sin fEntregaReal y sin aut/sol → trazabilidad débil.
 */
export function inferirTipoHuerfano(f: EntradaConsolidada): TipoHuerfano {
  if (f.entregado && !f.fInscripcion) return "tipo2";
  if (
    f.entregado &&
    !f.fEntregaReal &&
    (f.autorizacionEntrega ?? "").trim() !== "Si" &&
    (f.solEntrega ?? "").trim() !== "Si"
  ) {
    return "tipo4";
  }
  if (!f.entregado && f.fInscripcion) {
    const aut = (f.autorizacionEntrega ?? "").trim();
    const sol = (f.solEntrega ?? "").trim();
    if ((aut === "" || aut === "No") && (sol === "" || sol === "No")) return "tipo1";
  }
  return "otro";
}

export function agregadosEje3(filas: EntradaConsolidada[]): AgregadoCalidadCierre {
  const distribucion: Record<CalidadCierre | "no_evaluable", number> = {
    correcto: 0,
    huerfano: 0,
    inconsistente: 0,
    no_evaluable: 0,
  };
  const huerfanosPorTipo: Record<TipoHuerfano, number> = {
    tipo1: 0, tipo2: 0, tipo3: 0, tipo4: 0, otro: 0,
  };
  const inconsistentesPorConflicto: Record<ConflictoKind, number> = {
    CONFLICTO_VIN: 0,
    CONFLICTO_FFACTURA: 0,
    CONFLICTO_FINSCRIPCION: 0,
    CONFLICTO_ENTREGA: 0,
    FECHA_IMPOSIBLE_ENTREGA_ANTES_DE_SOLICITUD: 0,
    FECHA_IMPOSIBLE_ENTREGA_ANTES_DE_FACTURA: 0,
    FECHA_IMPOSIBLE_PATENTE_ANTES_DE_INSCRIPCION: 0,
    ESTADO_TERMINAL_DEGRADADO: 0,
  };
  let huer = 0, incon = 0;
  for (const f of filas) {
    const cc = f.ejeCalidadCierre ?? "no_evaluable";
    distribucion[cc]++;
    if (cc === "huerfano") {
      huer++;
      huerfanosPorTipo[inferirTipoHuerfano(f)]++;
    }
    if (cc === "inconsistente") {
      incon++;
      // Solo conflictos materiales aportan a la clasificación
      for (const c of f.conflictos) {
        if (c.esMaterial) inconsistentesPorConflicto[c.kind]++;
      }
    }
  }
  return {
    distribucion,
    huerfanosPorTipo,
    inconsistentesPorConflicto,
    totalInconsistentes: incon,
    totalHuerfanos: huer,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Línea de tiempo por proceso (Velocidad — drill por tramo)
// ─────────────────────────────────────────────────────────────────────────────

export type ProcesoId = "control_negocio" | "logistica" | "cliente" | "comercial";
export type TramoId = string;

export interface TramoDefinicion {
  id: TramoId;
  label: string;
  getDesde: (f: EntradaConsolidada) => Date | null;
  getHasta: (f: EntradaConsolidada) => Date | null;
}

export interface TramoMetricas {
  id: TramoId;
  label: string;
  /** Casos con AMBAS fechas válidas (el delta es calculable). */
  n: number;
  /** Casos donde falta una o ambas fechas. */
  sinDato: number;
  promedioDias: number | null;
  medianaDias: number | null;
  p90Dias: number | null;
  topSucursal: { key: string; n: number } | null;
  topMarca: { key: string; n: number } | null;
}

export interface TimelineProceso {
  proceso: ProcesoId;
  /** Filas cuyo `cuelloPrincipal` corresponde al proceso (universo donde se mide el timeline). */
  universoEnProceso: number;
  tramos: TramoMetricas[];
}

/**
 * Mapeo `ProcesoId` → etiqueta de cuello principal. La vista solo activa el
 * timeline cuando el foco del Eje 1 cae en uno de los 4 cuellos operacionales.
 */
export const CUELLO_POR_PROCESO: Record<ProcesoId, CuelloPrincipal> = {
  control_negocio: "Control de Negocio",
  logistica: "Logística",
  cliente: "Cliente",
  comercial: "Comercial",
};

/**
 * Definición de tramos por proceso. Cada tramo es un par de fechas en la fila
 * consolidada. Las funciones de extracción son seguras ante null.
 *
 * Reglas de decisión (aprobadas en diseño):
 *  - Tramos hacia entrega usan `fEntregaReal` ESTRICTO. No se sustituye por
 *    `fListoParaEntrega` ni `fETASucursalPromesa`.
 *  - Comercial solo expone un tramo medible (Solicitud → Factura). Los otros
 *    dos ("Listo → Sol. entrega" y "Sol. entrega → Autorización") no se
 *    incluyen porque `solEntrega` y `autorizacionEntrega` son flags, no fechas.
 */
export const TRAMOS_DEFINICION: Record<ProcesoId, TramoDefinicion[]> = {
  control_negocio: [
    { id: "cn_fac_solins",  label: "Factura → Solicitud inscripción",       getDesde: (f) => f.fFactura,             getHasta: (f) => f.fSolicitudInscripcion },
    { id: "cn_solins_ins",  label: "Solicitud inscripción → Inscripción",    getDesde: (f) => f.fSolicitudInscripcion, getHasta: (f) => f.fInscripcion },
    { id: "cn_ins_paten",   label: "Inscripción → Patente enviada",          getDesde: (f) => f.fInscripcion,          getHasta: (f) => f.fPatenteEnviada },
    { id: "cn_paten_patrec",label: "Patente enviada → Patente recibida",     getDesde: (f) => f.fPatenteEnviada,       getHasta: (f) => f.fPatenteRecibida },
    { id: "cn_patrec_ent",  label: "Patente recibida → Entrega real",        getDesde: (f) => f.fPatenteRecibida,      getHasta: (f) => f.fEntregaReal },
  ],
  logistica: [
    { id: "lo_sol_resp",    label: "Solicitud vendedor → Respuesta logística", getDesde: (f) => f.fSolicitud,            getHasta: (f) => f.fRespuestaLogistica },
    { id: "lo_resp_solbod", label: "Respuesta logística → Solicitud bodega",   getDesde: (f) => f.fRespuestaLogistica,   getHasta: (f) => f.fSolicitudBodega },
    { id: "lo_solbod_ing",  label: "Solicitud bodega → Ingreso bodega",        getDesde: (f) => f.fSolicitudBodega,      getHasta: (f) => f.fIngresoBodega },
    { id: "lo_ing_plan",    label: "Ingreso bodega → Planificación física",    getDesde: (f) => f.fIngresoBodega,        getHasta: (f) => f.fPlanificacionFisica },
    { id: "lo_plan_sal",    label: "Planificación → Salida física",            getDesde: (f) => f.fPlanificacionFisica,  getHasta: (f) => f.fSalidaFisica },
    { id: "lo_sal_ent",     label: "Salida física → Entrega real",             getDesde: (f) => f.fSalidaFisica,         getHasta: (f) => f.fEntregaReal },
  ],
  cliente: [
    { id: "cl_listo_ent",   label: "Listo para entrega → Entrega real",      getDesde: (f) => f.fListoParaEntrega,    getHasta: (f) => f.fEntregaReal },
  ],
  comercial: [
    { id: "co_sol_fac",     label: "Solicitud vendedor → Factura",           getDesde: (f) => f.fSolicitud,           getHasta: (f) => f.fFactura },
  ],
};

const MS_DIA_TIMELINE = 86_400_000;

function topClave(
  filas: EntradaConsolidada[],
  getter: (f: EntradaConsolidada) => string | null,
): { key: string; n: number } | null {
  const m = new Map<string, number>();
  for (const f of filas) {
    const k = getter(f);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  if (m.size === 0) return null;
  let top: { key: string; n: number } | null = null;
  for (const [key, n] of m) {
    if (!top || n > top.n) top = { key, n };
  }
  return top;
}

export function calcularTimelineProceso(
  filas: EntradaConsolidada[],
  proceso: ProcesoId,
): TimelineProceso {
  const cuello = CUELLO_POR_PROCESO[proceso];
  const universo = filas.filter((f) => f.cuelloPrincipal === cuello);
  const definicion = TRAMOS_DEFINICION[proceso];

  const tramos: TramoMetricas[] = definicion.map((d) => {
    const conAmbas: EntradaConsolidada[] = [];
    const dias: number[] = [];
    let sinDato = 0;
    for (const f of universo) {
      const desde = d.getDesde(f);
      const hasta = d.getHasta(f);
      if (desde && hasta) {
        conAmbas.push(f);
        dias.push((hasta.getTime() - desde.getTime()) / MS_DIA_TIMELINE);
      } else {
        sinDato++;
      }
    }
    const prom = promedio(dias);
    const med = mediana(dias);
    const p = p90(dias);
    return {
      id: d.id,
      label: d.label,
      n: conAmbas.length,
      sinDato,
      promedioDias: prom !== null ? +prom.toFixed(1) : null,
      medianaDias: med !== null ? +med.toFixed(1) : null,
      p90Dias: p !== null ? +p.toFixed(1) : null,
      topSucursal: topClave(conAmbas, (f) => f.sucursal),
      topMarca: topClave(conAmbas, (f) => f.marca),
    };
  });

  return {
    proceso,
    universoEnProceso: universo.length,
    tramos,
  };
}

/**
 * Devuelve las filas que aportan al cálculo de un tramo específico — es decir,
 * las que tienen AMBAS fechas válidas. Útil para el drill del tramo.
 */
export function filasDeTramo(
  filas: EntradaConsolidada[],
  proceso: ProcesoId,
  tramoId: TramoId,
): EntradaConsolidada[] {
  const cuello = CUELLO_POR_PROCESO[proceso];
  const def = TRAMOS_DEFINICION[proceso].find((t) => t.id === tramoId);
  if (!def) return [];
  return filas
    .filter((f) => f.cuelloPrincipal === cuello)
    .filter((f) => def.getDesde(f) !== null && def.getHasta(f) !== null);
}

/** Indica si el cuello (string) tiene una línea de tiempo asociada. */
export function procesoDeCuello(cuello: CuelloPrincipal): ProcesoId | null {
  for (const [pid, cu] of Object.entries(CUELLO_POR_PROCESO) as Array<[ProcesoId, CuelloPrincipal]>) {
    if (cu === cuello) return pid;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Top por dimensión (reusable)
// ─────────────────────────────────────────────────────────────────────────────

export type DimensionTop = "sucursal" | "marca" | "vendedor";

export interface FilaTop {
  key: string;
  universo: number;
  entregados: number;
  pctEntregados: number;
  pctCompleto: number;
  diasMediana: number | null;
}

export function topPorDimension(
  filas: EntradaConsolidada[],
  dim: DimensionTop,
  limit = 10,
): FilaTop[] {
  const m = new Map<string, { universo: number; entregados: number; completos: number; dias: number[] }>();
  for (const f of filas) {
    const key =
      dim === "sucursal" ? (f.sucursal ?? "(sin sucursal)")
        : dim === "marca" ? (f.marca ?? "(sin marca)")
          : (f.vendedor ?? "(sin vendedor)");
    if (!m.has(key)) m.set(key, { universo: 0, entregados: 0, completos: 0, dias: [] });
    const b = m.get(key)!;
    b.universo++;
    if (f.entregado) b.entregados++;
    if (f.nivelDocumental === "completo") b.completos++;
    if (f.diasTotales != null) b.dias.push(f.diasTotales);
  }
  return [...m.entries()]
    .map(([key, b]) => ({
      key,
      universo: b.universo,
      entregados: b.entregados,
      pctEntregados: b.universo > 0 ? +((b.entregados / b.universo) * 100).toFixed(2) : 0,
      pctCompleto: b.universo > 0 ? +((b.completos / b.universo) * 100).toFixed(2) : 0,
      diasMediana: mediana(b.dias),
    }))
    .sort((a, b) => b.universo - a.universo)
    .slice(0, limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ranking accionable — top peores por métrica de problema
// ─────────────────────────────────────────────────────────────────────────────
//
// Diferencia clave vs `topPorDimension`: ese ordena por VOLUMEN; estos ordenan
// por MÉTRICA DE PROBLEMA con piso de muestra (default n ≥ 20). Sirven para la
// vista ejecutiva donde lo accionable son outliers, no el top de tamaño.

export type RankingDim = "sucursal" | "marca" | "vendedor";

export type RankingUnidad = "dias" | "porcentaje";

export interface RankingItem {
  key: string;
  n: number;
  /** Valor de la métrica de problema (mediana días, % completo, % problemático…). */
  metrica: number;
  unidad: RankingUnidad;
  /** Subdetalle informativo (top razón, breakdown). Opcional. */
  detalle?: string;
}

export interface RankingOpts {
  /** Piso de muestra para considerar la clave. Default 20. */
  minN?: number;
  /** Tamaño máximo del ranking. Default 5. */
  limit?: number;
}

function keyOf(f: EntradaConsolidada, dim: RankingDim): string {
  if (dim === "sucursal") return f.sucursal ?? "(sin sucursal)";
  if (dim === "marca") return f.marca ?? "(sin marca)";
  return f.vendedor ?? "(sin vendedor)";
}

/**
 * Top peores por mediana de `diasTotales` (más alta = más lento).
 * Solo cuenta filas con `diasTotales` definido.
 */
export function rankingPeoresVelocidad(
  filas: EntradaConsolidada[],
  dim: RankingDim,
  opts: RankingOpts = {},
): RankingItem[] {
  const minN = opts.minN ?? 20;
  const limit = opts.limit ?? 5;
  const grupos = new Map<string, number[]>();
  for (const f of filas) {
    if (f.diasTotales == null) continue;
    const k = keyOf(f, dim);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(f.diasTotales);
  }
  const out: RankingItem[] = [];
  for (const [k, arr] of grupos) {
    if (arr.length < minN) continue;
    const med = mediana(arr);
    if (med === null) continue;
    out.push({ key: k, n: arr.length, metrica: +med.toFixed(1), unidad: "dias" });
  }
  return out.sort((a, b) => b.metrica - a.metrica).slice(0, limit);
}

/**
 * Top peores por % completo (más bajo = peor cumplimiento documental).
 * Universo: filas en la dimensión (sin importar entregado/no).
 */
export function rankingPeoresCumplimiento(
  filas: EntradaConsolidada[],
  dim: RankingDim,
  opts: RankingOpts = {},
): RankingItem[] {
  const minN = opts.minN ?? 20;
  const limit = opts.limit ?? 5;
  const grupos = new Map<string, { total: number; completos: number }>();
  for (const f of filas) {
    const k = keyOf(f, dim);
    if (!grupos.has(k)) grupos.set(k, { total: 0, completos: 0 });
    const g = grupos.get(k)!;
    g.total++;
    if (f.nivelDocumental === "completo") g.completos++;
  }
  const out: RankingItem[] = [];
  for (const [k, g] of grupos) {
    if (g.total < minN) continue;
    const pct = +((g.completos / g.total) * 100).toFixed(2);
    out.push({
      key: k,
      n: g.total,
      metrica: pct,
      unidad: "porcentaje",
      detalle: `${g.completos} completos / ${g.total}`,
    });
  }
  // Ascendente: el peor es el % más bajo
  return out.sort((a, b) => a.metrica - b.metrica).slice(0, limit);
}

/**
 * Top peores por % de cierre problemático (huérfano + inconsistente) sobre
 * entregados. Universo del % son los entregados; filas no entregadas no cuentan.
 */
export function rankingPeoresCierre(
  filas: EntradaConsolidada[],
  dim: RankingDim,
  opts: RankingOpts = {},
): RankingItem[] {
  const minN = opts.minN ?? 20;
  const limit = opts.limit ?? 5;
  const grupos = new Map<string, { entregados: number; problematicos: number; huer: number; incon: number }>();
  for (const f of filas) {
    if (!f.entregado) continue;
    const k = keyOf(f, dim);
    if (!grupos.has(k)) grupos.set(k, { entregados: 0, problematicos: 0, huer: 0, incon: 0 });
    const g = grupos.get(k)!;
    g.entregados++;
    if (f.ejeCalidadCierre === "huerfano") { g.problematicos++; g.huer++; }
    else if (f.ejeCalidadCierre === "inconsistente") { g.problematicos++; g.incon++; }
  }
  const out: RankingItem[] = [];
  for (const [k, g] of grupos) {
    if (g.entregados < minN) continue;
    const pct = +((g.problematicos / g.entregados) * 100).toFixed(2);
    const topRazon = g.huer >= g.incon ? `huérfano ${g.huer}` : `inconsistente ${g.incon}`;
    out.push({
      key: k,
      n: g.entregados,
      metrica: pct,
      unidad: "porcentaje",
      detalle: topRazon,
    });
  }
  // Descendente: el peor es el % más alto
  return out.sort((a, b) => b.metrica - a.metrica).slice(0, limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Opciones de filtros (para los selects)
// ─────────────────────────────────────────────────────────────────────────────

export interface OpcionesFiltro {
  marcas: string[];
  sucursales: string[];
  vendedores: string[];
}

export function extraerOpciones(cruce: ResultadoCruce): OpcionesFiltro {
  const marcas = new Set<string>();
  const sucursales = new Set<string>();
  const vendedores = new Set<string>();
  for (const f of cruce.filas) {
    if (f.marca) marcas.add(f.marca);
    if (f.sucursal) sucursales.add(f.sucursal);
    if (f.vendedor) vendedores.add(f.vendedor);
  }
  return {
    marcas: [...marcas].sort(),
    sucursales: [...sucursales].sort(),
    vendedores: [...vendedores].sort(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 3 — Navegación por proceso (3 lecturas: cerrado / abierto / cobertura)
// ─────────────────────────────────────────────────────────────────────────────
//
// Modelo conceptual:
//   - "Histórico cerrado": casos con fechas suficientes para reconstruir el
//     ciclo cerrado. Es donde se calculan medianas, p90, prom y se renderiza
//     el timeline. NUNCA se mezclan casos vivos aquí.
//   - "Backlog abierto": casos vivos con señales operacionales del proceso
//     abiertas. Se mide aging, no duración cerrada.
//   - "Cobertura del proceso": de los cerrados, ¿cuántos tienen TODOS los
//     hitos para reconstruir bien la historia? Convive con el timeline y
//     EXPLICITA la brecha (no la oculta).
//
// "Cierre y Cumplimiento" es transversal: sin modo, sin cobertura.

/** Alias semántico — los 4 procesos operacionales (los que tienen cuello). */
export type ProcesoOperacional = ProcesoId;

/** Los 5 procesos navegables, incluida la pestaña transversal de cierre. */
export type ProcesoActivo = ProcesoOperacional | "cierre_y_cumplimiento";

/** Toggle interno por proceso operacional. Default "historico_cerrado". */
export type ModoProceso = "historico_cerrado" | "backlog_abierto";

/**
 * Umbral operacional preliminar — revisar con operaciones.
 * Define cuándo un cliente en backlog se considera "demorado".
 */
export const UMBRAL_DIAS_CLIENTE_DEMORADO = 7;

// ── Cobertura ─────────────────────────────────────────────────────────────

/** Hito evaluado para reconstruir la línea de tiempo del proceso. */
export interface DefinicionHito {
  id: string;
  label: string;
  campo: keyof EntradaConsolidada;
}

export interface HitoFaltante {
  id: string;
  label: string;
  campo: keyof EntradaConsolidada;
  faltantes: number;
  pctUniverso: number;
}

export interface CoberturaProceso {
  proceso: ProcesoOperacional;
  universoCerrado: number;
  /** Filas con TODOS los hitos del proceso presentes. */
  timelineCompleto: number;
  pctTimelineCompleto: number;
  /** Hitos con `faltantes > 0`, ordenados desc por `faltantes`. */
  hitosFaltantes: HitoFaltante[];
}

/**
 * Hitos evaluados por proceso para Cobertura. Reglas:
 *  - CN cerrado ya exige `entregado === true`, por eso NO se lista "sin
 *    entrega real" (sería trivialmente 0 y mete ruido). Tampoco "sin factura"
 *    (todo cerrado tiene factura por definición operacional).
 *  - Logística idem para entrega real.
 *  - Comercial cerrado se define por `fSolicitud && fFactura` → el universo
 *    ya garantiza ambos hitos. Cobertura siempre 100%, hitosFaltantes vacío.
 *  - Cliente cerrado se define por `fListoParaEntrega && fEntregaReal` →
 *    mismo caso especial.
 *
 * Las cabeceras de la tarjeta de Cobertura usan los `label`. El campo `id`
 * sirve como llave estable para drill y para tests.
 */
export const HITOS_POR_PROCESO: Record<ProcesoOperacional, DefinicionHito[]> = {
  control_negocio: [
    { id: "cn_sol_ins",      label: "Sin solicitud inscripción", campo: "fSolicitudInscripcion" },
    { id: "cn_inscripcion",  label: "Sin inscripción",            campo: "fInscripcion" },
    { id: "cn_pat_enviada",  label: "Sin patente enviada",        campo: "fPatenteEnviada" },
    { id: "cn_pat_recibida", label: "Sin patente recibida",       campo: "fPatenteRecibida" },
  ],
  logistica: [
    { id: "lo_sol_roma",     label: "Sin solicitud ROMA",         campo: "fSolicitud" },
    { id: "lo_resp_log",     label: "Sin respuesta logística",    campo: "fRespuestaLogistica" },
    { id: "lo_sol_bodega",   label: "Sin solicitud bodega",       campo: "fSolicitudBodega" },
    { id: "lo_ing_bodega",   label: "Sin ingreso bodega",         campo: "fIngresoBodega" },
    { id: "lo_planif",       label: "Sin planificación física",   campo: "fPlanificacionFisica" },
    { id: "lo_salida",       label: "Sin salida física",          campo: "fSalidaFisica" },
  ],
  comercial: [
    { id: "co_solicitud",    label: "Sin solicitud",              campo: "fSolicitud" },
    { id: "co_factura",      label: "Sin factura",                campo: "fFactura" },
  ],
  cliente: [
    { id: "cl_listo",        label: "Sin listo para entrega",     campo: "fListoParaEntrega" },
    { id: "cl_entrega",      label: "Sin entrega real",           campo: "fEntregaReal" },
  ],
};

// ── Selectores de universo ────────────────────────────────────────────────

function tieneHito(f: EntradaConsolidada, campo: keyof EntradaConsolidada): boolean {
  const v = f[campo];
  return v !== null && v !== undefined;
}

/**
 * Universo CERRADO del proceso (para timeline + cobertura + ranking por mediana).
 *
 * Definiciones:
 *  - control_negocio: cuello === "Control de Negocio" && entregado.
 *  - logistica:        cuello === "Logística" && entregado.
 *  - comercial:        fSolicitud && fFactura  (NO exige entregado —
 *                      mide velocidad comercial hasta facturación).
 *  - cliente:          fListoParaEntrega && fEntregaReal.
 */
export function filasCerrado(
  filas: EntradaConsolidada[],
  proceso: ProcesoOperacional,
): EntradaConsolidada[] {
  switch (proceso) {
    case "control_negocio":
      return filas.filter((f) => f.entregado && f.cuelloPrincipal === "Control de Negocio");
    case "logistica":
      return filas.filter((f) => f.entregado && f.cuelloPrincipal === "Logística");
    case "comercial":
      return filas.filter((f) => f.fSolicitud !== null && f.fFactura !== null);
    case "cliente":
      return filas.filter((f) => f.fListoParaEntrega !== null && f.fEntregaReal !== null);
  }
}

/**
 * Universo ABIERTO del proceso (para backlog + aging vivo).
 *
 * Definiciones:
 *  - control_negocio: !entregado && fFactura !== null (facturados sin entrega).
 *  - logistica:        !entregado && (cuello=Log || tieneSinSalida ||
 *                      ingreso bodega sin salida física).
 *  - comercial:        fSolicitud sin factura, o listo para entrega sin
 *                      flags Si en autorización/solicitud.
 *  - cliente:          fListoParaEntrega && !fEntregaReal (esperando retiro).
 */
export function filasAbierto(
  filas: EntradaConsolidada[],
  proceso: ProcesoOperacional,
): EntradaConsolidada[] {
  switch (proceso) {
    case "control_negocio":
      return filas.filter((f) => !f.entregado && f.fFactura !== null);
    case "logistica":
      return filas.filter((f) => {
        if (f.entregado) return false;
        if (f.cuelloPrincipal === "Logística") return true;
        if (f.tieneSinSalida) return true;
        if (f.fIngresoBodega !== null && f.fSalidaFisica === null) return true;
        return false;
      });
    case "comercial":
      return filas.filter((f) => {
        if (f.fSolicitud !== null && f.fFactura === null) return true;
        if (f.fListoParaEntrega !== null) {
          const aut = (f.autorizacionEntrega ?? "").trim();
          const sol = (f.solEntrega ?? "").trim();
          if (aut !== "Si" || sol !== "Si") return true;
        }
        return false;
      });
    case "cliente":
      return filas.filter((f) => f.fListoParaEntrega !== null && f.fEntregaReal === null);
  }
}

// ── Cobertura ─────────────────────────────────────────────────────────────

/**
 * Cobertura del proceso sobre su universo CERRADO. Devuelve el conteo de
 * casos con la línea de tiempo completa y el ranking de hitos faltantes.
 *
 * El caller pasa ya el universo cerrado (`filasCerrado(filas, proceso)`).
 * Esto evita recalcular y deja explícito que cobertura SOLO mira cerrados.
 */
export function calcularCoberturaProceso(
  filasCerradas: EntradaConsolidada[],
  proceso: ProcesoOperacional,
): CoberturaProceso {
  const hitos = HITOS_POR_PROCESO[proceso];
  const universoCerrado = filasCerradas.length;

  // Timeline completo: cuenta filas con TODOS los hitos del proceso presentes.
  let timelineCompleto = 0;
  for (const f of filasCerradas) {
    let completo = true;
    for (const h of hitos) {
      if (!tieneHito(f, h.campo)) {
        completo = false;
        break;
      }
    }
    if (completo) timelineCompleto++;
  }

  // Hitos faltantes: por cada hito, contar cuántas filas NO lo tienen.
  // Un caso puede aportar a varias filas (le falta más de un hito).
  const hitosFaltantes: HitoFaltante[] = hitos
    .map<HitoFaltante>((h) => {
      let faltantes = 0;
      for (const f of filasCerradas) {
        if (!tieneHito(f, h.campo)) faltantes++;
      }
      const pct = universoCerrado > 0 ? (faltantes / universoCerrado) * 100 : 0;
      return {
        id: h.id,
        label: h.label,
        campo: h.campo,
        faltantes,
        pctUniverso: +pct.toFixed(2),
      };
    })
    .filter((h) => h.faltantes > 0)
    .sort((a, b) => b.faltantes - a.faltantes);

  const pctCompleto =
    universoCerrado > 0 ? (timelineCompleto / universoCerrado) * 100 : 0;

  return {
    proceso,
    universoCerrado,
    timelineCompleto,
    pctTimelineCompleto: +pctCompleto.toFixed(2),
    hitosFaltantes,
  };
}

/**
 * Drill por hito faltante: filas del universo cerrado a las que les falta
 * el hito identificado por `hitoId`. Si el hito no existe en el proceso,
 * retorna [].
 */
export function filasConHitoFaltante(
  filasCerradas: EntradaConsolidada[],
  proceso: ProcesoOperacional,
  hitoId: string,
): EntradaConsolidada[] {
  const hito = HITOS_POR_PROCESO[proceso].find((h) => h.id === hitoId);
  if (!hito) return [];
  return filasCerradas.filter((f) => !tieneHito(f, hito.campo));
}

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint (Modo Validación)
// ─────────────────────────────────────────────────────────────────────────────

export interface FingerprintFila {
  ventaId: number | null;
  vin: string;
  cuelloPrincipal: CuelloPrincipal;
  fListoParaEntrega: string | null;
  diasLogistica: number | null;
  diasControlNegocio: number | null;
  ejeCalidadCierre: CalidadCierre | "no_evaluable";
}

function dayUTC(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function fingerprintFila(f: EntradaConsolidada): FingerprintFila {
  return {
    ventaId: f.ventaId,
    vin: f.vin,
    cuelloPrincipal: f.cuelloPrincipal,
    fListoParaEntrega: dayUTC(f.fListoParaEntrega),
    diasLogistica: f.diasLogistica,
    diasControlNegocio: f.diasControlNegocio,
    ejeCalidadCierre: f.ejeCalidadCierre ?? "no_evaluable",
  };
}

export interface FingerprintGlobal {
  totalFilas: number;
  ventaIdsUnicos: number;
  vinsUnicos: number;
  cuello: Array<{ cuello: CuelloPrincipal; cantidad: number }>;
  calidadCierre: Record<CalidadCierre | "no_evaluable", number>;
  cumplimientoBanda: Record<BandaCumplimiento, number>;
  velocidadBucket: Record<BucketVelocidad, number>;
}

export function fingerprintGlobal(cruce: ResultadoCruce): FingerprintGlobal {
  const e1 = agregadosEje1(cruce.filas);
  const e2 = agregadosEje2(cruce.filas);
  const e3 = agregadosEje3(cruce.filas);
  return {
    totalFilas: cruce.filas.length,
    ventaIdsUnicos: cruce.reporte.totales.ventaIds,
    vinsUnicos: cruce.reporte.totales.vinsUnicos,
    cuello: e1.distribucionCuello.map(({ cuello, cantidad }) => ({ cuello, cantidad })),
    calidadCierre: e3.distribucion,
    cumplimientoBanda: e2.global.porBanda,
    velocidadBucket: e1.distribucionVelocidad,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Funnel histórico cerrado + Backlog abierto + Segmentación temporal
// ─────────────────────────────────────────────────────────────────────────────
//
// Tres lecturas separadas, tres universos, tres cálculos distintos:
//
//   A. Funnel histórico cerrado  → universoFunnel(filas, proceso)
//      Mide cobertura por etapa y mediana/p90 por tramo.
//      Mediana se calcula SOLO sobre pares con AMBOS hitos no nulos.
//      Si a un cerrado le falta un hito: NO participa de medianas; SÍ aparece
//      en `faltantes`.
//
//   B. Backlog abierto            → filasAbierto(filas, proceso)
//      Mide cantidad por cubeta y aging mediano/p90 (días desde última señal).
//      Nunca usa medianas históricas.
//
//   C. Segmentación temporal      → calcularSegmentacionTramo
//      Solo aplica al universo cerrado. Bucketiza por día del mes de la
//      FECHA-FIN del tramo (la fecha del hito posterior).
//
// Nada de esto contamina al otro. Las medianas históricas se calculan SOLO
// con cerrados completos; el aging del backlog se calcula SOLO con abiertos.

/**
 * Etapa del funnel — campo de fecha del hito + label legible.
 *
 * Una etapa puede ser TERMINAL (esTerminal=true). Las terminales son etapas
 * cuya cantidad visual del funnel coincide con el UNIVERSO CERRADO (por
 * construcción del universo) — no con el conteo de filas que tienen el campo.
 *
 * Ejemplo: en Control de Negocio el universo es `entregado === true`. La
 * etapa "Entregados" siempre vale el universo (es 100%). Pero el campo
 * `fEntregaReal` puede estar null en algunos casos entregados — esos casos
 * aparecen en la cobertura como "Sin fecha entrega real" (faltante), no como
 * una reducción del count de la etapa terminal.
 *
 * `labelHito` permite distinguir el rótulo VISUAL del rótulo en la lista de
 * faltantes ("Entregados" en el funnel vs "fecha entrega real" en la
 * cobertura).
 */
export interface EtapaProceso {
  id: string;
  label: string;
  campo: keyof EntradaConsolidada;
  /** Si true, la cantidad visual = universoCerrado (no depende del campo). */
  esTerminal?: boolean;
  /** Rótulo usado en la lista de faltantes — defaultea a `label`. */
  labelHito?: string;
}

/**
 * Etapas en orden cronológico por proceso.
 *
 * Las etapas TERMINALES marcadas con `esTerminal: true` son las que coinciden
 * con el universo cerrado por construcción del universo:
 *  - CN cerrado = `entregado === true` → la etapa "Entregados" es terminal.
 *  - Logística cerrado = `entregado === true` → "Entrega" es terminal.
 *  - Comercial cerrado = `fSolicitud && fFactura` → ambas etapas se llenan
 *    por definición (no se marcan terminales — el campo está garantizado).
 *  - Cliente cerrado = `fListoParaEntrega && fEntregaReal` → idem.
 *
 * Solo CN y Logística distinguen `entregado` (bool semántico) de `fEntregaReal`
 * (fecha que puede faltar). Por eso ahí necesitamos el flag terminal.
 */
export const ETAPAS_POR_PROCESO: Record<ProcesoOperacional, EtapaProceso[]> = {
  control_negocio: [
    { id: "facturados",          label: "Facturados",            campo: "fFactura" },
    { id: "sol_inscripcion",     label: "Solicitud inscripción", campo: "fSolicitudInscripcion" },
    { id: "inscripcion",         label: "Inscripción",           campo: "fInscripcion" },
    { id: "patente_enviada",     label: "Patente enviada",       campo: "fPatenteEnviada" },
    { id: "patente_recibida",    label: "Patente recibida",      campo: "fPatenteRecibida" },
    {
      id: "entregados", label: "Entregados", campo: "fEntregaReal",
      esTerminal: true, labelHito: "fecha entrega real",
    },
  ],
  logistica: [
    { id: "sol_roma",            label: "Solicitud ROMA",        campo: "fSolicitud" },
    { id: "resp_log",            label: "Respuesta logística",   campo: "fRespuestaLogistica" },
    { id: "sol_bodega",          label: "Solicitud bodega",      campo: "fSolicitudBodega" },
    { id: "ing_bodega",          label: "Ingreso bodega",        campo: "fIngresoBodega" },
    { id: "planificacion",       label: "Planificación",         campo: "fPlanificacionFisica" },
    { id: "salida_fisica",       label: "Salida física",         campo: "fSalidaFisica" },
    {
      id: "entrega", label: "Entrega", campo: "fEntregaReal",
      esTerminal: true, labelHito: "fecha entrega real",
    },
  ],
  comercial: [
    { id: "solicitud",           label: "Solicitud",             campo: "fSolicitud" },
    { id: "factura",             label: "Factura",               campo: "fFactura" },
  ],
  cliente: [
    { id: "listo",               label: "Listo para entrega",    campo: "fListoParaEntrega" },
    { id: "entrega",             label: "Entrega",               campo: "fEntregaReal" },
  ],
};

/**
 * Universo del FUNNEL CERRADO por proceso (distinto a `filasCerrado`):
 *
 *   - control_negocio: entregado === true (NO filtra por cuelloPrincipal).
 *     Mide la sub-cadena documental dentro de TODOS los cerrados.
 *   - logistica:        entregado === true (idem).
 *   - comercial:        fSolicitud && fFactura  (ambos hitos del proceso).
 *   - cliente:          fListoParaEntrega && fEntregaReal.
 */
export function filasFunnelCerrado(
  filas: EntradaConsolidada[],
  proceso: ProcesoOperacional,
): EntradaConsolidada[] {
  switch (proceso) {
    case "control_negocio":
      return filas.filter((f) => f.entregado);
    case "logistica":
      return filas.filter((f) => f.entregado);
    case "comercial":
      return filas.filter((f) => f.fSolicitud !== null && f.fFactura !== null);
    case "cliente":
      return filas.filter((f) => f.fListoParaEntrega !== null && f.fEntregaReal !== null);
  }
}

// ── Helpers numéricos ─────────────────────────────────────────────────────

function tieneFecha(f: EntradaConsolidada, campo: keyof EntradaConsolidada): boolean {
  const v = f[campo];
  return v instanceof Date;
}

function fechaDe(f: EntradaConsolidada, campo: keyof EntradaConsolidada): Date | null {
  const v = f[campo];
  return v instanceof Date ? v : null;
}

const MS_POR_DIA = 86_400_000;

function diasEntre(a: Date, b: Date): number {
  // Redondea al día más cercano. Acepta diferencias negativas (las descarta el caller).
  return Math.round((b.getTime() - a.getTime()) / MS_POR_DIA);
}

// Reusamos los helpers estadísticos definidos arriba (mediana, p90, promedio)
// para mantener coherencia numérica con el resto del archivo.

function redondear2(x: number | null): number | null {
  return x == null ? null : +x.toFixed(2);
}

// ── Funnel cerrado ────────────────────────────────────────────────────────

export interface EtapaCalculada {
  id: string;
  label: string;
  campo: keyof EntradaConsolidada;
  /** Si la etapa es terminal del universo cerrado (cantidad = universo). */
  esTerminal: boolean;
  /** Rótulo usado en la lista de faltantes. */
  labelHito: string;
  /**
   * Cantidad visual del funnel. Para etapas TERMINALES = universoCerrado
   * (independiente del campo). Para etapas normales = filas con campo no nulo.
   */
  cantidad: number;
  /** cantidad / universoCerrado. 0..100. */
  pctVsUniverso: number;
  /**
   * Faltantes VISUALES del funnel = universoCerrado - cantidad. Para
   * terminales es 0 por construcción.
   */
  faltantes: number;
  /**
   * Filas del universo con el campo realmente registrado (no nulo). Para
   * etapas no-terminales coincide con `cantidad`. Para terminales puede ser
   * menor — los faltantes a nivel HITO (no nivel etapa visual) se calculan
   * desde `universoCerrado - cantidadHito`.
   */
  cantidadHito: number;
}

export interface TransicionCalculada {
  desdeId: string;
  hastaId: string;
  desdeLabel: string;
  hastaLabel: string;
  /**
   * count(desde) - count(hasta). Positivo = caída de cobertura (sale del flujo).
   * Negativo = brecha de registro inversa (la etapa posterior tiene más
   * registros que la previa — es DATA, no operación; el UI lo enmarca como
   * "X del universo no registraron {desdeLabel}").
   */
  caidaCount: number;
  /** Filas con AMBOS hitos no nulos (universo de cálculo de tiempos). */
  n: number;
  medianaDias: number | null;
  promedioDias: number | null;
  p90Dias: number | null;
}

export interface FaltanteEtapa {
  etapaId: string;
  /** Rótulo de la etapa visual (ej. "Entregados"). */
  etapaLabel: string;
  /** Rótulo del hito faltante (ej. "fecha entrega real"). Usado en "Sin {…}". */
  labelHito: string;
  faltantes: number;
  pctUniverso: number;
  /** Etapa previa (de dónde se perdió el registro). null para la primera etapa. */
  desdeEtapaId: string | null;
  desdeEtapaLabel: string | null;
}

export interface FunnelCerrado {
  proceso: ProcesoOperacional;
  universoCerrado: number;
  etapas: EtapaCalculada[];
  transiciones: TransicionCalculada[];
  /**
   * Etapa con más faltantes (mayor `faltantes`). null si universoCerrado=0
   * o todas las etapas tienen 0 faltantes.
   * Es la "Mayor pérdida de cobertura" — independiente del cálculo de demora.
   */
  cuelloPerdida: FaltanteEtapa | null;
  /**
   * Tramo con mayor `medianaDias`. null si no hay ningún tramo con datos.
   * Es la "Mayor demora histórica" — independiente del cálculo de cobertura.
   */
  cuelloDemora: TransicionCalculada | null;
  /** Faltantes ordenados desc por `faltantes`, filtrados > 0. */
  faltantes: FaltanteEtapa[];
}

/**
 * Cálculo del funnel histórico cerrado para un proceso operacional.
 *
 * Tres lecturas separadas — NUNCA se mezclan:
 *
 *  A. Velocidad histórica — `transiciones[].medianaDias / promedioDias / p90Dias`
 *     se calculan SOLO con filas donde AMBOS hitos están registrados y la
 *     diferencia es ≥ 0. Las filas con un hito faltante NO participan.
 *
 *  B. Cobertura del hito — `etapas[].cantidadHito` es el conteo REAL de filas
 *     con el campo del hito registrado. Los `faltantes` en la lista de
 *     ranking se calculan desde `universoCerrado - cantidadHito`, independiente
 *     de si la etapa es terminal.
 *
 *  C. Brecha de registro (etapa terminal) — `etapas[].cantidad` para una etapa
 *     terminal = universoCerrado (no depende del campo). El campo en sí puede
 *     estar faltando en algunos casos; eso aparece en la cobertura como
 *     "Sin {labelHito}" pero NO reduce el count visual del funnel terminal.
 *
 *  `cuelloPerdida` y `cuelloDemora` son dos señales independientes que pueden
 *  caer en etapas/tramos distintos.
 */
export function calcularFunnelCerrado(
  filasCerradas: EntradaConsolidada[],
  proceso: ProcesoOperacional,
): FunnelCerrado {
  const etapasDef = ETAPAS_POR_PROCESO[proceso];
  const universoCerrado = filasCerradas.length;

  // Cobertura por etapa. cantidadHito = filas con el campo no nulo (verdad
  // operacional). cantidad = cantidad visual del funnel (=universo para
  // terminales, = cantidadHito para no-terminales).
  const etapas: EtapaCalculada[] = etapasDef.map((e) => {
    let cantidadHito = 0;
    for (const f of filasCerradas) {
      if (tieneFecha(f, e.campo)) cantidadHito++;
    }
    const esTerminal = !!e.esTerminal;
    const cantidad = esTerminal ? universoCerrado : cantidadHito;
    const faltantesVisual = universoCerrado - cantidad; // 0 si terminal
    const pct = universoCerrado > 0 ? (cantidad / universoCerrado) * 100 : 0;
    return {
      id: e.id,
      label: e.label,
      campo: e.campo,
      esTerminal,
      labelHito: e.labelHito ?? e.label,
      cantidad,
      pctVsUniverso: +pct.toFixed(2),
      faltantes: faltantesVisual,
      cantidadHito,
    };
  });

  // Transiciones — mediana/p90/promedio sobre pares completos con diff ≥ 0.
  // Las terminales NO cambian este cálculo: se sigue exigiendo que AMBOS
  // hitos (incluido el terminal) tengan fecha real para entrar al cómputo.
  const transiciones: TransicionCalculada[] = [];
  for (let i = 0; i < etapasDef.length - 1; i++) {
    const desde = etapasDef[i];
    const hasta = etapasDef[i + 1];
    const diffs: number[] = [];
    for (const f of filasCerradas) {
      const a = fechaDe(f, desde.campo);
      const b = fechaDe(f, hasta.campo);
      if (a && b) {
        const d = diasEntre(a, b);
        if (d >= 0) diffs.push(d);
      }
    }
    transiciones.push({
      desdeId: desde.id,
      hastaId: hasta.id,
      desdeLabel: desde.label,
      hastaLabel: hasta.label,
      // caidaCount visual usa la cantidad de cada etapa (terminal o no).
      caidaCount: etapas[i].cantidad - etapas[i + 1].cantidad,
      n: diffs.length,
      medianaDias: redondear2(mediana(diffs)),
      promedioDias: redondear2(promedio(diffs)),
      p90Dias: redondear2(p90(diffs)),
    });
  }

  // Faltantes a nivel HITO ordenados desc. Usan `cantidadHito` (no `cantidad`),
  // así que "Sin fecha entrega real" entra en el ranking aunque la etapa
  // terminal visual sea 100%. `labelHito` se usa para el rótulo "Sin {…}".
  const faltantes: FaltanteEtapa[] = etapas
    .map<FaltanteEtapa>((e, i) => {
      const faltantesHito = universoCerrado - e.cantidadHito;
      return {
        etapaId: e.id,
        etapaLabel: e.label,
        labelHito: e.labelHito,
        faltantes: faltantesHito,
        pctUniverso:
          universoCerrado > 0 ? +((faltantesHito / universoCerrado) * 100).toFixed(2) : 0,
        desdeEtapaId: i > 0 ? etapas[i - 1].id : null,
        desdeEtapaLabel: i > 0 ? etapas[i - 1].label : null,
      };
    })
    .filter((f) => f.faltantes > 0)
    .sort((a, b) => b.faltantes - a.faltantes);

  const cuelloPerdida = faltantes.length > 0 ? faltantes[0] : null;

  // Cuello demora — tramo con mayor mediana (solo entre tramos con datos).
  let cuelloDemora: TransicionCalculada | null = null;
  for (const t of transiciones) {
    if (t.medianaDias == null) continue;
    if (!cuelloDemora || (cuelloDemora.medianaDias ?? -1) < t.medianaDias) {
      cuelloDemora = t;
    }
  }

  return {
    proceso,
    universoCerrado,
    etapas,
    transiciones,
    cuelloPerdida,
    cuelloDemora,
    faltantes,
  };
}

// ── Segmentación temporal ─────────────────────────────────────────────────

export type BucketMes = "dias_1_10" | "dias_11_20" | "dias_21_fin";

// ── Filtro temporal global (aplica al modo histórico cerrado) ────────────

/**
 * Periodo del filtro temporal. "global" no filtra. El resto bucketiza por
 * día del mes o semana del mes de la fecha-fin del proceso (la fecha del
 * último hito del proceso — para CN/Log/Cliente = fEntregaReal; para
 * Comercial = fFactura).
 */
export type PeriodoTemporal =
  | "global"
  | "dias_1_10"
  | "dias_11_20"
  | "dias_21_fin"
  | "sem_1"
  | "sem_2"
  | "sem_3"
  | "sem_4";

/**
 * Campo de referencia para el filtro temporal por proceso. Es la fecha
 * que termina el ciclo del proceso (la última etapa cronológica).
 */
export function campoReferenciaPeriodo(
  proceso: ProcesoOperacional,
): keyof EntradaConsolidada {
  const etapas = ETAPAS_POR_PROCESO[proceso];
  return etapas[etapas.length - 1].campo;
}

function semanaDelMes(d: number): 1 | 2 | 3 | 4 {
  if (d <= 7) return 1;
  if (d <= 14) return 2;
  if (d <= 21) return 3;
  return 4;
}

/**
 * Filtra filas cerradas por periodo temporal. La referencia es el día
 * del mes del campo de fin del proceso. Si la fila no tiene la fecha
 * registrada, NO entra en el filtro (queda fuera).
 *
 * Para periodo "global" devuelve las filas tal cual.
 */
export function filtrarPorPeriodo(
  filas: EntradaConsolidada[],
  proceso: ProcesoOperacional,
  periodo: PeriodoTemporal,
): EntradaConsolidada[] {
  if (periodo === "global") return filas;
  const campo = campoReferenciaPeriodo(proceso);
  return filas.filter((f) => {
    const d = f[campo];
    if (!(d instanceof Date)) return false;
    const dia = d.getDate();
    switch (periodo) {
      case "dias_1_10":  return dia <= 10;
      case "dias_11_20": return dia >= 11 && dia <= 20;
      case "dias_21_fin": return dia >= 21;
      case "sem_1": return semanaDelMes(dia) === 1;
      case "sem_2": return semanaDelMes(dia) === 2;
      case "sem_3": return semanaDelMes(dia) === 3;
      case "sem_4": return semanaDelMes(dia) === 4;
    }
  });
}

export interface MetricasTramo {
  n: number;
  medianaDias: number | null;
  promedioDias: number | null;
  p90Dias: number | null;
}

export interface SegmentacionTramo {
  proceso: ProcesoOperacional;
  desdeId: string;
  hastaId: string;
  desdeLabel: string;
  hastaLabel: string;
  /** Hito cuya fecha bucketiza el día del mes. Siempre es el hito posterior. */
  campoReferencia: keyof EntradaConsolidada;
  global: MetricasTramo;
  dias_1_10: MetricasTramo;
  dias_11_20: MetricasTramo;
  dias_21_fin: MetricasTramo;
}

function bucketDelDia(d: number): BucketMes {
  if (d <= 10) return "dias_1_10";
  if (d <= 20) return "dias_11_20";
  return "dias_21_fin";
}

function metricasDe(diffs: number[]): MetricasTramo {
  return {
    n: diffs.length,
    medianaDias: redondear2(mediana(diffs)),
    promedioDias: redondear2(promedio(diffs)),
    p90Dias: redondear2(p90(diffs)),
  };
}

/**
 * Segmenta un tramo histórico por el día del mes de la FECHA-FIN del tramo
 * (la fecha del hito posterior). Devuelve null si el tramo no existe o si
 * el proceso no es válido.
 *
 * Convención: para "Patente recibida → Entrega" se bucketiza por el día del
 * mes de fEntregaReal. Permite leer atochamientos de cierre de mes en el
 * calendario operativo.
 */
export function calcularSegmentacionTramo(
  filasCerradas: EntradaConsolidada[],
  proceso: ProcesoOperacional,
  desdeId: string,
  hastaId: string,
): SegmentacionTramo | null {
  const etapas = ETAPAS_POR_PROCESO[proceso];
  const desde = etapas.find((e) => e.id === desdeId);
  const hasta = etapas.find((e) => e.id === hastaId);
  if (!desde || !hasta) return null;

  const globalDiffs: number[] = [];
  const bucketDiffs: Record<BucketMes, number[]> = {
    dias_1_10: [],
    dias_11_20: [],
    dias_21_fin: [],
  };

  for (const f of filasCerradas) {
    const a = fechaDe(f, desde.campo);
    const b = fechaDe(f, hasta.campo);
    if (!a || !b) continue;
    const d = diasEntre(a, b);
    if (d < 0) continue;
    globalDiffs.push(d);
    const bucket = bucketDelDia(b.getDate());
    bucketDiffs[bucket].push(d);
  }

  return {
    proceso,
    desdeId,
    hastaId,
    desdeLabel: desde.label,
    hastaLabel: hasta.label,
    campoReferencia: hasta.campo,
    global: metricasDe(globalDiffs),
    dias_1_10: metricasDe(bucketDiffs.dias_1_10),
    dias_11_20: metricasDe(bucketDiffs.dias_11_20),
    dias_21_fin: metricasDe(bucketDiffs.dias_21_fin),
  };
}

// ── Backlog abierto ───────────────────────────────────────────────────────

/**
 * Definición declarativa de cubeta de backlog. El predicado opera sobre la
 * fila completa; la cubeta no obliga a "no estar entregado" (eso lo hace
 * el universo `filasAbierto` ya filtrado por el caller).
 *
 * Las cubetas pueden ser NO mutuamente excluyentes — una fila abierta con
 * varios hitos faltantes aparece en varias cubetas. El UI lo explicita
 * con texto.
 */
export interface CubetaDef {
  id: string;
  label: string;
  predicado: (f: EntradaConsolidada) => boolean;
}

export interface CubetaCalculada {
  id: string;
  label: string;
  cantidad: number;
  agingMedianoDias: number | null;
  agingP90Dias: number | null;
  agingPromedioDias: number | null;
}

export interface BacklogAbierto {
  proceso: ProcesoOperacional;
  universoAbierto: number;
  /** Aging mediano sobre el universo abierto entero. */
  agingMedianoGlobal: number | null;
  agingP90Global: number | null;
  cubetas: CubetaCalculada[];
  /** id de la cubeta con peor aging mediano (mayor número). null si no hay. */
  cubetaPeorId: string | null;
}

/**
 * Aging del caso = días desde la ÚLTIMA SEÑAL REGISTRADA del proceso (la
 * fecha más reciente entre los campos de las etapas del proceso). Si no
 * hay ninguna fecha del proceso, retorna null.
 */
export function agingUltimaSenal(
  f: EntradaConsolidada,
  proceso: ProcesoOperacional,
  hoy: Date,
): number | null {
  const etapas = ETAPAS_POR_PROCESO[proceso];
  let ultima: Date | null = null;
  for (const e of etapas) {
    const d = fechaDe(f, e.campo);
    if (d && (!ultima || d.getTime() > ultima.getTime())) ultima = d;
  }
  if (!ultima) return null;
  const dias = diasEntre(ultima, hoy);
  return dias < 0 ? 0 : dias;
}

/** Cubetas por proceso. Lista declarativa, no exhaustiva. */
export const CUBETAS_BACKLOG: Record<ProcesoOperacional, CubetaDef[]> = {
  control_negocio: [
    {
      id: "cuello_vivo_cn",
      label: "Cuello vivo Control de Negocio",
      predicado: (f) => f.cuelloPrincipal === "Control de Negocio",
    },
    {
      id: "sin_patente_recibida",
      label: "Sin patente recibida (con env)",
      predicado: (f) => f.fPatenteEnviada !== null && f.fPatenteRecibida === null,
    },
    {
      id: "sin_patente_enviada",
      label: "Sin patente enviada (con inscripción)",
      predicado: (f) => f.fInscripcion !== null && f.fPatenteEnviada === null,
    },
    {
      id: "sin_inscripcion",
      label: "Sin inscripción (con sol. inscripción)",
      predicado: (f) => f.fSolicitudInscripcion !== null && f.fInscripcion === null,
    },
    {
      id: "sin_sol_inscripcion",
      label: "Sin solicitud inscripción",
      predicado: (f) => f.fFactura !== null && f.fSolicitudInscripcion === null,
    },
  ],
  logistica: [
    {
      id: "cuello_vivo_log",
      label: "Cuello vivo Logística",
      predicado: (f) => f.cuelloPrincipal === "Logística",
    },
    {
      id: "sin_salida",
      label: "Sin salida física",
      predicado: (f) =>
        (f.fIngresoBodega !== null && f.fSalidaFisica === null) || f.tieneSinSalida,
    },
    {
      id: "en_bodega_sin_planificacion",
      label: "En bodega sin planificación",
      predicado: (f) =>
        f.fIngresoBodega !== null && f.fPlanificacionFisica === null,
    },
    {
      id: "sin_planificacion",
      label: "Sin planificación",
      predicado: (f) =>
        f.fSolicitudBodega !== null && f.fPlanificacionFisica === null,
    },
    {
      id: "sin_sol_roma",
      label: "Sin solicitud ROMA",
      predicado: (f) => f.fSolicitud === null,
    },
  ],
  comercial: [
    {
      id: "sol_sin_factura",
      label: "Solicitud sin factura",
      predicado: (f) => f.fSolicitud !== null && f.fFactura === null,
    },
    {
      id: "listo_sin_autorizacion",
      label: "Listo sin autorización completa",
      predicado: (f) => {
        if (f.fListoParaEntrega === null) return false;
        const aut = (f.autorizacionEntrega ?? "").trim();
        const sol = (f.solEntrega ?? "").trim();
        return aut !== "Si" || sol !== "Si";
      },
    },
  ],
  cliente: [
    {
      id: "listo_no_entregado",
      label: "Listos no entregados",
      predicado: (f) => f.fListoParaEntrega !== null && f.fEntregaReal === null,
    },
    {
      id: "demorados",
      label: `Demorados (>${UMBRAL_DIAS_CLIENTE_DEMORADO}d sin entrega)`,
      // El predicado de demora se aplica DENTRO de calcularBacklogAbierto
      // porque depende de `hoy`. Acá dejamos un sentinel; el cálculo real
      // usa el agingUltimaSenal del propio cliente para determinar demora.
      predicado: (f) => f.fListoParaEntrega !== null && f.fEntregaReal === null,
    },
  ],
};

/**
 * Calcula backlog abierto por proceso: cantidad por cubeta + aging mediano/p90.
 *
 * El caller debe pasar `filasAbiertas` = filasAbierto(filasFiltradas, proceso).
 * `hoy` se inyecta para que los tests sean deterministas.
 */
export function calcularBacklogAbierto(
  filasAbiertas: EntradaConsolidada[],
  proceso: ProcesoOperacional,
  hoy: Date = new Date(),
): BacklogAbierto {
  const cubetasDef = CUBETAS_BACKLOG[proceso];
  const universoAbierto = filasAbiertas.length;

  // Aging global del universo abierto.
  const agingsGlobales: number[] = [];
  for (const f of filasAbiertas) {
    const a = agingUltimaSenal(f, proceso, hoy);
    if (a !== null) agingsGlobales.push(a);
  }

  // Para cliente.demorados, filtramos por aging > UMBRAL.
  const cubetas: CubetaCalculada[] = cubetasDef.map((def) => {
    const agings: number[] = [];
    let cantidad = 0;
    for (const f of filasAbiertas) {
      if (!def.predicado(f)) continue;
      const a = agingUltimaSenal(f, proceso, hoy);
      // Cliente.demorados — refinamiento: solo cuenta si aging > UMBRAL.
      if (def.id === "demorados") {
        if (a === null || a <= UMBRAL_DIAS_CLIENTE_DEMORADO) continue;
      }
      cantidad++;
      if (a !== null) agings.push(a);
    }
    return {
      id: def.id,
      label: def.label,
      cantidad,
      agingMedianoDias: redondear2(mediana(agings)),
      agingP90Dias: redondear2(p90(agings)),
      agingPromedioDias: redondear2(promedio(agings)),
    };
  });

  // Peor cubeta = mayor aging mediano (ignora cubetas vacías).
  let cubetaPeorId: string | null = null;
  let peorMediana = -Infinity;
  for (const c of cubetas) {
    if (c.cantidad === 0 || c.agingMedianoDias == null) continue;
    if (c.agingMedianoDias > peorMediana) {
      peorMediana = c.agingMedianoDias;
      cubetaPeorId = c.id;
    }
  }

  return {
    proceso,
    universoAbierto,
    agingMedianoGlobal: redondear2(mediana(agingsGlobales)),
    agingP90Global: redondear2(p90(agingsGlobales)),
    cubetas,
    cubetaPeorId,
  };
}

/**
 * Drill por cubeta: filas abiertas que satisfacen el predicado de la
 * cubeta. Incluye el filtro por aging > UMBRAL para `demorados`.
 */
export function filasDeCubeta(
  filasAbiertas: EntradaConsolidada[],
  proceso: ProcesoOperacional,
  cubetaId: string,
  hoy: Date = new Date(),
): EntradaConsolidada[] {
  const def = CUBETAS_BACKLOG[proceso].find((c) => c.id === cubetaId);
  if (!def) return [];
  if (cubetaId === "demorados") {
    return filasAbiertas.filter((f) => {
      if (!def.predicado(f)) return false;
      const a = agingUltimaSenal(f, proceso, hoy);
      return a !== null && a > UMBRAL_DIAS_CLIENTE_DEMORADO;
    });
  }
  return filasAbiertas.filter(def.predicado);
}

/**
 * Drill por etapa del funnel:
 *  - Etapa NORMAL: filas del universo cerrado con el campo del hito registrado.
 *  - Etapa TERMINAL: el universo cerrado entero (la cantidad visual es el
 *    universo, no el conteo del campo). Útil para "ver los N entregados".
 *    Si querés solo los entregados CON `fEntregaReal` registrada, usá la
 *    fila correspondiente en faltantes (drill de "Sin fecha entrega real")
 *    o filtrá manualmente.
 */
export function filasDeEtapa(
  filasCerradas: EntradaConsolidada[],
  proceso: ProcesoOperacional,
  etapaId: string,
): EntradaConsolidada[] {
  const etapa = ETAPAS_POR_PROCESO[proceso].find((e) => e.id === etapaId);
  if (!etapa) return [];
  if (etapa.esTerminal) return filasCerradas.slice();
  return filasCerradas.filter((f) => tieneFecha(f, etapa.campo));
}

/**
 * Drill por faltante (hito no registrado en el cerrado): filas del
 * universo cerrado SIN ese hito registrado.
 */
export function filasSinEtapa(
  filasCerradas: EntradaConsolidada[],
  proceso: ProcesoOperacional,
  etapaId: string,
): EntradaConsolidada[] {
  const etapa = ETAPAS_POR_PROCESO[proceso].find((e) => e.id === etapaId);
  if (!etapa) return [];
  return filasCerradas.filter((f) => !tieneFecha(f, etapa.campo));
}

// ═════════════════════════════════════════════════════════════════════════════
// VISTA POR MES DE FACTURA — modelo operacional aprobado
//
// La pantalla /velocidad-operacional opera sobre el universo de autos
// facturados en un mes dado (filtro principal). Las funciones acá:
//
//  · mesesFacturaDisponibles + filtrarPorMesFactura: filtro principal.
//  · OWNER_POR_TRAMO / OWNER_POR_HITO: responsable operativo conceptual
//    de cada tramo / hito (no es un campo del row — es regla del negocio).
//  · UMBRAL_TRAMO + semaforoTramo: semáforo verde/amarillo/rojo por tramo.
//  · topPorCampo + montoRetenido: ranking de sucursales/responsables con
//    cantidad, monto retenido (valorFactura) y mediana de aging.
//  · calcularFunnelPorFactura: estructura completa etapas+tramos para el
//    componente FunnelHitosFactura.
//  · faltantesPorProceso: cards de "Sin X" con top + monto.
//  · backlogFacturados: vista paralela "facturados sin entregar".
//  · cierreYCumplimientoStats: stats del proceso Cierre y Cumplimiento.
//
// Reutiliza TRAMOS_DEFINICION y ETAPAS_POR_PROCESO existentes para no
// duplicar conocimiento. Cero side effects; cero React.
// ═════════════════════════════════════════════════════════════════════════════

export type MesFacturaKey = string; // "YYYY-MM"

export interface MesFacturaOption {
  key: MesFacturaKey;
  label: string;
  count: number;
}

const MESES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function mesFacturaKey(f: EntradaConsolidada): MesFacturaKey | null {
  const d = f.fFactura;
  if (!(d instanceof Date)) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function labelMesFactura(key: MesFacturaKey): string {
  const [y, m] = key.split("-");
  const idx = Number(m) - 1;
  if (idx < 0 || idx > 11) return key;
  return `${MESES_ES[idx]} ${y}`;
}

/**
 * Meses con al menos una factura, orden desc (más reciente primero).
 *
 * Acepta `ResultadoCruce` (para uso macro/headless) o `EntradaConsolidada[]`
 * directamente (para alimentar con un universo YA filtrado por marca/sucursal
 * globales — así el counter del selector coincide con el universo real).
 */
export function mesesFacturaDisponibles(
  fuente: ResultadoCruce | EntradaConsolidada[],
): MesFacturaOption[] {
  const filas = Array.isArray(fuente) ? fuente : fuente.filas;
  const m = new Map<MesFacturaKey, number>();
  for (const f of filas) {
    const k = mesFacturaKey(f);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Array.from(m, ([key, count]) => ({ key, count, label: labelMesFactura(key) }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

/** Filtra filas por mes de factura. `null` = todos los meses (passthrough). */
export function filtrarPorMesFactura(
  filas: EntradaConsolidada[],
  mes: MesFacturaKey | null,
): EntradaConsolidada[] {
  if (!mes) return filas;
  return filas.filter((f) => mesFacturaKey(f) === mes);
}

/**
 * ¿La fila queda FUERA del flujo de autos nuevos?
 *
 * Dos universos quedan fuera de Control de Negocio (inscripción/patente nueva)
 * y Logística (traslado físico desde fábrica/bodega central):
 *
 *   1. USADOS  — autos transferidos (no inscritos nuevos), físicamente ya en
 *      la sucursal donde se tomaron en parte de pago.
 *   2. MAYORISTA — venta mayorista de usados (subcategoría operacional del
 *      universo de usados; tiene su propio flujo de liquidación, no pasa por
 *      la cadena CN ni por logística retail).
 *
 * Detección DEFENSIVA: combina la canonización oficial (`normalizarMarcaOperacional`
 * canoniza la familia USADOS / VU EN NUEVOS / VU EN USADOS) con una búsqueda
 * textual en el campo `marca` por si en el cruce ROMA-Actas aparece "MAYORISTA"
 * o "LIQUIDACIÓN" como dimensión independiente.
 *
 * SÍ aplican (passthrough) a Comercial (vendedor solicita / factura), Cliente
 * (entrega) y Cierre y Cumplimiento (calidad documental).
 */
export function esUsadoHistorico(f: EntradaConsolidada): boolean {
  if (normalizarMarcaOperacional(f.marca) === "USADOS") return true;
  const m = (f.marca ?? "").toUpperCase();
  if (m.includes("MAYORISTA") || m.includes("MAYORIST")) return true;
  if (m.includes("LIQUIDA")) return true;
  return false;
}

/**
 * Aplica la regla "Usados + Mayorista fuera de CN/Logística" sobre un universo
 * de filas.
 *
 *   · control_negocio / logistica → excluye usados + mayorista.
 *   · comercial / cliente / cierre_y_cumplimiento → passthrough (incluye todo).
 *
 * Centralizada acá para que todos los selectores y vistas la apliquen igual.
 */
export function aplicarRegladeUsados(
  filas: EntradaConsolidada[],
  proceso: ProcesoOperacional | "cierre_y_cumplimiento" | null,
): EntradaConsolidada[] {
  if (proceso === "control_negocio" || proceso === "logistica") {
    return filas.filter((f) => !esUsadoHistorico(f));
  }
  return filas;
}

// ── Responsable operativo conceptual por tramo / hito ────────────────────────
//
// Etiquetas legibles que aparecen en la UI como "Responsable operativo". No
// es responsable individual (eso lo dice `vendedor` o la sucursal) — es el
// ROL del negocio que avanza ese paso del proceso.

export type ResponsableOperativo =
  | "Admin / Control de Negocio"
  | "Control de Negocio"
  | "Registro Civil (externo)"
  | "Vendedor"
  | "Vendedor / Sucursal"
  | "Logística"
  | "STLI / Bodega"
  | "Logística / Transporte"
  | "Cierre / Control de Negocio";

export const OWNER_POR_TRAMO: Record<ProcesoOperacional, Record<string, ResponsableOperativo>> = {
  control_negocio: {
    cn_fac_solins:   "Admin / Control de Negocio",
    cn_solins_ins:   "Control de Negocio",
    cn_ins_paten:    "Control de Negocio",
    cn_paten_patrec: "Registro Civil (externo)",
    cn_patrec_ent:   "Vendedor / Sucursal",
  },
  logistica: {
    lo_sol_resp:     "Logística",
    lo_resp_solbod:  "Logística",
    lo_solbod_ing:   "STLI / Bodega",
    lo_ing_plan:     "STLI / Bodega",
    lo_plan_sal:     "STLI / Bodega",
    lo_sal_ent:      "Logística / Transporte",
  },
  comercial: {
    co_sol_fac:      "Vendedor",
  },
  cliente: {
    cl_listo_ent:    "Vendedor / Sucursal",
  },
};

export const OWNER_POR_HITO: Record<ProcesoOperacional, Record<string, ResponsableOperativo>> = {
  control_negocio: {
    facturados:       "Vendedor",
    sol_inscripcion:  "Admin / Control de Negocio",
    inscripcion:      "Control de Negocio",
    patente_enviada:  "Control de Negocio",
    patente_recibida: "Registro Civil (externo)",
    entregados:       "Vendedor / Sucursal",
  },
  logistica: {
    sol_roma:        "Vendedor",
    resp_log:        "Logística",
    sol_bodega:      "Logística",
    ing_bodega:      "STLI / Bodega",
    planificacion:   "STLI / Bodega",
    salida_fisica:   "STLI / Bodega",
    entrega:         "Logística / Transporte",
  },
  comercial: {
    solicitud:       "Vendedor",
    factura:         "Vendedor",
  },
  cliente: {
    listo:           "Cierre / Control de Negocio",
    entrega:         "Vendedor / Sucursal",
  },
};

// ── Semáforo por tramo (umbrales calibrables) ────────────────────────────────

export type Semaforo = "verde" | "amarillo" | "rojo";

export interface UmbralTramo {
  /** Mediana ≤ verdeHasta → verde. */
  verdeHasta: number;
  /** Mediana ≤ amarilloHasta → amarillo; > → rojo. */
  amarilloHasta: number;
}

/**
 * Umbrales por tramo (días). Valores iniciales sensatos — calibrables viendo
 * la pantalla real. Si un tramo no está en el map, se asume verde.
 */
export const UMBRAL_TRAMO: Record<ProcesoOperacional, Record<string, UmbralTramo>> = {
  control_negocio: {
    cn_fac_solins:   { verdeHasta: 3,  amarilloHasta: 7 },
    cn_solins_ins:   { verdeHasta: 5,  amarilloHasta: 10 },
    cn_ins_paten:    { verdeHasta: 3,  amarilloHasta: 7 },
    cn_paten_patrec: { verdeHasta: 7,  amarilloHasta: 15 },
    cn_patrec_ent:   { verdeHasta: 5,  amarilloHasta: 10 },
  },
  logistica: {
    lo_sol_resp:     { verdeHasta: 1,  amarilloHasta: 3 },
    lo_resp_solbod:  { verdeHasta: 2,  amarilloHasta: 5 },
    lo_solbod_ing:   { verdeHasta: 3,  amarilloHasta: 7 },
    lo_ing_plan:     { verdeHasta: 3,  amarilloHasta: 7 },
    lo_plan_sal:     { verdeHasta: 5,  amarilloHasta: 10 },
    lo_sal_ent:      { verdeHasta: 5,  amarilloHasta: 12 },
  },
  comercial: {
    co_sol_fac:      { verdeHasta: 3,  amarilloHasta: 7 },
  },
  cliente: {
    cl_listo_ent:    { verdeHasta: 3,  amarilloHasta: 7 },
  },
};

export function semaforoTramo(mediana: number | null, u: UmbralTramo | undefined): Semaforo {
  if (mediana == null || !u) return "verde";
  if (mediana <= u.verdeHasta) return "verde";
  if (mediana <= u.amarilloHasta) return "amarillo";
  return "rojo";
}

// ── Monto retenido + top sucursales / responsables ───────────────────────────

/** Suma `valorFactura` (null → 0). UI muestra nota chica de cobertura del dato. */
export function montoRetenido(filas: EntradaConsolidada[]): number {
  let s = 0;
  for (const f of filas) s += f.valorFactura ?? 0;
  return s;
}

export interface TopItem {
  key: string;
  count: number;
  monto: number;
  medianaDias: number | null;
}

/** Mediana de un array numérico (`null` si vacío). Helper local. */
function medianaSimple(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/**
 * Ranking por (sucursal | vendedor) con count + monto + medianaDias.
 *
 *   `getDias` opcional: si provisto, calcula mediana de días por grupo (usado
 *   para "top responsables más lentos del tramo" o "aging medio del backlog").
 *   Si no, `medianaDias` queda null.
 *
 *   Orden: primero por monto desc, luego por count desc (empate visual = más
 *   plata retenida primero, criterio aprobado).
 */
export function topPorCampo(
  filas: EntradaConsolidada[],
  campo: "sucursal" | "vendedor",
  n: number,
  getDias?: (f: EntradaConsolidada) => number | null,
): TopItem[] {
  const acc = new Map<string, { count: number; monto: number; dias: number[] }>();
  for (const f of filas) {
    const k = (f[campo] ?? "").trim();
    if (!k) continue;
    const e = acc.get(k) ?? { count: 0, monto: 0, dias: [] };
    e.count++;
    e.monto += f.valorFactura ?? 0;
    if (getDias) {
      const d = getDias(f);
      if (d != null && Number.isFinite(d)) e.dias.push(d);
    }
    acc.set(k, e);
  }
  return Array.from(acc, ([key, v]) => ({
    key,
    count: v.count,
    monto: v.monto,
    medianaDias: getDias ? medianaSimple(v.dias) : null,
  }))
    .sort((a, b) => b.monto - a.monto || b.count - a.count)
    .slice(0, n);
}

// ── Funnel por factura ───────────────────────────────────────────────────────

const MS_DIA_FAC = 86_400_000;

function diasEntreFac(a: Date | null, b: Date | null): number | null {
  if (!(a instanceof Date) || !(b instanceof Date)) return null;
  return (b.getTime() - a.getTime()) / MS_DIA_FAC;
}

function p75(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.75))];
}

export interface EtapaFunnel {
  id: string;
  label: string;
  count: number;
  pct: number;
  faltantes: number;
  monto: number;
  owner: ResponsableOperativo;
  /** Etapa terminal (entregados/entrega): la cobertura se mide por `entregado`. */
  esTerminal: boolean;
}

export interface TramoFunnel {
  id: string;
  label: string;
  owner: ResponsableOperativo;
  mediana: number | null;
  promedio: number | null;
  p90: number | null;
  /** Pares completos en el tramo. */
  n: number;
  /** Casos del tramo cuyo delta > p75 — usados para top de "más lentos". */
  lentosCount: number;
  semaforo: Semaforo;
  topSucursalesLentas: TopItem[];
  topResponsablesLentos: TopItem[];
}

export interface FunnelPorFactura {
  proceso: ProcesoOperacional;
  universo: number;
  monto: number;
  etapas: EtapaFunnel[];
  tramos: TramoFunnel[];
}

/**
 * Funnel sobre el universo de facturados del mes:
 *  · Cada ETAPA cuenta cobertura (% de los facturados que llegaron al hito).
 *  · Cada TRAMO calcula mediana/promedio/p90/n sobre pares completos.
 *  · Para cada tramo, los "lentos" (días > p75 del tramo) alimentan el ranking
 *    de top sucursales / responsables.
 *
 * El universo `filas` debe venir YA filtrado por mes de factura.
 */
export function calcularFunnelPorFactura(
  filas: EntradaConsolidada[],
  proceso: ProcesoOperacional,
): FunnelPorFactura {
  const universo = filas.length;
  const monto = montoRetenido(filas);
  const etapasDef = ETAPAS_POR_PROCESO[proceso];
  const tramosDef = TRAMOS_DEFINICION[proceso];

  const etapas: EtapaFunnel[] = etapasDef.map((e) => {
    let count = 0;
    let m = 0;
    for (const f of filas) {
      const tiene = e.esTerminal ? f.entregado : (f[e.campo] instanceof Date);
      if (tiene) {
        count++;
        m += f.valorFactura ?? 0;
      }
    }
    return {
      id: e.id,
      label: e.label,
      count,
      pct: universo > 0 ? (count / universo) * 100 : 0,
      faltantes: universo - count,
      monto: m,
      owner: OWNER_POR_HITO[proceso][e.id] ?? "Vendedor",
      esTerminal: !!e.esTerminal,
    };
  });

  const tramos: TramoFunnel[] = tramosDef.map((d) => {
    const dias: number[] = [];
    const pares: EntradaConsolidada[] = [];
    for (const f of filas) {
      const x = diasEntreFac(d.getDesde(f), d.getHasta(f));
      if (x != null && x >= 0) {
        dias.push(x);
        pares.push(f);
      }
    }
    const med = medianaSimple(dias);
    const prom = dias.length ? dias.reduce((a, b) => a + b, 0) / dias.length : null;
    const sortedP90 = [...dias].sort((a, b) => a - b);
    const p90v = dias.length
      ? sortedP90[Math.min(sortedP90.length - 1, Math.floor(sortedP90.length * 0.9))]
      : null;
    const corte = p75(dias);
    const lentos: EntradaConsolidada[] = [];
    const diasPorFila = new Map<EntradaConsolidada, number>();
    for (let i = 0; i < pares.length; i++) {
      diasPorFila.set(pares[i], dias[i]);
      if (corte != null && dias[i] > corte) lentos.push(pares[i]);
    }
    const u = UMBRAL_TRAMO[proceso][d.id];
    return {
      id: d.id,
      label: d.label,
      owner: OWNER_POR_TRAMO[proceso][d.id] ?? "Vendedor",
      mediana: med,
      promedio: prom,
      p90: p90v,
      n: dias.length,
      lentosCount: lentos.length,
      semaforo: semaforoTramo(med, u),
      topSucursalesLentas: topPorCampo(lentos, "sucursal", 5, (f) => diasPorFila.get(f) ?? null),
      topResponsablesLentos: topPorCampo(lentos, "vendedor", 5, (f) => diasPorFila.get(f) ?? null),
    };
  });

  return { proceso, universo, monto, etapas, tramos };
}

// ── Faltantes del proceso ────────────────────────────────────────────────────

export interface FaltanteHito {
  id: string;
  label: string;
  /** Campo de la fila que define el hito. */
  campo: keyof EntradaConsolidada;
  count: number;
  monto: number;
  pct: number;
  owner: ResponsableOperativo;
  topSucursales: TopItem[];
  topResponsables: TopItem[];
  filas: EntradaConsolidada[];
}

/**
 * Faltantes por proceso: para cada hito del proceso, las filas del universo
 * que NO lo tienen registrado. Universo = `filas` (ya filtradas por mes).
 *
 * Las etapas terminales (entregados/entrega) NO se incluyen como "faltante"
 * separado — el backlog del mes los cubre con su propio bloque.
 */
export function faltantesPorProceso(
  filas: EntradaConsolidada[],
  proceso: ProcesoOperacional,
): FaltanteHito[] {
  const universo = filas.length;
  const etapas = ETAPAS_POR_PROCESO[proceso].filter((e) => !e.esTerminal);
  return etapas.map((e) => {
    const sin: EntradaConsolidada[] = [];
    let monto = 0;
    for (const f of filas) {
      const v = f[e.campo];
      if (!(v instanceof Date)) {
        sin.push(f);
        monto += f.valorFactura ?? 0;
      }
    }
    return {
      id: e.id,
      label: `Sin ${e.label.toLowerCase()}`,
      campo: e.campo,
      count: sin.length,
      monto,
      pct: universo > 0 ? (sin.length / universo) * 100 : 0,
      owner: OWNER_POR_HITO[proceso][e.id] ?? "Vendedor",
      topSucursales: topPorCampo(sin, "sucursal", 5),
      topResponsables: topPorCampo(sin, "vendedor", 5),
      filas: sin,
    };
  });
}

// ── Backlog facturados ───────────────────────────────────────────────────────

export type ModoBacklog = "este_mes" | "acumulado";

export interface AgrupadoBacklog {
  key: string;
  count: number;
  monto: number;
  agingMedio: number | null;
}

export interface BacklogStats {
  count: number;
  monto: number;
  medianaAging: number | null;
  porSucursal: AgrupadoBacklog[];
  porResponsable: AgrupadoBacklog[];
  /** "Cuello dominante" = último hito documental pendiente del caso. */
  porCuello: { id: string; label: string; count: number; monto: number }[];
  filas: EntradaConsolidada[];
}

/** Días desde la factura hasta `hoy` (positivo). null si no hay fFactura. */
function agingDesdeFactura(f: EntradaConsolidada, hoy: Date): number | null {
  if (!(f.fFactura instanceof Date)) return null;
  return Math.max(0, Math.floor((hoy.getTime() - f.fFactura.getTime()) / MS_DIA_FAC));
}

/**
 * "Cuello dominante" del backlog: el primer hito NO cumplido (en orden
 * cronológico de etapas) entre los hitos no-terminales de Control de Negocio.
 * Se usa como dimensión de agrupamiento porque es lo que destraba el caso.
 */
function cuelloDominante(f: EntradaConsolidada): { id: string; label: string } {
  const etapas = ETAPAS_POR_PROCESO.control_negocio;
  for (const e of etapas) {
    if (e.esTerminal) continue;
    if (!(f[e.campo] instanceof Date)) {
      return { id: e.id, label: `Sin ${e.label.toLowerCase()}` };
    }
  }
  return { id: "listo_pendiente_entrega", label: "Listo · pendiente de entrega" };
}

/**
 * Backlog: filas facturadas y NO entregadas al corte (hoy). El universo `filas`
 * ya viene filtrado por el caller — si modo "este_mes", llegan solo las del mes;
 * si modo "acumulado", llegan TODAS las del cruce (sin filtro de mes).
 */
export function backlogFacturados(
  filas: EntradaConsolidada[],
  hoy: Date = new Date(),
): BacklogStats {
  const backlog = filas.filter((f) => f.fFactura instanceof Date && !f.entregado);
  const monto = montoRetenido(backlog);
  const agings: number[] = [];
  const diasPorFila = new Map<EntradaConsolidada, number>();
  for (const f of backlog) {
    const a = agingDesdeFactura(f, hoy);
    if (a != null) {
      agings.push(a);
      diasPorFila.set(f, a);
    }
  }
  const medianaAging = medianaSimple(agings);

  const porSucursal = topPorCampo(backlog, "sucursal", 8, (f) => diasPorFila.get(f) ?? null)
    .map((t) => ({ key: t.key, count: t.count, monto: t.monto, agingMedio: t.medianaDias }));
  const porResponsable = topPorCampo(backlog, "vendedor", 8, (f) => diasPorFila.get(f) ?? null)
    .map((t) => ({ key: t.key, count: t.count, monto: t.monto, agingMedio: t.medianaDias }));

  // Cuello dominante (por hito CN faltante en orden cronológico).
  const cuelloAcc = new Map<string, { label: string; count: number; monto: number }>();
  for (const f of backlog) {
    const c = cuelloDominante(f);
    const e = cuelloAcc.get(c.id) ?? { label: c.label, count: 0, monto: 0 };
    e.count++;
    e.monto += f.valorFactura ?? 0;
    cuelloAcc.set(c.id, e);
  }
  const porCuello = Array.from(cuelloAcc, ([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.monto - a.monto || b.count - a.count);

  return {
    count: backlog.length,
    monto,
    medianaAging,
    porSucursal,
    porResponsable,
    porCuello,
    filas: backlog,
  };
}

// ── Cierre y Cumplimiento ────────────────────────────────────────────────────

export interface CierreCumplStats {
  count: number;
  /** Distribución por nivel de calidad de cierre. */
  distribucion: Record<CalidadCierre | "no_evaluable", number>;
  /** Casos con problema (inconsistente o huérfano) → topY $. */
  problemaCount: number;
  problemaMonto: number;
  topSucursalesProblema: TopItem[];
  topResponsablesProblema: TopItem[];
  filasProblema: EntradaConsolidada[];
}

/**
 * Cierre y Cumplimiento: opera sobre el universo (ya filtrado por mes de
 * factura). Cuenta distribución por calidad, separa los casos "con problema"
 * (inconsistente | huérfano) y los rankea por sucursal/responsable.
 */
export function cierreYCumplimientoStats(filas: EntradaConsolidada[]): CierreCumplStats {
  const dist: Record<CalidadCierre | "no_evaluable", number> = {
    correcto: 0,
    inconsistente: 0,
    huerfano: 0,
    no_evaluable: 0,
  };
  const problema: EntradaConsolidada[] = [];
  for (const f of filas) {
    const c = f.ejeCalidadCierre ?? "no_evaluable";
    dist[c]++;
    if (c === "inconsistente" || c === "huerfano") problema.push(f);
  }
  return {
    count: filas.length,
    distribucion: dist,
    problemaCount: problema.length,
    problemaMonto: montoRetenido(problema),
    topSucursalesProblema: topPorCampo(problema, "sucursal", 5),
    topResponsablesProblema: topPorCampo(problema, "vendedor", 5),
    filasProblema: problema,
  };
}

