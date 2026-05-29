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
import type { FuenteHito, FuentesPorHito, RomiaRow } from "./romia-tipos";

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
  /** Filas ROMIA (SCHIAPP + KAR combinadas). Cuando un VIN está aquí, prevalece
   *  sobre las filas legacy ROMA/STLI para los hitos que ROMIA cubre. */
  romia?: RomiaRow[];
}

const t = (d: Date | null | undefined): number => (d ? d.getTime() : -1);

/**
 * Merge por VIN → Map<vinLimpio, LogisticaOperacionVIN>.
 *
 * Estrategia de coexistencia (camino 2):
 *   1. Para cada hito, se intenta resolver desde ROMIA (SCHIAPP/KAR) primero.
 *   2. Si ROMIA no aporta, se cae al modelo legacy (ROMA/STLI).
 *   3. La trazabilidad por hito (`fuentesPorHito`) registra de dónde vino cada
 *      fecha + nivel de confianza — para mostrar en la ficha.
 *
 * Reglas específicas de ROMIA:
 *   - "Llegada a sucursal": NO se infiere desde ENTRADAS (eso es entrada al
 *     patio bodega, no a sucursal). Si ROMIA no aporta, fallback al legacy
 *     (FechaETASucursal de Diciembre-Mayo ROMA).
 *   - "SIN SALIDA" en `Fecha despacho a sucursal` → fDespacho=null +
 *     tieneSinSalida=true (no se inventa fecha).
 *   - Si un VIN está en ambas bodegas (SCHIAPP + KAR), gana la fila con datos
 *     más completos; los hitos faltantes se rellenan con la otra bodega.
 */
export function construirLogisticaPorVin(
  roma: LogisticaRomaRow[],
  stli: LogisticaStliRow[],
  opts: ConstruirOpts = {},
): Map<string, LogisticaOperacionVIN> {
  const stockVins = opts.stockVins ?? new Set<string>();
  const fneVins = opts.fneVins ?? new Set<string>();
  const romiaInput = opts.romia ?? [];

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
  // ROMIA: agrupar por VIN. Si un VIN está en ambas bodegas, mantenemos las dos
  // (se mergean por hito a continuación, no hay "ganador" único).
  const romiaByVin = new Map<string, RomiaRow[]>();
  for (const x of romiaInput) {
    const k = limpiarVIN(x.vin);
    if (!k) continue;
    const arr = romiaByVin.get(k);
    if (arr) arr.push(x);
    else romiaByVin.set(k, [x]);
  }

  const out = new Map<string, LogisticaOperacionVIN>();
  const vins = new Set<string>([
    ...romaByVin.keys(),
    ...stliByVin.keys(),
    ...romiaByVin.keys(),
  ]);
  for (const vin of vins) {
    const r = romaByVin.get(vin) ?? null;
    const s = stliByVin.get(vin) ?? null;
    const romiaRows = romiaByVin.get(vin) ?? [];
    out.set(vin, buildOne(vin, r, s, romiaRows, stockVins, fneVins));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos del merge por hito (prioridad ROMIA > legacy)
// ─────────────────────────────────────────────────────────────────────────────

/** Primer valor no-null de la lista, devolviendo también la fuente que lo aportó. */
function pickWithSource<T>(
  candidates: Array<{ v: T | null | undefined; fuente: FuenteHito; confianza: "alta" | "media" | "baja" }>,
): { value: T | null; fuente: FuenteHito; confianza: "alta" | "media" | "baja" | "ninguna" } {
  for (const c of candidates) {
    if (c.v !== null && c.v !== undefined) {
      return { value: c.v, fuente: c.fuente, confianza: c.confianza };
    }
  }
  return { value: null, fuente: "ninguna", confianza: "ninguna" };
}

/**
 * Consolida múltiples filas ROMIA del mismo VIN (caso "VIN en ambas bodegas").
 * Estrategia: campo a campo, primero el valor no-null. Prioridad SCHIAPP=KAR
 * (ninguna gana sobre la otra — la primera con dato manda).
 */
function consolidarRomia(rows: RomiaRow[]): RomiaRow | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];
  // Merge campo a campo, valor no-null gana
  const merged = { ...rows[0] };
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    for (const k of Object.keys(r) as (keyof RomiaRow)[]) {
      if ((merged[k] === null || merged[k] === undefined) && r[k] !== null && r[k] !== undefined) {
        // @ts-expect-error mismo tipo
        merged[k] = r[k];
      }
    }
    if (!merged.tieneSinSalida && r.tieneSinSalida) merged.tieneSinSalida = true;
  }
  return merged;
}

function buildOne(
  vin: string,
  r: LogisticaRomaRow | null,
  s: LogisticaStliRow | null,
  romiaRows: RomiaRow[],
  stockVins: Set<string>,
  fneVins: Set<string>,
): LogisticaOperacionVIN {
  const x = consolidarRomia(romiaRows);
  const fuenteRomia: FuenteHito = x ? `ROMIA_${x.bodega}` : "ninguna";
  const fuentes: FuentesPorHito = {};

  // Helper: aplica pickWithSource y registra fuente en `fuentes` solo si se resolvió.
  function resolve<T>(
    hito: import("./modelo").HitoLogistico,
    cands: Array<{ v: T | null | undefined; fuente: FuenteHito; confianza: "alta" | "media" | "baja" }>,
  ): T | null {
    const res = pickWithSource(cands);
    if (res.value !== null) {
      fuentes[hito] = {
        fecha: res.value instanceof Date ? res.value : null,
        fuente: res.fuente,
        confianza: res.confianza === "ninguna" ? "ninguna" : res.confianza,
      };
    } else {
      fuentes[hito] = { fecha: null, fuente: "ninguna", confianza: "ninguna" };
    }
    return res.value;
  }

  // ── Hito a hito (ROMIA > legacy en general, EXCEPCIÓN solicitud_vendedor) ──
  // EXCEPCIÓN semántica: solicitud_vendedor.
  //   ROMA `FechaSolicitud` = momento real en que el vendedor pidió la unidad
  //     (registro comercial, dispara el SLA de venta→entrega).
  //   KAR/SCHIAPP `Fecha Solicitud` en hoja Distribución = momento en que la
  //     bodega registra la asignación (más tarde, evento bodega-céntrico).
  //   Por eso ROMA gana SIEMPRE para este hito; si solo hay ROMIA, baja a
  //   confianza "media" para que la UI lo marque como proxy.
  const fSolicitudVendedor = resolve("solicitud_vendedor", [
    { v: r?.fSolicitud, fuente: "LEGACY_ROMA", confianza: "alta" },
    { v: x?.fSolicitudVendedor, fuente: fuenteRomia, confianza: "media" },
  ]);
  // Respuesta logística: no hay equivalente ROMIA limpio. Solo legacy.
  const fRespuestaLogistica = resolve("respuesta_logistica", [
    { v: r?.fRespuestaLogistica, fuente: "LEGACY_ROMA", confianza: "alta" },
  ]);
  const fIngresoApc = resolve("ingreso_apc", [
    { v: x?.fIngresoApc, fuente: fuenteRomia, confianza: "alta" },
    { v: s?.fIngresoApc, fuente: "LEGACY_STLI", confianza: "alta" },
  ]);
  const fSolicitudBodega = resolve("solicitud_bodega", [
    { v: x?.fSolicitudBodega, fuente: fuenteRomia, confianza: "alta" },
    { v: s?.fSolicitudBodega, fuente: "LEGACY_STLI", confianza: "alta" },
  ]);
  // Planificación: SCHIAPP usa "Fecha teorica STLI" (alta), KAR usa "Fecha limite"
  // como proxy (media — semánticamente es SLA, no planificación de despacho).
  const fPlanificacion = resolve("planificacion_despacho", [
    { v: x?.fPlanificacion, fuente: fuenteRomia, confianza: "alta" },
    { v: x?.fechaLimite, fuente: fuenteRomia, confianza: "media" },
    { v: s?.fPlanificacion, fuente: "LEGACY_STLI", confianza: "alta" },
  ]);
  const fDespacho = resolve("despacho", [
    { v: x?.fDespacho, fuente: fuenteRomia, confianza: "alta" },
    { v: x?.fSalidaPatio, fuente: fuenteRomia, confianza: "media" },
    { v: s?.fDespacho, fuente: "LEGACY_STLI", confianza: "alta" },
  ]);
  // Llegada a sucursal: NO inferir desde ENTRADAS (decisión explícita del producto).
  // Solo aceptamos legacy ROMA. ROMIA no aporta este hito hoy.
  const fLlegadaSucursal = resolve("llegada_sucursal", [
    { v: r?.fLlegadaSucursal, fuente: "LEGACY_ROMA", confianza: "alta" },
  ]);
  const fFactura = resolve("factura", [
    { v: r?.fFactura, fuente: "LEGACY_ROMA", confianza: "alta" },
    // ROMIA tiene fechas factura como string "dd-mm-yyyy" — futuro: parser
  ]);
  const fInscripcion = resolve("inscripcion", [
    { v: r?.fInscripcion, fuente: "LEGACY_ROMA", confianza: "alta" },
  ]);
  const fEntregaComprometida = resolve("entrega_comprometida", [
    { v: x?.fEstimadaEntrega, fuente: fuenteRomia, confianza: "alta" },
    { v: r?.fEntregaComprometida, fuente: "LEGACY_ROMA", confianza: "alta" },
  ]);

  return {
    vin,
    ventaId: x?.ventaId ?? r?.ventaId ?? null,
    marca: x?.marca ?? r?.marca ?? s?.marca ?? null,
    modelo: x?.modelo ?? r?.modelo ?? null,
    sucursalDestino: x?.sucursalDestino ?? s?.sucursalDestino ?? r?.sucursal ?? null,
    tipoSolicitud: x?.tipoSolicitud ?? s?.tipoSolicitud ?? null,
    fSolicitudVendedor,
    fRespuestaLogistica,
    fIngresoApc,
    fSolicitudBodega,
    fPlanificacion,
    fDespacho,
    fLlegadaSucursal,
    fFactura,
    fInscripcion,
    fEntregaComprometida,
    estadoArchivo: r?.estado ?? null,
    pasoActual: x?.pasoActual ?? r?.pasoActual ?? null,
    cumplimientoDespacho: x?.cumplimientoDespacho ?? s?.cumplimientoDespacho ?? null,
    enStock: stockVins.has(vin),
    enFNE: fneVins.has(vin),
    // Campos ROMIA extra (opcionales, no rompen consumidores legacy)
    bodegaOrigen: x?.bodega ?? null,
    estadoBodega: x?.estadoBodega ?? null,
    patio: x?.patio ?? null,
    puntoEntrega: x?.puntoEntrega ?? null,
    tieneSinSalida: x?.tieneSinSalida ?? false,
    fEntradaPatio: x?.fEntradaPatio ?? null,
    fSalidaPatio: x?.fSalidaPatio ?? null,
    fechaLimite: x?.fechaLimite ?? null,
    transportistaSalida: x?.transportistaSalida ?? null,
    numTraslados: x?.numTraslados ?? null,
    fuentesPorHito: fuentes,
  };
}
