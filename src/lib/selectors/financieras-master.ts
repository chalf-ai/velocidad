/**
 * MAESTRO FINANCIERO OFICIAL — marca → financiera (validado a mano).
 *
 * FASE: Tesorería · Líneas de financiamiento — Conciliación financiera.
 *
 * Problema que resuelve: hoy la financiera de cada marca se INFIERE desde la
 * hoja AUX Financiera, y esa inferencia NO cuadra con la realidad (el Dashboard
 * mostraba FORUM ≈ $32B asumiendo marcas que en verdad son BANSA). El sistema
 * NO puede asumir la financiera por inferencia: necesita una fuente oficial.
 *
 * Este maestro es la ÚNICA fuente de verdad de la relación marca → financiera.
 * Todo lo que no esté aquí se trata como "En conciliación" (dato financiero NO
 * validado) — se sigue mostrando, pero marcado explícitamente.
 *
 * IMPORTANTE: este módulo es PURO (no toca parsers, Dashboard, líneas ni el
 * store). Es la base; el rewireo de los módulos para usarlo + los badges de
 * "en conciliación" se hará cuando se complete la spec de la fase.
 */

import type { LineaCredito } from "../types";

export type FinancieraOficial = "BANSA" | "FORUM";

/**
 * Mapping oficial validado por el negocio (no inferir, no adivinar).
 * Llaves en forma normalizada (MAYÚSCULAS, espacios colapsados).
 */
const MASTER: Record<string, FinancieraOficial> = {
  CITROEN: "BANSA",
  DFSK: "BANSA",
  LEAPMOTOR: "BANSA",
  GEELY: "FORUM",
  "KIA MOTORS": "FORUM",
  LANDKING: "FORUM",
  MG: "BANSA",
  "DONGFENG/NAMMI": "FORUM",
  NISSAN: "BANSA",
  "NISSAN FLOTAS": "BANSA",
  OPEL: "BANSA",
  PEUGEOT: "BANSA",
  SUBARU: "BANSA",
  USADOS: "BANSA",
};

/** Etiqueta para datos financieros todavía sin validar contra el maestro. */
export const EN_CONCILIACION = "En conciliación";

function normMarca(m: string | null | undefined): string {
  return (m ?? "").toUpperCase().replace(/\s+/g, " ").trim();
}

export interface ResultadoFinanciera {
  /** Financiera oficial o null si la marca no está en el maestro. */
  financiera: FinancieraOficial | null;
  /** true = validado contra el maestro; false = en conciliación. */
  validado: boolean;
}

/**
 * Devuelve la financiera OFICIAL de una marca. Si no está en el maestro,
 * `validado: false` y `financiera: null` (= dato en conciliación).
 * Acepta la marca de línea o la marca Pompeyo (intenta ambas).
 */
export function financieraOficial(
  marca: string | null | undefined,
  marcaAlt?: string | null,
): ResultadoFinanciera {
  const k1 = normMarca(marca);
  if (MASTER[k1]) return { financiera: MASTER[k1], validado: true };
  if (marcaAlt) {
    const k2 = normMarca(marcaAlt);
    if (MASTER[k2]) return { financiera: MASTER[k2], validado: true };
  }
  return { financiera: null, validado: false };
}

/** Marcas que tienen financiera oficial confirmada. */
export const MARCAS_MASTER: string[] = Object.keys(MASTER);

export interface LineaFinancieraOficial {
  /** "BANSA" | "FORUM" | "En conciliación" */
  financiera: string;
  /** true salvo el grupo "En conciliación". */
  validado: boolean;
  autorizada: number;
  ocupada: number;
  libre: number; // autorizada − ocupada (puede ser negativo = sobregiro)
  sobregiro: number; // max(0, ocupada − autorizada)
  pctOcupacion: number;
  marcas: string[];
}

/**
 * Agrupa líneas por financiera OFICIAL (no inferida). Las marcas que no están
 * en el maestro caen en un grupo "En conciliación" (validado:false) — siguen
 * sumando y mostrándose, pero marcadas para validación manual.
 *
 * No reemplaza a `lineasPorFinanciera` (kpis.ts); es la versión oficial para
 * cuando se conecte la conciliación financiera.
 */
export function lineasPorFinancieraOficial(lineas: LineaCredito[]): LineaFinancieraOficial[] {
  const map = new Map<string, LineaFinancieraOficial>();
  for (const l of lineas) {
    const { financiera, validado } = financieraOficial(l.marca, l.marcaPompeyo);
    const key = financiera ?? EN_CONCILIACION;
    if (!map.has(key)) {
      map.set(key, {
        financiera: key,
        validado,
        autorizada: 0,
        ocupada: 0,
        libre: 0,
        sobregiro: 0,
        pctOcupacion: 0,
        marcas: [],
      });
    }
    const e = map.get(key)!;
    e.autorizada += l.lineaAutorizada;
    e.ocupada += l.lineaOcupada;
    e.marcas.push(l.marca);
  }
  for (const e of map.values()) {
    e.libre = e.autorizada - e.ocupada;
    e.sobregiro = e.ocupada > e.autorizada ? e.ocupada - e.autorizada : 0;
    e.pctOcupacion = e.autorizada > 0 ? e.ocupada / e.autorizada : 0;
  }
  // Validados primero (por ocupada desc); "En conciliación" al final.
  return [...map.values()].sort((a, b) => {
    if (a.validado !== b.validado) return a.validado ? -1 : 1;
    return b.ocupada - a.ocupada;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// FASE #2 · Capa de VALIDACIÓN (no reemplazo).
//
// Muestra lado a lado la financiera que el sistema infiere vs la oficial del
// maestro, si coinciden y si el dato está validado o en conciliación. No
// cambia los cálculos base — solo expone las diferencias para no esconderlas.
// ─────────────────────────────────────────────────────────────────────────

export type EstadoValidacion = "validado" | "diferencia" | "en_conciliacion";

export interface ValidacionFinanciera {
  marca: string;
  /** Lo que el sistema infiere hoy (AUX Financiera). Puede ser null. */
  financieraSistema: string | null;
  /** Lo que dice el maestro oficial. null si la marca no está en el maestro. */
  financieraOficial: FinancieraOficial | null;
  coincide: boolean;
  validado: boolean;
  estado: EstadoValidacion;
  mensaje: string;
}

/** Valida una marca: compara la financiera inferida contra el maestro. */
export function validarFinanciera(
  marca: string,
  financieraSistema: string | null,
  marcaAlt?: string | null,
): ValidacionFinanciera {
  const { financiera: oficial, validado } = financieraOficial(marca, marcaAlt);
  const sysNorm = financieraSistema ? financieraSistema.toUpperCase().trim() : null;

  if (!validado || !oficial) {
    return {
      marca,
      financieraSistema,
      financieraOficial: null,
      coincide: false,
      validado: false,
      estado: "en_conciliacion",
      mensaje: sysNorm
        ? `Sin financiera oficial en el maestro. El sistema infiere ${financieraSistema}. En conciliación.`
        : "Sin financiera oficial en el maestro. En conciliación.",
    };
  }

  const coincide = sysNorm === oficial;
  if (coincide) {
    return {
      marca,
      financieraSistema,
      financieraOficial: oficial,
      coincide: true,
      validado: true,
      estado: "validado",
      mensaje: `Validado contra el maestro: ${oficial}.`,
    };
  }
  return {
    marca,
    financieraSistema,
    financieraOficial: oficial,
    coincide: false,
    validado: true,
    estado: "diferencia",
    mensaje: sysNorm
      ? `El sistema infiere ${financieraSistema}, pero la oficial es ${oficial}. Revisar.`
      : `El sistema no infirió financiera; la oficial es ${oficial}.`,
  };
}

/** Valida todas las líneas. Diferencias primero, luego conciliación, luego OK. */
export function validarFinancieras(lineas: LineaCredito[]): ValidacionFinanciera[] {
  const orden: Record<EstadoValidacion, number> = {
    diferencia: 0,
    en_conciliacion: 1,
    validado: 2,
  };
  return lineas
    .map((l) => validarFinanciera(l.marca, l.financiera, l.marcaPompeyo))
    .sort((a, b) => orden[a.estado] - orden[b.estado] || a.marca.localeCompare(b.marca));
}

export interface StatsValidacionFinanciera {
  total: number;
  validados: number;
  diferencias: number;
  enConciliacion: number;
}

export function statsValidacionFinanciera(
  vals: ValidacionFinanciera[],
): StatsValidacionFinanciera {
  return {
    total: vals.length,
    validados: vals.filter((v) => v.estado === "validado").length,
    diferencias: vals.filter((v) => v.estado === "diferencia").length,
    enConciliacion: vals.filter((v) => v.estado === "en_conciliacion").length,
  };
}
