"use client";

/**
 * Capa C · FNE atribuible a Control de Negocio.
 *
 * V2 — colapsado por defecto. El header del collapse muestra siempre la
 * cifra clave (N vehículos · $ retenidos · 7 grupos) aunque esté cerrado.
 * Es consecuencia financiera del flujo · para gestión integral existe el
 * módulo dedicado `/facturados-no-entregados`.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Truck, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { fmtNum, fmtCLPCompact } from "@/lib/format";
import type { CapaC } from "@/lib/control-de-negocio/cn-fne-atribuible";
import type { HitoFaltante } from "@/lib/control-de-negocio/cn-responsables";
import { FNEGrupoCard } from "./FNEGrupoCard";

export function FNEAtribuibleSection({
  capa,
  activeId,
  onSelect,
  colaInferior,
}: {
  capa: CapaC;
  activeId: HitoFaltante | null;
  onSelect: (id: HitoFaltante | null) => void;
  colaInferior?: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const conCasos = capa.grupos.filter((g) => g.count > 0);
  const Chev = abierto ? ChevronDown : ChevronRight;
  const colaRef = useRef<HTMLDivElement>(null);

  // Si la cola llega cerrada, abrir automáticamente para que se vea.
  useEffect(() => {
    if (colaInferior && !abierto) setAbierto(true);
    if (colaInferior && colaRef.current) {
      colaRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [colaInferior, activeId, abierto]);

  return (
    <>
    <div className="surface bg-white">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="w-full px-5 py-4 flex items-center gap-3 text-left transition hover:bg-[--color-bg-elev-1]/40"
      >
        <Chev className="size-4 text-[--color-fg-muted] shrink-0" />
        <Truck className="size-4 text-[--color-danger] shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold tracking-tight text-[--color-fg]">
            FNE atribuible a Control de Negocio
          </div>
          <div className="text-[11.5px] text-[--color-fg-muted] mt-0.5">
            <b className="text-[--color-fg]">{fmtNum(capa.totalFNE)}</b> vehículos
            {" · "}
            <b className="text-[--color-danger]">
              {fmtCLPCompact(capa.totalMonto)}
            </b>{" "}
            retenidos
            {" · "}
            <b className="text-[--color-fg]">{conCasos.length}</b>{" "}
            {conCasos.length === 1 ? "grupo" : "grupos"} por etapa
          </div>
        </div>
        <span className="text-[10.5px] text-[--color-fg-dim] italic shrink-0">
          {abierto ? "Click para colapsar" : "Click para ver detalle"}
        </span>
      </button>

      {abierto && (
        <div className="px-5 pb-5 border-t border-[--color-border]">
          <div className="pt-3 mb-3 text-[11.5px] text-[--color-fg-muted] flex items-start gap-1.5">
            <ExternalLink className="size-3.5 text-[--color-info] shrink-0 mt-0.5" />
            <span>
              Cada FNE clasificado por la etapa donde está detenido (1-a-1 · cada
              VIN en un único grupo). Para gestión integral de FNE existe el
              módulo dedicado{" "}
              <a
                href="/facturados-no-entregados"
                className="text-[--color-accent] hover:underline"
              >
                /facturados-no-entregados
              </a>
              .
            </span>
          </div>

          {conCasos.length === 0 ? (
            <div className="text-[12.5px] text-[--color-fg-muted] py-6 text-center">
              No hay FNE en el período seleccionado.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {conCasos.map((g) => (
                <FNEGrupoCard
                  key={g.hito}
                  grupo={g}
                  active={activeId === g.hito}
                  onClick={() =>
                    onSelect(activeId === g.hito ? null : g.hito)
                  }
                />
              ))}
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
