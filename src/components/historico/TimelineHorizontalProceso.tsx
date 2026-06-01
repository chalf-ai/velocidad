"use client";

import { ArrowRight, AlertTriangle } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import type {
  ProcesoId,
  TimelineProceso,
  TramoId,
  TramoMetricas,
} from "@/lib/historico/vista-derivados";
import type { CuelloPrincipal } from "@/lib/historico/cruce-roma-actas";

interface Props {
  data: TimelineProceso;
  focoTramo: TramoId | null;
  onFocoTramo: (id: TramoId | null) => void;
  cuelloLabel: CuelloPrincipal;
}

const PROCESO_KICKER: Record<ProcesoId, string> = {
  control_negocio: "Línea documental",
  logistica: "Línea logística",
  cliente: "Línea cliente",
  comercial: "Línea comercial",
};

/** Extrae los nombres de los hitos de la cadena de tramos.
 *  ej. "Factura → Solicitud inscripción" → ["Factura", "Solicitud inscripción"]
 *  La cadena resultante: hito_0 -- tramo_0 --> hito_1 -- tramo_1 --> hito_2 ... */
function extraerHitos(tramos: TramoMetricas[]): string[] {
  if (tramos.length === 0) return [];
  const hitos: string[] = [];
  for (let i = 0; i < tramos.length; i++) {
    const [from, to] = tramos[i].label.split(" → ").map((s) => s.trim());
    if (i === 0) hitos.push(from);
    hitos.push(to);
  }
  return hitos;
}

function tonoConector(med: number | null): "rapido" | "medio" | "lento" | "invertido" | "vacio" {
  if (med === null) return "vacio";
  if (med < 0) return "invertido";
  if (med <= 2) return "rapido";
  if (med <= 7) return "medio";
  return "lento";
}

function fmtDias(v: number | null): string {
  if (v === null) return "—";
  if (Number.isInteger(v)) return `${v}d`;
  return `${v.toFixed(1)}d`;
}

export function TimelineHorizontalProceso({ data, focoTramo, onFocoTramo, cuelloLabel }: Props) {
  const hitos = extraerHitos(data.tramos);

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium">
              Línea de tiempo
            </span>
            <Badge tone="muted" size="sm">
              {PROCESO_KICKER[data.proceso]}
            </Badge>
            <Badge tone="accent" size="sm">
              cuello: {cuelloLabel}
            </Badge>
            <span className="text-[11.5px] text-[--color-fg-muted]">
              Universo: <span className="text-[--color-fg] font-medium">{fmtNum(data.universoEnProceso)}</span>
            </span>
          </div>
          {focoTramo && (
            <Button variant="ghost" size="sm" onClick={() => onFocoTramo(null)}>
              Cerrar drill por tramo
            </Button>
          )}
        </div>

        {data.tramos.length === 0 ? (
          <div className="py-6 text-center text-[--color-fg-dim] italic text-[12px]">
            Sin tramos definidos para este proceso.
          </div>
        ) : (
          <div className="overflow-x-auto pb-1">
            <div className="inline-flex items-stretch min-w-full">
              {hitos.map((h, idx) => (
                <div key={`hito-conn-${idx}`} className="flex items-stretch">
                  {/* Hito */}
                  <div className="flex flex-col items-center justify-start min-w-[120px] max-w-[160px] py-1.5 px-2">
                    <div className="size-7 rounded-full bg-[--color-bg-elev-3] border border-[--color-border-strong] grid place-items-center text-[11px] font-semibold text-[--color-fg-muted]">
                      {idx + 1}
                    </div>
                    <div className="mt-1.5 text-[11.5px] font-medium text-[--color-fg] text-center leading-tight">
                      {h}
                    </div>
                  </div>
                  {/* Conector (excepto después del último hito) */}
                  {idx < data.tramos.length && (
                    <Conector
                      tramo={data.tramos[idx]}
                      active={focoTramo === data.tramos[idx].id}
                      onClick={() =>
                        onFocoTramo(focoTramo === data.tramos[idx].id ? null : data.tramos[idx].id)
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-[10.5px] text-[--color-fg-dim] leading-relaxed">
          Cada conector es un tramo. <span className="text-[--color-fg-muted]">n</span> = casos con
          AMBAS fechas. <span className="text-[--color-fg-muted]">sin dato</span> = casos del cuello
          sin alguna de las fechas. Conectores en{" "}
          <span className="text-[--color-warning] font-medium">ámbar</span> con badge
          {" "}<span className="font-medium">orden invertido</span> indican mediana negativa (la fecha
          de fin es anterior a la de inicio en la mayoría de los casos del tramo). Tramos hacia
          entrega usan fEntregaReal estricto.
        </div>
      </CardBody>
    </Card>
  );
}

function Conector({
  tramo,
  active,
  onClick,
}: {
  tramo: TramoMetricas;
  active: boolean;
  onClick: () => void;
}) {
  const tono = tonoConector(tramo.medianaDias);
  const noCalc = tramo.n === 0;

  const COLORS = {
    rapido: { line: "bg-[--color-success]", text: "text-[--color-success]", dim: "bg-[--color-success-dim]" },
    medio: { line: "bg-[--color-warning]", text: "text-[--color-warning]", dim: "bg-[--color-warning-dim]" },
    lento: { line: "bg-[--color-danger]", text: "text-[--color-danger]", dim: "bg-[--color-danger-dim]" },
    invertido: { line: "bg-[--color-warning]", text: "text-[--color-warning]", dim: "bg-[--color-warning-dim]" },
    vacio: { line: "bg-[--color-border]", text: "text-[--color-fg-dim]", dim: "bg-[--color-bg-elev-2]" },
  } as const;
  const c = COLORS[tono];

  return (
    <button
      onClick={onClick}
      disabled={noCalc}
      className={cn(
        "group relative flex flex-col items-center justify-center min-w-[140px] px-2 py-2 transition",
        active && "ring-2 ring-[--color-accent] rounded-lg bg-[--color-accent-dim]",
        noCalc && "opacity-50 cursor-not-allowed",
      )}
      title={tramo.label}
    >
      {/* línea conectora */}
      <div className="relative w-full flex items-center">
        <div className={cn("h-0.5 flex-1", c.line)} />
        <ArrowRight className={cn("size-3 -ml-0.5", c.text)} />
      </div>
      {/* contenido del conector */}
      <div className="mt-1.5 text-center space-y-0.5">
        <div className={cn("text-[14px] font-semibold mono", c.text)}>{fmtDias(tramo.medianaDias)}</div>
        <div className="text-[10px] text-[--color-fg-muted]">
          p90 {fmtDias(tramo.p90Dias)}
        </div>
        <div className="text-[10.5px]">
          <span className="text-[--color-fg]">n={fmtNum(tramo.n)}</span>
          {tramo.sinDato > 0 && (
            <span className="text-[--color-fg-dim]"> · {fmtNum(tramo.sinDato)} sin dato</span>
          )}
        </div>
        {tono === "invertido" && (
          <div className="inline-flex items-center gap-1 text-[9.5px] text-[--color-warning] font-medium">
            <AlertTriangle className="size-2.5" />
            orden invertido
          </div>
        )}
        {noCalc && (
          <div className="text-[9.5px] text-[--color-fg-dim] italic">no calculable</div>
        )}
      </div>
    </button>
  );
}
