"use client";

import { LayoutGrid, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import type { CoberturaProceso } from "@/lib/historico/vista-derivados";

interface Props {
  /** Cobertura calculada por el caller (`calcularCoberturaProceso`). */
  cobertura: CoberturaProceso;
  /** Etiqueta legible del proceso — ej. "Control de Negocio". */
  nombreProceso: string;
  /** Hito faltante con drill activo (id estable). null = sin selección. */
  focoHitoId: string | null;
  /** Callback al clickear un hito faltante. Pasa null al hacer click sobre el mismo hito (toggle off). */
  onSelectHito: (id: string | null) => void;
}

/**
 * Cobertura del proceso operacional. Visible solo en modo
 * `historico_cerrado` y para procesos != cierre_y_cumplimiento.
 *
 * Responde 2 preguntas:
 *   1. ¿Qué % del universo cerrado tiene la línea de tiempo completa?
 *   2. ¿Qué hitos faltan y cuántos casos quedan fuera por cada uno?
 *
 * Para procesos triviales (Comercial / Cliente) donde el universo cerrado
 * por definición exige ambos hitos → `hitosFaltantes` viene vacío y se
 * muestra la variante compacta.
 */
export function CoberturaProcesoCard({
  cobertura,
  nombreProceso,
  focoHitoId,
  onSelectHito,
}: Props) {
  const { universoCerrado, timelineCompleto, pctTimelineCompleto, hitosFaltantes } = cobertura;

  // ─ Variante compacta — Comercial / Cliente o cualquier proceso con cobertura plena ─
  if (hitosFaltantes.length === 0) {
    return (
      <Card>
        <CardBody className="py-3 px-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <CheckCircle2 className="size-4 text-[--color-success] shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
                  Cobertura del proceso · {nombreProceso}
                </div>
                <div className="text-[13px] text-[--color-fg] mt-0.5">
                  Timeline completo:{" "}
                  <span className="font-semibold text-[--color-success]">100%</span>{" "}
                  <span className="text-[--color-fg-muted]">
                    ({fmtNum(timelineCompleto)} / {fmtNum(universoCerrado)})
                  </span>
                </div>
                <div className="text-[11.5px] text-[--color-fg-muted] mt-0.5">
                  Este proceso tiene pocos hitos medibles, por eso no registra brechas de cobertura relevantes.
                </div>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  const toneKpi =
    pctTimelineCompleto >= 80 ? "success" : pctTimelineCompleto >= 50 ? "warning" : "danger";
  const kpiTextClass =
    toneKpi === "success"
      ? "text-[--color-success]"
      : toneKpi === "warning"
        ? "text-[--color-warning]"
        : "text-[--color-danger]";

  return (
    <Card>
      <CardBody className="space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2 flex-wrap">
          <LayoutGrid className="size-3.5 text-[--color-fg-muted]" />
          <span className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
            Cobertura del proceso · {nombreProceso}
          </span>
          <Badge tone="muted" size="xs">
            Universo cerrado: {fmtNum(universoCerrado)} casos
          </Badge>
        </div>

        {/* KPI principal */}
        <div className="flex items-baseline gap-3 flex-wrap">
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-[--color-fg-muted] font-medium">
              Timeline completo
            </div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="text-[22px] font-semibold tabular-nums leading-none text-[--color-fg]">
                {fmtNum(timelineCompleto)}{" "}
                <span className="text-[--color-fg-muted] font-normal">/ {fmtNum(universoCerrado)}</span>
              </span>
              <span
                className={cn(
                  "text-[18px] font-semibold tabular-nums leading-none",
                  kpiTextClass,
                )}
              >
                {pctTimelineCompleto}%
              </span>
            </div>
          </div>
        </div>

        {/* Ranking de hitos faltantes */}
        <div>
          <div className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium mb-2">
            Hitos faltantes · click = drill
          </div>
          <ul className="space-y-1">
            {hitosFaltantes.map((h) => {
              const active = focoHitoId === h.id;
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => onSelectHito(active ? null : h.id)}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition",
                      "ring-1 ring-inset",
                      active
                        ? "bg-[--color-accent-dim] text-[--color-accent] ring-[--color-accent]"
                        : "bg-[--color-bg-elev-1] text-[--color-fg] ring-[--color-border] hover:ring-[--color-accent]",
                    )}
                  >
                    <AlertCircle
                      className={cn(
                        "size-3.5 shrink-0",
                        active ? "text-[--color-accent]" : "text-[--color-fg-muted]",
                      )}
                    />
                    <span
                      className={cn(
                        "flex-1 text-[13px] truncate",
                        active ? "font-semibold" : "font-medium",
                      )}
                    >
                      {h.label}
                    </span>
                    <span
                      className={cn(
                        "text-[13.5px] tabular-nums font-semibold w-16 text-right",
                        active ? "text-[--color-accent]" : "text-[--color-fg]",
                      )}
                    >
                      {fmtNum(h.faltantes)}
                    </span>
                    <span
                      className={cn(
                        "text-[12px] tabular-nums w-14 text-right",
                        active ? "text-[--color-accent]" : "text-[--color-fg-muted]",
                      )}
                    >
                      {h.pctUniverso}%
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="text-[11px] text-[--color-fg-muted] italic">
          Un caso puede faltar en más de un hito. Por eso los faltantes no suman el total.
        </div>
      </CardBody>
    </Card>
  );
}
