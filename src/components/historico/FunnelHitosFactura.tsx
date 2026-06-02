"use client";

/**
 * Funnel chevron horizontal — estilo pipeline CRM moderno.
 *
 *   ┌─────────▶┌─────────▶┌─────────▶┌─────────▶┌─────────┐
 *   │ Etapa 1  │ Etapa 2  │ Etapa 3  │ Etapa 4  │ Terminal│
 *   └─────────▶└─────────▶└─────────▶└─────────▶└─────────┘
 *               ┌──tramo──┐┌──tramo──┐┌──tramo──┐┌──tramo──┐
 *               │  3.2d   ││  5.1d   ││ 12.4d   ││  4.0d   │
 *               │  CN     ││  CN     ││  RC     ││ Vendedor│
 *               └─────────┘└─────────┘└─────────┘└─────────┘
 *
 * Cada CHEVRON: cobertura del hito sobre el universo del mes. Fondo color
 * sólido (verde/amarillo/rojo según %), número grande, % + monto. Click →
 * cola del foco. Cada CHIP debajo de la etapa destino: mediana del tramo,
 * responsable operativo, count de pares. Click expande mini-ficha con
 * top sucursales/responsables más lentos.
 *
 * Faltantes accesibles via chips secundarios debajo (uno por etapa con
 * faltantes), foco rojo. Toda interacción opera sobre el mismo `foco`
 * controlado desde la página.
 */

import { ChevronDown, ChevronRight } from "lucide-react";
import { fmtNum, fmtCLPCompact } from "@/lib/format";
import { cn } from "@/lib/cn";
import type {
  EtapaFunnel,
  TramoFunnel,
  Semaforo,
  TopItem,
} from "@/lib/historico/vista-derivados";

export type FocoFunnelFactura =
  | { tipo: "etapa_cumple"; etapaId: string }
  | { tipo: "etapa_faltante"; etapaId: string }
  | { tipo: "tramo_lentos"; tramoId: string };

// Fondo sólido + texto blanco para el chevron.
// IMPORTANTE: usar bg-[color:var(--color-ok)] (con nombre de token real).
// La forma bg-[--color-X] NO resuelve la custom property; queda transparente
// y el texto blanco se vuelve invisible.
const SEM_FILL: Record<Semaforo, string> = {
  verde:    "bg-[color:var(--color-ok)]",
  amarillo: "bg-[color:var(--color-warning)]",
  rojo:     "bg-[color:var(--color-danger)]",
};

// Fondo soft + texto color para los chips de tramo (sí pueden usar /N, esa
// sintaxis con opacity modifier sí entiende la var de Tailwind).
const SEM_SOFT_BG: Record<Semaforo, string> = {
  verde:    "bg-[--color-ok]/10 border-[--color-ok]/30",
  amarillo: "bg-[--color-warning]/10 border-[--color-warning]/30",
  rojo:     "bg-[--color-danger]/10 border-[--color-danger]/30",
};
const SEM_TXT: Record<Semaforo, string> = {
  verde:    "text-[--color-ok]",
  amarillo: "text-[--color-warning]",
  rojo:     "text-[--color-danger]",
};

export function FunnelHitosFactura({
  etapas,
  tramos,
  foco,
  onFoco,
}: {
  etapas: EtapaFunnel[];
  tramos: TramoFunnel[];
  foco: FocoFunnelFactura | null;
  onFoco: (f: FocoFunnelFactura | null) => void;
}) {
  const tramoActivo =
    foco?.tipo === "tramo_lentos" ? tramos.find((t) => t.id === foco.tramoId) : null;

  return (
    <div className="surface bg-white px-5 py-5">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[--color-fg-muted]">
          Funnel del mes
        </div>
        <div className="text-[10.5px] text-[--color-fg-dim]">
          Cobertura por hito · click en chevron / chip para abrir cola
        </div>
      </div>

      {/* Pipeline chevron + fila de chips alineados a la etapa destino del tramo */}
      <div
        className="grid gap-y-3 gap-x-1.5 overflow-x-auto pb-1"
        style={{ gridTemplateColumns: `repeat(${etapas.length}, minmax(140px, 1fr))` }}
      >
        {/* Fila 1 — chevrons */}
        {etapas.map((e, idx) => (
          <ChevronEtapa
            key={e.id}
            etapa={e}
            posicion={
              etapas.length === 1
                ? "single"
                : idx === 0
                ? "first"
                : idx === etapas.length - 1
                ? "last"
                : "mid"
            }
            activo={foco?.tipo === "etapa_cumple" && foco.etapaId === e.id}
            onClick={() =>
              onFoco(
                foco?.tipo === "etapa_cumple" && foco.etapaId === e.id
                  ? null
                  : { tipo: "etapa_cumple", etapaId: e.id },
              )
            }
          />
        ))}
        {/* Fila 2 — chips de tramo (primer celda vacía; chip i va debajo de etapa i+1) */}
        <div />
        {tramos.map((t) => (
          <ChipTramo
            key={t.id}
            tramo={t}
            activo={foco?.tipo === "tramo_lentos" && foco.tramoId === t.id}
            onClick={() =>
              onFoco(
                foco?.tipo === "tramo_lentos" && foco.tramoId === t.id
                  ? null
                  : { tipo: "tramo_lentos", tramoId: t.id },
              )
            }
          />
        ))}
      </div>

      {/* Mini-ficha del tramo focado */}
      {tramoActivo && <MiniFichaTramo tramo={tramoActivo} />}

      {/* Chips de faltantes (acceso directo a "sin X") */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[--color-fg-muted] mr-1">
          Faltantes:
        </span>
        {etapas
          .filter((e) => !e.esTerminal && e.faltantes > 0)
          .map((e) => {
            const active = foco?.tipo === "etapa_faltante" && foco.etapaId === e.id;
            return (
              <button
                key={`falt-${e.id}`}
                onClick={() =>
                  onFoco(active ? null : { tipo: "etapa_faltante", etapaId: e.id })
                }
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[10.5px] transition",
                  active
                    ? "border-[--color-danger] bg-[--color-danger]/10 text-[--color-danger] font-semibold"
                    : "border-[--color-border] text-[--color-fg-muted] hover:text-[--color-danger] hover:border-[--color-danger]/40",
                )}
              >
                Sin {e.label.toLowerCase()} · {fmtNum(e.faltantes)}
              </button>
            );
          })}
        {etapas.every((e) => e.esTerminal || e.faltantes === 0) && (
          <span className="text-[11px] text-[--color-fg-dim]">
            No hay faltantes en el universo del mes.
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chevron de etapa
// ─────────────────────────────────────────────────────────────────────────────

function ChevronEtapa({
  etapa,
  posicion,
  activo,
  onClick,
}: {
  etapa: EtapaFunnel;
  posicion: "first" | "mid" | "last" | "single";
  activo: boolean;
  onClick: () => void;
}) {
  // Semáforo por cobertura ≥85 verde, ≥60 amarillo, <60 rojo.
  const sem: Semaforo =
    etapa.pct >= 85 ? "verde" : etapa.pct >= 60 ? "amarillo" : "rojo";
  const TAIL = 14;
  const clip =
    posicion === "first"
      ? `polygon(0 0, calc(100% - ${TAIL}px) 0, 100% 50%, calc(100% - ${TAIL}px) 100%, 0 100%)`
      : posicion === "last"
      ? `polygon(${TAIL}px 0, 100% 0, 100% 100%, ${TAIL}px 100%, 0 50%)`
      : posicion === "single"
      ? `polygon(0 0, 100% 0, 100% 100%, 0 100%)`
      : `polygon(${TAIL}px 0, calc(100% - ${TAIL}px) 0, 100% 50%, calc(100% - ${TAIL}px) 100%, ${TAIL}px 100%, 0 50%)`;
  const extraPad =
    posicion === "first"
      ? "pl-4 pr-6"
      : posicion === "last"
      ? "pl-6 pr-4"
      : posicion === "single"
      ? "px-4"
      : "pl-6 pr-6";
  return (
    <button
      onClick={onClick}
      style={{ clipPath: clip }}
      className={cn(
        "block py-3 text-left text-white transition relative",
        SEM_FILL[sem],
        extraPad,
        "hover:brightness-110",
        activo && "brightness-110 ring-2 ring-[--color-accent] outline outline-2 outline-[--color-accent]",
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.05em] opacity-90 truncate">
        {etapa.label}
      </div>
      <div className="text-[22px] font-bold tracking-tight mt-1 leading-none">
        {fmtNum(etapa.count)}
      </div>
      <div className="text-[10.5px] opacity-90 mt-1 flex items-center gap-2 truncate">
        <span className="font-semibold">{etapa.pct.toFixed(1)}%</span>
        <span className="opacity-70">·</span>
        <span className="truncate">{fmtCLPCompact(etapa.monto)}</span>
      </div>
      <div className="text-[9.5px] opacity-75 mt-1 truncate">{etapa.owner}</div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chip de tramo
// ─────────────────────────────────────────────────────────────────────────────

function ChipTramo({
  tramo,
  activo,
  onClick,
}: {
  tramo: TramoFunnel;
  activo: boolean;
  onClick: () => void;
}) {
  const Icon = activo ? ChevronDown : ChevronRight;
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md border px-2.5 py-2 text-left text-[11px] transition",
        SEM_SOFT_BG[tramo.semaforo],
        activo && "ring-2 ring-[--color-accent]",
      )}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className={cn("font-bold text-[14px]", SEM_TXT[tramo.semaforo])}>
          {tramo.mediana != null ? `${tramo.mediana.toFixed(1)}d` : "—"}
        </span>
        <Icon className="size-3 text-[--color-fg-dim] shrink-0" />
      </div>
      <div className="text-[10px] text-[--color-fg-muted] truncate" title={tramo.owner}>
        {tramo.owner}
      </div>
      <div className="text-[10px] text-[--color-fg-dim]">{fmtNum(tramo.n)} pares</div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mini-ficha de tramo
// ─────────────────────────────────────────────────────────────────────────────

function MiniFichaTramo({ tramo }: { tramo: TramoFunnel }) {
  return (
    <div className="mt-3 rounded-md border border-[--color-border] bg-[--color-bg-elev-1] p-3 grid md:grid-cols-3 gap-4 text-[11px]">
      <div>
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[--color-fg-muted] mb-1">
          {tramo.label}
        </div>
        <div className="text-[--color-fg-muted]">
          Mediana <b className="text-[--color-fg]">{tramo.mediana?.toFixed(1) ?? "—"}d</b>
          {" · "}p90 <b className="text-[--color-fg]">{tramo.p90?.toFixed(1) ?? "—"}d</b>
          {" · "}prom <b className="text-[--color-fg]">{tramo.promedio?.toFixed(1) ?? "—"}d</b>
        </div>
        <div className="text-[--color-fg-dim] mt-1">
          {fmtNum(tramo.lentosCount)} casos &gt; p75 del tramo
        </div>
        <div className="text-[--color-fg-dim] mt-1">
          Responsable operativo: <span className="text-[--color-fg-muted]">{tramo.owner}</span>
        </div>
      </div>
      <TopMini titulo="Top sucursales más lentas" items={tramo.topSucursalesLentas} />
      <TopMini titulo="Top responsables más lentos" items={tramo.topResponsablesLentos} />
    </div>
  );
}

function TopMini({ titulo, items }: { titulo: string; items: TopItem[] }) {
  if (items.length === 0) {
    return (
      <div>
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[--color-fg-muted] mb-1">
          {titulo}
        </div>
        <div className="text-[--color-fg-dim]">—</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[--color-fg-muted] mb-1">
        {titulo}
      </div>
      <ul className="space-y-0.5">
        {items.map((t) => (
          <li key={t.key} className="flex items-center justify-between gap-2">
            <span className="truncate text-[--color-fg]">{t.key}</span>
            <span className="text-[--color-fg-dim] shrink-0 text-[10.5px]">
              {fmtNum(t.count)} · {fmtCLPCompact(t.monto)}
              {t.medianaDias != null && ` · ${t.medianaDias.toFixed(1)}d`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
