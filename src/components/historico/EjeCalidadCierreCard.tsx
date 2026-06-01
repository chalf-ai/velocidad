"use client";

import { ShieldCheck } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import type {
  AgregadoCalidadCierre,
  TipoHuerfano,
} from "@/lib/historico/vista-derivados";
import type { ConflictoKind } from "@/lib/historico/cruce-roma-actas";
import type { CalidadCierre } from "@/lib/historico/consolidador-actas";

export type FocoCalidadCierre =
  | { tipo: "estado"; valor: CalidadCierre | "no_evaluable" }
  | { tipo: "huerfano"; valor: TipoHuerfano }
  | { tipo: "conflicto"; valor: ConflictoKind };

interface Props {
  data: AgregadoCalidadCierre;
  foco: FocoCalidadCierre | null;
  onFoco: (f: FocoCalidadCierre | null) => void;
}

const HUERFANO_LABEL: Record<TipoHuerfano, string> = {
  tipo1: "Tipo 1 — entrega no registrada",
  tipo2: "Tipo 2 — cierre inconsistente",
  tipo3: "Tipo 3 — desaparecido",
  tipo4: "Tipo 4 — sin trazabilidad",
  otro: "Otros",
};

const KIND_LABEL: Record<ConflictoKind, string> = {
  CONFLICTO_VIN: "VIN cambiado",
  CONFLICTO_FFACTURA: "fFactura",
  CONFLICTO_FINSCRIPCION: "fInscripción",
  CONFLICTO_ENTREGA: "Estado de entrega",
  FECHA_IMPOSIBLE_ENTREGA_ANTES_DE_SOLICITUD: "Entrega < Solicitud",
  FECHA_IMPOSIBLE_ENTREGA_ANTES_DE_FACTURA: "Entrega < Factura",
  FECHA_IMPOSIBLE_PATENTE_ANTES_DE_INSCRIPCION: "Patente < Inscripción",
  ESTADO_TERMINAL_DEGRADADO: "Terminal degradado",
};

export function EjeCalidadCierreCard({ data, foco, onFoco }: Props) {
  const isFocoEstado = (e: CalidadCierre | "no_evaluable") =>
    foco?.tipo === "estado" && foco.valor === e;
  const isFocoHuer = (t: TipoHuerfano) => foco?.tipo === "huerfano" && foco.valor === t;
  const isFocoConf = (k: ConflictoKind) => foco?.tipo === "conflicto" && foco.valor === k;

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-[--color-accent]" />
            <h3 className="text-[15px] font-semibold text-[--color-fg]">
              Eje 3 — Calidad de Cierre
            </h3>
          </div>
          {foco && (
            <Button variant="ghost" size="sm" onClick={() => onFoco(null)}>
              Cerrar drill
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(["correcto", "huerfano", "inconsistente", "no_evaluable"] as const).map((e) => (
            <Stat
              key={e}
              label={e}
              value={fmtNum(data.distribucion[e])}
              tone={
                e === "correcto"
                  ? "success"
                  : e === "huerfano"
                    ? "warning"
                    : e === "inconsistente"
                      ? "danger"
                      : "default"
              }
              size="md"
              as="button"
              onClick={() =>
                onFoco(isFocoEstado(e) ? null : { tipo: "estado", valor: e })
              }
              className={isFocoEstado(e) ? "ring-2 ring-[--color-accent]" : ""}
            />
          ))}
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium mb-2">
            Huérfanos por tipo (sobre {fmtNum(data.totalHuerfanos)})
          </div>
          <div className="flex flex-wrap gap-2">
            {(["tipo1", "tipo2", "tipo3", "tipo4", "otro"] as TipoHuerfano[]).map((t) => (
              <button
                key={t}
                onClick={() =>
                  onFoco(isFocoHuer(t) ? null : { tipo: "huerfano", valor: t })
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium",
                  "ring-1 ring-inset transition",
                  isFocoHuer(t)
                    ? "bg-[--color-accent] text-white ring-[--color-accent]"
                    : "bg-[--color-bg-elev-1] text-[--color-fg] ring-[--color-border] hover:ring-[--color-accent]",
                )}
              >
                <Badge tone="warning" size="xs" dot>
                  {HUERFANO_LABEL[t]}
                </Badge>
                <span className="text-[--color-fg-muted]">{fmtNum(data.huerfanosPorTipo[t])}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium mb-2">
            Inconsistencias por tipo de conflicto material (sobre {fmtNum(data.totalInconsistentes)})
          </div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(data.inconsistentesPorConflicto) as ConflictoKind[])
              .filter((k) => data.inconsistentesPorConflicto[k] > 0)
              .sort(
                (a, b) =>
                  data.inconsistentesPorConflicto[b] - data.inconsistentesPorConflicto[a],
              )
              .map((k) => (
                <button
                  key={k}
                  onClick={() =>
                    onFoco(isFocoConf(k) ? null : { tipo: "conflicto", valor: k })
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium",
                    "ring-1 ring-inset transition",
                    isFocoConf(k)
                      ? "bg-[--color-accent] text-white ring-[--color-accent]"
                      : "bg-[--color-bg-elev-1] text-[--color-fg] ring-[--color-border] hover:ring-[--color-accent]",
                  )}
                >
                  <Badge tone="danger" size="xs" dot>
                    {KIND_LABEL[k]}
                  </Badge>
                  <span className="text-[--color-fg-muted]">
                    {fmtNum(data.inconsistentesPorConflicto[k])}
                  </span>
                </button>
              ))}
            {Object.values(data.inconsistentesPorConflicto).every((n) => n === 0) && (
              <span className="text-[11px] text-[--color-fg-dim] italic">
                Sin conflictos materiales en el universo filtrado.
              </span>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
