/**
 * Store global del archivo Excel cargado. 100% en cliente (Zustand).
 */

"use client";

import { create } from "zustand";
import type { ParsedExcel, ParsedFNE, ParsedProvisiones, ParsedSaldos } from "./types";
import { enriquecerFNEUsados } from "./selectors/fne-real";
import type { LogisticaOperacionVIN } from "./logistica/modelo";
import {
  construirLogisticaPorVin,
  type LogisticaRomaRow,
  type LogisticaStliRow,
} from "./logistica/construir";
import type { RomiaRow } from "./logistica/romia-tipos";
import { limpiarVIN } from "./parser/venta-apc";

/** Reconstruye el merge logístico por VIN con el stock/FNE vigentes.
 *  Acepta opcionalmente filas ROMIA (SCHIAPP+KAR) — modelo nuevo, prioridad
 *  sobre el legacy. Si no hay ninguna fuente, retorna null. */
function buildLogisticaPorVin(
  roma: LogisticaRomaRow[] | null,
  stli: LogisticaStliRow[] | null,
  data: ParsedExcel | null,
  fne: ParsedFNE | null,
  romiaSchiapp: RomiaRow[] | null = null,
  romiaKar: RomiaRow[] | null = null,
): Map<string, LogisticaOperacionVIN> | null {
  if (!roma && !stli && !romiaSchiapp && !romiaKar) return null;
  const stockVins = new Set<string>();
  if (data) for (const v of data.vehiculos) { const k = limpiarVIN(v.vin); if (k) stockVins.add(k); }
  const fneVins = new Set<string>();
  if (fne) for (const r of fne.registros) { const k = limpiarVIN(r.vin); if (k) fneVins.add(k); }
  const romia: RomiaRow[] = [];
  if (romiaSchiapp) romia.push(...romiaSchiapp);
  if (romiaKar) romia.push(...romiaKar);
  return construirLogisticaPorVin(roma ?? [], stli ?? [], { stockVins, fneVins, romia });
}

interface StoreState {
  data: ParsedExcel | null;
  /** Universo FNE oficial — viene de "Autos no entregados.xlsx", se carga aparte. */
  fne: ParsedFNE | null;
  /** Universo Saldos — viene de "Reportes Saldos 2.0.xlsx", se carga aparte.
   *  Mezcla 3 categorías: vehículos (cruzan VIN), bonos/comisiones (facturas),
   *  servicios (post-venta, se excluyen del módulo de capital de trabajo). */
  saldos: ParsedSaldos | null;
  /** Universo Provisiones — viene de "Provisiones al 18 de Mayo.xlsx".
   *  Solo las NO facturadas son universo activo (consumen capital). Las
   *  facturadas se muestran como referencia secundaria. */
  provisiones: ParsedProvisiones | null;

  /** Logística — agenda del vendedor (ROMA) y ejecución de bodega (STLI), se
   *  cargan aparte. `logisticaPorVin` es el merge derivado por VIN normalizado.
   *  Coexisten con el modelo nuevo ROMIA (SCHIAPP/KAR) — ver `romiaSchiapp/kar`. */
  logisticaRoma: LogisticaRomaRow[] | null;
  logisticaSTLI: LogisticaStliRow[] | null;
  /** Filas ROMIA SCHIAPPACASSE — modelo nuevo, prioridad sobre legacy. */
  romiaSchiapp: RomiaRow[] | null;
  /** Filas ROMIA KAR-LOGISTICS — modelo nuevo, prioridad sobre legacy. */
  romiaKar: RomiaRow[] | null;
  logisticaPorVin: Map<string, LogisticaOperacionVIN> | null;

  loading: boolean;
  fneLoading: boolean;
  saldosLoading: boolean;
  provisionesLoading: boolean;
  logisticaLoading: boolean;
  error: string | null;
  fneError: string | null;
  saldosError: string | null;
  provisionesError: string | null;
  logisticaError: string | null;

  setData: (data: ParsedExcel) => void;
  setFNE: (fne: ParsedFNE) => void;
  setSaldos: (saldos: ParsedSaldos) => void;
  setProvisiones: (provisiones: ParsedProvisiones) => void;
  setLogisticaRoma: (roma: LogisticaRomaRow[]) => void;
  setLogisticaSTLI: (stli: LogisticaStliRow[]) => void;
  setRomiaSchiapp: (rows: RomiaRow[]) => void;
  setRomiaKar: (rows: RomiaRow[]) => void;
  clearLogistica: () => void;

  setLoading: (b: boolean) => void;
  setFNELoading: (b: boolean) => void;
  setSaldosLoading: (b: boolean) => void;
  setProvisionesLoading: (b: boolean) => void;
  setLogisticaLoading: (b: boolean) => void;

  setError: (e: string | null) => void;
  setFNEError: (e: string | null) => void;
  setSaldosError: (e: string | null) => void;
  setProvisionesError: (e: string | null) => void;
  setLogisticaError: (e: string | null) => void;

  reset: () => void;
  resetFNE: () => void;
  resetSaldos: () => void;
  resetProvisiones: () => void;
}

export const useExcelStore = create<StoreState>((set) => ({
  data: null,
  fne: null,
  saldos: null,
  provisiones: null,
  logisticaRoma: null,
  logisticaSTLI: null,
  romiaSchiapp: null,
  romiaKar: null,
  logisticaPorVin: null,
  loading: false,
  fneLoading: false,
  saldosLoading: false,
  provisionesLoading: false,
  logisticaLoading: false,
  error: null,
  fneError: null,
  saldosError: null,
  provisionesError: null,
  logisticaError: null,
  // Al cargar stock, re-enriquece el FNE y recalcula el merge logístico.
  setData: (data) =>
    set((s) => ({
      data,
      error: null,
      loading: false,
      fne: s.fne
        ? { ...s.fne, registros: enriquecerFNEUsados(s.fne.registros, data.vehiculos) }
        : s.fne,
      logisticaPorVin: buildLogisticaPorVin(s.logisticaRoma, s.logisticaSTLI, data, s.fne, s.romiaSchiapp, s.romiaKar),
    })),
  // Al cargar FNE, lo enriquece contra el stock y recalcula el merge logístico.
  setFNE: (fne) =>
    set((s) => {
      const fneEnriquecido = s.data
        ? { ...fne, registros: enriquecerFNEUsados(fne.registros, s.data.vehiculos) }
        : fne;
      return {
        fne: fneEnriquecido,
        fneError: null,
        fneLoading: false,
        logisticaPorVin: buildLogisticaPorVin(s.logisticaRoma, s.logisticaSTLI, s.data, fneEnriquecido, s.romiaSchiapp, s.romiaKar),
      };
    }),
  setLogisticaRoma: (roma) =>
    set((s) => ({
      logisticaRoma: roma,
      logisticaPorVin: buildLogisticaPorVin(roma, s.logisticaSTLI, s.data, s.fne, s.romiaSchiapp, s.romiaKar),
      logisticaError: null,
      logisticaLoading: false,
    })),
  setLogisticaSTLI: (stli) =>
    set((s) => ({
      logisticaSTLI: stli,
      logisticaPorVin: buildLogisticaPorVin(s.logisticaRoma, stli, s.data, s.fne, s.romiaSchiapp, s.romiaKar),
      logisticaError: null,
      logisticaLoading: false,
    })),
  setRomiaSchiapp: (rows) =>
    set((s) => ({
      romiaSchiapp: rows,
      logisticaPorVin: buildLogisticaPorVin(s.logisticaRoma, s.logisticaSTLI, s.data, s.fne, rows, s.romiaKar),
      logisticaError: null,
      logisticaLoading: false,
    })),
  setRomiaKar: (rows) =>
    set((s) => ({
      romiaKar: rows,
      logisticaPorVin: buildLogisticaPorVin(s.logisticaRoma, s.logisticaSTLI, s.data, s.fne, s.romiaSchiapp, rows),
      logisticaError: null,
      logisticaLoading: false,
    })),
  clearLogistica: () =>
    set({
      logisticaRoma: null,
      logisticaSTLI: null,
      romiaSchiapp: null,
      romiaKar: null,
      logisticaPorVin: null,
      logisticaError: null,
      logisticaLoading: false,
    }),
  setLogisticaLoading: (logisticaLoading) => set({ logisticaLoading }),
  setLogisticaError: (logisticaError) => set({ logisticaError, logisticaLoading: false }),
  setSaldos: (saldos) => set({ saldos, saldosError: null, saldosLoading: false }),
  setProvisiones: (provisiones) =>
    set({ provisiones, provisionesError: null, provisionesLoading: false }),
  setLoading: (loading) => set({ loading }),
  setFNELoading: (fneLoading) => set({ fneLoading }),
  setSaldosLoading: (saldosLoading) => set({ saldosLoading }),
  setProvisionesLoading: (provisionesLoading) => set({ provisionesLoading }),
  setError: (error) => set({ error, loading: false }),
  setFNEError: (fneError) => set({ fneError, fneLoading: false }),
  setSaldosError: (saldosError) => set({ saldosError, saldosLoading: false }),
  setProvisionesError: (provisionesError) =>
    set({ provisionesError, provisionesLoading: false }),
  reset: () => set({ data: null, error: null, loading: false }),
  resetFNE: () => set({ fne: null, fneError: null, fneLoading: false }),
  resetSaldos: () => set({ saldos: null, saldosError: null, saldosLoading: false }),
  resetProvisiones: () =>
    set({ provisiones: null, provisionesError: null, provisionesLoading: false }),
}));
