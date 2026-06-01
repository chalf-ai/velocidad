"use client";

/**
 * Sección "Faltantes del proceso" — cards apilables por hito faltante,
 * cada una con top sucursales / responsables + monto retenido + responsable
 * operativo. Click en card abre la cola gestionable de esos VIN.
 */

import { fmtNum, fmtCLPCompact } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { FaltanteHito, TopItem } from "@/lib/historico/vista-derivados";

export function FaltantesProcesoSection({
  faltantes,
  activeId,
  onSelect,
}: {
  faltantes: FaltanteHito[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const conCasos = faltantes.filter((f) => f.count > 0);
  if (conCasos.length === 0) {
    return (
      <div className="surface bg-white px-5 py-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[--color-fg-muted]">
          Faltantes del proceso
        </div>
        <div className="text-[12.5px] text-[--color-fg-muted] mt-2">
          Todos los hitos del proceso están registrados en el universo del mes.
        </div>
      </div>
    );
  }
  return (
    <div className="surface bg-white px-5 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[--color-fg-muted] mb-3">
        Faltantes del proceso
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {conCasos.map((f) => (
          <CardFaltante
            key={f.id}
            f={f}
            active={activeId === f.id}
            onClick={() => onSelect(activeId === f.id ? null : f.id)}
          />
        ))}
      </div>
    </div>
  );
}

function CardFaltante({
  f,
  active,
  onClick,
}: {
  f: FaltanteHito;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "surface top-strip strip-warning bg-white px-4 py-3 text-left transition",
        active
          ? "ring-2 ring-[--color-accent]/30 border-[--color-accent]"
          : "hover:border-[--color-warning]/50",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[12px] font-semibold text-[--color-fg] capitalize">
          {f.label}
        </div>
        <div className="text-[10.5px] text-[--color-fg-dim] shrink-0">
          {f.pct.toFixed(1)}% del mes
        </div>
      </div>
      <div className="flex items-baseline gap-3 mt-1">
        <div className="text-[24px] font-bold tracking-tight text-[--color-fg]">
          {fmtNum(f.count)}
        </div>
        <div className="text-[12px] text-[--color-fg-muted]">casos</div>
        <div className="text-[12px] text-[--color-danger] font-semibold">
          {fmtCLPCompact(f.monto)}
        </div>
        <div className="text-[10.5px] text-[--color-fg-dim]">retenidos</div>
      </div>
      <div className="text-[10.5px] text-[--color-fg-dim] mt-1">
        Responsable operativo: <span className="text-[--color-fg-muted]">{f.owner}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 text-[11px]">
        <MiniTop titulo="Top sucursales" items={f.topSucursales} />
        <MiniTop titulo="Top responsables" items={f.topResponsables} />
      </div>
      <div className="text-right text-[11px] text-[--color-accent] mt-2">
        {active ? "Cola abierta abajo →" : "Click para abrir cola gestionable"}
      </div>
    </button>
  );
}

function MiniTop({ titulo, items }: { titulo: string; items: TopItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[--color-fg-muted] mb-1">
        {titulo}
      </div>
      <ul className="space-y-0.5">
        {items.slice(0, 3).map((t) => (
          <li key={t.key} className="flex items-center justify-between gap-2">
            <span className="truncate text-[--color-fg]">{t.key}</span>
            <span className="text-[--color-fg-dim] shrink-0">
              {fmtNum(t.count)} · {fmtCLPCompact(t.monto)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
