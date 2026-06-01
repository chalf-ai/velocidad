"use client";

/**
 * Timeline horizontal compacta · línea de orientación rápida del flujo CN.
 *
 * 8 nodos circulares conectados por una línea horizontal. Cada nodo:
 *   · Círculo numerado 1-8
 *   · Color según cobertura (ok / warning / danger)
 *   · % cobertura debajo del círculo
 *   · Label corto del hito
 *   · Count de VINs con el hito
 *
 * Visual de orientación · NO reemplaza embudo ni cards de tiempos. Debe
 * leerse en 3 segundos: "¿dónde se cae el flujo?".
 *
 * Sin interacción en esta tanda (prioridad: orientación). Si más adelante
 * se requiere drill, se conecta al mismo `foco` del embudo.
 */

import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import type {
  EmbudoCobertura,
  HitoCobertura,
} from "@/lib/control-de-negocio/cn-cobertura";

const LABEL_CORTO: Record<HitoCobertura, string> = {
  facturas: "Facturado",
  solicitud_inscripcion: "Sol. Inscripción",
  inscripcion: "Inscripción",
  patente_recibida: "Patente Recibida",
  patente_entregada: "Patente Entregada",
  solicitud_entrega: "Sol. Entrega",
  autorizacion_entrega: "Autorización",
  entrega_real: "Entrega Real",
};

type Tono = "ok" | "warning" | "danger" | "neutral";

function toneFromPct(pct: number, esBase: boolean): Tono {
  if (esBase) return "neutral";
  if (pct >= 85) return "ok";
  if (pct >= 60) return "warning";
  return "danger";
}

const NODE_STYLES: Record<
  Tono,
  { bg: string; border: string; text: string; ring: string }
> = {
  neutral: {
    bg: "bg-[--color-bg-elev-2]",
    border: "border-[--color-fg-dim]",
    text: "text-[--color-fg]",
    ring: "ring-[--color-fg-dim]/30",
  },
  ok: {
    bg: "bg-[--color-ok]/15",
    border: "border-[--color-ok]",
    text: "text-[--color-ok]",
    ring: "ring-[--color-ok]/30",
  },
  warning: {
    bg: "bg-[--color-warning]/15",
    border: "border-[--color-warning]",
    text: "text-[--color-warning]",
    ring: "ring-[--color-warning]/30",
  },
  danger: {
    bg: "bg-[--color-danger]/15",
    border: "border-[--color-danger]",
    text: "text-[--color-danger]",
    ring: "ring-[--color-danger]/30",
  },
};

export function TimelineCN({ embudo }: { embudo: EmbudoCobertura }) {
  if (embudo.universo === 0 || embudo.filas.length === 0) return null;

  return (
    <div className="surface bg-white px-5 py-4">
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[--color-fg-muted]">
          Flujo del mes · cobertura por hito
        </div>
        <div className="text-[10px] text-[--color-fg-dim] italic">
          1 facturado → 8 entrega real · color por cobertura
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="relative grid grid-cols-8 gap-2 min-w-[680px]">
          {/* Línea horizontal a la altura del centro de los círculos (12px). */}
          <div className="absolute top-3 left-0 right-0 h-px bg-[--color-border] pointer-events-none" />

          {embudo.filas.map((fila, idx) => {
            const esBase = fila.hito === "facturas";
            const tone = toneFromPct(fila.pctSobreFacturas, esBase);
            const style = NODE_STYLES[tone];
            return (
              <div
                key={fila.hito}
                className="flex flex-col items-center min-w-0 relative"
              >
                {/* Círculo numerado · z para tapar la línea */}
                <div
                  className={cn(
                    "relative z-10 size-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold shrink-0 bg-white",
                    style.bg,
                    style.border,
                    style.text,
                  )}
                  title={`${LABEL_CORTO[fila.hito]} · ${fmtNum(fila.count)} casos · ${fila.pctSobreFacturas.toFixed(0)}%`}
                >
                  {idx + 1}
                </div>

                {/* % cobertura */}
                <div
                  className={cn(
                    "text-[11.5px] font-bold mt-1.5 mono leading-none",
                    style.text,
                  )}
                >
                  {fila.pctSobreFacturas.toFixed(0)}%
                </div>

                {/* Label corto */}
                <div
                  className="text-[10px] text-[--color-fg-muted] text-center mt-1 leading-tight px-1 truncate w-full"
                  title={LABEL_CORTO[fila.hito]}
                >
                  {LABEL_CORTO[fila.hito]}
                </div>

                {/* Count */}
                <div className="text-[10px] text-[--color-fg-dim] mono mt-0.5">
                  {fmtNum(fila.count)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
