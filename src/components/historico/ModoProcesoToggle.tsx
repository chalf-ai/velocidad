"use client";

import { Archive, Inbox } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import type { ModoProceso } from "@/lib/historico/vista-derivados";

interface Props {
  activo: ModoProceso;
  onChange: (m: ModoProceso) => void;
  /** Conteo del universo cerrado (para el badge del toggle). */
  countCerrado: number;
  /** Conteo del universo abierto (backlog). */
  countAbierto: number;
}

interface ItemDef {
  id: ModoProceso;
  label: string;
  icon: typeof Archive;
}

const ITEMS: ItemDef[] = [
  { id: "historico_cerrado", label: "Histórico cerrado", icon: Archive },
  { id: "backlog_abierto",   label: "Backlog abierto",   icon: Inbox },
];

/**
 * Toggle interno del proceso. Segmented control con badge de count en cada
 * opción. El caller debe renderizarlo solo cuando proceso != cierre_y_cumplimiento.
 */
export function ModoProcesoToggle({ activo, onChange, countCerrado, countAbierto }: Props) {
  const counts: Record<ModoProceso, number> = {
    historico_cerrado: countCerrado,
    backlog_abierto: countAbierto,
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
              {fmtNum(counts[it.id])}
            </span>
          </button>
        );
      })}
    </div>
  );
}
