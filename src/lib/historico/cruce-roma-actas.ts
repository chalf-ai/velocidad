/**
 * CRUCE HISTÓRICO ROMA × Actas (× ROMIA opcional) — función pura.
 *
 * Toma `HistoricoRoma` (consolidador ROMA por VentaID), `HistoricoActas`
 * (consolidador Actas por VIN) y, opcionalmente, un snapshot ROMIA físico
 * ya consolidado por VIN (`RomiaConsolidadoMin`), y produce una tabla
 * histórica consolidada por (VentaID, VIN) con las tres líneas operacionales
 * (comercial, documental, física), convergencia, los tres ejes (velocidad,
 * cumplimiento, calidad de cierre) y un reporte de huérfanos/conflictos.
 *
 * Diseño aprobado (sección 6 de la propuesta):
 *  - El cruce NO parsea SCHIAPP/KAR. El consumidor entrega el snapshot ROMIA
 *    ya consolidado en `RomiaConsolidadoMin` por VIN.
 *  - Multi-VentaID por VIN → una fila por VentaID, marcada `esVentaVigente`
 *    según heurística (estadoRoma != "Anulada" + fSolicitud más reciente).
 *  - `actas_sin_roma` se incluye con `ventaId=null`.
 *  - `ejeCalidadCierre="inconsistente"` SOLO ante conflictos materiales:
 *    VIN, factura, inscripción, entrega, fechas imposibles, terminal
 *    degradado. El ruido (cambios de `id` Actas) NO cuenta.
 *  - Buckets de velocidad: ≤21 rápido, 22-45 normal, 46-90 lento, >90 muy
 *    lento, sin extremos → sin_datos.
 *
 * Cero side effects. Cero dependencias de Prisma, store, React, fs ni red.
 */

import type { HistoricoRoma, EntradaHistorica } from "./consolidador.js";
import type {
  HistoricoActas,
  EntradaActas,
  CalidadCierre,
} from "./consolidador-actas.js";
import type { NivelDocumental } from "./parser-actas.js";

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot ROMIA (input opcional, contrato delgado)
// ─────────────────────────────────────────────────────────────────────────────

export interface RomiaConsolidadoMin {
  vin: string;
  bodega: string;                       // "SCHIAPP" | "KAR" | "SCHIAPP+KAR"
  fCompraMarca: Date | null;
  fIngresoBodega: Date | null;
  fSolicitudBodega: Date | null;
  fPlanificacionFisica: Date | null;
  fSalidaFisica: Date | null;
  fLlegadaPatio: Date | null;
  tieneSinSalida: boolean;
  estadoBodega: string | null;
  patio: string | null;
  puntoEntrega: string | null;
  cumplimientoDespacho: string | null;
}

export interface SnapshotRomia {
  porVin: Map<string, RomiaConsolidadoMin>;
  meta: {
    archivoSchiapp?: string;
    archivoKar?: string;
    fechaCarga: Date;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────────────────────

export interface OpcionesCruce {
  /** Default true. Si false, ROMA sin Actas no se emite. */
  permiteHuerfanosRoma?: boolean;
  /** Default true. Si false, Actas sin ROMA no se emite. */
  permiteHuerfanosActas?: boolean;
  /**
   * Tolerancia en días para considerar dos fechas "iguales" entre fuentes
   * antes de emitir conflicto. Default 0.
   */
  toleranciaFechasDias?: number;
}

export interface InputsCruce {
  historicoRoma: HistoricoRoma;
  historicoActas: HistoricoActas;
  romiaSnapshot?: SnapshotRomia;
  opts?: OpcionesCruce;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de salida
// ─────────────────────────────────────────────────────────────────────────────

export type OrigenCaso =
  | "roma_con_actas"
  | "roma_sin_actas"
  | "actas_sin_roma";

export type CuelloPrincipal =
  | "Logística"
  | "Control de Negocio"
  | "Comercial"
  | "Cliente"
  | "Mixto"
  | "Sin información suficiente";

export type BucketVelocidad = "rapido" | "normal" | "lento" | "muy_lento" | "sin_datos";
export type SegmentoMasLento = "logistica" | "control_negocio" | "espera_cliente" | "sin_datos";

export interface ScoreVelocidad {
  diasTotales: number | null;
  bucket: BucketVelocidad;
  segmentoMasLento: SegmentoMasLento;
}

export type BandaCumplimiento = "ok" | "menor" | "mayor" | "no_evaluable";

export interface ScoreCumplimiento {
  nivelDocumental: NivelDocumental;
  faltaPatenteRecibida: boolean;
  faltaAutorizacionEntrega: boolean;
  faltaSolicitudEntrega: boolean;
  banda: BandaCumplimiento;
}

export type ConflictoKind =
  | "CONFLICTO_VIN"
  | "CONFLICTO_FFACTURA"
  | "CONFLICTO_FINSCRIPCION"
  | "CONFLICTO_ENTREGA"
  | "FECHA_IMPOSIBLE_ENTREGA_ANTES_DE_SOLICITUD"
  | "FECHA_IMPOSIBLE_ENTREGA_ANTES_DE_FACTURA"
  | "FECHA_IMPOSIBLE_PATENTE_ANTES_DE_INSCRIPCION"
  | "ESTADO_TERMINAL_DEGRADADO";

export interface ConflictoCruce {
  kind: ConflictoKind;
  /** Materialidad: solo los materiales escalan a calidadCierre=inconsistente. */
  esMaterial: boolean;
  detalle: string;
  fuentePrev?: string;
  fuenteNueva?: string;
  valorPrev?: unknown;
  valorNuevo?: unknown;
}

export interface EntradaConsolidada {
  // Identidad
  ventaId: number | null;
  vin: string;

  // Identidad descriptiva
  marca: string | null;
  modelo: string | null;
  sucursal: string | null;
  gerencia: string | null;
  vendedor: string | null;
  cliente: string | null;
  valorFactura: number | null;

  // ── Línea Comercial (ROMA)
  fSolicitud: Date | null;
  fRespuestaLogistica: Date | null;
  fETASucursalPromesa: Date | null;
  fEstimadaEntrega: Date | null;
  estadoRoma: string | null;
  pasoActualRoma: string | null;

  // ── Línea Física (ROMIA — null si snapshot ausente)
  bodegaFisica: string | null;
  fIngresoBodega: Date | null;
  fSolicitudBodega: Date | null;
  fPlanificacionFisica: Date | null;
  fSalidaFisica: Date | null;
  tieneSinSalida: boolean;
  estadoBodega: string | null;
  patio: string | null;
  puntoEntrega: string | null;
  cumplimientoDespacho: string | null;

  // ── Línea Documental (Actas)
  fFactura: Date | null;
  fSolicitudInscripcion: Date | null;
  fInscripcion: Date | null;
  fPatenteAdmin: Date | null;
  fPatenteEnviada: Date | null;
  fPatenteRecibida: Date | null;
  fPatenteEntregada: Date | null;
  autorizacionEntrega: string | null;
  solEntrega: string | null;
  nivelDocumental: NivelDocumental;
  fDocListoDerivado: Date | null;
  fuenteDocListo: "patente_recibida" | "inscripcion" | "ninguna";

  // ── Convergencia
  fAutoFisicoListo: Date | null;
  fDocumentacionLista: Date | null;
  fListoParaEntrega: Date | null;
  fEntregaReal: Date | null;
  entregado: boolean;

  // ── Días derivados
  diasLogistica: number | null;
  diasControlNegocio: number | null;
  diasEsperaEntrega: number | null;
  diasTotales: number | null;

  // ── Ejes (3) y cuello
  ejeVelocidad: ScoreVelocidad;
  ejeCumplimiento: ScoreCumplimiento;
  ejeCalidadCierre?: CalidadCierre;     // undefined si no entregado
  cuelloPrincipal: CuelloPrincipal;

  // ── Multi-VentaID
  esVentaVigente: boolean;
  ventaIdsMismoVin: number[];

  // ── Auditoría
  origenCaso: OrigenCaso;
  mesesRoma: string[];
  cortesActas: string[];
  enRoma: boolean;
  enActas: boolean;
  enRomia: boolean;
  conflictos: ConflictoCruce[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Reporte
// ─────────────────────────────────────────────────────────────────────────────

export interface DistribucionCuello {
  cuello: CuelloPrincipal;
  cantidad: number;
  pct: number;
}

export interface ReporteCruce {
  totales: {
    filas: number;
    ventaIds: number;
    vinsUnicos: number;
    enActas: number;
    enRomia: number;
    entregados: number;
    huerfanosActasSinRoma: number;
    huerfanosRomaSinActas: number;
    vinsConMultiplesVentaId: number;
  };
  distribucionCuello: DistribucionCuello[];
  distribucionVelocidad: Record<BucketVelocidad, number>;
  distribucionCumplimiento: Record<BandaCumplimiento, number>;
  distribucionCalidadCierre: Record<CalidadCierre, number> & {
    no_evaluable: number;
  };
  /** Conflictos materiales agregados. */
  conflictosMateriales: {
    total: number;
    porTipo: Record<ConflictoKind, number>;
  };
}

export interface ResultadoCruce {
  filas: EntradaConsolidada[];
  byVentaId: Map<number, EntradaConsolidada>;
  byVin: Map<string, EntradaConsolidada[]>;
  reporte: ReporteCruce;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const MS_DIA = 86_400_000;

function diasEntre(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / MS_DIA);
}

function minDate(a: Date | null, b: Date | null): Date | null {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

function firstNonNullDate(...xs: Array<Date | null | undefined>): Date | null {
  for (const x of xs) if (x) return x;
  return null;
}

function fechaIgual(a: Date | null, b: Date | null, toleranciaDias = 0): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const diff = Math.abs(a.getTime() - b.getTime()) / MS_DIA;
  return diff <= toleranciaDias;
}

/**
 * Delta absoluto en días UTC entre dos fechas, ignorando hora del día.
 * Útil para comparar fechas que vienen de fuentes con distinta granularidad
 * (Actas trae timestamps con hora; ROMA típicamente midnight). Dos timestamps
 * dentro del mismo día UTC dan delta=0.
 */
function deltaDiasUTC(a: Date, b: Date): number {
  const dA = Math.floor(a.getTime() / MS_DIA);
  const dB = Math.floor(b.getTime() / MS_DIA);
  return Math.abs(dA - dB);
}

/**
 * Umbral de materialidad para CONFLICTO_FINSCRIPCION (H3 aprobada).
 *   |delta| ≤ 7 días : conflicto se reporta pero esMaterial=false
 *                       (no escala ejeCalidadCierre a "inconsistente").
 *   |delta| > 7 días : esMaterial=true.
 *
 * Justificación: 98% de los conflictos observados en el universo real están
 * dentro de 7 días — desfase normal entre "ROMA registra inicio del proceso
 * de inscripción" y "Actas registra cierre legal". Solo divergencias mayores
 * a una semana operativa indican datos sucios genuinos.
 *
 * Diagnóstico fuente: diag/diagnostico-conflicto-finscripcion.mjs.
 */
export const UMBRAL_DIAS_FINSCRIPCION_MATERIAL = 7;

function trim(s: string | null | undefined): string {
  return (s ?? "").trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Clasificación de cuelloPrincipal (replica de diag/consolidar-historico.mjs)
// ─────────────────────────────────────────────────────────────────────────────

interface CuelloInput {
  fSolicitud: Date | null;
  fLlegadaSucursalEta: Date | null;
  fSalidaFisica: Date | null;
  tieneSinSalida: boolean;
  fFactura: Date | null;
  fSolicitudInscripcion: Date | null;
  fInscripcion: Date | null;
  fPatenteRecibida: Date | null;
  autorizacionEntrega: string | null;
  solEntrega: string | null;
  entregado: boolean;
}

function clasificarCuello(d: CuelloInput): CuelloPrincipal {
  const {
    fSolicitud,
    fLlegadaSucursalEta,
    fSalidaFisica,
    tieneSinSalida,
    fFactura,
    fSolicitudInscripcion,
    fInscripcion,
    fPatenteRecibida,
    autorizacionEntrega,
    solEntrega,
    entregado,
  } = d;

  if (!fSolicitud && !fFactura) return "Sin información suficiente";

  // Caso entregado: cuello histórico — comparar duraciones de las dos líneas
  if (entregado) {
    const dl = fSolicitud && fLlegadaSucursalEta ? diasEntre(fSolicitud, fLlegadaSucursalEta) : null;
    const dc = fFactura && fPatenteRecibida ? diasEntre(fFactura, fPatenteRecibida) : null;
    if (dl != null && dc != null) {
      if (dl > dc + 7) return "Logística";
      if (dc > dl + 7) return "Control de Negocio";
      return "Mixto";
    }
    if (dl != null) return "Logística";
    if (dc != null) return "Control de Negocio";
    return "Sin información suficiente";
  }

  // Caso vivo: dónde está parado el caso ahora mismo
  if (tieneSinSalida && !fSalidaFisica) return "Logística";

  if (fFactura && !fPatenteRecibida) {
    // No importa el sub-paso de la línea documental: el cuello es Control de Negocio.
    if (!fSolicitudInscripcion) return "Control de Negocio";
    if (!fInscripcion) return "Control de Negocio";
    return "Control de Negocio";
  }

  if (fPatenteRecibida && (fSalidaFisica || fLlegadaSucursalEta)) {
    const sEntrega = trim(solEntrega);
    const aEntrega = trim(autorizacionEntrega);
    if (sEntrega === "Si" && aEntrega === "Si") return "Cliente";
    if (aEntrega !== "Si") return "Comercial";
    if (sEntrega !== "Si") return "Comercial";
    return "Cliente";
  }

  if (fSolicitud && !fSalidaFisica && !fLlegadaSucursalEta) return "Logística";

  return "Sin información suficiente";
}

// ─────────────────────────────────────────────────────────────────────────────
// Cálculo de los 3 ejes
// ─────────────────────────────────────────────────────────────────────────────

function calcularEjeVelocidad(
  diasTotales: number | null,
  diasLogistica: number | null,
  diasControlNegocio: number | null,
  diasEsperaEntrega: number | null,
): ScoreVelocidad {
  let bucket: BucketVelocidad;
  if (diasTotales == null) bucket = "sin_datos";
  else if (diasTotales <= 21) bucket = "rapido";
  else if (diasTotales <= 45) bucket = "normal";
  else if (diasTotales <= 90) bucket = "lento";
  else bucket = "muy_lento";

  const segs: Array<{ k: SegmentoMasLento; v: number }> = [];
  if (diasLogistica != null) segs.push({ k: "logistica", v: diasLogistica });
  if (diasControlNegocio != null) segs.push({ k: "control_negocio", v: diasControlNegocio });
  if (diasEsperaEntrega != null) segs.push({ k: "espera_cliente", v: diasEsperaEntrega });
  let segmentoMasLento: SegmentoMasLento = "sin_datos";
  if (segs.length > 0) {
    segs.sort((a, b) => b.v - a.v);
    segmentoMasLento = segs[0].k;
  }
  return { diasTotales, bucket, segmentoMasLento };
}

function calcularEjeCumplimiento(args: {
  nivelDocumental: NivelDocumental;
  entregado: boolean;
  fPatenteRecibida: Date | null;
  autorizacionEntrega: string | null;
  solEntrega: string | null;
}): ScoreCumplimiento {
  const faltaPat = args.fPatenteRecibida == null;
  const faltaAut = trim(args.autorizacionEntrega) !== "Si";
  const faltaSol = trim(args.solEntrega) !== "Si";

  let banda: BandaCumplimiento;
  if (!args.entregado) banda = "no_evaluable";
  else if (args.nivelDocumental === "completo") banda = "ok";
  else if (args.nivelDocumental === "parcial") banda = "menor";
  else banda = "mayor";

  return {
    nivelDocumental: args.nivelDocumental,
    faltaPatenteRecibida: faltaPat,
    faltaAutorizacionEntrega: faltaAut,
    faltaSolicitudEntrega: faltaSol,
    banda,
  };
}

function calcularEjeCalidadCierre(args: {
  entregado: boolean;
  nivelDocumental: NivelDocumental;
  fEntregaReal: Date | null;
  esHuerfano: boolean;
  conflictosMateriales: number;
}): CalidadCierre | undefined {
  if (!args.entregado) return undefined;
  // Prioridad: la corrupción de datos pesa más que la brecha documental.
  if (args.conflictosMateriales > 0) return "inconsistente";
  if (args.esHuerfano) return "huerfano";
  if (args.nivelDocumental === "completo" && args.fEntregaReal) return "correcto";
  // Entregado con documentación débil sin huérfano ni conflicto:
  // documentación incompleta es calidad cuestionable, no un huérfano.
  return "inconsistente";
}

// ─────────────────────────────────────────────────────────────────────────────
// Detección de conflictos materiales
// ─────────────────────────────────────────────────────────────────────────────

interface DetectorConflictosArgs {
  roma: EntradaHistorica | null;
  actas: EntradaActas | null;
  fSolicitud: Date | null;
  fFactura: Date | null;
  fInscripcion: Date | null;
  fPatenteRecibida: Date | null;
  fEntregaReal: Date | null;
  entregado: boolean;
  toleranciaDias: number;
}

function detectarConflictos(args: DetectorConflictosArgs): ConflictoCruce[] {
  const out: ConflictoCruce[] = [];
  const { roma, actas, toleranciaDias } = args;

  // ── Conflicto fFactura entre ROMA y Actas
  if (roma && actas) {
    const fr = roma.row.fFactura ?? null;
    const fa = actas.row.fFactura ?? null;
    if (fr && fa && !fechaIgual(fr, fa, toleranciaDias)) {
      out.push({
        kind: "CONFLICTO_FFACTURA",
        esMaterial: true,
        detalle: `fFactura difiere entre ROMA (${fr.toISOString().slice(0, 10)}) y Actas (${fa.toISOString().slice(0, 10)}).`,
        fuentePrev: "ROMA",
        fuenteNueva: "Actas",
        valorPrev: fr.toISOString().slice(0, 10),
        valorNuevo: fa.toISOString().slice(0, 10),
      });
    }
  }

  // ── Conflicto fInscripcion (regla H3: ≤7 días = advertencia, >7 días = material)
  // Comparación a granularidad de día UTC: dos timestamps del mismo día calendar
  // (ROMA midnight + Actas con hora del día) NO se reportan como conflicto.
  if (roma && actas) {
    const ir = roma.row.fInscripcion ?? null;
    const ia = actas.row.fInscripcion ?? null;
    if (ir && ia) {
      const delta = deltaDiasUTC(ir, ia);
      if (delta > 0) {
        const esMaterial = delta > UMBRAL_DIAS_FINSCRIPCION_MATERIAL;
        out.push({
          kind: "CONFLICTO_FINSCRIPCION",
          esMaterial,
          detalle: esMaterial
            ? `fInscripcion difiere entre ROMA (${ir.toISOString().slice(0, 10)}) y Actas (${ia.toISOString().slice(0, 10)}) — Δ=${delta}d, divergencia material (>7d).`
            : `fInscripcion con desfase ≤7d entre ROMA (${ir.toISOString().slice(0, 10)}) y Actas (${ia.toISOString().slice(0, 10)}) — Δ=${delta}d, advertencia de conciliación.`,
          fuentePrev: "ROMA",
          fuenteNueva: "Actas",
          valorPrev: ir.toISOString().slice(0, 10),
          valorNuevo: ia.toISOString().slice(0, 10),
        });
      }
    }
  }

  // ── Conflicto Entrega: ROMA.estado="Realizada" vs Actas.entregado=false
  if (roma && actas) {
    const estadoR = trim(roma.row.estado);
    const actasEnt = actas.row.entregado;
    if (estadoR === "Realizada" && !actasEnt) {
      out.push({
        kind: "CONFLICTO_ENTREGA",
        esMaterial: true,
        detalle: `ROMA marca estado=Realizada pero Actas no muestra entrega.`,
        fuentePrev: "ROMA",
        fuenteNueva: "Actas",
        valorPrev: "Realizada",
        valorNuevo: actasEnt,
      });
    }
  }

  // ── Fechas imposibles
  if (args.fEntregaReal && args.fSolicitud && args.fEntregaReal.getTime() < args.fSolicitud.getTime()) {
    out.push({
      kind: "FECHA_IMPOSIBLE_ENTREGA_ANTES_DE_SOLICITUD",
      esMaterial: true,
      detalle: `Entrega (${args.fEntregaReal.toISOString().slice(0, 10)}) anterior a solicitud (${args.fSolicitud.toISOString().slice(0, 10)}).`,
    });
  }
  if (args.fEntregaReal && args.fFactura && args.fEntregaReal.getTime() < args.fFactura.getTime()) {
    out.push({
      kind: "FECHA_IMPOSIBLE_ENTREGA_ANTES_DE_FACTURA",
      esMaterial: true,
      detalle: `Entrega (${args.fEntregaReal.toISOString().slice(0, 10)}) anterior a factura (${args.fFactura.toISOString().slice(0, 10)}).`,
    });
  }
  if (
    args.fPatenteRecibida &&
    args.fInscripcion &&
    args.fPatenteRecibida.getTime() < args.fInscripcion.getTime()
  ) {
    out.push({
      kind: "FECHA_IMPOSIBLE_PATENTE_ANTES_DE_INSCRIPCION",
      esMaterial: true,
      detalle: `Patente recibida (${args.fPatenteRecibida.toISOString().slice(0, 10)}) anterior a inscripción (${args.fInscripcion.toISOString().slice(0, 10)}).`,
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detección de huérfano (para alimentar eje 3)
// ─────────────────────────────────────────────────────────────────────────────

function esHuerfanoCierre(args: {
  entregado: boolean;
  fInscripcion: Date | null;
  autorizacionEntrega: string | null;
  solEntrega: string | null;
  fEntregaReal: Date | null;
}): boolean {
  if (!args.entregado) return false;
  // Tipo 2: entregado sin inscripción
  if (!args.fInscripcion) return true;
  // Tipo "entregado pero sin trazabilidad" (entregado sin fEntregaReal y sin aut/sol)
  const aut = trim(args.autorizacionEntrega);
  const sol = trim(args.solEntrega);
  if (!args.fEntregaReal && aut !== "Si" && sol !== "Si") return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Construcción de UNA entrada consolidada
// ─────────────────────────────────────────────────────────────────────────────

interface ConstruirArgs {
  roma: EntradaHistorica | null;
  actas: EntradaActas | null;
  romia: RomiaConsolidadoMin | null;
  toleranciaDias: number;
}

function construirEntrada(args: ConstruirArgs): EntradaConsolidada {
  const { roma, actas, romia, toleranciaDias } = args;

  // ── Identidad
  const vin = roma?.row.vin ?? actas?.row.vin ?? "";
  const ventaId = roma?.row.ventaId ?? null;
  const origenCaso: OrigenCaso = roma && actas
    ? "roma_con_actas"
    : roma
      ? "roma_sin_actas"
      : "actas_sin_roma";

  // Identidad descriptiva: prefer ROMA → Actas
  const marca = roma?.row.marca ?? null;
  const modelo = roma?.row.modelo ?? null;
  const sucursal = roma?.row.sucursal ?? actas?.row.sucursal ?? null;
  const gerencia = roma?.row.gerencia ?? null;
  const vendedor = actas?.row.vendedor ?? null;
  const cliente = actas?.row.cliente ?? null;
  const valorFactura = actas?.row.valorFactura ?? null;

  // ── Línea Comercial (ROMA)
  const fSolicitud = roma?.row.fSolicitud ?? null;
  const fRespuestaLogistica = roma?.row.fRespuestaLogistica ?? null;
  const fETASucursalPromesa = roma?.row.fETASucursal ?? null;
  const fEstimadaEntrega = roma?.row.fEstimadaEntrega ?? null;
  const estadoRoma = roma?.row.estado ?? null;
  const pasoActualRoma = roma?.row.pasoActual ?? null;

  // ── Línea Física (ROMIA)
  const bodegaFisica = romia?.bodega ?? null;
  const fIngresoBodega = romia?.fIngresoBodega ?? null;
  const fSolicitudBodega = romia?.fSolicitudBodega ?? null;
  const fPlanificacionFisica = romia?.fPlanificacionFisica ?? null;
  const fSalidaFisica = romia?.fSalidaFisica ?? null;
  const tieneSinSalida = romia?.tieneSinSalida ?? false;
  const estadoBodega = romia?.estadoBodega ?? null;
  const patio = romia?.patio ?? null;
  const puntoEntrega = romia?.puntoEntrega ?? null;
  const cumplimientoDespacho = romia?.cumplimientoDespacho ?? null;

  // ── Línea Documental (Actas + min con ROMA en fFactura/fInscripcion)
  const fFactura = minDate(roma?.row.fFactura ?? null, actas?.row.fFactura ?? null);
  const fSolicitudInscripcion = actas?.row.fSolicitudInscripcion ?? null;
  const fInscripcion = minDate(roma?.row.fInscripcion ?? null, actas?.row.fInscripcion ?? null);
  const fPatenteAdmin = actas?.row.fPatenteAdmin ?? null;
  const fPatenteEnviada = actas?.row.fPatenteEnviada ?? null;
  const fPatenteRecibida = actas?.row.fPatenteRecibida ?? null;
  const fPatenteEntregada = actas?.row.fPatenteEntregada ?? null;
  const autorizacionEntrega = actas?.row.autorizacionEntrega ?? null;
  const solEntrega = actas?.row.solEntrega ?? null;
  const nivelDocumental = actas?.row.nivelDocumental ?? "minimo";
  const fDocListoDerivado = actas?.row.fDocListoDerivado ?? null;
  const fuenteDocListo = actas?.row.fuenteDocListo ?? "ninguna";

  // ── Convergencia
  const fAutoFisicoListo = firstNonNullDate(fSalidaFisica, fETASucursalPromesa);
  const fDocumentacionLista = fDocListoDerivado;
  const fListoParaEntrega =
    fAutoFisicoListo && fDocumentacionLista
      ? maxDate(fAutoFisicoListo, fDocumentacionLista)
      : null;
  const fEntregaReal = actas?.row.fEntregaReal ?? null;
  const entregado = actas?.row.entregado ?? false;

  // ── Días derivados (replica regla del CSV de referencia)
  const diasLogistica = diasEntre(fSolicitud, fAutoFisicoListo);
  const diasControlNegocio = diasEntre(fFactura, fPatenteRecibida);
  const diasEsperaEntrega = diasEntre(fListoParaEntrega, fEntregaReal);
  const diasTotales = diasEntre(fSolicitud, fEntregaReal);

  // ── Cuello principal
  const cuelloPrincipal = clasificarCuello({
    fSolicitud,
    fLlegadaSucursalEta: fETASucursalPromesa,
    fSalidaFisica,
    tieneSinSalida,
    fFactura,
    fSolicitudInscripcion,
    fInscripcion,
    fPatenteRecibida,
    autorizacionEntrega,
    solEntrega,
    entregado,
  });

  // ── Conflictos materiales
  const conflictos = detectarConflictos({
    roma,
    actas,
    fSolicitud,
    fFactura,
    fInscripcion,
    fPatenteRecibida,
    fEntregaReal,
    entregado,
    toleranciaDias,
  });
  const conflictosMateriales = conflictos.filter((c) => c.esMaterial).length;

  // ── Huérfano para eje 3
  const esHuerfano = esHuerfanoCierre({
    entregado,
    fInscripcion,
    autorizacionEntrega,
    solEntrega,
    fEntregaReal,
  });

  // ── Ejes
  const ejeVelocidad = calcularEjeVelocidad(
    diasTotales,
    diasLogistica,
    diasControlNegocio,
    diasEsperaEntrega,
  );
  const ejeCumplimiento = calcularEjeCumplimiento({
    nivelDocumental,
    entregado,
    fPatenteRecibida,
    autorizacionEntrega,
    solEntrega,
  });
  const ejeCalidadCierre = calcularEjeCalidadCierre({
    entregado,
    nivelDocumental,
    fEntregaReal,
    esHuerfano,
    conflictosMateriales,
  });

  // ── Cortes / meses
  const mesesRoma = roma?.presenteEn ? [...roma.presenteEn] : [];
  const cortesActas = actas?.presenteEn ? [...actas.presenteEn] : [];

  return {
    ventaId,
    vin,
    marca,
    modelo,
    sucursal,
    gerencia,
    vendedor,
    cliente,
    valorFactura,
    fSolicitud,
    fRespuestaLogistica,
    fETASucursalPromesa,
    fEstimadaEntrega,
    estadoRoma,
    pasoActualRoma,
    bodegaFisica,
    fIngresoBodega,
    fSolicitudBodega,
    fPlanificacionFisica,
    fSalidaFisica,
    tieneSinSalida,
    estadoBodega,
    patio,
    puntoEntrega,
    cumplimientoDespacho,
    fFactura,
    fSolicitudInscripcion,
    fInscripcion,
    fPatenteAdmin,
    fPatenteEnviada,
    fPatenteRecibida,
    fPatenteEntregada,
    autorizacionEntrega,
    solEntrega,
    nivelDocumental,
    fDocListoDerivado,
    fuenteDocListo,
    fAutoFisicoListo,
    fDocumentacionLista,
    fListoParaEntrega,
    fEntregaReal,
    entregado,
    diasLogistica,
    diasControlNegocio,
    diasEsperaEntrega,
    diasTotales,
    ejeVelocidad,
    ejeCumplimiento,
    ejeCalidadCierre,
    cuelloPrincipal,
    esVentaVigente: true, // se ajusta luego cuando hay multi-VentaID
    ventaIdsMismoVin: ventaId !== null ? [ventaId] : [],
    origenCaso,
    mesesRoma,
    cortesActas,
    enRoma: roma !== null,
    enActas: actas !== null,
    enRomia: romia !== null,
    conflictos,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Marcar venta vigente entre múltiples VentaID para un mismo VIN
// ─────────────────────────────────────────────────────────────────────────────

function marcarVentaVigente(filas: EntradaConsolidada[]): void {
  // Agrupar por VIN, solo las filas con ventaId definido
  const byVin = new Map<string, EntradaConsolidada[]>();
  for (const f of filas) {
    if (f.ventaId === null) continue;
    if (!byVin.has(f.vin)) byVin.set(f.vin, []);
    byVin.get(f.vin)!.push(f);
  }
  for (const [, lista] of byVin) {
    if (lista.length <= 1) {
      lista.forEach((f) => {
        f.ventaIdsMismoVin = [f.ventaId!];
        f.esVentaVigente = true;
      });
      continue;
    }
    const ventaIds = lista.map((x) => x.ventaId!).sort((a, b) => a - b);
    // Heurística: primero filtrar las NO anuladas; entre ellas, fSolicitud más reciente
    const noAnuladas = lista.filter((f) => trim(f.estadoRoma) !== "Anulada");
    const candidatos = noAnuladas.length > 0 ? noAnuladas : lista;
    candidatos.sort((a, b) => {
      const ta = a.fSolicitud?.getTime() ?? 0;
      const tb = b.fSolicitud?.getTime() ?? 0;
      if (ta !== tb) return tb - ta; // más reciente primero
      return b.ventaId! - a.ventaId!; // desempate: VentaID más alto
    });
    const ganador = candidatos[0];
    for (const f of lista) {
      f.ventaIdsMismoVin = [...ventaIds];
      f.esVentaVigente = f === ganador;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reporte global
// ─────────────────────────────────────────────────────────────────────────────

function construirReporte(filas: EntradaConsolidada[]): ReporteCruce {
  const total = filas.length;
  let enActas = 0;
  let enRomia = 0;
  let entregados = 0;
  let huerfActasSinRoma = 0;
  let huerfRomaSinActas = 0;
  const cuelloCount = new Map<CuelloPrincipal, number>();
  const velCount: Record<BucketVelocidad, number> = {
    rapido: 0,
    normal: 0,
    lento: 0,
    muy_lento: 0,
    sin_datos: 0,
  };
  const cumpCount: Record<BandaCumplimiento, number> = {
    ok: 0,
    menor: 0,
    mayor: 0,
    no_evaluable: 0,
  };
  const cierreCount: Record<CalidadCierre | "no_evaluable", number> = {
    correcto: 0,
    huerfano: 0,
    inconsistente: 0,
    no_evaluable: 0,
  };
  const ventaIdsSet = new Set<number>();
  const vinsSet = new Set<string>();
  const vinsConMultiVid = new Set<string>();
  const vinsVidsTemp = new Map<string, Set<number>>();
  const conflictosPorTipo: Record<ConflictoKind, number> = {
    CONFLICTO_VIN: 0,
    CONFLICTO_FFACTURA: 0,
    CONFLICTO_FINSCRIPCION: 0,
    CONFLICTO_ENTREGA: 0,
    FECHA_IMPOSIBLE_ENTREGA_ANTES_DE_SOLICITUD: 0,
    FECHA_IMPOSIBLE_ENTREGA_ANTES_DE_FACTURA: 0,
    FECHA_IMPOSIBLE_PATENTE_ANTES_DE_INSCRIPCION: 0,
    ESTADO_TERMINAL_DEGRADADO: 0,
  };
  let conflictosMateriales = 0;

  for (const f of filas) {
    if (f.enActas) enActas++;
    if (f.enRomia) enRomia++;
    if (f.entregado) entregados++;
    if (f.origenCaso === "actas_sin_roma") huerfActasSinRoma++;
    if (f.origenCaso === "roma_sin_actas") huerfRomaSinActas++;
    cuelloCount.set(f.cuelloPrincipal, (cuelloCount.get(f.cuelloPrincipal) ?? 0) + 1);
    velCount[f.ejeVelocidad.bucket]++;
    cumpCount[f.ejeCumplimiento.banda]++;
    if (f.ejeCalidadCierre) cierreCount[f.ejeCalidadCierre]++;
    else cierreCount.no_evaluable++;
    if (f.ventaId !== null) ventaIdsSet.add(f.ventaId);
    vinsSet.add(f.vin);
    if (f.ventaId !== null) {
      if (!vinsVidsTemp.has(f.vin)) vinsVidsTemp.set(f.vin, new Set());
      vinsVidsTemp.get(f.vin)!.add(f.ventaId);
    }
    for (const c of f.conflictos) {
      conflictosPorTipo[c.kind]++;
      if (c.esMaterial) conflictosMateriales++;
    }
  }
  for (const [vin, ids] of vinsVidsTemp) {
    if (ids.size > 1) vinsConMultiVid.add(vin);
  }

  const distribucionCuello: DistribucionCuello[] = [...cuelloCount.entries()]
    .map(([cuello, cantidad]) => ({ cuello, cantidad, pct: +((cantidad / total) * 100).toFixed(2) }))
    .sort((a, b) => b.cantidad - a.cantidad);

  return {
    totales: {
      filas: total,
      ventaIds: ventaIdsSet.size,
      vinsUnicos: vinsSet.size,
      enActas,
      enRomia,
      entregados,
      huerfanosActasSinRoma: huerfActasSinRoma,
      huerfanosRomaSinActas: huerfRomaSinActas,
      vinsConMultiplesVentaId: vinsConMultiVid.size,
    },
    distribucionCuello,
    distribucionVelocidad: velCount,
    distribucionCumplimiento: cumpCount,
    distribucionCalidadCierre: cierreCount,
    conflictosMateriales: {
      total: conflictosMateriales,
      porTipo: conflictosPorTipo,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública: cruzarRomaActas
// ─────────────────────────────────────────────────────────────────────────────

export function cruzarRomaActas(inputs: InputsCruce): ResultadoCruce {
  const opts = inputs.opts ?? {};
  const permiteRomaSinActas = opts.permiteHuerfanosRoma !== false;
  const permiteActasSinRoma = opts.permiteHuerfanosActas !== false;
  const toleranciaDias = opts.toleranciaFechasDias ?? 0;
  const romiaPorVin = inputs.romiaSnapshot?.porVin ?? null;

  const vinsActasConsumidos = new Set<string>();
  const filas: EntradaConsolidada[] = [];

  // ── Iterar ROMA por VentaID
  for (const [, eRoma] of inputs.historicoRoma.entradas) {
    const vin = eRoma.row.vin;
    const eActas = inputs.historicoActas.entradas.get(vin) ?? null;
    const eRomia = romiaPorVin?.get(vin) ?? null;

    if (!eActas && !permiteRomaSinActas) continue;

    if (eActas) vinsActasConsumidos.add(vin);

    filas.push(construirEntrada({ roma: eRoma, actas: eActas, romia: eRomia, toleranciaDias }));
  }

  // ── Iterar Actas que no fueron consumidas → huérfanos actas_sin_roma
  if (permiteActasSinRoma) {
    for (const [vin, eActas] of inputs.historicoActas.entradas) {
      if (vinsActasConsumidos.has(vin)) continue;
      const eRomia = romiaPorVin?.get(vin) ?? null;
      filas.push(construirEntrada({ roma: null, actas: eActas, romia: eRomia, toleranciaDias }));
    }
  }

  // ── Marcar venta vigente entre múltiples VentaID
  marcarVentaVigente(filas);

  // ── Índices
  const byVentaId = new Map<number, EntradaConsolidada>();
  const byVin = new Map<string, EntradaConsolidada[]>();
  for (const f of filas) {
    if (f.ventaId !== null) byVentaId.set(f.ventaId, f);
    if (!byVin.has(f.vin)) byVin.set(f.vin, []);
    byVin.get(f.vin)!.push(f);
  }

  const reporte = construirReporte(filas);

  return { filas, byVentaId, byVin, reporte };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers exportados (para tests y validación)
// ─────────────────────────────────────────────────────────────────────────────

export const __internals = {
  clasificarCuello,
  calcularEjeVelocidad,
  calcularEjeCumplimiento,
  calcularEjeCalidadCierre,
  detectarConflictos,
  diasEntre,
};
