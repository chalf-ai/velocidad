/**
 * Filtro GLOBAL por marca operacional.
 *
 * Un único estado (persistido en localStorage) con la marca seleccionada, y un
 * hook `useDatosFiltrados()` que devuelve los mismos datos del store pero con
 * los arrays filtrados a esa marca operacional (vía owner-operacional.ts).
 *
 * CLAVE para no romper macro: con marca = null ("Todas las marcas") devuelve los
 * objetos del store TAL CUAL (sin copiar ni filtrar) → comportamiento idéntico
 * al actual. El filtrado solo ocurre cuando hay una marca seleccionada.
 *
 * Persistencia separada de la gestión (otra key). No toca el store de Excel ni
 * el de gestión.
 */

"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { useExcelStore } from "./store";
import {
  filtrarLineasPorMarcaOperacional,
  filtrarPorMarcaOperacional,
  filtrarPorMarcaOwnerUOriginador,
  normalizarMarcaOperacional,
} from "./selectors/owner-operacional";
import { filtrarPorSucursal, useSucursalFilter } from "./sucursal-filtro";

const STORAGE_KEY = "stock-command-center:marca-filtro:v1";

function load(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}
function save(marca: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (marca) window.localStorage.setItem(STORAGE_KEY, marca);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage no disponible — fail silently.
  }
}

interface MarcaFiltroState {
  /** Marca operacional seleccionada. null = todas (sin filtro). */
  marca: string | null;
  hydrated: boolean;
  setMarca: (marca: string | null) => void;
  hydrate: () => void;
}

export const useMarcaFilter = create<MarcaFiltroState>((set, get) => ({
  marca: null,
  hydrated: false,
  setMarca: (marca) => {
    save(marca);
    set({ marca });
  },
  hydrate: () => {
    if (get().hydrated) return;
    set({ marca: load(), hydrated: true });
  },
}));

/**
 * Datos del store filtrados por marca operacional Y sucursal globales.
 *
 * Compone ambos filtros en cascada:
 *   1. Marca operacional (con dimensión owner+originador para vehículos).
 *   2. Sucursal literal (campo `sucursal: string | null`).
 *
 * Con ambos en null devuelve los datos sin tocar (macro intacto). Con uno o
 * los dos seteados, filtra primero por marca y luego por sucursal sobre el
 * resultado. Las provisiones que no tienen sucursal explícita quedan fuera
 * del filtro por sucursal (igual a passthrough — pasan tal cual).
 */
export function useDatosFiltrados() {
  const marca = useMarcaFilter((s) => s.marca);
  const sucursal = useSucursalFilter((s) => s.sucursal);
  const data = useExcelStore((s) => s.data);
  const fne = useExcelStore((s) => s.fne);
  const saldos = useExcelStore((s) => s.saldos);
  const provisiones = useExcelStore((s) => s.provisiones);

  return useMemo(() => {
    if (!marca && !sucursal) return { data, fne, saldos, provisiones };

    // ── Paso 1: aplicar filtro de marca (si hay) ─────────────────────────────
    let dataF = data;
    let fneF = fne;
    let saldosF = saldos;
    let provisionesF = provisiones;

    if (marca) {
      const objetivo = normalizarMarcaOperacional(marca);
      dataF = data
        ? {
            ...data,
            vehiculos: filtrarPorMarcaOwnerUOriginador(data.vehiculos, marca),
            lineas: filtrarLineasPorMarcaOperacional(data.lineas, marca),
            vinsExtra: data.vinsExtra
              ? new Map(
                  [...data.vinsExtra].filter(
                    ([, info]) => normalizarMarcaOperacional(info.marca) === objetivo,
                  ),
                )
              : data.vinsExtra,
          }
        : null;
      fneF = fne ? { ...fne, registros: filtrarPorMarcaOperacional(fne.registros, marca) } : null;
      saldosF = saldos
        ? { ...saldos, registros: filtrarPorMarcaOperacional(saldos.registros, marca) }
        : null;
      provisionesF = provisiones
        ? { ...provisiones, registros: filtrarPorMarcaOperacional(provisiones.registros, marca) }
        : null;
    }

    // ── Paso 2: aplicar filtro de sucursal sobre el resultado anterior ───────
    if (sucursal) {
      dataF = dataF
        ? {
            ...dataF,
            vehiculos: filtrarPorSucursal(dataF.vehiculos, sucursal),
            // `lineas` y `vinsExtra` no tienen sucursal — pasan tal cual.
          }
        : null;
      fneF = fneF ? { ...fneF, registros: filtrarPorSucursal(fneF.registros, sucursal) } : null;
      saldosF = saldosF
        ? { ...saldosF, registros: filtrarPorSucursal(saldosF.registros, sucursal) }
        : null;
      // Provisiones no tienen `sucursal` propia → passthrough (filtrarPorSucursal
      // sobre objetos sin el campo retorna tal cual cuando el filtro no matchea
      // a ninguno; mantenemos el array completo para no perder universo).
    }

    return { data: dataF, fne: fneF, saldos: saldosF, provisiones: provisionesF };
  }, [marca, sucursal, data, fne, saldos, provisiones]);
}
