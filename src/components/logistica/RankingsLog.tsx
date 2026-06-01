"use client";

/**
 * Rankings · sucursales con peor M1 + colapsable, integrado en page.
 */

import { useState } from "react";
import { ChevronRight, ChevronDown, Trophy } from "lucide-react";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { RankingSucursalM1 } from "@/lib/logistica/log-rankings";

export function RankingsLog({
  sucursales,
}: {
  sucursales: RankingSucursalM1[];
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
          <Trophy className="size-4 text-[--color-accent]" />
          <span className="text-[13.5px] font-semibold text-[--color-fg]">
            Top sucursales · peor M1 (Almacén → Solicitud)
          </span>
          <span className="text-[11px] text-[--color-fg-muted]">
            · {fmtNum(sucursales.length)} con N ≥ 5
          </span>
        </div>
      </button>
      {open && (
        <div className="border-t border-[--color-border] overflow-x-auto">
          <table className="w-full text-[12.5px] min-w-[640px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-[0.05em] text-[--color-fg-muted] bg-[--color-bg-elev-1]">
                <th className="px-3 py-2 font-semibold">#</th>
                <th className="px-3 py-2 font-semibold">Sucursal</th>
                <th className="px-3 py-2 font-semibold text-right">N M1</th>
                <th className="px-3 py-2 font-semibold text-right">Mediana</th>
                <th className="px-3 py-2 font-semibold text-right">Avg</th>
                <th className="px-3 py-2 font-semibold text-right">P90</th>
                <th className="px-3 py-2 font-semibold text-right">VINs sucursal</th>
              </tr>
            </thead>
            <tbody>
              {sucursales.map((r, i) => (
                <tr
                  key={r.sucursal}
                  className={cn(
                    "border-b border-[--color-border-soft]",
                    i % 2 === 0 ? "bg-white" : "bg-[--color-bg-elev-1]/30",
                  )}
                >
                  <td className="px-3 py-2 text-[--color-fg-muted] mono">
                    {i + 1}
                  </td>
                  <td className="px-3 py-2 font-semibold text-[--color-fg]">
                    {r.sucursal}
                  </td>
                  <td className="px-3 py-2 text-right mono text-[--color-fg-muted]">
                    {fmtNum(r.stats.n)}
                  </td>
                  <td className="px-3 py-2 text-right mono text-[--color-danger] font-bold">
                    {r.stats.mediana != null ? `${r.stats.mediana.toFixed(1)} d` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right mono text-[--color-fg-muted]">
                    {r.stats.avg != null ? `${r.stats.avg.toFixed(1)} d` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right mono text-[--color-fg-muted]">
                    {r.stats.p90 != null ? `${r.stats.p90.toFixed(0)} d` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right mono text-[--color-fg-muted]">
                    {fmtNum(r.totalVins)}
                  </td>
                </tr>
              ))}
              {sucursales.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-[12px] text-[--color-fg-muted]">
                    Sin sucursales con N ≥ 5 para rankear.
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
