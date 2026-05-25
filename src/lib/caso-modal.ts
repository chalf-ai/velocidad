"use client";

/**
 * Store del MODAL DE CASO OPERACIONAL — un solo caso por VIN, abierto en overlay.
 *
 * Cualquier módulo abre el caso con `abrir(vin, origen?)`. El overlay (CasoModal)
 * se monta una vez en el layout y muestra la Ficha Operacional Unificada + la
 * gestión, ENCIMA del módulo actual. Como no se navega, el módulo origen conserva
 * su scroll / filtros / bucket / tab; cerrar = volver exactamente a donde estaba.
 */

import { create } from "zustand";

interface CasoModalState {
  vin: string | null;
  /** Etiqueta del contexto origen (ej. "FNE · falta solicitud · >30d"). */
  origen: string | null;
  abrir: (vin: string, origen?: string | null) => void;
  cerrar: () => void;
}

export const useCasoModal = create<CasoModalState>((set) => ({
  vin: null,
  origen: null,
  abrir: (vin, origen = null) => set({ vin, origen }),
  cerrar: () => set({ vin: null, origen: null }),
}));
