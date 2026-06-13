/**
 * SCORE GERENCIAL DE EFICIENCIA DE CAPITAL.
 *
 * Mide cómo el gerente de marca administra el capital de su unidad, con 4
 * indicadores aprobados y pesos fijos:
 *
 *   1. Stock propio (40)        · capitalPropio / stockValorizado ≤ 5%
 *   2. Provisiones >90d (40)    · count(no_facturada · aging>90) = 0
 *   3. Crédito Pompeyo >15d (10) · count(VIN con CP · dias>15) = 0
 *   4. Saldos vehículo T3+ (10) · sum(saldoT3+) / sum(saldosVehículo) ≤ 15%
 *
 * Cada indicador entrega puntos LINEALES entre la meta (puntos completos)
 * y el "valorMax" (cero puntos). Cumplimiento parcial, no binario.
 *
 * Score total = p1 + p2 + p3 + p4 ∈ [0, 100].
 *
 * NO toca Prisma/parsers/package.json. Función pura, cero React.
 */

import type { SaldoRegistro, ProvisionRegistro } from "../types";
import { diasMaxCreditoPompeyo } from "../gestion/caso";
import type { VehiculoUnificado } from "./vehiculo-unificado";
import { MARCA_USADOS } from "./owner-operacional";

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

const TRAMOS_T3PLUS = new Set(["T3", "T4", "T5", "T6", "T7"]);

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
    /** Stock B y Judicial de la marca — EXCLUIDOS del numerador del score,
     *  expuestos para el detalle de auditoría (no se ocultan). */
    stockB: VehiculoUnificado[];
    judicial: VehiculoUnificado[];
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

/**
 * Condición de Stock oficial para "Stock Propio" — definición de Control de
 * Gestión (correo validado 2026-06), con criterio SEPARADO por unidad:
 *
 *  · Marcas de NUEVOS: Existencia Nuevos + VN con Patente + Test Cars
 *    (ya sean de SPA o TM). Excluye Renting, Company Car, Sin Match, Activo
 *    Fijo, Existencia Usados, VU por Recibir.
 *  · Unidad USADOS: Existencia Usados (su análogo de stock propio).
 *
 * En AMBOS casos se mantiene el filtro financiero (Tipo Stock = Propio/
 * FinPropio) y se EXCLUYEN Stock B y Judicial (no son meta gerencial — quedan
 * visibles en el detalle de auditoría, no en el numerador del score).
 */
const COND_STOCK_PROPIO_NUEVOS = new Set([
  "EXISTENCIA NUEVOS",
  "VN CON PATENTE",
  "TEST CARS",
]);
const COND_STOCK_PROPIO_USADOS = new Set(["EXISTENCIA USADOS"]);
const normCondicion = (c: string | null | undefined): string =>
  (c ?? "").trim().toUpperCase();

export function calcularScoreGerencial(input: ScoreGerencialInput): ScoreGerencialResultado {
  const { marca, vus, saldos, provisiones } = input;

  // ─── Regla excluyente · USADOS ─────────────────────────────────────────
  // Decisión usuario 2026-06: para la unidad operacional USADOS, el
  // indicador Stock propio debe excluir Stock B y Judicial — esos autos
  // no son meta gerencial normal (Stock B es reacondicionamiento, judicial
  // tiene su propio canal). La exclusión aplica ÚNICAMENTE al indicador
  // stock_propio y SÓLO cuando la marca operacional activa es USADOS.
  // Cualquier otra marca (KIA, Geely, Citroën, etc.) conserva el cálculo
  // original sin cambios.
  const esUsados = marca === MARCA_USADOS;
  const aplicaEnStockPropio = (vu: VehiculoUnificado): boolean => {
    if (!vu.enStockActivo) return false;
    if (esUsados && (vu.esStockB || vu.esJudicial)) return false;
    return true;
  };

  // ─── Numerador Stock Propio · regla oficial (correo Control de Gestión) ──
  // Cuenta como Stock Propio sólo lo que es propio EN CAPITAL (Tipo Stock =
  // Propio/FinPropio) Y de condición oficial — separada por unidad:
  //  · NUEVOS  → Existencia Nuevos · VN con Patente · Test Cars
  //  · USADOS  → Existencia Usados
  // Antes el numerador miraba sólo lo financiero y sumaba Renting, Company Car,
  // Sin Match, Activo Fijo y Existencia Usados de otras marcas.
  //
  // Stock B / Judicial: NO se descuentan acá con el flag heurístico `esStockB`
  // (sobre-clasifica · genera falsos positivos). El numerador se basa SÓLO en
  // la condición oficial; el detalle Stock B/Judicial se arma aparte desde la
  // columna oficial Stock A/B de Base_Stock (ver drill.stockB/judicial).
  //
  // PENDIENTE DE NEGOCIO (no se resuelve acá): el DENOMINADOR (stockValorizado)
  // se mantiene = todo el stock activo; el correo sólo cuestiona el numerador.
  const condicionesPropio = esUsados ? COND_STOCK_PROPIO_USADOS : COND_STOCK_PROPIO_NUEVOS;
  const esPropioOficial = (vu: VehiculoUnificado): boolean =>
    (vu.tipoStock === "Propio" || vu.tipoStock === "FinPropio") &&
    condicionesPropio.has(normCondicion(vu.condicionDeStock));

  // ─── 1. Stock propio · capitalPropio / stockValorizado ──────────────────
  // Universo: VUs con enStockActivo (stock vigente, no FNE ni saldos).
  // Para USADOS, además se excluyen Stock B y Judicial — ver bloque arriba.
  let stockValorizado = 0;
  let capitalPropio = 0;
  let unidadesStock = 0;
  let unidadesPropio = 0;
  for (const vu of vus) {
    if (!aplicaEnStockPropio(vu)) continue;
    const costo = vu.costoNeto ?? 0;
    stockValorizado += costo;
    unidadesStock++;
    if (esPropioOficial(vu)) {
      capitalPropio += costo;
      unidadesPropio++;
    }
  }
  const pctStockPropio = stockValorizado > 0
    ? (capitalPropio / stockValorizado) * 100
    : 0;
  const p1 = puntosLineal(pctStockPropio, META_STOCK_PROPIO_PCT, MAX_STOCK_PROPIO_PCT, PESO_I1);

  // Drill consistente con el numerador: NO listar autos excluidos del cálculo.
  const drillStockPropio = vus.filter(
    (vu) => aplicaEnStockPropio(vu) && esPropioOficial(vu),
  );

  // Auditoría · Stock B y Judicial — fuera del numerador del score (criterio
  // Control de Gestión), pero NO ocultos: se exponen para detalle/auditoría.
  // FUENTE OFICIAL = columna Stock A/B de Base_Stock (stockAB), NO el heurístico
  // `esStockB` (sobre-clasifica). Universo = stock activo de la marca.
  const stockB = vus.filter((vu) => vu.enStockActivo && vu.stockAB === "B");
  const judicial = vus.filter((vu) => vu.enStockActivo && vu.stockAB === "Judicial");

  // ─── 2. Provisiones envejecidas >90d ──────────────────────────────────
  // Criterio alineado con módulo /provisiones (decisión usuario 2026-06):
  // "envejecida" = saldo ABIERTO (saldo ≠ 0) con aging > 90 días.
  // Antes filtraba por estado === "no_facturada" — eso era más estricto y
  // dejaba afuera provisiones parcialmente facturadas con saldo abierto que
  // SÍ están arrastrando capital y SÍ aparecen en /provisiones como críticas.
  // El selector ahora considera el universo COMPLETO de saldos abiertos.
  const prov90 = provisiones.filter(
    (p) => (p.saldo ?? 0) !== 0 && (p.agingDias ?? 0) > 90,
  );
  const p2 = puntosLineal(prov90.length, META_PROV_90D, MAX_PROV_90D, PESO_I2);
  const montoProv90 = prov90.reduce((s, p) => s + (p.saldo ?? 0), 0);

  // ─── 3. Crédito Pompeyo >15d (sobre VUs) ──────────────────────────────
  const cp15 = vus.filter((vu) => {
    if (vu.creditoPompeyo <= 0) return false;
    const d = diasMaxCreditoPompeyo(vu);
    return d != null && d > 15;
  });
  const p3 = puntosLineal(cp15.length, META_CP_15D, MAX_CP_15D, PESO_I3);
  const montoCP = cp15.reduce((s, vu) => s + vu.creditoPompeyo, 0);

  // ─── 4. Saldos vehículo T3+ · monto T3+ / monto total vehículo ────────
  const saldosVeh = saldos.filter((r) => r.categoria === "vehiculo");
  const saldosT3 = saldosVeh.filter((r) => TRAMOS_T3PLUS.has(r.statusDPS));
  const montoSaldosVeh = saldosVeh.reduce((s, r) => s + (r.saldoXDocumentar ?? 0), 0);
  const montoSaldosT3 = saldosT3.reduce((s, r) => s + (r.saldoXDocumentar ?? 0), 0);
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
      id: "stock_propio",
      nombre: "Stock propio",
      metaTexto: `≤ ${META_STOCK_PROPIO_PCT}% del stock valorizado`,
      valorTexto: `${pctStockPropio.toFixed(1)}%`,
      valor: pctStockPropio,
      detalle: `${unidadesPropio} de ${unidadesStock} VIN · ${
        unidadesStock > 0
          ? ((unidadesPropio / unidadesStock) * 100).toFixed(0)
          : 0
      }% por unidades`,
      // Nota chica · Stock B y Judicial (columna oficial Stock A/B) quedan fuera
      // del numerador; visibles en el detalle de auditoría.
      nota:
        stockB.length + judicial.length > 0
          ? `Stock B (${stockB.length}) y Judicial (${judicial.length}) · fuera del score, ver auditoría`
          : undefined,
      monto: capitalPropio,
      casos: unidadesPropio,
      puntos: p1,
      peso: PESO_I1,
      cumple: pctStockPropio <= META_STOCK_PROPIO_PCT,
      accion: "Reducir stock propio · vender o pasar a Floor Plan.",
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
      stockPropio: capitalPropio,
      fne,
      saldos: montoSaldosVeh,
      provisiones: provActivo,
    },
    indicadores,
    plan,
    drill: {
      stockPropio: drillStockPropio,
      provisiones90d: prov90,
      cp15d: cp15,
      saldosT3: saldosT3,
      stockB,
      judicial,
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Velocity OS rename · "Score Gerencial" antiguo → "Score Higiene Capital"
//
// Decisión usuario 2026-06 (Fase 1b-B): el nuevo Score Gerencial del
// Velocity OS mide DISCIPLINA OPERACIONAL (alertas, brechas, reincidencia),
// no higiene financiera. El score histórico que vive en este archivo mide
// HIGIENE DE CAPITAL (Stock Propio, Provisiones >90d, CP >15d, Saldos T3+).
//
// Para evitar convivencia ambigua de dos "Scores Gerenciales", el legacy
// se renombra a `calcularScoreHigieneCapital`. Mantenemos `calcularScoreGerencial`
// como alias DEPRECATED por compatibilidad con la UI vivo — se migra cuando
// se toque UI en una fase posterior (NO en 1b-B).
// ────────────────────────────────────────────────────────────────────

/**
 * Score de HIGIENE de capital (Stock Propio, Provisiones >90d, CP >15d, Saldos T3+).
 * Lectura financiera. NO es el Score Gerencial del Velocity OS histórico
 * (ese mide disciplina operacional · ver `extraer-1b-b.ts`).
 */
export const calcularScoreHigieneCapital = calcularScoreGerencial;
export type ScoreHigieneCapitalResultado = ScoreGerencialResultado;
export type ScoreHigieneCapitalInput = ScoreGerencialInput;
