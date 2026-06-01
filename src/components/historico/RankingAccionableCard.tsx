"use client";

import { Trophy } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import type { RankingItem, RankingDim } from "@/lib/historico/vista-derivados";

interface ColumnaProps {
  titulo: string;
  items: RankingItem[];
  unidad: "dias" | "porcentaje";
  /** Texto debajo del título que explica la métrica. */
  metricaLabel: string;
  emptyHint?: string;
}

function fmtMetrica(v: number, u: "dias" | "porcentaje"): string {
  if (u === "porcentaje") return `${v}%`;
  return Number.isInteger(v) ? `${v}d` : `${v.toFixed(1)}d`;
}

function ToneByPos({ pos, children }: { pos: number; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex size-5 rounded-full items-center justify-center text-[10px] font-semibold",
        pos === 0
          ? "bg-[--color-danger-dim] text-[--color-danger]"
          : pos === 1
            ? "bg-[--color-warning-dim] text-[--color-warning]"
            : "bg-[--color-bg-elev-3] text-[--color-fg-muted]",
      )}
    >
      {children}
    </span>
  );
}

function ColumnaRanking({ titulo, items, unidad, metricaLabel, emptyHint }: ColumnaProps) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium">
          {titulo}
        </div>
        <div className="text-[10.5px] text-[--color-fg-dim]">{metricaLabel}</div>
      </div>
      {items.length === 0 ? (
        <div className="text-[11.5px] text-[--color-fg-dim] italic py-1.5">
          {emptyHint ?? "Sin datos suficientes (n<20 por clave)."}
        </div>
      ) : (
        <div className="space-y-1">
          {items.map((it, i) => (
            <div
              key={it.key}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[--color-bg-elev-1] border border-[--color-border]"
            >
              <ToneByPos pos={i}>{i + 1}</ToneByPos>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-[--color-fg] truncate" title={it.key}>
                  {it.key}
                </div>
                <div className="text-[10.5px] text-[--color-fg-muted]">
                  n={fmtNum(it.n)}
                  {it.detalle && <span> · {it.detalle}</span>}
                </div>
              </div>
              <div className="text-[13.5px] font-semibold mono text-[--color-fg]">
                {fmtMetrica(it.metrica, unidad)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  titulo: string;
  /** "Peor mediana", "Menor % completo", "Mayor % cierre problemático" */
  descripcion: string;
  unidad: "dias" | "porcentaje";
  porSucursal: RankingItem[];
  porMarca: RankingItem[];
  porVendedor: RankingItem[];
}

export function RankingAccionableCard({
  titulo,
  descripcion,
  unidad,
  porSucursal,
  porMarca,
  porVendedor,
}: Props) {
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Trophy className="size-3.5 text-[--color-accent]" />
            <h3 className="text-[14px] font-semibold text-[--color-fg]">{titulo}</h3>
          </div>
          <Badge tone="muted" size="xs">n ≥ 20 por clave</Badge>
        </div>
        <div className="text-[11.5px] text-[--color-fg-muted]">{descripcion}</div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ColumnaRanking
            titulo="Por sucursal"
            metricaLabel={`Top 5 peores`}
            items={porSucursal}
            unidad={unidad}
          />
          <ColumnaRanking
            titulo="Por marca"
            metricaLabel={`Top 5 peores`}
            items={porMarca}
            unidad={unidad}
          />
          <ColumnaRanking
            titulo="Por responsable"
            metricaLabel={`Top 5 peores`}
            items={porVendedor}
            unidad={unidad}
          />
        </div>
      </CardBody>
    </Card>
  );
}

/** Helper: tipo unión re-exportado para uso conveniente. */
export type { RankingDim };
