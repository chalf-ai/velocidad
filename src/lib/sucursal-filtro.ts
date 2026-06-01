/**
 * Filtro GLOBAL por sucursal.
 *
 * Paralelo conceptual al filtro de marca (`marca-filtro.ts`). Un único estado
 * persistido en localStorage con la sucursal seleccionada. El filtro efectivo
 * se aplica desde `useDatosFiltrados()` (en `marca-filtro.ts`) que ahora
 * compone AMBOS filtros (marca + sucursal) en cascada.
 *
 * Con `sucursal === null` ("Todas las sucursales") devuelve los datos sin
 * filtrar — mismo principio de no romper macro.
 *
 * El campo `sucursal: string | null` ya existe en `Vehiculo`, `SaldoRegistro`,
 * `AutoNoEntregado` y `ProvisionRegistro` (razonSocial para algunos).
 * Comparación literal sin normalización: las sucursales vienen ya con
 * convención uniforme desde los parsers.
 */

"use client";

import { create } from "zustand";

const STORAGE_KEY = "stock-command-center:sucursal-filtro:v1";

function load(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}
function save(sucursal: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (sucursal) window.localStorage.setItem(STORAGE_KEY, sucursal);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage no disponible — fail silently.
  }
}

interface SucursalFiltroState {
  /** Sucursal seleccionada. null = todas (sin filtro). */
  sucursal: string | null;
  hydrated: boolean;
  setSucursal: (s: string | null) => void;
  hydrate: () => void;
}

export const useSucursalFilter = create<SucursalFiltroState>((set, get) => ({
  sucursal: null,
  hydrated: false,
  setSucursal: (sucursal) => {
    save(sucursal);
    set({ sucursal });
  },
  hydrate: () => {
    if (get().hydrated) return;
    set({ sucursal: load(), hydrated: true });
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers genéricos: filtrado por sucursal y extracción de opciones
// ─────────────────────────────────────────────────────────────────────────────

interface ConSucursal {
  sucursal?: string | null;
}

/**
 * Filtra cualquier array de registros que tenga campo `sucursal: string | null`.
 * Si `sucursal` es null o vacío, NO filtra (passthrough).
 */
export function filtrarPorSucursal<T extends ConSucursal>(
  registros: T[],
  sucursal: string | null,
): T[] {
  if (!sucursal) return registros;
  return registros.filter((r) => (r.sucursal ?? null) === sucursal);
}

/**
 * Extrae las sucursales únicas presentes en un array de registros, ordenadas
 * alfabéticamente. Excluye `null`/vacíos. Se alimenta de un único universo
 * (típicamente vehículos del stock) para mantener la lista estable.
 */
export function sucursalesDisponibles<T extends ConSucursal>(registros: T[]): string[] {
  const set = new Set<string>();
  for (const r of registros) {
    const s = (r.sucursal ?? "").trim();
    if (s) set.add(s);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}
