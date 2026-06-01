"use client";

/**
 * Card individual de hito faltante (Capa B · Procesos Quebrados).
 *
 * Brief §8 — estructura:
 *   · Nombre del hito faltante
 *   · N casos · % del período
 *   · Responsable
 *   · Monto asociado
 *   · Top sucursales / canales / responsables
 *   · Acción esperada
 *   · "Abrir cola →"
 */

import { fmtNum, fmtCLPCompact } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { CardQuebrada } from "@/lib/control-de-negocio/cn-quebrados";
import {
  COLOR_POR_AREA,
  LABEL_AREA,
} from "@/lib/control-de-negocio/cn-responsables";

export function ProcesoQuebradoCard({
  card,
  active,
  onClick,
}: {
  card: CardQuebrada;
  active: boolean;
  onClick: () => void;
}) {
  const colorArea = COLOR_POR_AREA[card.responsable.area];
  const labelArea = LABEL_AREA[card.responsable.area];

  return (
    <button
      onClick={onClick}
      className={cn(
        "surface top-strip bg-white px-4 py-3.5 text-left transition w-full min-w-0",
        "hover:shadow-md",
        active
          ? "ring-2 ring-[--color-accent] border-[--color-accent]"
          : "hover:border-[--color-warning]/40",
      )}
      style={{ ["--strip-color" as string]: colorArea }}
    >
      {/* Header */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px] rounded-t-lg"
        style={{ backgroundColor: colorArea }}
      />
      <div className="text-[12px] font-semibold text-[--color-fg] tracking-tight">
        {card.label}
      </div>

      {/* Magnitud */}
      <div className="flex items-baseline gap-3 mt-2">
        <div className="text-[26px] font-bold tracking-tight text-[--color-fg] leading-none">
          {fmtNum(card.count)}
        </div>
        <div className="text-[11px] text-[--color-fg-muted]">casos</div>
        <div className="text-[11px] text-[--color-fg-dim]">
          {card.pctSobreUniverso.toFixed(1)}% cohorte
        </div>
      </div>
      <div className="text-[11.5px] text-[--color-danger] font-semibold mt-1">
        {fmtCLPCompact(card.monto)} <span className="font-normal text-[--color-fg-dim]">monto asociado</span>
      </div>

      {/* Responsable */}
      <div className="mt-2 pt-2 border-t border-[--color-border] flex items-center gap-1.5">
        <span
          className="inline-block size-2 rounded-full shrink-0"
          style={{ backgroundColor: colorArea }}
        />
        <span className="text-[10.5px] text-[--color-fg-muted]">
          Responsable: <b className="text-[--color-fg]">{labelArea}</b>
        </span>
      </div>

      {/* Tops */}
      <TopMini titulo="Top sucursales" items={card.topSucursales} />
      <TopMini titulo="Top responsables" items={card.topResponsables} />
      <TopMini titulo="Top canales" items={card.topCanales} />

      {/* Acción */}
      <div className="mt-2.5 rounded-md bg-[--color-bg-elev-1] px-2.5 py-1.5 text-[10.5px] leading-snug text-[--color-fg-muted]">
        <span className="font-semibold text-[--color-fg]">Acción: </span>
        {card.accion}
      </div>

      <div className="mt-2 text-right text-[11px] text-[--color-accent]">
        {active ? "Cola abierta abajo →" : "Abrir cola →"}
      </div>
    </button>
  );
}

function TopMini({
  titulo,
  items,
}: {
  titulo: string;
  items: { key: string; count: number; monto: number }[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.05em] text-[--color-fg-dim] mb-0.5">
        {titulo}
      </div>
      <ul className="space-y-0.5 text-[10.5px]">
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
