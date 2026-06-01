"use client";

/**
 * Selector de período (tabs). 5 modos:
 *   · Mes seleccionado · 3M · 6M · 12M · Todo
 *
 * Cuando modo ≠ "mes", el selector de mes funciona como mes de REFERENCIA
 * (fin del rango). En modo "todo", el selector de mes es informativo.
 */

import { CalendarRange } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  LABEL_MODO,
  type ModoPeriodo,
} from "@/lib/control-de-negocio/cn-periodo";

const ORDEN_MODOS: ModoPeriodo[] = ["mes", "3m", "6m", "12m", "todo"];

const LABEL_CORTO: Record<ModoPeriodo, string> = {
  mes: "Mes",
  "3m": "3M",
  "6m": "6M",
  "12m": "12M",
  todo: "Todo",
};

export function SelectorPeriodo({
  modo,
  onChange,
  labelPeriodoActivo,
}: {
  modo: ModoPeriodo;
  onChange: (m: ModoPeriodo) => void;
  /** "Mayo 2026" o "Mayo 2026 → Marzo 2026 · 3 meses". */
  labelPeriodoActivo: string;
}) {
  return (
    <div className="surface bg-white px-5 py-3 flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2.5 shrink-0">
        <CalendarRange
          className="size-4 text-[--color-accent]"
          strokeWidth={1.75}
        />
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[--color-fg-muted]">
            Período
          </div>
          <div className="text-[10.5px] text-[--color-fg-dim] mt-0.5">
            {LABEL_MODO[modo]}
          </div>
        </div>
      </div>

      <div className="inline-flex rounded-md border border-[--color-border] overflow-hidden text-[12px]">
        {ORDEN_MODOS.map((m) => (
          <button
            key={m}
            onClick={() => onChange(m)}
            className={cn(
              "px-3 py-1.5 transition border-r border-[--color-border] last:border-r-0",
              modo === m
                ? "bg-[--color-accent]/[0.08] text-[--color-accent] font-semibold"
                : "bg-white text-[--color-fg-muted] hover:text-[--color-fg]",
            )}
          >
            {LABEL_CORTO[m]}
          </button>
        ))}
      </div>

      <div className="ml-auto text-[11.5px] text-[--color-fg-muted]">
        Universo activo: <b className="text-[--color-fg]">{labelPeriodoActivo}</b>
      </div>
    </div>
  );
}
