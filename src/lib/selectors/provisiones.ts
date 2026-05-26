/**
 * Selectores del módulo Provisiones.
 *
 * REGLA CONTABLE OFICIAL: la métrica vigente es SUM(saldo) — el saldo pendiente
 * real que viene del archivo. NO se usa montoProvision como monto pendiente.
 *   · montoProvision = provisión original generada
 *   · montoFactura   = lo ya facturado contra esa provisión
 *   · saldo          = monto pendiente real (col oficial)
 *
 * Universo principal del módulo = registros del área "ventas" (postventa se
 * reporta aparte como referencia, no entra al panel principal). El bucket de
 * saldo negativo (sobrefacturación / ajustes) se conserva visible: es info.
 */

import type {
  AgingProvision,
  AreaProvision,
  ProvisionRegistro,
  ProvisionesStats,
} from "../types";
import { normalizarMarcaOperacional } from "./owner-operacional";

const AGING_ORDEN: AgingProvision[] = ["0-30", "31-60", "61-90", "91-180", "180+", "sin_fecha"];

const emptyAging = (): Record<AgingProvision, { unidades: number; saldo: number }> =>
  Object.fromEntries(
    AGING_ORDEN.map((k) => [k, { unidades: 0, saldo: 0 }]),
  ) as Record<AgingProvision, { unidades: number; saldo: number }>;

export function statsProvisiones(registros: ProvisionRegistro[]): ProvisionesStats {
  // Universo principal: área "ventas". Postventa va aparte como referencia.
  const ventas = registros.filter((r) => r.area === "ventas");
  const postventa = registros.filter((r) => r.area === "postventa");

  let saldoPendiente = 0;
  let saldoPositivo = 0;
  let saldoNegativo = 0;
  let montoProvisionTotal = 0;
  let montoFacturaTotal = 0;
  let abiertas = 0;
  let cerradas = 0;
  let agingSuma = 0;
  let agingCount = 0;
  let agingMax = 0;

  const agingAbiertas = emptyAging();

  type MarcaAcc = {
    unidades: number;
    montoProvision: number;
    montoFactura: number;
    saldo: number;
    saldoPositivo: number;
    saldoNegativo: number;
    cerradas: number;
  };
  const porMarcaMap = new Map<string, MarcaAcc>();
  const porConceptoMap = new Map<string, { unidades: number; saldo: number }>();
  const porMotivoMap = new Map<string, { unidades: number; saldo: number }>();

  for (const r of ventas) {
    const s = r.saldo || 0;
    saldoPendiente += s;
    montoProvisionTotal += r.montoProvision || 0;
    montoFacturaTotal += r.montoFactura || 0;
    if (s > 0) saldoPositivo += s;
    else if (s < 0) saldoNegativo += s;

    if (s !== 0) {
      abiertas++;
      agingAbiertas[r.agingBucket].unidades++;
      agingAbiertas[r.agingBucket].saldo += s;
      if (r.agingDias !== null) {
        agingSuma += r.agingDias;
        agingCount++;
        if (r.agingDias > agingMax) agingMax = r.agingDias;
      }
    } else {
      cerradas++;
    }

    // Visualización ejecutiva: marcas ajenas al grupo Pompeyo → OTRAS MARCAS.
    const marca = normalizarMarcaOperacional(r.origen);
    let m = porMarcaMap.get(marca);
    if (!m) {
      m = { unidades: 0, montoProvision: 0, montoFactura: 0, saldo: 0, saldoPositivo: 0, saldoNegativo: 0, cerradas: 0 };
      porMarcaMap.set(marca, m);
    }
    m.unidades++;
    m.montoProvision += r.montoProvision || 0;
    m.montoFactura += r.montoFactura || 0;
    m.saldo += s;
    if (s > 0) m.saldoPositivo += s;
    else if (s < 0) m.saldoNegativo += s;
    else m.cerradas++;

    if (s !== 0) {
      const concepto = r.concepto ?? "(sin concepto)";
      let c = porConceptoMap.get(concepto);
      if (!c) {
        c = { unidades: 0, saldo: 0 };
        porConceptoMap.set(concepto, c);
      }
      c.unidades++;
      c.saldo += s;

      const motivo = r.motivo ?? "(sin motivo)";
      let mv = porMotivoMap.get(motivo);
      if (!mv) {
        mv = { unidades: 0, saldo: 0 };
        porMotivoMap.set(motivo, mv);
      }
      mv.unidades++;
      mv.saldo += s;
    }
  }

  const porMarca = [...porMarcaMap.entries()]
    .map(([marca, v]) => ({ marca, ...v }))
    .sort((a, b) => b.saldo - a.saldo);
  const porConcepto = [...porConceptoMap.entries()]
    .map(([concepto, v]) => ({ concepto, ...v }))
    .sort((a, b) => b.saldo - a.saldo);
  const porMotivo = [...porMotivoMap.entries()]
    .map(([motivo, v]) => ({ motivo, ...v }))
    .sort((a, b) => b.saldo - a.saldo);

  const porArea: Record<AreaProvision, { unidades: number; saldo: number }> = {
    ventas: { unidades: ventas.length, saldo: saldoPendiente },
    postventa: {
      unidades: postventa.length,
      saldo: postventa.reduce((acc, r) => acc + (r.saldo || 0), 0),
    },
  };

  return {
    total: ventas.length,
    saldoPendiente,
    saldoPositivo,
    saldoNegativo,
    montoProvisionTotal,
    montoFacturaTotal,
    abiertas,
    cerradas,
    porMarca,
    porConcepto,
    porMotivo,
    agingAbiertas,
    agingPromedioDias: agingCount > 0 ? Math.round(agingSuma / agingCount) : 0,
    agingMaxDias: agingMax,
    postventaReferencia: {
      unidades: postventa.length,
      saldo: postventa.reduce((acc, r) => acc + (r.saldo || 0), 0),
      montoProvision: postventa.reduce((acc, r) => acc + (r.montoProvision || 0), 0),
    },
    porArea,
  };
}

/**
 * Provisiones ABIERTAS por marca (SUM(saldo > 0) por marca de origen) para
 * integrar al cockpit de Capital de trabajo. Solo el universo activo de ventas.
 */
export function provisionesAbiertasPorMarca(
  registros: ProvisionRegistro[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of registros) {
    if (r.area !== "ventas") continue;
    if (!(r.saldo > 0)) continue; // solo positivos: consumen capital de trabajo
    const marca = (r.origen ?? "").trim();
    if (!marca) continue;
    map.set(marca, (map.get(marca) ?? 0) + r.saldo);
  }
  return map;
}

/** @deprecated nombre histórico — usar provisionesAbiertasPorMarca. */
export const provisionesNoFacturadasPorMarca = provisionesAbiertasPorMarca;

export const AGING_PROVISION_LABEL: Record<AgingProvision, string> = {
  "0-30": "0-30 días",
  "31-60": "31-60 días",
  "61-90": "61-90 días",
  "91-180": "91-180 días",
  "180+": "+180 días",
  sin_fecha: "Sin fecha",
};

export const AGING_PROVISION_TONE: Record<
  AgingProvision,
  "success" | "info" | "warning" | "danger" | "muted"
> = {
  "0-30": "success",
  "31-60": "info",
  "61-90": "warning",
  "91-180": "danger",
  "180+": "danger",
  sin_fecha: "muted",
};

export const AGING_PROVISION_ORDEN: AgingProvision[] = [
  "0-30",
  "31-60",
  "61-90",
  "91-180",
  "180+",
  "sin_fecha",
];

export const AREA_LABEL: Record<AreaProvision, string> = {
  ventas: "Ventas",
  postventa: "Postventa",
};
