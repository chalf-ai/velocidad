/**
 * ADAPTADOR ROMIA — función pura.
 *
 * Convierte `RomiaRow[]` (filas crudas que parsea `parseRomiaFile` desde
 * SCHIAPP+KAR y que viven en `useExcelStore.romiaSchiapp/romiaKar`) en un
 * `SnapshotRomia` apto para el motor histórico (`cruzarRomaActas`).
 *
 * Reglas (replican la fusión que hoy hace `cargar-archivos-cliente.ts` y
 * `diag/validar-cruce-vs-csv.mjs` — se centralizan aquí para que sean
 * únicas, testeables y libres de I/O):
 *   - Dedup intra-bodega: si un (bodega, VIN) aparece >1 vez, gana la
 *     PRIMERA fila.
 *   - Fusión entre bodegas: KAR es base, SCHIAPP llena nulls.
 *   - `tieneSinSalida` se combina con OR (si CUALQUIERA es true → true).
 *   - `bodega` del consolidado:
 *       - solo SCHIAPP → "SCHIAPP"
 *       - solo KAR → "KAR"
 *       - ambos → "KAR+SCHIAPP"
 *   - `fSalidaFisica` se deriva por fila: `fSalidaPatio ?? fDespacho`
 *     (preferencia por la salida física registrada en PATIO; si no hay,
 *     fallback al despacho a sucursal). Es coherente con la lógica que
 *     usa el CSV de referencia.
 *
 * Cero dependencias de Prisma, store, React, fs ni red.
 */

import type { RomiaRow } from "../logistica/romia-tipos.js";
import type { RomiaConsolidadoMin, SnapshotRomia } from "./cruce-roma-actas.js";

/**
 * Convierte una fila ROMIA cruda a la forma mínima que consume el cruce.
 * No mezcla con otras filas — esa es responsabilidad del adaptador completo.
 */
export function romiaRowToMin(r: RomiaRow): RomiaConsolidadoMin {
  return {
    vin: r.vin,
    bodega: r.bodega,
    fCompraMarca: r.fCompraMarca,
    fIngresoBodega: r.fIngresoApc,
    fSolicitudBodega: r.fSolicitudBodega,
    fPlanificacionFisica: r.fPlanificacion,
    fSalidaFisica: r.fSalidaPatio ?? r.fDespacho ?? null,
    fLlegadaPatio: r.fEntradaPatio,
    tieneSinSalida: r.tieneSinSalida,
    estadoBodega: r.estadoBodega,
    patio: r.patio,
    puntoEntrega: r.puntoEntrega,
    cumplimientoDespacho: r.cumplimientoDespacho,
  };
}

/**
 * Combina dos consolidados del mismo VIN (uno de cada bodega) según las
 * reglas declaradas en el encabezado. Pura.
 */
function fusionarPorVin(kar: RomiaConsolidadoMin, schiapp: RomiaConsolidadoMin): RomiaConsolidadoMin {
  // KAR base. SCHIAPP rellena solo donde KAR es null. `bodega` se sobreescribe
  // explícitamente al final.
  const merged: RomiaConsolidadoMin = { ...kar };
  const camposRellenables: Array<keyof RomiaConsolidadoMin> = [
    "fCompraMarca",
    "fIngresoBodega",
    "fSolicitudBodega",
    "fPlanificacionFisica",
    "fSalidaFisica",
    "fLlegadaPatio",
    "estadoBodega",
    "patio",
    "puntoEntrega",
    "cumplimientoDespacho",
  ];
  for (const k of camposRellenables) {
    if (merged[k] == null && schiapp[k] != null) {
      // El tipado por clave deja la asignación segura porque ambos valores
      // comparten el mismo tipo del campo respectivo.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (merged as any)[k] = (schiapp as any)[k];
    }
  }
  if (schiapp.tieneSinSalida) merged.tieneSinSalida = true;
  merged.bodega = `${kar.bodega}+${schiapp.bodega}`;
  return merged;
}

export interface OpcionesAdaptador {
  /** Fecha que se inscribe en el `meta.fechaCarga` del snapshot. Default `new Date()`. */
  fechaCarga?: Date;
}

/**
 * Acepta un array MIXTO de filas ROMIA (SCHIAPP+KAR juntas o por separado);
 * agrupa por bodega, dedup intra-bodega (primer match gana), y fusiona entre
 * bodegas según las reglas. Resultado: `SnapshotRomia` listo para el cruce.
 */
export function adaptarRomia(filas: RomiaRow[], opts: OpcionesAdaptador = {}): SnapshotRomia {
  // Dedup intra-bodega por (bodega, vin) — primer match gana.
  const vistos = new Set<string>();
  const schiapp = new Map<string, RomiaConsolidadoMin>();
  const kar = new Map<string, RomiaConsolidadoMin>();
  for (const r of filas) {
    if (!r.vin) continue;
    const k = `${r.bodega}::${r.vin}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    const min = romiaRowToMin(r);
    if (r.bodega === "SCHIAPP") schiapp.set(r.vin, min);
    else if (r.bodega === "KAR") kar.set(r.vin, min);
  }

  // Unir universos por VIN.
  const porVin = new Map<string, RomiaConsolidadoMin>();
  const todos = new Set<string>([...schiapp.keys(), ...kar.keys()]);
  for (const vin of todos) {
    const k = kar.get(vin);
    const s = schiapp.get(vin);
    if (k && s) porVin.set(vin, fusionarPorVin(k, s));
    else if (k) porVin.set(vin, k);
    else if (s) porVin.set(vin, s);
  }

  return {
    porVin,
    meta: { fechaCarga: opts.fechaCarga ?? new Date() },
  };
}
