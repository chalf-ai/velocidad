"use client";

/**
 * Card resumida de un indicador del Score Gerencial.
 *
 * Vista compacta · una fila por indicador con:
 *   · Punto de color · nombre · ícono de estado (⚠/✓)
 *   · Valor actual grande (con label "actual")
 *   · META destacada (chip con tono según cumplimiento)
 *   · BRECHA en puntos (cuando no cumple) — chip rojo prominente
 *   · Monto + sub-detalle
 *   · Gauge circular (% cumplimiento de puntos / peso)
 *
 * V2.6 · Decisión usuario (2026-06): la META y la BRECHA deben ser
 * legibles a la primera. Antes eran texto chico gris y se perdían.
 * Ahora son chips con tono semántico (verde si cumple, ámbar/rojo si no).
 *
 * Click → mismo foco que la card detallada (sincronizado en page.tsx).
 */

import { AlertTriangle, CheckCircle2, Target, TrendingDown } from "lucide-react";
import { fmtCLPCompact } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Indicador } from "@/lib/selectors/score-gerencial";

export function IndicadorResumido({
  indicador,
  active,
  onClick,
}: {
  indicador: Indicador;
  active: boolean;
  onClick: () => void;
}) {
  const pctCumplimiento = (indicador.puntos / indicador.peso) * 100;
  const brechaPts = indicador.peso - indicador.puntos;
  const Icon = indicador.cumple ? CheckCircle2 : AlertTriangle;
  const iconColor = indicador.cumple ? "text-[--color-ok]" : "text-[--color-warning]";

  // Tono de la pill de meta · verde si cumple, neutro si no (la brecha va a parte)
  const metaTone = indicador.cumple ? "ok" : "neutro";
  // Tono de la pill de brecha · severidad creciente según cuánto se pierde
  const brechaTone =
    brechaPts >= indicador.peso * 0.75
      ? "critico"
      : brechaPts >= indicador.peso * 0.4
        ? "danger"
        : "warning";

  return (
    <button
      onClick={onClick}
      className={cn(
        "surface bg-white px-4 py-3.5 text-left transition w-full min-w-0",
        "hover:shadow-md",
        active
          ? "ring-2 ring-[--color-accent] border-[--color-accent]"
          : "hover:border-[--color-accent]/40",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Lado izquierdo · texto */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span
              className="inline-block size-2 rounded-sm shrink-0"
              style={{ backgroundColor: indicador.color }}
            />
            <span className="text-[12px] font-semibold text-[--color-fg] tracking-tight truncate">
              {indicador.nombre}
            </span>
            <Icon className={cn("size-3.5 shrink-0 ml-auto", iconColor)} />
          </div>

          {/* Valor actual */}
          <div className="flex items-baseline gap-1.5">
            <span
              className="text-[28px] font-bold tracking-tight leading-none mono"
              style={{ color: indicador.color }}
            >
              {indicador.valorTexto}
            </span>
            <span className="text-[10px] uppercase tracking-[0.08em] text-[--color-fg-dim] font-semibold">
              actual
            </span>
          </div>

          {/* META + BRECHA · bloque destacado */}
          <div className="mt-2.5 space-y-1">
            <MetaPill tone={metaTone} meta={indicador.metaTexto.split(" del")[0]} />
            {!indicador.cumple && (
              <BrechaPill tone={brechaTone} brecha={brechaPts} peso={indicador.peso} />
            )}
          </div>

          {/* Monto + detalle */}
          <div className="text-[11px] text-[--color-fg] font-semibold mt-2">
            {fmtCLPCompact(indicador.monto)}
          </div>
          {indicador.detalle && (
            <div className="text-[10px] text-[--color-fg-dim] mt-0.5 truncate" title={indicador.detalle}>
              {indicador.detalle}
            </div>
          )}
        </div>

        {/* Lado derecho · gauge donut */}
        <GaugeDonut pct={pctCumplimiento} color={indicador.color} />
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pills semánticos · META y BRECHA
// ─────────────────────────────────────────────────────────────────────────────

function MetaPill({
  tone,
  meta,
}: {
  tone: "ok" | "neutro";
  meta: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold border",
        tone === "ok"
          ? "bg-[--color-success-dim] text-[--color-ok] border-[--color-ok]/25"
          : "bg-[--color-bg-elev-1] text-[--color-fg] border-[--color-border]",
      )}
    >
      <Target className="size-3" strokeWidth={2.25} />
      <span className="uppercase tracking-[0.08em] text-[9.5px] opacity-70">
        Meta
      </span>
      <span className="mono font-bold">{meta}</span>
    </div>
  );
}

function BrechaPill({
  tone,
  brecha,
  peso,
}: {
  tone: "warning" | "danger" | "critico";
  brecha: number;
  peso: number;
}) {
  const cls =
    tone === "critico"
      ? "bg-[--color-critical-dim] text-[#fca5a5] border-[--color-critical]/35"
      : tone === "danger"
        ? "bg-[--color-danger-dim] text-[--color-danger] border-[--color-danger]/30"
        : "bg-[--color-warning-dim] text-[--color-warning] border-[--color-warning]/25";
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold border",
        cls,
      )}
    >
      <TrendingDown className="size-3" strokeWidth={2.25} />
      <span className="uppercase tracking-[0.08em] text-[9.5px] opacity-80">
        Brecha
      </span>
      <span className="mono font-bold">
        −{brecha} pts
      </span>
      <span className="text-[9.5px] opacity-75">de {peso}</span>
    </div>
  );
}

function GaugeDonut({ pct, color }: { pct: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="shrink-0">
      <svg viewBox="0 0 36 36" className="size-14">
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          stroke="var(--color-bg-elev-1)"
          strokeWidth="3.5"
        />
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          stroke={color}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={`${clamped}, 100`}
          opacity={0.9}
        />
        <text
          x="18"
          y="20.5"
          textAnchor="middle"
          className="fill-[--color-fg] font-bold"
          style={{ fontSize: "9px" }}
        >
          {Math.round(clamped)}%
        </text>
      </svg>
    </div>
  );
}
