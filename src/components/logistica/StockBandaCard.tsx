"use client";

/**
 * Card de una banda de aging dentro de una familia de stock crítico.
 */

import { ArrowRight, AlertTriangle, Clock } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import type { BandaAging } from "@/lib/logistica/log-stock-critico";

export function StockBandaCard({
  banda,
  color,
  active,
  onClick,
  topMarcas,
  topSucursales,
}: {
  banda: BandaAging;
  /** Color de la familia (owner). */
  color: string;
  active: boolean;
  onClick: () => void;
  topMarcas: Array<{ label: string; n: number }>;
  topSucursales: Array<{ label: string; n: number }>;
}) {
  const tone: "muted" | "warning" | "danger" =
    banda.id === ">60" ? "danger" : banda.id === "31-60" ? "warning" : "muted";
  const Icon = banda.id === ">60" ? AlertTriangle : Clock;

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative surface bg-white px-4 py-3.5 text-left transition w-full min-w-0",
        "hover:shadow-md",
        active
          ? "ring-2 ring-[--color-accent] border-[--color-accent]"
          : "hover:border-[--color-accent]/40",
      )}
    >
      <div
        className="absolute top-0 left-0 right-0 h-[3px] rounded-t-lg"
        style={{ backgroundColor: color }}
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon
            className={cn(
              "size-3.5",
              tone === "danger"
                ? "text-[--color-danger]"
                : tone === "warning"
                  ? "text-[--color-warning]"
                  : "text-[--color-fg-dim]",
            )}
          />
          <span className="text-[11.5px] font-semibold text-[--color-fg]">
            {banda.label}
          </span>
        </div>
        <Badge tone={tone} size="xs">
          {banda.id === ">60" ? "crítico" : banda.id === "31-60" ? "atención" : "normal"}
        </Badge>
      </div>

      <div className="mt-2 text-[28px] font-bold tracking-tight leading-none mono text-[--color-fg]">
        {fmtNum(banda.filas.length)}
      </div>
      <div className="text-[10.5px] text-[--color-fg-muted] mt-0.5">
        vehículos en esta banda
      </div>

      {topMarcas.length > 0 && (
        <div className="mt-2.5 pt-2 border-t border-[--color-border]">
          <div className="text-[9.5px] uppercase tracking-[0.08em] text-[--color-fg-dim] font-semibold mb-1">
            Top marcas
          </div>
          <div className="space-y-0.5">
            {topMarcas.map((m, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-[10.5px] text-[--color-fg-muted]"
              >
                <span className="truncate" title={m.label}>
                  {m.label}
                </span>
                <span className="mono shrink-0 ml-2 text-[--color-fg] font-semibold">
                  {fmtNum(m.n)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {topSucursales.length > 0 && (
        <div className="mt-2">
          <div className="text-[9.5px] uppercase tracking-[0.08em] text-[--color-fg-dim] font-semibold mb-1">
            Top sucursales
          </div>
          <div className="space-y-0.5">
            {topSucursales.map((s, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-[10.5px] text-[--color-fg-muted]"
              >
                <span className="truncate" title={s.label}>
                  {s.label}
                </span>
                <span className="mono shrink-0 ml-2 text-[--color-fg] font-semibold">
                  {fmtNum(s.n)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 text-right text-[11px] text-[--color-accent] flex items-center justify-end gap-1">
        {active ? "Cola abierta" : "Ver cola"}
        <ArrowRight className="size-3" />
      </div>
    </button>
  );
}
