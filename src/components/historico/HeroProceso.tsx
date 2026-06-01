"use client";

import { Activity } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";

interface Props {
  /** Etiqueta legible del proceso activo. */
  nombreProceso: string;
  /** Etiqueta legible del modo activo. */
  nombreModo: string;
  /** Tono semántico del banner. "ok" verde, "warn" naranjo, "alert" rojo. */
  tono: "ok" | "warn" | "alert";
  /** Etiqueta de estado corta (ej. "Operación sana"). */
  estado: string;
  /** Encabezado principal (1 frase). */
  titular: string;
  /** Sub-frase explicativa. */
  bajada: string;
  /** Fecha del corte de los datos. */
  corte?: string | null;
  /** Universo cerrado o abierto según modo. */
  universo: number;
}

/**
 * Mini-hero contextual al proceso activo. Estética inspirada en el banner
 * verde del Sistema de Velocidad Operacional ("La operación está fluyendo").
 *
 * NO trae KPIs sueltos. Solo contexto + titular + bajada. Tono semántico
 * según el estado del proceso (mayor pérdida, mayor demora, etc.).
 */
export function HeroProceso({
  nombreProceso,
  nombreModo,
  tono,
  estado,
  titular,
  bajada,
  corte,
  universo,
}: Props) {
  const styleBg =
    tono === "ok"
      ? "bg-[--color-success-dim] ring-[--color-success]/30"
      : tono === "warn"
        ? "bg-[--color-warning-dim] ring-[--color-warning]/30"
        : "bg-[--color-danger-dim] ring-[--color-danger]/30";
  const stylePill =
    tono === "ok"
      ? "bg-[--color-success]/15 text-[--color-success] ring-[--color-success]/40"
      : tono === "warn"
        ? "bg-[--color-warning]/15 text-[--color-warning] ring-[--color-warning]/40"
        : "bg-[--color-danger]/15 text-[--color-danger] ring-[--color-danger]/40";
  const styleDot =
    tono === "ok"
      ? "bg-[--color-success]"
      : tono === "warn"
        ? "bg-[--color-warning]"
        : "bg-[--color-danger]";

  return (
    <div
      className={cn(
        "rounded-2xl p-6 ring-1 ring-inset",
        styleBg,
      )}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("size-1.5 rounded-full", styleDot)} />
            <span className="text-[11px] uppercase tracking-[0.18em] text-[--color-fg-muted] font-semibold">
              Tiempos Operacionales · {nombreProceso}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider ring-1 ring-inset",
                stylePill,
              )}
            >
              {estado}
            </span>
            <span className="text-[11px] text-[--color-fg-muted]">
              {nombreModo}
            </span>
          </div>

          <h2 className="mt-3 text-[26px] leading-tight font-semibold text-[--color-fg] max-w-3xl">
            {titular}
          </h2>

          <p className="mt-1.5 text-[13.5px] text-[--color-fg-muted] max-w-3xl">
            {bajada}
            {corte && (
              <span className="text-[--color-fg-dim]"> · corte {corte}</span>
            )}
          </p>
        </div>

        <div className="text-right shrink-0">
          <div className="text-[10.5px] uppercase tracking-wider text-[--color-fg-muted] font-semibold flex items-center justify-end gap-1.5">
            <Activity className="size-3" />
            Universo
          </div>
          <div className="mt-1 text-[28px] font-semibold tabular-nums leading-none text-[--color-fg]">
            {fmtNum(universo)}
          </div>
          <div className="mt-0.5 text-[11px] text-[--color-fg-muted]">
            casos
          </div>
        </div>
      </div>
    </div>
  );
}
