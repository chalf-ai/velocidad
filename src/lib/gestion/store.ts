/**
 * Store de gestión por VIN — Zustand + localStorage como sink.
 *
 * Uso típico:
 *   const gestion = useGestionStore((s) => s.byVin[vin]);
 *   useGestionStore.getState().setGestion(vin, { comentario, responsable });
 *
 * Persistencia automática: cada update escribe a localStorage. Al cargar
 * la app se hidrata con loadFromStorage().
 */

"use client";

import { create } from "zustand";
import {
  GESTION_STORAGE_KEY,
  type EstadoGestion,
  type GestionVIN,
  type HistorialEntry,
} from "./types";

type GestionMap = Record<string, GestionVIN>;

const MAX_HISTORIAL = 50;

const fmtCampo = (k: keyof GestionVIN): string => {
  const map: Partial<Record<keyof GestionVIN, string>> = {
    comentario: "Contexto",
    proximaAccion: "Próxima acción",
    responsable: "Responsable",
    responsableEmail: "Email responsable",
    ownership: "Ownership",
    fechaCompromiso: "Fecha compromiso",
    estadoGestion: "Estado",
    prioridadManual: "Prioridad manual",
  };
  return map[k] ?? String(k);
};
const fmtValor = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
};

function loadFromStorage(): GestionMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(GESTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as GestionMap;
  } catch {
    return {};
  }
}

function saveToStorage(map: GestionMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GESTION_STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    // localStorage lleno o desactivado — fail silently, mantenemos in-memory.
    console.warn("No se pudo persistir gestión a localStorage", err);
  }
}

interface GestionStoreState {
  byVin: GestionMap;
  hydrated: boolean;
  /** Hidratar desde localStorage. Llamar una vez al montar la app. */
  hydrate: () => void;
  getOne: (vin: string) => GestionVIN | null;
  setGestion: (
    vin: string,
    partial: Partial<Omit<GestionVIN, "vin" | "ultimaActualizacion">>,
  ) => GestionVIN;
  clearGestion: (vin: string) => void;
  /** Exportar todo (para debug / backup). */
  exportAll: () => GestionMap;
}

export const useGestionStore = create<GestionStoreState>((set, get) => ({
  byVin: {},
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ byVin: loadFromStorage(), hydrated: true });
  },
  getOne: (vin) => get().byVin[vin] ?? null,
  setGestion: (vin, partial) => {
    const now = new Date().toISOString();
    const prev: GestionVIN =
      get().byVin[vin] ??
      ({
        vin,
        comentario: null,
        proximaAccion: null,
        responsable: null,
        fechaCompromiso: null,
        estadoGestion: "abierto" as EstadoGestion,
        prioridadManual: null,
        historial: [],
        ultimaActualizacion: now,
      } as GestionVIN);

    // Calcular entradas de historial para los campos que cambian
    const nuevasEntries: HistorialEntry[] = [];
    for (const k of Object.keys(partial) as (keyof typeof partial)[]) {
      const valorAnt = prev[k as keyof GestionVIN];
      const valorNuevo = partial[k];
      if (valorAnt === valorNuevo) continue;
      nuevasEntries.push({
        fecha: now,
        campo: fmtCampo(k as keyof GestionVIN),
        valorAnterior: fmtValor(valorAnt),
        valorNuevo: fmtValor(valorNuevo),
      });
    }

    const historial = [...(prev.historial ?? []), ...nuevasEntries].slice(-MAX_HISTORIAL);

    const next: GestionVIN = {
      ...prev,
      ...partial,
      vin,
      historial,
      ultimaActualizacion: now,
    };
    const map = { ...get().byVin, [vin]: next };
    saveToStorage(map);
    set({ byVin: map });
    return next;
  },
  clearGestion: (vin) => {
    const map = { ...get().byVin };
    delete map[vin];
    saveToStorage(map);
    set({ byVin: map });
  },
  exportAll: () => ({ ...get().byVin }),
}));
