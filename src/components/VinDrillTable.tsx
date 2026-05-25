/**
 * Tabla de VINs reutilizable con gestión inline por VIN.
 *
 * COMPARTIDA entre módulos (Capital pagado, Caja desembolsada, etc.). La
 * gestión que se edita aquí vive en `useGestionStore` por VIN, así que es
 * la misma que aparece en el Dashboard, Centro de Acción, FNE, etc.
 *
 * La celda de aging explica los casos límite: 0 días = recién ingresado,
 * sin fecha = pendiente de clasificación (no se muestra un "0d" pelado que
 * parezca error).
 */

"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { fmtCLP, fmtNum } from "@/lib/format";
import { AbrirCasoButton } from "@/components/AbrirCasoButton";
import { BotonesCasoPuente } from "@/components/BotonesCasoPuente";
import { limpiarVIN } from "@/lib/parser/venta-apc";
import { indexarFNEPorOrigen } from "@/lib/selectors/vu-en-fne";
import { useExcelStore } from "@/lib/store";
import { NATURALEZA_LABEL, NATURALEZA_TONE } from "@/lib/selectors/capital-taxonomia";
import type { Vehiculo } from "@/lib/types";

/** Celda de aging con explicación de casos límite. */
function AgingCell({ dias }: { dias: number | null }) {
  if (dias == null) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-[--color-bg-elev-3] text-[--color-fg-dim]">
        Sin fecha
      </span>
    );
  }
  if (dias === 0) {
    return (
      <span className="text-[11.5px] text-[--color-fg-muted]">
        <span className="mono text-[--color-fg]">0d</span> · recién ingresado
      </span>
    );
  }
  const color =
    dias >= 180
      ? "text-[--color-danger]"
      : dias >= 60
        ? "text-[--color-warning]"
        : "text-[--color-fg]";
  return <span className={cn("mono text-[12.5px]", color)}>{dias}d</span>;
}

export function VinDrillTable({
  vins,
  verTodosHref,
  max = 100,
  origen = "Capital de trabajo",
}: {
  vins: Vehiculo[];
  verTodosHref?: string;
  max?: number;
  /** Etiqueta de origen para el caso operacional (de qué módulo se abrió). */
  origen?: string;
}) {
  // Capital puente: la fila abre la operación nueva originadora, no el VU/BU.
  const fne = useExcelStore((s) => s.fne);
  const fneIndex = useMemo(() => indexarFNEPorOrigen(fne?.registros ?? []), [fne]);

  if (vins.length === 0) {
    return (
      <div className="px-5 py-8 text-center text-[12.5px] text-[--color-fg-muted]">
        Sin vehículos en este grupo.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[820px]">
        <thead className="text-[10.5px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1]">
          <tr>
            <th className="text-left font-semibold px-4 py-2.5">Marca / Modelo</th>
            <th className="text-left font-semibold px-4 py-2.5">VIN</th>
            <th className="text-left font-semibold px-4 py-2.5">Sucursal</th>
            <th className="text-left font-semibold px-4 py-2.5">Aging</th>
            <th className="text-right font-semibold px-4 py-2.5">Capital</th>
            <th className="text-left font-semibold px-4 py-2.5">Tipo</th>
            <th className="text-left font-semibold px-4 py-2.5">Gestión</th>
          </tr>
        </thead>
        <tbody>
          {vins.slice(0, max).map((v, idx) => (
            <tr
              key={`${v.vin}-${v.rowIndex}`}
              className={cn(
                "border-b border-[--color-border-soft]",
                idx % 2 === 0
                  ? "bg-white hover:bg-[--color-bg-elev-1]"
                  : "bg-[--color-bg-elev-1]/40",
              )}
            >
              <td className="px-4 py-2.5">
                <div className="font-medium text-[12.5px] text-[--color-fg]">
                  {v.marca || v.marcaPompeyo || "—"}
                </div>
                <div className="text-[11px] text-[--color-fg-muted] truncate max-w-[220px]">
                  {[v.modelo, v.version].filter(Boolean).join(" · ")}
                </div>
              </td>
              <td className="px-4 py-2.5 mono text-[11px] text-[--color-fg-muted]">{v.vin}</td>
              <td className="px-4 py-2.5 text-[12px] text-[--color-fg-muted]">
                {v.sucursal ?? "—"}
              </td>
              <td className="px-4 py-2.5">
                <AgingCell dias={v.diasStock} />
              </td>
              <td className="px-4 py-2.5 text-right mono text-[12.5px] text-[--color-fg]">
                {fmtCLP(v.costoNeto)}
              </td>
              <td className="px-4 py-2.5">
                <Badge tone={NATURALEZA_TONE[v.naturalezaCapital]} size="xs">
                  {NATURALEZA_LABEL[v.naturalezaCapital]}
                </Badge>
              </td>
              <td className="px-4 py-2.5">
                {v.esVPPComprometido || v.naturalezaCapital === "puente" ? (
                  <BotonesCasoPuente usado={v} fneIndex={fneIndex} />
                ) : (
                  <AbrirCasoButton vin={limpiarVIN(v.vin)} origen={origen} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {vins.length > max && (
        <div className="px-4 py-3 text-[11.5px] text-[--color-fg-muted] border-t border-[--color-border-soft] bg-[--color-bg-elev-1]">
          Mostrando primeros {fmtNum(max)} de {fmtNum(vins.length)}
          {verTodosHref && (
            <>
              {" "}·{" "}
              <Link href={verTodosHref} className="text-[--color-accent] hover:underline">
                ver todos en el explorador
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
