"use client";

/**
 * Banner protagonista · "¿Cuánto estamos tardando en entregar?"
 *
 * Pregunta operacional directa: sobre los autos que se ENTREGARON en el
 * período activo, ¿cuánto pasó entre la factura y la entrega real?
 *
 * Ventana de cálculo crítica: filtra por `fEntregaReal`, no por
 * `fFactura`. Eso significa que un auto facturado en abril y entregado
 * en mayo CUENTA en el período "mayo" — porque el departamento lo
 * cerró en mayo. Esto evita el sesgo del filtro tradicional por mes de
 * factura, que penaliza al mes en curso (sus autos siguen abiertos) y
 * premia a los meses pasados (ya están todos cerrados).
 *
 * Banner verde acento porque es la métrica principal del módulo en V2.5.
 */

import { Truck, Clock } from "lucide-react";
import { fmtNum, fmtCLPCompact } from "@/lib/format";

export interface TiempoEntregaStats {
  /** Cantidad de autos entregados en el período (denominador del promedio). */
  entregados: number;
  /** Promedio de días Factura → Entrega Real, sobre `entregados`. null si 0. */
  promedio: number | null;
  /** Mediana de días Factura → Entrega Real. null si 0. */
  mediana: number | null;
  /** Mejor caso del período (mínimo días). null si 0. */
  mejor: number | null;
  /** Peor caso del período (máximo días). null si 0. */
  peor: number | null;
  /** De los entregados, cuántos fueron facturados en el último mes del período (default 0). */
  arrastreFacturasPrevias: number;
  /** Suma del valor factura de los entregados (para escala del flujo cerrado). */
  valorFacturado: number;
}

export function TiempoEntregaBanner({
  labelPeriodo,
  stats,
}: {
  /** Label del período activo (ej. "Mayo 2026" o "Mayo 2026 → Marzo 2026 · 3 meses"). */
  labelPeriodo: string;
  stats: TiempoEntregaStats;
}) {
  const sinDatos = stats.entregados === 0 || stats.promedio == null;

  return (
    <div
      className="rounded-2xl shadow-md border border-[--color-ok]/30 overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, #E6F4EA 0%, #F0FAF3 55%, #FFFFFF 100%)",
      }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-5 px-6 py-5 items-center">
        {/* IZQ · pregunta + número grande */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[--color-ok]">
            <Truck className="size-3.5" strokeWidth={2} />
            Tiempo de entrega · {labelPeriodo}
          </div>
          <div className="text-[15px] font-semibold text-[--color-fg] tracking-tight mt-1.5">
            ¿Cuánto estamos tardando en entregar los autos?
          </div>
          <div className="text-[11.5px] text-[--color-fg-muted] mt-0.5">
            Promedio Factura → Entrega Real · ventana por fecha de entrega
            {stats.arrastreFacturasPrevias > 0 && (
              <>
                {" "}
                · incluye{" "}
                <b className="text-[--color-fg]">
                  {fmtNum(stats.arrastreFacturasPrevias)}
                </b>{" "}
                facturado{stats.arrastreFacturasPrevias === 1 ? "" : "s"} antes
                del período
              </>
            )}
          </div>

          {sinDatos ? (
            <div className="mt-4 flex items-center gap-2 text-[--color-fg-muted] text-[13px]">
              <Clock className="size-4" strokeWidth={1.75} />
              Sin entregas reales en el período seleccionado.
            </div>
          ) : (
            <div className="mt-3 flex items-baseline gap-3 flex-wrap">
              <span className="text-[72px] font-bold tracking-tight leading-none mono text-[--color-ok]">
                {stats.promedio!.toFixed(1)}
              </span>
              <span className="text-[22px] font-semibold text-[--color-fg]">
                días promedio
              </span>
              <span className="text-[12px] text-[--color-fg-muted] ml-1">
                · entre que se emite la factura y el auto sale al cliente
              </span>
            </div>
          )}
        </div>

        {/* DER · mini-stats */}
        {!sinDatos && (
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-2 lg:gap-1.5 min-w-[200px]">
            <MiniStat
              label="Entregas en el período"
              value={fmtNum(stats.entregados)}
              hint={fmtCLPCompact(stats.valorFacturado)}
            />
            <MiniStat
              label="Mediana"
              value={
                stats.mediana != null ? `${stats.mediana.toFixed(1)} d` : "—"
              }
            />
            <MiniStat
              label="Mejor caso"
              value={stats.mejor != null ? `${stats.mejor.toFixed(0)} d` : "—"}
            />
            <MiniStat
              label="Peor caso"
              value={stats.peor != null ? `${stats.peor.toFixed(0)} d` : "—"}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-white/95 rounded-md px-3 py-1.5 shadow-sm border border-[--color-ok]/15">
      <div className="text-[9.5px] uppercase tracking-[0.08em] text-[--color-fg-muted] font-semibold">
        {label}
      </div>
      <div className="text-[15px] font-bold mono tracking-tight text-[--color-fg] leading-none mt-0.5">
        {value}
      </div>
      {hint && (
        <div className="text-[10px] text-[--color-fg-dim] mt-0.5">{hint}</div>
      )}
    </div>
  );
}
