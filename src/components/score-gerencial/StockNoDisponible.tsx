"use client";

/**
 * Stock No Disponible — universo `stockAB = "B"` reclasificado por causa.
 *
 * La auditoría 2026-06 demostró que el flag oficial Stock A/B="B" NO es "Stock
 * B comercial": mezcla CPD, traspaso, resciliación, seguros, taller, donantes
 * y Stock B real. Por eso queda FUERA del score de Stock Propio y se gestiona
 * acá, desglosado por Estado Dealer. Judicial (stockAB="Judicial") se muestra
 * en sección separada. Fuente: Vehiculo crudo de Base_Stock.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, PackageX } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtCLPCompact, fmtNum } from "@/lib/format";
import type { Vehiculo } from "@/lib/types";
import {
  CAUSAS_STOCK_NO_DISPONIBLE,
  causaStockNoDisponible,
  type CausaStockNoDisponible,
} from "@/lib/selectors/stock-no-disponible";

const sumCosto = (vs: Vehiculo[]) => vs.reduce((s, v) => s + (v.costoNeto ?? 0), 0);

function statsDias(vs: Vehiculo[]) {
  const d = vs.map((v) => v.diasStock).filter((x): x is number => x != null).sort((a, b) => a - b);
  if (d.length === 0) return { prom: 0, mediana: 0, max: 0 };
  return {
    prom: Math.round(d.reduce((s, x) => s + x, 0) / d.length),
    mediana: d[Math.floor(d.length / 2)],
    max: d[d.length - 1],
  };
}

/** Orden de tabla: días desc, luego costo neto desc. */
function ordenar(vs: Vehiculo[]): Vehiculo[] {
  return [...vs].sort(
    (a, b) => (b.diasStock ?? -1) - (a.diasStock ?? -1) || (b.costoNeto ?? 0) - (a.costoNeto ?? 0),
  );
}

function TablaVIN({ vs }: { vs: Vehiculo[] }) {
  return (
    <div className="overflow-x-auto mt-2">
      <table className="w-full text-[11px]">
        <thead className="text-[9.5px] uppercase tracking-wide text-[--color-fg-muted]">
          <tr className="border-b border-[--color-border]">
            <th className="text-left py-1 font-semibold">VIN</th>
            <th className="text-left py-1 font-semibold">Marca · Modelo</th>
            <th className="text-left py-1 font-semibold">Bodega</th>
            <th className="text-left py-1 font-semibold">Estado Dealer</th>
            <th className="text-left py-1 font-semibold">Condición</th>
            <th className="text-left py-1 font-semibold">Tipo</th>
            <th className="text-right py-1 font-semibold">Días</th>
            <th className="text-right py-1 font-semibold">Costo neto</th>
            <th className="text-left py-1 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[--color-border-soft]">
          {ordenar(vs).map((v, i) => (
            <tr key={`${v.vin}-${i}`} className="hover:bg-[--color-bg-elev-1]">
              <td className="py-1 mono whitespace-nowrap">{v.vin}</td>
              <td className="py-1">
                <span className="font-medium">{v.marcaPompeyo ?? v.marca ?? "—"}</span>
                {v.modelo && <span className="text-[--color-fg-muted]"> · {v.modelo}</span>}
              </td>
              <td className="py-1 text-[--color-fg-muted] truncate max-w-[150px]">{v.bodega ?? "—"}</td>
              <td className="py-1 text-[--color-fg-muted]">{v.estadoDealer ?? "—"}</td>
              <td className="py-1 text-[--color-fg-muted]">{v.condicionDeStock ?? "—"}</td>
              <td className="py-1 text-[--color-fg-muted]">{v.tipoStock}</td>
              <td className="py-1 text-right tabular-nums">{v.diasStock ?? "—"}</td>
              <td className="py-1 text-right mono">{fmtCLPCompact(v.costoNeto ?? 0)}</td>
              <td className="py-1 text-[--color-fg-muted]">{v.statusStock ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FilaCausa({ causa, vs, total }: { causa: string; vs: Vehiculo[]; total: number }) {
  const [abierto, setAbierto] = useState(false);
  const { prom, mediana, max } = statsDias(vs);
  return (
    <div className="border-t border-[--color-border-soft] py-2">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="w-full flex items-center gap-2 text-left"
      >
        {abierto ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
        <span className="text-[12.5px] font-semibold text-[--color-fg] min-w-[150px]">{causa}</span>
        <span className="text-[11.5px] text-[--color-fg-muted] flex-1">
          {fmtNum(vs.length)} u · {fmtCLPCompact(sumCosto(vs))} · días prom {prom} / med {mediana} / máx {max}
        </span>
        <span className="text-[11px] mono text-[--color-fg-dim]">
          {total > 0 ? ((vs.length / total) * 100).toFixed(1) : 0}%
        </span>
      </button>
      {abierto && <TablaVIN vs={vs} />}
    </div>
  );
}

export function StockNoDisponible({
  unidadesB,
  judiciales,
}: {
  /** Vehiculos con stockAB = "B" (universo Stock No Disponible). */
  unidadesB: Vehiculo[];
  /** Vehiculos con stockAB = "Judicial". */
  judiciales: Vehiculo[];
}) {
  const [abierto, setAbierto] = useState(false);
  const total = unidadesB.length;
  if (total === 0 && judiciales.length === 0) return null;

  const porCausa = new Map<CausaStockNoDisponible, Vehiculo[]>();
  for (const v of unidadesB) {
    const c = causaStockNoDisponible(v.estadoDealer);
    if (!porCausa.has(c)) porCausa.set(c, []);
    porCausa.get(c)!.push(v);
  }
  const stockBReal = porCausa.get("Stock B real")?.length ?? 0;

  return (
    <div className="surface bg-white px-5 py-3">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2 flex-wrap">
          <PackageX className="size-3.5 text-[--color-warning]" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[--color-fg-muted]">
            Stock No Disponible
          </span>
          <span className="text-[11px] text-[--color-fg-muted]">
            {fmtNum(total)} u · Stock B real {stockBReal} · Judicial {fmtNum(judiciales.length)} (aparte)
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
          <p className="text-[11px] text-[--color-fg-dim] mt-2 leading-snug">
            <b>Unidades marcadas como B en el Excel, reclasificadas por causa operacional.</b>{" "}
            La auditoría detectó que este flag no representa sólo Stock B comercial, sino un
            conjunto de estados operativos: CPD, traspaso, resciliación, seguros, taller, donantes
            y Stock B real. Por eso se muestra separado del score y desglosado por causa.
          </p>

          <div className="mt-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[--color-fg-muted]">
              Stock No Disponible · {fmtNum(total)} u · {fmtCLPCompact(sumCosto(unidadesB))}
            </div>
            {CAUSAS_STOCK_NO_DISPONIBLE.filter((c) => (porCausa.get(c)?.length ?? 0) > 0).map((c) => (
              <FilaCausa key={c} causa={c} vs={porCausa.get(c)!} total={total} />
            ))}
          </div>

          {judiciales.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[--color-danger]">
                Judicial · {fmtNum(judiciales.length)} u · {fmtCLPCompact(sumCosto(judiciales))} — fuera del score
              </div>
              <TablaVIN vs={judiciales} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
