"use client";

/**
 * Card individual de un indicador del Score Gerencial.
 * Click → abre drill inline en el orquestador (`page.tsx`).
 */

import { CheckCircle2, AlertTriangle } from "lucide-react";
import { fmtCLPCompact, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Indicador } from "@/lib/selectors/score-gerencial";

export function IndicadorCard({
  indicador,
  active,
  onClick,
}: {
  indicador: Indicador;
  active: boolean;
  onClick: () => void;
}) {
  const pctBarra = (indicador.puntos / indicador.peso) * 100;
  const Icon = indicador.cumple ? CheckCircle2 : AlertTriangle;
  const iconColor = indicador.cumple ? "text-[--color-ok]" : "text-[--color-warning]";

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
        style={{ backgroundColor: indicador.color }}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block size-2 rounded-sm shrink-0"
              style={{ backgroundColor: indicador.color }}
            />
            <span className="text-[12.5px] font-semibold text-[--color-fg] tracking-tight">
              {indicador.nombre}
            </span>
          </div>
          <div className="text-[10.5px] text-[--color-fg-dim] mt-0.5">
            Meta: {indicador.metaTexto}
          </div>
        </div>
        <Icon className={cn("size-4 shrink-0", iconColor)} />
      </div>

      {/* Valor actual */}
      <div className="flex items-baseline gap-2 mt-2">
        <span className="text-[22px] font-bold tracking-tight text-[--color-fg] leading-none mono">
          {indicador.valorTexto}
        </span>
        <span className="text-[11px] text-[--color-fg-muted]">actual</span>
      </div>
      {indicador.detalle && (
        <div className="text-[10.5px] text-[--color-fg-dim] mt-0.5">
          {indicador.detalle}
        </div>
      )}

      {/* Puntos */}
      <div className="mt-3">
        <div className="flex items-baseline justify-between text-[10.5px] text-[--color-fg-muted] mb-1">
          <span>
            Puntos:{" "}
            <b className="text-[--color-fg]">
              {indicador.puntos}/{indicador.peso}
            </b>
          </span>
          <span>
            Brecha:{" "}
            <b
              className={
                indicador.cumple
                  ? "text-[--color-ok]"
                  : "text-[--color-danger]"
              }
            >
              {indicador.peso - indicador.puntos} pts
            </b>
          </span>
        </div>
        <div className="h-2 bg-[--color-bg-elev-1] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pctBarra}%`,
              backgroundColor: indicador.color,
              opacity: 0.85,
            }}
          />
        </div>
      </div>

      {/* Monto + casos */}
      <div className="mt-2.5 pt-2 border-t border-[--color-border] grid grid-cols-2 gap-2 text-[10.5px]">
        <div>
          <div className="text-[--color-fg-dim] uppercase tracking-[0.05em] text-[9.5px]">
            Casos
          </div>
          <div className="text-[--color-fg] font-semibold mono">
            {fmtNum(indicador.casos)}
          </div>
        </div>
        <div>
          <div className="text-[--color-fg-dim] uppercase tracking-[0.05em] text-[9.5px]">
            Monto
          </div>
          <div className="text-[--color-fg] font-semibold mono">
            {fmtCLPCompact(indicador.monto)}
          </div>
        </div>
      </div>

      {/* Acción */}
      <div className="mt-2 rounded-md bg-[--color-bg-elev-1] px-2.5 py-1.5 text-[10.5px] leading-snug text-[--color-fg-muted]">
        <span className="font-semibold text-[--color-fg]">Acción: </span>
        {indicador.accion}
      </div>

      <div className="mt-2 text-right text-[11px] text-[--color-accent]">
        {active ? "Cola abierta abajo →" : "Abrir cola →"}
      </div>
    </button>
  );
}
