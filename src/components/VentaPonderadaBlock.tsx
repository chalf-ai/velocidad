"use client";

/**
 * Bloque informativo · "Venta ponderada".
 *
 * Decisión usuario 2026-06: la base de cálculo del Velocity OS migra de
 * promedio simple Q1/3 a ventana ponderada N-1 50% / N-2 30% / N-3 20%.
 * Este bloque hace visible esa base y sus ratios contextuales:
 *
 *   · Venta ponderada (unidades + monto) — la base de eficiencia.
 *   · Stock propio / Venta ponderada %   — contextual.
 *   · Capital utilizado / Venta pond. %  — contextual (opcional).
 *
 * NO reemplaza la meta del Score Gerencial (Stock Propio ≤ 5%). La meta
 * y la lógica de score (40+30+20+10 con excepción USADOS) se mantienen.
 * Este bloque solo agrega lectura gerencial complementaria.
 *
 * Se inserta en `/dashboard` y `/score-gerencial`. Lee la marca del filtro
 * global y resuelve `ventaMensualPromedio` directamente.
 */

import { TrendingUp, Info } from "lucide-react";
import {
  ventaMensualPromedio,
  VENTANA_PONDERACION_LABEL,
  VENTANA_PONDERACION_MESES,
} from "@/lib/ventas-q1";
import { fmtCLPCompact, fmtNum, fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";

export interface VentaPonderadaBlockProps {
  /** Marca operacional del filtro global (null = total Pompeyo). */
  marca: string | null;
  /** Monto en CLP del Stock Propio (capital pagado en stock activo). */
  stockPropioMonto?: number | null;
  /**
   * Capital utilizado total (stock + puente + saldos + bonos + prov.).
   * Opcional; si llega, muestra el ratio Capital/Venta ponderada.
   */
  capitalUtilizadoMonto?: number | null;
  /** Margen visual extra abajo (default sí). */
  withBottomMargin?: boolean;
}

export function VentaPonderadaBlock({
  marca,
  stockPropioMonto,
  capitalUtilizadoMonto,
  withBottomMargin = true,
}: VentaPonderadaBlockProps) {
  const venta = ventaMensualPromedio(marca);
  const marcaLabel = marca ?? "Total Pompeyo";

  // ── Sin datos · estado vacío ───────────────────────────────────────────
  if (!venta) {
    return (
      <div
        className={cn(
          "surface bg-white px-5 py-4 border border-[--color-border]",
          withBottomMargin && "mb-6",
        )}
      >
        <div className="flex items-center gap-2 text-[12px] text-[--color-fg-muted]">
          <Info className="size-4" />
          <span>
            Sin ventas registradas para <strong>{marcaLabel}</strong> en la ventana ponderada.
            Score Gerencial igual se calcula; los ratios MOS / Capital-Venta quedan sin
            denominador.
          </span>
        </div>
      </div>
    );
  }

  const stockPctVenta =
    stockPropioMonto != null && venta.monto > 0
      ? (stockPropioMonto / venta.monto) * 100
      : null;
  const capitalPctVenta =
    capitalUtilizadoMonto != null && venta.monto > 0
      ? (capitalUtilizadoMonto / venta.monto) * 100
      : null;

  return (
    <div
      className={cn(
        "surface bg-white px-5 py-4 border border-[--color-border]",
        withBottomMargin && "mb-6",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="size-4 text-[--color-accent]" />
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[--color-fg]">
          Venta ponderada · {marcaLabel}
        </h3>
        <span className="ml-auto text-[10px] text-[--color-fg-muted] mono">
          {VENTANA_PONDERACION_LABEL} · {VENTANA_PONDERACION_MESES}
        </span>
      </div>

      {/* Grid de métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Venta ponderada (unidades + $) */}
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[--color-fg-dim] font-semibold">
            Venta ponderada
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[22px] font-bold leading-none mono text-[--color-fg]">
              {fmtNum(Math.round(venta.unidades))}
            </span>
            <span className="text-[11px] text-[--color-fg-muted] font-semibold">u</span>
          </div>
          <div className="text-[13px] mono font-semibold text-[--color-fg]">
            {fmtCLPCompact(venta.monto)}
          </div>
        </div>

        {/* Stock propio / Venta ponderada % */}
        <div className="space-y-1 border-l border-[--color-border] sm:pl-4">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[--color-fg-dim] font-semibold">
            Stock propio / Venta pond.
          </div>
          {stockPctVenta != null ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-[22px] font-bold leading-none mono text-[--color-fg]">
                  {fmtPct(stockPctVenta / 100)}
                </span>
                <span className="text-[10px] text-[--color-fg-muted]">contextual</span>
              </div>
              <div className="text-[11px] text-[--color-fg-muted]">
                {fmtCLPCompact(stockPropioMonto ?? 0)} sobre {fmtCLPCompact(venta.monto)}
              </div>
            </>
          ) : (
            <div className="text-[11px] text-[--color-fg-muted] italic">
              Sin stock propio cargado
            </div>
          )}
        </div>

        {/* Capital utilizado / Venta ponderada % */}
        <div className="space-y-1 border-l border-[--color-border] sm:pl-4">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[--color-fg-dim] font-semibold">
            Capital util. / Venta pond.
          </div>
          {capitalPctVenta != null ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-[22px] font-bold leading-none mono text-[--color-fg]">
                  {fmtPct(capitalPctVenta / 100)}
                </span>
                <span className="text-[10px] text-[--color-fg-muted]">contextual</span>
              </div>
              <div className="text-[11px] text-[--color-fg-muted]">
                {fmtCLPCompact(capitalUtilizadoMonto ?? 0)} sobre {fmtCLPCompact(venta.monto)}
              </div>
            </>
          ) : (
            <div className="text-[11px] text-[--color-fg-muted] italic">
              Capital utilizado no disponible
            </div>
          )}
        </div>
      </div>

      {/* Nota al pie */}
      <div className="mt-3 pt-3 border-t border-[--color-border] flex items-start gap-2">
        <Info className="size-3.5 text-[--color-fg-muted] shrink-0 mt-0.5" />
        <p className="text-[10.5px] text-[--color-fg-muted] leading-snug">
          Base de referencia comercial reciente; no reemplaza la meta Stock Propio ≤ 5%.
        </p>
      </div>
    </div>
  );
}
