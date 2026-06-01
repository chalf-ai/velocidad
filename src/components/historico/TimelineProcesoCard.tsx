"use client";

import { Clock } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import type {
  ProcesoId,
  TimelineProceso,
  TramoId,
} from "@/lib/historico/vista-derivados";
import type { CuelloPrincipal } from "@/lib/historico/cruce-roma-actas";

interface Props {
  data: TimelineProceso;
  focoTramo: TramoId | null;
  onFocoTramo: (id: TramoId | null) => void;
  /** Etiqueta del cuello para encabezado, ej. "Control de Negocio". */
  cuelloLabel: CuelloPrincipal;
}

const PROCESO_KICKER: Record<ProcesoId, string> = {
  control_negocio: "Línea documental",
  logistica: "Línea logística",
  cliente: "Línea cliente",
  comercial: "Línea comercial",
};

function fmtDias(v: number | null): string {
  if (v === null) return "—";
  if (Number.isInteger(v)) return `${v}d`;
  return `${v.toFixed(1)}d`;
}

export function TimelineProcesoCard({ data, focoTramo, onFocoTramo, cuelloLabel }: Props) {
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-[--color-accent]" />
            <h3 className="text-[15px] font-semibold text-[--color-fg]">
              Línea de tiempo del proceso
            </h3>
            <Badge tone="muted" size="sm">
              {PROCESO_KICKER[data.proceso]}
            </Badge>
            <Badge tone="accent" size="sm">
              cuello: {cuelloLabel}
            </Badge>
          </div>
          {focoTramo && (
            <Button variant="ghost" size="sm" onClick={() => onFocoTramo(null)}>
              Cerrar drill por tramo
            </Button>
          )}
        </div>

        <div className="text-[11.5px] text-[--color-fg-muted]">
          Universo en cuello {cuelloLabel}:{" "}
          <span className="text-[--color-fg] font-medium">{fmtNum(data.universoEnProceso)}</span>{" "}
          casos. Cada tramo se mide solo en los casos con AMBAS fechas válidas.
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-[--color-bg-elev-2] text-[--color-fg-muted] text-[10.5px] uppercase tracking-wider">
              <tr>
                <th className="text-left px-2.5 py-2 font-medium">Tramo</th>
                <th className="text-right px-2 py-2 font-medium">Prom.</th>
                <th className="text-right px-2 py-2 font-medium">Mediana</th>
                <th className="text-right px-2 py-2 font-medium">p90</th>
                <th className="text-right px-2 py-2 font-medium">n</th>
                <th className="text-right px-2 py-2 font-medium">sin dato</th>
                <th className="text-left px-2 py-2 font-medium">Top sucursal</th>
                <th className="text-left px-2 py-2 font-medium">Top marca</th>
                <th className="text-right px-2 py-2 font-medium">Drill</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[--color-border-soft]">
              {data.tramos.map((t) => {
                const noCalculable = t.n === 0;
                const active = focoTramo === t.id;
                return (
                  <tr
                    key={t.id}
                    className={cn(
                      noCalculable && "opacity-50",
                      active && "bg-[--color-accent-dim]",
                    )}
                  >
                    <td className="px-2.5 py-2 whitespace-nowrap">
                      <span className="font-medium text-[--color-fg]">{t.label}</span>
                    </td>
                    <td className="text-right px-2 py-2 mono">{fmtDias(t.promedioDias)}</td>
                    <td className="text-right px-2 py-2 mono">{fmtDias(t.medianaDias)}</td>
                    <td className="text-right px-2 py-2 mono">{fmtDias(t.p90Dias)}</td>
                    <td className="text-right px-2 py-2 mono">{fmtNum(t.n)}</td>
                    <td className="text-right px-2 py-2 mono text-[--color-fg-muted]">
                      {fmtNum(t.sinDato)}
                    </td>
                    <td className="px-2 py-2 truncate max-w-[180px]">
                      {t.topSucursal ? (
                        <span className="text-[--color-fg-muted]">
                          <span className="text-[--color-fg]">{t.topSucursal.key}</span>{" "}
                          <span className="text-[10.5px]">({fmtNum(t.topSucursal.n)})</span>
                        </span>
                      ) : (
                        <span className="text-[--color-fg-dim] italic">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 truncate max-w-[140px]">
                      {t.topMarca ? (
                        <span className="text-[--color-fg-muted]">
                          <span className="text-[--color-fg]">{t.topMarca.key}</span>{" "}
                          <span className="text-[10.5px]">({fmtNum(t.topMarca.n)})</span>
                        </span>
                      ) : (
                        <span className="text-[--color-fg-dim] italic">—</span>
                      )}
                    </td>
                    <td className="text-right px-2 py-2">
                      <button
                        disabled={noCalculable}
                        onClick={() => onFocoTramo(active ? null : t.id)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
                          "ring-1 ring-inset transition",
                          noCalculable
                            ? "bg-[--color-bg-elev-2] text-[--color-fg-dim] ring-[--color-border] cursor-not-allowed"
                            : active
                              ? "bg-[--color-accent] text-white ring-[--color-accent]"
                              : "bg-[--color-bg-elev-1] text-[--color-fg-muted] ring-[--color-border] hover:ring-[--color-accent] hover:text-[--color-fg]",
                        )}
                      >
                        {noCalculable ? "n=0" : active ? "abierto" : "drill"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {data.tramos.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-4 text-[--color-fg-dim] italic">
                    Sin tramos definidos para este proceso.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="text-[10.5px] text-[--color-fg-dim] leading-relaxed">
          Lectura: <span className="text-[--color-fg-muted]">n</span> es el universo donde se puede
          medir el tramo (ambas fechas presentes).{" "}
          <span className="text-[--color-fg-muted]">sin dato</span> son los casos que cuentan al
          cuello pero al tramo no se les puede calcular. Promedio/mediana/p90 se calculan solo sobre
          <span className="text-[--color-fg-muted]"> n</span>. Tramos hacia entrega usan
          {" "}<span className="text-[--color-fg-muted]">fEntregaReal</span> estricto (no se sustituye
          por listo-para-entrega ni ETA).
        </div>
      </CardBody>
    </Card>
  );
}
