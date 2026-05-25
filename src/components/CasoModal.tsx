"use client";

/**
 * MODAL DEL CASO OPERACIONAL — overlay global montado una vez en el layout.
 *
 * Muestra la Ficha Operacional Unificada del VIN + la gestión, ENCIMA del módulo
 * actual. Como no hay navegación, cerrar devuelve al módulo exactamente como
 * estaba (scroll / filtros / bucket / tab). Esc o clic en el backdrop cierran.
 */

import { useEffect } from "react";
import { X } from "lucide-react";
import { useCasoModal } from "@/lib/caso-modal";
import { FichaOperacionalVIN } from "@/components/FichaOperacionalVIN";

export function CasoModal() {
  const vin = useCasoModal((s) => s.vin);
  const origen = useCasoModal((s) => s.origen);
  const cerrar = useCasoModal((s) => s.cerrar);

  useEffect(() => {
    if (!vin) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [vin, cerrar]);

  if (!vin) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 sm:p-8 fade-in"
      onClick={cerrar}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-[1120px] my-2 rounded-2xl bg-[--color-bg] shadow-2xl border border-[--color-border]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header sticky */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-3 border-b border-[--color-border] bg-[--color-bg] rounded-t-2xl">
          <div className="text-[13px] font-semibold text-[--color-fg] truncate">
            Caso · VIN <span className="mono">{vin}</span>
            {origen && (
              <span className="text-[11px] text-[--color-fg-muted] font-normal"> · {origen}</span>
            )}
          </div>
          <button
            onClick={cerrar}
            className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-md border border-[--color-border] text-[--color-fg-muted] hover:text-[--color-fg] hover:bg-[--color-bg-elev-1] transition shrink-0"
          >
            Cerrar <X className="size-3.5" />
          </button>
        </div>

        {/* Cuerpo: ficha unificada (incluye la mesa de gestión del caso) */}
        <div className="p-5 space-y-4">
          <FichaOperacionalVIN vin={vin} />
          <div className="flex justify-end">
            <button
              onClick={cerrar}
              className="text-[12px] px-3 py-1.5 rounded-md border border-[--color-border] text-[--color-fg-muted] hover:text-[--color-fg] transition"
            >
              Volver al análisis
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
