"use client";

/**
 * "Estado del flujo logístico" · protagonista del módulo.
 *
 * 3 cards lado a lado (1 por motor). Drill inline: click expande la cola
 * gestionable correspondiente debajo del grid (mismo patrón que CN).
 */

import { useEffect, useRef, type ReactNode } from "react";
import { Gauge } from "lucide-react";
import { MotorCard, type MotorCardData } from "./MotorCard";
import type { MotorId } from "@/lib/logistica/log-responsables";

export function FlujoLogisticoTresMotores({
  motores,
  activo,
  onClick,
  colaInferior,
}: {
  motores: [MotorCardData, MotorCardData, MotorCardData];
  activo: MotorId | null;
  onClick: (id: MotorId | null) => void;
  colaInferior?: ReactNode;
}) {
  const colaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (colaInferior && colaRef.current) {
      colaRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [colaInferior, activo]);

  return (
    <div className="surface bg-white px-5 py-5">
      <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-[--color-fg] flex items-center gap-2">
            <Gauge className="size-4 text-[--color-accent]" />
            Estado del flujo logístico
          </h2>
          <p className="text-[12px] text-[--color-fg-muted] mt-0.5">
            Tres motores · cada uno mide una cosa con un responsable distinto.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {motores.map((m) => (
          <MotorCard
            key={m.meta.id}
            data={m}
            active={activo === m.meta.id}
            onClick={() => onClick(activo === m.meta.id ? null : m.meta.id)}
          />
        ))}
      </div>

      {colaInferior && (
        <div ref={colaRef} className="mt-4 scroll-mt-4">
          {colaInferior}
        </div>
      )}
    </div>
  );
}
