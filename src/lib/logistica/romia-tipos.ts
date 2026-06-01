/**
 * Tipos del modelo ROMIA (nuevo logístico) — SCHIAPP + KAR.
 *
 * Vive aparte del modelo viejo (`modelo.ts`) para no contaminarlo durante la
 * transición. El builder (`construir.ts`) acepta opcionalmente filas ROMIA y
 * las prioriza sobre las legacy. Cuando la migración esté validada, el modelo
 * viejo puede deprecarse sin reescribir consumidores.
 */

import type { HitoLogistico } from "./modelo";

export type RomiaBodega = "SCHIAPP" | "KAR";

/**
 * Fuente de cada hito del timeline — para trazabilidad en la ficha del VIN.
 *  - ROMIA_KAR / ROMIA_SCHIAPP : nueva base, prioridad alta.
 *  - LEGACY_STLI / LEGACY_ROMA : modelo viejo, fallback temporal.
 *  - FNE                        : derivado del archivo Actas.
 *  - ninguna                    : no hay dato.
 */
export type FuenteHito =
  | "ROMIA_KAR"
  | "ROMIA_SCHIAPP"
  | "LEGACY_STLI"
  | "LEGACY_ROMA"
  | "FNE"
  | "ninguna";

/**
 * Confianza del valor del hito:
 *  - alta  : columna explícita y dedicada al hito (ej. "Fecha despacho a sucursal").
 *  - media : columna proxy razonable (ej. "Fecha de solicitud" para solicitud_bodega).
 *  - baja  : inferencia (ej. PasoActual avanzó → respuesta logística sí ocurrió).
 *  - ninguna : no hay dato.
 */
export type ConfianzaHito = "alta" | "media" | "baja" | "ninguna";

export interface HitoMeta {
  fecha: Date | null;
  fuente: FuenteHito;
  confianza: ConfianzaHito;
}

/**
 * Fila ROMIA consolidada por VIN dentro de UN archivo (SCHIAPP o KAR).
 * Cubre las 7 hojas relevantes. Si el VIN aparece en ambos archivos se generan
 * dos filas (una por bodega) — el merge final las cruza por VIN.
 */
export interface RomiaRow {
  bodega: RomiaBodega;
  vin: string;

  // Identidad
  marca: string | null;
  modelo: string | null;
  version: string | null;
  color: string | null;
  cajon: string | null;

  // Pre-recepción
  fCompraMarca: Date | null;
  diasPreentrega: number | null;

  // Almacenamiento
  fIngresoApc: Date | null;
  diasStock: number | null;
  /** "PATIO - ALMACENADO" / "PROCESADO ALMACENAJE" / "STOCK DISPONIBLE" / ... */
  estadoBodega: string | null;
  patio: string | null;

  // Solicitud (vendedor / venta)
  ventaId: number | null;
  fSolicitudVendedor: Date | null;
  fEstimadaEntrega: Date | null;
  pasoActual: string | null;
  sucursalDestino: string | null;
  gerencia: string | null;
  /** VENTA / VITRINA / TRASPASO / TEST CAR / USADOS / DONANTE / FLOTA */
  tipoSolicitud: string | null;

  // Distribución (bodega)
  fSolicitudBodega: Date | null;
  fPlanificacion: Date | null;
  fDespacho: Date | null;
  /** TRUE cuando la celda "Fecha despacho a sucursal" decía literalmente "SIN SALIDA". */
  tieneSinSalida: boolean;
  fechaLimite: Date | null;
  cumplimientoDespacho: string | null;
  numTraslados: number | null;

  // Entradas/Salidas físicas del PATIO (no de sucursal)
  fEntradaPatio: Date | null;
  fSalidaPatio: Date | null;
  /** Punto de entrega declarado en ENTRADAS — donde apunta el envío final. */
  puntoEntrega: string | null;
  fAsignacionEntrada: Date | null;
  fLimiteEntrada: Date | null;
  transportistaSalida: string | null;

  // Solicitud Vitrina
  esSolicitudVitrina: boolean;

  // Auditoría
  hojasOrigen: string[];
}

/**
 * Mapa hito → fuente/confianza para un VIN específico. Se construye en el merge
 * y queda colgado en LogisticaOperacionVIN.fuentesPorHito.
 */
export type FuentesPorHito = Partial<Record<HitoLogistico, HitoMeta>>;
