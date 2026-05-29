"use client";

import { Briefcase, Truck, MessageCircle, Users, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import type { ProcesoActivo } from "@/lib/historico/vista-derivados";

interface Props {
  activo: ProcesoActivo;
  onChange: (p: ProcesoActivo) => void;
  /** Conteos por proceso. NO se hardcodean — los provee el caller. */
  counts: Record<ProcesoActivo, number>;
}

interface ItemDef {
  id: ProcesoActivo;
  label: string;
  icon: typeof Briefcase;
}

const ITEMS: ItemDef[] = [
  { id: "control_negocio",        label: "Control de Negocio",   icon: Briefcase },
  { id: "logistica",              label: "Logística",            icon: Truck },
  { id: "comercial",              label: "Comercial",            icon: MessageCircle },
  { id: "cliente",                label: "Cliente",              icon: Users },
  { id: "cierre_y_cumplimiento",  label: "Cierre y Cumplimiento", icon: ShieldCheck },
];

/**
 * Selector principal de procesos. 5 tabs grandes, scroll-x si no caben.
 * Conteo per-tab viene del caller (universo del proceso correspondiente).
 */
export function ProcesoSelector({ activo, onChange, counts }: Props) {
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="inline-flex items-stretch gap-2 min-w-full">
        {ITEMS.map((it) => {
          const active = activo === it.id;
          const Icon = it.icon;
          const count = counts[it.id] ?? 0;
          return (
            <button
              key={it.id}
              onClick={() => onChange(it.id)}
              className={cn(
                "group flex-1 min-w-[160px] rounded-xl px-4 py-3 text-left transition",
                "border ring-1 ring-inset",
                // Patrón selected-soft: fondo dim + ring + texto del tono.
                // Mantiene legibilidad sobre fondos claros (contraste AA ≥ 5.8:1).
                active
                  ? "bg-[--color-accent-dim] border-[--color-accent] ring-[--color-accent] text-[--color-accent]"
                  : "bg-[--color-bg-elev-1] border-[--color-border] ring-transparent text-[--color-fg] hover:border-[--color-border-strong] hover:ring-[--color-accent]/20",
              )}
            >
              <div className="flex items-center gap-2">
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    active ? "text-[--color-accent]" : "text-[--color-fg-muted] group-hover:text-[--color-accent]",
                  )}
                />
                <span
                  className={cn(
                    "text-[13px] font-semibold leading-tight truncate",
                    active ? "text-[--color-accent]" : "text-[--color-fg]",
                  )}
                >
                  {it.label}
                </span>
              </div>
              <div
                className={cn(
                  "mt-1.5 text-[18px] font-semibold tabular-nums leading-none",
                  active ? "text-[--color-accent]" : "text-[--color-fg]",
                )}
              >
                {fmtNum(count)}
              </div>
              <div
                className={cn(
                  "mt-0.5 text-[10.5px] uppercase tracking-wider font-medium",
                  "text-[--color-fg-muted]",
                )}
              >
                casos
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
