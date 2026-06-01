"use client";

import { Gauge, ClipboardCheck, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import type { EjeId } from "@/components/historico/HeroEjecutivoVO";

interface Props {
  activo: EjeId;
  onChange: (e: EjeId) => void;
  countVelocidad: number;
  countCumplimiento: number;
  countCalidad: number;
}

function fmtK(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

const ITEMS: Array<{ id: EjeId; label: string; icon: typeof Gauge }> = [
  { id: "velocidad", label: "Velocidad", icon: Gauge },
  { id: "cumplimiento", label: "Cumplimiento", icon: ClipboardCheck },
  { id: "calidad", label: "Cierre", icon: ShieldCheck },
];

export function EjeTabs({ activo, onChange, countVelocidad, countCumplimiento, countCalidad }: Props) {
  const counts: Record<EjeId, number> = {
    velocidad: countVelocidad,
    cumplimiento: countCumplimiento,
    calidad: countCalidad,
  };
  return (
    <div className="inline-flex items-center rounded-xl bg-[--color-bg-elev-1] border border-[--color-border] p-1 gap-1">
      {ITEMS.map((it) => {
        const active = activo === it.id;
        const Icon = it.icon;
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            className={cn(
              "inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[13px] font-semibold transition ring-1 ring-inset",
              active
                ? "bg-[--color-accent-dim] text-[--color-accent] ring-[--color-accent]"
                : "ring-transparent text-[--color-fg-muted] hover:text-[--color-fg]",
            )}
          >
            <Icon className="size-3.5" />
            {it.label}
            <span
              className={cn(
                "text-[11px] rounded-md px-1.5 py-0.5 font-semibold tabular-nums",
                active
                  ? "bg-white text-[--color-accent] ring-1 ring-inset ring-[--color-accent]/30"
                  : "bg-[--color-bg-elev-3] text-[--color-fg-muted]",
              )}
            >
              {fmtK(counts[it.id])}
            </span>
          </button>
        );
      })}
    </div>
  );
}
