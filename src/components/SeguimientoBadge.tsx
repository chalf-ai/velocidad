/**
 * Badge de SEGUIMIENTO por VIN — COMPARTIDO entre todos los módulos.
 *
 * Muestra el estado de caso derivado SOLO de la gestión (responsable +
 * compromiso + estado), con la misma regla del Centro de Acción:
 *   - Resuelto        → caso cerrado
 *   - Vencido Xd      → compromiso vencido (urge)
 *   - En seguimiento  → responsable + compromiso vigente + activo (fuera del top)
 *   - estado gestión  → en cola, sin seguimiento activo
 *
 * Si el VIN no tiene gestión, no renderiza nada (el contenedor decide el vacío).
 * Acepta cualquier clave de gestión (VIN o clave de provisión).
 */

"use client";

import { Badge } from "@/components/ui/Badge";
import { useGestionStore } from "@/lib/gestion/store";
import { clasificarSeguimiento } from "@/lib/gestion/caso";
import { ESTADO_GESTION_LABEL, ESTADO_GESTION_TONE } from "@/lib/gestion/types";

export function SeguimientoBadge({
  vin,
  size = "xs",
}: {
  vin: string;
  size?: "xs" | "sm";
}) {
  const gestion = useGestionStore((s) => s.byVin[vin]);
  if (!gestion) return null;

  const { estado, enSeguimiento, vencido, compromiso } = clasificarSeguimiento(gestion);

  if (estado === "resuelto") {
    return (
      <Badge tone="success" size={size}>
        Resuelto
      </Badge>
    );
  }
  if (vencido) {
    return (
      <Badge tone="danger" size={size}>
        Vencido {compromiso.dias}d
      </Badge>
    );
  }
  if (enSeguimiento) {
    const cola =
      compromiso.estado === "vigente"
        ? ` · ${compromiso.dias}d`
        : compromiso.estado === "pronto"
          ? " · hoy"
          : "";
    return (
      <Badge tone="success" size={size}>
        En seguimiento{cola}
      </Badge>
    );
  }
  // En cola sin seguimiento activo vigente → estado de gestión crudo.
  return (
    <Badge tone={ESTADO_GESTION_TONE[gestion.estadoGestion]} size={size}>
      {ESTADO_GESTION_LABEL[gestion.estadoGestion]}
    </Badge>
  );
}
