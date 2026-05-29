"use client";

import { Briefcase, Truck, MessageCircle, Users, ShieldCheck } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
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
  { id: "control_negocio",        label: "Control de Negocio",    icon: Briefcase },
  { id: "logistica",              label: "Logística",             icon: Truck },
  { id: "comercial",              label: "Comercial",             icon: MessageCircle },
  { id: "cliente",                label: "Cliente",               icon: Users },
  { id: "cierre_y_cumplimiento",  label: "Cierre y Cumplimiento", icon: ShieldCheck },
];

/**
 * Selector de proceso — variante compacta tipo navegación.
 *
 * Pills horizontales con ícono + label + count inline. No es una fila de
 * cards pesadas — es navegación del sistema. Selected-soft accent en el
 * activo. Scroll-x si la pantalla es angosta.
 */
export function ProcesoSelector({ activo, onChange, counts }: Props) {
  return (
    <Card>
      <CardBody className="py-2 px-2">
        <div className="overflow-x-auto -mx-0.5">
          <div className="inline-flex items-center gap-1 min-w-full px-0.5">
            {ITEMS.map((it) => {
              const active = activo === it.id;
              const Icon = it.icon;
              const count = counts[it.id] ?? 0;
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => onChange(it.id)}
                  className={cn(
                    "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] font-semibold transition whitespace-nowrap",
                    "ring-1 ring-inset",
                    active
                      ? "bg-[--color-accent-dim] text-[--color-accent] ring-[--color-accent]"
                      : "ring-transparent text-[--color-fg-muted] hover:text-[--color-fg] hover:bg-[--color-bg-elev-1]",
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span>{it.label}</span>
                  <span
                    className={cn(
                      "text-[11px] rounded-md px-1.5 py-0.5 font-semibold tabular-nums",
                      active
                        ? "bg-white text-[--color-accent] ring-1 ring-inset ring-[--color-accent]/30"
                        : "bg-[--color-bg-elev-2] text-[--color-fg-muted]",
                    )}
                  >
                    {fmtNum(count)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
