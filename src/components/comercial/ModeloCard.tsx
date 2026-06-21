import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Minus, TrendingUp, Coins, FileSignature, Car } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import type { ModeloComercial } from "@/lib/comercial/queries";
import { evaluarModelo, tendenciaTexto, SITUACION_META } from "@/lib/comercial/logica";

function Metric({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
  tone?: "danger" | "success" | "accent";
}) {
  const toneCls =
    tone === "danger" ? "text-[--color-danger]" : tone === "success" ? "text-[--color-success]" : tone === "accent" ? "text-[--color-accent]" : "text-[--color-fg]";
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[9.5px] uppercase tracking-[0.05em] text-[--color-fg-dim]">
        {icon}
        {label}
      </div>
      <div className={cn("text-[17px] font-bold leading-none mt-1 mono", toneCls)}>{value}</div>
      {sub && <div className="text-[10px] text-[--color-fg-muted] mt-0.5">{sub}</div>}
    </div>
  );
}

export function ModeloCard({ m }: { m: ModeloComercial }) {
  const ev = evaluarModelo(m);
  const meta = SITUACION_META[ev.situacion];
  const d = m.demanda;
  const TrendIcon = d.tendencia === "creciente" ? ArrowUpRight : d.tendencia === "cayendo" ? ArrowDownRight : Minus;
  const trendTone = d.tendencia === "creciente" ? "success" : d.tendencia === "cayendo" ? "danger" : undefined;

  return (
    <Link
      href={`/velocity-comercial/modelo/${m.modelo.toLowerCase()}`}
      className="relative surface bg-white px-4 py-4 text-left transition w-full min-w-0 block hover:shadow-md hover:border-[--color-accent]/40"
    >
      <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl" style={{ backgroundColor: meta.color }} />

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[16px] font-bold tracking-tight text-[--color-fg]">{m.modelo}</div>
          <div className={cn("inline-flex items-center mt-1 px-2 py-0.5 rounded-md text-[10px] font-semibold", meta.chip)}>
            {meta.label}
          </div>
        </div>
        <span className="text-[11px] text-[--color-accent] shrink-0 mt-1">Abrir ficha →</span>
      </div>

      {/* Motivo */}
      {ev.motivo && <div className="text-[11.5px] text-[--color-fg-muted] mt-2 leading-snug">{ev.motivo}</div>}

      {/* Métricas */}
      <div className="grid grid-cols-3 gap-x-3 gap-y-3 mt-3 pt-3 border-t border-[--color-border]">
        <Metric
          label="Stock"
          value={fmtNum(m.stock.disponibles)}
          sub={m.stock.sobre90 ? `${m.stock.sobre90} sobre 90d` : "sano"}
          tone={m.stock.disponibles > 0 && m.stock.disponibles <= 10 ? "danger" : undefined}
        />
        <Metric label="Demanda 30d" value={fmtNum(d.cot30)} sub={tendenciaTexto(m).replace("demanda ", "")} icon={<TrendIcon className={cn("size-3", trendTone === "success" ? "text-[--color-success]" : trendTone === "danger" ? "text-[--color-danger]" : "text-[--color-fg-dim]")} />} />
        <Metric label="Vigentes 90d" value={fmtNum(m.vigentes.total90d)} icon={<TrendingUp className="size-3 text-[--color-fg-dim]" />} />
        <Metric label="VPP activa" value={fmtNum(m.vigentes.vppActiva)} sub="señal #1" icon={<Car className="size-3 text-[--color-fg-dim]" />} tone={m.vigentes.vppActiva > 0 ? "success" : undefined} />
        <Metric label="Sin firmar" value={fmtNum(m.vigentes.creditoSinFirmar)} icon={<FileSignature className="size-3 text-[--color-fg-dim]" />} tone={m.vigentes.creditoSinFirmar >= 8 ? "danger" : undefined} />
        <Metric label="Aprobados" value={fmtNum(m.credito.aprobado)} icon={<Coins className="size-3 text-[--color-fg-dim]" />} tone={m.credito.aprobado > 0 ? "accent" : undefined} />
      </div>

      {/* Acción principal */}
      {ev.accionPrincipal && (
        <div className="mt-3 rounded-md bg-[--color-accent-dim] px-2.5 py-2 text-[11px] leading-snug">
          <span className="font-bold text-[--color-accent]">{ev.accionPrincipal.id} · {ev.accionPrincipal.nombre}: </span>
          <span className="text-[--color-fg-muted]">{ev.accionPrincipal.detalle}</span>
        </div>
      )}
    </Link>
  );
}
