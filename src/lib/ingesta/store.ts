/**
 * STORE DE METADATOS DE INGESTA · 100% cliente (Zustand).
 *
 * Guarda SOLO metadatos de qué se cargó por fuente (no los datos — esos viven en
 * useExcelStore). Sirve para el Hub de Ingesta: estado por fuente, fecha de corte,
 * conteos, advertencias. Estructura preparada para una persistencia/snapshot
 * futura (fuente, archivo, fecha carga, fecha corte, metadatos) sin backend hoy.
 */

"use client";

import { create } from "zustand";
import type { FuenteTipo } from "../parser/detectar-fuente";

/** Fuentes con tarjeta de estado (todas menos "desconocido"). */
export type FuenteId = Exclude<FuenteTipo, "desconocido">;

export interface IngestaMeta {
  fuenteId: FuenteId;
  archivoNombre: string;
  archivoSize: number;
  fechaCarga: Date;
  /** Fecha de corte detectada en el contenido (no la de carga). null si no se pudo. */
  fechaCorte: Date | null;
  registros: number;
  vins: number | null;
  advertencias: string[];
}

interface IngestaStoreState {
  metas: Partial<Record<FuenteId, IngestaMeta>>;
  setMeta: (m: IngestaMeta) => void;
  clearMeta: (id: FuenteId) => void;
  clearAll: () => void;
}

export const useIngestaStore = create<IngestaStoreState>((set) => ({
  metas: {},
  setMeta: (m) => set((s) => ({ metas: { ...s.metas, [m.fuenteId]: m } })),
  clearMeta: (id) =>
    set((s) => {
      const next = { ...s.metas };
      delete next[id];
      return { metas: next };
    }),
  clearAll: () => set({ metas: {} }),
}));
