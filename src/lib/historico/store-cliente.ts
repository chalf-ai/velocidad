/**
 * STORE CLIENTE — Vista Histórica /velocidad-operacional.
 *
 * Zustand dedicado y aislado: NO comparte estado con `useExcelStore` ni con
 * `useIngestaStore`. Mantiene en memoria los cortes parseados, los históricos
 * consolidados y el `ResultadoCruce` listo para la UI.
 *
 * Cero persistencia. Al refrescar el navegador, todo se va.
 */

"use client";

import { create } from "zustand";
import type { HistoricoRoma } from "./consolidador.js";
import type { HistoricoActas } from "./consolidador-actas.js";
import type { ResultadoCruce, SnapshotRomia } from "./cruce-roma-actas.js";

export interface CargaRomaMeta {
  mes: string;
  archivoNombre: string;
  archivoSize: number;
  filas: number;
  corte: string;
  confianzaMesDeteccion: string;
}

export interface CargaActasMeta {
  archivoNombre: string;
  archivoSize: number;
  filas: number;
  corte: string;
  confianzaCorte: string;
}

export interface CargaRomiaMeta {
  archivoNombre: string;
  archivoSize: number;
  vins: number;
}

export interface CargaError {
  archivoNombre: string;
  mensaje: string;
}

export interface CargaProgreso {
  enCurso: boolean;
  total: number;
  procesados: number;
  archivoActual: string | null;
}

export interface HistoricoState {
  // Metadatos por fuente
  cargasRoma: CargaRomaMeta[];
  cargaActas: CargaActasMeta | null;
  cargaSchiapp: CargaRomiaMeta | null;
  cargaKar: CargaRomiaMeta | null;

  // Estructuras en memoria
  historicoRoma: HistoricoRoma | null;
  historicoActas: HistoricoActas | null;
  romiaSnapshot: SnapshotRomia | null;
  cruce: ResultadoCruce | null;

  // Estado de proceso
  progreso: CargaProgreso;
  errores: CargaError[];

  // Mutadores
  setHistoricoRoma: (h: HistoricoRoma, cargas: CargaRomaMeta[]) => void;
  setHistoricoActas: (h: HistoricoActas, c: CargaActasMeta) => void;
  setRomiaSchiapp: (c: CargaRomiaMeta) => void;
  setRomiaKar: (c: CargaRomiaMeta) => void;
  setSnapshotRomia: (s: SnapshotRomia) => void;
  setCruce: (c: ResultadoCruce) => void;
  setProgreso: (p: Partial<CargaProgreso>) => void;
  addError: (e: CargaError) => void;
  resetAll: () => void;
}

const ESTADO_INICIAL = {
  cargasRoma: [] as CargaRomaMeta[],
  cargaActas: null,
  cargaSchiapp: null,
  cargaKar: null,
  historicoRoma: null,
  historicoActas: null,
  romiaSnapshot: null,
  cruce: null,
  progreso: { enCurso: false, total: 0, procesados: 0, archivoActual: null },
  errores: [] as CargaError[],
};

export const useHistoricoStore = create<HistoricoState>((set) => ({
  ...ESTADO_INICIAL,

  setHistoricoRoma: (h, cargas) =>
    set(() => ({ historicoRoma: h, cargasRoma: cargas })),
  setHistoricoActas: (h, c) =>
    set(() => ({ historicoActas: h, cargaActas: c })),
  setRomiaSchiapp: (c) => set(() => ({ cargaSchiapp: c })),
  setRomiaKar: (c) => set(() => ({ cargaKar: c })),
  setSnapshotRomia: (s) => set(() => ({ romiaSnapshot: s })),
  setCruce: (c) => set(() => ({ cruce: c })),
  setProgreso: (p) => set((s) => ({ progreso: { ...s.progreso, ...p } })),
  addError: (e) => set((s) => ({ errores: [...s.errores, e] })),
  resetAll: () => set(() => ({ ...ESTADO_INICIAL, errores: [], cargasRoma: [] })),
}));

/** ¿Hay datos suficientes para mostrar los ejes? */
export function tieneDatosMinimos(s: HistoricoState): boolean {
  return s.cargasRoma.length > 0 && s.cargaActas !== null;
}
