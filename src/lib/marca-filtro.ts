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
 * Datos del store filtrados por la marca operacional global.
 * Sustituye a `useExcelStore()` en los módulos que deben respetar el filtro.
 * Con marca = null devuelve los objetos originales (macro intacto).
 */
export function useDatosFiltrados() {
  const marca = useMarcaFilter((s) => s.marca);
  const data = useExcelStore((s) => s.data);
  const fne = useExcelStore((s) => s.fne);
  const saldos = useExcelStore((s) => s.saldos);
  const provisiones = useExcelStore((s) => s.provisiones);

  return useMemo(() => {
    if (!marca) return { data, fne, saldos, provisiones };
    const objetivo = normalizarMarcaOperacional(marca);
    return {
      data: data
        ? {
            ...data,
            // DOBLE DIMENSIÓN: trae el stock de la marca por owner (gestión) U
            // originador (capital). Así filtrar "KIA" recupera el capital puente
            // que KIA originó (VU/BU gestionados por USADOS) sin que desaparezca.
            // Las vistas de stock retail se auto-protegen por categoría.
            vehiculos: filtrarPorMarcaOwnerUOriginador(data.vehiculos, marca),
            lineas: filtrarLineasPorMarcaOperacional(data.lineas, marca),
            // Registry suplementario (Venta APC + Financiado): se filtra para que
            // el universo unificado y los cruces NO arrastren VINs de otras marcas.
            vinsExtra: data.vinsExtra
              ? new Map(
                  [...data.vinsExtra].filter(
                    ([, info]) => normalizarMarcaOperacional(info.marca) === objetivo,
                  ),
                )
              : data.vinsExtra,
          }
        : null,
      fne: fne ? { ...fne, registros: filtrarPorMarcaOperacional(fne.registros, marca) } : null,
      saldos: saldos
        ? { ...saldos, registros: filtrarPorMarcaOperacional(saldos.registros, marca) }
        : null,
      provisiones: provisiones
        ? { ...provisiones, registros: filtrarPorMarcaOperacional(provisiones.registros, marca) }
        : null,
    };
  }, [marca, data, fne, saldos, provisiones]);
}
