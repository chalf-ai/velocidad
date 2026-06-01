"use client";

/**
 * Cierre y Cumplimiento sobre el universo filtrado por mes de factura.
 *
 * Distribución de calidad (correcto/inconsistente/huérfano/no_evaluable),
 * stat de monto retenido en casos con problema, top sucursales/responsables
 * con problema y cola gestionable de los casos problemáticos.
 *
 * Es la pantalla del proceso "cierre_y_cumplimiento" — NO tiene funnel
 * porque no aplica.
 */

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { fmtNum, fmtCLPCompact } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ColaGestionableHistorico } from "./ColaGestionableHistorico";
import type { CierreCumplStats, TopItem } from "@/lib/historico/vista-derivados";

export function CierreCumplimientoMes({
  stats,
  mesLabel,
}: {
  stats: CierreCumplStats;
  mesLabel: string;
}) {
  const [foco, setFoco] = useState<
    | { tipo: "sucursal"; key: string }
    | { tipo: "responsable"; key: string }
    | null
  >(null);

  const filasFoco =
    foco === null
      ? stats.filasProblema
      : foco.tipo === "sucursal"
      ? stats.filasProblema.filter((f) => (f.sucursal ?? "") === foco.key)
      : stats.filasProblema.filter((f) => (f.vendedor ?? "") === foco.key);

  const d = stats.distribucion;
  const totalEval = d.correcto + d.inconsistente + d.huerfano + d.no_evaluable;

  return (
    <div className="space-y-4">
      <div className="surface bg-white px-5 py-4 top-strip strip-info">
        <div className="flex items-baseline gap-2">
          <ShieldCheck className="size-4 text-[--color-info] translate-y-0.5" />
          <h2 className="text-[16px] font-semibold tracking-tight text-[--color-fg]">
            Cierre y Cumplimiento · {mesLabel}
          </h2>
        </div>
        <p className="text-[12.5px] text-[--color-fg-muted] mt-1">
          Calidad del cierre documental sobre los casos del mes seleccionado.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <BarraCalidad label="Correcto" n={d.correcto} total={totalEval} tone="ok" />
          <BarraCalidad label="Inconsistente" n={d.inconsistente} total={totalEval} tone="warning" />
          <BarraCalidad label="Huérfano" n={d.huerfano} total={totalEval} tone="danger" />
          <BarraCalidad label="No evaluable" n={d.no_evaluable} total={totalEval} tone="muted" />
        </div>

        <div className="grid grid-cols-2 gap-5 mt-5 pt-4 border-t border-[--color-border]">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[--color-fg-muted]">
              Casos con problema
            </div>
            <div className="text-[24px] font-bold tracking-tight text-[--color-danger] mt-1 leading-none">
              {fmtNum(stats.problemaCount)}
            </div>
            <div className="text-[11px] text-[--color-fg-dim] mt-1">
              inconsistente + huérfano
            </div>
          </div>
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[--color-fg-muted]">
              Monto en riesgo
            </div>
            <div className="text-[24px] font-bold tracking-tight text-[--color-danger] mt-1 leading-none">
              {fmtCLPCompact(stats.problemaMonto)}
            </div>
            <div className="text-[11px] text-[--color-fg-dim] mt-1">
              valor factura de los problemáticos
            </div>
          </div>
        </div>
      </div>

      {/* Top sucursales / responsables con problema */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TopProblema
          titulo="Top sucursales con problema"
          items={stats.topSucursalesProblema}
          activeKey={foco?.tipo === "sucursal" ? foco.key : null}
          onSelect={(k) =>
            setFoco(foco?.tipo === "sucursal" && foco.key === k ? null : { tipo: "sucursal", key: k })
          }
        />
        <TopProblema
          titulo="Top responsables con problema"
          items={stats.topResponsablesProblema}
          activeKey={foco?.tipo === "responsable" ? foco.key : null}
          onSelect={(k) =>
            setFoco(foco?.tipo === "responsable" && foco.key === k ? null : { tipo: "responsable", key: k })
          }
        />
      </div>

      {/* Cola */}
      <ColaGestionableHistorico
        titulo={
          foco === null
            ? `Casos con problema de cierre · ${fmtNum(stats.problemaCount)}`
            : `Cierre · ${foco.key} · ${fmtNum(filasFoco.length)}/${fmtNum(stats.problemaCount)}`
        }
        subtitulo={`Universo: facturados en ${mesLabel}`}
        filas={filasFoco}
        proceso="control_negocio"
        origen="/velocidad-operacional · cierre_y_cumplimiento"
      />
    </div>
  );
}

function BarraCalidad({
  label,
  n,
  total,
  tone,
}: {
  label: string;
  n: number;
  total: number;
  tone: "ok" | "warning" | "danger" | "muted";
}) {
  const pct = total > 0 ? (n / total) * 100 : 0;
  const c =
    tone === "ok" ? "bg-[--color-ok]"
    : tone === "warning" ? "bg-[--color-warning]"
    : tone === "danger" ? "bg-[--color-danger]"
    : "bg-[--color-fg-dim]";
  const tc =
    tone === "ok" ? "text-[--color-ok]"
    : tone === "warning" ? "text-[--color-warning]"
    : tone === "danger" ? "text-[--color-danger]"
    : "text-[--color-fg-muted]";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold text-[--color-fg-muted] uppercase tracking-[0.05em]">
          {label}
        </span>
        <span className={`text-[11px] font-semibold ${tc}`}>{pct.toFixed(1)}%</span>
      </div>
      <div className={`text-[20px] font-bold tracking-tight ${tc} leading-none mt-1`}>
        {fmtNum(n)}
      </div>
      <div className="h-1.5 rounded-full bg-[--color-bg-elev-1] mt-2 overflow-hidden">
        <div className={c} style={{ width: `${Math.min(100, pct)}%`, height: "100%" }} />
      </div>
    </div>
  );
}

function TopProblema({
  titulo,
  items,
  activeKey,
  onSelect,
}: {
  titulo: string;
  items: TopItem[];
  activeKey: string | null;
  onSelect: (k: string) => void;
}) {
  return (
    <div className="surface bg-white px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[--color-fg-muted] mb-2">
        {titulo}
      </div>
      {items.length === 0 ? (
        <div className="text-[12px] text-[--color-fg-dim]">Sin casos con problema.</div>
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
                <div className="text-[10.5px] text-[--color-fg-dim]">{fmtNum(t.count)} casos</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
