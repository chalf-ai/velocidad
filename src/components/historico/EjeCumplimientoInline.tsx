"use client";

import { useMemo } from "react";
import { ClipboardCheck } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import {
  type AgregadoCumplimiento,
  rankingPeoresCumplimiento,
} from "@/lib/historico/vista-derivados";
import type { BandaCumplimiento, EntradaConsolidada } from "@/lib/historico/cruce-roma-actas";
import type { NivelDocumental } from "@/lib/historico/parser-actas";
import type { FocoCumplimiento } from "@/components/historico/EjeCumplimientoCard";
import { RankingAccionableCard } from "@/components/historico/RankingAccionableCard";

interface Props {
  data: AgregadoCumplimiento;
  filas: EntradaConsolidada[];
  foco: FocoCumplimiento | null;
  onFoco: (v: FocoCumplimiento | null) => void;
}

const NIVEL_TONE: Record<NivelDocumental, "success" | "warning" | "danger"> = {
  completo: "success",
  parcial: "warning",
  minimo: "danger",
};

const BANDA_TONE: Record<BandaCumplimiento, "success" | "warning" | "danger" | "muted"> = {
  ok: "success",
  menor: "warning",
  mayor: "danger",
  no_evaluable: "muted",
};

export function EjeCumplimientoInline({ data, filas, foco, onFoco }: Props) {
  const g = data.global;
  const isFocoNivel = (n: NivelDocumental) => foco?.tipo === "nivel" && foco.valor === n;
  const isFocoBanda = (b: BandaCumplimiento) => foco?.tipo === "banda" && foco.valor === b;

  const pctCompl = g.universo
    ? +((g.porNivelDocumental.completo / g.universo) * 100).toFixed(1)
    : 0;

  const ranking = useMemo(
    () => ({
      sucursal: rankingPeoresCumplimiento(filas, "sucursal"),
      marca: rankingPeoresCumplimiento(filas, "marca"),
      vendedor: rankingPeoresCumplimiento(filas, "vendedor"),
    }),
    [filas],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="size-4 text-[--color-accent]" />
              <h3 className="text-[15px] font-semibold text-[--color-fg]">Cumplimiento operacional</h3>
            </div>
            {foco && (
              <Button variant="ghost" size="sm" onClick={() => onFoco(null)}>
                Cerrar drill
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Universo" value={fmtNum(g.universo)} size="md" />
            <Stat label="% completo" value={`${pctCompl}%`} size="md" tone={pctCompl >= 70 ? "success" : pctCompl >= 50 ? "warning" : "danger"} />
            <Stat
              label="Sin patente recibida"
              value={fmtNum(g.entregadosSinPatenteRecibida)}
              sub="entregados sin fecha"
              size="md"
              tone="warning"
            />
            <Stat
              label="Sin autorización"
              value={fmtNum(g.entregadosSinAutorizacion)}
              sub={`Sin solicitud: ${fmtNum(g.entregadosSinSolicitudEntrega)}`}
              size="md"
              tone="warning"
            />
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium mb-2">
              Nivel documental · click = drill
            </div>
            <div className="flex flex-wrap gap-2">
              {(["completo", "parcial", "minimo"] as NivelDocumental[]).map((n) => (
                <button
                  key={n}
                  onClick={() => onFoco(isFocoNivel(n) ? null : { tipo: "nivel", valor: n })}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium",
                    "ring-1 ring-inset transition",
                    isFocoNivel(n)
                      ? "bg-[--color-accent-dim] text-[--color-accent] ring-[--color-accent] font-semibold"
                      : "bg-[--color-bg-elev-1] text-[--color-fg] ring-[--color-border] hover:ring-[--color-accent]",
                  )}
                >
                  <Badge tone={NIVEL_TONE[n]} size="xs" dot>{n}</Badge>
                  <span className="text-[--color-fg-muted]">{fmtNum(g.porNivelDocumental[n])}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium mb-2">
              Banda de cumplimiento · click = drill
            </div>
            <div className="flex flex-wrap gap-2">
              {(["ok", "menor", "mayor", "no_evaluable"] as BandaCumplimiento[]).map((b) => (
                <button
                  key={b}
                  onClick={() => onFoco(isFocoBanda(b) ? null : { tipo: "banda", valor: b })}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium",
                    "ring-1 ring-inset transition",
                    isFocoBanda(b)
                      ? "bg-[--color-accent-dim] text-[--color-accent] ring-[--color-accent] font-semibold"
                      : "bg-[--color-bg-elev-1] text-[--color-fg] ring-[--color-border] hover:ring-[--color-accent]",
                  )}
                >
                  <Badge tone={BANDA_TONE[b]} size="xs" dot>{b}</Badge>
                  <span className="text-[--color-fg-muted]">{fmtNum(g.porBanda[b])}</span>
                </button>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>

      <RankingAccionableCard
        titulo="Top peores por cumplimiento"
        descripcion="Ranking ordenado por menor % de casos con nivel documental completo."
        unidad="porcentaje"
        porSucursal={ranking.sucursal}
        porMarca={ranking.marca}
        porVendedor={ranking.vendedor}
      />
    </div>
  );
}
