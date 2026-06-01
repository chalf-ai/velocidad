"use client";

/**
 * Cola gestionable del módulo Logística.
 *
 * Reutiliza AbrirCasoButton (regla R1: VIN abre FichaOperacionalVIN). Cero
 * UI nueva de gestión.
 *
 * Las columnas se adaptan al contexto:
 *   · Motores (M1/M2/M3) → muestran aging del tramo correspondiente.
 *   · Stock crítico → muestran días desde fIngresoApc / fSolicitudBodega.
 *
 * Zebra striping consistente con el resto del sistema.
 */

import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import { AbrirCasoButton } from "@/components/AbrirCasoButton";
import { limpiarVIN } from "@/lib/parser/venta-apc";
import type { LogisticaOperacionVIN } from "@/lib/logistica/modelo";

const MS_DIA = 86_400_000;
const MAX_FILAS = 100;

export type ContextoCola =
  | { tipo: "motor"; tramo: "m1" | "m2" | "m3" }
  | { tipo: "stock"; ref: "ingreso" | "solicitud" };

export function ColaGestionableLog({
  titulo,
  subtitulo,
  filas,
  origen,
  contexto,
  hoy = new Date(),
}: {
  titulo: string;
  subtitulo?: string;
  filas: LogisticaOperacionVIN[];
  origen: string;
  contexto: ContextoCola;
  hoy?: Date;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div ref={ref} className="surface bg-white overflow-hidden">
      <div className="px-5 py-3 border-b border-[--color-border] flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[13.5px] font-semibold tracking-tight text-[--color-fg]">
            {titulo}
          </div>
          {subtitulo && (
            <div className="text-[11px] text-[--color-fg-muted] mt-0.5">
              {subtitulo}
            </div>
          )}
        </div>
        <div className="text-[12px] text-[--color-fg-muted]">
          <b className="text-[--color-fg]">{fmtNum(filas.length)}</b> VIN
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[760px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-[0.05em] text-[--color-fg-muted] bg-[--color-bg-elev-1]">
              <th className="px-3 py-2 font-semibold">Marca / Modelo</th>
              <th className="px-3 py-2 font-semibold">VIN</th>
              <th className="px-3 py-2 font-semibold">Sucursal destino</th>
              <th className="px-3 py-2 font-semibold">Operador</th>
              <th className="px-3 py-2 font-semibold text-right">
                {contexto.tipo === "motor"
                  ? "Días tramo"
                  : "Días en estado"}
              </th>
              <th className="px-3 py-2 font-semibold">Gestión</th>
            </tr>
          </thead>
          <tbody>
            {filas.slice(0, MAX_FILAS).map((op, i) => {
              const dias = diasContexto(op, contexto, hoy);
              return (
                <tr
                  key={op.vin}
                  className={cn(
                    "border-b border-[--color-border-soft] transition",
                    i % 2 === 0
                      ? "bg-white hover:bg-[--color-bg-elev-1]/60"
                      : "bg-[--color-bg-elev-1]/30 hover:bg-[--color-bg-elev-1]/70",
                  )}
                >
                  <td className="px-3 py-2">
                    <div className="font-semibold text-[--color-fg]">
                      {op.marca ?? "—"}
                    </div>
                    <div className="text-[10.5px] text-[--color-fg-muted] truncate max-w-[200px]">
                      {op.modelo ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 mono text-[11px] text-[--color-fg-muted] whitespace-nowrap">
                    {op.vin}
                  </td>
                  <td className="px-3 py-2 text-[11.5px] text-[--color-fg-muted] truncate max-w-[180px]">
                    {op.sucursalDestino ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {op.bodegaOrigen ? (
                      <Badge tone={op.bodegaOrigen === "KAR" ? "info" : "accent"} size="xs">
                        {op.bodegaOrigen}
                      </Badge>
                    ) : (
                      <span className="text-[10.5px] text-[--color-fg-dim]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <AgingBadge dias={dias} />
                  </td>
                  <td className="px-3 py-2">
                    <AbrirCasoButton vin={limpiarVIN(op.vin)} origen={origen} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filas.length > MAX_FILAS && (
        <div className="px-5 py-2 text-[11px] text-[--color-fg-dim] italic border-t border-[--color-border]">
          Mostrando primeros {fmtNum(MAX_FILAS)} de {fmtNum(filas.length)} casos · usa los filtros globales para acotar.
        </div>
      )}
      {filas.length === 0 && (
        <div className="px-5 py-6 text-center text-[12.5px] text-[--color-fg-muted]">
          Sin casos en esta cola.
        </div>
      )}
    </div>
  );
}

function diasContexto(
  op: LogisticaOperacionVIN,
  ctx: ContextoCola,
  hoy: Date,
): number | null {
  if (ctx.tipo === "motor") {
    if (ctx.tramo === "m1" && op.fIngresoApc && op.fSolicitudBodega) {
      return Math.round((op.fSolicitudBodega.getTime() - op.fIngresoApc.getTime()) / MS_DIA);
    }
    if (ctx.tramo === "m2" && op.fSolicitudBodega && op.fDespacho) {
      return Math.round((op.fDespacho.getTime() - op.fSolicitudBodega.getTime()) / MS_DIA);
    }
    if (ctx.tramo === "m3") {
      // Para M3 mostramos el tramo M2 como contexto (despachos ya cerrados).
      if (op.fSolicitudBodega && op.fDespacho) {
        return Math.round((op.fDespacho.getTime() - op.fSolicitudBodega.getTime()) / MS_DIA);
      }
    }
    return null;
  }
  // stock
  const ref =
    ctx.ref === "ingreso" ? op.fIngresoApc : op.fSolicitudBodega;
  if (!(ref instanceof Date)) return null;
  return Math.round((hoy.getTime() - ref.getTime()) / MS_DIA);
}

function AgingBadge({ dias }: { dias: number | null }) {
  if (dias == null) {
    return <Badge tone="muted" size="xs">—</Badge>;
  }
  const tone =
    dias >= 60 ? "danger" : dias >= 30 ? "warning" : dias >= 0 ? "muted" : "muted";
  return (
    <Badge tone={tone} size="xs">
      {dias}d
    </Badge>
  );
}
