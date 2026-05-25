"use client";

/**
 * PRESIÓN OPERACIONAL — bloque principal del caso (gauge horizontal).
 *
 * Una sola lectura de cuánto pesa el VIN: score 0-100 (mayor = peor), nivel
 * operacional (normal / seguimiento / prioritario / crítico) y la acción sugerida.
 * Lee el ScoreVIN vivo (`calcularScore`) — la MISMA presión que usa el Centro de
 * Acción. No recalcula nada.
 */

import { cn } from "@/lib/cn";
import type { ScoreVIN, Severidad } from "@/lib/selectors/score";

/** Nivel operacional legible por severidad del score. */
export const NIVEL_OPERACIONAL: Record<Severidad, { label: string; color: string }> = {
  critica: { label: "Crítico", color: "var(--color-danger)" },
  alta: { label: "Prioritario", color: "var(--color-danger)" },
  media: { label: "Seguimiento", color: "var(--color-warning)" },
  info: { label: "Normal", color: "var(--color-fg-dim)" },
};

/** Score como PRESIÓN OPERACIONAL — gauge horizontal, no número plano. */
export function PresionOperacional({ score }: { score: ScoreVIN }) {
  const pct = Math.min(100, Math.max(0, score.total));
  const nivel = NIVEL_OPERACIONAL[score.severidad];
  const critico = score.severidad === "critica" || score.severidad === "alta";
  const color = nivel.color;
  return (
    <div
      className="rounded-xl border p-3.5"
      style={{
        borderColor: critico ? "rgba(220,38,38,0.25)" : "var(--color-border)",
        background: critico ? "rgba(220,38,38,0.03)" : "var(--color-bg-elev-1)",
      }}
    >
      <div className="flex items-end justify-between">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-semibold">
          Presión operacional
        </div>
        <div className="flex items-baseline gap-1 leading-none">
          <span className="display text-[28px]" style={{ color }}>
            {score.total}
          </span>
          <span className="text-[12px] text-[--color-fg-dim]">/100</span>
        </div>
      </div>
      <div className="mt-2.5 h-2.5 rounded-full bg-[--color-bg-elev-3] overflow-hidden relative">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
        {[40, 60, 80].map((m) => (
          <span
            key={m}
            className="absolute top-0 bottom-0 w-px bg-white/70"
            style={{ left: `${m}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[10.5px] uppercase tracking-[0.1em] font-bold" style={{ color }}>
          {nivel.label}
        </span>
        <span className="text-[11px] text-[--color-fg-muted] text-right">{score.accionSugerida}</span>
      </div>
    </div>
  );
}

/** Pastilla compacta de nivel operacional (para encabezados / KPIs). */
export function NivelPill({ severidad }: { severidad: Severidad }) {
  const nivel = NIVEL_OPERACIONAL[severidad];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-bold uppercase tracking-wide border",
      )}
      style={{ color: nivel.color, borderColor: `${nivel.color}55`, background: `${nivel.color}12` }}
    >
      {nivel.label}
    </span>
  );
}
