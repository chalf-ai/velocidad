/**
 * Capa B · Procesos quebrados — brief §8.
 *
 * Universo: cohorte madura (facturados ≥30 días al corte).
 * Para cada hito faltante: cantidad, %, monto, top sucursales/canales/
 * responsables, acción esperada.
 *
 * NOTA: este selector NO chequea cohorte madura — espera recibirlo ya como
 * input. La cohorte se construye en `cn-universo.ts:cohorteMadura()`.
 */

import type { EntradaConsolidada } from "../historico/cruce-roma-actas";
import {
  ACCION_POR_HITO_FALTANTE,
  LABEL_HITO_FALTANTE,
  RESPONSABLE_POR_HITO_FALTANTE,
  type HitoFaltante,
  type ResponsableHito,
} from "./cn-responsables";
import { clasificarCanal, type Canal } from "./cn-canales";

export interface TopGrupo {
  key: string;
  count: number;
  monto: number;
}

export interface CardQuebrada {
  hito: HitoFaltante;
  label: string;
  count: number;
  pctSobreUniverso: number;
  monto: number;
  responsable: ResponsableHito;
  accion: string;
  topSucursales: TopGrupo[];
  topResponsables: TopGrupo[];
  topCanales: TopGrupo[];
  /** Filas del universo que matchean este hito faltante (drill). */
  filas: EntradaConsolidada[];
}

export interface CapaB {
  /** Tamaño del universo cohorte madura. */
  universo: number;
  /** Tamaño del universo total del mes (referencia visual). */
  universoTotal: number;
  /** 7 cards, una por hito faltante. */
  cards: CardQuebrada[];
}

// ─── Filtros por hito (brief §8) ────────────────────────────────────────────
//
// CADA filtro define el predicado para que un caso entre en la card. Estos
// filtros son INDEPENDIENTES entre sí — un mismo caso puede entrar en varias
// cards si tiene varios hitos faltantes (a propósito; la Capa B muestra
// magnitud por hito, NO clasifica casos a una sola categoría).

type Predicado = (f: EntradaConsolidada) => boolean;

const FILTROS_QUEBRADOS: Record<HitoFaltante, Predicado> = {
  solicitud_inscripcion: (f) => f.fSolicitudInscripcion === null,
  inscripcion: (f) =>
    f.fSolicitudInscripcion !== null && f.fInscripcion === null,
  patente_recibida: (f) =>
    f.fInscripcion !== null && f.fPatenteRecibida === null,
  patente_entregada: (f) =>
    f.fPatenteRecibida !== null && f.fPatenteEntregada === null,
  solicitud_entrega: (f) =>
    f.fPatenteEntregada !== null && (f.solEntrega ?? "").trim() !== "Si",
  autorizacion_entrega: (f) =>
    (f.solEntrega ?? "").trim() === "Si" &&
    (f.autorizacionEntrega ?? "").trim() !== "Si",
  entrega_real: (f) =>
    (f.autorizacionEntrega ?? "").trim() === "Si" && !f.entregado,
};

// ─── Tops ──────────────────────────────────────────────────────────────────

function topPorClave<K extends keyof EntradaConsolidada>(
  filas: EntradaConsolidada[],
  campo: K,
  n: number,
): TopGrupo[] {
  const m = new Map<string, { count: number; monto: number }>();
  for (const f of filas) {
    const raw = f[campo];
    const key = typeof raw === "string" ? raw.trim() : "";
    if (!key) continue;
    const e = m.get(key) ?? { count: 0, monto: 0 };
    e.count++;
    e.monto += f.valorFactura ?? 0;
    m.set(key, e);
  }
  return Array.from(m, ([key, v]) => ({ key, count: v.count, monto: v.monto }))
    .sort((a, b) => b.monto - a.monto || b.count - a.count)
    .slice(0, n);
}

function topPorCanal(filas: EntradaConsolidada[], n: number): TopGrupo[] {
  const m = new Map<Canal, { count: number; monto: number }>();
  for (const f of filas) {
    const c = clasificarCanal(f.sucursal);
    const e = m.get(c) ?? { count: 0, monto: 0 };
    e.count++;
    e.monto += f.valorFactura ?? 0;
    m.set(c, e);
  }
  return Array.from(m, ([key, v]) => ({ key, count: v.count, monto: v.monto }))
    .sort((a, b) => b.monto - a.monto || b.count - a.count)
    .slice(0, n);
}

// ─── Función principal ─────────────────────────────────────────────────────

export function calcularCapaB(
  cohorte: EntradaConsolidada[],
  universoTotalMes: number,
): CapaB {
  const universo = cohorte.length;
  const cards: CardQuebrada[] = (Object.keys(FILTROS_QUEBRADOS) as HitoFaltante[]).map(
    (hito) => {
      const filas = cohorte.filter(FILTROS_QUEBRADOS[hito]);
      const count = filas.length;
      const monto = filas.reduce((s, f) => s + (f.valorFactura ?? 0), 0);
      return {
        hito,
        label: LABEL_HITO_FALTANTE[hito],
        count,
        pctSobreUniverso: universo > 0 ? (count / universo) * 100 : 0,
        monto,
        responsable: RESPONSABLE_POR_HITO_FALTANTE[hito],
        accion: ACCION_POR_HITO_FALTANTE[hito],
        topSucursales: topPorClave(filas, "sucursal", 5),
        topResponsables: topPorClave(filas, "vendedor", 5),
        topCanales: topPorCanal(filas, 5),
        filas,
      };
    },
  );
  return { universo, universoTotal: universoTotalMes, cards };
}
