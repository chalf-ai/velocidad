/**
 * Selectores del módulo Provisiones.
 *
 * Regla: los KPIs y agregaciones principales SOLO miran provisiones
 * NO facturadas. Las facturadas se cuentan aparte como referencia.
 */

import type {
  AgingProvision,
  AreaProvision,
  ProvisionRegistro,
  ProvisionesStats,
} from "../types";
import { normalizarMarcaOperacional } from "./owner-operacional";

const AGING_ORDEN: AgingProvision[] = ["0-30", "31-60", "61-90", "91-180", "180+", "sin_fecha"];

function emptyBucket() {
  return { unidades: 0, monto: 0 };
}

export function statsProvisiones(registros: ProvisionRegistro[]): ProvisionesStats {
  const activas = registros.filter((r) => r.estado === "no_facturada");
  const facturadas = registros.filter((r) => r.estado === "facturada");
  const revision = registros.filter((r) => r.estado === "revision_manual");

  const aging: ProvisionesStats["agingNoFacturadas"] = Object.fromEntries(
    AGING_ORDEN.map((k) => [k, emptyBucket()]),
  ) as ProvisionesStats["agingNoFacturadas"];

  const porMarcaMap = new Map<string, { unidades: number; monto: number }>();
  const porConceptoMap = new Map<string, { unidades: number; monto: number }>();
  const porMotivoMap = new Map<string, { unidades: number; monto: number }>();

  const porArea: ProvisionesStats["porArea"] = {
    ventas: emptyBucket(),
    postventa: emptyBucket(),
  };

  let agingSuma = 0;
  let agingCount = 0;
  let agingMax = 0;
  let montoTotal = 0;

  for (const r of activas) {
    montoTotal += r.montoProvision;
    aging[r.agingBucket].unidades++;
    aging[r.agingBucket].monto += r.montoProvision;

    // Visualización ejecutiva: marcas ajenas al grupo Pompeyo → OTRAS MARCAS.
    const marca = normalizarMarcaOperacional(r.origen);
    if (!porMarcaMap.has(marca)) porMarcaMap.set(marca, emptyBucket());
    const m = porMarcaMap.get(marca)!;
    m.unidades++;
    m.monto += r.montoProvision;

    const concepto = r.concepto ?? "(sin concepto)";
    if (!porConceptoMap.has(concepto)) porConceptoMap.set(concepto, emptyBucket());
    const c = porConceptoMap.get(concepto)!;
    c.unidades++;
    c.monto += r.montoProvision;

    const motivo = r.motivo ?? "(sin motivo)";
    if (!porMotivoMap.has(motivo)) porMotivoMap.set(motivo, emptyBucket());
    const mv = porMotivoMap.get(motivo)!;
    mv.unidades++;
    mv.monto += r.montoProvision;

    porArea[r.area].unidades++;
    porArea[r.area].monto += r.montoProvision;

    if (r.agingDias !== null) {
      agingSuma += r.agingDias;
      agingCount++;
      if (r.agingDias > agingMax) agingMax = r.agingDias;
    }
  }

  const porMarcaNoFacturadas = [...porMarcaMap.entries()]
    .map(([marca, v]) => ({ marca, ...v }))
    .sort((a, b) => b.monto - a.monto);
  const porConceptoNoFacturadas = [...porConceptoMap.entries()]
    .map(([concepto, v]) => ({ concepto, ...v }))
    .sort((a, b) => b.monto - a.monto);
  const porMotivoNoFacturadas = [...porMotivoMap.entries()]
    .map(([motivo, v]) => ({ motivo, ...v }))
    .sort((a, b) => b.monto - a.monto);

  return {
    noFacturadas: { unidades: activas.length, monto: montoTotal },
    agingNoFacturadas: aging,
    porMarcaNoFacturadas,
    porConceptoNoFacturadas,
    porMotivoNoFacturadas,
    porArea,
    agingPromedioDias: agingCount > 0 ? Math.round(agingSuma / agingCount) : 0,
    agingMaxDias: agingMax,
    facturadasReferencia: {
      unidades: facturadas.length,
      monto: facturadas.reduce((s, r) => s + r.montoProvision, 0),
    },
    revisionManual: {
      unidades: revision.length,
      monto: revision.reduce((s, r) => s + r.montoProvision, 0),
    },
    total: registros.length,
  };
}

/** Provisiones NO facturadas por marca para integrar al cockpit de Capital
 *  de trabajo. Solo el universo activo. */
export function provisionesNoFacturadasPorMarca(
  registros: ProvisionRegistro[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of registros) {
    if (r.estado !== "no_facturada") continue;
    const marca = (r.origen ?? "").trim();
    if (!marca) continue;
    map.set(marca, (map.get(marca) ?? 0) + r.montoProvision);
  }
  return map;
}

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
