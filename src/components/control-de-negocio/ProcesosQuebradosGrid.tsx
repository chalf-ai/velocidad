"use client";

/**
 * Capa B · Grid de 7 cards de procesos quebrados.
 *
 * Cabecera obligatoria (tu pedido en el OK):
 *   "Universo cohorte madura: X de Y facturados del período"
 * para que sea visible que B opera sobre un sub-universo distinto.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { fmtNum } from "@/lib/format";
import type { CapaB } from "@/lib/control-de-negocio/cn-quebrados";
import type { HitoFaltante } from "@/lib/control-de-negocio/cn-responsables";
import { ProcesoQuebradoCard } from "./ProcesoQuebradoCard";
import { DIAS_COHORTE_MADURA } from "@/lib/control-de-negocio/cn-universo";

// Etiqueta dinámica para el counter de la cohorte según el umbral usado.
function labelCohorte(dias: number, universoCohorte: number, universoTotal: number): {
  titulo: string;
  detalle: string;
} {
  if (dias <= 0) {
    return {
      titulo: "Universo del período",
      detalle: `${fmtNum(universoCohorte)} facturados (sin filtro de madurez)`,
    };
  }
  return {
    titulo: "Universo cohorte madura",
    detalle: `${fmtNum(universoCohorte)} de ${fmtNum(universoTotal)} facturados del período (≥${dias} días)`,
  };
}

export function ProcesosQuebradosGrid({
  capa,
  activeId,
  onSelect,
  colaInferior,
  diasCohorte = DIAS_COHORTE_MADURA,
}: {
  capa: CapaB;
  activeId: HitoFaltante | null;
  onSelect: (id: HitoFaltante | null) => void;
  colaInferior?: ReactNode;
  /** Umbral usado para construir la cohorte madura (días). 0 = sin filtro. */
  diasCohorte?: number;
}) {
  const conCasos = capa.cards.filter((c) => c.count > 0);
  const colaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (colaInferior && colaRef.current) {
      colaRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [colaInferior, activeId]);

  return (
    <>
    <div className="surface bg-white px-5 py-5">
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-[--color-fg] flex items-center gap-2">
            <AlertTriangle className="size-4 text-[--color-warning]" />
            Capa B · Procesos Quebrados
          </h2>
          <p className="text-[12px] text-[--color-fg-muted] mt-0.5">
            Hitos faltantes en la cohorte madura. Click en card abre cola
            gestionable.
          </p>
        </div>
        {(() => {
          const lbl = labelCohorte(diasCohorte, capa.universo, capa.universoTotal);
          return (
            <div className="text-[11px] text-[--color-fg-muted] bg-[--color-bg-elev-1] rounded-md px-3 py-1.5 border border-[--color-border]">
              <span className="text-[--color-fg-dim]">{lbl.titulo}:</span>{" "}
              <b className="text-[--color-fg]">{lbl.detalle.split(" ")[0]}</b>{" "}
              <span className="text-[--color-fg-dim]">
                {lbl.detalle.substring(lbl.detalle.indexOf(" ") + 1)}
              </span>
            </div>
          );
        })()}
      </div>

      {conCasos.length === 0 ? (
        <div className="text-[12.5px] text-[--color-fg-muted] py-6 text-center">
          No hay procesos quebrados en la cohorte madura del período seleccionado.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {conCasos.map((c) => (
            <ProcesoQuebradoCard
              key={c.hito}
              card={c}
              active={activeId === c.hito}
              onClick={() => onSelect(activeId === c.hito ? null : c.hito)}
            />
          ))}
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
