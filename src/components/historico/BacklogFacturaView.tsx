"use client";

/**
 * Vista BACKLOG ABIERTO — caja atrapada por facturas sin entregar.
 *
 * Toggle:
 *  · Este mes  → solo facturados en el mes seleccionado que siguen abiertos.
 *  · Acumulado → todos los facturados sin entregar (sin filtro de mes) =
 *    caja atrapada real hoy. Default acumulado (no esconder casos viejos).
 *
 * Tres bloques de ranking + cola gestionable al pie:
 *   · Por sucursal (monto desc + count + aging medio)
 *   · Por responsable (vendedor)
 *   · Por cuello dominante (último hito documental pendiente)
 *
 * Click en cualquier fila de ranking filtra la cola de abajo.
 */

import { useMemo, useState } from "react";
import { Banknote, MapPin, User, AlertCircle } from "lucide-react";
import { fmtNum, fmtCLPCompact } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ColaGestionableHistorico } from "./ColaGestionableHistorico";
import type {
  BacklogStats,
  ModoBacklog,
  AgrupadoBacklog,
  ProcesoOperacional,
} from "@/lib/historico/vista-derivados";
import type { EntradaConsolidada } from "@/lib/historico/cruce-roma-actas";

export function BacklogFacturaView({
  stats,
  modo,
  onModoChange,
  mesLabel,
  proceso,
}: {
  stats: BacklogStats;
  modo: ModoBacklog;
  onModoChange: (m: ModoBacklog) => void;
  mesLabel: string;
  proceso: ProcesoOperacional;
}) {
  const [foco, setFoco] = useState<
    | { tipo: "sucursal"; key: string }
    | { tipo: "responsable"; key: string }
    | { tipo: "cuello"; id: string }
    | null
  >(null);

  const filasFoco = useMemo<EntradaConsolidada[]>(() => {
    if (!foco) return stats.filas;
    if (foco.tipo === "sucursal") return stats.filas.filter((f) => (f.sucursal ?? "") === foco.key);
    if (foco.tipo === "responsable") return stats.filas.filter((f) => (f.vendedor ?? "") === foco.key);
    // cuello: replicar la lógica del selector — primer hito CN faltante
    if (foco.tipo === "cuello") {
      return stats.filas.filter((f) => cuelloDominanteId(f) === foco.id);
    }
    return stats.filas;
  }, [foco, stats.filas]);

  return (
    <div className="space-y-4">
      {/* Cabecera + toggle */}
      <div className="surface bg-white px-5 py-4 top-strip strip-danger">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-[16px] font-semibold tracking-tight text-[--color-fg] flex items-center gap-2">
              <Banknote className="size-4 text-[--color-danger]" /> Backlog abierto
            </h2>
            <p className="text-[12.5px] text-[--color-fg-muted] mt-0.5">
              Facturas sin entregar — caja retenida hoy.
              {modo === "este_mes"
                ? ` Filtrado a ${mesLabel}.`
                : " Acumulado (todos los meses)."}
            </p>
          </div>
          <div className="inline-flex rounded-md border border-[--color-border] overflow-hidden text-[12px]">
            <ToggleBtn activo={modo === "acumulado"} onClick={() => onModoChange("acumulado")}>
              Acumulado
            </ToggleBtn>
            <ToggleBtn activo={modo === "este_mes"} onClick={() => onModoChange("este_mes")}>
              Este mes
            </ToggleBtn>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-5 mt-4">
          <Kpi label="Casos abiertos" value={fmtNum(stats.count)} tone="fg" />
          <Kpi label="Capital retenido" value={fmtCLPCompact(stats.monto)} tone="danger" />
          <Kpi
            label="Aging mediano"
            value={stats.medianaAging != null ? `${stats.medianaAging.toFixed(0)}d` : "—"}
            tone="warning"
          />
        </div>
      </div>

      {/* Tres bloques de ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <RankingPanel
          titulo="Por sucursal"
          icon={<MapPin className="size-3.5" />}
          items={stats.porSucursal}
          activeKey={foco?.tipo === "sucursal" ? foco.key : null}
          onSelect={(k) => setFoco(foco?.tipo === "sucursal" && foco.key === k ? null : { tipo: "sucursal", key: k })}
        />
        <RankingPanel
          titulo="Por responsable"
          icon={<User className="size-3.5" />}
          items={stats.porResponsable}
          activeKey={foco?.tipo === "responsable" ? foco.key : null}
          onSelect={(k) => setFoco(foco?.tipo === "responsable" && foco.key === k ? null : { tipo: "responsable", key: k })}
        />
        <RankingCuello
          items={stats.porCuello}
          activeId={foco?.tipo === "cuello" ? foco.id : null}
          onSelect={(id) => setFoco(foco?.tipo === "cuello" && foco.id === id ? null : { tipo: "cuello", id })}
        />
      </div>

      {/* Cola gestionable del foco actual (o total si sin foco) */}
      <ColaGestionableHistorico
        titulo={tituloCola(foco, filasFoco.length, stats.count)}
        subtitulo={subtituloCola(modo, mesLabel)}
        filas={filasFoco}
        proceso={proceso}
        origen={`/velocidad-operacional · backlog · ${modo}`}
      />
    </div>
  );
}

function tituloCola(
  foco: { tipo: string; key?: string; id?: string } | null,
  n: number,
  total: number,
): string {
  if (!foco) return `Cola del backlog · ${n} casos`;
  if (foco.tipo === "sucursal") return `Backlog · ${foco.key} · ${n}/${total}`;
  if (foco.tipo === "responsable") return `Backlog · ${foco.key} · ${n}/${total}`;
  return `Backlog · cuello dominante · ${n}/${total}`;
}

function subtituloCola(modo: ModoBacklog, mesLabel: string): string {
  return modo === "este_mes"
    ? `Filtrado por mes de factura: ${mesLabel}`
    : "Acumulado · todos los meses con factura abierta";
}

function ToggleBtn({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 transition",
        activo
          ? "bg-[--color-accent]/[0.08] text-[--color-accent] font-semibold"
          : "bg-white text-[--color-fg-muted] hover:text-[--color-fg]",
      )}
    >
      {children}
    </button>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "fg" | "danger" | "warning";
}) {
  const c =
    tone === "danger" ? "text-[--color-danger]"
    : tone === "warning" ? "text-[--color-warning]"
    : "text-[--color-fg]";
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[--color-fg-muted]">
        {label}
      </div>
      <div className={`text-[24px] font-bold tracking-tight ${c} mt-1 leading-none`}>{value}</div>
    </div>
  );
}

function RankingPanel({
  titulo,
  icon,
  items,
  activeKey,
  onSelect,
}: {
  titulo: string;
  icon: React.ReactNode;
  items: AgrupadoBacklog[];
  activeKey: string | null;
  onSelect: (k: string) => void;
}) {
  return (
    <div className="surface bg-white px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[--color-fg-muted]">{icon}</span>
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[--color-fg-muted]">
          {titulo}
        </div>
      </div>
      {items.length === 0 ? (
        <div className="text-[12px] text-[--color-fg-dim]">Sin datos.</div>
      ) : (
        <ul className="space-y-1">
          {items.map((t) => (
            <li key={t.key}>
              <button
                onClick={() => onSelect(t.key)}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left transition border",
                  activeKey === t.key
                    ? "border-[--color-accent] bg-[--color-accent]/[0.08]"
                    : "border-transparent hover:bg-[--color-bg-elev-1]",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12.5px] text-[--color-fg] truncate">{t.key}</span>
                  <span className="text-[11px] text-[--color-danger] font-semibold shrink-0">
                    {fmtCLPCompact(t.monto)}
                  </span>
                </div>
                <div className="text-[10.5px] text-[--color-fg-dim] flex justify-between">
                  <span>{fmtNum(t.count)} casos</span>
                  <span>aging {t.agingMedio != null ? `${t.agingMedio.toFixed(0)}d` : "—"}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RankingCuello({
  items,
  activeId,
  onSelect,
}: {
  items: { id: string; label: string; count: number; monto: number }[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="surface bg-white px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[--color-fg-muted]">
          <AlertCircle className="size-3.5" />
        </span>
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[--color-fg-muted]">
          Por cuello dominante
        </div>
      </div>
      {items.length === 0 ? (
        <div className="text-[12px] text-[--color-fg-dim]">Sin datos.</div>
      ) : (
        <ul className="space-y-1">
          {items.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => onSelect(t.id)}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left transition border",
                  activeId === t.id
                    ? "border-[--color-accent] bg-[--color-accent]/[0.08]"
                    : "border-transparent hover:bg-[--color-bg-elev-1]",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12.5px] text-[--color-fg] capitalize truncate">{t.label}</span>
                  <span className="text-[11px] text-[--color-danger] font-semibold shrink-0">
                    {fmtCLPCompact(t.monto)}
                  </span>
                </div>
                <div className="text-[10.5px] text-[--color-fg-dim]">{fmtNum(t.count)} casos</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Helper para identificar el cuello dominante (debe replicar la lógica del
// selector `cuelloDominante` en vista-derivados — orden de etapas CN no-terminal).
import { ETAPAS_POR_PROCESO } from "@/lib/historico/vista-derivados";
function cuelloDominanteId(f: EntradaConsolidada): string {
  for (const e of ETAPAS_POR_PROCESO.control_negocio) {
    if (e.esTerminal) continue;
    const v = f[e.campo];
    if (!(v instanceof Date)) return e.id;
  }
  return "listo_pendiente_entrega";
}
