"use client";

import { Inbox, AlertCircle } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import type { BacklogAbierto } from "@/lib/historico/vista-derivados";

interface Props {
  backlog: BacklogAbierto;
  nombreProceso: string;
  focoCubetaId: string | null;
  onSelectCubeta: (cubetaId: string | null) => void;
}

function dias(v: number | null): string {
  if (v == null) return "—";
  return `${v.toLocaleString("es-CL", { maximumFractionDigits: 1 })} d`;
}

/**
 * Backlog abierto de un proceso operacional.
 *
 * Lectura distinta a la del funnel histórico: NO se calculan medianas
 * históricas acá; se calcula AGING (días desde la última señal registrada).
 *
 * Cubetas pueden ser NO mutuamente excluyentes — un caso abierto con varios
 * hitos faltantes aparece en varias cubetas. El UI lo explicita con un
 * texto chico debajo.
 */
export function BacklogProcesoAbierto({
  backlog,
  nombreProceso,
  focoCubetaId,
  onSelectCubeta,
}: Props) {
  const { universoAbierto, agingMedianoGlobal, agingP90Global, cubetas, cubetaPeorId } = backlog;
  const cubetasOrdenadas = [...cubetas].sort((a, b) => b.cantidad - a.cantidad);

  return (
    <div className="space-y-3">
      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-baseline gap-2 flex-wrap">
            <Inbox className="size-3.5 text-[--color-fg-muted]" />
            <span className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
              {nombreProceso} · Backlog abierto
            </span>
            <Badge tone="muted" size="xs">
              Universo: {fmtNum(universoAbierto)} pendientes
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg px-3 py-2 ring-1 ring-inset bg-[--color-bg-elev-1] ring-[--color-border]">
              <div className="text-[10.5px] uppercase tracking-wider text-[--color-fg-muted] font-medium">
                Aging mediano (desde última señal)
              </div>
              <div className="mt-0.5 text-[18px] font-semibold tabular-nums text-[--color-fg]">
                {dias(agingMedianoGlobal)}
              </div>
            </div>
            <div className="rounded-lg px-3 py-2 ring-1 ring-inset bg-[--color-bg-elev-1] ring-[--color-border]">
              <div className="text-[10.5px] uppercase tracking-wider text-[--color-fg-muted] font-medium">
                Aging p90 (desde última señal)
              </div>
              <div className="mt-0.5 text-[18px] font-semibold tabular-nums text-[--color-fg]">
                {dias(agingP90Global)}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
              Cubetas de pendientes · click = ver VINs
            </span>
          </div>
          {universoAbierto === 0 ? (
            <div className="text-[12px] text-[--color-fg-muted] italic">
              No hay casos abiertos en el universo filtrado.
            </div>
          ) : (
            <ul className="space-y-1">
              {cubetasOrdenadas.map((c) => {
                const activa = focoCubetaId === c.id;
                const esPeor = cubetaPeorId === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onSelectCubeta(activa ? null : c.id)}
                      disabled={c.cantidad === 0}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition ring-1 ring-inset",
                        c.cantidad === 0 && "text-[--color-fg-dim] cursor-not-allowed",
                        activa
                          ? "bg-[--color-accent-dim] text-[--color-accent] ring-[--color-accent]"
                          : esPeor && c.cantidad > 0
                            ? "bg-[--color-warning-dim] text-[--color-fg] ring-[--color-warning]"
                            : "bg-[--color-bg-elev-1] text-[--color-fg] ring-[--color-border] hover:ring-[--color-accent]",
                      )}
                    >
                      {esPeor && c.cantidad > 0 ? (
                        <AlertCircle
                          className={cn(
                            "size-3.5 shrink-0",
                            activa ? "text-[--color-accent]" : "text-[--color-warning]",
                          )}
                        />
                      ) : (
                        <span className="size-3.5 shrink-0" />
                      )}
                      <span
                        className={cn(
                          "flex-1 text-[13px] truncate",
                          activa || esPeor ? "font-semibold" : "font-medium",
                        )}
                      >
                        {c.label}
                        {esPeor && c.cantidad > 0 && (
                          <span className="ml-1 text-[--color-warning]">◆ peor</span>
                        )}
                      </span>
                      <span
                        className={cn(
                          "text-[13.5px] tabular-nums font-semibold w-16 text-right",
                          activa ? "text-[--color-accent]" : "text-[--color-fg]",
                        )}
                      >
                        {fmtNum(c.cantidad)}
                      </span>
                      <span
                        className={cn(
                          "text-[12px] tabular-nums w-24 text-right",
                          activa ? "text-[--color-accent]" : "text-[--color-fg-muted]",
                        )}
                      >
                        med {dias(c.agingMedianoDias)}
                      </span>
                      <span
                        className={cn(
                          "text-[12px] tabular-nums w-24 text-right",
                          activa ? "text-[--color-accent]" : "text-[--color-fg-muted]",
                        )}
                      >
                        p90 {dias(c.agingP90Dias)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="text-[11px] text-[--color-fg-muted] italic">
            Un caso puede aparecer en más de una cubeta si le falta más de un hito.
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
