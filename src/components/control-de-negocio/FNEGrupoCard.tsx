"use client";

/**
 * Card individual de un grupo FNE (Capa C). Brief §9.
 */

import { fmtNum, fmtCLPCompact } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { GrupoFNE } from "@/lib/control-de-negocio/cn-fne-atribuible";
import {
  COLOR_POR_AREA,
  LABEL_AREA,
} from "@/lib/control-de-negocio/cn-responsables";

export function FNEGrupoCard({
  grupo,
  active,
  onClick,
}: {
  grupo: GrupoFNE;
  active: boolean;
  onClick: () => void;
}) {
  const colorArea = COLOR_POR_AREA[grupo.responsable.area];
  const labelArea = LABEL_AREA[grupo.responsable.area];
  const labelShow = grupo.labelAlt ?? grupo.label;

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative surface bg-white px-4 py-3.5 text-left transition w-full min-w-0",
        "hover:shadow-md",
        active
          ? "ring-2 ring-[--color-accent] border-[--color-accent]"
          : "hover:border-[--color-danger]/40",
      )}
    >
      <div
        className="absolute top-0 left-0 right-0 h-[3px] rounded-t-lg"
        style={{ backgroundColor: colorArea }}
      />
      <div className="text-[12px] font-semibold text-[--color-fg] tracking-tight">
        {labelShow}
      </div>

      <div className="flex items-baseline gap-3 mt-2">
        <div className="text-[26px] font-bold tracking-tight text-[--color-fg] leading-none">
          {fmtNum(grupo.count)}
        </div>
        <div className="text-[11px] text-[--color-fg-muted]">vehículos</div>
      </div>
      <div className="text-[11.5px] text-[--color-danger] font-semibold mt-1">
        {fmtCLPCompact(grupo.monto)} <span className="font-normal text-[--color-fg-dim]">retenidos</span>
      </div>

      {/* Aging */}
      <div className="mt-2 grid grid-cols-2 gap-2 text-[10.5px]">
        <div>
          <div className="text-[--color-fg-dim] uppercase tracking-[0.05em] text-[9.5px]">
            Aging factura
          </div>
          <div className="text-[--color-fg-muted]">
            med <b className="text-[--color-fg]">
              {grupo.agingFacturaMediana != null
                ? `${grupo.agingFacturaMediana.toFixed(0)}d`
                : "—"}
            </b>{" · "}
            p90 <b className="text-[--color-fg]">
              {grupo.agingFacturaP90 != null
                ? `${grupo.agingFacturaP90.toFixed(0)}d`
                : "—"}
            </b>
          </div>
        </div>
        <div>
          <div className="text-[--color-fg-dim] uppercase tracking-[0.05em] text-[9.5px]">
            Aging último hito
          </div>
          <div className="text-[--color-fg-muted]">
            med <b className="text-[--color-fg]">
              {grupo.agingUltimoHitoMediana != null
                ? `${grupo.agingUltimoHitoMediana.toFixed(0)}d`
                : "—"}
            </b>
          </div>
        </div>
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

      {/* Top sucursales y responsables */}
      <TopMini titulo="Top sucursales" items={grupo.topSucursales} />
      <TopMini titulo="Top responsables" items={grupo.topResponsables} />

      {/* Acción */}
      <div className="mt-2.5 rounded-md bg-[--color-bg-elev-1] px-2.5 py-1.5 text-[10.5px] leading-snug text-[--color-fg-muted]">
        <span className="font-semibold text-[--color-fg]">Acción: </span>
        {grupo.accion}
      </div>

      {/* Leyenda especial (entrega_real) */}
      {grupo.leyenda && (
        <div className="mt-2 text-[10px] text-[--color-warning] italic leading-snug">
          ⓘ {grupo.leyenda}
        </div>
      )}

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
