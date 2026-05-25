"use client";

/**
 * BOTONES DE CASO · Capital puente (VU/BU recibido en parte de pago).
 *
 * Base_Stock es la fuente MAESTRA: un BU/VPP es capital puente VÁLIDO aunque no
 * tenga FNE. "Sin FNE" es COLA DE HIGIENE (regularizar origen), NO error. La
 * conciliación técnica es la excepción (faltan todas las señales base):
 *
 *   origen_enriquecido          → "Abrir caso origen" (VIN nuevo) + "Ver VU recibido".
 *   origen_pendiente_regularizar → "Regularizar origen" + "Ver capital puente" (VU).
 *   conciliacion_real           → "Conciliar (datos base)" (VU) + alerta (raro).
 *
 * NUNCA abre el VU como si fuera el caso origen, ni inventa cliente/VIN nuevo.
 */

import { AlertTriangle, Info } from "lucide-react";
import { AbrirCasoButton } from "@/components/AbrirCasoButton";
import { limpiarVIN } from "@/lib/parser/venta-apc";
import { resolverOrigenPuente, type FNEOrigenIndex } from "@/lib/selectors/vu-en-fne";
import type { Vehiculo } from "@/lib/types";

export function BotonesCasoPuente({
  usado,
  fneIndex,
}: {
  usado: Vehiculo;
  fneIndex: FNEOrigenIndex;
}) {
  const { nuevoVin, estado } = resolverOrigenPuente(usado, fneIndex);
  const vuVin = limpiarVIN(usado.vin);

  // A · Operación nueva originadora confiable → gestionar el caso origen.
  if (estado === "origen_enriquecido" && nuevoVin) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <AbrirCasoButton
          vin={nuevoVin}
          origen="Operación origen · capital puente"
          label="Abrir caso origen"
        />
        <AbrirCasoButton
          vin={vuVin}
          origen="VU recibido en parte de pago"
          label="Ver VU recibido"
          variant="ghost"
        />
      </span>
    );
  }

  // B · Capital puente VÁLIDO (Base_Stock), origen pendiente de regularizar.
  // NO es error: es cola de higiene operacional (revisar nota de venta / BPP).
  if (estado === "origen_pendiente_regularizar") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <AbrirCasoButton
          vin={vuVin}
          origen="Capital puente · regularizar origen (revisar nota de venta / BPP / PatenteVpp)"
          label="Regularizar origen"
        />
        <AbrirCasoButton
          vin={vuVin}
          origen="Capital puente · activo recibido"
          label="Ver capital puente"
          variant="ghost"
        />
        <span
          className="inline-flex items-center gap-1 text-[10px] text-[--color-fg-dim]"
          title="Capital puente válido por Base_Stock. Falta vincular la operación nueva (probable BPP/VPP no ingresado, o sin PatenteVpp en FNE). Owner: USADOS + vendedor/jefe local."
        >
          <Info className="size-3" /> origen pendiente
        </span>
      </span>
    );
  }

  // C · Conciliación REAL (excepción): faltan señales base del capital puente.
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title="Capital puente sin señales base suficientes (sin fecha/folio retoma, patente ni tipo BU). Conciliación técnica."
    >
      <AbrirCasoButton
        vin={vuVin}
        origen="Capital puente · conciliación técnica (faltan datos base)"
        label="Conciliar (datos base)"
      />
      <AlertTriangle className="size-3.5 text-[--color-warning]" />
    </span>
  );
}
