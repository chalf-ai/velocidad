"use client";

/**
 * Embudo vertical de cobertura — PROTAGONISTA de Control de Negocio V2.
 *
 * Mockup V2 §2.3. 8 niveles top-down. Cada fila:
 *   · Flecha ↓ (excepto el primero)
 *   · Nombre del hito + badge ◆ responsable (color por área)
 *   · Cantidad absoluta + barra horizontal (% sobre Facturas) + % + delta
 *
 * Tres lecturas simultáneas: cuello operacional, conversión, responsable.
 *
 * Click en una barra → cola con los VINs SIN ese hito.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { ArrowDown, AlertTriangle } from "lucide-react";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import type {
  EmbudoCobertura,
  FilaEmbudo,
  HitoCobertura,
} from "@/lib/control-de-negocio/cn-cobertura";
import {
  COLOR_POR_AREA,
  LABEL_AREA,
} from "@/lib/control-de-negocio/cn-responsables";

export function EmbudoVerticalCN({
  embudo,
  hitoActivo,
  onHitoClick,
  colaInferior,
}: {
  embudo: EmbudoCobertura;
  hitoActivo: HitoCobertura | null;
  onHitoClick: (h: HitoCobertura | null) => void;
  colaInferior?: ReactNode;
}) {
  const colaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (colaInferior && colaRef.current) {
      colaRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [colaInferior, hitoActivo]);
  const hayCoberturaImperfecta = embudo.filas.some((f) => f.esCoberturaImperfecta);
  const hayCaidaFuerte = embudo.filas.some((f) => f.esCaidaFuerte);

  if (embudo.universo === 0) {
    return (
      <div className="surface bg-white px-5 py-8 text-center text-[12.5px] text-[--color-fg-muted]">
        Sin facturas en el período seleccionado para construir el embudo.
      </div>
    );
  }

  return (
    <>
    <div className="surface bg-white px-5 py-5">
      <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-[--color-fg] flex items-center gap-2">
            <span className="inline-block size-2.5 rounded-sm bg-[--color-accent]" />
            Estado del flujo
          </h2>
          <p className="text-[12px] text-[--color-fg-muted] mt-0.5">
            Cobertura de cada hito sobre las facturas del mes — denominador fijo:{" "}
            {fmtNum(embudo.universo)} facturas.
          </p>
        </div>
        <div className="text-[10.5px] text-[--color-fg-dim] italic">
          Click en una fila para ver los VIN sin ese hito.
        </div>
      </div>

      <div className="space-y-1">
        {embudo.filas.map((fila, idx) => (
          <FilaEmbudoView
            key={fila.hito}
            fila={fila}
            isFirst={idx === 0}
            active={hitoActivo === fila.hito}
            onClick={() => {
              if (fila.hito === "facturas") return;
              onHitoClick(hitoActivo === fila.hito ? null : fila.hito);
            }}
          />
        ))}
      </div>

      {(hayCoberturaImperfecta || hayCaidaFuerte) && (
        <div className="mt-4 pt-3 border-t border-[--color-border] text-[10.5px] text-[--color-fg-muted] space-y-1.5">
          {hayCoberturaImperfecta && (
            <div className="flex items-start gap-1.5">
              <span className="text-[--color-warning] font-bold shrink-0">*</span>
              <span>
                <b>Delta positivo</b> = hito posterior registrado sin el previo
                (cobertura imperfecta · auditoría de captura, no error real del flujo).
              </span>
            </div>
          )}
          {hayCaidaFuerte && (
            <div className="flex items-start gap-1.5">
              <AlertTriangle className="size-3 text-[--color-danger] shrink-0 mt-0.5" />
              <span>
                <b>Caída fuerte de cobertura</b> — explorar el detalle en{" "}
                <i>Dónde se rompió</i> abajo.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
    {colaInferior && (
      <div ref={colaRef} className="scroll-mt-4">
        {colaInferior}
      </div>
    )}
    </>
  );
}

function FilaEmbudoView({
  fila,
  isFirst,
  active,
  onClick,
}: {
  fila: FilaEmbudo;
  isFirst: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const colorArea = fila.responsable ? COLOR_POR_AREA[fila.responsable.area] : null;
  const labelArea = fila.responsable ? LABEL_AREA[fila.responsable.area] : null;
  // Barra: % sobre facturas (0-100).
  const barWidth = Math.max(0, Math.min(100, fila.pctSobreFacturas));
  const barColor = colorArea ?? "var(--color-fg-dim)";

  const Component = isFirst ? "div" : "button";

  return (
    <Component
      onClick={isFirst ? undefined : onClick}
      className={cn(
        "block w-full text-left rounded-md px-3 py-2.5 transition",
        isFirst
          ? "bg-[--color-bg-elev-1]/40"
          : "hover:bg-[--color-bg-elev-1]/60",
        active && "ring-2 ring-[--color-accent] bg-[--color-accent]/[0.06]",
      )}
    >
      {/* Etiqueta del hito + responsable badge */}
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        {!isFirst && (
          <ArrowDown className="size-3 text-[--color-fg-dim] shrink-0" strokeWidth={2.5} />
        )}
        <span className="text-[12.5px] font-semibold text-[--color-fg]">
          {fila.label}
        </span>
        {labelArea && colorArea && (
          <span className="inline-flex items-center gap-1 text-[10.5px] text-[--color-fg-muted] ml-1">
            <span
              className="inline-block size-2 rounded-sm shrink-0"
              style={{ backgroundColor: colorArea }}
            />
            {labelArea}
          </span>
        )}
        {active && (
          <span className="text-[10px] text-[--color-accent] ml-auto font-semibold">
            cola abierta abajo →
          </span>
        )}
      </div>

      {/* Datos + barra */}
      <div className="grid grid-cols-[72px_1fr_56px_110px] items-center gap-3">
        <div className="text-[22px] font-bold text-[--color-fg] mono leading-none">
          {fmtNum(fila.count)}
        </div>
        <div className="h-3 bg-[--color-bg-elev-2] rounded-sm overflow-hidden">
          <div
            className="h-full transition-all"
            style={{
              width: `${barWidth}%`,
              backgroundColor: barColor,
              opacity: isFirst ? 0.55 : 0.9,
            }}
          />
        </div>
        <div className="text-[12.5px] font-semibold text-[--color-fg] text-right mono">
          {fila.pctSobreFacturas.toFixed(0)}%
        </div>
        <div className="text-[11px] text-right mono whitespace-nowrap">
          {isFirst ? (
            <span className="text-[--color-fg-dim]">base · 100%</span>
          ) : (
            <DeltaView fila={fila} />
          )}
        </div>
      </div>
    </Component>
  );
}

function DeltaView({ fila }: { fila: FilaEmbudo }) {
  const positivo = fila.deltaAbs > 0;
  const negativo = fila.deltaAbs < 0;
  const tone = negativo
    ? "text-[--color-danger]"
    : positivo
    ? "text-[--color-warning]"
    : "text-[--color-fg-dim]";
  const signo = positivo ? "+" : "";
  return (
    <span className={cn("inline-flex items-center gap-1 justify-end", tone)}>
      <span className="font-semibold">
        {signo}
        {fmtNum(fila.deltaAbs)}
      </span>
      <span className="text-[--color-fg-dim] text-[10.5px]">
        ({signo}
        {fila.deltaPctSobreFacturas.toFixed(0)}%)
      </span>
      {fila.esCoberturaImperfecta && (
        <span className="text-[--color-warning] font-bold">*</span>
      )}
      {fila.esCaidaFuerte && (
        <AlertTriangle className="size-3 text-[--color-danger]" />
      )}
    </span>
  );
}
