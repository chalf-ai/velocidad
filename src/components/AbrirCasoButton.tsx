"use client";

/**
 * Botón "Abrir caso" — abre el MODAL del Caso Operacional Unificado (Ficha +
 * Mesa de Gestión) del VIN SIN salir del módulo. Muestra el estado de
 * seguimiento del VIN si tiene gestión, o el label por defecto.
 *
 * - `label`   reemplaza el texto "Abrir caso" (ej. "Abrir caso origen").
 * - `variant` "solid" (default) muestra borde + badge de gestión; "ghost" es un
 *   secundario liviano (sin badge) para acciones tipo "Ver VU recibido".
 */

import { FileText } from "lucide-react";
import { cn } from "@/lib/cn";
import { useGestionStore } from "@/lib/gestion/store";
import { SeguimientoBadge } from "@/components/SeguimientoBadge";
import { useCasoModal } from "@/lib/caso-modal";

export function AbrirCasoButton({
  vin,
  origen,
  label,
  variant = "solid",
}: {
  vin: string;
  origen?: string;
  label?: string;
  variant?: "solid" | "ghost";
}) {
  const abrir = useCasoModal((s) => s.abrir);
  const gestion = useGestionStore((s) => s.byVin[vin]);
  const tieneNota = !!(
    gestion?.comentario ||
    gestion?.responsable ||
    gestion?.fechaCompromiso ||
    gestion?.prioridadManual
  );
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    abrir(vin, origen);
  };

  // Variante secundaria liviana: solo el label, sin badge de gestión.
  if (variant === "ghost") {
    return (
      <button
        onClick={onClick}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[--color-fg-muted] hover:text-[--color-accent] transition"
      >
        <FileText className="size-3" /> {label ?? "Abrir caso"}
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition",
        tieneNota
          ? "border-[--color-accent]/30 bg-[--color-accent]/5 text-[--color-fg] hover:bg-[--color-accent]/10"
          : "border-[--color-border] bg-[--color-bg-elev-2] text-[--color-fg-muted] hover:text-[--color-fg]",
      )}
    >
      {tieneNota ? (
        <>
          <SeguimientoBadge vin={vin} />
          {gestion?.responsable && (
            <span className="text-[--color-fg-dim] truncate max-w-[100px]">{gestion.responsable}</span>
          )}
        </>
      ) : (
        <>
          <FileText className="size-3" /> {label ?? "Abrir caso"}
        </>
      )}
    </button>
  );
}
