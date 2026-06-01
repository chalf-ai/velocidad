"use client";

import { Gauge } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import type { AgregadoVelocidad } from "@/lib/historico/vista-derivados";
import type { CuelloPrincipal, BucketVelocidad } from "@/lib/historico/cruce-roma-actas";

export interface FocoVelocidad {
  tipo: "cuello" | "bucket";
  valor: CuelloPrincipal | BucketVelocidad;
}

interface Props {
  data: AgregadoVelocidad;
  foco: FocoVelocidad | null;
  onFoco: (f: FocoVelocidad | null) => void;
}

const BUCKET_LABEL: Record<BucketVelocidad, string> = {
  rapido: "Rápido (≤21d)",
  normal: "Normal (22-45d)",
  lento: "Lento (46-90d)",
  muy_lento: "Muy lento (>90d)",
  sin_datos: "Sin datos",
};

const BUCKET_TONE: Record<BucketVelocidad, "success" | "info" | "warning" | "danger" | "muted"> = {
  rapido: "success",
  normal: "info",
  lento: "warning",
  muy_lento: "danger",
  sin_datos: "muted",
};

const CUELLO_TONE: Record<CuelloPrincipal, "danger" | "warning" | "info" | "muted" | "accent"> = {
  Logística: "warning",
  "Control de Negocio": "info",
  Comercial: "accent",
  Cliente: "muted",
  Mixto: "muted",
  "Sin información suficiente": "muted",
};

export function EjeVelocidadCard({ data, foco, onFoco }: Props) {
  const isFocoCuello = (c: CuelloPrincipal) =>
    foco?.tipo === "cuello" && foco.valor === c;
  const isFocoBucket = (b: BucketVelocidad) =>
    foco?.tipo === "bucket" && foco.valor === b;

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gauge className="size-4 text-[--color-accent]" />
            <h3 className="text-[15px] font-semibold text-[--color-fg]">Eje 1 — Velocidad Operacional</h3>
          </div>
          {foco && (
            <Button variant="ghost" size="sm" onClick={() => onFoco(null)}>
              Cerrar drill
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Total casos" value={fmtNum(data.totalCasos)} size="md" />
          <Stat
            label="Días totales · promedio"
            value={data.diasTotales.promedio ?? "—"}
            sub={`n=${fmtNum(data.diasTotales.nConDatos)}`}
            size="md"
          />
          <Stat label="Mediana" value={data.diasTotales.mediana ?? "—"} size="md" />
          <Stat label="p90" value={data.diasTotales.p90 ?? "—"} size="md" />
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium mb-2">
            Cuello principal (click = drill)
          </div>
          <div className="flex flex-wrap gap-2">
            {data.distribucionCuello.map((d) => (
              <button
                key={d.cuello}
                onClick={() =>
                  onFoco(isFocoCuello(d.cuello) ? null : { tipo: "cuello", valor: d.cuello })
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium",
                  "ring-1 ring-inset transition",
                  isFocoCuello(d.cuello)
                    ? "bg-[--color-accent] text-white ring-[--color-accent]"
                    : "bg-[--color-bg-elev-1] text-[--color-fg] ring-[--color-border] hover:ring-[--color-accent]",
                )}
              >
                <Badge tone={CUELLO_TONE[d.cuello]} size="xs" dot>
                  {d.cuello}
                </Badge>
                <span className="text-[--color-fg-muted]">{fmtNum(d.cantidad)}</span>
                <span className="text-[10.5px] text-[--color-fg-dim]">{d.pct}%</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium mb-2">
            Velocidad por bucket (click = drill)
          </div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(data.distribucionVelocidad) as BucketVelocidad[]).map((b) => (
              <button
                key={b}
                onClick={() =>
                  onFoco(isFocoBucket(b) ? null : { tipo: "bucket", valor: b })
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium",
                  "ring-1 ring-inset transition",
                  isFocoBucket(b)
                    ? "bg-[--color-accent] text-white ring-[--color-accent]"
                    : "bg-[--color-bg-elev-1] text-[--color-fg] ring-[--color-border] hover:ring-[--color-accent]",
                )}
              >
                <Badge tone={BUCKET_TONE[b]} size="xs" dot>
                  {BUCKET_LABEL[b]}
                </Badge>
                <span className="text-[--color-fg-muted]">{fmtNum(data.distribucionVelocidad[b])}</span>
              </button>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
