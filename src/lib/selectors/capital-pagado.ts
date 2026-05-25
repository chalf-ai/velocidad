/**
 * Capital Pagado por marca — vehículos cuya `Pagado?` es "Pagado".
 *
 * Importante:
 *   - USADOS se trata como marca (es un bucket consolidado en Marca Pompeyo)
 *   - Métricas por marca: unidades, capital, aging promedio, % del total
 */

import type { Vehiculo } from "../types";

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

export interface CapitalPagadoRow {
  marca: string;
  unidades: number;
  capital: number;
  pctCapital: number;
  diasPromedio: number;
  unidadesMas60: number;
  unidadesMas180: number;
}

export interface CapitalPagadoStats {
  totalUnidades: number;
  capitalTotal: number;
  diasPromedioGlobal: number;
  unidadesMas60Total: number;
  unidadesMas180Total: number;
  porMarca: CapitalPagadoRow[];
}

export function calcularCapitalPagado(vehiculos: Vehiculo[]): CapitalPagadoStats {
  const unique = uniqByVin(vehiculos);
  const pagados = unique.filter((v) => v.pagado);

  const totalUnidades = pagados.length;
  const capitalTotal = pagados.reduce((s, v) => s + v.costoNeto, 0);
  const totalDias = pagados.reduce((s, v) => s + (v.diasStock ?? 0), 0);
  const diasPromedioGlobal = totalUnidades > 0 ? totalDias / totalUnidades : 0;
  const unidadesMas60Total = pagados.filter((v) => (v.diasStock ?? 0) >= 60).length;
  const unidadesMas180Total = pagados.filter((v) => (v.diasStock ?? 0) >= 180).length;

  const map = new Map<string, { vehiculos: Vehiculo[] }>();
  for (const v of pagados) {
    const k = v.marcaPompeyo || v.marca || "SIN MARCA";
    if (!map.has(k)) map.set(k, { vehiculos: [] });
    map.get(k)!.vehiculos.push(v);
  }

  const porMarca: CapitalPagadoRow[] = Array.from(map.entries())
    .map(([marca, { vehiculos }]) => {
      const cap = vehiculos.reduce((s, v) => s + v.costoNeto, 0);
      const dias = vehiculos.reduce((s, v) => s + (v.diasStock ?? 0), 0);
      return {
        marca,
        unidades: vehiculos.length,
        capital: cap,
        pctCapital: capitalTotal > 0 ? cap / capitalTotal : 0,
        diasPromedio: vehiculos.length > 0 ? dias / vehiculos.length : 0,
        unidadesMas60: vehiculos.filter((v) => (v.diasStock ?? 0) >= 60).length,
        unidadesMas180: vehiculos.filter((v) => (v.diasStock ?? 0) >= 180).length,
      };
    })
    .sort((a, b) => b.capital - a.capital);

  return {
    totalUnidades,
    capitalTotal,
    diasPromedioGlobal,
    unidadesMas60Total,
    unidadesMas180Total,
    porMarca,
  };
}
