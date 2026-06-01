"use client";

import { CalendarDays } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import type { PeriodoTemporal } from "@/lib/historico/vista-derivados";

interface Props {
  activo: PeriodoTemporal;
  onChange: (p: PeriodoTemporal) => void;
  /** Counts por periodo — el caller pre-calcula sobre el universo cerrado. */
  counts: Record<PeriodoTemporal, number>;
  /** Etiqueta corta del campo de referencia (ej. "fEntregaReal"). */
  referencia: string;
}

interface ItemDef {
  id: PeriodoTemporal;
  label: string;
  short?: string;
}

const PRIMARIA: ItemDef[] = [
  { id: "global",      label: "Global" },
  { id: "dias_1_10",   label: "Días 1–10" },
  { id: "dias_11_20",  label: "Días 11–20" },
  { id: "dias_21_fin", label: "Días 21–fin" },
];

const SECUNDARIA: ItemDef[] = [
  { id: "sem_1", label: "Semana 1", short: "Sem 1" },
  { id: "sem_2", label: "Semana 2", short: "Sem 2" },
  { id: "sem_3", label: "Semana 3", short: "Sem 3" },
  { id: "sem_4", label: "Semana 4", short: "Sem 4" },
];

/**
 * Pestañas de filtro temporal. Solo aplica al modo histórico cerrado.
 * Bucketiza por día del mes de la fecha-fin del proceso.
 *
 * Dos filas: la primera con tercios del mes, la segunda con semanas.
 * Ambas comparten el state `activo` — seleccionar uno desactiva el otro.
 */
export function FiltroTemporalTabs({ activo, onChange, counts, referencia }: Props) {
  return (
    <Card>
      <CardBody className="py-2.5 px-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <CalendarDays className="size-3.5 text-[--color-fg-muted]" />
          <span className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium">
            Filtro temporal
          </span>
          <span className="text-[11px] text-[--color-fg-muted]">
            · referencia: día del mes de {referencia}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {PRIMARIA.map((it) => (
            <Tab key={it.id} activo={activo === it.id} count={counts[it.id]} onClick={() => onChange(it.id)}>
              {it.label}
            </Tab>
          ))}
          <span className="mx-1 text-[--color-fg-dim]">·</span>
          {SECUNDARIA.map((it) => (
            <Tab key={it.id} activo={activo === it.id} count={counts[it.id]} onClick={() => onChange(it.id)}>
              {it.short ?? it.label}
            </Tab>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function Tab({
  activo,
  count,
  onClick,
  children,
}: {
  activo: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-semibold transition ring-1 ring-inset",
        activo
          ? "bg-[--color-accent-dim] text-[--color-accent] ring-[--color-accent]"
          : "ring-transparent text-[--color-fg-muted] hover:text-[--color-fg] hover:bg-[--color-bg-elev-1]",
      )}
    >
      <span>{children}</span>
      <span
        className={cn(
          "text-[10.5px] rounded px-1 tabular-nums",
          activo ? "bg-white text-[--color-accent] ring-1 ring-inset ring-[--color-accent]/30" : "bg-[--color-bg-elev-2] text-[--color-fg-muted]",
        )}
      >
        {fmtNum(count)}
      </span>
    </button>
  );
}
