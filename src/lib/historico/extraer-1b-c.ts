/**
 * Histórico Fase 1b-C · Score Velocidad.
 *
 * Pregunta operacional: ¿dónde se consumen los días y quién los consume?
 *
 * Diseño aprobado por usuario:
 *   · Tercer score ORTOGONAL — nunca se combina con Capital ni Gerencial.
 *   · Solo TIEMPO: mediana diasStock, buckets aging, evolución vs N-1, días saldos.
 *   · Sin denominador de ventas (prohibido).
 *   · Drivers centrales VEL1 y VEL2 — sin ellos → score null.
 *   · VEL3 requiere N-1; sin él → null + redistribución.
 *   · VEL5 requiere SALDOS; sin él → null + redistribución.
 *   · VEL4 es INVERSO (% stock < 30 d): más alto = más fresco = mejor.
 *
 * Por marca + global. Atribución delta vive en `atribucion-delta.ts`.
 */

import type { VehiculoUnificado } from "../selectors/vehiculo-unificado";
import { normalizarMarcaOperacional } from "../selectors/owner-operacional";
import type { Contexto1bA } from "./extraer-1b-a";
import {
  buildDriver,
  consolidarScore,
  type Driver,
  type ScoreResult,
} from "./extraer-1b-b";
import {
  AGING_ATADO_DIAS,
  SVE_VEL1_META, SVE_VEL1_MAX, SVE_VEL1_PESO,
  SVE_VEL2_META, SVE_VEL2_MAX, SVE_VEL2_PESO,
  SVE_VEL3_META, SVE_VEL3_MAX, SVE_VEL3_PESO,
  SVE_VEL4_META, SVE_VEL4_MAX, SVE_VEL4_PESO, SVE_VEL4_INVERSO,
  SVE_VEL5_META, SVE_VEL5_MAX, SVE_VEL5_PESO,
} from "./config";

// ────────────────────────────────────────────────────────────────────
// Tipos
// ────────────────────────────────────────────────────────────────────

export interface Extraer1bCInput {
  contexto: Contexto1bA;
  /**
   * Unidades con aging > 180 d en el período N-1 (global).
   * Para VEL3 = aging180Actual − aging180Previo.
   * null = no hay período previo → VEL3 omitido con warning.
   */
  aging180UnidadesGlobalPrevio: number | null;
  /**
   * Aging > 180 d unidades por marca en el período N-1.
   * Mismo patrón para los scores por marca.
   */
  aging180UnidadesPorMarcaPrevio: Record<string, number> | null;
}

export interface Extraer1bCResult {
  scoreVelocidadGlobal: ScoreResult;
  scoreVelocidadPorMarca: Record<string, ScoreResult>;
  warnings: string[];
}

// ────────────────────────────────────────────────────────────────────
// Helpers numéricos
// ────────────────────────────────────────────────────────────────────

/** Mediana robusta. null si lista vacía. */
function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

// ────────────────────────────────────────────────────────────────────
// Agregación por marca (paralelo al de 1b-B)
// ────────────────────────────────────────────────────────────────────

interface VelocidadSnapshot {
  marca: string;
  vus: VehiculoUnificado[];
  diasStockActivo: number[];
  unidadesStockActivo: number;
  unidades60a180: number;
  unidadesMenos30: number;
  unidadesMas180: number;
  /** Suma de días desde fechaVencimiento de saldos vehículo vencidos. */
  sumDiasSaldosVencidos: number;
  /** Cantidad de saldos vehículo con fecha vencida disponible. */
  cantSaldosVencidos: number;
}

function ensureMarca(
  map: Map<string, VelocidadSnapshot>,
  marca: string,
): VelocidadSnapshot {
  let v = map.get(marca);
  if (!v) {
    v = {
      marca,
      vus: [],
      diasStockActivo: [],
      unidadesStockActivo: 0,
      unidades60a180: 0,
      unidadesMenos30: 0,
      unidadesMas180: 0,
      sumDiasSaldosVencidos: 0,
      cantSaldosVencidos: 0,
    };
    map.set(marca, v);
  }
  return v;
}

function agruparPorMarca(vus: VehiculoUnificado[]): VelocidadSnapshot[] {
  const map = new Map<string, VelocidadSnapshot>();

  for (const vu of vus) {
    const marcaCanonica = normalizarMarcaOperacional(
      vu.marca ?? vu.marcaOriginadora ?? "SIN MARCA",
    );
    const v = ensureMarca(map, marcaCanonica);
    v.vus.push(vu);

    // Stock activo · acumulamos días para mediana y buckets aging
    if (vu.enStockActivo) {
      v.unidadesStockActivo++;
      const d = vu.diasStock ?? 0;
      v.diasStockActivo.push(d);
      if (d < 30) v.unidadesMenos30++;
      else if (d >= 60 && d <= 180) v.unidades60a180++;
      if (d > AGING_ATADO_DIAS) v.unidadesMas180++;
    }

    // Saldos vehículo vencidos · solo cuando hay fecha y diasArchivo > 0
    for (const s of vu.saldosDetalle) {
      if (s.categoria !== "vehiculo") continue;
      const dias = s.diasArchivo;
      if (typeof dias === "number" && Number.isFinite(dias) && dias > 0) {
        v.sumDiasSaldosVencidos += dias;
        v.cantSaldosVencidos++;
      }
    }
  }

  return Array.from(map.values());
}

// ────────────────────────────────────────────────────────────────────
// Cálculo Score Velocidad para un snapshot (global o por marca)
// ────────────────────────────────────────────────────────────────────

interface InputScoreVelocidad {
  diasStockActivo: number[];
  unidadesStockActivo: number;
  unidades60a180: number;
  unidadesMenos30: number;
  unidadesMas180Actual: number;
  unidadesMas180Previo: number | null;
  sumDiasSaldosVencidos: number;
  cantSaldosVencidos: number;
}

function calcularScoreVelocidadParaSnapshot(
  args: InputScoreVelocidad,
): ScoreResult {
  // VEL1 — Mediana de diasStock
  const vel1Valor =
    args.diasStockActivo.length > 0 ? mediana(args.diasStockActivo) : null;

  // VEL2 — % stock 60-180 d
  const vel2Valor =
    args.unidadesStockActivo > 0
      ? args.unidades60a180 / args.unidadesStockActivo
      : null;

  // VEL3 — Δ unidades aging > 180 d vs N-1
  const vel3Valor =
    args.unidadesMas180Previo !== null
      ? args.unidadesMas180Actual - args.unidadesMas180Previo
      : null;

  // VEL4 — % stock < 30 d (INVERSO)
  const vel4Valor =
    args.unidadesStockActivo > 0
      ? args.unidadesMenos30 / args.unidadesStockActivo
      : null;

  // VEL5 — Días promedio saldos vehículo vencidos
  const vel5Valor =
    args.cantSaldosVencidos > 0
      ? args.sumDiasSaldosVencidos / args.cantSaldosVencidos
      : null;

  const drivers: Driver[] = [
    buildDriver({
      id: "VEL1",
      nombre: "Días en bodega (mediana)",
      unidad: "dias",
      peso: SVE_VEL1_PESO,
      meta: SVE_VEL1_META,
      max: SVE_VEL1_MAX,
      valor: vel1Valor,
    }),
    buildDriver({
      id: "VEL2",
      nombre: "Stock 60-180 d",
      unidad: "fraccion",
      peso: SVE_VEL2_PESO,
      meta: SVE_VEL2_META,
      max: SVE_VEL2_MAX,
      valor: vel2Valor,
    }),
    buildDriver({
      id: "VEL3",
      nombre: "Δ stock > 180 d vs N-1",
      unidad: "unidades",
      peso: SVE_VEL3_PESO,
      meta: SVE_VEL3_META,
      max: SVE_VEL3_MAX,
      valor: vel3Valor,
    }),
    buildDriver({
      id: "VEL4",
      nombre: "Stock < 30 d (frescura)",
      unidad: "fraccion",
      peso: SVE_VEL4_PESO,
      meta: SVE_VEL4_META,
      max: SVE_VEL4_MAX,
      valor: vel4Valor,
      inverso: SVE_VEL4_INVERSO,
    }),
    buildDriver({
      id: "VEL5",
      nombre: "Días saldos vencidos",
      unidad: "dias",
      peso: SVE_VEL5_PESO,
      meta: SVE_VEL5_META,
      max: SVE_VEL5_MAX,
      valor: vel5Valor,
    }),
  ];

  return consolidarScore({
    drivers,
    driversCentrales: ["VEL1", "VEL2"],
    acciones: {
      VEL1: "Reducir tiempo medio en bodega — política de rotación más agresiva",
      VEL2: "Plan de salida para stock estancado 60-180 d antes de que pase a > 180",
      VEL3: "Stock muerto creciendo vs N-1 — auditar entradas y plan de remate",
      VEL4: "Inventario poco fresco — acelerar incorporación o reducir backlog comercial",
      VEL5: "Saldos vehículos antiguos sin cobrar — escalar cobranza",
    },
    warnings: [],
  });
}

// ────────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────────

export function extraer1bC(input: Extraer1bCInput): Extraer1bCResult {
  const { contexto, aging180UnidadesGlobalPrevio, aging180UnidadesPorMarcaPrevio } =
    input;
  const warnings: string[] = [];

  // ── Agrupación por marca ───────────────────────────────────────
  const porMarca = agruparPorMarca(contexto.vus);

  // ── Agregados globales ─────────────────────────────────────────
  let unidadesMas180Global = 0;
  let unidades60a180Global = 0;
  let unidadesMenos30Global = 0;
  let unidadesStockActivoGlobal = 0;
  const diasStockGlobal: number[] = [];
  let sumSaldosVencidosGlobal = 0;
  let cantSaldosVencidosGlobal = 0;

  for (const m of porMarca) {
    unidadesMas180Global += m.unidadesMas180;
    unidades60a180Global += m.unidades60a180;
    unidadesMenos30Global += m.unidadesMenos30;
    unidadesStockActivoGlobal += m.unidadesStockActivo;
    diasStockGlobal.push(...m.diasStockActivo);
    sumSaldosVencidosGlobal += m.sumDiasSaldosVencidos;
    cantSaldosVencidosGlobal += m.cantSaldosVencidos;
  }

  if (aging180UnidadesGlobalPrevio === null) {
    warnings.push(
      "1b-C: snapshot N-1 ausente · VEL3 (Δ stock > 180) omitido en global y por marca",
    );
  }

  // ── Score Velocidad GLOBAL ─────────────────────────────────────
  const scoreVelocidadGlobal = calcularScoreVelocidadParaSnapshot({
    diasStockActivo: diasStockGlobal,
    unidadesStockActivo: unidadesStockActivoGlobal,
    unidades60a180: unidades60a180Global,
    unidadesMenos30: unidadesMenos30Global,
    unidadesMas180Actual: unidadesMas180Global,
    unidadesMas180Previo: aging180UnidadesGlobalPrevio,
    sumDiasSaldosVencidos: sumSaldosVencidosGlobal,
    cantSaldosVencidos: cantSaldosVencidosGlobal,
  });

  // ── Score Velocidad POR MARCA ──────────────────────────────────
  const scoreVelocidadPorMarca: Record<string, ScoreResult> = {};

  for (const m of porMarca) {
    const previoMarca =
      aging180UnidadesPorMarcaPrevio?.[m.marca] ?? null;
    const sc = calcularScoreVelocidadParaSnapshot({
      diasStockActivo: m.diasStockActivo,
      unidadesStockActivo: m.unidadesStockActivo,
      unidades60a180: m.unidades60a180,
      unidadesMenos30: m.unidadesMenos30,
      unidadesMas180Actual: m.unidadesMas180,
      unidadesMas180Previo: previoMarca,
      sumDiasSaldosVencidos: m.sumDiasSaldosVencidos,
      cantSaldosVencidos: m.cantSaldosVencidos,
    });
    scoreVelocidadPorMarca[m.marca] = sc;
  }

  return {
    scoreVelocidadGlobal,
    scoreVelocidadPorMarca,
    warnings,
  };
}

// ────────────────────────────────────────────────────────────────────
// Helper para que el orquestador construya el map por marca del previo
// ────────────────────────────────────────────────────────────────────

/**
 * Reconstruye `aging180UnidadesPorMarca` desde un Map de VUs.
 * Útil cuando ya tenemos el snapshot previo rehidratado.
 */
export function aging180UnidadesPorMarcaDeVUs(
  vus: VehiculoUnificado[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const vu of vus) {
    if (!vu.enStockActivo) continue;
    if ((vu.diasStock ?? 0) <= AGING_ATADO_DIAS) continue;
    const marca = normalizarMarcaOperacional(
      vu.marca ?? vu.marcaOriginadora ?? "SIN MARCA",
    );
    out[marca] = (out[marca] ?? 0) + 1;
  }
  return out;
}
