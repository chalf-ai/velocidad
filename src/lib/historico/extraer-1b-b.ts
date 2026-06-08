/**
 * Histórico Fase 1b-B · Score Capital + Score Gerencial.
 *
 * Diseño aprobado por usuario:
 *   · Dos scores ortogonales (NO se combinan).
 *   · Score Capital responde "¿cómo convierte capital en caja?".
 *   · Score Gerencial responde "¿qué tan disciplinada la operación?".
 *   · Sin denominador de ventas (prohibición explícita usuario).
 *   · Drivers redistribuidos cuando falta fuente — null nunca = 0.
 *   · score = null si drivers centrales ausentes (V1/V2 o G1/G2).
 *   · Reincidencia G5 vs Set vinsEnAlertaCritAlta del período anterior.
 *
 * Funciones puras. Sin dependencias de DB.
 */

import type { VehiculoUnificado } from "../selectors/vehiculo-unificado";
import { normalizarMarcaOperacional } from "../selectors/owner-operacional";
import type { Alerta } from "../types";
import type { Contexto1bA } from "./extraer-1b-a";
import {
  AGING_ATADO_DIAS,
  COBERTURA_MIN_ALTA,
  COBERTURA_MIN_BAJA,
  COBERTURA_MIN_MEDIA,
  SC_V1_META, SC_V1_MAX, SC_V1_PESO,
  SC_V2_META, SC_V2_MAX, SC_V2_PESO,
  SC_V3_META, SC_V3_MAX, SC_V3_PESO,
  SC_V4_META, SC_V4_MAX, SC_V4_PESO,
  SC_V5_META, SC_V5_MAX, SC_V5_PESO,
  SC_V6_META, SC_V6_MAX, SC_V6_PESO,
  SC_V6_MIN_MARCAS,
  SG_G1_META, SG_G1_MAX, SG_G1_PESO,
  SG_G2_META, SG_G2_MAX, SG_G2_PESO,
  SG_G3_META, SG_G3_MAX, SG_G3_PESO,
  SG_G4_META, SG_G4_MAX, SG_G4_PESO,
  SG_G5_META, SG_G5_MAX, SG_G5_PESO,
  UMBRAL_MARCA_BRECHA,
} from "./config";

// ────────────────────────────────────────────────────────────────────
// Tipos públicos
// ────────────────────────────────────────────────────────────────────

export type Confianza = "alta" | "media" | "baja";
export type Direccion = "positivo" | "negativo";

export interface Driver {
  /** Identificador estable: "V1", "G2", etc. */
  id: string;
  /** Etiqueta human-readable corta. */
  nombre: string;
  /** Valor medido del driver (en su unidad natural). null si no se pudo calcular. */
  valor: number | null;
  /** Unidad textual del valor (para UI). */
  unidad: string;
  /** Peso nominal (suma 100 sobre todos los drivers). */
  peso: number;
  /** Peso efectivo tras redistribución por drivers ausentes. */
  pesoEfectivo: number;
  /**
   * Puntos de penalización aplicados al score (sobre el peso efectivo).
   * 0 = driver en meta. pesoEfectivo = driver en máx (peor caso).
   */
  puntos: number;
  /**
   * Dirección semántica para narración:
   *   "negativo" = el driver está restando puntos al score (peor que meta).
   *   "positivo" = el driver está en meta (sin penalización).
   */
  direccion: Direccion;
  /** Meta del driver (0 puntos). */
  meta: number;
  /** Máx del driver (peso completo restado). */
  max: number;
  /**
   * Driver INVERSO: el valor "bueno" es ≥ meta y el "malo" es ≤ max.
   * Caso típico: VEL4 (% stock < 30 d) — más fresco = mejor.
   * Default false (driver normal: bajo = bueno, alto = malo).
   */
  inverso?: boolean;
}

export interface ScoreResult {
  /** Score 0-100 redondeado. null si confianza < BAJA o falta driver central. */
  score: number | null;
  /** Drivers calculados (presentes y ausentes ambos, con valor=null si ausente). */
  drivers: Driver[];
  /** Ids de drivers cuyo valor quedó null. */
  driversFaltantes: string[];
  /** Σ pesos de drivers presentes (sobre 100). */
  pesoCubierto: number;
  /** Clasificación de confianza según pesoCubierto. */
  confianza: Confianza | null;
  /** Driver con MÁS puntos negativos. Empate → el de mayor peso nominal. */
  causaRaizPrincipal: string;
  /** Acción operacional sugerida derivada del driver dominante. */
  accionSugerida: string;
  /** Warnings de cálculo (drivers ausentes, redistribuciones, etc). */
  warnings: string[];
}

/** Resultado por marca y global del bloque 1b-B. */
export interface Extraer1bBResult {
  /** Score Capital agregado Pompeyo. */
  scoreCapitalGlobal: ScoreResult;
  /** Score Gerencial agregado Pompeyo. */
  scoreGerencialGlobal: ScoreResult;
  /** Score Capital por marca (key = marca canónica). */
  scoreCapitalPorMarca: Record<string, ScoreResult>;
  /** Score Gerencial por marca. */
  scoreGerencialPorMarca: Record<string, ScoreResult>;
  /** Marcas con scoreGerencial < UMBRAL_MARCA_BRECHA (para `marcasConBrechas` 1b-A). */
  marcasConBrechas: number | null;
  /** Lista de marcas bajo umbral (para drill). */
  marcasBajoUmbral: string[];
  /**
   * Conjunto de VINs en alerta crítica+alta del período actual.
   * Se persiste en scoreComponentes JSON para alimentar G5 del siguiente período.
   */
  vinsEnAlertaCritAlta: string[];
  warnings: string[];
}

export interface Extraer1bBInput {
  contexto: Contexto1bA;
  /** vinsEnAlertaCritAlta del período N-1 si existe (para G5). null = primer período. */
  vinsEnAlertaCritAltaPrevio: Set<string> | null;
}

// ────────────────────────────────────────────────────────────────────
// Helpers de cálculo
// ────────────────────────────────────────────────────────────────────

/**
 * Penalización lineal entre meta y max, clampeada [0, peso].
 *
 * Driver normal (inverso=false):
 *   · valor ≤ meta → 0 puntos (sano)
 *   · valor ≥ max  → peso completo (peor caso)
 *   · entre meta y max → lineal
 *
 * Driver INVERSO (inverso=true):
 *   · valor ≥ meta → 0 puntos (sano)
 *   · valor ≤ max  → peso completo
 *   · entre max y meta → lineal
 *
 * Exportado para reuso desde 1b-C.
 */
export function penalizar(
  valor: number,
  meta: number,
  max: number,
  peso: number,
  inverso = false,
): number {
  if (inverso) {
    if (valor >= meta) return 0;
    if (valor <= max) return peso;
    return (peso * (meta - valor)) / (meta - max);
  }
  if (valor <= meta) return 0;
  if (valor >= max) return peso;
  return (peso * (valor - meta)) / (max - meta);
}

export function clasificarConfianza(pesoCubierto: number): Confianza | null {
  if (pesoCubierto >= COBERTURA_MIN_ALTA) return "alta";
  if (pesoCubierto >= COBERTURA_MIN_MEDIA) return "media";
  if (pesoCubierto >= COBERTURA_MIN_BAJA) return "baja";
  return null;
}

/**
 * Construye un Driver dado su definición y el valor medido.
 * Si valor=null el driver queda marcado como ausente (pesoEfectivo se ajusta
 * en `consolidarScore`).
 *
 * Exportado para reuso desde 1b-C.
 */
export function buildDriver(args: {
  id: string;
  nombre: string;
  unidad: string;
  peso: number;
  meta: number;
  max: number;
  valor: number | null;
  inverso?: boolean;
}): Driver {
  const { valor, peso, meta, max, inverso = false } = args;
  if (valor === null) {
    return {
      ...args,
      inverso,
      pesoEfectivo: 0,
      puntos: 0,
      direccion: "negativo",
    };
  }
  const penal = penalizar(valor, meta, max, peso, inverso);
  return {
    ...args,
    inverso,
    pesoEfectivo: peso, // se ajustará si hay redistribución
    puntos: penal,
    direccion: penal === 0 ? "positivo" : "negativo",
  };
}

/**
 * Toma drivers crudos (con valor null para ausentes), redistribuye pesos y
 * arma el ScoreResult final con causa raíz y acción.
 *
 * @param driversCentrales ids que si están ausentes → score = null
 * @param acciones map id → acción sugerida cuando ese driver domina
 */
export function consolidarScore(args: {
  drivers: Driver[];
  driversCentrales: string[];
  acciones: Record<string, string>;
  warnings: string[];
}): ScoreResult {
  const { drivers, driversCentrales, acciones } = args;
  const warnings = [...args.warnings];
  const presentes = drivers.filter((d) => d.valor !== null);
  const ausentes = drivers.filter((d) => d.valor === null);

  // Check: si falta driver central → score null
  const faltanCentrales = driversCentrales.filter(
    (id) => ausentes.some((a) => a.id === id),
  );
  const pesoPresente = presentes.reduce((s, d) => s + d.peso, 0);
  const pesoTotal = drivers.reduce((s, d) => s + d.peso, 0);
  const pesoCubierto = Math.round((pesoPresente / pesoTotal) * 100);

  // Redistribuir peso de drivers ausentes proporcionalmente entre presentes.
  // pesoEfectivo_i = peso_i · (pesoTotal / pesoPresente)
  const factorEscala = pesoPresente > 0 ? pesoTotal / pesoPresente : 1;
  for (const d of presentes) {
    d.pesoEfectivo = d.peso * factorEscala;
    // re-escalar puntos también (penalización proporcional al peso efectivo)
    d.puntos = (d.puntos / d.peso) * d.pesoEfectivo;
  }

  for (const a of ausentes) {
    warnings.push(`Driver ${a.id} (${a.nombre}) ausente · peso ${a.peso} redistribuido`);
  }

  if (faltanCentrales.length > 0) {
    warnings.push(
      `Drivers centrales ausentes (${faltanCentrales.join(", ")}) · score = null por política`,
    );
    return {
      score: null,
      drivers,
      driversFaltantes: ausentes.map((a) => a.id),
      pesoCubierto,
      confianza: null,
      causaRaizPrincipal: "Datos insuficientes",
      accionSugerida: "Cargar fuentes faltantes para destrabar el cálculo",
      warnings,
    };
  }

  const confianza = clasificarConfianza(pesoCubierto);
  if (!confianza) {
    warnings.push(
      `Cobertura insuficiente (${pesoCubierto}% < ${COBERTURA_MIN_BAJA}%) · score = null`,
    );
    return {
      score: null,
      drivers,
      driversFaltantes: ausentes.map((a) => a.id),
      pesoCubierto,
      confianza: null,
      causaRaizPrincipal: "Cobertura insuficiente",
      accionSugerida: "Cargar más fuentes para subir cobertura",
      warnings,
    };
  }

  const totalPenal = presentes.reduce((s, d) => s + d.puntos, 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - totalPenal)));

  // Causa raíz: driver con MÁS puntos. Empate → mayor peso nominal.
  let causa = presentes[0];
  for (const d of presentes) {
    if (d.puntos > causa.puntos) causa = d;
    else if (d.puntos === causa.puntos && d.peso > causa.peso) causa = d;
  }
  const causaRaizPrincipal =
    causa.puntos === 0
      ? "Todos los drivers en meta — score saludable"
      : `${causa.nombre} (${causa.valor !== null ? fmtUnidad(causa.valor, causa.unidad) : "n/d"})`;
  const accionSugerida =
    causa.puntos === 0
      ? "Mantener disciplina actual"
      : acciones[causa.id] ?? "Revisar el driver dominante";

  return {
    score,
    drivers,
    driversFaltantes: ausentes.map((a) => a.id),
    pesoCubierto,
    confianza,
    causaRaizPrincipal,
    accionSugerida,
    warnings,
  };
}

export function fmtUnidad(v: number, unidad: string): string {
  if (unidad === "fraccion") return `${(v * 100).toFixed(1)}%`;
  if (unidad === "por_100v") return `${v.toFixed(2)} /100v`;
  if (unidad === "gini") return v.toFixed(2);
  if (unidad === "dias") return `${v.toFixed(0)} d`;
  if (unidad === "unidades") return `${v > 0 ? "+" : ""}${v.toFixed(0)} u`;
  return String(v);
}

/** Índice de Gini sobre una lista de valores >= 0. Devuelve null si n<2 o todo cero. */
function gini(valores: number[]): number | null {
  const n = valores.length;
  if (n < 2) return null;
  const xs = [...valores].sort((a, b) => a - b);
  const sum = xs.reduce((s, x) => s + x, 0);
  if (sum <= 0) return null;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (i + 1) * xs[i];
  return (2 * acc) / (n * sum) - (n + 1) / n;
}

// ────────────────────────────────────────────────────────────────────
// Score Capital — cálculo por marca y global
// ────────────────────────────────────────────────────────────────────

interface SnapshotPorMarca {
  marca: string;
  vus: VehiculoUnificado[];
  stockUnidades: number;
  stockMonto: number;
  stockPagadoMonto: number;
  agingMas180Unidades: number;
  agingMas180Monto: number;
  capitalAtado: number;
  capitalTotal: number;
}

/** Agrupa VUs por marca canónica y calcula los agregados necesarios. */
function agruparPorMarca(vus: VehiculoUnificado[]): SnapshotPorMarca[] {
  const map = new Map<string, SnapshotPorMarca>();
  function ensure(m: string): SnapshotPorMarca {
    let s = map.get(m);
    if (!s) {
      s = {
        marca: m,
        vus: [],
        stockUnidades: 0,
        stockMonto: 0,
        stockPagadoMonto: 0,
        agingMas180Unidades: 0,
        agingMas180Monto: 0,
        capitalAtado: 0,
        capitalTotal: 0,
      };
      map.set(m, s);
    }
    return s;
  }

  for (const vu of vus) {
    const marcaCanonica = normalizarMarcaOperacional(
      vu.marca ?? vu.marcaOriginadora ?? "SIN MARCA",
    );
    const s = ensure(marcaCanonica);
    s.vus.push(vu);
    s.capitalTotal += vu.capitalComprometido;

    if (vu.enStockActivo) {
      s.stockUnidades++;
      s.stockMonto += vu.costoNeto;
      // tipoStock está en Vehiculo base; vu solo expone tipoStock cruzado
      // a través de costoNeto y banderas (esPagado, esStockPagadoViejo).
      // Aproximación: si esPagado o esStockPagadoViejo → stock pagado.
      if (vu.esPagado) s.stockPagadoMonto += vu.costoNeto;
      if ((vu.diasStock ?? 0) > AGING_ATADO_DIAS) {
        s.agingMas180Unidades++;
        s.agingMas180Monto += vu.costoNeto;
      }
    }

    const atadoPorAging =
      vu.enStockActivo && (vu.diasStock ?? 0) > AGING_ATADO_DIAS;
    const atadoPorFne = vu.enFNE && (vu.fneDiasFactura ?? 0) > 15;
    const atadoPorSaldos =
      vu.enSaldos &&
      vu.saldosDetalle.some((s2) => (s2.diasArchivo ?? 0) > 90);

    if (atadoPorAging || atadoPorFne || atadoPorSaldos) {
      s.capitalAtado += vu.capitalComprometido;
    }
  }

  return Array.from(map.values());
}

function calcularScoreCapitalParaSnapshot(args: {
  capitalAtado: number;
  capitalTotal: number;
  agingMas180Unidades: number;
  stockUnidades: number;
  lineaUtilizada: number | null;
  lineaAutorizada: number | null;
  provisionesGt90Monto: number | null;
  stockPagadoMonto: number;
  stockMontoTotal: number;
  giniAtado: number | null;
}): ScoreResult {
  const warnings: string[] = [];

  // V1 % capital atado
  const v1Valor =
    args.capitalTotal > 0 ? args.capitalAtado / args.capitalTotal : null;
  // V2 % aging > 180 d unidades
  const v2Valor =
    args.stockUnidades > 0 ? args.agingMas180Unidades / args.stockUnidades : null;
  // V3 utilización línea
  const v3Valor =
    args.lineaAutorizada && args.lineaAutorizada > 0
      ? (args.lineaUtilizada ?? 0) / args.lineaAutorizada
      : null;
  // V4 % provisiones gt90 sobre capital total
  const v4Valor =
    args.provisionesGt90Monto !== null && args.capitalTotal > 0
      ? args.provisionesGt90Monto / args.capitalTotal
      : null;
  // V5 % stock pagado sobre monto total
  const v5Valor =
    args.stockMontoTotal > 0 ? args.stockPagadoMonto / args.stockMontoTotal : null;

  const drivers: Driver[] = [
    buildDriver({ id: "V1", nombre: "Capital atado", unidad: "fraccion", peso: SC_V1_PESO, meta: SC_V1_META, max: SC_V1_MAX, valor: v1Valor }),
    buildDriver({ id: "V2", nombre: "Stock > 180 d", unidad: "fraccion", peso: SC_V2_PESO, meta: SC_V2_META, max: SC_V2_MAX, valor: v2Valor }),
    buildDriver({ id: "V3", nombre: "Utilización línea", unidad: "fraccion", peso: SC_V3_PESO, meta: SC_V3_META, max: SC_V3_MAX, valor: v3Valor }),
    buildDriver({ id: "V4", nombre: "Provisiones > 90 d", unidad: "fraccion", peso: SC_V4_PESO, meta: SC_V4_META, max: SC_V4_MAX, valor: v4Valor }),
    buildDriver({ id: "V5", nombre: "Stock pagado", unidad: "fraccion", peso: SC_V5_PESO, meta: SC_V5_META, max: SC_V5_MAX, valor: v5Valor }),
    buildDriver({ id: "V6", nombre: "Concentración marca", unidad: "gini", peso: SC_V6_PESO, meta: SC_V6_META, max: SC_V6_MAX, valor: args.giniAtado }),
  ];

  return consolidarScore({
    drivers,
    driversCentrales: ["V1", "V2"],
    acciones: {
      V1: "Liberar capital — priorizar venta de stock > 180 d y cobranza Saldos T3+",
      V2: "Reducir stock envejecido — plan de salida > 180 d con descuento o traspaso",
      V3: "Renegociar línea o reducir velocidad de compra — utilización en zona crítica",
      V4: "Acelerar facturación de provisiones > 90 d — bloquean capital sin VIN",
      V5: "Revisar política Stock Propio — capital propio inmovilizado por encima de meta 5 %",
      V6: "Capital atado concentrado en una marca — atención focalizada",
    },
    warnings,
  });
}

// ────────────────────────────────────────────────────────────────────
// Score Gerencial — cálculo
// ────────────────────────────────────────────────────────────────────

function calcularScoreGerencialParaSnapshot(args: {
  alertasCriticas: number | null;
  alertasAltas: number | null;
  alertasMedias: number | null;
  stockUnidades: number;
  sucursalesConBrechas: number | null;
  totalSucursalesConStock: number;
  reincidencia: number | null;
}): ScoreResult {
  const warnings: string[] = [];

  const den = args.stockUnidades > 0 ? args.stockUnidades / 100 : null;
  const g1 = args.alertasCriticas !== null && den ? args.alertasCriticas / den : null;
  const g2 = args.alertasAltas !== null && den ? args.alertasAltas / den : null;
  const g3 = args.alertasMedias !== null && den ? args.alertasMedias / den : null;
  const g4 =
    args.sucursalesConBrechas !== null && args.totalSucursalesConStock > 0
      ? args.sucursalesConBrechas / args.totalSucursalesConStock
      : null;
  const g5 = args.reincidencia;

  const drivers: Driver[] = [
    buildDriver({ id: "G1", nombre: "Críticas /100v", unidad: "por_100v", peso: SG_G1_PESO, meta: SG_G1_META, max: SG_G1_MAX, valor: g1 }),
    buildDriver({ id: "G2", nombre: "Altas /100v", unidad: "por_100v", peso: SG_G2_PESO, meta: SG_G2_META, max: SG_G2_MAX, valor: g2 }),
    buildDriver({ id: "G3", nombre: "Medias /100v", unidad: "por_100v", peso: SG_G3_PESO, meta: SG_G3_META, max: SG_G3_MAX, valor: g3 }),
    buildDriver({ id: "G4", nombre: "Sucursales con brecha", unidad: "fraccion", peso: SG_G4_PESO, meta: SG_G4_META, max: SG_G4_MAX, valor: g4 }),
    buildDriver({ id: "G5", nombre: "Reincidencia 2 m", unidad: "fraccion", peso: SG_G5_PESO, meta: SG_G5_META, max: SG_G5_MAX, valor: g5 }),
  ];

  return consolidarScore({
    drivers,
    driversCentrales: ["G1", "G2"],
    acciones: {
      G1: "Atención prioritaria — densidad de alertas críticas en zona roja",
      G2: "Plan de reducción de alertas altas — backlog acumulándose",
      G3: "Higiene de seguimiento — alertas medias sin gestión",
      G4: "Concentrar trabajo en sucursales con brecha — desbalance operacional",
      G5: "Cerrar casos viejos antes de abrir nuevos — equipo apilando",
    },
    warnings,
  });
}

// ────────────────────────────────────────────────────────────────────
// Helpers de alertas por marca / cómputo agregado
// ────────────────────────────────────────────────────────────────────

function alertasPorMarcaCount(
  alertas: Alerta[],
  marca: string,
  severidad: Alerta["severidad"],
): number {
  const m = marca.toUpperCase();
  return alertas.filter(
    (a) => a.severidad === severidad && (a.marca ?? "").toUpperCase() === m,
  ).length;
}

function totalSucursalesConStockPorMarca(
  vus: VehiculoUnificado[],
): number {
  const s = new Set<string>();
  for (const vu of vus) {
    if (vu.enStockActivo && vu.sucursal) s.add(vu.sucursal.trim());
  }
  return s.size;
}

// ────────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────────

export function extraer1bB(input: Extraer1bBInput): Extraer1bBResult {
  const { contexto, vinsEnAlertaCritAltaPrevio } = input;
  const warnings: string[] = [];

  // ── Agrupar VUs por marca ──────────────────────────────────────
  const porMarca = agruparPorMarca(contexto.vus);

  // ── Gini global de capital atado por marca ─────────────────────
  const giniGlobal =
    porMarca.length >= SC_V6_MIN_MARCAS
      ? gini(porMarca.map((s) => s.capitalAtado))
      : null;
  if (giniGlobal === null && porMarca.length < SC_V6_MIN_MARCAS) {
    warnings.push(
      `V6 Gini global · < ${SC_V6_MIN_MARCAS} marcas (${porMarca.length}) → driver omitido`,
    );
  }

  // ── Línea autorizada/utilizada · totales del payload ───────────
  let lineaAutorizadaTotal = 0;
  let lineaUtilizadaTotal = 0;
  for (const l of contexto.lineas) {
    lineaAutorizadaTotal += Number(l.lineaAutorizada) || 0;
    lineaUtilizadaTotal += Number(l.lineaOcupada) || 0;
  }

  // ── Capital atado agregado (suma marcas) ───────────────────────
  const capitalTotalGlobal = porMarca.reduce((s, m) => s + m.capitalTotal, 0);
  const capitalAtadoGlobal = porMarca.reduce((s, m) => s + m.capitalAtado, 0);
  const agingMas180Global = porMarca.reduce(
    (s, m) => s + m.agingMas180Unidades,
    0,
  );

  // ── Score Capital GLOBAL ───────────────────────────────────────
  const scoreCapitalGlobal = calcularScoreCapitalParaSnapshot({
    capitalAtado: capitalAtadoGlobal,
    capitalTotal: capitalTotalGlobal,
    agingMas180Unidades: agingMas180Global,
    stockUnidades: contexto.stockUnidades,
    lineaUtilizada: lineaUtilizadaTotal || null,
    lineaAutorizada: lineaAutorizadaTotal || null,
    provisionesGt90Monto:
      contexto.provisionesNoFacturadasGt90Monto > 0
        ? contexto.provisionesNoFacturadasGt90Monto
        : null,
    stockPagadoMonto: contexto.stockPagadoMonto,
    stockMontoTotal: contexto.stockMontoTotal,
    giniAtado: giniGlobal,
  });

  // ── Reincidencia G5 · VINs alerta crit/alta actual ─────────────
  const vinsCritAltaActual = new Set<string>();
  for (const a of contexto.alertas) {
    if (a.severidad !== "critica" && a.severidad !== "alta") continue;
    if (!a.vin) continue;
    vinsCritAltaActual.add(a.vin.replace(/\s+/g, "").toUpperCase());
  }
  let reincidenciaGlobal: number | null = null;
  if (vinsEnAlertaCritAltaPrevio && vinsCritAltaActual.size > 0) {
    let inter = 0;
    for (const v of vinsCritAltaActual) {
      if (vinsEnAlertaCritAltaPrevio.has(v)) inter++;
    }
    reincidenciaGlobal = inter / vinsCritAltaActual.size;
  } else if (!vinsEnAlertaCritAltaPrevio) {
    warnings.push("G5 Reincidencia · período N-1 no disponible → driver omitido");
  }

  // ── Score Gerencial GLOBAL ─────────────────────────────────────
  const scoreGerencialGlobal = calcularScoreGerencialParaSnapshot({
    alertasCriticas: contexto.alertas.filter((a) => a.severidad === "critica").length,
    alertasAltas: contexto.alertas.filter((a) => a.severidad === "alta").length,
    alertasMedias: contexto.alertas.filter((a) => a.severidad === "media").length,
    stockUnidades: contexto.stockUnidades,
    sucursalesConBrechas: contexto.sucursalesConBrechas,
    totalSucursalesConStock: contexto.totalSucursalesConStock,
    reincidencia: reincidenciaGlobal,
  });

  // ── POR MARCA ──────────────────────────────────────────────────
  const scoreCapitalPorMarca: Record<string, ScoreResult> = {};
  const scoreGerencialPorMarca: Record<string, ScoreResult> = {};

  for (const m of porMarca) {
    // Capital por marca: V6 Gini no aplica → null + warning local
    const scrCap = calcularScoreCapitalParaSnapshot({
      capitalAtado: m.capitalAtado,
      capitalTotal: m.capitalTotal,
      agingMas180Unidades: m.agingMas180Unidades,
      stockUnidades: m.stockUnidades,
      // línea por marca: TODO buscar match en `contexto.lineas` por marca
      lineaUtilizada: null,
      lineaAutorizada: null,
      provisionesGt90Monto: null, // por marca aún no segmentamos provisiones
      stockPagadoMonto: m.stockPagadoMonto,
      stockMontoTotal: m.stockMonto,
      giniAtado: null, // marca individual no tiene Gini
    });
    scoreCapitalPorMarca[m.marca] = scrCap;

    // Gerencial por marca: alertas filtradas + reincidencia por marca
    const vinsCritAltaActualMarca = new Set<string>();
    for (const a of contexto.alertas) {
      if (a.severidad !== "critica" && a.severidad !== "alta") continue;
      if (!a.vin) continue;
      const am = normalizarMarcaOperacional(a.marca ?? "SIN MARCA");
      if (am !== m.marca) continue;
      vinsCritAltaActualMarca.add(a.vin.replace(/\s+/g, "").toUpperCase());
    }
    let reincidenciaMarca: number | null = null;
    if (vinsEnAlertaCritAltaPrevio && vinsCritAltaActualMarca.size > 0) {
      let inter = 0;
      for (const v of vinsCritAltaActualMarca) {
        if (vinsEnAlertaCritAltaPrevio.has(v)) inter++;
      }
      reincidenciaMarca = inter / vinsCritAltaActualMarca.size;
    }

    const scrGer = calcularScoreGerencialParaSnapshot({
      alertasCriticas: alertasPorMarcaCount(contexto.alertas, m.marca, "critica"),
      alertasAltas: alertasPorMarcaCount(contexto.alertas, m.marca, "alta"),
      alertasMedias: alertasPorMarcaCount(contexto.alertas, m.marca, "media"),
      stockUnidades: m.stockUnidades,
      sucursalesConBrechas: null, // por marca no segmentamos brechas aún
      totalSucursalesConStock: totalSucursalesConStockPorMarca(m.vus),
      reincidencia: reincidenciaMarca,
    });
    scoreGerencialPorMarca[m.marca] = scrGer;
  }

  // ── marcasConBrechas: scoreGerencial < UMBRAL ──────────────────
  const marcasConScore = Object.values(scoreGerencialPorMarca).filter(
    (s) => s.score !== null,
  );
  const marcasBajoUmbral = Object.entries(scoreGerencialPorMarca)
    .filter(([, s]) => s.score !== null && s.score < UMBRAL_MARCA_BRECHA)
    .map(([m]) => m)
    .sort();
  const marcasConBrechas =
    marcasConScore.length > 0 ? marcasBajoUmbral.length : null;

  return {
    scoreCapitalGlobal,
    scoreGerencialGlobal,
    scoreCapitalPorMarca,
    scoreGerencialPorMarca,
    marcasConBrechas,
    marcasBajoUmbral,
    vinsEnAlertaCritAlta: Array.from(vinsCritAltaActual).sort(),
    warnings,
  };
}
