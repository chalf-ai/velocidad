"use client";

/**
 * Colapsable de Marcas críticas · header siempre visible, detalle colapsado.
 *
 * Lista marcas con cumplimiento bajo el umbral (default 80%), ordenadas por
 * peor primero, mostrando operador dominante y volumen.
 */

import { useState } from "react";
import { ChevronRight, ChevronDown, AlertTriangle } from "lucide-react";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/Badge";
import type { RankingMarcaM3 } from "@/lib/logistica/log-rankings";

export function MarcasCriticasCollapse({
  marcas,
  totalVehiculosAfectados,
}: {
  marcas: RankingMarcaM3[];
  totalVehiculosAfectados: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="surface bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-[--color-bg-elev-1]/50 transition"
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="size-4 text-[--color-fg-muted]" />
          ) : (
            <ChevronRight className="size-4 text-[--color-fg-muted]" />
          )}
          <AlertTriangle className="size-4 text-[--color-warning]" />
          <span className="text-[13.5px] font-semibold text-[--color-fg]">
            Marcas críticas
          </span>
          <span className="text-[11px] text-[--color-fg-muted]">
            · <b className="text-[--color-fg]">{fmtNum(marcas.length)}</b> marca
            {marcas.length === 1 ? "" : "s"} bajo el SLA
            {totalVehiculosAfectados > 0 && (
              <>
                {" · "}
                <b className="text-[--color-fg]">
                  {fmtNum(totalVehiculosAfectados)}
                </b>{" "}
                vehículo{totalVehiculosAfectados === 1 ? "" : "s"} afectado
                {totalVehiculosAfectados === 1 ? "" : "s"}
              </>
            )}
          </span>
        </div>
      </button>
      {open && (
        <div className="border-t border-[--color-border] overflow-x-auto">
          <table className="w-full text-[12.5px] min-w-[560px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-[0.05em] text-[--color-fg-muted] bg-[--color-bg-elev-1]">
                <th className="px-3 py-2 font-semibold">Marca</th>
                <th className="px-3 py-2 font-semibold">Operador dominante</th>
                <th className="px-3 py-2 font-semibold text-right">% Cumpl.</th>
                <th className="px-3 py-2 font-semibold text-right">Cumplidos / N</th>
              </tr>
            </thead>
            <tbody>
              {marcas.map((r, i) => (
                <tr
                  key={r.marca}
                  className={cn(
                    "border-b border-[--color-border-soft]",
                    i % 2 === 0 ? "bg-white" : "bg-[--color-bg-elev-1]/30",
                  )}
                >
                  <td className="px-3 py-2 font-semibold text-[--color-fg]">
                    {r.marca}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      tone={r.operadorDominante === "MIXTO" ? "muted" : "info"}
                      size="xs"
                    >
                      {r.operadorDominante}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right mono text-[--color-danger] font-bold">
                    {r.pct.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right mono text-[--color-fg-muted]">
                    {fmtNum(r.cumplidos)} / {fmtNum(r.total)}
                  </td>
                </tr>
              ))}
              {marcas.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-[12px] text-[--color-fg-muted]">
                    Sin marcas bajo el SLA en el período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
