"use client";

/**
 * Detalle de auditoría · Stock B y Judicial.
 *
 * Inventario que Control de Gestión EXCLUYE del numerador del Score (Stock
 * Propio), pero que NO se oculta: se muestra acá para trazabilidad. Fuente
 * OFICIAL = columna "Stock A/B" de Base_Stock (`stockAB`), no el heurístico
 * `esStockB`. Bloque separado, no mezclado con el score.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtCLPCompact, fmtNum } from "@/lib/format";
import type { VehiculoUnificado } from "@/lib/selectors/vehiculo-unificado";

function sumCosto(vus: VehiculoUnificado[]): number {
  return vus.reduce((s, v) => s + (v.costoNeto ?? 0), 0);
}

function Tabla({ titulo, vus, tone }: { titulo: string; vus: VehiculoUnificado[]; tone: string }) {
  if (vus.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className={cn("text-[12px] font-semibold", tone)}>{titulo}</span>
        <span className="text-[11px] text-[--color-fg-muted]">
          {fmtNum(vus.length)} u · {fmtCLPCompact(sumCosto(vus))}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11.5px]">
          <thead className="text-[10px] uppercase tracking-wide text-[--color-fg-muted]">
            <tr className="border-b border-[--color-border]">
              <th className="text-left py-1.5 font-semibold">VIN</th>
              <th className="text-left py-1.5 font-semibold">Marca · Modelo</th>
              <th className="text-left py-1.5 font-semibold">Sucursal</th>
              <th className="text-right py-1.5 font-semibold">Días</th>
              <th className="text-left py-1.5 font-semibold">Condición</th>
              <th className="text-left py-1.5 font-semibold">Tipo stock</th>
              <th className="text-left py-1.5 font-semibold">Stock A/B</th>
              <th className="text-right py-1.5 font-semibold">Costo neto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[--color-border-soft]">
            {vus.map((v) => (
              <tr key={v.vinLimpio} className="hover:bg-[--color-bg-elev-1]">
                <td className="py-1.5 mono whitespace-nowrap">{v.vinLimpio}</td>
                <td className="py-1.5">
                  <span className="font-medium">{v.marca ?? "—"}</span>
                  {v.modelo && <span className="text-[--color-fg-muted]"> · {v.modelo}</span>}
                </td>
                <td className="py-1.5 text-[--color-fg-muted] truncate max-w-[160px]">
                  {v.sucursal ?? "—"}
                </td>
                <td className="py-1.5 text-right tabular-nums">{v.diasStock ?? "—"}</td>
                <td className="py-1.5 text-[--color-fg-muted]">{v.condicionDeStock ?? "—"}</td>
                <td className="py-1.5 text-[--color-fg-muted]">{v.tipoStock ?? "—"}</td>
                <td className="py-1.5">{v.stockAB ?? "—"}</td>
                <td className="py-1.5 text-right mono">{fmtCLPCompact(v.costoNeto ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AuditoriaStockBJudicial({
  stockB,
  judicial,
}: {
  stockB: VehiculoUnificado[];
  judicial: VehiculoUnificado[];
}) {
  const [abierto, setAbierto] = useState(false);
  const total = stockB.length + judicial.length;
  if (total === 0) return null;

  return (
    <div className="surface bg-white px-5 py-3">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2">
          <ShieldAlert className="size-3.5 text-[--color-warning]" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[--color-fg-muted]">
            Auditoría · Stock B y Judicial — fuera del score
          </span>
          <span className="text-[11px] text-[--color-fg-muted]">
            {fmtNum(stockB.length)} Stock B · {fmtNum(judicial.length)} Judicial
          </span>
        </span>
        {abierto ? (
          <ChevronDown className="size-4 text-[--color-fg-muted]" />
        ) : (
          <ChevronRight className="size-4 text-[--color-fg-muted]" />
        )}
      </button>
      {abierto && (
        <>
          <p className="text-[10.5px] text-[--color-fg-dim] mt-2 leading-snug">
            Inventario que Control de Gestión excluye del numerador de Stock Propio. Fuente
            oficial: columna Stock A/B de Base_Stock. No alimenta el score; se muestra para
            trazabilidad.
          </p>
          <Tabla titulo="Stock B" vus={stockB} tone="text-[--color-warning]" />
          <Tabla titulo="Judicial" vus={judicial} tone="text-[--color-danger]" />
        </>
      )}
    </div>
  );
}
