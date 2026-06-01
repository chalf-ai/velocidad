/**
 * Tests unitarios — Consolidador histórico Actas.
 *
 * Cobertura obligatoria:
 *  1. Histórico vacío y aplicación del primer corte
 *  2. Merge cronológico de 2 cortes: VIN nuevo, actualizado, sin cambio
 *  3. EVOLUTIVO_TRINARIO: Si > No > "" (degradación prevenida)
 *  4. EVOLUTIVO_ESTADO_TXT: "Cargado" terminal (regression detectada)
 *  5. EVOLUTIVO_FECHA: null no pisa fecha, regresión de fInscripcion
 *  6. INMUTABLE_MIN_DATE: conflicto preserva la más antigua
 *  7. Recálculo de derivados (entregado, nivelDocumental) tras fPatente
 *     recibida tardía
 *  8. valorFactura cambio >1% emite warning
 *  9. etapa retrocede → warning, conserva max
 * 10. VIN desaparecido: detección y reporte
 * 11. Idempotencia: mismo corte aplicado dos veces no duplica
 * 12. vistaActasVivo / vistaActasHistorico
 * 13. clasificarHuerfanos (4 tipos)
 * 14. calcularCumplimiento (global + sucursal + responsable)
 * 15. Round-trip serialización idempotente
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  crearHistoricoActasVacio,
  aplicarCorteActas,
  aplicarCortesActas,
  vistaActasVivo,
  vistaActasHistorico,
  vinsDesaparecidos,
  clasificarHuerfanosActas,
  calcularCumplimientoActas,
  describirHistoricoActas,
  agruparWarningsActas,
  topVinsProblematicos,
  serializarHistoricoActas,
  deserializarHistoricoActas,
} from "../consolidador-actas.js";
import type { ActasRowMerge, ResultadoIngestaActas } from "../parser-actas.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: construir filas y cortes sintéticos sin pasar por XLSX
// ─────────────────────────────────────────────────────────────────────────────

function mkVin(seed: number): string {
  const base = `TEST${String(seed).padStart(13, "A")}`;
  return base.slice(0, 17).toUpperCase().replace(/[IOQ]/g, "A");
}

interface FilaOpts {
  vin: string;
  fVenta?: Date | null;
  fFactura?: Date | null;
  fSolicitudInscripcion?: Date | null;
  fInscripcion?: Date | null;
  fPatenteAdmin?: Date | null;
  fPatenteEnviada?: Date | null;
  fPatenteRecibida?: Date | null;
  fPatenteEntregada?: Date | null;
  autorizacionEntrega?: string | null;
  solEntrega?: string | null;
  entregaAutoTxt?: string | null;
  sucursal?: string;
  vendedor?: string;
  cliente?: string;
  valorFactura?: number;
  etapa?: number | null;
  id?: number | null;
}

function mkFila(opts: FilaOpts): ActasRowMerge {
  const entregaAutoTxt = opts.entregaAutoTxt ?? null;
  const txt = (entregaAutoTxt ?? "").trim();
  const fPatEntregada = opts.fPatenteEntregada ?? null;
  const fPatRecibida = opts.fPatenteRecibida ?? null;
  const fIns = opts.fInscripcion ?? null;
  const fFac = opts.fFactura ?? null;
  const entregado = txt === "Cargado" ? true : fPatEntregada !== null;
  const fEntregaReal = entregado ? fPatEntregada : null;
  const fuenteEntrega: ActasRowMerge["fuenteEntrega"] =
    txt === "Cargado" ? "entrega_auto_txt" : fPatEntregada !== null ? "fecha_patente_entregada" : "ninguna";
  const fDoc = fPatRecibida ?? fIns;
  const fuenteDocListo: ActasRowMerge["fuenteDocListo"] = fPatRecibida
    ? "patente_recibida"
    : fIns
      ? "inscripcion"
      : "ninguna";
  const nivelDocumental: ActasRowMerge["nivelDocumental"] =
    fFac && fIns && fPatRecibida && (!entregado || fEntregaReal)
      ? "completo"
      : fFac && fIns
        ? "parcial"
        : "minimo";

  return {
    vin: opts.vin,
    id: opts.id ?? null,
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
    fPatenteRecibida: fPatRecibida,
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
    etapa: opts.etapa ?? 8,
  };
}

function mkCorte(corteId: string, fecha: Date, filas: ActasRowMerge[]): ResultadoIngestaActas {
  return {
    corte: {
      id: corteId,
      fecha,
      archivoNombre: `${corteId}.xlsx`,
      archivoSize: 0,
      fechaCarga: new Date(),
    },
    filas,
    report: {
      filasTotales: filas.length,
      filasProcesadas: filas.length,
      filasDescartadas: 0,
      descartes: [],
      metodoDeteccionCorte: "max_fecha_entrega",
      confianzaCorte: "alta",
      detalleCorte: {
        maxFechaEntregaReal: null,
        maxFechaPatenteRecibida: null,
        maxFechaFactura: null,
        corteEstimado: fecha.toISOString().slice(0, 10),
      },
      totalEntregados: filas.filter((f) => f.entregado).length,
      totalNoEntregados: filas.filter((f) => !f.entregado).length,
      totalCargadoTxt: filas.filter((f) => f.fuenteEntrega === "entrega_auto_txt").length,
      totalRedSeguridad: filas.filter((f) => f.fuenteEntrega === "fecha_patente_entregada").length,
      totalSinFechaEntregaReal: filas.filter((f) => f.entregado && !f.fEntregaReal).length,
      cobertura: { fPatenteRecibida: 0, fInscripcion: 0, fFactura: 0, fSolicitudInscripcion: 0 },
      cumplimiento: {
        entregadosSinPatenteRecibida: 0,
        entregadosSinAutorizacion: 0,
        entregadosSinSolicitudEntrega: 0,
        porNivelDocumental: { completo: 0, parcial: 0, minimo: 0 },
      },
      huerfanosCandidatos: {
        tipo1ProbableEntregaNoRegistrada: 0,
        tipo2EntregadoConCierreInconsistente: 0,
      },
      duplicadosInternosVin: [],
    },
  };
}

const VIN_A = mkVin(1);
const VIN_B = mkVin(2);
const VIN_C = mkVin(3);

// ─────────────────────────────────────────────────────────────────────────────
// 1. Histórico vacío y primer corte
// ─────────────────────────────────────────────────────────────────────────────

describe("1. Histórico vacío y primer corte", () => {
  test("crearHistoricoActasVacio retorna estructura vacía", () => {
    const h = crearHistoricoActasVacio();
    assert.equal(h.entradas.size, 0);
    assert.equal(h.cortes.length, 0);
    assert.equal(h.schemaVersion, 1);
  });

  test("aplicar primer corte agrega las filas como nuevas", () => {
    const h0 = crearHistoricoActasVacio();
    const corte = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, fFactura: new Date(2026, 2, 5), entregaAutoTxt: "Cargado", fPatenteEntregada: new Date(2026, 2, 20) }),
      mkFila({ vin: VIN_B, fFactura: new Date(2026, 2, 10) }),
    ]);
    const r = aplicarCorteActas(h0, corte);
    assert.equal(r.resumen.vinsNuevos, 2);
    assert.equal(r.resumen.vinsActualizados, 0);
    assert.equal(r.resumen.vinsDesaparecidos, 0);
    assert.equal(r.historico.entradas.size, 2);
    const eA = r.historico.entradas.get(VIN_A)!;
    assert.equal(eA.corteIdOrigen, "2026-03-31");
    assert.equal(eA.corteIdUltimoVisto, "2026-03-31");
    assert.deepEqual(eA.presenteEn, ["2026-03-31"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Merge cronológico
// ─────────────────────────────────────────────────────────────────────────────

describe("2. Merge cronológico de 2 cortes", () => {
  test("VIN nuevo en corte 2 / VIN actualizado / VIN sin cambio", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, fFactura: new Date(2026, 2, 5) }),
      mkFila({ vin: VIN_B, fFactura: new Date(2026, 2, 10) }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      mkFila({ vin: VIN_A, fFactura: new Date(2026, 2, 5), fInscripcion: new Date(2026, 3, 10) }),
      mkFila({ vin: VIN_B, fFactura: new Date(2026, 2, 10) }),
      mkFila({ vin: VIN_C, fFactura: new Date(2026, 3, 15) }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const { historicoFinal, resultados } = aplicarCortesActas(h0, [c1, c2]);

    assert.equal(historicoFinal.entradas.size, 3);
    assert.equal(historicoFinal.cortes.length, 2);

    const r2 = resultados[1];
    assert.equal(r2.resumen.vinsNuevos, 1); // VIN_C
    assert.equal(r2.resumen.vinsActualizados, 1); // VIN_A
    assert.equal(r2.resumen.vinsSinCambio, 1); // VIN_B

    const eA = historicoFinal.entradas.get(VIN_A)!;
    assert.ok(eA.row.fInscripcion instanceof Date);
    assert.equal(eA.corteIdEvolutivo, "2026-04-30");
    assert.equal(eA.corteIdOrigen, "2026-03-31");
    assert.deepEqual(eA.presenteEn, ["2026-03-31", "2026-04-30"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. EVOLUTIVO_TRINARIO
// ─────────────────────────────────────────────────────────────────────────────

describe("3. EVOLUTIVO_TRINARIO autorizacionEntrega/solEntrega", () => {
  test("Si → No → '' nunca degrada", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, autorizacionEntrega: "Si", solEntrega: "Si" }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      mkFila({ vin: VIN_A, autorizacionEntrega: "No", solEntrega: null }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const { historicoFinal, resultados } = aplicarCortesActas(h0, [c1, c2]);

    const eA = historicoFinal.entradas.get(VIN_A)!;
    assert.equal(eA.row.autorizacionEntrega, "Si", "Si no debe degradarse a No");
    assert.equal(eA.row.solEntrega, "Si", "Si no debe degradarse a null");
    const warns = resultados[1].warnings.filter((w) => w.kind === "TRINARIO_DEGRADACION_PREVENIDA");
    assert.equal(warns.length, 2);
  });

  test("'' → Si avanza normalmente", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, autorizacionEntrega: null }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      mkFila({ vin: VIN_A, autorizacionEntrega: "Si" }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const { historicoFinal } = aplicarCortesActas(h0, [c1, c2]);
    assert.equal(historicoFinal.entradas.get(VIN_A)!.row.autorizacionEntrega, "Si");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. EVOLUTIVO_ESTADO_TXT
// ─────────────────────────────────────────────────────────────────────────────

describe("4. EVOLUTIVO_ESTADO_TXT", () => {
  test("'Cargado' es terminal: no degrada a otro estado", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, entregaAutoTxt: "Cargado", fPatenteEntregada: new Date(2026, 2, 20) }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      mkFila({ vin: VIN_A, entregaAutoTxt: "Pendiente" }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const { historicoFinal, resultados } = aplicarCortesActas(h0, [c1, c2]);

    const eA = historicoFinal.entradas.get(VIN_A)!;
    assert.equal(eA.row.entregaAutoTxt, "Cargado", "Terminal se conserva");
    assert.equal(eA.row.entregado, true);
    const reg = resultados[1].warnings.filter((w) => w.kind === "ENTREGA_REGRESSION_TXT");
    assert.equal(reg.length, 1);
    assert.equal(reg[0].severidad, "crítica");
  });

  test("null no pisa texto previo", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, entregaAutoTxt: "Pendiente" }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      mkFila({ vin: VIN_A, entregaAutoTxt: null }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const { historicoFinal } = aplicarCortesActas(h0, [c1, c2]);
    assert.equal(historicoFinal.entradas.get(VIN_A)!.row.entregaAutoTxt, "Pendiente");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. EVOLUTIVO_FECHA
// ─────────────────────────────────────────────────────────────────────────────

describe("5. EVOLUTIVO_FECHA", () => {
  test("null nuevo no pisa fecha previa válida — NULL_OVERWRITE_PREVENTED", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, fInscripcion: new Date(2026, 2, 15) }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      mkFila({ vin: VIN_A, fInscripcion: null }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const { historicoFinal, resultados } = aplicarCortesActas(h0, [c1, c2]);
    const eA = historicoFinal.entradas.get(VIN_A)!;
    assert.ok(eA.row.fInscripcion instanceof Date);
    const w = resultados[1].warnings.filter((w) => w.kind === "NULL_OVERWRITE_PREVENTED");
    assert.ok(w.length >= 1);
  });

  test("Regresión de fInscripcion (fecha más temprana) → INSCRIPCION_REGRESSION", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, fInscripcion: new Date(2026, 2, 20) }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      mkFila({ vin: VIN_A, fInscripcion: new Date(2026, 2, 10) }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const { resultados } = aplicarCortesActas(h0, [c1, c2]);
    const reg = resultados[1].warnings.filter((w) => w.kind === "INSCRIPCION_REGRESSION");
    assert.equal(reg.length, 1);
    assert.equal(reg[0].severidad, "advertencia");
    assert.equal(reg[0].categoria, "documental");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. INMUTABLE_MIN_DATE
// ─────────────────────────────────────────────────────────────────────────────

describe("6. INMUTABLE_MIN_DATE (fFactura)", () => {
  test("conflicto preserva la fecha más antigua", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, fFactura: new Date(2026, 2, 15) }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      mkFila({ vin: VIN_A, fFactura: new Date(2026, 2, 10) }), // anterior
    ]);
    const h0 = crearHistoricoActasVacio();
    const { historicoFinal, resultados } = aplicarCortesActas(h0, [c1, c2]);
    const eA = historicoFinal.entradas.get(VIN_A)!;
    assert.equal(eA.row.fFactura!.getTime(), new Date(2026, 2, 10).getTime());
    const w = resultados[1].warnings.filter((w) => w.kind === "INMUTABLE_MIN_DATE_CONFLICT");
    assert.equal(w.length, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Recálculo de derivados
// ─────────────────────────────────────────────────────────────────────────────

describe("7. Recálculo de derivados tras incorporación tardía", () => {
  test("fPatenteRecibida tardía → fDocListoDerivado y nivelDocumental cambian", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(2026, 2, 10),
        entregaAutoTxt: null,
      }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      mkFila({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(2026, 2, 10),
        fPatenteRecibida: new Date(2026, 3, 20),
        entregaAutoTxt: null,
      }),
    ]);
    const h0 = crearHistoricoActasVacio();
    // Tras corte 1: parcial (factura + inscripción sin patente recibida)
    const r1 = aplicarCorteActas(h0, c1);
    assert.equal(r1.historico.entradas.get(VIN_A)!.row.nivelDocumental, "parcial");
    assert.equal(r1.historico.entradas.get(VIN_A)!.row.fuenteDocListo, "inscripcion");

    // Tras corte 2: completo
    const r2 = aplicarCorteActas(r1.historico, c2);
    const eA = r2.historico.entradas.get(VIN_A)!;
    assert.equal(eA.row.nivelDocumental, "completo");
    assert.equal(eA.row.fuenteDocListo, "patente_recibida");
    assert.equal(eA.row.fDocListoDerivado!.getTime(), new Date(2026, 3, 20).getTime());
  });

  test("entregaAutoTxt='Cargado' tardío → entregado pasa a true", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, fFactura: new Date(2026, 2, 5), entregaAutoTxt: null }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      mkFila({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        entregaAutoTxt: "Cargado",
        fPatenteEntregada: new Date(2026, 3, 15),
      }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const { historicoFinal } = aplicarCortesActas(h0, [c1, c2]);
    const eA = historicoFinal.entradas.get(VIN_A)!;
    assert.equal(eA.row.entregado, true);
    assert.equal(eA.row.fEntregaReal!.getTime(), new Date(2026, 3, 15).getTime());
    assert.equal(eA.row.fuenteEntrega, "entrega_auto_txt");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. valorFactura >1% emite warning
// ─────────────────────────────────────────────────────────────────────────────

describe("8. valorFactura cambio >1%", () => {
  test("Cambio del 5% → VALOR_FACTURA_CAMBIADO", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, valorFactura: 10_000_000 }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      mkFila({ vin: VIN_A, valorFactura: 10_500_000 }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const { resultados } = aplicarCortesActas(h0, [c1, c2]);
    const w = resultados[1].warnings.filter((w) => w.kind === "VALOR_FACTURA_CAMBIADO");
    assert.equal(w.length, 1);
  });

  test("Cambio del 0.5% → sin warning", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, valorFactura: 10_000_000 }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      mkFila({ vin: VIN_A, valorFactura: 10_050_000 }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const { resultados } = aplicarCortesActas(h0, [c1, c2]);
    const w = resultados[1].warnings.filter((w) => w.kind === "VALOR_FACTURA_CAMBIADO");
    assert.equal(w.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. etapa retrocede
// ─────────────────────────────────────────────────────────────────────────────

describe("9. etapa EVOLUTIVO_NUM_MAX", () => {
  test("etapa 10 → 5 retrocede: conserva 10, emite warning", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, etapa: 10 }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      mkFila({ vin: VIN_A, etapa: 5 }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const { historicoFinal, resultados } = aplicarCortesActas(h0, [c1, c2]);
    assert.equal(historicoFinal.entradas.get(VIN_A)!.row.etapa, 10);
    const w = resultados[1].warnings.filter((w) => w.kind === "ETAPA_RETROCEDIO");
    assert.equal(w.length, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. VIN desaparecido
// ─────────────────────────────────────────────────────────────────────────────

describe("10. VIN desaparecido (Tipo 3)", () => {
  test("VIN_B estaba en corte 1 pero no en corte 2 → desaparecido", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, fFactura: new Date(2026, 2, 5) }),
      mkFila({ vin: VIN_B, fFactura: new Date(2026, 2, 10) }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      mkFila({ vin: VIN_A, fFactura: new Date(2026, 2, 5) }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const { historicoFinal, resultados } = aplicarCortesActas(h0, [c1, c2]);

    assert.equal(resultados[1].resumen.vinsDesaparecidos, 1);
    assert.equal(resultados[1].desaparecidos[0].vin, VIN_B);
    assert.equal(resultados[1].desaparecidos[0].ultimoCorteId, "2026-03-31");

    const desap = vinsDesaparecidos(historicoFinal);
    assert.equal(desap.length, 1);
    assert.equal(desap[0].vin, VIN_B);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Idempotencia
// ─────────────────────────────────────────────────────────────────────────────

describe("11. Idempotencia del mismo corte aplicado dos veces", () => {
  test("Mismo corte aplicado dos veces no duplica ni cambia el histórico", () => {
    const corte = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, fFactura: new Date(2026, 2, 5) }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const r1 = aplicarCorteActas(h0, corte);
    const r2 = aplicarCorteActas(r1.historico, corte);
    assert.equal(r2.historico.entradas.size, 1);
    assert.equal(r2.resumen.vinsSinCambio, 1);
    assert.equal(r2.resumen.vinsActualizados, 0);
    assert.equal(r2.resumen.vinsNuevos, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Vistas vivo / histórico
// ─────────────────────────────────────────────────────────────────────────────

describe("12. vistaActasVivo / vistaActasHistorico", () => {
  test("vivo solo VINs del último corte; histórico todos", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, fFactura: new Date(2026, 2, 5) }),
      mkFila({ vin: VIN_B, fFactura: new Date(2026, 2, 10) }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      mkFila({ vin: VIN_A, fFactura: new Date(2026, 2, 5) }),
      mkFila({ vin: VIN_C, fFactura: new Date(2026, 3, 15) }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const { historicoFinal } = aplicarCortesActas(h0, [c1, c2]);

    const vivos = vistaActasVivo(historicoFinal);
    const hist = vistaActasHistorico(historicoFinal);
    assert.equal(vivos.length, 2);
    assert.equal(hist.length, 3);
    const vivosVins = new Set(vivos.map((e) => e.row.vin));
    assert.ok(vivosVins.has(VIN_A));
    assert.ok(vivosVins.has(VIN_C));
    assert.ok(!vivosVins.has(VIN_B));
  });

  test("vista vivo sobre histórico vacío retorna []", () => {
    const h = crearHistoricoActasVacio();
    assert.deepEqual(vistaActasVivo(h), []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Clasificación huérfanos
// ─────────────────────────────────────────────────────────────────────────────

describe("13. clasificarHuerfanosActas (4 tipos)", () => {
  test("Tipo 1 + Tipo 2 + Tipo 3 + Tipo 4 todos detectables", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      // VIN_A: tipo 1 (no entregado + inscripción + sin aut/sol)
      mkFila({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(2026, 2, 15),
        autorizacionEntrega: null,
        solEntrega: null,
        entregaAutoTxt: null,
      }),
      // VIN_B: tipo 2 (entregado sin inscripción)
      mkFila({
        vin: VIN_B,
        fFactura: new Date(2026, 2, 10),
        entregaAutoTxt: "Cargado",
        fPatenteEntregada: new Date(2026, 2, 25),
      }),
      // VIN_C: estará en c1 pero no en c2 → tipo 3
      mkFila({
        vin: VIN_C,
        fFactura: new Date(2026, 2, 12),
        entregaAutoTxt: null,
      }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      // VIN_A se mantiene tipo 1
      mkFila({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(2026, 2, 10), // tipo 4: fecha retrocede
        entregaAutoTxt: null,
      }),
      mkFila({
        vin: VIN_B,
        fFactura: new Date(2026, 2, 10),
        entregaAutoTxt: "Cargado",
        fPatenteEntregada: new Date(2026, 2, 25),
      }),
      // VIN_C ausente
    ]);

    const h0 = crearHistoricoActasVacio();
    const { historicoFinal } = aplicarCortesActas(h0, [c1, c2]);
    const cls = clasificarHuerfanosActas(historicoFinal);

    assert.ok(cls.tipo1ProbableEntregaNoRegistrada.length >= 1);
    assert.ok(cls.tipo1ProbableEntregaNoRegistrada.some((x) => x.vin === VIN_A));
    assert.ok(cls.tipo2EntregadoConCierreInconsistente.some((x) => x.vin === VIN_B));
    assert.ok(cls.tipo3Desaparecidos.some((x) => x.vin === VIN_C));
    assert.ok(cls.tipo4InconsistenciaTemporal.some((x) => x.vin === VIN_A && x.campo === "fInscripcion"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Cumplimiento (global + sucursal + responsable)
// ─────────────────────────────────────────────────────────────────────────────

describe("14. calcularCumplimientoActas", () => {
  test("Métricas globales + desglose por sucursal y responsable", () => {
    const corte = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(2026, 2, 10),
        fPatenteRecibida: new Date(2026, 2, 15),
        entregaAutoTxt: "Cargado",
        fPatenteEntregada: new Date(2026, 2, 20),
        sucursal: "KIA NORTE",
        vendedor: "JUAN",
        autorizacionEntrega: "Si",
        solEntrega: "Si",
      }),
      mkFila({
        vin: VIN_B,
        fFactura: new Date(2026, 2, 6),
        fInscripcion: new Date(2026, 2, 12),
        entregaAutoTxt: "Cargado",
        fPatenteEntregada: new Date(2026, 2, 22),
        sucursal: "KIA NORTE",
        vendedor: "MARTA",
      }),
      mkFila({
        vin: VIN_C,
        fFactura: new Date(2026, 2, 7),
        entregaAutoTxt: null,
        sucursal: "KIA SUR",
        vendedor: "JUAN",
      }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const r = aplicarCorteActas(h0, corte);
    const cump = calcularCumplimientoActas(r.historico, {
      porSucursal: true,
      porResponsable: true,
    });

    assert.equal(cump.universoEvaluado, 3);
    assert.equal(cump.global.entregados, 2);
    assert.equal(cump.global.noEntregados, 1);
    assert.equal(cump.global.entregadosSinPatenteRecibida, 1); // VIN_B
    assert.equal(cump.global.porNivelDocumental.completo, 1); // VIN_A
    assert.ok(cump.porSucursal && cump.porSucursal.length === 2);
    assert.ok(cump.porResponsable && cump.porResponsable.length === 2);

    const norte = cump.porSucursal!.find((s) => s.sucursal === "KIA NORTE");
    assert.ok(norte);
    assert.equal(norte.universo, 2);
    assert.equal(norte.entregados, 2);
    const juan = cump.porResponsable!.find((s) => s.responsable === "JUAN");
    assert.ok(juan);
    assert.equal(juan.universo, 2);
  });

  test("soloVivos=false evalúa el histórico completo", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, fFactura: new Date(2026, 2, 5) }),
      mkFila({ vin: VIN_B, fFactura: new Date(2026, 2, 10) }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      mkFila({ vin: VIN_A, fFactura: new Date(2026, 2, 5) }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const { historicoFinal } = aplicarCortesActas(h0, [c1, c2]);
    const vivo = calcularCumplimientoActas(historicoFinal); // default soloVivos=true
    const todo = calcularCumplimientoActas(historicoFinal, { soloVivos: false });
    assert.equal(vivo.universoEvaluado, 1);
    assert.equal(todo.universoEvaluado, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. Round-trip serialización
// ─────────────────────────────────────────────────────────────────────────────

describe("15. Round-trip serialización", () => {
  test("serializar + deserializar conserva estructura completa", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(2026, 2, 10),
        entregaAutoTxt: "Cargado",
        fPatenteEntregada: new Date(2026, 2, 20),
      }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      mkFila({
        vin: VIN_A,
        fFactura: new Date(2026, 2, 5),
        fInscripcion: new Date(2026, 3, 5),
        entregaAutoTxt: "Cargado",
        fPatenteEntregada: new Date(2026, 2, 20),
      }),
      mkFila({ vin: VIN_B, fFactura: new Date(2026, 3, 1) }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const { historicoFinal } = aplicarCortesActas(h0, [c1, c2]);

    const json = serializarHistoricoActas(historicoFinal);
    const restored = deserializarHistoricoActas(JSON.parse(JSON.stringify(json)));

    assert.equal(restored.entradas.size, historicoFinal.entradas.size);
    assert.equal(restored.cortes.length, historicoFinal.cortes.length);

    const origA = historicoFinal.entradas.get(VIN_A)!;
    const restA = restored.entradas.get(VIN_A)!;
    assert.equal(restA.row.entregado, origA.row.entregado);
    assert.equal(restA.row.fInscripcion!.getTime(), origA.row.fInscripcion!.getTime());
    assert.equal(restA.row.fPatenteEntregada!.getTime(), origA.row.fPatenteEntregada!.getTime());
    assert.equal(restA.corteIdEvolutivo, origA.corteIdEvolutivo);
    assert.equal(restA.corteIdUltimoVisto, origA.corteIdUltimoVisto);
    assert.deepEqual(restA.presenteEn, origA.presenteEn);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cobertura adicional
// ─────────────────────────────────────────────────────────────────────────────

describe("Cobertura adicional", () => {
  test("describirHistoricoActas reporta totales y cobertura", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, fFactura: new Date(2026, 2, 5) }),
      mkFila({ vin: VIN_B, fFactura: new Date(2026, 2, 10) }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      mkFila({ vin: VIN_A, fFactura: new Date(2026, 2, 5) }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const { historicoFinal } = aplicarCortesActas(h0, [c1, c2]);
    const d = describirHistoricoActas(historicoFinal);
    assert.equal(d.totalVins, 2);
    assert.equal(d.totalCortes, 2);
    assert.equal(d.vinsEnUltimoCorte, 1);
    assert.equal(d.vinsDesaparecidos, 1);
  });

  test("agruparWarningsActas + topVinsProblematicos", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, entregaAutoTxt: "Cargado", fPatenteEntregada: new Date(2026, 2, 20) }),
    ]);
    const c2 = mkCorte("2026-04-30", new Date(2026, 3, 30), [
      // forzar ENTREGA_REGRESSION_TXT
      mkFila({ vin: VIN_A, entregaAutoTxt: "Pendiente" }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const { resultados } = aplicarCortesActas(h0, [c1, c2]);
    const agr = agruparWarningsActas(resultados.flatMap((r) => r.warnings));
    assert.ok(agr.total >= 1);
    assert.ok(agr.porSeveridad["crítica"] >= 1);
    const top = topVinsProblematicos(resultados.flatMap((r) => r.warnings), 3);
    assert.ok(top[0].vin === VIN_A);
  });

  test("reserva calidadCierre queda en undefined sin ser tocada por el merge", () => {
    const c1 = mkCorte("2026-03-31", new Date(2026, 2, 31), [
      mkFila({ vin: VIN_A, fFactura: new Date(2026, 2, 5) }),
    ]);
    const h0 = crearHistoricoActasVacio();
    const r = aplicarCorteActas(h0, c1);
    assert.equal(r.historico.entradas.get(VIN_A)!.calidadCierre, undefined);
  });
});
