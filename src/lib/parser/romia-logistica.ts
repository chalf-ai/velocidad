/**
 * PARSER · archivos logísticos ROMIA (modelo nuevo).
 *
 * Reemplazo progresivo de Logistica.xlsx + Diciembre-Mayo ROMA. Coexiste con el
 * modelo viejo: este parser produce filas tipadas que `construirLogisticaPorVin`
 * priorizará sobre las filas legacy cuando existan.
 *
 * Dos archivos espejo, ambos detectables por la presencia de hojas específicas:
 *   - SCHIAPPCASSE 28 de Mayo.xlsx (marcas KIA, MG, DFSK, LANDKING, SUBARU, ...)
 *   - KAR-LOGISTICS 28 de Mayo.xlsx (marcas PEUGEOT, CITROEN, GEELY, OPEL, ...)
 *
 * Cada archivo expone hasta 7 hojas con datos por VIN. El parser extrae filas
 * de las 4 hojas relevantes (Distribución, Almacenamiento, ENTRADAS, Solicitud
 * Venta) y las consolida por VIN. NO mezcla bodegas — un VIN puede estar en
 * ambas (overlap operacional), cada bodega trae su propio contexto.
 *
 * Decisiones de diseño:
 *   1. ENTRADAS (patio) ≠ llegada a sucursal. Se guarda como `fEntradaPatio`
 *      pero NUNCA se mapea a `fLlegadaSucursal` por defecto. La "llegada a
 *      sucursal" verdadera no existe en estas bases → queda null + fuente.
 *   2. "SIN SALIDA" en `Fecha despacho a sucursal` se interpreta como bandera
 *      → `tieneSinSalida=true` y `fDespacho=null` (no inventar fecha).
 *   3. Cada hito producido lleva su fuente (ROMIA_KAR/ROMIA_SCHIAPP) y nivel
 *      de confianza (alta/media/baja). Se consume en el merge.
 *   4. Si el archivo tiene `Cumplimiento fecha limite` (KAR) o `Cumplimiento
 *      despacho` (SCHIAPP), se preservan ambos.
 */

import * as XLSX from "xlsx";
import type { RomiaRow, RomiaBodega } from "../logistica/romia-tipos";

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};
const numv = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Normaliza a Date desde Date | número (serial Excel) | "dd-mm-yyyy" | ISO.
 *  Tolerante a "0" / "0000-00-00" / "SIN SALIDA" / "En proceso" → devuelve null. */
function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    // Sentinel común en estas bases: el número 0 = sin dato (no es 1900-01-01).
    if (v === 0) return null;
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim();
  if (!s || s === "0") return null;
  // Strings sentinel del Excel
  const lower = s.toLowerCase();
  if (lower === "sin salida" || lower === "en proceso" || lower === "por confirmar") return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) {
    const [, d, mo, y] = m;
    if (d === "00" || mo === "00" || y === "0000") return null;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d));
    return isNaN(dt.getTime()) ? null : dt;
  }
  const iso = new Date(s);
  return isNaN(iso.getTime()) ? null : iso;
}

/** TRUE si el valor del Excel ES literalmente "SIN SALIDA" (bandera operacional). */
function esSinSalida(v: unknown): boolean {
  if (v == null) return false;
  return String(v).trim().toUpperCase() === "SIN SALIDA";
}

type Row = Record<string, unknown>;
const rowsOf = (ws: XLSX.WorkSheet): Row[] =>
  XLSX.utils.sheet_to_json<Row>(ws, { defval: null, raw: true });

// ─────────────────────────────────────────────────────────────────────────────
// Detección bodega
// ─────────────────────────────────────────────────────────────────────────────

/** Detecta si el libro es SCHIAPP, KAR o desconocido por sus hojas. */
function detectarBodega(wb: XLSX.WorkBook): RomiaBodega | null {
  const sheets = new Set(wb.SheetNames.map((n) => n.toUpperCase().trim()));
  // SCHIAPP tiene hojas únicas: "DIRECCIONES" y "LISTADO LAMINADO".
  if (sheets.has("DIRECCIONES") || sheets.has("LISTADO LAMINADO")) return "SCHIAPP";
  // KAR tiene "CODIGO DESPACHO" y "COMPRAS MARCA".
  if (sheets.has("CODIGO DESPACHO") || sheets.has("COMPRAS MARCA")) return "KAR";
  // Fallback heurístico por nombre de archivo se hace en parseRomiaFile.
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extracción por hoja (consolida por VIN dentro del archivo)
// ─────────────────────────────────────────────────────────────────────────────

interface VinAccumulator {
  vin: string;
  marca: string | null;
  modelo: string | null;
  version: string | null;
  color: string | null;
  cajon: string | null;
  // Compra / pre-recepción
  fCompraMarca: Date | null;
  diasPreentrega: number | null;
  // Almacenamiento
  fIngresoApc: Date | null;
  diasStock: number | null;
  estadoBodega: string | null;
  patio: string | null;
  // Solicitud (vendedor / venta)
  ventaId: number | null;
  fSolicitudVendedor: Date | null;
  fEstimadaEntrega: Date | null;
  fRespuestaLogistica: Date | null;
  fLlegadaSucursal: Date | null;
  pasoActual: string | null;
  sucursalDestino: string | null;
  gerencia: string | null;
  tipoSolicitud: string | null;
  // Distribución (bodega)
  fSolicitudBodega: Date | null;
  fPlanificacion: Date | null;
  fDespacho: Date | null;
  tieneSinSalida: boolean;
  fechaLimite: Date | null;
  cumplimientoDespacho: string | null;
  numTraslados: number | null;
  // Entradas/Salidas físicas en patio
  fEntradaPatio: Date | null;
  fSalidaPatio: Date | null;
  puntoEntrega: string | null;
  fAsignacionEntrada: Date | null;
  fLimiteEntrada: Date | null;
  transportistaSalida: string | null;
  // Solicitud Vitrina (similar a venta)
  esSolicitudVitrina: boolean;
  // Origen — qué hojas aportaron datos para auditoría
  hojasOrigen: string[];
}

function newAcc(vin: string): VinAccumulator {
  return {
    vin,
    marca: null, modelo: null, version: null, color: null, cajon: null,
    fCompraMarca: null, diasPreentrega: null,
    fIngresoApc: null, diasStock: null, estadoBodega: null, patio: null,
    ventaId: null, fSolicitudVendedor: null, fEstimadaEntrega: null,
    fRespuestaLogistica: null, fLlegadaSucursal: null,
    pasoActual: null, sucursalDestino: null, gerencia: null, tipoSolicitud: null,
    fSolicitudBodega: null, fPlanificacion: null, fDespacho: null,
    tieneSinSalida: false, fechaLimite: null, cumplimientoDespacho: null,
    numTraslados: null,
    fEntradaPatio: null, fSalidaPatio: null, puntoEntrega: null,
    fAsignacionEntrada: null, fLimiteEntrada: null, transportistaSalida: null,
    esSolicitudVitrina: false,
    hojasOrigen: [],
  };
}

/** Si la fecha actual es null pero la nueva tiene valor, sobrescribe. */
function fillIfEmpty<T>(prev: T | null, next: T | null): T | null {
  return prev !== null ? prev : next;
}

/** Procesa hojas comunes por VIN. `nombresHojas` mapea variantes SCHIAPP vs KAR. */
function procesarHojas(wb: XLSX.WorkBook): Map<string, VinAccumulator> {
  const accs = new Map<string, VinAccumulator>();
  const ensure = (vin: string): VinAccumulator => {
    const k = vin.toUpperCase().trim();
    let a = accs.get(k);
    if (!a) { a = newAcc(k); accs.set(k, a); }
    return a;
  };

  // Inventario de hojas con sus columnas relevantes (admite variantes de nombre)
  const hojaCompra = wb.SheetNames.find((n) => /^compras?\s+marca$/i.test(n.trim()));
  const hojaAlm = wb.SheetNames.find((n) => /^almacenamiento\s*$/i.test(n.trim()));
  const hojaDist = wb.SheetNames.find((n) => /^distribuci[oó]n\s*$/i.test(n.trim()));
  const hojaEntradas = wb.SheetNames.find((n) => /^entradas\s*$/i.test(n.trim()));
  const hojaSalidas = wb.SheetNames.find((n) => /^salidas\s*$/i.test(n.trim()));
  const hojaSolVenta = wb.SheetNames.find((n) => /^solicitud\s+venta\s*$/i.test(n.trim()));
  const hojaSolVitrina = wb.SheetNames.find((n) => /^solicitud\s+vitrina\s*$/i.test(n.trim()));
  // SCHIAPP trae además dos hojas de histórico completo (no vivo): "Recopilado
  // venta Roma" (~5.4k filas) y "Recopilado Vitrina Roma" (~1.3k filas). Eso
  // equivale al archivo legacy "Diciembre-Mayo ROMA.xlsx". Decisión usuario
  // 2026-06: leer Recopilado como fuente principal del histórico ROMA, dejando
  // Solicitud Venta/Vitrina como capa viva/complementaria (sobrescribe cuando
  // Recopilado no tiene el dato). KAR no las trae — sin error si faltan.
  const hojaRecopiladoVenta = wb.SheetNames.find((n) => /^recopilado\s+venta\s+roma\s*$/i.test(n.trim()));
  const hojaRecopiladoVitrina = wb.SheetNames.find((n) => /^recopilado\s+vitrina\s+roma\s*$/i.test(n.trim()));

  // 1) Compra Marca — pre-recepción
  if (hojaCompra) {
    for (const r of rowsOf(wb.Sheets[hojaCompra])) {
      const vin = str(r["VIN"]); if (!vin) continue;
      const a = ensure(vin);
      a.marca = fillIfEmpty(a.marca, str(r["Marca"]));
      a.modelo = fillIfEmpty(a.modelo, str(r["Modelo"]));
      a.version = fillIfEmpty(a.version, str(r["Version"]));
      a.color = fillIfEmpty(a.color, str(r["Color"]));
      a.cajon = fillIfEmpty(a.cajon, str(r["Cajon"]));
      a.fCompraMarca = fillIfEmpty(a.fCompraMarca, toDate(r["Compra Marca"] ?? r["Fecha Compra Marca"]));
      a.diasPreentrega = fillIfEmpty(a.diasPreentrega, numv(r["Dias preentrega"]));
      a.hojasOrigen.push(hojaCompra);
    }
  }

  // 2) Almacenamiento — vehículos en patio
  if (hojaAlm) {
    for (const r of rowsOf(wb.Sheets[hojaAlm])) {
      const vin = str(r["VIN"]); if (!vin) continue;
      const a = ensure(vin);
      a.marca = fillIfEmpty(a.marca, str(r["Marca"]));
      a.version = fillIfEmpty(a.version, str(r["Version"]));
      a.color = fillIfEmpty(a.color, str(r["Color"]));
      a.cajon = fillIfEmpty(a.cajon, str(r["Cajon"]));
      a.fCompraMarca = fillIfEmpty(a.fCompraMarca, toDate(r["Fecha compra marca"] ?? r["Fecha Compra marca"]));
      a.diasPreentrega = fillIfEmpty(a.diasPreentrega, numv(r["Dias preentrega"]));
      a.fIngresoApc = fillIfEmpty(a.fIngresoApc, toDate(r["1° dia Almacenaje en bodega"]));
      a.diasStock = fillIfEmpty(a.diasStock, numv(r["Dias de Stock"]));
      // Estado bodega — variantes: "Disponible en bodega" (SCHIAPP), "Estado Kar"/"Estado Kar " (KAR)
      a.estadoBodega = fillIfEmpty(a.estadoBodega,
        str(r["Disponible en bodega"]) ?? str(r["Estado Kar"]) ?? str(r["Estado Kar "])
      );
      a.hojasOrigen.push(hojaAlm);
    }
  }

  // 3) Distribución — planilla maestra (la más rica)
  if (hojaDist) {
    for (const r of rowsOf(wb.Sheets[hojaDist])) {
      const vin = str(r["VIN"]); if (!vin) continue;
      const a = ensure(vin);
      a.marca = fillIfEmpty(a.marca, str(r["Marca"]));
      a.version = fillIfEmpty(a.version, str(r["Version"]));
      a.color = fillIfEmpty(a.color, str(r["Color"]));
      a.cajon = fillIfEmpty(a.cajon, str(r["Cajon"]));
      a.fCompraMarca = fillIfEmpty(a.fCompraMarca, toDate(r["Fecha compra marca"] ?? r["Fecha Compra Marca"]));
      a.diasPreentrega = fillIfEmpty(a.diasPreentrega, numv(r["Dias preentrega"] ?? r["Dias prentrega"]));
      a.fIngresoApc = fillIfEmpty(a.fIngresoApc, toDate(r["1° dia Almacenaje en bodega"] ?? r["1° dia Almacenaje"]));
      a.diasStock = fillIfEmpty(a.diasStock, numv(r["Dias de Stock"]));
      a.tipoSolicitud = fillIfEmpty(a.tipoSolicitud, str(r["Tipo solicitud"]));
      // Solicitud (variantes: SCHIAPP "Fecha de solicitud", KAR "Fecha  Solicitud" con doble espacio)
      const fSol = toDate(r["Fecha de solicitud"]) ?? toDate(r["Fecha  Solicitud"]) ?? toDate(r["Fecha Solicitud"]);
      a.fSolicitudBodega = fillIfEmpty(a.fSolicitudBodega, fSol);
      a.fSolicitudVendedor = fillIfEmpty(a.fSolicitudVendedor, fSol);  // proxy: solicitud bodega ≈ origen vendedor en Distribución
      a.sucursalDestino = fillIfEmpty(a.sucursalDestino, str(r["Sucursal Destino"]));
      // Despacho (raw + sentinel "SIN SALIDA")
      const despachoRaw = r["Fecha despacho a sucursal"];
      if (esSinSalida(despachoRaw)) {
        a.tieneSinSalida = true;
        // NO seteamos fDespacho — explícitamente sin salida
      } else {
        a.fDespacho = fillIfEmpty(a.fDespacho, toDate(despachoRaw));
      }
      // Planificación: SCHIAPP "Fecha teorica STLI", KAR "Fecha limite"
      a.fPlanificacion = fillIfEmpty(a.fPlanificacion, toDate(r["Fecha teorica STLI"]));
      a.fechaLimite = fillIfEmpty(a.fechaLimite, toDate(r["Fecha limite"]));
      // Cumplimiento: SCHIAPP "Cumplimiento despacho", KAR "Cumplimiento fecha limite"
      a.cumplimientoDespacho = fillIfEmpty(a.cumplimientoDespacho,
        str(r["Cumplimiento despacho"]) ?? str(r["Cumplimiento fecha limite"])
      );
      a.numTraslados = fillIfEmpty(a.numTraslados, numv(r["N° Traslados"]));
      a.hojasOrigen.push(hojaDist);
    }
  }

  // 4) ENTRADAS — recepción al PATIO (NO a sucursal, decisión explícita)
  if (hojaEntradas) {
    for (const r of rowsOf(wb.Sheets[hojaEntradas])) {
      const vin = str(r["VIN"]); if (!vin) continue;
      const a = ensure(vin);
      a.fEntradaPatio = fillIfEmpty(a.fEntradaPatio,
        toDate(r["Fecha Ent"] ?? r["Fecha Entrada"])
      );
      a.estadoBodega = fillIfEmpty(a.estadoBodega,
        str(r["Estado"]) ?? str(r["Estado Gp Simplificado"])
      );
      a.patio = fillIfEmpty(a.patio, str(r["Patio"]) ?? str(r["Zona"]));
      a.puntoEntrega = fillIfEmpty(a.puntoEntrega,
        str(r["Punto de Entrega"]) ?? str(r["Destino"])
      );
      a.fAsignacionEntrada = fillIfEmpty(a.fAsignacionEntrada, toDate(r["Fecha Asignacion"] ?? r["Fecha Asign"]));
      a.fLimiteEntrada = fillIfEmpty(a.fLimiteEntrada, toDate(r["Fecha Limite"]));
      a.hojasOrigen.push(hojaEntradas);
    }
  }

  // 5) SALIDAS — log físico
  if (hojaSalidas) {
    for (const r of rowsOf(wb.Sheets[hojaSalidas])) {
      const vin = str(r["VIN"]); if (!vin) continue;
      const a = ensure(vin);
      const fSal = toDate(r["Fecha Sal"] ?? r["Fecha Salida"]);
      // Guardar la salida MÁS RECIENTE como referencia (puede haber duplicados)
      if (fSal && (!a.fSalidaPatio || fSal > a.fSalidaPatio)) {
        a.fSalidaPatio = fSal;
        a.transportistaSalida = str(r["Transportista Sal"] ?? r["Transportista"]);
      }
      a.hojasOrigen.push(hojaSalidas);
    }
  }

  // 6) Recopilado venta Roma — fuente HISTÓRICA principal de la agenda ROMA.
  //    Equivalente al archivo legacy "Diciembre-Mayo ROMA.xlsx". Tiene los
  //    hitos completos: FechaSolicitud, FechaFactura, FechaEnprocesoIns,
  //    FechaETASucursal, fecha_RespuestaGestionLogistica, fecha_Respuesta-
  //    InstalacionAcc, FechaEstimadaEntrega, PasoActual, Estado.
  //    Procesar ANTES de "Solicitud Venta" para que fillIfEmpty mantenga la
  //    prioridad (Recopilado se queda; Solicitud Venta llena gaps).
  if (hojaRecopiladoVenta) {
    for (const r of rowsOf(wb.Sheets[hojaRecopiladoVenta])) {
      const vin = str(r["Vin"]); if (!vin) continue;
      const a = ensure(vin);
      a.ventaId = fillIfEmpty(a.ventaId, numv(r["VentaID"]));
      a.gerencia = fillIfEmpty(a.gerencia, str(r["Gerencia"]));
      a.marca = fillIfEmpty(a.marca, str(r["Marca"]));
      a.modelo = fillIfEmpty(a.modelo, str(r["Modelo"]));
      a.color = fillIfEmpty(a.color, str(r["ColorReferencial"]));
      a.cajon = fillIfEmpty(a.cajon, str(r["Cajon"]));
      a.sucursalDestino = fillIfEmpty(a.sucursalDestino, str(r["Sucursal"]) ?? str(r["SUCURSAL DESTINO"]));
      a.fSolicitudVendedor = fillIfEmpty(a.fSolicitudVendedor, toDate(r["FechaSolicitud"]));
      a.fEstimadaEntrega = fillIfEmpty(a.fEstimadaEntrega, toDate(r["FechaEstimadaEntrega"]));
      a.fRespuestaLogistica = fillIfEmpty(a.fRespuestaLogistica, toDate(r["fecha_RespuestaGestionLogistica"]));
      a.fLlegadaSucursal = fillIfEmpty(a.fLlegadaSucursal, toDate(r["FechaETASucursal"]));
      a.pasoActual = fillIfEmpty(a.pasoActual, str(r["PasoActual"]));
      a.hojasOrigen.push(hojaRecopiladoVenta);
    }
  }

  // 7) Solicitud Venta — fuente VIVA complementaria (~275–393 filas vs ~5.4k).
  //    Solo llena gaps que Recopilado no haya cubierto (datos más frescos del
  //    día). Usa la misma columna que Recopilado, así fillIfEmpty respeta la
  //    prioridad histórica.
  if (hojaSolVenta) {
    for (const r of rowsOf(wb.Sheets[hojaSolVenta])) {
      const vin = str(r["Vin"]); if (!vin) continue;
      const a = ensure(vin);
      a.ventaId = fillIfEmpty(a.ventaId, numv(r["VentaID"]));
      a.gerencia = fillIfEmpty(a.gerencia, str(r["Gerencia"]));
      a.sucursalDestino = fillIfEmpty(a.sucursalDestino, str(r["Sucursal"]) ?? str(r["SUCURSAL DESTINO"]));
      a.fSolicitudVendedor = fillIfEmpty(a.fSolicitudVendedor, toDate(r["FechaSolicitud"]));
      a.fEstimadaEntrega = fillIfEmpty(a.fEstimadaEntrega, toDate(r["FechaEstimadaEntrega"]));
      a.fRespuestaLogistica = fillIfEmpty(a.fRespuestaLogistica, toDate(r["fecha_RespuestaGestionLogistica"]));
      a.fLlegadaSucursal = fillIfEmpty(a.fLlegadaSucursal, toDate(r["FechaETASucursal"]));
      a.pasoActual = fillIfEmpty(a.pasoActual, str(r["PasoActual"]));
      a.hojasOrigen.push(hojaSolVenta);
    }
  }

  // 8) Recopilado Vitrina Roma — histórico de traslados de vitrina (~1.3k filas).
  if (hojaRecopiladoVitrina) {
    for (const r of rowsOf(wb.Sheets[hojaRecopiladoVitrina])) {
      const vin = str(r["vin"]); if (!vin) continue;
      const a = ensure(vin);
      a.esSolicitudVitrina = true;
      a.fSolicitudVendedor = fillIfEmpty(a.fSolicitudVendedor, toDate(r["FechaCreacion"]));
      a.tipoSolicitud = fillIfEmpty(a.tipoSolicitud, "VITRINA");
      a.sucursalDestino = fillIfEmpty(a.sucursalDestino, str(r["BodegaDestino"]) ?? str(r["DESTINO"]) ?? str(r["DESTINO VITRINA"]));
      a.hojasOrigen.push(hojaRecopiladoVitrina);
    }
  }

  // 9) Solicitud Vitrina — fuente viva complementaria de vitrina (~5–18 filas).
  if (hojaSolVitrina) {
    for (const r of rowsOf(wb.Sheets[hojaSolVitrina])) {
      const vin = str(r["vin"]); if (!vin) continue;
      const a = ensure(vin);
      a.esSolicitudVitrina = true;
      a.fSolicitudVendedor = fillIfEmpty(a.fSolicitudVendedor, toDate(r["FechaCreacion"]));
      a.tipoSolicitud = fillIfEmpty(a.tipoSolicitud, "VITRINA");
      a.sucursalDestino = fillIfEmpty(a.sucursalDestino, str(r["DESTINO"]) ?? str(r["DESTINO VITRINA"]));
      a.hojasOrigen.push(hojaSolVitrina);
    }
  }

  return accs;
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedRomia {
  bodega: RomiaBodega;
  filas: RomiaRow[];
  report: {
    archivoNombre: string;
    archivoSize: number;
    fechaCarga: Date;
    hojasProcesadas: string[];
    vinsUnicos: number;
    sinSalida: number;
    conFechaDespacho: number;
  };
}

function accToRow(acc: VinAccumulator, bodega: RomiaBodega): RomiaRow {
  return {
    bodega,
    vin: acc.vin,
    marca: acc.marca,
    modelo: acc.modelo,
    version: acc.version,
    color: acc.color,
    cajon: acc.cajon,
    fCompraMarca: acc.fCompraMarca,
    diasPreentrega: acc.diasPreentrega,
    fIngresoApc: acc.fIngresoApc,
    diasStock: acc.diasStock,
    estadoBodega: acc.estadoBodega,
    patio: acc.patio,
    ventaId: acc.ventaId,
    fSolicitudVendedor: acc.fSolicitudVendedor,
    fEstimadaEntrega: acc.fEstimadaEntrega,
    fRespuestaLogistica: acc.fRespuestaLogistica,
    fLlegadaSucursal: acc.fLlegadaSucursal,
    pasoActual: acc.pasoActual,
    sucursalDestino: acc.sucursalDestino,
    gerencia: acc.gerencia,
    tipoSolicitud: acc.tipoSolicitud,
    fSolicitudBodega: acc.fSolicitudBodega,
    fPlanificacion: acc.fPlanificacion,
    fDespacho: acc.fDespacho,
    tieneSinSalida: acc.tieneSinSalida,
    fechaLimite: acc.fechaLimite,
    cumplimientoDespacho: acc.cumplimientoDespacho,
    numTraslados: acc.numTraslados,
    fEntradaPatio: acc.fEntradaPatio,
    fSalidaPatio: acc.fSalidaPatio,
    puntoEntrega: acc.puntoEntrega,
    fAsignacionEntrada: acc.fAsignacionEntrada,
    fLimiteEntrada: acc.fLimiteEntrada,
    transportistaSalida: acc.transportistaSalida,
    esSolicitudVitrina: acc.esSolicitudVitrina,
    hojasOrigen: [...new Set(acc.hojasOrigen)],
  };
}

/** Detecta el tipo de archivo ROMIA y parsea. Falla limpio si no es ROMIA. */
export async function parseRomiaFile(file: File): Promise<ParsedRomia> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true, cellStyles: false });

  let bodega = detectarBodega(wb);
  // Fallback heurístico por nombre de archivo
  if (!bodega) {
    const upper = file.name.toUpperCase();
    if (upper.includes("SCHIAPP")) bodega = "SCHIAPP";
    else if (upper.includes("KAR")) bodega = "KAR";
  }
  if (!bodega) {
    throw new Error(
      `No se reconoce el archivo como SCHIAPP ni KAR. Hojas: ${wb.SheetNames.join(", ")}`,
    );
  }

  const accs = procesarHojas(wb);
  const filas: RomiaRow[] = [];
  const hojasProcesadas = new Set<string>();
  let sinSalida = 0;
  let conFechaDespacho = 0;
  for (const acc of accs.values()) {
    const row = accToRow(acc, bodega);
    filas.push(row);
    if (row.tieneSinSalida) sinSalida++;
    if (row.fDespacho) conFechaDespacho++;
    for (const h of row.hojasOrigen) hojasProcesadas.add(h);
  }

  return {
    bodega,
    filas,
    report: {
      archivoNombre: file.name,
      archivoSize: file.size,
      fechaCarga: new Date(),
      hojasProcesadas: [...hojasProcesadas],
      vinsUnicos: filas.length,
      sinSalida,
      conFechaDespacho,
    },
  };
}
