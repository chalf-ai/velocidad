"use client";

/**
 * Selector principal de MES DE FACTURA para /velocidad-operacional.
 *
 * Visual destacado (no chip pequeño). Filtra todo el módulo. Default = último
 * mes disponible. "Todos los meses" deshace el filtro (universo completo).
 */

import { Calendar } from "lucide-react";
import { fmtNum } from "@/lib/format";
import type { MesFacturaOption, MesFacturaKey } from "@/lib/historico/vista-derivados";

export function MesFacturaSelect({
  opciones,
  valor,
  onChange,
}: {
  opciones: MesFacturaOption[];
  valor: MesFacturaKey | null;
  onChange: (v: MesFacturaKey | null) => void;
}) {
  const seleccionada = opciones.find((o) => o.key === valor) ?? null;
  return (
    <div className="surface bg-white px-5 py-4 top-strip strip-accent flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2.5 shrink-0">
        <Calendar className="size-5 text-[--color-accent]" strokeWidth={1.75} />
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[--color-fg-muted]">
            Mes de factura
          </div>
          <div className="text-[11.5px] text-[--color-fg-dim] mt-0.5">
            Universo base: autos con factura emitida en el mes
          </div>
        </div>
      </div>
      <div className="ml-auto flex items-center gap-3">
        {seleccionada && (
          <span className="text-[11.5px] text-[--color-fg-muted]">
            {fmtNum(seleccionada.count)} facturados en el mes
          </span>
        )}
        <select
          value={valor ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          className="text-[14px] font-semibold tracking-tight rounded-md border border-[--color-accent]/40 bg-[--color-accent]/[0.06] text-[--color-fg] px-3 py-2 focus:border-[--color-accent] outline-none min-w-[180px]"
        >
          <option value="">Todos los meses</option>
          {opciones.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label} · {fmtNum(o.count)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
