/**
 * SCORE GERENCIAL DE EFICIENCIA DE CAPITAL.
 *
 * Mide cómo el gerente de marca administra el capital de su unidad, con 4
 * indicadores aprobados y pesos fijos:
 *
 *   1. Stock pagado (40)        · stockPagado / stockActivoValorizado ≤ 5%
 *   2. Provisiones >90d (40)    · count(saldo≠0 · aging>90) = 0
 *   3. Crédito Pompeyo >15d (10) · count(VIN con CP · dias>15) = 0
 *   4. Saldos vehículo T3+ (10) · sum(saldoT3+) / sum(saldosVehículo) ≤ 15%
 *
 * Las 4 métricas se computan desde la FUENTE ÚNICA `capital-trabajo.ts` — la
 * misma que consume Tendencias. Score y Tendencias NO mantienen definiciones
 * paralelas (decisión de negocio 2026-06).
 *
 * Cada indicador entrega puntos LINEALES entre la meta (puntos completos)
 * y el "valorMax" (cero puntos). Cumplimiento parcial, no binario.
 *
 * Score total = p1 + p2 + p3 + p4 ∈ [0, 100].
 *
 * NO toca Prisma/parsers/package.json. Función pura, cero React.
 */

import type { SaldoRegistro, ProvisionRegistro } from "../types";
import type { VehiculoUnificado } from "./vehiculo-unificado";
import { diasMaxCreditoPompeyo } from "../gestion/caso";
import {
  stockPagado,
  stockActivoValorizado,
  provisiones90,
  creditoPompeyo15,
  saldosT3 as saldosT3Metrica,
} from "./capital-trabajo";

// ─── Umbrales (calibrables sin cambiar lógica) ──────────────────────────────

export const PESO_I1 = 40;
export const PESO_I2 = 40;
export const PESO_I3 = 10;
export const PESO_I4 = 10;
export const PESO_TOTAL = 100;

export const META_STOCK_PROPIO_PCT = 5;    // ≤5% = OK
export const MAX_STOCK_PROPIO_PCT = 20;    // ≥20% = 0 pts
export const META_PROV_90D = 0;            // 0 casos = OK
export const MAX_PROV_90D = 10;            // ≥10 casos = 0 pts
export const META_CP_15D = 0;
export const MAX_CP_15D = 5;
export const META_SALDOS_T3_PCT = 15;
export const MAX_SALDOS_T3_PCT = 40;

export const ESTADO_BUENO = 85;
export const ESTADO_RIESGO = 60;

export type EstadoScore = "bueno" | "riesgo" | "critico";

export type IndicadorId = "stock_propio" | "provisiones_90d" | "cp_15d" | "saldos_t3";

export interface Indicador {
  id: IndicadorId;
  nombre: string;
  /** Texto legible de la meta — para mostrar en la card. */
  metaTexto: string;
  /** Valor actual en formato canónico para presentación (con sufijo). */
  valorTexto: string;
  /** Valor numérico crudo (% o conteo, según indicador). */
  valor: number;
  /** Dato secundario opcional (ej. "12 VIN · 8% por unidades"). */
  detalle?: string;
  /** Nota chica explicativa (ej. excepciones aplicadas al universo). */
  nota?: string;
  /** Monto asociado al castigo (universo del indicador). */
  monto: number;
  /** Cantidad de casos afectados (universo del indicador). */
  casos: number;
  puntos: number;
  peso: number;
  cumple: boolean;
  /** Acción operacional sugerida — copy literal pedido por el usuario. */
  accion: string;
  /** color HEX del indicador (semántico). */
  color: string;
}

export interface PlanItem {
  indicador: IndicadorId;
  accion: string;
  puntosGanables: number;
}

export interface ScoreGerencialResultado {
  /** Marca activa (label legible). */
  marca: string;
  /** Score 0..100 redondeado. */
  score: number;
  estado: EstadoScore;
  /** Universo financiero asociado a la marca (para el bloque hero). */
  capitalGestionado: {
    stockTotal: number;
    stockPropio: number;
    fne: number;
    saldos: number;
    provisiones: number;
  };
  indicadores: Indicador[];
  /** Acciones priorizadas para subir el score (mayor impacto primero). */
  plan: PlanItem[];
  /** VINs / saldos / provisiones que caen en cada indicador (para drill). */
  drill: {
    stockPropio: VehiculoUnificado[];
    provisiones90d: ProvisionRegistro[];
    cp15d: VehiculoUnificado[];
    saldosT3: SaldoRegistro[];
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function puntosLineal(
  valor: number,
  meta: number,
  valorMax: number,
  peso: number,
): number {
  if (valor <= meta) return peso;
  if (valor >= valorMax) return 0;
  const frac = (valorMax - valor) / (valorMax - meta);
  return Math.round(peso * frac);
}

function colorEstado(estado: EstadoScore): string {
  if (estado === "bueno") return "var(--color-ok)";
  if (estado === "riesgo") return "var(--color-warning)";
  return "var(--color-danger)";
}

export function colorScore(score: number): string {
  return colorEstado(
    score >= ESTADO_BUENO ? "bueno" : score >= ESTADO_RIESGO ? "riesgo" : "critico",
  );
}

// ─── Cálculo principal ─────────────────────────────────────────────────────

export interface ScoreGerencialInput {
  marca: string;
  /** Vehículos unificados YA filtrados por marca/sucursal globales.
   *  El selector trabaja exclusivamente sobre estos — `tipoStock` y
   *  `costoNeto` ya están en cada VU. */
  vus: VehiculoUnificado[];
  saldos: SaldoRegistro[];
  provisiones: ProvisionRegistro[];
}

export function calcularScoreGerencial(input: ScoreGerencialInput): ScoreGerencialResultado {
  const { marca, vus, saldos, provisiones } = input;

  // ─── 1. Stock pagado · stockPagado / stockActivoValorizado ─────────────
  // FUENTE ÚNICA (capital-trabajo.ts) — el MISMO número que muestra Tendencias.
  // Reemplaza el antiguo "Stock Propio" (tipoStock Propio/FinPropio + condición
  // oficial), que mezclaba test cars y autos NO pagados y NO era capital de
  // trabajo. El KPI correcto es lo PAGADO e inmovilizado: `Pagado?`=pagado ∧ en
  // stock activo ∧ NO Judicial. Denominador = stock activo no-judicial (mismo
  // universo, sin el flag pagado). Judicial queda fuera (num y denom).
  const mPagado = stockPagado(vus);
  const mActivo = stockActivoValorizado(vus);
  const capitalPagado = mPagado.monto;
  const unidadesPagado = mPagado.unidades;
  const stockValorizado = mActivo.monto;
  const unidadesStock = mActivo.unidades;
  const pctStockPagado = stockValorizado > 0
    ? (capitalPagado / stockValorizado) * 100
    : 0;
  const p1 = puntosLineal(pctStockPagado, META_STOCK_PROPIO_PCT, MAX_STOCK_PROPIO_PCT, PESO_I1);
  const drillStockPagado = mPagado.items;

  // Conteo de Judicial de la marca · solo para la nota del indicador (Judicial
  // queda fuera del score, num y denom). El detalle Stock No Disponible
  // (universo stockAB="B") se arma aparte, desde el store crudo.
  const judicialMarca = vus.filter((vu) => vu.enStockActivo && vu.stockAB === "Judicial").length;

  // ─── 2. Provisiones envejecidas >90d · FUENTE ÚNICA ───────────────────
  // saldo ABIERTO (saldo ≠ 0) con aging > 90 días — definición en capital-trabajo.ts.
  const mProv90 = provisiones90(provisiones);
  const prov90 = mProv90.items;
  const p2 = puntosLineal(prov90.length, META_PROV_90D, MAX_PROV_90D, PESO_I2);
  const montoProv90 = mProv90.monto;

  // ─── 3. Crédito Pompeyo >15d · FUENTE ÚNICA ───────────────────────────
  const mCP15 = creditoPompeyo15(vus);
  const cp15 = mCP15.items;
  const p3 = puntosLineal(cp15.length, META_CP_15D, MAX_CP_15D, PESO_I3);
  const montoCP = mCP15.monto;

  // ─── 4. Saldos vehículo T3+ · monto T3+ / monto total vehículo ────────
  // Numerador (T3+) desde FUENTE ÚNICA; denominador = TODO saldo vehículo (base
  // del ratio, no es una de las 4 métricas).
  const mSaldosT3 = saldosT3Metrica(saldos);
  const saldosT3 = mSaldosT3.items;
  const saldosVeh = saldos.filter((r) => r.categoria === "vehiculo");
  const montoSaldosVeh = saldosVeh.reduce((s, r) => s + (r.saldoXDocumentar ?? 0), 0);
  const montoSaldosT3 = mSaldosT3.monto;
  const pctSaldosT3 = montoSaldosVeh > 0 ? (montoSaldosT3 / montoSaldosVeh) * 100 : 0;
  const p4 = puntosLineal(pctSaldosT3, META_SALDOS_T3_PCT, MAX_SALDOS_T3_PCT, PESO_I4);
  const pctSaldosT3Unidades = saldosVeh.length > 0
    ? (saldosT3.length / saldosVeh.length) * 100
    : 0;

  // ─── Score total + estado ──────────────────────────────────────────────
  const score = Math.max(0, Math.min(100, Math.round(p1 + p2 + p3 + p4)));
  const estado: EstadoScore =
    score >= ESTADO_BUENO ? "bueno" : score >= ESTADO_RIESGO ? "riesgo" : "critico";

  // ─── Indicadores empaquetados ──────────────────────────────────────────
  const indicadores: Indicador[] = [
    {
      // id interno estable "stock_propio" (clave histórica + UI); el KPI ahora
      // es Stock Pagado — capital propio efectivamente desembolsado e inmovilizado.
      id: "stock_propio",
      nombre: "Stock pagado",
      metaTexto: `≤ ${META_STOCK_PROPIO_PCT}% del stock activo valorizado`,
      valorTexto: `${pctStockPagado.toFixed(1)}%`,
      valor: pctStockPagado,
      detalle: `${unidadesPagado} de ${unidadesStock} VIN · ${
        unidadesStock > 0
          ? ((unidadesPagado / unidadesStock) * 100).toFixed(0)
          : 0
      }% por unidades`,
      // Nota chica · Judicial (columna oficial Stock A/B) queda fuera del score.
      nota:
        judicialMarca > 0
          ? `Judicial (${judicialMarca}) fuera del score · ver Stock No Disponible`
          : undefined,
      monto: capitalPagado,
      casos: unidadesPagado,
      puntos: p1,
      peso: PESO_I1,
      cumple: pctStockPagado <= META_STOCK_PROPIO_PCT,
      accion: "Reducir stock pagado · vender o pasar a Floor Plan.",
      color: "#1F2A44",
    },
    {
      id: "provisiones_90d",
      nombre: "Provisiones >90 días",
      metaTexto: `${META_PROV_90D} casos no facturados >90d`,
      valorTexto: `${prov90.length} casos`,
      valor: prov90.length,
      detalle: prov90.length > 0
        ? `Aging máximo ${Math.max(...prov90.map((p) => p.agingDias ?? 0))}d`
        : "Sin provisiones envejecidas",
      monto: montoProv90,
      casos: prov90.length,
      puntos: p2,
      peso: PESO_I2,
      cumple: prov90.length <= META_PROV_90D,
      accion: "Facturar o reversar provisiones envejecidas.",
      color: "#B83B6A",
    },
    {
      id: "cp_15d",
      nombre: "Crédito Pompeyo >15 días",
      metaTexto: `${META_CP_15D} CP >15d desde factura`,
      valorTexto: `${cp15.length} casos`,
      valor: cp15.length,
      detalle: cp15.length > 0
        ? `Aging máximo ${Math.max(
            ...cp15.map((vu) => diasMaxCreditoPompeyo(vu) ?? 0),
          )}d`
        : "Sin CP envejecidos",
      monto: montoCP,
      casos: cp15.length,
      puntos: p3,
      peso: PESO_I3,
      cumple: cp15.length <= META_CP_15D,
      accion: "Cobrar o cerrar gestión de CP envejecidos.",
      color: "#8E44AD",
    },
    {
      id: "saldos_t3",
      nombre: "Saldos vehículo T3+",
      metaTexto: `≤ ${META_SALDOS_T3_PCT}% del saldo vehículo total`,
      valorTexto: `${pctSaldosT3.toFixed(1)}%`,
      valor: pctSaldosT3,
      detalle: `${saldosT3.length} de ${saldosVeh.length} saldos · ${pctSaldosT3Unidades.toFixed(0)}% por unidades`,
      monto: montoSaldosT3,
      casos: saldosT3.length,
      puntos: p4,
      peso: PESO_I4,
      cumple: pctSaldosT3 <= META_SALDOS_T3_PCT,
      accion: "Cobrar saldos vehículo en tramos >30 días.",
      color: "#E67E22",
    },
  ];

  // ─── Plan "Cómo llegar a 100" ───────────────────────────────────────────
  const plan: PlanItem[] = indicadores
    .map((ind) => ({
      indicador: ind.id,
      accion: ind.accion,
      puntosGanables: ind.peso - ind.puntos,
    }))
    .filter((p) => p.puntosGanables > 0)
    .sort((a, b) => b.puntosGanables - a.puntosGanables);

  // ─── Capital gestionado (hero) ──────────────────────────────────────────
  // FNE = sum valorFactura de vus.enFNE; saldos = total saldo vehículo;
  // provisiones = monto total no facturado activo de la marca.
  const fne = vus.filter((vu) => vu.enFNE).reduce(
    (s, vu) => s + vu.capitalComprometido,
    0,
  );
  const provActivo = provisiones
    .filter((p) => p.estado === "no_facturada")
    .reduce((s, p) => s + (p.montoProvision ?? 0), 0);

  return {
    marca,
    score,
    estado,
    capitalGestionado: {
      stockTotal: stockValorizado,
      // campo `stockPropio` (clave estable) ahora porta el monto de Stock Pagado.
      stockPropio: capitalPagado,
      fne,
      saldos: montoSaldosVeh,
      provisiones: provActivo,
    },
    indicadores,
    plan,
    drill: {
      stockPropio: drillStockPagado,
      provisiones90d: prov90,
      cp15d: cp15,
      saldosT3: saldosT3,
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Velocity OS rename · "Score Gerencial" antiguo → "Score Higiene Capital"
//
// Decisión usuario 2026-06 (Fase 1b-B): el nuevo Score Gerencial del
// Velocity OS mide DISCIPLINA OPERACIONAL (alertas, brechas, reincidencia),
// no higiene financiera. El score histórico que vive en este archivo mide
// HIGIENE DE CAPITAL (Stock Pagado, Provisiones >90d, CP >15d, Saldos T3+).
//
// Para evitar convivencia ambigua de dos "Scores Gerenciales", el legacy
// se renombra a `calcularScoreHigieneCapital`. Mantenemos `calcularScoreGerencial`
// como alias DEPRECATED por compatibilidad con la UI vivo — se migra cuando
// se toque UI en una fase posterior (NO en 1b-B).
// ────────────────────────────────────────────────────────────────────

/**
 * Score de HIGIENE de capital (Stock Pagado, Provisiones >90d, CP >15d, Saldos T3+).
 * Lectura financiera. NO es el Score Gerencial del Velocity OS histórico
 * (ese mide disciplina operacional · ver `extraer-1b-b.ts`).
 */
export const calcularScoreHigieneCapital = calcularScoreGerencial;
export type ScoreHigieneCapitalResultado = ScoreGerencialResultado;
export type ScoreHigieneCapitalInput = ScoreGerencialInput;
