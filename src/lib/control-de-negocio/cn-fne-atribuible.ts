/**
 * Capa C · FNE atribuible a Control de Negocio — brief §9.
 *
 * Universo: TODOS los FNE del período (facturados sin entrega_auto), sin
 * restricción de aging. Cada FNE se asigna a UNA sola categoría aplicando
 * la regla: la etapa es el PRIMER hito faltante en el flujo.
 *
 * Esto difiere de Capa B: ahí un caso puede aparecer en varias cards (una
 * por hito faltante). En Capa C cada FNE entra en exactamente un grupo.
 */

import type { EntradaConsolidada } from "../historico/cruce-roma-actas";
import {
  ACCION_POR_HITO_FALTANTE,
  LABEL_HITO_FALTANTE,
  RESPONSABLE_POR_HITO_FALTANTE,
  ORDEN_HITOS,
  type HitoFaltante,
  type ResponsableHito,
} from "./cn-responsables";
import { clasificarCanal, type Canal } from "./cn-canales";

const MS_DIA = 86_400_000;

export interface TopGrupo {
  key: string;
  count: number;
  monto: number;
}

export interface GrupoFNE {
  hito: HitoFaltante;
  label: string;
  /** Variante UI cuando hito = entrega_real ("Todo listo sin entrega" — brief). */
  labelAlt?: string;
  count: number;
  monto: number;
  agingFacturaMediana: number | null;
  agingFacturaP90: number | null;
  agingUltimoHitoMediana: number | null;
  responsable: ResponsableHito;
  accion: string;
  topSucursales: TopGrupo[];
  topResponsables: TopGrupo[];
  topCanales: TopGrupo[];
  filas: EntradaConsolidada[];
  /** Leyenda para el grupo "entrega_real" — captura simultánea, brief §4. */
  leyenda?: string;
}

export interface CapaC {
  /** Total FNE del universo (suma de los 7 grupos). */
  totalFNE: number;
  totalMonto: number;
  grupos: GrupoFNE[];
}

// ─── Primer hito faltante (clave de la clasificación) ──────────────────────

const TIENE: Record<HitoFaltante, (f: EntradaConsolidada) => boolean> = {
  solicitud_inscripcion: (f) => f.fSolicitudInscripcion !== null,
  inscripcion:           (f) => f.fInscripcion !== null,
  patente_recibida:      (f) => f.fPatenteRecibida !== null,
  patente_entregada:     (f) => f.fPatenteEntregada !== null,
  solicitud_entrega:     (f) => (f.solEntrega ?? "").trim() === "Si",
  autorizacion_entrega:  (f) => (f.autorizacionEntrega ?? "").trim() === "Si",
  entrega_real:          (f) => f.entregado,
};

/** Devuelve el primer hito que falta en orden cronológico. */
function primerHitoFaltante(f: EntradaConsolidada): HitoFaltante {
  for (const h of ORDEN_HITOS) {
    if (!TIENE[h](f)) return h;
  }
  // Si todos los hitos están cumplidos (raro: significaría entregado),
  // el caso no debería ser FNE. Devolvemos entrega_real defensivamente.
  return "entrega_real";
}

/** Último hito completado del caso (fecha) — para aging desde último hito. */
function fechaUltimoHito(f: EntradaConsolidada): Date | null {
  let ultima: Date | null = null;
  const candidatas: (Date | null)[] = [
    f.fSolicitudInscripcion,
    f.fInscripcion,
    f.fPatenteRecibida,
    f.fPatenteEntregada,
  ];
  for (const c of candidatas) {
    if (c instanceof Date && (!ultima || c.getTime() > ultima.getTime())) {
      ultima = c;
    }
  }
  // Fallback: la factura (que siempre existe en el universo CN).
  return ultima ?? (f.fFactura instanceof Date ? f.fFactura : null);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function percentil(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

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

export function calcularCapaC(
  universo: EntradaConsolidada[],
  hoy: Date = new Date(),
): CapaC {
  // FNE = facturado SIN entrega real.
  const fne = universo.filter((f) => f.fFactura instanceof Date && !f.entregado);

  // Particionar por primer hito faltante (clasificación 1-a-1).
  const buckets = new Map<HitoFaltante, EntradaConsolidada[]>();
  for (const h of ORDEN_HITOS) buckets.set(h, []);
  for (const f of fne) {
    const h = primerHitoFaltante(f);
    buckets.get(h)!.push(f);
  }

  const grupos: GrupoFNE[] = ORDEN_HITOS.map((h) => {
    const filas = buckets.get(h) ?? [];
    const monto = filas.reduce((s, f) => s + (f.valorFactura ?? 0), 0);
    const agingsFac: number[] = [];
    const agingsUH: number[] = [];
    for (const f of filas) {
      if (f.fFactura instanceof Date) {
        agingsFac.push((hoy.getTime() - f.fFactura.getTime()) / MS_DIA);
      }
      const uh = fechaUltimoHito(f);
      if (uh) agingsUH.push((hoy.getTime() - uh.getTime()) / MS_DIA);
    }
    // Brief §8 — "Todo listo sin entrega" tiene leyenda especial.
    const labelAlt = h === "entrega_real" ? "Todo listo sin entrega" : undefined;
    const leyenda =
      h === "entrega_real"
        ? "Termómetro de instrumentación · captura simultánea Patente Entregada=Entrega Real en 86,6% de casos (brief §4)."
        : undefined;
    return {
      hito: h,
      label: LABEL_HITO_FALTANTE[h],
      labelAlt,
      count: filas.length,
      monto,
      agingFacturaMediana: mediana(agingsFac),
      agingFacturaP90: percentil(agingsFac, 0.9),
      agingUltimoHitoMediana: mediana(agingsUH),
      responsable: RESPONSABLE_POR_HITO_FALTANTE[h],
      accion: ACCION_POR_HITO_FALTANTE[h],
      topSucursales: topPorClave(filas, "sucursal", 5),
      topResponsables: topPorClave(filas, "vendedor", 5),
      topCanales: topPorCanal(filas, 5),
      filas,
      leyenda,
    };
  });

  return {
    totalFNE: fne.length,
    totalMonto: fne.reduce((s, f) => s + (f.valorFactura ?? 0), 0),
    grupos,
  };
}
