"use client";

/**
 * Filtro principal del módulo · Mes de Compra Marca + headline + ancla.
 *
 * Paralelo a FiltroMesFactura de CN. Diferencia conceptual: aquí "Mes" es
 * cuando la marca asignó el vehículo (entrada al sistema logístico), no
 * cuando se facturó.
 */

import { Calendar } from "lucide-react";
import { fmtNum, fmtPct } from "@/lib/format";
import type {
  MesCompraMarcaKey,
  MesCompraMarcaOption,
} from "@/lib/logistica/log-universo";

export interface AnclaLogStats {
  /** VINs con fIngresoApc pero sin fDespacho. */
  enBodegaOperador: number;
  /** VINs con fDespacho. */
  despachados: number;
  /** Cumplimiento global (% CUMPLIDO / total con declaración). null si 0 declarados. */
  cumplimientoPct: number | null;
  /** VINs con aging crítico (>60d) en alguna de las dos familias. */
  stockCritico: number;
}

export function FiltroMesCompraMarca({
  opciones,
  valor,
  onChange,
  mesLabel,
  totalVehiculos,
  stats,
}: {
  opciones: MesCompraMarcaOption[];
  valor: MesCompraMarcaKey | null;
  onChange: (v: MesCompraMarcaKey | null) => void;
  mesLabel: string;
  totalVehiculos: number;
  stats?: AnclaLogStats;
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
              Mes de compra marca
            </div>
            <div className="text-[11px] text-[--color-fg-dim] mt-0.5 mb-2">
              VINs nuevos retail · VENTA / VITRINA
            </div>
            <select
              value={valor ?? ""}
              onChange={(e) =>
                onChange(e.target.value === "" ? null : e.target.value)
              }
              className="text-[13px] font-semibold tracking-tight rounded-md border border-[--color-accent]/40 bg-[--color-accent]/[0.06] text-[--color-fg] px-3 py-1.5 focus:border-[--color-accent] outline-none min-w-[220px]"
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
            {fmtNum(totalVehiculos)}{" "}
            <span className="text-[18px] font-semibold text-[--color-fg-muted]">
              vehículos en flujo
            </span>
          </div>
          <div className="text-[12.5px] text-[--color-fg-muted] mt-0.5">
            en {mesLabel}
          </div>
          {stats && (
            <div className="text-[11.5px] text-[--color-fg-muted] mt-2 flex items-center justify-end gap-2 flex-wrap">
              <span>
                <b className="text-[--color-fg]">
                  {fmtNum(stats.enBodegaOperador)}
                </b>{" "}
                en bodega operador
              </span>
              <span className="text-[--color-fg-dim]">·</span>
              <span>
                <b className="text-[--color-ok]">{fmtNum(stats.despachados)}</b>{" "}
                despachados
              </span>
              <span className="text-[--color-fg-dim]">·</span>
              <span>
                cumplimiento{" "}
                <b className="text-[--color-fg]">
                  {stats.cumplimientoPct != null
                    ? fmtPct(stats.cumplimientoPct / 100)
                    : "—"}
                </b>
              </span>
              <span className="text-[--color-fg-dim]">·</span>
              <span>
                <b className="text-[--color-danger]">
                  {fmtNum(stats.stockCritico)}
                </b>{" "}
                en stock crítico (&gt;60d)
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
