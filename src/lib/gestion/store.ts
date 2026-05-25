/**
 * Store de gestión por VIN — Zustand con doble sink: API (primario) + localStorage (fallback).
 *
 * Estrategia:
 *   1. hydrate() → intenta GET /api/gestion (si hay sesión) o lee localStorage.
 *   2. setGestion() → actualiza in-memory optimísticamente, luego PUT /api/gestion/[vin].
 *      Si la API falla, queda en localStorage como respaldo.
 *   3. Los componentes existentes NO cambian — siguen usando byVin[vin] y setGestion().
 *
 * Backward-compat: si no hay sesión activa (usuario no logueado), funciona
 * exactamente igual que antes (localStorage only).
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

// ─── Helpers de label ────────────────────────────────────────────────────────

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

// ─── DB enum → app type mapping ──────────────────────────────────────────────

function dbEstadoToApp(e: string): EstadoGestion {
  const map: Record<string, EstadoGestion> = {
    ABIERTO: "abierto",
    EN_CURSO: "en_curso",
    ESPERANDO: "esperando",
    RESUELTO: "resuelto",
    CANCELADO: "cancelado",
  };
  return map[e] ?? "abierto";
}

function appEstadoToDB(e: EstadoGestion): string {
  const map: Record<EstadoGestion, string> = {
    abierto: "ABIERTO",
    en_curso: "EN_CURSO",
    esperando: "ESPERANDO",
    resuelto: "RESUELTO",
    cancelado: "CANCELADO",
  };
  return map[e];
}

function dbPrioridadToApp(p: string | null): GestionVIN["prioridadManual"] {
  if (!p) return null;
  const map: Record<string, GestionVIN["prioridadManual"]> = {
    BAJA: "baja",
    MEDIA: "media",
    ALTA: "alta",
    CRITICA: "critica",
  };
  return map[p] ?? null;
}

function appPrioridadToDB(p: GestionVIN["prioridadManual"]): string | null {
  if (!p) return null;
  return p.toUpperCase();
}

// ─── Persistencia localStorage ────────────────────────────────────────────────

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
    console.warn("No se pudo persistir gestión a localStorage", err);
  }
}

// ─── API helpers ──────────────────────────────────────────────────────────────

/** Convierte un registro de la API al tipo GestionVIN de la app */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function apiToGestionVIN(row: any): GestionVIN {
  return {
    vin: row.vin,
    comentario: row.comentario ?? null,
    proximaAccion: row.proximaAccion ?? null,
    responsable: row.responsable ?? null,
    responsableEmail: row.responsableEmail ?? null,
    ownership: row.ownership ?? null,
    fechaCompromiso: row.fechaCompromiso
      ? new Date(row.fechaCompromiso).toISOString().split("T")[0]
      : null,
    estadoGestion: dbEstadoToApp(row.estadoGestion),
    prioridadManual: dbPrioridadToApp(row.prioridadManual),
    historial: (row.historial ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (h: any): HistorialEntry => ({
        fecha: h.createdAt ?? new Date().toISOString(),
        campo: h.campo,
        valorAnterior: h.valorAnterior ?? "—",
        valorNuevo: h.valorNuevo ?? "—",
      }),
    ),
    ultimaActualizacion: row.updatedAt ?? new Date().toISOString(),
  };
}

async function fetchAllGestiones(): Promise<GestionMap> {
  try {
    const res = await fetch("/api/gestion", { credentials: "include" });
    if (!res.ok) return {};
    const rows: unknown[] = await res.json();
    if (!Array.isArray(rows)) return {};
    const map: GestionMap = {};
    for (const row of rows) {
      const g = apiToGestionVIN(row);
      map[g.vin] = g;
    }
    return map;
  } catch {
    return {};
  }
}

async function pushGestionToAPI(
  vin: string,
  partial: Partial<Omit<GestionVIN, "vin" | "ultimaActualizacion">>,
): Promise<void> {
  try {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(partial)) {
      if (k === "estadoGestion") {
        body[k] = appEstadoToDB(v as EstadoGestion);
      } else if (k === "prioridadManual") {
        body[k] = appPrioridadToDB(v as GestionVIN["prioridadManual"]);
      } else if (k === "historial") {
        // historial no se envía — la API lo construye internamente
        continue;
      } else {
        body[k] = v;
      }
    }
    await fetch(`/api/gestion/${encodeURIComponent(vin)}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // fail silently — el store ya tiene el cambio in-memory + localStorage
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface GestionStoreState {
  byVin: GestionMap;
  hydrated: boolean;
  /** Hidratar: intenta API primero, cae a localStorage si no hay sesión. */
  hydrate: () => Promise<void>;
  getOne: (vin: string) => GestionVIN | null;
  setGestion: (
    vin: string,
    partial: Partial<Omit<GestionVIN, "vin" | "ultimaActualizacion">>,
  ) => GestionVIN;
  clearGestion: (vin: string) => void;
  exportAll: () => GestionMap;
}

export const useGestionStore = create<GestionStoreState>((set, get) => ({
  byVin: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;

    // Intentar API primero
    const apiMap = await fetchAllGestiones();
    if (Object.keys(apiMap).length > 0) {
      // Merge: API gana sobre localStorage (es la fuente de verdad)
      const local = loadFromStorage();
      set({ byVin: { ...local, ...apiMap }, hydrated: true });
      return;
    }

    // Fallback: localStorage (sin sesión o API falló)
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

    // Calcular historial
    const nuevasEntries: HistorialEntry[] = [];
    for (const k of Object.keys(partial) as (keyof typeof partial)[]) {
      if (k === "historial") continue;
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

    // Sync a API en background (fire-and-forget)
    pushGestionToAPI(vin, partial);

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
