"use client";

import { cn } from "@/lib/cn";
import { COMPONENTES_LABEL } from "@/lib/selectors/score-config";
import type { RazonScore, ScoreVIN } from "@/lib/selectors/score";

/** Lista explicable de las razones del score · cada línea muestra cuánto sumó. */
export function RazonesScore({ score }: { score: ScoreVIN }) {
  if (score.razones.length === 0) {
    return (
      <div className="text-[12px] text-[--color-fg-muted] italic">
        Sin factores de riesgo detectados.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {score.razones.map((r) => (
        <RazonLine key={r.factor} r={r} />
      ))}
      <div className="border-t border-[--color-border-soft] pt-2 mt-2 flex items-center justify-between text-[12px]">
        <span className="text-[--color-fg-muted] uppercase tracking-[0.1em] font-semibold">
          Total
        </span>
        <span className="mono font-bold text-[--color-fg]">{score.total} / 100</span>
      </div>
    </div>
  );
}

function RazonLine({ r }: { r: RazonScore }) {
  const cls =
    r.componente === "riesgo"
      ? "text-[--color-danger]"
      : r.componente === "financiero"
        ? "text-[--color-danger]"
        : r.componente === "operacional"
          ? "text-[--color-warning]"
          : r.componente === "aging"
            ? "text-[--color-warning]"
            : "text-[--color-fg-muted]";
  return (
    <div className="flex items-center justify-between gap-3 text-[12px]">
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn("mono font-bold w-8 text-right", cls)}>+{r.puntos}</span>
        <span className="text-[--color-fg] truncate">{r.descripcion.replace(/^\+\d+\s/, "")}</span>
      </div>
      <span className="text-[10px] uppercase tracking-wider text-[--color-fg-dim] shrink-0">
        {COMPONENTES_LABEL[r.componente]}
      </span>
    </div>
  );
}

/** Mini barras horizontales de componentes — overview rápido. */
export function ComponentesBars({ score }: { score: ScoreVIN }) {
  const items = [
    { key: "aging", label: COMPONENTES_LABEL.aging, val: score.componentes.aging, max: 25 },
    { key: "financiero", label: COMPONENTES_LABEL.financiero, val: score.componentes.financiero, max: 25 },
    { key: "operacional", label: COMPONENTES_LABEL.operacional, val: score.componentes.operacional, max: 25 },
    { key: "caja", label: COMPONENTES_LABEL.caja, val: score.componentes.caja, max: 15 },
    { key: "riesgo", label: COMPONENTES_LABEL.riesgo, val: score.componentes.riesgo, max: 10 },
  ];
  return (
    <div className="space-y-1.5">
      {items.map((it) => {
        const pct = it.max > 0 ? it.val / it.max : 0;
        const colorClass =
          it.val === 0
            ? "bg-[--color-bg-elev-3]"
            : pct >= 0.7
              ? "bg-[--color-danger]"
              : pct >= 0.4
                ? "bg-[--color-warning]"
                : "bg-[--color-fg-dim]";
        return (
          <div key={it.key} className="flex items-center gap-3 text-[11px]">
            <span className="text-[--color-fg-muted] w-24 shrink-0">{it.label}</span>
            <div className="flex-1 h-1.5 rounded-full bg-[--color-bg-elev-3] overflow-hidden">
              <div className={cn("h-full", colorClass)} style={{ width: `${pct * 100}%` }} />
            </div>
            <span className="mono text-[--color-fg-muted] w-12 text-right shrink-0">
              {it.val}/{it.max}
            </span>
          </div>
        );
      })}
    </div>
  );
}
