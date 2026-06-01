/**
 * Rankings de sucursales y canales — brief §10.
 *
 * Filtros mínimos para entrar:
 *   · ≥ 30 facturas en el período
 *   · ≥ 10 entregas para rankings basados en tiempo
 *
 * Criterios de orden (selector dentro del módulo):
 *   · medianaFacturaEntrega ASC (más rápidas) o DESC (más lentas)
 *   · cantidadProcesosQuebrados DESC
 *   · fneMontoRetenido DESC
 *
 * No mezcla canales: cada canal tiene su propio ranking.
 */

import type { EntradaConsolidada } from "../historico/cruce-roma-actas";
import { clasificarCanal, type Canal } from "./cn-canales";

const MS_DIA = 86_400_000;

export type CriterioRanking =
  | "mediana_fac_entrega"
  | "procesos_quebrados"
  | "fne_monto";

export interface FilaRanking {
  key: string;
  facturados: number;
  entregados: number;
  fne: number;
  fneMonto: number;
  medianaFacturaEntrega: number | null;
  procesosQuebrados: number;
}

export interface BloqueRanking {
  criterio: CriterioRanking;
  /** "rapidas" = ASC para mediana; "lentas" = DESC para mediana o counts. */
  direccion: "rapidas" | "lentas";
  rows: FilaRanking[];
}

const MIN_FACTURAS_DEFAULT = 30;
const MIN_ENTREGAS_PARA_TIEMPO_DEFAULT = 10;

/**
 * Mínimos calibrables · permite a la página ajustar los umbrales según el
 * tamaño del período activo (mes vs 3M/6M/12M). Default: valores estrictos
 * que preservan calidad estadística cuando hay volumen suficiente.
 */
export interface MinimosRanking {
  minFacturas?: number;
  minEntregasParaTiempo?: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

/** Cuenta procesos quebrados de un caso (hitos faltantes en el flujo). */
function procesosQuebradosDe(f: EntradaConsolidada): number {
  let q = 0;
  if (f.fSolicitudInscripcion === null) q++;
  if (f.fSolicitudInscripcion !== null && f.fInscripcion === null) q++;
  if (f.fInscripcion !== null && f.fPatenteRecibida === null) q++;
  if (f.fPatenteRecibida !== null && f.fPatenteEntregada === null) q++;
  if (
    f.fPatenteEntregada !== null &&
    (f.solEntrega ?? "").trim() !== "Si"
  )
    q++;
  if (
    (f.solEntrega ?? "").trim() === "Si" &&
    (f.autorizacionEntrega ?? "").trim() !== "Si"
  )
    q++;
  if ((f.autorizacionEntrega ?? "").trim() === "Si" && !f.entregado) q++;
  return q;
}

// ─── Agregación por sucursal ────────────────────────────────────────────────

function agruparPorSucursal(
  universo: EntradaConsolidada[],
): Map<string, FilaRanking> {
  const m = new Map<string, FilaRanking>();
  for (const f of universo) {
    const s = (f.sucursal ?? "").trim();
    if (!s) continue;
    const e =
      m.get(s) ?? {
        key: s,
        facturados: 0,
        entregados: 0,
        fne: 0,
        fneMonto: 0,
        medianaFacturaEntrega: null,
        procesosQuebrados: 0,
      };
    e.facturados++;
    if (f.entregado) e.entregados++;
    else {
      e.fne++;
      e.fneMonto += f.valorFactura ?? 0;
    }
    e.procesosQuebrados += procesosQuebradosDe(f);
    m.set(s, e);
  }
  // Calcular mediana Factura → Entrega por sucursal (sólo entregados con
  // ambas fechas — usa la fecha del acta como entrega real).
  for (const [key, fila] of m) {
    const dias: number[] = [];
    for (const f of universo) {
      if ((f.sucursal ?? "").trim() !== key) continue;
      if (!f.entregado) continue;
      if (!(f.fFactura instanceof Date) || !(f.fEntregaReal instanceof Date))
        continue;
      const d = (f.fEntregaReal.getTime() - f.fFactura.getTime()) / MS_DIA;
      if (d >= 0) dias.push(d);
    }
    fila.medianaFacturaEntrega = mediana(dias);
  }
  return m;
}

// ─── Rankings ──────────────────────────────────────────────────────────────

function aplicarFiltrosMinimos(
  rows: FilaRanking[],
  criterio: CriterioRanking,
  minFacturas: number,
  minEntregas: number,
): FilaRanking[] {
  return rows.filter((r) => {
    if (r.facturados < minFacturas) return false;
    if (
      criterio === "mediana_fac_entrega" &&
      r.entregados < minEntregas
    ) {
      return false;
    }
    if (criterio === "mediana_fac_entrega" && r.medianaFacturaEntrega === null) {
      return false;
    }
    return true;
  });
}

function ordenar(
  rows: FilaRanking[],
  criterio: CriterioRanking,
  direccion: "rapidas" | "lentas",
): FilaRanking[] {
  const arr = [...rows];
  arr.sort((a, b) => {
    if (criterio === "mediana_fac_entrega") {
      const av = a.medianaFacturaEntrega ?? Infinity;
      const bv = b.medianaFacturaEntrega ?? Infinity;
      return direccion === "rapidas" ? av - bv : bv - av;
    }
    if (criterio === "procesos_quebrados") {
      return direccion === "lentas"
        ? b.procesosQuebrados - a.procesosQuebrados
        : a.procesosQuebrados - b.procesosQuebrados;
    }
    // fne_monto
    return direccion === "lentas" ? b.fneMonto - a.fneMonto : a.fneMonto - b.fneMonto;
  });
  return arr;
}

export interface RankingsCN {
  sucursalesLentas: BloqueRanking;
  sucursalesRapidas: BloqueRanking;
  /** Por canal (Retail/Flotas/Oficinas/Otros) — NO se rankean entre sí, se
   *  comparan en su propia fila para que la lectura sea honesta. */
  porCanal: {
    canal: Canal;
    facturados: number;
    entregados: number;
    fne: number;
    fneMonto: number;
    medianaFacturaEntrega: number | null;
  }[];
}

export function calcularRankings(
  universo: EntradaConsolidada[],
  criterio: CriterioRanking = "mediana_fac_entrega",
  top = 10,
  minimos: MinimosRanking = {},
): RankingsCN {
  const minFacturas = minimos.minFacturas ?? MIN_FACTURAS_DEFAULT;
  const minEntregas = minimos.minEntregasParaTiempo ?? MIN_ENTREGAS_PARA_TIEMPO_DEFAULT;
  const porSucursal = agruparPorSucursal(universo);
  const rowsArr = Array.from(porSucursal.values());
  const filtrados = aplicarFiltrosMinimos(rowsArr, criterio, minFacturas, minEntregas);

  const lentas = ordenar(filtrados, criterio, "lentas").slice(0, top);
  const rapidas = ordenar(filtrados, criterio, "rapidas").slice(0, top);

  // ─── Comparación por canal ───────────────────────────────────────────────
  const acc = new Map<
    Canal,
    {
      facturados: number;
      entregados: number;
      fne: number;
      fneMonto: number;
      dias: number[];
    }
  >();
  for (const f of universo) {
    const c = clasificarCanal(f.sucursal);
    const e =
      acc.get(c) ??
      { facturados: 0, entregados: 0, fne: 0, fneMonto: 0, dias: [] };
    e.facturados++;
    if (f.entregado) {
      e.entregados++;
      if (f.fFactura instanceof Date && f.fEntregaReal instanceof Date) {
        const d = (f.fEntregaReal.getTime() - f.fFactura.getTime()) / MS_DIA;
        if (d >= 0) e.dias.push(d);
      }
    } else {
      e.fne++;
      e.fneMonto += f.valorFactura ?? 0;
    }
    acc.set(c, e);
  }
  const porCanal = Array.from(acc, ([canal, v]) => ({
    canal,
    facturados: v.facturados,
    entregados: v.entregados,
    fne: v.fne,
    fneMonto: v.fneMonto,
    medianaFacturaEntrega: mediana(v.dias),
  }))
    // Excluimos canal EXCLUIDO (no debería llegar acá porque el universo CN ya
    // lo filtró, pero defensivo).
    .filter((r) => r.canal !== "EXCLUIDO")
    .sort((a, b) => b.facturados - a.facturados);

  return {
    sucursalesLentas: { criterio, direccion: "lentas", rows: lentas },
    sucursalesRapidas: { criterio, direccion: "rapidas", rows: rapidas },
    porCanal,
  };
}
