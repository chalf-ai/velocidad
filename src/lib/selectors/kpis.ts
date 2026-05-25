/**
 * Cálculos derivados (KPIs, capital, alertas) — siempre puros, sin side effects.
 *
 * Reglas críticas:
 *   - Para KPIs ejecutivos contamos VIN único (no duplicados).
 *   - "Capital propio / caja atrapada" = TipoStock Propio + FinPropio.
 *   - "Capital financiero" = TipoStock Financiado (NO Floor Plan — eso es del dealer).
 *   - "Capital VPP comprometido" = vehiculos.esVPPComprometido.
 *   - "Línea ocupada por marca" viene directo de 3.-Lineas de Credito.
 */

import type {
  Alerta,
  LineaCredito,
  ResumenOficial,
  Vehiculo,
} from "../types";

function uniqByVin(vs: Vehiculo[]): Vehiculo[] {
  const seen = new Set<string>();
  const out: Vehiculo[] = [];
  for (const v of vs) {
    if (seen.has(v.vin)) continue;
    seen.add(v.vin);
    out.push(v);
  }
  return out;
}

export interface DashboardKPIs {
  // Unidades
  unidadesTotal: number;
  unidadesStockA: number;
  unidadesStockB: number;
  unidadesJudicial: number;
  unidadesTescar: number;
  unidadesVPPComprometido: number;

  // Capital (varias visiones — el usuario no quiere mezclarlas)
  capitalBruto: number; // ALL Costo Neto (referencia general)
  capitalPropio: number; // Propio + FinPropio
  capitalFinanciero: number; // Financiado
  capitalFloorPlan: number; // FloorPlan (en manos de financiera)
  capitalVPPComprometido: number; // esVPPComprometido
  capitalPagado: number;
  capitalNoPagado: number;

  // Aging
  unidadesMas60: number;
  capitalMas60: number;
  unidadesMas180: number;
  capitalMas180: number;
  /** Capital total realmente utilizado por la operación.
   *  Suma: Propio + FinPropio + Financiado + FNE+VPP+CPD+VentaProceso + Inmovilizado + UsadoPagadoInmovil.
   *  Excluye: Floor Plan puro retail (capital del importador, no de Pompeyo).
   *  Métrica OPERACIONAL — puede solaparse con tipoStock. NO sumar al total. */
  capitalTotalUtilizado: number;
  unidadesTotalUtilizado: number;

  // ════════════════════════════════════════════════════════════════
  // ORIGEN DEL CAPITAL · partición disjunta · debe sumar capitalBruto
  // Es la vista financiera para directorio. Lectura "¿de quién es la plata?".
  // ════════════════════════════════════════════════════════════════

  /** Stock propio pagado: tipoStock ∈ {Propio, FinPropio}. */
  capitalPropioPuro: number;
  unidadesPropioPuro: number;
  /** Línea financiera externa: tipoStock ∈ {FloorPlan, Financiado}. */
  capitalFinanciadoTerceros: number;
  unidadesFinanciadoTerceros: number;
  /** En tránsito o sin clasificar: tipoStock ∈ {VuPorRecibir, Desconocido}.
   *  Conceptualmente es capital Pompeyo (subcomponente de caja). */
  capitalTransito: number;
  unidadesTransito: number;
  /** Caja / capital Pompeyo TOTAL = propioPuro + tránsito.
   *  Todo lo que NO es deuda de terceros. + financiadoTerceros = total. */
  capitalCajaPompeyo: number;
  unidadesCajaPompeyo: number;
}

export function computeDashboardKPIs(vehiculos: Vehiculo[]): DashboardKPIs {
  const unique = uniqByVin(vehiculos);

  let unidadesStockA = 0,
    unidadesStockB = 0,
    unidadesJudicial = 0,
    unidadesTescar = 0,
    unidadesVPP = 0;
  let capitalBruto = 0,
    capitalPropio = 0,
    capitalFinanciero = 0,
    capitalFloorPlan = 0,
    capitalVPP = 0,
    capitalPagado = 0,
    capitalNoPagado = 0;
  let unidadesMas60 = 0,
    capitalMas60 = 0,
    unidadesMas180 = 0,
    capitalMas180 = 0;
  let capitalTotalUtilizado = 0,
    unidadesTotalUtilizado = 0;

  // ORIGEN DEL CAPITAL — partición disjunta por tipoStock
  let capitalPropioPuro = 0,
    unidadesPropioPuro = 0,
    capitalFinanciadoTerceros = 0,
    unidadesFinanciadoTerceros = 0,
    capitalTransito = 0,
    unidadesTransito = 0;

  for (const v of unique) {
    const c = v.costoNeto || 0;
    capitalBruto += c;

    // Capital total realmente utilizado por la operación.
    // Incluye todo lo que consume caja/línea de Pompeyo y excluye retail puro Floor Plan.
    if (
      v.naturalezaCapital === "puente" ||
      v.naturalezaCapital === "operativo" ||
      v.naturalezaCapital === "atrapado" ||
      v.tipoStock === "Propio" ||
      v.tipoStock === "FinPropio" ||
      v.tipoStock === "Financiado"
    ) {
      capitalTotalUtilizado += c;
      unidadesTotalUtilizado++;
    }

    if (v.stockAB === "A") unidadesStockA++;
    else if (v.stockAB === "B") unidadesStockB++;
    else if (v.stockAB === "Judicial") unidadesJudicial++;

    if (v.esTescar) unidadesTescar++;

    if (v.esVPPComprometido) {
      unidadesVPP++;
      capitalVPP += c;
    }

    if (v.tipoStock === "Propio" || v.tipoStock === "FinPropio") capitalPropio += c;
    else if (v.tipoStock === "Financiado") capitalFinanciero += c;
    else if (v.tipoStock === "FloorPlan") capitalFloorPlan += c;

    // === ORIGEN DEL CAPITAL · partición disjunta por tipoStock ===
    if (v.tipoStock === "Propio" || v.tipoStock === "FinPropio") {
      capitalPropioPuro += c;
      unidadesPropioPuro++;
    } else if (v.tipoStock === "FloorPlan" || v.tipoStock === "Financiado") {
      capitalFinanciadoTerceros += c;
      unidadesFinanciadoTerceros++;
    } else {
      // VuPorRecibir, Desconocido
      capitalTransito += c;
      unidadesTransito++;
    }

    if (v.pagado) capitalPagado += c;
    else capitalNoPagado += c;

    const dias = v.diasStock ?? 0;
    if (dias >= 60) {
      unidadesMas60++;
      capitalMas60 += c;
    }
    if (dias >= 180) {
      unidadesMas180++;
      capitalMas180 += c;
    }
  }

  return {
    unidadesTotal: unique.length,
    unidadesStockA,
    unidadesStockB,
    unidadesJudicial,
    unidadesTescar,
    unidadesVPPComprometido: unidadesVPP,
    capitalBruto,
    capitalPropio,
    capitalFinanciero,
    capitalFloorPlan,
    capitalVPPComprometido: capitalVPP,
    capitalPagado,
    capitalNoPagado,
    unidadesMas60,
    capitalMas60,
    unidadesMas180,
    capitalMas180,
    capitalTotalUtilizado,
    unidadesTotalUtilizado,
    capitalPropioPuro,
    unidadesPropioPuro,
    capitalFinanciadoTerceros,
    unidadesFinanciadoTerceros,
    capitalTransito,
    unidadesTransito,
    capitalCajaPompeyo: capitalPropioPuro + capitalTransito,
    unidadesCajaPompeyo: unidadesPropioPuro + unidadesTransito,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Líneas de crédito agrupadas por financiera
// ──────────────────────────────────────────────────────────────────────

export interface LineaFinanciera {
  financiera: string;
  autorizada: number;
  ocupada: number;
  libre: number;       // autorizada − ocupada (puede ser negativo = sobregiro)
  sobregiro: number;   // max(0, ocupada − autorizada)
  pctOcupacion: number;
  marcas: string[];
}

/** Agrupa líneas de crédito por financiera. Usa LineaCredito (ya limpio de
 *  junk numérico por el parser). Las sin financiera mapeada → "Otras". */
export function lineasPorFinanciera(lineas: LineaCredito[]): LineaFinanciera[] {
  const map = new Map<string, LineaFinanciera>();
  for (const l of lineas) {
    const fin = l.financiera ?? "Otras financieras";
    if (!map.has(fin)) {
      map.set(fin, {
        financiera: fin,
        autorizada: 0,
        ocupada: 0,
        libre: 0,
        sobregiro: 0,
        pctOcupacion: 0,
        marcas: [],
      });
    }
    const e = map.get(fin)!;
    e.autorizada += l.lineaAutorizada;
    e.ocupada += l.lineaOcupada;
    e.marcas.push(l.marca);
  }
  for (const e of map.values()) {
    e.libre = e.autorizada - e.ocupada;
    e.sobregiro = e.ocupada > e.autorizada ? e.ocupada - e.autorizada : 0;
    e.pctOcupacion = e.autorizada > 0 ? e.ocupada / e.autorizada : 0;
  }
  return [...map.values()].sort((a, b) => b.ocupada - a.ocupada);
}

/**
 * KPIs comparables al "Resumen Stock Propio" oficial — usa la misma definición
 * (Stock A vitrinas, Stock A por facturar, Stock B, Judicial).
 */
export interface ResumenAppEstimado {
  stockAVitrinasNeto: number;
  tescarValor: number;
  stockAPorFacturar: number;
  stockB: number;
  stockJudicial: number;
}

export function computeResumenAppEstimado(vehiculos: Vehiculo[]): ResumenAppEstimado {
  const unique = uniqByVin(vehiculos);
  let stockAVitrinasNeto = 0;
  let tescarValor = 0;
  let stockAPorFacturar = 0;
  let stockB = 0;
  let stockJudicial = 0;

  for (const v of unique) {
    const c = v.costoNeto || 0;
    if (v.stockAB === "Judicial") {
      stockJudicial += c;
      continue;
    }
    if (v.stockAB === "B") {
      stockB += c;
      continue;
    }
    if (v.esTescar) {
      tescarValor += c;
      continue;
    }
    // Stock A — distinguir vitrinas vs por facturar
    // Heurística: porLlegar = PreInscrito → "por facturar"
    if (v.porLlegar === "PreInscrito") {
      stockAPorFacturar += c;
    } else {
      stockAVitrinasNeto += c;
    }
  }

  return { stockAVitrinasNeto, tescarValor, stockAPorFacturar, stockB, stockJudicial };
}

export interface DiffResumen {
  campo: string;
  oficial: number;
  app: number;
  diferencia: number;
  diferenciaPct: number;
}

export function compararResumen(
  oficial: ResumenOficial | null,
  app: ResumenAppEstimado,
): DiffResumen[] {
  if (!oficial) return [];
  // Comparamos contra la columna "Total" (vendible) del oficial, que es la
  // métrica de gestión que usa Pompeyo.
  const filas: DiffResumen[] = [
    { campo: "Stock A vitrinas (Total)", oficial: oficial.stockAVitrinasTotal, app: app.stockAVitrinasNeto },
    { campo: "TESCAR Activo Fijo", oficial: oficial.stockAVitrinasActivoFijo, app: app.tescarValor },
    { campo: "Stock A por facturar", oficial: oficial.stockAPorFacturar, app: app.stockAPorFacturar },
    { campo: "Stock B", oficial: oficial.stockB, app: app.stockB },
    { campo: "Stock Judicial", oficial: oficial.stockJudicial, app: app.stockJudicial },
    {
      campo: "TOTAL VENDIBLE",
      oficial: oficial.granTotalVendible,
      app: app.stockAVitrinasNeto + app.stockAPorFacturar + app.stockB + app.stockJudicial,
    },
  ].map((f) => {
    const dif = f.app - f.oficial;
    const pct = f.oficial !== 0 ? dif / f.oficial : 0;
    return { ...f, diferencia: dif, diferenciaPct: pct };
  });
  return filas;
}

// ────────────────────────────────────────────────────────────
// Alertas operacionales
// ────────────────────────────────────────────────────────────

export function generarAlertas(vehiculos: Vehiculo[], lineas: LineaCredito[]): Alerta[] {
  const out: Alerta[] = [];
  let id = 0;
  const next = () => `a${++id}`;

  // Líneas
  for (const l of lineas) {
    if (l.semaforo === "sobregirada") {
      out.push({
        id: next(),
        severidad: "critica",
        tipo: "linea_sobregirada",
        titulo: `${l.marca} — Línea SOBREGIRADA`,
        detalle: `Línea libre = $${Math.round(l.lineaLibre).toLocaleString("es-CL")} (autorizada $${Math.round(l.lineaAutorizada).toLocaleString("es-CL")}, ocupada $${Math.round(l.lineaOcupada).toLocaleString("es-CL")})`,
        marca: l.marca,
        valorImpacto: Math.abs(l.lineaLibre),
        origen: "3.-Lineas de Credito",
      });
    } else if (l.semaforo === "rojo") {
      out.push({
        id: next(),
        severidad: "alta",
        tipo: "linea_sobre_90",
        titulo: `${l.marca} — Línea sobre 90%`,
        detalle: `Ocupación ${(l.porcentajeOcupacion * 100).toFixed(1)}% — libre $${Math.round(l.lineaLibre).toLocaleString("es-CL")}`,
        marca: l.marca,
        valorImpacto: l.lineaOcupada,
        origen: "3.-Lineas de Credito",
      });
    } else if (l.semaforo === "amarillo") {
      out.push({
        id: next(),
        severidad: "media",
        tipo: "linea_entre_80_90",
        titulo: `${l.marca} — Ocupación 80-90%`,
        detalle: `Ocupación ${(l.porcentajeOcupacion * 100).toFixed(1)}%`,
        marca: l.marca,
        origen: "3.-Lineas de Credito",
      });
    }
  }

  const unique = uniqByVin(vehiculos);

  // Aging >180
  for (const v of unique) {
    if ((v.diasStock ?? 0) >= 180) {
      out.push({
        id: next(),
        severidad: "alta",
        tipo: "vehiculo_mas_180",
        titulo: `Vehículo > 180 días en stock`,
        detalle: `${v.marcaPompeyo} ${v.modelo ?? ""} — ${v.diasStock} días — ${v.sucursal ?? ""}`,
        vin: v.vin,
        marca: v.marcaPompeyo,
        valorImpacto: v.costoNeto,
        origen: `Base_Stock:r${v.rowIndex}`,
      });
    }
  }

  // Pagado sin rotación >60
  for (const v of unique) {
    if (v.pagado && (v.diasStock ?? 0) >= 60) {
      out.push({
        id: next(),
        severidad: "alta",
        tipo: "pagado_sin_rotacion",
        titulo: `Vehículo pagado sin rotación`,
        detalle: `${v.marcaPompeyo} ${v.modelo ?? ""} — pagado, ${v.diasStock} días`,
        vin: v.vin,
        marca: v.marcaPompeyo,
        valorImpacto: v.costoNeto,
        origen: `Base_Stock:r${v.rowIndex}`,
      });
    }
  }

  // Stock judicial
  for (const v of unique) {
    if (v.esJudicial) {
      out.push({
        id: next(),
        severidad: "media",
        tipo: "stock_judicial",
        titulo: `Vehículo en stock judicial`,
        detalle: `${v.marcaPompeyo} ${v.modelo ?? ""} — ${v.sucursal ?? ""}`,
        vin: v.vin,
        marca: v.marcaPompeyo,
        valorImpacto: v.costoNeto,
        origen: `Base_Stock:r${v.rowIndex}`,
      });
    }
  }

  // Stock B
  for (const v of unique) {
    if (v.esStockB) {
      out.push({
        id: next(),
        severidad: "media",
        tipo: "stock_b",
        titulo: `Vehículo en Stock B`,
        detalle: `${v.marcaPompeyo} ${v.modelo ?? ""}`,
        vin: v.vin,
        marca: v.marcaPompeyo,
        valorImpacto: v.costoNeto,
        origen: `Base_Stock:r${v.rowIndex}`,
      });
    }
  }

  // Vencimientos próximos 30 días
  const hoy = new Date();
  const en30 = new Date(hoy.getTime() + 30 * 86400 * 1000);
  for (const v of unique) {
    if (!v.fechaVencimiento) continue;
    if (v.fechaVencimiento < hoy) {
      out.push({
        id: next(),
        severidad: "critica",
        tipo: "venc_vencido",
        titulo: `Vencimiento vencido`,
        detalle: `${v.marcaPompeyo} ${v.modelo ?? ""} — venc ${v.fechaVencimiento.toLocaleDateString("es-CL")}`,
        vin: v.vin,
        marca: v.marcaPompeyo,
        valorImpacto: v.costoNeto,
        origen: `Base_Stock:r${v.rowIndex}`,
      });
    } else if (v.fechaVencimiento <= en30) {
      out.push({
        id: next(),
        severidad: "alta",
        tipo: "venc_proximo_30d",
        titulo: `Vencimiento en próximos 30 días`,
        detalle: `${v.marcaPompeyo} ${v.modelo ?? ""} — venc ${v.fechaVencimiento.toLocaleDateString("es-CL")}`,
        vin: v.vin,
        marca: v.marcaPompeyo,
        valorImpacto: v.costoNeto,
        origen: `Base_Stock:r${v.rowIndex}`,
      });
    }
  }

  // VPP comprometidos (informativo)
  const vpp = unique.filter((v) => v.esVPPComprometido);
  if (vpp.length > 0) {
    out.push({
      id: next(),
      severidad: "media",
      tipo: "vpp_comprometido",
      titulo: `${vpp.length} vehículo(s) en VPP Comprometido`,
      detalle: `Capital puente: $${Math.round(vpp.reduce((s, v) => s + v.costoNeto, 0)).toLocaleString("es-CL")}`,
      valorImpacto: vpp.reduce((s, v) => s + v.costoNeto, 0),
      origen: "Base_Stock:Estado AutoPro/Status Stock",
    });
  }

  return out;
}

// ────────────────────────────────────────────────────────────
// Agrupaciones por marca
// ────────────────────────────────────────────────────────────

export interface CapitalPorMarca {
  marca: string;
  unidades: number;
  capitalTotal: number;
  capitalPropio: number;
  capitalFinanciero: number;
  capitalFloorPlan: number;
  capitalVPPComprometido: number;
  capitalPagado: number;
  unidadesMas60: number;
  capitalMas60: number;
}

export function capitalPorMarca(vehiculos: Vehiculo[]): CapitalPorMarca[] {
  const unique = uniqByVin(vehiculos);
  const map = new Map<string, CapitalPorMarca>();
  for (const v of unique) {
    const marca = v.marcaPompeyo || "SIN MARCA";
    let row = map.get(marca);
    if (!row) {
      row = {
        marca,
        unidades: 0,
        capitalTotal: 0,
        capitalPropio: 0,
        capitalFinanciero: 0,
        capitalFloorPlan: 0,
        capitalVPPComprometido: 0,
        capitalPagado: 0,
        unidadesMas60: 0,
        capitalMas60: 0,
      };
      map.set(marca, row);
    }
    const c = v.costoNeto || 0;
    row.unidades += 1;
    row.capitalTotal += c;
    if (v.tipoStock === "Propio" || v.tipoStock === "FinPropio") row.capitalPropio += c;
    else if (v.tipoStock === "Financiado") row.capitalFinanciero += c;
    else if (v.tipoStock === "FloorPlan") row.capitalFloorPlan += c;
    if (v.esVPPComprometido) row.capitalVPPComprometido += c;
    if (v.pagado) row.capitalPagado += c;
    if ((v.diasStock ?? 0) >= 60) {
      row.unidadesMas60 += 1;
      row.capitalMas60 += c;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.capitalTotal - a.capitalTotal);
}
