"use client";

import { cn } from "@/lib/cn";
import { SEVERIDAD_LABEL, type ScoreVIN } from "@/lib/selectors/score";

/** Badge circular tipo gauge con el score 0-100 + color por severidad. */
export function ScoreBadge({
  score,
  size = "md",
}: {
  score: ScoreVIN;
  size?: "sm" | "md" | "lg";
}) {
  const sev = score.severidad;
  const color =
    sev === "critica"
      ? "var(--color-danger)"
      : sev === "alta"
        ? "var(--color-danger)"
        : sev === "media"
          ? "var(--color-warning)"
          : "var(--color-fg-dim)";
  const bg =
    sev === "critica" || sev === "alta"
      ? "rgba(220, 38, 38, 0.08)"
      : sev === "media"
        ? "rgba(217, 119, 6, 0.08)"
        : "rgba(0,0,0,0.04)";
  const pct = score.total / 100;
  const sizes = {
    sm: { box: 36, fontTop: 12, fontBot: 8, stroke: 3 },
    md: { box: 52, fontTop: 16, fontBot: 9, stroke: 4 },
    lg: { box: 72, fontTop: 22, fontBot: 10, stroke: 5 },
  }[size];
  const r = (sizes.box - sizes.stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      className="relative inline-flex items-center justify-center shrink-0"
      style={{ width: sizes.box, height: sizes.box, background: bg, borderRadius: "50%" }}
    >
      <svg width={sizes.box} height={sizes.box} className="absolute inset-0 -rotate-90">
        <circle
          cx={sizes.box / 2}
          cy={sizes.box / 2}
          r={r}
          fill="none"
          stroke="rgba(0,0,0,0.08)"
          strokeWidth={sizes.stroke}
        />
        <circle
          cx={sizes.box / 2}
          cy={sizes.box / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={sizes.stroke}
          strokeDasharray={`${pct * c} ${c}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="relative flex flex-col items-center leading-none">
        <span
          className="mono font-bold"
          style={{ fontSize: sizes.fontTop, color }}
        >
          {score.total}
        </span>
        <span
          className="uppercase tracking-wider font-medium"
          style={{ fontSize: sizes.fontBot, color, opacity: 0.75 }}
        >
          {SEVERIDAD_LABEL[sev]}
        </span>
      </div>
    </div>
  );
}

/** Versión chip horizontal compacta (para tablas densas). */
export function ScoreChip({ score }: { score: ScoreVIN }) {
  const sev = score.severidad;
  const cls =
    sev === "critica"
      ? "bg-[--color-danger]/15 text-[--color-danger] border-[--color-danger]/30"
      : sev === "alta"
        ? "bg-[--color-danger]/10 text-[--color-danger] border-[--color-danger]/20"
        : sev === "media"
          ? "bg-[--color-warning]/10 text-[--color-warning] border-[--color-warning]/25"
          : "bg-[--color-bg-elev-3] text-[--color-fg-muted] border-[--color-border]";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium mono",
        cls,
      )}
    >
      <span className="font-bold">{score.total}</span>
      <span className="opacity-75">{SEVERIDAD_LABEL[sev].toLowerCase()}</span>
    </span>
  );
}
