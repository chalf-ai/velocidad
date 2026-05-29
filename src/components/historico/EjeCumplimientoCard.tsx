"use client";

import { ClipboardCheck } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import type { AgregadoCumplimiento, BloqueCumplimiento } from "@/lib/historico/vista-derivados";
import type { BandaCumplimiento } from "@/lib/historico/cruce-roma-actas";
import type { NivelDocumental } from "@/lib/historico/parser-actas";

export interface FocoCumplimiento {
  tipo: "nivel" | "banda";
  valor: NivelDocumental | BandaCumplimiento;
}

interface Props {
  data: AgregadoCumplimiento;
  foco: FocoCumplimiento | null;
  onFoco: (f: FocoCumplimiento | null) => void;
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

function TopTable({ titulo, rows }: {
  titulo: string;
  rows: Array<{ etiqueta: string; bloque: BloqueCumplimiento }>;
}) {
  const top = rows.slice(0, 5);
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium mb-2">
        Top 5 por {titulo}
      </div>
      <div className="surface rounded-lg overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-[--color-bg-elev-2] text-[--color-fg-muted] text-[10.5px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-2.5 py-1.5 font-medium">{titulo}</th>
              <th className="text-right px-2 py-1.5 font-medium">Universo</th>
              <th className="text-right px-2 py-1.5 font-medium">Entreg.</th>
              <th className="text-right px-2 py-1.5 font-medium">Completo</th>
              <th className="text-right px-2 py-1.5 font-medium">Sin pat.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[--color-border-soft]">
            {top.map((r, i) => {
              const pctCompl = r.bloque.universo
                ? ((r.bloque.porNivelDocumental.completo / r.bloque.universo) * 100).toFixed(1)
                : "0";
              return (
                <tr key={i}>
                  <td className="px-2.5 py-1.5 truncate max-w-[200px]">{r.etiqueta}</td>
                  <td className="text-right px-2 py-1.5 mono">{fmtNum(r.bloque.universo)}</td>
                  <td className="text-right px-2 py-1.5 mono">{fmtNum(r.bloque.entregados)}</td>
                  <td className="text-right px-2 py-1.5 mono">{pctCompl}%</td>
                  <td className="text-right px-2 py-1.5 mono">{fmtNum(r.bloque.entregadosSinPatenteRecibida)}</td>
                </tr>
              );
            })}
            {top.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-3 text-[--color-fg-dim] italic">
                  Sin datos
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function EjeCumplimientoCard({ data, foco, onFoco }: Props) {
  const g = data.global;
  const isFocoNivel = (n: NivelDocumental) => foco?.tipo === "nivel" && foco.valor === n;
  const isFocoBanda = (b: BandaCumplimiento) => foco?.tipo === "banda" && foco.valor === b;

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="size-4 text-[--color-accent]" />
            <h3 className="text-[15px] font-semibold text-[--color-fg]">
              Eje 2 — Cumplimiento Operacional
            </h3>
          </div>
          {foco && (
            <Button variant="ghost" size="sm" onClick={() => onFoco(null)}>
              Cerrar drill
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Universo" value={fmtNum(g.universo)} size="md" />
          <Stat label="Entregados" value={fmtNum(g.entregados)} size="md" tone="success" />
          <Stat label="Sin patente recibida" value={fmtNum(g.entregadosSinPatenteRecibida)} size="md" tone="warning" />
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
            Nivel documental (click = drill)
          </div>
          <div className="flex flex-wrap gap-2">
            {(["completo", "parcial", "minimo"] as NivelDocumental[]).map((n) => (
              <button
                key={n}
                onClick={() =>
                  onFoco(isFocoNivel(n) ? null : { tipo: "nivel", valor: n })
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium",
                  "ring-1 ring-inset transition",
                  isFocoNivel(n)
                    ? "bg-[--color-accent] text-white ring-[--color-accent]"
                    : "bg-[--color-bg-elev-1] text-[--color-fg] ring-[--color-border] hover:ring-[--color-accent]",
                )}
              >
                <Badge tone={NIVEL_TONE[n]} size="xs" dot>
                  {n}
                </Badge>
                <span className="text-[--color-fg-muted]">{fmtNum(g.porNivelDocumental[n])}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium mb-2">
            Banda de cumplimiento (click = drill)
          </div>
          <div className="flex flex-wrap gap-2">
            {(["ok", "menor", "mayor", "no_evaluable"] as BandaCumplimiento[]).map((b) => (
              <button
                key={b}
                onClick={() =>
                  onFoco(isFocoBanda(b) ? null : { tipo: "banda", valor: b })
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium",
                  "ring-1 ring-inset transition",
                  isFocoBanda(b)
                    ? "bg-[--color-accent] text-white ring-[--color-accent]"
                    : "bg-[--color-bg-elev-1] text-[--color-fg] ring-[--color-border] hover:ring-[--color-accent]",
                )}
              >
                <Badge tone={BANDA_TONE[b]} size="xs" dot>
                  {b}
                </Badge>
                <span className="text-[--color-fg-muted]">{fmtNum(g.porBanda[b])}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <TopTable
            titulo="Sucursal"
            rows={data.porSucursal.map((s) => ({ etiqueta: s.sucursal, bloque: s }))}
          />
          <TopTable
            titulo="Marca"
            rows={data.porMarca.map((m) => ({ etiqueta: m.marca, bloque: m }))}
          />
          <TopTable
            titulo="Responsable"
            rows={data.porResponsable.map((v) => ({ etiqueta: v.responsable, bloque: v }))}
          />
        </div>
      </CardBody>
    </Card>
  );
}
