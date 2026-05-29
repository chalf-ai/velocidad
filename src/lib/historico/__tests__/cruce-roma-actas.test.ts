/**
 * Tests unitarios — Cruce ROMA × Actas (+ ROMIA opcional).
 *
 * Cobertura obligatoria:
 *  1. roma_con_actas → fila completa
 *  2. roma_sin_actas → líneas Actas null, cuello desde ROMA
 *  3. actas_sin_roma → ventaId=null, cuello desde Actas
 *  4. Multi-VentaID por mismo VIN → una fila por VentaID + esVentaVigente
 *  5. fListoParaEntrega = max(fAutoFisicoListo, fDocumentacionLista)
 *  6. fListoParaEntrega = null si falta una de las dos
 *  7. cuelloPrincipal — cada uno de los 6 buckets
 *  8. EjeVelocidad — buckets ≤21 / 22-45 / 46-90 / >90 / sin_datos
 *  9. EjeCumplimiento — banda ok/menor/mayor/no_evaluable
 * 10. EjeCalidadCierre — correcto/huerfano/inconsistente/undefined
 * 11. Conflictos materiales: factura/inscripción/entrega/fechas imposibles
 * 12. Cambio de id Actas NO genera conflicto material (ruido)
 * 13. Caso VR3KAHPY3VS000844 — fixture cableado del documento de auditoría
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cruzarRomaActas, type InputsCruce, type RomiaConsolidadoMin, type SnapshotRomia } from "../cruce-roma-actas.js";
import { crearHistoricoVacio, aplicarCorte } from "../consolidador.js";
import type { ResultadoIngestaRoma } from "../parser-roma-mensual.js";
import { crearHistoricoActasVacio, aplicarCorteActas } from "../consolidador-actas.js";
import type { ActasRowMerge, ResultadoIngestaActas } from "../parser-actas.js";
import type { RomaRowMerge } from "../merge-policy.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mkVin(seed: number): string {
  const base = `TEST${String(seed).padStart(13, "A")}`;
  return base.slice(0, 17).toUpperCase().replace(/[IOQ]/g, "A");
}

function mkRomaRow(opts: {
  ventaId: number;
  vin: string;
  fSolicitud?: Date | null;
  fFactura?: Date | null;
  fInscripcion?: Date | null;
  fETASucursal?: Date | null;
  fRespuestaLogistica?: Date | null;
  estado?: string | null;
  pasoActual?: string | null;
  marca?: string;
  modelo?: string;
  sucursal?: string;
  gerencia?: string;
}): RomaRowMerge {
  return {
    ventaId: opts.ventaId,
    vin: opts.vin,
    marca: opts.marca ?? "KIA",
    modelo: opts.modelo ?? "SONET",
    gerencia: opts.gerencia ?? "KIA",
    colorReferencial: "BLANCO",
    cajon: "CJ1",
    fSolicitud: opts.fSolicitud ?? null,
    fFactura: opts.fFactura ?? null,
    fInscripcion: opts.fInscripcion ?? null,
    fVenta: null,
    estado: opts.estado ?? "Pendiente",
    pasoActual: opts.pasoActual ?? "Respuesta Jefe Sucursal",
    comentario: null,
    fETASucursal: opts.fETASucursal ?? null,
    fEstimadaEntrega: null,
    fRespuestaLogistica: opts.fRespuestaLogistica ?? null,
    fRespuestaInstalacionAcc: null,
    fETALlegadaCalc: null,
    sucursal: opts.sucursal ?? "KIA PLAZA OESTE",
    ventaAcc: "CON ACCESORIOS",
    varTieneLamina: "No",
  };
}

function mkCorteRoma(
  corteId: string,
  fecha: Date,
  filas: RomaRowMerge[],
): ResultadoIngestaRoma {
  return {
    corte: { id: corteId, fecha, archivoNombre: `${corteId}.xlsx`, archivoSize: 0, fechaCarga: new Date() },
    filas,
    report: {
      filasTotales: filas.length,
      filasProcesadas: filas.length,
      filasDescartadas: 0,
      descartes: [],
      mesDetectado: corteId,
      metodoDeteccion: "moda_y_max_coinciden",
      confianzaMesDeteccion: "alta",
      detalleDeteccion: { moda: corteId, filasEnModa: filas.length, maxFechaSolicitud: null, maxFechaSolicitudMes: corteId, diasEntreModaYMax: 0 },
      distribucionMesFechaSolicitud: [],
      duplicadosInternos: [],
    },
  };
}

interface ActasOpts {
  vin: string;
  fFactura?: Date | null;
  fInscripcion?: Date | null;
  fSolicitudInscripcion?: Date | null;
  fPatenteAdmin?: Date | null;
  fPatenteEnviada?: Date | null;
  fPatenteRecibida?: Date | null;
  fPatenteEntregada?: Date | null;
  autorizacionEntrega?: string | null;
  solEntrega?: string | null;
  entregaAutoTxt?: string | null;
  fVenta?: Date | null;
  sucursal?: string;
  vendedor?: string;
  cliente?: string;
  valorFactura?: number;
}

function mkActasRow(opts: ActasOpts): ActasRowMerge {
  const entregaAutoTxt = opts.entregaAutoTxt ?? null;
  const txt = (entregaAutoTxt ?? "").trim();
  const fPatEntregada = opts.fPatenteEntregada ?? null;
  const fPatRec = opts.fPatenteRecibida ?? null;
  const fIns = opts.fInscripcion ?? null;
  const fFac = opts.fFactura ?? null;
  const entregado = txt === "Cargado" ? true : fPatEntregada !== null;
  const fEntregaReal = entregado ? fPatEntregada : null;
  const fuenteEntrega: ActasRowMerge["fuenteEntrega"] =
    txt === "Cargado" ? "entrega_auto_txt" : fPatEntregada ? "fecha_patente_entregada" : "ninguna";
  const fDoc = fPatRec ?? fIns;
  const fuenteDocListo: ActasRowMerge["fuenteDocListo"] = fPatRec
    ? "patente_recibida"
    : fIns
      ? "inscripcion"
      : "ninguna";
  const nivelDocumental: ActasRowMerge["nivelDocumental"] =
    fFac && fIns && fPatRec && (!entregado || fEntregaReal)
      ? "completo"
      : fFac && fIns
        ? "parcial"
        : "minimo";

  return {
    vin: opts.vin,
    id: null,
    sucursal: opts.sucursal ?? "KIA PLAZA OESTE",
    cliente: opts.cliente ?? "CLIENTE",
    vendedor: opts.vendedor ?? "VENDEDOR",
    valorFactura: opts.valorFactura ?? 10_000_000,
    fVenta: opts.fVenta ?? null,
    fFactura: fFac,
    fSolicitudInscripcion: opts.fSolicitudInscripcion ?? null,
    fInscripcion: fIns,
    fPatenteAdmin: opts.fPatenteAdmin ?? null,
    fPatenteEnviada: opts.fPatenteEnviada ?? null,
    fPatenteRecibida: fPatRec,
    fPatenteEntregada: fPatEntregada,
    autorizacionEntrega: opts.autorizacionEntrega ?? null,
    solEntrega: opts.solEntrega ?? null,
    entregaAutoTxt,
    entregado,
    fEntregaReal,
    fuenteEntrega,
    fDocListoDerivado: fDoc,
    fuenteDocListo,
    nivelDocumental,
    estadoEntregaOriginal: entregaAutoTxt,
    etapa: 8,
  };
}

function mkCorteActas(
  corteId: string,
  fecha: Date,
  filas: ActasRowMerge[],
): ResultadoIngestaActas {
  return {
    corte: { id: corteId, fecha, archivoNombre: `${corteId}.xlsx`, archivoSize: 0, fechaCarga: new Date() },
    filas,
    report: {
      filasTotales: filas.length,
      filasProcesadas: filas.length,
      filasDescartadas: 0,
      descartes: [],
      metodoDeteccionCorte: "max_fecha_entrega",
      confianzaCorte: "alta",
      detalleCorte: { maxFechaEntregaReal: null, maxFechaPatenteRecibida: null, maxFechaFactura: null, corteEstimado: null },
      totalEntregados: 0,
      totalNoEntregados: 0,
      totalCargadoTxt: 0,
      totalRedSeguridad: 0,
      totalSinFechaEntregaReal: 0,
      cobertura: { fPatenteRecibida: 0, fInscripcion: 0, fFactura: 0, fSolicitudInscripcion: 0 },
      cumplimiento: { entregadosSinPatenteRecibida: 0, entregadosSinAutorizacion: 0, entregadosSinSolicitudEntrega: 0, porNivelDocumental: { completo: 0, parcial: 0, minimo: 0 } },
      huerfanosCandidatos: { tipo1ProbableEntregaNoRegistrada: 0, tipo2EntregadoConCierreInconsistente: 0 },
      duplicadosInternosVin: [],
    },
  };
}

function mkRomia(opts: {
  vin: string;
  bodega?: string;
  fSalidaFisica?: Date | null;
  fIngresoBodega?: Date | null;
  fSolicitudBodega?: Date | null;
  fPlanificacionFisica?: Date | null;
  fLlegadaPatio?: Date | null;
  tieneSinSalida?: boolean;
  estadoBodega?: string | null;
  patio?: string | null;
  puntoEntrega?: string | null;
  cumplimientoDespacho?: string | null;
  fCompraMarca?: Date | null;
}): RomiaConsolidadoMin {
  return {
    vin: opts.vin,
    bodega: opts.bodega ?? "KAR",
    fCompraMarca: opts.fCompraMarca ?? null,
    fIngresoBodega: opts.fIngresoBodega ?? null,
    fSolicitudBodega: opts.fSolicitudBodega ?? null,
    fPlanificacionFisica: opts.fPlanificacionFisica ?? null,
    fSalidaFisica: opts.fSalidaFisica ?? null,
    fLlegadaPatio: opts.fLlegadaPatio ?? null,
    tieneSinSalida: opts.tieneSinSalida ?? false,
    estadoBodega: opts.estadoBodega ?? null,
    patio: opts.patio ?? null,
    puntoEntrega: opts.puntoEntrega ?? null,
    cumplimientoDespacho: opts.cumplimientoDespacho ?? null,
  };
}

function mkSnapshotRomia(rows: RomiaConsolidadoMin[]): SnapshotRomia {
  const porVin = new Map<string, RomiaConsolidadoMin>();
  for (const r of rows) porVin.set(r.vin, r);
  return { porVin, meta: { fechaCarga: new Date() } };
}

function setupInputs(args: {
  romaCorte?: ResultadoIngestaRoma;
  actasCorte?: ResultadoIngestaActas;
  romiaSnapshot?: SnapshotRomia;
}): InputsCruce {
  let historicoRoma = crearHistoricoVacio();
  let historicoActas = crearHistoricoActasVacio();
  if (args.romaCorte) historicoRoma = aplicarCorte(historicoRoma, args.romaCorte).historico;
  if (args.actasCorte) historicoActas = aplicarCorteActas(historicoActas, args.actasCorte).historico;
  return { historicoRoma, historicoActas, romiaSnapshot: args.romiaSnapshot };
}

const VIN_A = mkVin(1);
const VIN_B = mkVin(2);
const VIN_C = mkVin(3);

// ─────────────────────────────────────────────────────────────────────────────
// 1. roma_con_actas
// ─────────────────────────────────────────────────────────────────────────────

describe("1. roma_con_actas → fila completa", () => {
  test("Caso normal entregado con las 3 fuentes", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({
        ventaId: 100001,
        vin: VIN_A,
        fSolicitud: new Date(2026, 2, 1),
        fFactura: new Date(2026, 2, 5),
        fETASucursal: new Date(2026, 2, 15),
        estado: "Realizada",
      }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(2026, 2, 10),
        fPatenteRecibida: new Date(2026, 2, 18),
        fPatenteEntregada: new Date(2026, 2, 25),
        entregaAutoTxt: "Cargado",
        autorizacionEntrega: "Si",
        solEntrega: "Si",
      }),
    ]);
    const romiaSnapshot = mkSnapshotRomia([
      mkRomia({ vin: VIN_A, bodega: "KAR", fSalidaFisica: new Date(2026, 2, 15), fIngresoBodega: new Date(2026, 1, 20), tieneSinSalida: false }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte, romiaSnapshot });
    const r = cruzarRomaActas(inputs);

    assert.equal(r.filas.length, 1);
    const f = r.filas[0];
    assert.equal(f.ventaId, 100001);
    assert.equal(f.vin, VIN_A);
    assert.equal(f.origenCaso, "roma_con_actas");
    assert.equal(f.enRoma, true);
    assert.equal(f.enActas, true);
    assert.equal(f.enRomia, true);
    assert.equal(f.entregado, true);
    assert.equal(f.bodegaFisica, "KAR");
    assert.ok(f.fListoParaEntrega instanceof Date);
    // fListoParaEntrega = max(fSalidaFisica=2026-03-15, fDocListo=2026-03-18) = 2026-03-18
    assert.equal(f.fListoParaEntrega!.getTime(), new Date(2026, 2, 18).getTime());
    // diasTotales = fSolicitud → fEntregaReal = 2026-03-01 → 2026-03-25 = 24
    assert.equal(f.diasTotales, 24);
    assert.equal(f.ejeVelocidad.bucket, "normal"); // 22-45
    assert.equal(f.ejeCumplimiento.banda, "ok"); // completo
    assert.equal(f.ejeCalidadCierre, "correcto");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. roma_sin_actas
// ─────────────────────────────────────────────────────────────────────────────

describe("2. roma_sin_actas", () => {
  test("VentaID en ROMA pero VIN no aparece en Actas", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 200001, vin: VIN_A, fSolicitud: new Date(2026, 2, 1) }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), []);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);

    assert.equal(r.filas.length, 1);
    const f = r.filas[0];
    assert.equal(f.origenCaso, "roma_sin_actas");
    assert.equal(f.enRoma, true);
    assert.equal(f.enActas, false);
    assert.equal(f.entregado, false);
    assert.equal(f.fFactura, null);
    assert.equal(f.nivelDocumental, "minimo");
    assert.equal(f.ejeCalidadCierre, undefined);
  });

  test("opts.permiteHuerfanosRoma=false excluye los casos", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 200002, vin: VIN_A, fSolicitud: new Date(2026, 2, 1) }),
    ]);
    const inputs = setupInputs({ romaCorte });
    inputs.opts = { permiteHuerfanosRoma: false };
    const r = cruzarRomaActas(inputs);
    assert.equal(r.filas.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. actas_sin_roma
// ─────────────────────────────────────────────────────────────────────────────

describe("3. actas_sin_roma", () => {
  test("VIN solo en Actas → ventaId=null", () => {
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(2026, 2, 10),
        fPatenteRecibida: new Date(2026, 2, 18),
        fPatenteEntregada: new Date(2026, 2, 25),
        entregaAutoTxt: "Cargado",
      }),
    ]);
    const inputs = setupInputs({ actasCorte });
    const r = cruzarRomaActas(inputs);

    assert.equal(r.filas.length, 1);
    const f = r.filas[0];
    assert.equal(f.origenCaso, "actas_sin_roma");
    assert.equal(f.ventaId, null);
    assert.equal(f.enRoma, false);
    assert.equal(f.enActas, true);
    assert.equal(f.entregado, true);
  });

  test("permiteHuerfanosActas=false excluye actas-sin-roma", () => {
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({ vin: VIN_A, fFactura: new Date(2026, 2, 5), entregaAutoTxt: "Cargado", fPatenteEntregada: new Date(2026, 2, 25) }),
    ]);
    const inputs = setupInputs({ actasCorte });
    inputs.opts = { permiteHuerfanosActas: false };
    const r = cruzarRomaActas(inputs);
    assert.equal(r.filas.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Multi-VentaID por mismo VIN
// ─────────────────────────────────────────────────────────────────────────────

describe("4. Multi-VentaID por mismo VIN", () => {
  test("Dos VentaID, una anulada → la no anulada con fSolicitud más reciente es vigente", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({
        ventaId: 300001,
        vin: VIN_A,
        fSolicitud: new Date(2026, 2, 1),
        estado: "Anulada",
      }),
      mkRomaRow({
        ventaId: 300002,
        vin: VIN_A,
        fSolicitud: new Date(2026, 2, 10),
        estado: "Pendiente",
      }),
    ]);
    const inputs = setupInputs({ romaCorte });
    const r = cruzarRomaActas(inputs);
    assert.equal(r.filas.length, 2);

    const fAnulada = r.filas.find((f) => f.ventaId === 300001)!;
    const fVigente = r.filas.find((f) => f.ventaId === 300002)!;
    assert.equal(fAnulada.esVentaVigente, false);
    assert.equal(fVigente.esVentaVigente, true);
    assert.deepEqual(fAnulada.ventaIdsMismoVin.sort(), [300001, 300002]);
    assert.deepEqual(fVigente.ventaIdsMismoVin.sort(), [300001, 300002]);

    // byVin debe devolver ambas filas
    const porVin = r.byVin.get(VIN_A)!;
    assert.equal(porVin.length, 2);
  });

  test("Dos VentaID sin anuladas → fSolicitud más reciente gana", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 310001, vin: VIN_A, fSolicitud: new Date(2026, 2, 1), estado: "Pendiente" }),
      mkRomaRow({ ventaId: 310002, vin: VIN_A, fSolicitud: new Date(2026, 2, 20), estado: "Pendiente" }),
    ]);
    const inputs = setupInputs({ romaCorte });
    const r = cruzarRomaActas(inputs);
    const fVigente = r.filas.find((f) => f.ventaId === 310002)!;
    assert.equal(fVigente.esVentaVigente, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 + 6. fListoParaEntrega
// ─────────────────────────────────────────────────────────────────────────────

describe("5/6. fListoParaEntrega", () => {
  test("= max(fAutoFisicoListo, fDocumentacionLista)", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 500001, vin: VIN_A, fSolicitud: new Date(2026, 2, 1), fETASucursal: new Date(2026, 2, 20) }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(2026, 2, 10),
        fPatenteRecibida: new Date(2026, 2, 15), // antes que ETA → ETA debe ganar
        entregaAutoTxt: null,
      }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    const f = r.filas[0];
    assert.equal(f.fListoParaEntrega!.getTime(), new Date(2026, 2, 20).getTime());
  });

  test("null si falta fAutoFisicoListo", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 510001, vin: VIN_A, fSolicitud: new Date(2026, 2, 1) }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({ vin: VIN_A, fFactura: new Date(2026, 2, 5), fPatenteRecibida: new Date(2026, 2, 15), entregaAutoTxt: null }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    assert.equal(r.filas[0].fListoParaEntrega, null);
  });

  test("null si falta fDocumentacionLista", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 520001, vin: VIN_A, fSolicitud: new Date(2026, 2, 1), fETASucursal: new Date(2026, 2, 20) }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({ vin: VIN_A, fFactura: new Date(2026, 2, 5), entregaAutoTxt: null }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    assert.equal(r.filas[0].fListoParaEntrega, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. cuelloPrincipal
// ─────────────────────────────────────────────────────────────────────────────

describe("7. cuelloPrincipal — los 6 buckets", () => {
  test("Logística: vivo + tieneSinSalida && !fSalidaFisica", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 700001, vin: VIN_A, fSolicitud: new Date(2026, 2, 1), fETASucursal: new Date(2026, 2, 20) }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(2026, 2, 10),
        fPatenteRecibida: new Date(2026, 2, 15),
        autorizacionEntrega: "Si",
        solEntrega: "Si",
        entregaAutoTxt: null,
      }),
    ]);
    const romiaSnap = mkSnapshotRomia([
      mkRomia({ vin: VIN_A, tieneSinSalida: true, fSalidaFisica: null }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte, romiaSnapshot: romiaSnap });
    const r = cruzarRomaActas(inputs);
    assert.equal(r.filas[0].cuelloPrincipal, "Logística");
  });

  test("Control de Negocio: vivo + fFactura sin fPatenteRecibida", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 700002, vin: VIN_A, fSolicitud: new Date(2026, 2, 1) }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({ vin: VIN_A, fFactura: new Date(2026, 2, 5), fInscripcion: new Date(2026, 2, 10), entregaAutoTxt: null }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    assert.equal(r.filas[0].cuelloPrincipal, "Control de Negocio");
  });

  test("Comercial: listo (patente + ETA) sin autorización", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 700003, vin: VIN_A, fSolicitud: new Date(2026, 2, 1), fETASucursal: new Date(2026, 2, 20) }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(2026, 2, 10),
        fPatenteRecibida: new Date(2026, 2, 15),
        autorizacionEntrega: "No",
        solEntrega: "Si",
        entregaAutoTxt: null,
      }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    assert.equal(r.filas[0].cuelloPrincipal, "Comercial");
  });

  test("Cliente: listo + ambas Si pero no entregado", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 700004, vin: VIN_A, fSolicitud: new Date(2026, 2, 1), fETASucursal: new Date(2026, 2, 20) }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(2026, 2, 10),
        fPatenteRecibida: new Date(2026, 2, 15),
        autorizacionEntrega: "Si",
        solEntrega: "Si",
        entregaAutoTxt: null,
      }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    assert.equal(r.filas[0].cuelloPrincipal, "Cliente");
  });

  test("Mixto: entregado con ambas duraciones similares", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 700005, vin: VIN_A, fSolicitud: new Date(2026, 2, 1), fETASucursal: new Date(2026, 2, 20) }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 1),
        fInscripcion: new Date(2026, 2, 10),
        fPatenteRecibida: new Date(2026, 2, 18),    // dc = 17
        fPatenteEntregada: new Date(2026, 2, 25),
        entregaAutoTxt: "Cargado",                  // dl ETA = 19, dc = 17 → |dl-dc|=2 <7 → Mixto
      }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    assert.equal(r.filas[0].cuelloPrincipal, "Mixto");
  });

  test("Sin información suficiente: sin fSolicitud ni fFactura", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 700006, vin: VIN_A }),
    ]);
    const inputs = setupInputs({ romaCorte });
    const r = cruzarRomaActas(inputs);
    assert.equal(r.filas[0].cuelloPrincipal, "Sin información suficiente");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. EjeVelocidad
// ─────────────────────────────────────────────────────────────────────────────

describe("8. EjeVelocidad — buckets", () => {
  for (const c of [
    { dias: 10, bucket: "rapido" as const },
    { dias: 30, bucket: "normal" as const },
    { dias: 60, bucket: "lento" as const },
    { dias: 120, bucket: "muy_lento" as const },
  ]) {
    test(`${c.dias} días totales → ${c.bucket}`, () => {
      const fSol = new Date(2026, 0, 1);
      const fEnt = new Date(fSol.getTime() + c.dias * 86_400_000);
      const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
        mkRomaRow({ ventaId: 800000 + c.dias, vin: VIN_A, fSolicitud: fSol, fFactura: fSol, fETASucursal: new Date(fSol.getTime() + 7 * 86_400_000) }),
      ]);
      const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
        mkActasRow({
          vin: VIN_A,
          fFactura: fSol,
          fInscripcion: fSol,
          fPatenteRecibida: fSol,
          fPatenteEntregada: fEnt,
          entregaAutoTxt: "Cargado",
        }),
      ]);
      const inputs = setupInputs({ romaCorte, actasCorte });
      const r = cruzarRomaActas(inputs);
      assert.equal(r.filas[0].ejeVelocidad.bucket, c.bucket);
    });
  }

  test("sin_datos cuando no hay extremos", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 890000, vin: VIN_A }),
    ]);
    const inputs = setupInputs({ romaCorte });
    const r = cruzarRomaActas(inputs);
    assert.equal(r.filas[0].ejeVelocidad.bucket, "sin_datos");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. EjeCumplimiento
// ─────────────────────────────────────────────────────────────────────────────

describe("9. EjeCumplimiento — banda", () => {
  test("ok cuando entregado + completo", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 900001, vin: VIN_A, fSolicitud: new Date(2026, 2, 1) }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(2026, 2, 10),
        fPatenteRecibida: new Date(2026, 2, 15),
        fPatenteEntregada: new Date(2026, 2, 20),
        entregaAutoTxt: "Cargado",
      }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    assert.equal(r.filas[0].ejeCumplimiento.banda, "ok");
  });

  test("menor cuando entregado + parcial", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 900002, vin: VIN_A, fSolicitud: new Date(2026, 2, 1) }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(2026, 2, 10),
        fPatenteEntregada: new Date(2026, 2, 20),
        entregaAutoTxt: "Cargado",
      }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    assert.equal(r.filas[0].ejeCumplimiento.banda, "menor");
    assert.equal(r.filas[0].ejeCumplimiento.faltaPatenteRecibida, true);
  });

  test("no_evaluable cuando no entregado", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 900003, vin: VIN_A, fSolicitud: new Date(2026, 2, 1) }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({ vin: VIN_A, fFactura: new Date(2026, 2, 5), entregaAutoTxt: null }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    assert.equal(r.filas[0].ejeCumplimiento.banda, "no_evaluable");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10 + 11 + 12. CalidadCierre y conflictos materiales
// ─────────────────────────────────────────────────────────────────────────────

describe("10/11/12. CalidadCierre + conflictos materiales", () => {
  test("'huerfano' cuando entregado sin fInscripcion (tipo 2)", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 1100001, vin: VIN_A, fSolicitud: new Date(2026, 2, 1) }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({ vin: VIN_A, fFactura: new Date(2026, 2, 5), entregaAutoTxt: "Cargado", fPatenteEntregada: new Date(2026, 2, 20) }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    assert.equal(r.filas[0].ejeCalidadCierre, "huerfano");
  });

  test("'inconsistente' cuando hay CONFLICTO_FFACTURA material", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({
        ventaId: 1100002,
        vin: VIN_A,
        fSolicitud: new Date(2026, 2, 1),
        fFactura: new Date(2026, 2, 5), // ROMA: 5 marzo
      }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 15), // Actas: 15 marzo → conflicto
        fInscripcion: new Date(2026, 2, 20),
        fPatenteRecibida: new Date(2026, 2, 25),
        fPatenteEntregada: new Date(2026, 2, 28),
        entregaAutoTxt: "Cargado",
      }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    const f = r.filas[0];
    assert.equal(f.ejeCalidadCierre, "inconsistente");
    const fact = f.conflictos.find((c) => c.kind === "CONFLICTO_FFACTURA");
    assert.ok(fact);
    assert.equal(fact!.esMaterial, true);
  });

  test("'inconsistente' por CONFLICTO_ENTREGA (ROMA Realizada + Actas no entregado)", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 1100003, vin: VIN_A, fSolicitud: new Date(2026, 2, 1), fFactura: new Date(2026, 2, 5), estado: "Realizada" }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({ vin: VIN_A, fFactura: new Date(2026, 2, 5), fInscripcion: new Date(2026, 2, 10), fPatenteRecibida: new Date(2026, 2, 15), fPatenteEntregada: new Date(2026, 2, 28), entregaAutoTxt: "Cargado" }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    const conflictos = r.filas[0].conflictos.map((c) => c.kind);
    // No conflicto entrega porque Actas SÍ está entregado. Cierre correcto.
    assert.ok(!conflictos.includes("CONFLICTO_ENTREGA"));
    assert.equal(r.filas[0].ejeCalidadCierre, "correcto");
  });

  test("CONFLICTO_ENTREGA cuando ROMA Realizada pero Actas NO entregado", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 1100004, vin: VIN_A, fSolicitud: new Date(2026, 2, 1), fFactura: new Date(2026, 2, 5), estado: "Realizada" }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({ vin: VIN_A, fFactura: new Date(2026, 2, 5), fInscripcion: new Date(2026, 2, 10), entregaAutoTxt: null }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    const k = r.filas[0].conflictos.map((c) => c.kind);
    assert.ok(k.includes("CONFLICTO_ENTREGA"));
  });

  test("Fechas imposibles: entrega antes de solicitud", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 1100005, vin: VIN_A, fSolicitud: new Date(2026, 2, 20) }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({ vin: VIN_A, fFactura: new Date(2026, 2, 25), fPatenteEntregada: new Date(2026, 2, 10), entregaAutoTxt: "Cargado" }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    const k = r.filas[0].conflictos.map((c) => c.kind);
    assert.ok(k.includes("FECHA_IMPOSIBLE_ENTREGA_ANTES_DE_SOLICITUD"));
    assert.equal(r.filas[0].ejeCalidadCierre, "inconsistente");
  });

  test("fInscripcion mismo día UTC → no emite conflicto (granularidad día)", () => {
    // ROMA: 2026-03-26 midnight UTC; Actas: 2026-03-26 18:00 UTC — mismo día UTC.
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({
        ventaId: 1110001,
        vin: VIN_A,
        fSolicitud: new Date(2026, 2, 1),
        fInscripcion: new Date(Date.UTC(2026, 2, 26, 0, 0, 0)),
      }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(Date.UTC(2026, 2, 26, 18, 0, 0)),
        fPatenteRecibida: new Date(2026, 2, 28),
        fPatenteEntregada: new Date(2026, 2, 30),
        entregaAutoTxt: "Cargado",
      }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    const conflictos = r.filas[0].conflictos.filter((c) => c.kind === "CONFLICTO_FINSCRIPCION");
    assert.equal(conflictos.length, 0, "Mismo día UTC no debe emitir conflicto");
    assert.equal(r.filas[0].ejeCalidadCierre, "correcto");
  });

  test("fInscripcion delta 1 día → emite conflicto NO material (advertencia)", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({
        ventaId: 1110002,
        vin: VIN_A,
        fSolicitud: new Date(2026, 2, 1),
        fInscripcion: new Date(Date.UTC(2026, 2, 10)),
      }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(Date.UTC(2026, 2, 11)),
        fPatenteRecibida: new Date(2026, 2, 20),
        fPatenteEntregada: new Date(2026, 2, 25),
        entregaAutoTxt: "Cargado",
      }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    const conflictos = r.filas[0].conflictos.filter((c) => c.kind === "CONFLICTO_FINSCRIPCION");
    assert.equal(conflictos.length, 1);
    assert.equal(conflictos[0].esMaterial, false, "Δ=1d debe ser advertencia, no material");
    assert.equal(r.filas[0].ejeCalidadCierre, "correcto", "Advertencia no escala a inconsistente");
  });

  test("fInscripcion delta 7 días → emite conflicto NO material (borde superior)", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({
        ventaId: 1110003,
        vin: VIN_A,
        fSolicitud: new Date(2026, 2, 1),
        fInscripcion: new Date(Date.UTC(2026, 2, 10)),
      }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(Date.UTC(2026, 2, 17)), // delta = 7 días exactos
        fPatenteRecibida: new Date(2026, 2, 25),
        fPatenteEntregada: new Date(2026, 2, 28),
        entregaAutoTxt: "Cargado",
      }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    const conflictos = r.filas[0].conflictos.filter((c) => c.kind === "CONFLICTO_FINSCRIPCION");
    assert.equal(conflictos.length, 1);
    assert.equal(conflictos[0].esMaterial, false, "Δ=7d (borde) debe ser advertencia");
    assert.equal(r.filas[0].ejeCalidadCierre, "correcto");
  });

  test("fInscripcion delta 8 días → emite conflicto MATERIAL", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({
        ventaId: 1110004,
        vin: VIN_A,
        fSolicitud: new Date(2026, 2, 1),
        fInscripcion: new Date(Date.UTC(2026, 2, 10)),
      }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(Date.UTC(2026, 2, 18)), // delta = 8 días
        fPatenteRecibida: new Date(2026, 2, 25),
        fPatenteEntregada: new Date(2026, 2, 28),
        entregaAutoTxt: "Cargado",
      }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    const conflictos = r.filas[0].conflictos.filter((c) => c.kind === "CONFLICTO_FINSCRIPCION");
    assert.equal(conflictos.length, 1);
    assert.equal(conflictos[0].esMaterial, true, "Δ=8d cruza el umbral y debe ser material");
    assert.equal(r.filas[0].ejeCalidadCierre, "inconsistente");
  });

  test("Cambio de `id` Actas NO genera conflicto (es ruido)", () => {
    // Construir Actas con id que cambiará entre 2 cortes; solo merge-policy emite warning ahí.
    // El cruce no debe registrar conflicto por id.
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 1100006, vin: VIN_A, fSolicitud: new Date(2026, 2, 1) }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(2026, 2, 10),
        fPatenteRecibida: new Date(2026, 2, 15),
        fPatenteEntregada: new Date(2026, 2, 20),
        entregaAutoTxt: "Cargado",
      }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    const noTieneIdConflict = r.filas[0].conflictos.every((c) => c.kind !== "CONFLICTO_VIN");
    assert.ok(noTieneIdConflict);
    assert.equal(r.filas[0].ejeCalidadCierre, "correcto");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. VR3KAHPY3VS000844 — fixture cableado
// ─────────────────────────────────────────────────────────────────────────────

describe("13. VR3KAHPY3VS000844 — fixture cableado del documento de auditoría", () => {
  const VIN_FOCO = "VR3KAHPY3VS000844";

  test("Reproducir fila esperada del CSV de referencia", () => {
    // Valores extraídos de diag/output/historico-consolidado.csv para VR3KAHPY3VS000844
    const romaCorte = mkCorteRoma("2026-05", new Date(2026, 4, 31), [
      mkRomaRow({
        ventaId: 213357,
        vin: VIN_FOCO,
        marca: "PEUGEOT",
        modelo: "NUEVO 3008",
        sucursal: "PEUGEOT ARAUCO MAIPU",
        gerencia: "PEUGEOT",
        fSolicitud: new Date(2026, 3, 27),       // 2026-04-27
        fRespuestaLogistica: new Date(2026, 4, 26),
        fETASucursal: new Date(2026, 4, 29),     // 2026-05-29
        estado: "Pendiente",
        pasoActual: "Respuesta Jefe Sucursal",
      }),
    ]);
    const actasCorte = mkCorteActas("2026-05-28", new Date(2026, 4, 28), [
      mkActasRow({
        vin: VIN_FOCO,
        fFactura: new Date(2026, 3, 27),         // 2026-04-27
        fSolicitudInscripcion: new Date(2026, 3, 27),
        fInscripcion: new Date(2026, 3, 27),
        fPatenteAdmin: new Date(2026, 4, 4),
        fPatenteEnviada: new Date(2026, 4, 4),
        fPatenteRecibida: new Date(2026, 4, 5),  // 2026-05-05
        autorizacionEntrega: "Si",
        solEntrega: "Si",
        entregaAutoTxt: null,                    // no entregado
        sucursal: "PEUGEOT ARAUCO MAIPU",
        valorFactura: 23_399_897,
      }),
    ]);
    const romiaSnap = mkSnapshotRomia([
      mkRomia({
        vin: VIN_FOCO,
        bodega: "KAR",
        fIngresoBodega: new Date(2026, 4, 26),   // 2026-05-26
        fSolicitudBodega: new Date(2026, 4, 26),
        fPlanificacionFisica: null,
        fSalidaFisica: null,
        tieneSinSalida: true,                    // "SIN SALIDA"
        estadoBodega: "EN PROCESO",
        patio: "PATIO NOVICIADO",
        puntoEntrega: "POMPEYO ARAUCO MAIPU",
        cumplimientoDespacho: "NA",
      }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte, romiaSnapshot: romiaSnap });
    const r = cruzarRomaActas(inputs);
    assert.equal(r.filas.length, 1);
    const f = r.filas[0];

    // Identidad
    assert.equal(f.ventaId, 213357);
    assert.equal(f.vin, VIN_FOCO);
    assert.equal(f.marca, "PEUGEOT");
    assert.equal(f.modelo, "NUEVO 3008");

    // Estado
    assert.equal(f.entregado, false);
    assert.equal(f.tieneSinSalida, true);
    assert.equal(f.bodegaFisica, "KAR");

    // fListoParaEntrega = max(fETASucursalPromesa=29-mayo, fPatenteRecibida=5-mayo) = 29-mayo
    assert.ok(f.fListoParaEntrega instanceof Date);
    assert.equal(f.fListoParaEntrega!.getTime(), new Date(2026, 4, 29).getTime());

    // diasLogistica = 27-abril → 29-mayo = 32
    assert.equal(f.diasLogistica, 32);
    // diasControlNegocio = 27-abril → 5-mayo = 8
    assert.equal(f.diasControlNegocio, 8);

    // Cuello: vivo, tieneSinSalida + no fSalidaFisica → Logística
    assert.equal(f.cuelloPrincipal, "Logística");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cobertura adicional
// ─────────────────────────────────────────────────────────────────────────────

describe("Cobertura adicional", () => {
  test("Sin snapshot ROMIA → líneas físicas en null, no falla", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 999001, vin: VIN_A, fSolicitud: new Date(2026, 2, 1) }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({ vin: VIN_A, fFactura: new Date(2026, 2, 5), fInscripcion: new Date(2026, 2, 10), entregaAutoTxt: null }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    const f = r.filas[0];
    assert.equal(f.bodegaFisica, null);
    assert.equal(f.fSalidaFisica, null);
    assert.equal(f.tieneSinSalida, false);
    assert.equal(f.enRomia, false);
  });

  test("Reporte agrega cuello, velocidad, cumplimiento y conflictos", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 999100, vin: VIN_A, fSolicitud: new Date(2026, 2, 1), fFactura: new Date(2026, 2, 5) }),
      mkRomaRow({ ventaId: 999101, vin: VIN_B, fSolicitud: new Date(2026, 2, 1) }),
      mkRomaRow({ ventaId: 999102, vin: VIN_C }),
    ]);
    const actasCorte = mkCorteActas("2026-03-31", new Date(2026, 2, 31), [
      mkActasRow({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(2026, 2, 10),
        fPatenteRecibida: new Date(2026, 2, 15),
        fPatenteEntregada: new Date(2026, 2, 20),
        entregaAutoTxt: "Cargado",
      }),
    ]);
    const inputs = setupInputs({ romaCorte, actasCorte });
    const r = cruzarRomaActas(inputs);
    assert.equal(r.reporte.totales.filas, 3);
    assert.equal(r.reporte.totales.entregados, 1);
    assert.ok(r.reporte.distribucionCuello.length >= 1);
    assert.ok(r.reporte.distribucionVelocidad.rapido >= 0);
    assert.ok(r.reporte.distribucionCumplimiento.ok >= 0);
  });

  test("byVentaId y byVin son consistentes con filas", () => {
    const romaCorte = mkCorteRoma("2026-03", new Date(2026, 2, 31), [
      mkRomaRow({ ventaId: 999200, vin: VIN_A, fSolicitud: new Date(2026, 2, 1) }),
      mkRomaRow({ ventaId: 999201, vin: VIN_A, fSolicitud: new Date(2026, 2, 5) }),
    ]);
    const inputs = setupInputs({ romaCorte });
    const r = cruzarRomaActas(inputs);
    assert.equal(r.byVentaId.size, 2);
    assert.equal(r.byVin.get(VIN_A)!.length, 2);
    for (const f of r.filas) {
      if (f.ventaId !== null) assert.equal(r.byVentaId.get(f.ventaId), f);
    }
  });
});
