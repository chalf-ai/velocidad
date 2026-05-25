/**
 * BUILDER · construye LogisticaOperacionVIN[] mergeando las dos fuentes por VIN.
 *
 * Fuentes (ver modelo.ts):
 *   - ROMA  (agenda del vendedor): solicitud, respuesta logística, llegada,
 *     factura, inscripción, entrega comprometida, PasoActual, Estado.
 *   - STLI  (bodega): ingreso APC, solicitud bodega, planificación, despacho,
 *     cumplimiento, tipo solicitud, sucursal destino.
 *
 * Pura: no lee archivos ni store. Recibe filas ya tipadas (las produce el parser
 * de la etapa de ingesta) + sets de VIN vivos (stock / FNE) para enriquecer.
 * El merge es por VIN normalizado (limpiarVIN), misma llave del resto del sistema.
 */

import { limpiarVIN } from "../parser/venta-apc";
import type { LogisticaOperacionVIN } from "./modelo";

/** Fila de la agenda del vendedor (Diciembre-Mayo ROMA / hoja ROMA). */
export interface LogisticaRomaRow {
  ventaId: number | null;
  vin: string;
  marca: string | null;
  modelo: string | null;
  sucursal: string | null;
  fSolicitud: Date | null; // K FechaSolicitud
  fRespuestaLogistica: Date | null; // V fecha_RespuestaGestionLogistica
  fLlegadaSucursal: Date | null; // S FechaETASucursal (llegada confirmada)
  fFactura: Date | null; // L FechaFactura
  fInscripcion: Date | null; // M FechaEnprocesoIns
  fEntregaComprometida: Date | null; // J FechaEstimadaEntrega
  fRespuestaInstalacionAcc: Date | null; // U fecha_RespuestaInstalacionAcc
  pasoActual: string | null;
  estado: string | null; // Pendiente / Realizada / Anulada
}

/** Fila de la ejecución de bodega (Logistica.xlsx / hoja Hoja2). */
export interface LogisticaStliRow {
  vin: string;
  marca: string | null;
  sucursalDestino: string | null;
  tipoSolicitud: string | null; // VENTA / VITRINA / TEST CAR / TRASPASO / USADOS / DONANTE
  fIngresoApc: Date | null;
  fSolicitudBodega: Date | null; // "Fecha de solicitud a STLI"
  fPlanificacion: Date | null; // "Fecha Planificacion STLI"
  fDespacho: Date | null; // "Fecha despacho a sucursal"
  cumplimientoDespacho: string | null; // CUMPLIDO / NO CUMPLIDO
  diasPreentrega: number | null;
  diasStock: number | null;
}

export interface ConstruirOpts {
  /** VINs (normalizados) presentes en Base_Stock actual. */
  stockVins?: Set<string>;
  /** VINs (normalizados) presentes en FNE actual. */
  fneVins?: Set<string>;
}

const t = (d: Date | null | undefined): number => (d ? d.getTime() : -1);

/**
 * Merge por VIN → Map<vinLimpio, LogisticaOperacionVIN>.
 * Si un VIN tiene varias filas ROMA, gana la de solicitud más reciente
 * (la operación viva). STLI normalmente trae una fila por VIN.
 */
export function construirLogisticaPorVin(
  roma: LogisticaRomaRow[],
  stli: LogisticaStliRow[],
  opts: ConstruirOpts = {},
): Map<string, LogisticaOperacionVIN> {
  const stockVins = opts.stockVins ?? new Set<string>();
  const fneVins = opts.fneVins ?? new Set<string>();

  // ROMA: quedarse con la fila de solicitud más reciente por VIN.
  const romaByVin = new Map<string, LogisticaRomaRow>();
  for (const r of roma) {
    const k = limpiarVIN(r.vin);
    if (!k) continue;
    const prev = romaByVin.get(k);
    if (!prev || t(r.fSolicitud) > t(prev.fSolicitud)) romaByVin.set(k, r);
  }
  // STLI: una por VIN (gana el ingreso APC más reciente si hay duplicado).
  const stliByVin = new Map<string, LogisticaStliRow>();
  for (const s of stli) {
    const k = limpiarVIN(s.vin);
    if (!k) continue;
    const prev = stliByVin.get(k);
    if (!prev || t(s.fIngresoApc) > t(prev.fIngresoApc)) stliByVin.set(k, s);
  }

  const out = new Map<string, LogisticaOperacionVIN>();
  const vins = new Set<string>([...romaByVin.keys(), ...stliByVin.keys()]);
  for (const vin of vins) {
    const r = romaByVin.get(vin) ?? null;
    const s = stliByVin.get(vin) ?? null;
    out.set(vin, {
      vin,
      ventaId: r?.ventaId ?? null,
      marca: r?.marca ?? s?.marca ?? null,
      modelo: r?.modelo ?? null,
      sucursalDestino: s?.sucursalDestino ?? r?.sucursal ?? null,
      tipoSolicitud: s?.tipoSolicitud ?? null,
      fSolicitudVendedor: r?.fSolicitud ?? null,
      fRespuestaLogistica: r?.fRespuestaLogistica ?? null,
      fIngresoApc: s?.fIngresoApc ?? null,
      fSolicitudBodega: s?.fSolicitudBodega ?? null,
      fPlanificacion: s?.fPlanificacion ?? null,
      fDespacho: s?.fDespacho ?? null,
      fLlegadaSucursal: r?.fLlegadaSucursal ?? null,
      fFactura: r?.fFactura ?? null,
      fInscripcion: r?.fInscripcion ?? null,
      fEntregaComprometida: r?.fEntregaComprometida ?? null,
      estadoArchivo: r?.estado ?? null,
      pasoActual: r?.pasoActual ?? null,
      cumplimientoDespacho: s?.cumplimientoDespacho ?? null,
      enStock: stockVins.has(vin),
      enFNE: fneVins.has(vin),
    });
  }
  return out;
}
