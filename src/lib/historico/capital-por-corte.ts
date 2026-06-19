/**
 * Capital de trabajo por fecha de corte — las 4 métricas OFICIALES desde
 * payloads históricos, con la MISMA fuente única y el MISMO universo lógico
 * que /score-gerencial.
 *
 * FUENTE ÚNICA (decisión negocio 2026-06, fase 4 de la unificación):
 *   1. Stock Pagado        ← capital-trabajo.stockPagado
 *   2. Provisiones >90d     ← capital-trabajo.provisiones90
 *   3. Crédito Pompeyo >15d ← capital-trabajo.creditoPompeyo15
 *   4. Saldos Vehículo T3+  ← capital-trabajo.saldosT3
 * Tendencias NO recalcula con fórmulas propias: invoca exactamente esas
 * funciones. "Bonos y Comisiones" se elimina (no es una de las 4 oficiales).
 *
 * RECONCILIACIÓN DE MARCA (crítico): antes Tendencias atribuía marca con una
 * jerarquía propia P1→P4 (VIN→stock, VIN→FNE, origen). Eso DIFERÍA de Score,
 * que filtra con `useDatosFiltrados`. Para que coincidan al 100%, aquí se
 * replica EXACTAMENTE el filtro de Score:
 *   · vehículos / vinsExtra → owner ∪ originador (filtrarPorMarcaOwnerUOriginador)
 *   · saldos / provisiones / fne → owner operacional (filtrarPorMarcaOperacional)
 * Luego se construye el MISMO VehiculoUnificado y se llaman las mismas 4
 * funciones. Mismo input + misma función ⇒ mismo resultado que Score.
 *
 * Cada componente se calcula SOLO si su fuente está presente; si falta, queda
 * null — nunca se inventa.
 */

import {
  stockPagado,
  provisiones90,
  creditoPompeyo15,
  saldosT3,
  desglosarCajaInmovilizada,
  type MetricaCapital,
} from "@/lib/selectors/capital-trabajo";
import { buildVehiculosUnificados } from "@/lib/selectors/vehiculo-unificado";
import {
  filtrarPorMarcaOperacional,
  filtrarPorMarcaOwnerUOriginador,
  getMarcaOperacional,
  getMarcaOriginadora,
  normalizarMarcaOperacional,
} from "@/lib/selectors/owner-operacional";
import type {
  ParsedExcel,
  ParsedFNE,
  ParsedProvisiones,
  ParsedSaldos,
} from "@/lib/types";

export interface ComponenteCapital {
  unidades: number;
  monto: number;
}

export interface CapitalCorte {
  /** null = fuente BASE_STOCK ausente en el corte. */
  stockPagado: ComponenteCapital | null;
  /** null = fuente PROVISIONES ausente. */
  provisiones90: ComponenteCapital | null;
  /** null = fuente BASE_STOCK ausente (CP se deriva de los VU). */
  creditoPompeyo15: ComponenteCapital | null;
  /** null = fuente SALDOS ausente. */
  saldosT3: ComponenteCapital | null;
}

const comp = (m: MetricaCapital<unknown>): ComponenteCapital => ({
  unidades: m.unidades,
  monto: m.monto,
});

/**
 * Filtra los payloads crudos por marca EXACTAMENTE como `useDatosFiltrados`
 * (el hook que alimenta a Score). marca = null → sin filtro (TOTAL).
 */
function filtrarPayloadsPorMarca(args: {
  stock: ParsedExcel | null;
  fne: ParsedFNE | null;
  saldos: ParsedSaldos | null;
  provisiones: ParsedProvisiones | null;
  marca: string | null;
}): {
  stock: ParsedExcel | null;
  fne: ParsedFNE | null;
  saldos: ParsedSaldos | null;
  provisiones: ParsedProvisiones | null;
} {
  const { marca } = args;
  if (!marca) {
    return {
      stock: args.stock,
      fne: args.fne,
      saldos: args.saldos,
      provisiones: args.provisiones,
    };
  }
  const objetivo = normalizarMarcaOperacional(marca);
  return {
    stock: args.stock
      ? {
          ...args.stock,
          vehiculos: filtrarPorMarcaOwnerUOriginador(args.stock.vehiculos, marca),
          vinsExtra: args.stock.vinsExtra
            ? new Map(
                [...args.stock.vinsExtra].filter(
                  ([, info]) => normalizarMarcaOperacional(info.marca) === objetivo,
                ),
              )
            : args.stock.vinsExtra,
        }
      : null,
    fne: args.fne
      ? { ...args.fne, registros: filtrarPorMarcaOperacional(args.fne.registros, marca) }
      : null,
    saldos: args.saldos
      ? { ...args.saldos, registros: filtrarPorMarcaOperacional(args.saldos.registros, marca) }
      : null,
    provisiones: args.provisiones
      ? {
          ...args.provisiones,
          registros: filtrarPorMarcaOperacional(args.provisiones.registros, marca),
        }
      : null,
  };
}

export function capitalDesdePayloads(args: {
  stock: ParsedExcel | null;
  saldos: ParsedSaldos | null;
  provisiones: ParsedProvisiones | null;
  /** FNE vigente — entra al build de VU igual que en Score. */
  fne?: ParsedFNE | null;
  marca: string | null;
}): CapitalCorte {
  const f = filtrarPayloadsPorMarca({
    stock: args.stock,
    fne: args.fne ?? null,
    saldos: args.saldos,
    provisiones: args.provisiones,
    marca: args.marca,
  });

  // VehiculoUnificado: MISMO build que Score (stock + fne + saldos filtrados).
  const vus = f.stock
    ? Array.from(
        buildVehiculosUnificados({ data: f.stock, fne: f.fne, saldos: f.saldos }).values(),
      )
    : null;

  return {
    stockPagado: vus ? comp(stockPagado(vus)) : null,
    creditoPompeyo15: vus ? comp(creditoPompeyo15(vus)) : null,
    provisiones90: f.provisiones ? comp(provisiones90(f.provisiones.registros)) : null,
    saldosT3: f.saldos ? comp(saldosT3(f.saldos.registros)) : null,
  };
}

// ────────────────────────────────────────────────────────────────────
// DESGLOSE DE CAJA INMOVILIZADA · composición ACTUAL (Tendencias, en vivo)
//
// Lente financiero completo (Caja Inmovilizada Total = Pagado ∪ Propio ∪
// FinPropio) separado en sus 4 categorías de gestión. Recompute desde los
// payloads vigentes con el MISMO filtro de marca que Score. NO persiste nada
// (no toca DailyCapitalSnapshot ni su generación). Cuando PR 2 persista estos
// campos a diario, esto pasa a ser también serie histórica.
// ────────────────────────────────────────────────────────────────────

export interface DesgloseCajaCorte {
  total: ComponenteCapital;
  comercial: ComponenteCapital;
  testCars: ComponenteCapital;
  autosCompania: ComponenteCapital;
  judicial: ComponenteCapital;
  otros: ComponenteCapital;
}

export function desgloseCajaDesdePayloads(args: {
  stock: ParsedExcel | null;
  saldos: ParsedSaldos | null;
  fne?: ParsedFNE | null;
  marca: string | null;
}): DesgloseCajaCorte | null {
  const f = filtrarPayloadsPorMarca({
    stock: args.stock,
    fne: args.fne ?? null,
    saldos: args.saldos,
    provisiones: null,
    marca: args.marca,
  });
  if (!f.stock) return null;
  const vus = Array.from(
    buildVehiculosUnificados({ data: f.stock, fne: f.fne, saldos: f.saldos }).values(),
  );
  const d = desglosarCajaInmovilizada(vus);
  return {
    total: comp(d.total),
    comercial: comp(d.comercial),
    testCars: comp(d.testCars),
    autosCompania: comp(d.autosCompania),
    judicial: comp(d.judicial),
    otros: comp(d.otros),
  };
}

/**
 * Marcas con capital atribuido en CUALQUIER fuente vigente, usando la MISMA
 * atribución que el filtro de Score (owner ∪ originador para vehículos; owner
 * para saldos/provisiones). Garantiza que cada scope MARCA generado coincida
 * con lo que Score mostraría al filtrar por esa marca.
 */
export function marcasConCapital(args: {
  stock: ParsedExcel | null;
  saldos: ParsedSaldos | null;
  provisiones: ParsedProvisiones | null;
  fne: ParsedFNE | null;
}): string[] {
  const set = new Set<string>();
  for (const v of args.stock?.vehiculos ?? []) {
    set.add(getMarcaOperacional(v)); // owner
    set.add(getMarcaOriginadora(v)); // originador (segunda dimensión del filtro)
  }
  for (const s of args.saldos?.registros ?? []) {
    if (s.categoria !== "vehiculo" && s.categoria !== "bono_comision") continue;
    set.add(getMarcaOperacional(s));
  }
  for (const p of args.provisiones?.registros ?? []) {
    if (p.area !== "ventas" || (p.saldo || 0) <= 0) continue;
    set.add(getMarcaOperacional(p));
  }
  return Array.from(set).sort();
}
