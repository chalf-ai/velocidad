"use client";

/**
 * Card individual de un motor (1 de 3 en la fila protagonista).
 *
 * Layout:
 *   · Banda superior con color del owner
 *   · Número del motor (M1/M2/M3) + nombre + owner
 *   · Número grande (mediana o % global) con unidad
 *   · Sub-stats (avg/P90 · breakdown por sub-corte)
 *   · CTA "Ver detalle →" (drill inline en page.tsx)
 */

import { TrendingDown, TrendingUp, ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import type { MotorMeta } from "@/lib/logistica/log-responsables";
import { COLOR_POR_OWNER, LABEL_OWNER } from "@/lib/logistica/log-responsables";

export interface MotorCardData {
  meta: MotorMeta;
  /** Número grande (formateado, ej. "18 d" o "78.5%"). */
  valorPrincipal: string;
  /** Etiqueta debajo del número grande (ej. "mediana", "global"). */
  valorLabel: string;
  /** Sub-stats inline (avg · P90 · etc). */
  subStats?: string;
  /** Breakdown (2-4 líneas con sub-cortes y badges). */
  breakdown?: Array<{ label: string; valor: string; tone?: "ok" | "warn" | "muted" }>;
  /** Brecha o nota destacada al pie (opcional). */
  brecha?: { label: string; valor: string; tone?: "ok" | "warn" };
}

export function MotorCard({
  data,
  active,
  onClick,
}: {
  data: MotorCardData;
  active: boolean;
  onClick: () => void;
}) {
  const { meta } = data;
  const color = COLOR_POR_OWNER[meta.owner];
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative surface bg-white px-5 pt-4 pb-4 text-left transition w-full min-w-0",
        "hover:shadow-md",
        active
          ? "ring-2 ring-[--color-accent] border-[--color-accent]"
          : "hover:border-[--color-accent]/40",
      )}
    >
      {/* Banda superior color del owner */}
      <div
        className="absolute top-0 left-0 right-0 h-1 rounded-t-lg"
        style={{ backgroundColor: color }}
      />

      {/* Encabezado */}
      <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-[--color-fg-dim]">
        MOTOR {meta.numero}
      </div>
      <div className="text-[15px] font-semibold tracking-tight text-[--color-fg] mt-0.5">
        {meta.nombre}
      </div>
      <div
        className="text-[11px] mt-0.5 flex items-center gap-1.5"
        style={{ color }}
      >
        <span
          className="inline-block size-2 rounded-sm shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="font-semibold">{LABEL_OWNER[meta.owner]}</span>
      </div>

      {/* Número grande */}
      <div className="mt-4 flex items-baseline gap-2">
        <span
          className="text-[40px] font-bold tracking-tight leading-none mono"
          style={{ color }}
        >
          {data.valorPrincipal}
        </span>
        <span className="text-[12.5px] text-[--color-fg-muted] font-semibold">
          {data.valorLabel}
        </span>
      </div>

      {data.subStats && (
        <div className="text-[11px] text-[--color-fg-muted] mt-1">
          {data.subStats}
        </div>
      )}

      {/* Breakdown */}
      {data.breakdown && data.breakdown.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[--color-border] space-y-1">
          {data.breakdown.map((b, i) => (
            <div
              key={i}
              className="flex items-center justify-between text-[11.5px]"
            >
              <span className="text-[--color-fg-muted]">{b.label}</span>
              <span
                className={cn(
                  "font-semibold mono",
                  b.tone === "ok"
                    ? "text-[--color-ok]"
                    : b.tone === "warn"
                      ? "text-[--color-warning]"
                      : b.tone === "muted"
                        ? "text-[--color-fg-muted]"
                        : "text-[--color-fg]",
                )}
              >
                {b.valor}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Brecha */}
      {data.brecha && (
        <div
          className={cn(
            "mt-3 rounded-md px-2.5 py-1.5 text-[11px] flex items-center justify-between",
            data.brecha.tone === "warn"
              ? "bg-[--color-warning-dim] text-[--color-warning]"
              : "bg-[--color-success-dim] text-[--color-ok]",
          )}
        >
          <span className="flex items-center gap-1.5">
            {data.brecha.tone === "warn" ? (
              <TrendingDown className="size-3" />
            ) : (
              <TrendingUp className="size-3" />
            )}
            <span className="font-semibold">{data.brecha.label}</span>
          </span>
          <span className="font-bold mono">{data.brecha.valor}</span>
        </div>
      )}

      {/* CTA */}
      <div className="mt-3 text-right text-[11.5px] text-[--color-accent] flex items-center justify-end gap-1">
        {active ? "Cola abierta abajo" : "Ver detalle"}
        <ArrowRight className="size-3" />
      </div>
    </button>
  );
}
