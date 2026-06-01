/**
 * Tests — adaptador-romia.ts
 *
 * Cubre:
 *  1. romiaRowToMin: mapeo campo a campo + fSalidaFisica = fSalidaPatio ?? fDespacho.
 *  2. adaptarRomia: dedup intra-bodega (primer gana).
 *  3. Fusión KAR base + SCHIAPP rellena nulls.
 *  4. tieneSinSalida es OR.
 *  5. Bodega del consolidado: "KAR", "SCHIAPP" o "KAR+SCHIAPP".
 *  6. KAR base NO se sobreescribe cuando SCHIAPP tiene valor distinto.
 *  7. Filas sin VIN se descartan.
 *  8. Input vacío.
 *  9. fechaCarga opt respetada.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { adaptarRomia, romiaRowToMin } from "../adaptador-romia.js";
import type { RomiaRow } from "../../logistica/romia-tipos.js";

function mkRow(opts: Partial<RomiaRow> & Pick<RomiaRow, "vin" | "bodega">): RomiaRow {
  // Spread de defaults primero, opts al final (provee vin/bodega y overrides).
  return {
    marca: null,
    modelo: null,
    version: null,
    color: null,
    cajon: null,
    fCompraMarca: null,
    diasPreentrega: null,
    fIngresoApc: null,
    diasStock: null,
    estadoBodega: null,
    patio: null,
    ventaId: null,
    fSolicitudVendedor: null,
    fEstimadaEntrega: null,
    pasoActual: null,
    sucursalDestino: null,
    gerencia: null,
    tipoSolicitud: null,
    fSolicitudBodega: null,
    fPlanificacion: null,
    fDespacho: null,
    tieneSinSalida: false,
    fechaLimite: null,
    cumplimientoDespacho: null,
    numTraslados: null,
    fEntradaPatio: null,
    fSalidaPatio: null,
    puntoEntrega: null,
    fAsignacionEntrada: null,
    fLimiteEntrada: null,
    transportistaSalida: null,
    esSolicitudVitrina: false,
    hojasOrigen: [],
    ...opts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. romiaRowToMin
// ─────────────────────────────────────────────────────────────────────────────

describe("1. romiaRowToMin", () => {
  test("Mapeo de campos directo y fSalidaFisica = fSalidaPatio si presente", () => {
    const row = mkRow({
      vin: "VIN1",
      bodega: "KAR",
      fCompraMarca: new Date(2026, 0, 1),
      fIngresoApc: new Date(2026, 0, 5),
      fSolicitudBodega: new Date(2026, 0, 6),
      fPlanificacion: new Date(2026, 0, 7),
      fSalidaPatio: new Date(2026, 0, 10),
      fDespacho: new Date(2026, 0, 8), // tiene también despacho, pero patio gana
      fEntradaPatio: new Date(2026, 0, 4),
      tieneSinSalida: false,
      estadoBodega: "STOCK",
      patio: "P1",
      puntoEntrega: "S1",
      cumplimientoDespacho: "OK",
    });
    const m = romiaRowToMin(row);
    assert.equal(m.bodega, "KAR");
    assert.equal(m.fIngresoBodega?.getTime(), new Date(2026, 0, 5).getTime());
    assert.equal(m.fPlanificacionFisica?.getTime(), new Date(2026, 0, 7).getTime());
    assert.equal(m.fSalidaFisica?.getTime(), new Date(2026, 0, 10).getTime(), "fSalidaPatio gana");
    assert.equal(m.fLlegadaPatio?.getTime(), new Date(2026, 0, 4).getTime());
    assert.equal(m.estadoBodega, "STOCK");
  });

  test("Si no hay fSalidaPatio, fallback a fDespacho", () => {
    const row = mkRow({ vin: "VIN1", bodega: "KAR", fSalidaPatio: null, fDespacho: new Date(2026, 0, 8) });
    const m = romiaRowToMin(row);
    assert.equal(m.fSalidaFisica?.getTime(), new Date(2026, 0, 8).getTime());
  });

  test("Sin ninguna fecha de salida → null", () => {
    const row = mkRow({ vin: "VIN1", bodega: "KAR" });
    const m = romiaRowToMin(row);
    assert.equal(m.fSalidaFisica, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Dedup intra-bodega
// ─────────────────────────────────────────────────────────────────────────────

describe("2. Dedup intra-bodega", () => {
  test("Mismo (bodega, VIN) repetido → primera fila gana", () => {
    const filas = [
      mkRow({ vin: "VIN1", bodega: "KAR", estadoBodega: "PRIMERA" }),
      mkRow({ vin: "VIN1", bodega: "KAR", estadoBodega: "SEGUNDA" }),
    ];
    const snap = adaptarRomia(filas);
    assert.equal(snap.porVin.size, 1);
    assert.equal(snap.porVin.get("VIN1")?.estadoBodega, "PRIMERA");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Fusión KAR base + SCHIAPP rellena nulls
// ─────────────────────────────────────────────────────────────────────────────

describe("3. Fusión KAR base + SCHIAPP rellena nulls", () => {
  test("KAR tiene patio null y SCHIAPP tiene patio → resultado usa el de SCHIAPP", () => {
    const filas = [
      mkRow({ vin: "VIN1", bodega: "KAR", patio: null, estadoBodega: "STOCK" }),
      mkRow({ vin: "VIN1", bodega: "SCHIAPP", patio: "P_SCH", estadoBodega: "STOCK_SCH" }),
    ];
    const snap = adaptarRomia(filas);
    const x = snap.porVin.get("VIN1")!;
    assert.equal(x.patio, "P_SCH", "Rellena null con SCHIAPP");
    assert.equal(x.estadoBodega, "STOCK", "KAR NO se sobreescribe cuando tiene valor");
  });

  test("Ambos tienen el mismo campo → KAR gana", () => {
    const filas = [
      mkRow({ vin: "VIN1", bodega: "KAR", fIngresoApc: new Date(2026, 0, 5) }),
      mkRow({ vin: "VIN1", bodega: "SCHIAPP", fIngresoApc: new Date(2026, 0, 10) }),
    ];
    const snap = adaptarRomia(filas);
    assert.equal(snap.porVin.get("VIN1")!.fIngresoBodega?.getTime(), new Date(2026, 0, 5).getTime());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. tieneSinSalida OR
// ─────────────────────────────────────────────────────────────────────────────

describe("4. tieneSinSalida combinado con OR", () => {
  test("KAR=false, SCHIAPP=true → true", () => {
    const filas = [
      mkRow({ vin: "VIN1", bodega: "KAR", tieneSinSalida: false }),
      mkRow({ vin: "VIN1", bodega: "SCHIAPP", tieneSinSalida: true }),
    ];
    const snap = adaptarRomia(filas);
    assert.equal(snap.porVin.get("VIN1")!.tieneSinSalida, true);
  });

  test("KAR=true, SCHIAPP=false → true (KAR base ya es true)", () => {
    const filas = [
      mkRow({ vin: "VIN1", bodega: "KAR", tieneSinSalida: true }),
      mkRow({ vin: "VIN1", bodega: "SCHIAPP", tieneSinSalida: false }),
    ];
    const snap = adaptarRomia(filas);
    assert.equal(snap.porVin.get("VIN1")!.tieneSinSalida, true);
  });

  test("Ambos false → false", () => {
    const filas = [
      mkRow({ vin: "VIN1", bodega: "KAR", tieneSinSalida: false }),
      mkRow({ vin: "VIN1", bodega: "SCHIAPP", tieneSinSalida: false }),
    ];
    const snap = adaptarRomia(filas);
    assert.equal(snap.porVin.get("VIN1")!.tieneSinSalida, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Bodega del consolidado
// ─────────────────────────────────────────────────────────────────────────────

describe("5. Bodega del consolidado", () => {
  test("Solo SCHIAPP → bodega='SCHIAPP'", () => {
    const snap = adaptarRomia([mkRow({ vin: "VIN1", bodega: "SCHIAPP" })]);
    assert.equal(snap.porVin.get("VIN1")!.bodega, "SCHIAPP");
  });

  test("Solo KAR → bodega='KAR'", () => {
    const snap = adaptarRomia([mkRow({ vin: "VIN1", bodega: "KAR" })]);
    assert.equal(snap.porVin.get("VIN1")!.bodega, "KAR");
  });

  test("Ambos → bodega='KAR+SCHIAPP'", () => {
    const snap = adaptarRomia([
      mkRow({ vin: "VIN1", bodega: "KAR" }),
      mkRow({ vin: "VIN1", bodega: "SCHIAPP" }),
    ]);
    assert.equal(snap.porVin.get("VIN1")!.bodega, "KAR+SCHIAPP");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6/7/8. Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("6/7/8. Edge cases", () => {
  test("Filas sin VIN se descartan", () => {
    const filas = [
      mkRow({ vin: "", bodega: "KAR" }),
      mkRow({ vin: "VIN1", bodega: "KAR" }),
    ];
    const snap = adaptarRomia(filas);
    assert.equal(snap.porVin.size, 1);
    assert.ok(snap.porVin.has("VIN1"));
  });

  test("Input vacío → snapshot vacío", () => {
    const snap = adaptarRomia([]);
    assert.equal(snap.porVin.size, 0);
    assert.ok(snap.meta.fechaCarga instanceof Date);
  });

  test("fechaCarga opt respetada", () => {
    const fecha = new Date(2026, 4, 15);
    const snap = adaptarRomia([], { fechaCarga: fecha });
    assert.equal(snap.meta.fechaCarga.getTime(), fecha.getTime());
  });

  test("Universo realista: 2 VINs solo KAR, 1 VIN solo SCHIAPP, 1 VIN ambos", () => {
    const filas = [
      mkRow({ vin: "VIN_K1", bodega: "KAR", patio: "K1" }),
      mkRow({ vin: "VIN_K2", bodega: "KAR", patio: "K2" }),
      mkRow({ vin: "VIN_S1", bodega: "SCHIAPP", patio: "S1" }),
      mkRow({ vin: "VIN_BOTH", bodega: "KAR", patio: null, estadoBodega: "BK" }),
      mkRow({ vin: "VIN_BOTH", bodega: "SCHIAPP", patio: "S_BOTH", estadoBodega: "BS" }),
    ];
    const snap = adaptarRomia(filas);
    assert.equal(snap.porVin.size, 4);
    assert.equal(snap.porVin.get("VIN_K1")!.bodega, "KAR");
    assert.equal(snap.porVin.get("VIN_S1")!.bodega, "SCHIAPP");
    const both = snap.porVin.get("VIN_BOTH")!;
    assert.equal(both.bodega, "KAR+SCHIAPP");
    assert.equal(both.patio, "S_BOTH"); // KAR era null
    assert.equal(both.estadoBodega, "BK"); // KAR base gana
  });
});
