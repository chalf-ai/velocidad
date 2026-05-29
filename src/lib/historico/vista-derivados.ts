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
  const out: EntradaConsolidada[] = [];
  for (const r of cruce.filas) {
    if (f.marca && r.marca !== f.marca) continue;
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
