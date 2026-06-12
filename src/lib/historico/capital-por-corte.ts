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
 *   · Bonos y Com.  ← SALDOS, categoría "bono_comision". Con filtro de
 *     marca activo queda null (los bonos no tienen VIN/marca confiable —
 *     misma regla que el Score Gerencial histórico).
 *   · Provisiones   ← PROVISIONES, área ventas con saldo > 0 (capital
 *     realmente comprometido, mismo criterio que saldoPositivo).
 *   · Filtro de marca espejo del SG histórico: stock por marca operacional,
 *     saldos vehículo por VIN ∈ stock de la marca, provisiones por origen.
 */

import { calcularCapitalPagado } from "@/lib/selectors/capital-pagado";
import { normalizarMarcaOperacional } from "@/lib/selectors/owner-operacional";
import { limpiarVIN } from "@/lib/parser/venta-apc";
import type {
  ParsedExcel,
  ParsedProvisiones,
  ParsedSaldos,
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
  /** null = fuente SALDOS ausente, o filtro de marca activo (no aplicable). */
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

export function capitalDesdePayloads(args: {
  stock: ParsedExcel | null;
  saldos: ParsedSaldos | null;
  provisiones: ParsedProvisiones | null;
  marca: string | null;
}): CapitalCorte {
  const marcaCanonica = args.marca ? normalizarMarcaOperacional(args.marca) : null;

  // ── Stock Pagado ───────────────────────────────────────────────────
  let stockPagado: ComponenteCapital | null = null;
  let vehiculosMarca: Vehiculo[] | null = null;
  if (args.stock) {
    vehiculosMarca = vehiculosDeMarca(args.stock.vehiculos, marcaCanonica);
    const stats = calcularCapitalPagado(vehiculosMarca);
    stockPagado = { unidades: stats.totalUnidades, monto: stats.capitalTotal };
  }

  // ── Saldos vehículo + Bonos y comisiones ───────────────────────────
  let saldosVehiculo: ComponenteCapital | null = null;
  let bonos: ComponenteCapital | null = null;
  if (args.saldos) {
    // Con marca: igual que el SG histórico — solo saldos de vehículos cuyo
    // VIN resuelto pertenece al stock de la marca.
    const vinsMarca =
      marcaCanonica && vehiculosMarca
        ? new Set(vehiculosMarca.map((v) => limpiarVIN(v.vin)).filter(Boolean))
        : null;

    const veh = { unidades: 0, monto: 0 };
    const bon = { unidades: 0, monto: 0 };
    for (const s of args.saldos.registros) {
      if (s.categoria === "vehiculo") {
        if (vinsMarca) {
          const v = s.vinResuelto ? limpiarVIN(s.vinResuelto) : null;
          if (!v || !vinsMarca.has(v)) continue;
        }
        veh.unidades++;
        veh.monto += s.saldoXDocumentar;
      } else if (s.categoria === "bono_comision" && !marcaCanonica) {
        bon.unidades++;
        bon.monto += s.saldoXDocumentar;
      }
    }
    saldosVehiculo = veh;
    // Bonos no son atribuibles a una marca con confianza — null bajo filtro.
    bonos = marcaCanonica ? null : bon;
  }

  // ── Provisiones (ventas · saldo > 0 = capital comprometido) ────────
  let provisiones: ComponenteCapital | null = null;
  if (args.provisiones) {
    const acc = { unidades: 0, monto: 0 };
    for (const p of args.provisiones.registros) {
      if (p.area !== "ventas") continue;
      if ((p.saldo || 0) <= 0) continue;
      if (marcaCanonica && normalizarMarcaOperacional(p.origen ?? "") !== marcaCanonica) continue;
      acc.unidades++;
      acc.monto += p.saldo || 0;
    }
    provisiones = acc;
  }

  return { stockPagado, saldosVehiculo, bonos, provisiones };
}
