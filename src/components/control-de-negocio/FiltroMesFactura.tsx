"use client";

/**
 * Filtro principal del módulo · Mes de factura + headline + línea ancla.
 *
 * V2: ya no es sólo un selector. Es el bloque ancla del mes:
 *   · Selector de mes (izquierda)
 *   · Headline grande "{N} facturas emitidas en {MES}" (derecha)
 *   · Línea ancla discreta con stats del período (abajo del headline)
 *
 * Los props de stats son OPCIONALES — si no llegan, render compacto v1.
 */

import { Calendar } from "lucide-react";
import { fmtNum, fmtCLPCompact } from "@/lib/format";
import type {
  MesFacturaKey,
  MesFacturaOption,
} from "@/lib/control-de-negocio/cn-universo";

export interface AnclaStats {
  entregados: number;
  sinEntregaReal: number;
  capitalRetenidoFNE: number;
  medianaFacEntrega: number | null;
}

export function FiltroMesFactura({
  opciones,
  valor,
  onChange,
  mesLabel,
  facturados,
  stats,
}: {
  opciones: MesFacturaOption[];
  valor: MesFacturaKey | null;
  onChange: (v: MesFacturaKey | null) => void;
  /** Label legible del mes activo (ej. "Mayo 2026"). */
  mesLabel: string;
  /** Cantidad de facturados retail nuevos en el período. */
  facturados: number;
  /** Stats opcionales para la línea ancla debajo del headline. */
  stats?: AnclaStats;
}) {
  return (
    <div className="surface bg-white px-5 py-4 top-strip strip-accent">
      <div className="flex items-start gap-4 flex-wrap">
        {/* Selector — izquierda */}
        <div className="flex items-start gap-2.5 shrink-0">
          <Calendar
            className="size-5 text-[--color-accent] mt-0.5"
            strokeWidth={1.75}
          />
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[--color-fg-muted]">
              Mes de factura
            </div>
            <div className="text-[11px] text-[--color-fg-dim] mt-0.5 mb-2">
              Retail nuevos con factura emitida
            </div>
            <select
              value={valor ?? ""}
              onChange={(e) =>
                onChange(e.target.value === "" ? null : e.target.value)
              }
              className="text-[13px] font-semibold tracking-tight rounded-md border border-[--color-accent]/40 bg-[--color-accent]/[0.06] text-[--color-fg] px-3 py-1.5 focus:border-[--color-accent] outline-none min-w-[200px]"
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

        {/* Headline + ancla — derecha */}
        <div className="ml-auto text-right min-w-0">
          <div className="text-[32px] font-bold tracking-tight text-[--color-fg] leading-tight">
            {fmtNum(facturados)}{" "}
            <span className="text-[18px] font-semibold text-[--color-fg-muted]">
              facturas emitidas
            </span>
          </div>
          <div className="text-[12.5px] text-[--color-fg-muted] mt-0.5">
            en {mesLabel}
          </div>
          {stats && (
            <div className="text-[11.5px] text-[--color-fg-muted] mt-2 flex items-center justify-end gap-2 flex-wrap">
              <span>
                <b className="text-[--color-ok]">{fmtNum(stats.entregados)}</b>{" "}
                entregadas
              </span>
              <span className="text-[--color-fg-dim]">·</span>
              <span>
                <b className="text-[--color-danger]">
                  {fmtNum(stats.sinEntregaReal)}
                </b>{" "}
                sin entrega real
              </span>
              <span className="text-[--color-fg-dim]">·</span>
              <span>
                <b className="text-[--color-danger]">
                  {fmtCLPCompact(stats.capitalRetenidoFNE)}
                </b>{" "}
                retenidos
              </span>
              <span className="text-[--color-fg-dim]">·</span>
              <span>
                mediana{" "}
                <b className="text-[--color-fg]">
                  {stats.medianaFacEntrega != null
                    ? `${stats.medianaFacEntrega.toFixed(1)}d`
                    : "—"}
                </b>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
