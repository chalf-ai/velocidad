/**
 * Agregado de Capital de Trabajo por marca originadora.
 *
 * Combina las 3 fuentes (stock activo, FNE, saldos vehículo) sin sumarlas
 * ciegamente: para el capital comprometido total descontamos potencial doble
 * conteo entre FNE.valorFactura y Saldo.saldoXDocumentar del mismo VIN.
 *
 * IMPORTANTE: este es un estimado, no un balance contable. La verdad
 * financiera sigue siendo el sistema oficial. Acá agregamos visibilidad.
 */

import type {
  FNERealCruzado,
  ProvisionRegistro,
  SaldoCruzado,
  Vehiculo,
} from "../types";
import { calcularCreditoPompeyoPorVIN } from "./credito-pompeyo";
import { limpiarVIN } from "../parser/venta-apc";
import { provisionesNoFacturadasPorMarca } from "./provisiones";
import { normalizarMarcaOperacional } from "./owner-operacional";

export interface CapitalTrabajoMarca {
  marca: string;
  /** Stock activo: suma costoNeto de vehículos en Base_Stock por marca. */
  stockValorizado: number;
  unidadesStock: number;
  /** Stock activo en Floor Plan: línea ocupada. */
  unidadesEnLinea: number;
  capitalEnLinea: number;
  /** Stock activo en Propio / FinPropio: pagado por Pompeyo. */
  capitalPropio: number;
  /** FNE: suma valorFactura de autos no entregados. */
  fneValorizado: number;
  unidadesFNE: number;
  /** Saldos cliente pendientes asignados a esta marca. */
  saldosClienteCLP: number;
  saldosUnidades: number;
  /** Crédito Pompeyo agregado (subset de saldos cliente). */
  creditoPompeyoCLP: number;
  unidadesConCreditoPompeyo: number;
  /** FNE listos para entregar 100% (sin Crédito Pompeyo). */
  unidadesListasEntrega: number;
  /** FNE con algún bloqueo. */
  unidadesBloqueadas: number;
  /** Aging promedio del FNE en días. */
  agingPromedioFNE: number;
  /** Provisiones NO facturadas asignadas a esta marca. Capital activo
   *  pendiente de facturar — consume capital de trabajo. */
  provisionesNoFacturadas: number;
  /** Estimado conservador del capital comprometido sin doble conteo:
   *  stockPropio + max(FNE, saldos) + provisionesNoFacturadas. */
  capitalComprometidoEstimado: number;
}

function marcaOf(v: { marca?: string | null; marcaPompeyo?: string | null }): string | null {
  return v.marca ?? v.marcaPompeyo ?? null;
}

export function capitalTrabajoPorMarca(
  vehiculos: Vehiculo[],
  fneCruzados: FNERealCruzado[],
  saldosCruzados: SaldoCruzado[],
  provisiones: ProvisionRegistro[] = [],
): CapitalTrabajoMarca[] {
  const map = new Map<string, CapitalTrabajoMarca>();

  // Visualización ejecutiva por marca: consolida marcas ajenas al grupo Pompeyo
  // en "OTRAS MARCAS" (USADOS y marcas del grupo quedan individuales). Centraliza
  // el plegado para todas las fuentes (stock, FNE, saldos, provisiones).
  function ensure(marcaRaw: string): CapitalTrabajoMarca {
    const marca = normalizarMarcaOperacional(marcaRaw);
    if (!map.has(marca)) {
      map.set(marca, {
        marca,
        stockValorizado: 0,
        unidadesStock: 0,
        unidadesEnLinea: 0,
        capitalEnLinea: 0,
        capitalPropio: 0,
        fneValorizado: 0,
        unidadesFNE: 0,
        saldosClienteCLP: 0,
        saldosUnidades: 0,
        creditoPompeyoCLP: 0,
        unidadesConCreditoPompeyo: 0,
        unidadesListasEntrega: 0,
        unidadesBloqueadas: 0,
        agingPromedioFNE: 0,
        provisionesNoFacturadas: 0,
        capitalComprometidoEstimado: 0,
      });
    }
    return map.get(marca)!;
  }

  // 1) Stock activo (Base_Stock)
  // Atribución por marca ORIGINADORA (no la marca física del auto): un VU/BU
  // tomado en parte de pago por una operación KIA consume capital de KIA aunque
  // el auto físico sea de otra marca. Antes se usaba `v.marca` física → el capital
  // puente caía en la marca equivocada (o en OTRAS MARCAS).
  const seenVin = new Set<string>();
  for (const v of vehiculos) {
    const k = limpiarVIN(v.vin);
    if (!k || seenVin.has(k)) continue;
    seenVin.add(k);
    const m = v.marcaOriginadora ?? marcaOf(v);
    if (!m) continue;
    const e = ensure(m);
    e.unidadesStock++;
    e.stockValorizado += v.costoNeto;
    if (v.tipoStock === "FloorPlan") {
      e.unidadesEnLinea++;
      e.capitalEnLinea += v.costoNeto;
    }
    if (v.tipoStock === "Propio" || v.tipoStock === "FinPropio") {
      e.capitalPropio += v.costoNeto;
    }
  }

  // 2) FNE — marca desde saldo/vehiculo/extra, con fallback
  const fneAging: Map<string, { suma: number; n: number }> = new Map();
  for (const c of fneCruzados) {
    const marcaRaw =
      c.vehiculo?.marca ??
      c.vehiculoExtra?.marca ??
      c.fne.sucursal?.split(/\s+/)[0] ?? // último fallback: sucursal arranca con la marca a veces
      null;
    if (!marcaRaw) continue;
    // fneAging se indexa por la misma marca operacional plegada que usa ensure()
    // para que el aging promedio calce con el bucket consolidado (OTRAS MARCAS).
    const marca = normalizarMarcaOperacional(marcaRaw);
    const e = ensure(marca);
    e.unidadesFNE++;
    e.fneValorizado += c.fne.valorFactura;
    if (c.diasDesdeFactura !== null) {
      if (!fneAging.has(marca)) fneAging.set(marca, { suma: 0, n: 0 });
      const a = fneAging.get(marca)!;
      a.suma += c.diasDesdeFactura;
      a.n++;
    }
  }

  // 3) Saldos vehículo
  const creditoMap = calcularCreditoPompeyoPorVIN(saldosCruzados);
  const saldoPorVIN: Map<string, number> = new Map();
  for (const c of saldosCruzados) {
    const s = c.saldo;
    if (s.categoria !== "vehiculo") continue;
    const marca =
      s.marca ?? c.vehiculo?.marca ?? c.vehiculoExtra?.marca ?? null;
    if (!marca) continue;
    const e = ensure(marca);
    e.saldosUnidades++;
    e.saldosClienteCLP += s.saldoXDocumentar;
    if (s.vinResuelto) {
      saldoPorVIN.set(s.vinResuelto, (saldoPorVIN.get(s.vinResuelto) ?? 0) + s.saldoXDocumentar);
    }
  }
  for (const [vin, cp] of creditoMap) {
    // marca para crédito Pompeyo desde el saldo o cruce
    const saldoSource = saldosCruzados.find((c) => c.saldo.vinResuelto === vin);
    const marca =
      saldoSource?.saldo.marca ??
      saldoSource?.vehiculo?.marca ??
      saldoSource?.vehiculoExtra?.marca ??
      null;
    if (!marca) continue;
    const e = ensure(marca);
    e.creditoPompeyoCLP += cp.monto;
    e.unidadesConCreditoPompeyo++;
  }

  // 4) Listo entrega / bloqueados por marca
  for (const c of fneCruzados) {
    const marca = c.vehiculo?.marca ?? c.vehiculoExtra?.marca ?? null;
    if (!marca) continue;
    const e = ensure(marca);
    const vin = limpiarVIN(c.fne.vin);
    const tieneCP = creditoMap.has(vin);
    if (c.estadoEntrega === "listo_para_entregar" && !tieneCP) {
      e.unidadesListasEntrega++;
    } else {
      e.unidadesBloqueadas++;
    }
  }

  // 5) Aging promedio FNE
  for (const [marca, a] of fneAging) {
    const e = map.get(marca);
    if (e && a.n > 0) e.agingPromedioFNE = a.suma / a.n;
  }

  // 6) Provisiones NO facturadas por marca. La marca del archivo de
  //    provisiones es `Origen` y puede no calzar 1:1 con la de Base_Stock
  //    (ej. "Kia" vs "KIA MOTORS"). Hacemos match case-insensitive sustring.
  const provMap = provisionesNoFacturadasPorMarca(provisiones);
  for (const [marcaProv, monto] of provMap) {
    let asignada = false;
    for (const [marcaStock, e] of map) {
      if (
        marcaStock.toUpperCase().includes(marcaProv.toUpperCase()) ||
        marcaProv.toUpperCase().includes(marcaStock.toUpperCase())
      ) {
        e.provisionesNoFacturadas += monto;
        asignada = true;
        break;
      }
    }
    if (!asignada) {
      // Marca de provisión sin equivalente en stock — creamos entry para
      // que no se pierda el monto en el agregado.
      const e = ensure(marcaProv);
      e.provisionesNoFacturadas += monto;
    }
  }

  // 7) Capital comprometido estimado SIN doble conteo
  //    Fórmula: stockPropio + max(fne, saldos) + provisionesNoFacturadas
  //    - max(fne, saldos) porque si tienen factura emitida (fne) Y saldo,
  //      suelen ser la misma op.
  //    - provisionesNoFacturadas se suma directo: es capital activo que
  //      aún no migró a saldos/factura.
  //    - NO sumamos provisiones facturadas con saldo: ya están conceptual-
  //      mente en Saldos.
  for (const e of map.values()) {
    e.capitalComprometidoEstimado =
      e.capitalPropio +
      Math.max(e.fneValorizado, e.saldosClienteCLP) +
      e.provisionesNoFacturadas;
  }

  return [...map.values()].sort((a, b) => b.capitalComprometidoEstimado - a.capitalComprometidoEstimado);
}
