/**
 * Histórico Fase 1b-A · extractor de KPIs derivados.
 *
 * Recibe las 4 fuentes RE-HIDRATADAS de un período y devuelve los 12 KPIs
 * de la fase 1b-A. Función pura: si falta una fuente, los KPIs derivados
 * de esa fuente quedan `null` (condición técnica #6/#7 del usuario — no
 * rellenar con cero).
 *
 * Decisiones de diseño codificadas:
 *   · Capital de trabajo (Decisión 0.2 = β):
 *       Total       = Σ capitalComprometido por VU + provisiones no facturadas
 *       Utilizado   = capital atado (aging stock > 180, FNE > 15d, saldos > 90d,
 *                     prov > 90d) sin doble conteo entre las 3 razones VU
 *       Disponible  = max(0, Total − Utilizado)
 *   · Bloqueos FNE (Decisión 0.6 = Venn): los 4 contadores son SETS de VINs;
 *       un VIN puede sumar en varios. Total ≥ unión, ≤ FNE total.
 *   · Sucursales con brecha (Decisión 0.4 = Camino 2): definición propia
 *       basada en VU; NO dependiente del shape de Alerta.
 *   · marcasConBrechas: NO se calcula en 1b-A (necesita scores por marca);
 *       se llena en 1b-B.
 */

import type {
  AutoNoEntregado,
  LineaCredito,
  ParsedExcel,
  ParsedFNE,
  ParsedProvisiones,
  ParsedSaldos,
  ProvisionRegistro,
  Vehiculo,
} from "../types";
import {
  buildVehiculosUnificados,
  type VehiculoUnificado,
} from "../selectors/vehiculo-unificado";
import { generarAlertas } from "../selectors/kpis";
import {
  AGING_ATADO_DIAS,
  FNE_ATADO_DIAS,
  MAPEO_BLOQUEO_FNE,
  PROV_ATADO_DIAS,
  SALDOS_ATADO_DIAS,
  SUCURSAL_MIN_ALERTAS_CRITICAS,
  SUCURSAL_MIN_FNE_BLOQUEADOS,
  SUCURSAL_MIN_VEHICULOS_AGING_180,
  type CategoriaBloqueoFNE,
} from "./config";

// ────────────────────────────────────────────────────────────────────
// Tipos
// ────────────────────────────────────────────────────────────────────

/** Fuentes opcionales para hacer 1b-A tolerante a series parciales. */
export interface Extraer1bAInput {
  stock: ParsedExcel | null;
  fne: ParsedFNE | null;
  saldos: ParsedSaldos | null;
  provisiones: ParsedProvisiones | null;
  /** Fecha de referencia ("hoy" del período). Por defecto: ahora.
   *  En cálculos históricos pasados, deberías pasar la fecha de corte
   *  del snapshot para que `diasArchivo` y similares no cambien con el
   *  tiempo. */
  hoy?: Date;
}

export interface Extraer1bAResult {
  /** Campos a setear directamente en OperationalSnapshot. */
  kpis: Record<string, number | null>;
  /** Warnings que se mergean en la columna `warnings[]` del snapshot. */
  warnings: string[];
  /** Parche a fusionar dentro de `scoreComponentes.bloqueosFne` y otros. */
  scoreComponentesPatch: Record<string, unknown>;
  /** Contexto reutilizable por 1b-B (evita reconstruir VUs y alertas). */
  contexto: Contexto1bA;
}

/** Datos intermedios producidos por 1b-A que 1b-B (scores) consume. */
export interface Contexto1bA {
  vus: VehiculoUnificado[];
  vehiculos: Vehiculo[];
  lineas: LineaCredito[];
  /** Alertas ya generadas (caching). */
  alertas: import("../types").Alerta[];
  /** Stock unidades (sin duplicados). */
  stockUnidades: number;
  /** stockMontoTotal — para denominador V5. */
  stockMontoTotal: number;
  /** stockPagadoMonto (Propio + FinPropio). */
  stockPagadoMonto: number;
  /** Provisiones no facturadas > 90d con saldo > 0. */
  provisionesNoFacturadasGt90Monto: number;
  /** Total de sucursales con stock activo (denominador G4). */
  totalSucursalesConStock: number;
  /** Sucursales con brecha (numerador G4, ya calculado en 1b-A). */
  sucursalesConBrechas: number | null;
  /** Conjunto de stockUnidades agrupado por sucursal (para auditoría). */
  // (omitido — no necesario para scores)
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function vumap(vus: Map<string, VehiculoUnificado>): VehiculoUnificado[] {
  return Array.from(vus.values());
}

/**
 * Días desde fecha de vencimiento de un saldo hasta `hoy`. null si no hay fecha.
 * Positivo = ya venció hace X días.
 */
function diasVencido(saldo: { fechaVencimiento: Date | null }, hoy: Date): number | null {
  if (!saldo.fechaVencimiento) return null;
  const t = saldo.fechaVencimiento.getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((hoy.getTime() - t) / 86_400_000);
}

// ────────────────────────────────────────────────────────────────────
// Extractor principal
// ────────────────────────────────────────────────────────────────────

export function extraer1bA(input: Extraer1bAInput): Extraer1bAResult {
  const warnings: string[] = [];
  const kpis: Record<string, number | null> = {};
  const hoy = input.hoy ?? new Date();

  // ── Catálogo de fuentes presentes (afecta KPIs derivables) ─────
  const tieneStock = !!input.stock;
  const tieneFne = !!input.fne;
  const tieneSaldos = !!input.saldos;
  const tieneProvisiones = !!input.provisiones;

  // Cache de alertas (las usamos en §3 y §4) — evita llamada doble.
  let alertasCache: import("../types").Alerta[] = [];

  // Pre-cálculo sobre vehiculos del payload (igual al extractor 1a en
  // persistir.ts — mismo criterio de dedup).
  let preStockUnidades = 0;
  let preStockMontoTotal = 0;
  let preStockPagadoMonto = 0;
  const sucursalesConStock = new Set<string>();

  // Si no hay stock, casi todo lo derivado queda null.
  if (!tieneStock) {
    warnings.push("1b-A: BASE_STOCK ausente → capital, alertas y brechas no calculables");
  }
  if (!tieneFne) warnings.push("1b-A: FNE ausente → bloqueos FNE no calculables");
  if (!tieneSaldos) warnings.push("1b-A: SALDOS ausentes → capital atado por saldos no incluido");
  if (!tieneProvisiones) {
    warnings.push("1b-A: PROVISIONES ausentes → capital atado por provisiones no incluido");
  }

  // ── Construir Vehículos Unificados ─────────────────────────────
  let vus: VehiculoUnificado[] = [];
  if (tieneStock) {
    try {
      const map = buildVehiculosUnificados(
        {
          data: input.stock,
          fne: input.fne,
          saldos: input.saldos,
        },
        hoy,
      );
      vus = vumap(map);
    } catch (e) {
      warnings.push(`1b-A: buildVehiculosUnificados falló: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Pre-cálculo sobre vehiculos del payload (mismo criterio que
    // persistir.ts/extraerKpisStock — sin duplicados).
    if (input.stock) {
      const seen = new Set<string>();
      for (const v of input.stock.vehiculos ?? []) {
        if (!v.vin || seen.has(v.vin)) continue;
        if (v.esDuplicado === true) continue;
        seen.add(v.vin);
        preStockUnidades++;
        const costo = Number(v.costoNeto) || 0;
        preStockMontoTotal += costo;
        if (v.tipoStock === "Propio" || v.tipoStock === "FinPropio") {
          preStockPagadoMonto += costo;
        }
        const suc = (v.sucursal ?? "").trim();
        if (suc) sucursalesConStock.add(suc);
      }
    }
  }

  // ────────────────────────────────────────────────────────────────
  // 1) CAPITAL DE TRABAJO (β · atado / sano)
  // ────────────────────────────────────────────────────────────────
  let capitalTrabajoTotal: number | null = null;
  let capitalTrabajoUtilizado: number | null = null;
  let capitalTrabajoDisponible: number | null = null;

  if (tieneStock) {
    let totalVU = 0;
    let atadoVU = 0;

    // Set de VINs ya marcados como atados — evita doble conteo entre
    // (aging stock), (FNE > 15d) y (saldos > 90d). Si un VIN cumple
    // cualquiera de las 3 razones, suma su capitalComprometido UNA VEZ.
    const vinsAtados = new Set<string>();

    for (const vu of vus) {
      totalVU += vu.capitalComprometido;

      const atadoPorAging =
        vu.enStockActivo && (vu.diasStock ?? 0) > AGING_ATADO_DIAS;
      const atadoPorFne =
        vu.enFNE && (vu.fneDiasFactura ?? 0) > FNE_ATADO_DIAS;

      // saldosDetalle.diasArchivo o vencimiento > 90d
      let atadoPorSaldos = false;
      if (vu.enSaldos && vu.saldosDetalle.length > 0) {
        for (const s of vu.saldosDetalle) {
          const dias = s.diasArchivo ?? diasVencido(s, hoy);
          if (dias !== null && dias > SALDOS_ATADO_DIAS) {
            atadoPorSaldos = true;
            break;
          }
        }
      }

      if (atadoPorAging || atadoPorFne || atadoPorSaldos) {
        if (!vinsAtados.has(vu.vinLimpio)) {
          vinsAtados.add(vu.vinLimpio);
          atadoVU += vu.capitalComprometido;
        }
      }
    }

    // Provisiones no facturadas > 90 d (canal independiente, no por VU)
    let totalProvisiones = 0;
    let atadoProvisiones = 0;
    if (tieneProvisiones && input.provisiones) {
      for (const p of input.provisiones.registros) {
        // "no facturada" = montoFactura === 0 AND saldo > 0
        if (p.montoFactura !== 0 || p.saldo <= 0) continue;
        totalProvisiones += p.saldo;
        if ((p.agingDias ?? 0) > PROV_ATADO_DIAS) {
          atadoProvisiones += p.saldo;
        }
      }
    }

    capitalTrabajoTotal = totalVU + totalProvisiones;
    capitalTrabajoUtilizado = atadoVU + atadoProvisiones;
    capitalTrabajoDisponible = Math.max(
      0,
      capitalTrabajoTotal - capitalTrabajoUtilizado,
    );
  }

  kpis.capitalTrabajoTotal = capitalTrabajoTotal;
  kpis.capitalTrabajoUtilizado = capitalTrabajoUtilizado;
  kpis.capitalTrabajoDisponible = capitalTrabajoDisponible;

  // ────────────────────────────────────────────────────────────────
  // 2) BLOQUEOS FNE (Venn)
  // ────────────────────────────────────────────────────────────────
  let fneBloqueadosCp: number | null = null;
  let fneBloqueadosInscripcion: number | null = null;
  let fneBloqueadosLogistica: number | null = null;
  let fneBloqueadosComercial: number | null = null;

  let totalFneVivos = 0;
  let vinsConAlgunBloqueo = 0;

  if (tieneFne && tieneStock) {
    const sets: Record<CategoriaBloqueoFNE, Set<string>> = {
      cp: new Set(),
      inscripcion: new Set(),
      logistica: new Set(),
      comercial: new Set(),
    };

    for (const vu of vus) {
      if (!vu.enFNE) continue;
      totalFneVivos++;
      if (vu.fneBloqueos.length === 0) continue;
      vinsConAlgunBloqueo++;
      for (const b of vu.fneBloqueos) {
        const categoria = MAPEO_BLOQUEO_FNE[b.tipo];
        if (categoria) sets[categoria].add(vu.vinLimpio);
      }
    }

    fneBloqueadosCp = sets.cp.size;
    fneBloqueadosInscripcion = sets.inscripcion.size;
    fneBloqueadosLogistica = sets.logistica.size;
    fneBloqueadosComercial = sets.comercial.size;
  }

  kpis.fneBloqueadosCp = fneBloqueadosCp;
  kpis.fneBloqueadosInscripcion = fneBloqueadosInscripcion;
  kpis.fneBloqueadosLogistica = fneBloqueadosLogistica;
  kpis.fneBloqueadosComercial = fneBloqueadosComercial;

  // ────────────────────────────────────────────────────────────────
  // 3) ALERTAS (severidad)
  // ────────────────────────────────────────────────────────────────
  let alertasCriticas: number | null = null;
  let alertasAltas: number | null = null;
  let alertasMedias: number | null = null;

  if (tieneStock && input.stock) {
    try {
      const vehiculos: Vehiculo[] = input.stock.vehiculos ?? [];
      const lineas: LineaCredito[] = input.stock.lineas ?? [];
      alertasCache = generarAlertas(vehiculos, lineas);
      alertasCriticas = alertasCache.filter((a) => a.severidad === "critica").length;
      alertasAltas = alertasCache.filter((a) => a.severidad === "alta").length;
      alertasMedias = alertasCache.filter((a) => a.severidad === "media").length;
    } catch (e) {
      warnings.push(`1b-A: generarAlertas falló: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  kpis.alertasCriticas = alertasCriticas;
  kpis.alertasAltas = alertasAltas;
  kpis.alertasMedias = alertasMedias;

  // ────────────────────────────────────────────────────────────────
  // 4) BRECHAS (Camino 2 · definición propia)
  // ────────────────────────────────────────────────────────────────
  let sucursalesConBrechas: number | null = null;

  if (tieneStock) {
    // Acumular por sucursal: vehículos aging>180, FNE bloqueados.
    type ContadorSucursal = {
      aging180: number;
      fneBloqueados: number;
    };
    const porSucursal = new Map<string, ContadorSucursal>();

    function ensure(suc: string): ContadorSucursal {
      let c = porSucursal.get(suc);
      if (!c) {
        c = { aging180: 0, fneBloqueados: 0 };
        porSucursal.set(suc, c);
      }
      return c;
    }

    let vinsSinSucursalAging = 0;
    let vinsSinSucursalFne = 0;

    for (const vu of vus) {
      const suc = (vu.sucursal ?? "").trim();
      if (vu.enStockActivo && (vu.diasStock ?? 0) > AGING_ATADO_DIAS) {
        if (suc) ensure(suc).aging180++;
        else vinsSinSucursalAging++;
      }
      if (vu.enFNE && vu.fneBloqueos.length > 0) {
        if (suc) ensure(suc).fneBloqueados++;
        else vinsSinSucursalFne++;
      }
    }

    // Alertas críticas por sucursal: cruzar vía VIN cuando la alerta tenga uno.
    // (Las alertas sin VIN — ej. línea sobregirada — no se atribuyen a
    // sucursal porque la línea es financiera, no operacional.)
    // Reutiliza alertasCache para no recomputar.
    if (input.stock && alertasCache.length > 0) {
      try {
        const alertasCriticasArr = alertasCache.filter((a) => a.severidad === "critica");
        const sucursalPorVin = new Map<string, string>();
        for (const vu of vus) {
          if (vu.sucursal) sucursalPorVin.set(vu.vinLimpio, vu.sucursal);
        }
        const contCriticasPorSuc = new Map<string, number>();
        for (const a of alertasCriticasArr) {
          if (!a.vin) continue;
          // Normalización mínima: minúsculas, sin espacios — replica el
          // criterio de comparación que usa `limpiarVIN` upstream.
          const k = a.vin.replace(/\s+/g, "").toUpperCase();
          const suc = sucursalPorVin.get(k);
          if (!suc) continue;
          contCriticasPorSuc.set(suc, (contCriticasPorSuc.get(suc) ?? 0) + 1);
        }
        for (const [suc, n] of contCriticasPorSuc) {
          const c = ensure(suc);
          // Se aprovecha el slot fneBloqueados para no agregar otra dim?
          // No — mejor evaluar criterio aparte abajo.
          (c as ContadorSucursal & { alertasCriticas?: number }).alertasCriticas =
            (((c as ContadorSucursal & { alertasCriticas?: number }).alertasCriticas) ?? 0) + n;
        }
      } catch {
        // si falla, no degradamos el resto
      }
    }

    let totalConBrecha = 0;
    for (const c of porSucursal.values()) {
      const crit =
        ((c as ContadorSucursal & { alertasCriticas?: number }).alertasCriticas) ?? 0;
      const tieneBrecha =
        c.aging180 >= SUCURSAL_MIN_VEHICULOS_AGING_180 ||
        c.fneBloqueados >= SUCURSAL_MIN_FNE_BLOQUEADOS ||
        crit >= SUCURSAL_MIN_ALERTAS_CRITICAS;
      if (tieneBrecha) totalConBrecha++;
    }
    sucursalesConBrechas = totalConBrecha;

    if (vinsSinSucursalAging > 0) {
      warnings.push(
        `1b-A: ${vinsSinSucursalAging} VINs con aging>180 sin sucursal asignada (excluidos del conteo)`,
      );
    }
    if (vinsSinSucursalFne > 0) {
      warnings.push(
        `1b-A: ${vinsSinSucursalFne} VINs FNE bloqueados sin sucursal asignada (excluidos del conteo)`,
      );
    }
  }

  kpis.sucursalesConBrechas = sucursalesConBrechas;
  // marcasConBrechas se calcula en 1b-B (necesita scoreGerencial por marca)
  kpis.marcasConBrechas = null;

  // ────────────────────────────────────────────────────────────────
  // 5) Patch para scoreComponentes JSON
  // ────────────────────────────────────────────────────────────────
  const scoreComponentesPatch: Record<string, unknown> = {
    bloqueosFne: {
      logica: "venn",
      totalFneVivos,
      vinsConAlgunBloqueo,
      puedenSumarMas: true,
      categorias: {
        cp: fneBloqueadosCp,
        inscripcion: fneBloqueadosInscripcion,
        logistica: fneBloqueadosLogistica,
        comercial: fneBloqueadosComercial,
      },
    },
    capitalTrabajo: {
      criterio: "beta_atado_sano",
      umbrales: {
        agingDias: AGING_ATADO_DIAS,
        fneDias: FNE_ATADO_DIAS,
        saldosDias: SALDOS_ATADO_DIAS,
        provisionesDias: PROV_ATADO_DIAS,
      },
      total: capitalTrabajoTotal,
      utilizado: capitalTrabajoUtilizado,
      disponible: capitalTrabajoDisponible,
    },
    brechas: {
      sucursalesConBrechas,
      umbrales: {
        minAging180: SUCURSAL_MIN_VEHICULOS_AGING_180,
        minFneBloqueados: SUCURSAL_MIN_FNE_BLOQUEADOS,
        minAlertasCriticas: SUCURSAL_MIN_ALERTAS_CRITICAS,
      },
      marcasConBrechas: null, // 1b-B
    },
    fuentesPresentes: {
      stock: tieneStock,
      fne: tieneFne,
      saldos: tieneSaldos,
      provisiones: tieneProvisiones,
    },
  };

  // Provisiones no facturadas > 90d monto (para V4 de 1b-B).
  let provisionesNoFacturadasGt90Monto = 0;
  if (tieneProvisiones && input.provisiones) {
    for (const p of input.provisiones.registros) {
      if (p.montoFactura !== 0 || p.saldo <= 0) continue;
      if ((p.agingDias ?? 0) > PROV_ATADO_DIAS) {
        provisionesNoFacturadasGt90Monto += p.saldo;
      }
    }
  }

  const contexto: Contexto1bA = {
    vus,
    vehiculos: (input.stock?.vehiculos ?? []) as Vehiculo[],
    lineas: (input.stock?.lineas ?? []) as LineaCredito[],
    alertas: alertasCache,
    stockUnidades: preStockUnidades,
    stockMontoTotal: preStockMontoTotal,
    stockPagadoMonto: preStockPagadoMonto,
    provisionesNoFacturadasGt90Monto,
    totalSucursalesConStock: sucursalesConStock.size,
    sucursalesConBrechas,
  };

  return { kpis, warnings, scoreComponentesPatch, contexto };
}

// re-exports utilitarios para tests / CLI
export type {
  AutoNoEntregado,
  ProvisionRegistro,
};
