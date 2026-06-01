"use client";

/**
 * Resumen ejecutivo — 4 KPI cards de color sólido (estilo CRM moderno).
 *
 *  · Facturados      → accent (azul) — universo del mes
 *  · Entregados      → ok (verde)     — lo que ya cerró
 *  · Mediana tramo   → info (cyan)    — pulso operacional
 *  · Monto retenido  → danger (rojo)  — capital atrapado
 *
 * Color sólido + texto blanco. Alta legibilidad. Pensado para escaneo
 * ejecutivo de 1 vistazo, alineado con el módulo Centro de Acción.
 */

import { fmtNum, fmtCLPCompact } from "@/lib/format";
import { Receipt, CheckCircle2, Clock, Banknote } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export function ResumenEjecutivoProceso({
  proceso,
  mesLabel,
  facturados,
  entregados,
  pctEntregados,
  medianaTramoFinal,
  labelTramoFinal,
  montoRetenido,
  notaMonto,
}: {
  proceso: string;
  mesLabel: string;
  facturados: number;
  entregados: number;
  pctEntregados: number;
  medianaTramoFinal: number | null;
  labelTramoFinal: string;
  montoRetenido: number;
  notaMonto?: string;
}) {
  return (
    <div className="surface bg-white px-5 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[--color-fg-muted] mb-3">
        {proceso} · {mesLabel}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiSolido
          tone="accent"
          icon={Receipt}
          label="Facturados"
          value={fmtNum(facturados)}
          sub="universo del mes"
        />
        <KpiSolido
          tone="ok"
          icon={CheckCircle2}
          label="Entregados"
          value={fmtNum(entregados)}
          sub={facturados > 0 ? `${pctEntregados.toFixed(1)}% cerrados` : "—"}
        />
        <KpiSolido
          tone="info"
          icon={Clock}
          label="Mediana"
          value={medianaTramoFinal != null ? `${medianaTramoFinal.toFixed(1)}d` : "—"}
          sub={labelTramoFinal}
        />
        <KpiSolido
          tone="danger"
          icon={Banknote}
          label="Monto retenido"
          value={fmtCLPCompact(montoRetenido)}
          sub={notaMonto ?? "valor factura del universo"}
        />
      </div>
    </div>
  );
}

function KpiSolido({
  tone,
  icon: Icon,
  label,
  value,
  sub,
}: {
  tone: "accent" | "ok" | "info" | "danger";
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
}) {
  const bg =
    tone === "accent" ? "bg-[color:var(--color-accent)]"
    : tone === "ok" ? "bg-[color:var(--color-ok)]"
    : tone === "info" ? "bg-[color:var(--color-info)]"
    : "bg-[color:var(--color-danger)]";
  return (
    <div className={`${bg} text-white rounded-xl px-4 py-3.5 shadow-sm`}>
      <div className="flex items-center justify-between">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] opacity-85">
          {label}
        </div>
        <Icon className="size-4 opacity-80" strokeWidth={1.75} />
      </div>
      <div className="text-[28px] font-bold tracking-tight leading-none mt-2">
        {value}
      </div>
      <div className="text-[11px] opacity-85 mt-2 truncate" title={sub}>
        {sub}
      </div>
    </div>
  );
}
