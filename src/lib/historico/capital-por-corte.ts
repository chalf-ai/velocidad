/**
 * Capital de trabajo por fecha de corte — componentes REALES desde payloads
 * históricos (mismas fuentes que el dashboard, misma rehidratación que el
 * motor V5 de /tendencias).
 *
 * Reglas (decisión usuario 2026-06):
 *   · Cada componente se calcula SOLO si su fuente está presente en el
 *     corte. Si falta, el componente queda null — nunca se inventa.
 *   · Stock Pagado  ← BASE_STOCK  (unidades pagadas + costo neto, mismo
 *     selector calcularCapitalPagado del dashboard).
 *   · Saldos        ← SALDOS, categoría "vehiculo" (unidades + $ por
 *     documentar).
 *   · Bonos y Com.  ← SALDOS, categoría "bono_comision".
 *   · Provisiones   ← PROVISIONES, área ventas con saldo > 0 (capital
 *     realmente comprometido, mismo criterio que saldoPositivo).
 *
 * ATRIBUCIÓN POR MARCA (decisión usuario 2026-06, corrección):
 * jerarquía única para saldos/bonos/provisiones — intentar SIEMPRE atribuir
 * antes de declarar algo no atribuible:
 *   P1 · VIN → Stock vigente → marca (espacio de marca física normalizada,
 *        el mismo del filtro de stock).
 *   P2 · VIN → FNE vigente → marca (sucursal de venta, función madre).
 *   P3 · Marca explícita en la fuente, vía función madre
 *        getMarcaOperacional: Saldo.marca (+ regla empresa PC Automóviles →
 *        USADOS), bonos → sucursal de negocio, Provisión.origen.
 *   P4 · "SIN MARCA ORIGEN" — solo si nada de lo anterior resuelve.
 *        Es el ÚNICO caso realmente no atribuible.
 */

import { calcularCapitalPagado } from "@/lib/selectors/capital-pagado";
import { resolverVinsSaldos } from "@/lib/selectors/saldos";
import {
  getMarcaOperacional,
  MARCA_SIN_ORIGEN,
  normalizarMarcaOperacional,
} from "@/lib/selectors/owner-operacional";
import { limpiarVIN } from "@/lib/parser/venta-apc";
import type {
  ParsedExcel,
  ParsedFNE,
  ParsedProvisiones,
  ParsedSaldos,
  ProvisionRegistro,
  SaldoRegistro,
  Vehiculo,
} from "@/lib/types";

export interface ComponenteCapital {
  unidades: number;
  monto: number;
}

export interface CapitalCorte {
  /** null = fuente BASE_STOCK ausente en el corte. */
  stockPagado: ComponenteCapital | null;
  /** null = fuente SALDOS ausente. */
  saldosVehiculo: ComponenteCapital | null;
  /** null = fuente SALDOS ausente. */
  bonos: ComponenteCapital | null;
  /** null = fuente PROVISIONES ausente. */
  provisiones: ComponenteCapital | null;
}

function vehiculosDeMarca(vehiculos: Vehiculo[], marcaCanonica: string | null): Vehiculo[] {
  if (!marcaCanonica) return vehiculos;
  return vehiculos.filter(
    (v) => normalizarMarcaOperacional(v.marcaPompeyo || v.marca || "") === marcaCanonica,
  );
}

// ────────────────────────────────────────────────────────────────────
// Mapas VIN → marca (P1 stock, P2 FNE) y resolución por jerarquía
// ────────────────────────────────────────────────────────────────────

export interface MapasVinMarca {
  /** VIN limpio → marca (física normalizada — mismo espacio que el stock). */
  stock: Map<string, string>;
  /** VIN limpio → marca operacional del registro FNE (sucursal de venta). */
  fne: Map<string, string>;
}

export function construirMapasVinMarca(
  stock: ParsedExcel | null,
  fne: ParsedFNE | null,
): MapasVinMarca {
  const stockMap = new Map<string, string>();
  for (const v of stock?.vehiculos ?? []) {
    const vin = limpiarVIN(v.vin);
    if (vin && !stockMap.has(vin)) {
      stockMap.set(vin, normalizarMarcaOperacional(v.marcaPompeyo || v.marca || ""));
    }
  }
  const fneMap = new Map<string, string>();
  for (const r of fne?.registros ?? []) {
    const vin = limpiarVIN(r.vin);
    if (vin && !fneMap.has(vin)) fneMap.set(vin, getMarcaOperacional(r));
  }
  return { stock: stockMap, fne: fneMap };
}

/** Marca de un saldo (vehículo o bono/comisión) por la jerarquía P1→P4. */
export function marcaDeSaldo(s: SaldoRegistro, mapas: MapasVinMarca): string {
  const vin = s.vinResuelto ? limpiarVIN(s.vinResuelto) : null;
  if (vin) {
    const porStock = mapas.stock.get(vin);
    if (porStock && porStock !== MARCA_SIN_ORIGEN) return porStock; // P1
    const porFNE = mapas.fne.get(vin);
    if (porFNE && porFNE !== MARCA_SIN_ORIGEN) return porFNE; // P2
  }
  return getMarcaOperacional(s); // P3 (marca explícita / empresa / sucursal) o P4
}

/** Marca de una provisión (no tiene VIN): origen vía función madre. */
export function marcaDeProvision(p: ProvisionRegistro): string {
  return getMarcaOperacional(p); // P3 (origen) o P4
}

export function capitalDesdePayloads(args: {
  stock: ParsedExcel | null;
  saldos: ParsedSaldos | null;
  provisiones: ParsedProvisiones | null;
  /** FNE vigente — habilita la vía P2 (VIN → FNE) de la jerarquía. */
  fne?: ParsedFNE | null;
  marca: string | null;
}): CapitalCorte {
  const marcaCanonica = args.marca ? normalizarMarcaOperacional(args.marca) : null;

  // ── Stock Pagado ───────────────────────────────────────────────────
  let stockPagado: ComponenteCapital | null = null;
  if (args.stock) {
    const vehiculosMarca = vehiculosDeMarca(args.stock.vehiculos, marcaCanonica);
    const stats = calcularCapitalPagado(vehiculosMarca);
    stockPagado = { unidades: stats.totalUnidades, monto: stats.capitalTotal };
  }

  // ── Saldos vehículo + Bonos y comisiones (jerarquía P1→P4) ─────────
  let saldosVehiculo: ComponenteCapital | null = null;
  let bonos: ComponenteCapital | null = null;
  if (args.saldos) {
    // Enriquecimiento oficial de vinResuelto (resolverVinsSaldos) antes de
    // atribuir. Determinista: depende solo de estos inputs, no del orden de
    // ejecución de otros cálculos.
    resolverVinsSaldos(
      args.saldos.registros,
      args.stock?.vehiculos ?? [],
      args.stock?.vinsExtra ?? null,
      args.fne ?? null,
    );
    const mapas = construirMapasVinMarca(args.stock, args.fne ?? null);

    const veh = { unidades: 0, monto: 0 };
    const bon = { unidades: 0, monto: 0 };
    for (const s of args.saldos.registros) {
      if (s.categoria !== "vehiculo" && s.categoria !== "bono_comision") continue;
      if (marcaCanonica && marcaDeSaldo(s, mapas) !== marcaCanonica) continue;
      const acc = s.categoria === "vehiculo" ? veh : bon;
      acc.unidades++;
      acc.monto += s.saldoXDocumentar;
    }
    saldosVehiculo = veh;
    bonos = bon;
  }

  // ── Provisiones (ventas · saldo > 0 = capital comprometido) ────────
  let provisiones: ComponenteCapital | null = null;
  if (args.provisiones) {
    const acc = { unidades: 0, monto: 0 };
    for (const p of args.provisiones.registros) {
      if (p.area !== "ventas") continue;
      if ((p.saldo || 0) <= 0) continue;
      if (marcaCanonica && marcaDeProvision(p) !== marcaCanonica) continue;
      acc.unidades++;
      acc.monto += p.saldo || 0;
    }
    provisiones = acc;
  }

  return { stockPagado, saldosVehiculo, bonos, provisiones };
}
