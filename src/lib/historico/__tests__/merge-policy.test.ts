/**
 * Tests unitarios — MergePolicy ROMA.
 *
 * Usa `node:test` (runner nativo de Node 20+). Cero dependencias externas.
 * Para correr: compilar con tsc a /tmp y ejecutar `node --test`.
 * Ver: diag/run-merge-tests.mjs
 *
 * Cobertura obligatoria (de la spec del usuario):
 *  1. Mismo VentaID+VIN en dos meses
 *  2. Estado cambia de Pendiente a Realizada
 *  3. Estado cambia de Realizada a Anulada (regresión observada)
 *  4. ETA cambia
 *  5. Fecha válida no se pisa con null
 *  6. FechaSolicitud no cambia
 *  7. Conflicto de VIN o FechaSolicitud genera warning
 *
 * Plus: casos borde validados durante la auditoría.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  mergeRomaRows,
  consolidarRomaSerie,
  ROMA_FIELD_POLICY,
  type RomaRowMerge,
  type MergeContext,
} from "../merge-policy.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de test
// ─────────────────────────────────────────────────────────────────────────────

const d = (iso: string) => new Date(iso);
const ctx = (corteId: string, corteFecha: string, prev?: { id: string; fecha: string }): MergeContext => ({
  corteId,
  corteFecha: d(corteFecha),
  cortePrevioId: prev?.id,
  cortePrevioFecha: prev ? d(prev.fecha) : undefined,
});

// Casos base reutilizables
const baseEnero: RomaRowMerge = {
  ventaId: 207175,
  vin: "VR3KAHPY3VS000844",
  marca: "PEUGEOT",
  modelo: "3008",
  gerencia: "PEUGEOT",
  cajon: "VS000844",
  estado: "Anulada",
  pasoActual: "Respuesta Jefe Sucursal",
  comentario: "TRASLADAR A IRARRAZAVAL",
  fSolicitud: d("2026-01-27"),
  fFactura: d("2026-01-27"),
  fInscripcion: d("2026-01-28"),
  fETASucursal: d("2026-01-27"),
  fRespuestaLogistica: d("2026-01-28"),
  sucursal: "PEUGEOT IRARRAZAVAL",
};

const baseFebrero: RomaRowMerge = {
  ventaId: 207175,
  vin: "VR3KAHPY3VS000844",
  marca: "PEUGEOT",
  modelo: "3008",
  gerencia: "PEUGEOT",
  cajon: "VS000844",
  estado: "Pendiente", // cambió
  pasoActual: "Respuesta Jefe Sucursal",
  comentario: "TRASLADAR A IRARRAZAVAL ETA: 02-02",
  fSolicitud: d("2026-01-27"),
  fFactura: d("2026-01-27"),
  fInscripcion: d("2026-01-28"),
  fETASucursal: d("2026-02-02"), // cambió
  fRespuestaLogistica: d("2026-01-28"),
  sucursal: "PEUGEOT IRARRAZAVAL",
};

// ─────────────────────────────────────────────────────────────────────────────
// Test suites
// ─────────────────────────────────────────────────────────────────────────────

describe("merge-policy · cobertura del mapa de campos", () => {
  test("cada campo tiene política asignada", () => {
    const policies = Object.values(ROMA_FIELD_POLICY);
    assert.ok(policies.length > 0);
    for (const p of policies) {
      assert.ok(
        ["INMUTABLE_FIRST", "INMUTABLE_MIN_DATE", "EVOLUTIVO", "EVOLUTIVO_FECHA", "ESTABLE", "DERIVADO"].includes(p),
        `Política desconocida: ${p}`,
      );
    }
  });
});

describe("1. Mismo VentaID+VIN en dos meses consecutivos", () => {
  test("merge produce un solo registro consolidado", () => {
    const { merged, warnings } = mergeRomaRows(
      baseEnero,
      baseFebrero,
      ctx("2026-02", "2026-02-28", { id: "2026-01", fecha: "2026-01-31" }),
    );
    assert.equal(merged.ventaId, 207175);
    assert.equal(merged.vin, "VR3KAHPY3VS000844");
    // INMUTABLE: marca conservada
    assert.equal(merged.marca, "PEUGEOT");
    // EVOLUTIVO: estado del corte más reciente gana
    assert.equal(merged.estado, "Pendiente");
    // EVOLUTIVO_FECHA: ETA del más reciente gana
    assert.deepEqual(merged.fETASucursal, d("2026-02-02"));
    // No debería haber warnings espurios para este caso normal
    const inmutableConflicts = warnings.filter((w) => w.kind === "INMUTABLE_CHANGED" || w.kind === "INMUTABLE_MIN_DATE_CONFLICT");
    assert.equal(inmutableConflicts.length, 0, "No debería haber conflictos de inmutables");
  });
});

describe("2. Estado cambia de Pendiente a Realizada (avance normal)", () => {
  test("el estado se actualiza al más reciente sin warning de regresión", () => {
    const enero: RomaRowMerge = {
      ventaId: 208411, vin: "LSJWS4U37VZ013295",
      estado: "Pendiente", pasoActual: "Respuesta Jefe Sucursal",
      fSolicitud: d("2026-02-18"),
    };
    const febrero: RomaRowMerge = {
      ventaId: 208411, vin: "LSJWS4U37VZ013295",
      estado: "Realizada", pasoActual: "Finalizada",
      fSolicitud: d("2026-02-18"),
    };
    const { merged, warnings } = mergeRomaRows(enero, febrero, ctx("2026-02", "2026-02-28", { id: "2026-01", fecha: "2026-01-31" }));
    assert.equal(merged.estado, "Realizada");
    assert.equal(merged.pasoActual, "Finalizada");
    const regressions = warnings.filter((w) => w.kind === "STATE_REGRESSION");
    assert.equal(regressions.length, 0, "Pendiente → Realizada no es regresión");
  });
});

describe("3. Estado cambia de Realizada a Anulada (regresión observada)", () => {
  test("se aplica el cambio y se emite warning informativo", () => {
    const enero: RomaRowMerge = {
      ventaId: 206788, vin: "LJD0AA29AS0347634",
      estado: "Realizada", pasoActual: "Finalizada",
      fSolicitud: d("2026-01-13"),
    };
    const febrero: RomaRowMerge = {
      ventaId: 206788, vin: "LJD0AA29AS0347634",
      estado: "Anulada", pasoActual: "Finalizada",
      fSolicitud: d("2026-01-13"),
    };
    const { merged, warnings } = mergeRomaRows(enero, febrero, ctx("2026-02", "2026-02-28", { id: "2026-01", fecha: "2026-01-31" }));
    assert.equal(merged.estado, "Anulada", "El último corte gana");
    const regressions = warnings.filter((w) => w.kind === "STATE_REGRESSION");
    assert.equal(regressions.length, 1, "Debe emitir warning de regresión");
    assert.equal(regressions[0].prev, "Realizada");
    assert.equal(regressions[0].incoming, "Anulada");
  });

  test("Realizada → Pendiente también es regresión", () => {
    const a: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", estado: "Realizada" };
    const b: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", estado: "Pendiente" };
    const { warnings } = mergeRomaRows(a, b, ctx("c2", "2026-02-28", { id: "c1", fecha: "2026-01-31" }));
    assert.equal(warnings.filter((w) => w.kind === "STATE_REGRESSION").length, 1);
  });

  test("Anulada → Pendiente también es regresión", () => {
    const a: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", estado: "Anulada" };
    const b: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", estado: "Pendiente" };
    const { warnings } = mergeRomaRows(a, b, ctx("c2", "2026-02-28", { id: "c1", fecha: "2026-01-31" }));
    assert.equal(warnings.filter((w) => w.kind === "STATE_REGRESSION").length, 1);
  });

  test("Pendiente → Anulada NO es regresión (avance terminal)", () => {
    const a: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", estado: "Pendiente" };
    const b: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", estado: "Anulada" };
    const { warnings } = mergeRomaRows(a, b, ctx("c2", "2026-02-28", { id: "c1", fecha: "2026-01-31" }));
    assert.equal(warnings.filter((w) => w.kind === "STATE_REGRESSION").length, 0);
  });
});

describe("4. ETA cambia entre cortes (campo EVOLUTIVO_FECHA con valor nuevo)", () => {
  test("la fecha más reciente reemplaza la anterior", () => {
    const a: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", fETASucursal: d("2026-01-27") };
    const b: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", fETASucursal: d("2026-02-02") };
    const { merged, warnings } = mergeRomaRows(a, b, ctx("c2", "2026-02-28", { id: "c1", fecha: "2026-01-31" }));
    assert.deepEqual(merged.fETASucursal, d("2026-02-02"));
    assert.equal(warnings.filter((w) => w.kind === "NULL_OVERWRITE_PREVENTED").length, 0);
  });
});

describe("5. Fecha válida no se pisa con null (regla universal)", () => {
  test("fETASucursal previa NO se pierde si el nuevo corte trae null", () => {
    const a: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", fETASucursal: d("2026-01-26") };
    const b: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", fETASucursal: null };
    const { merged, warnings } = mergeRomaRows(a, b, ctx("c2", "2026-02-28", { id: "c1", fecha: "2026-01-31" }));
    assert.deepEqual(merged.fETASucursal, d("2026-01-26"), "La fecha anterior se preserva");
    const preserved = warnings.filter((w) => w.kind === "NULL_OVERWRITE_PREVENTED");
    assert.equal(preserved.length, 1);
    assert.equal(preserved[0].field, "fETASucursal");
  });

  test("aplica a TODOS los campos EVOLUTIVO_FECHA", () => {
    const a: RomaRowMerge = {
      ventaId: 1, vin: "AAAAAAAAAAAAAA",
      fETASucursal: d("2026-01-26"),
      fEstimadaEntrega: d("2026-01-26"),
      fRespuestaLogistica: d("2026-01-28"),
      fRespuestaInstalacionAcc: d("2026-01-28"),
      fETALlegadaCalc: d("2026-01-30"),
    };
    const b: RomaRowMerge = {
      ventaId: 1, vin: "AAAAAAAAAAAAAA",
      fETASucursal: null,
      fEstimadaEntrega: null,
      fRespuestaLogistica: null,
      fRespuestaInstalacionAcc: null,
      fETALlegadaCalc: null,
    };
    const { merged, warnings } = mergeRomaRows(a, b, ctx("c2", "2026-02-28", { id: "c1", fecha: "2026-01-31" }));
    assert.deepEqual(merged.fETASucursal, d("2026-01-26"));
    assert.deepEqual(merged.fEstimadaEntrega, d("2026-01-26"));
    assert.deepEqual(merged.fRespuestaLogistica, d("2026-01-28"));
    assert.deepEqual(merged.fRespuestaInstalacionAcc, d("2026-01-28"));
    assert.deepEqual(merged.fETALlegadaCalc, d("2026-01-30"));
    assert.equal(warnings.filter((w) => w.kind === "NULL_OVERWRITE_PREVENTED").length, 5);
  });
});

describe("6. FechaSolicitud y otros eventos de origen NO cambian", () => {
  test("INMUTABLE_MIN_DATE: si difiere, gana la más antigua + warning", () => {
    const a: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", fSolicitud: d("2026-01-27") };
    const b: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", fSolicitud: d("2026-02-15") };
    const { merged, warnings } = mergeRomaRows(a, b, ctx("c2", "2026-02-28", { id: "c1", fecha: "2026-01-31" }));
    assert.deepEqual(merged.fSolicitud, d("2026-01-27"), "Gana la más antigua");
    const conflicts = warnings.filter((w) => w.kind === "INMUTABLE_MIN_DATE_CONFLICT");
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].field, "fSolicitud");
  });

  test("FechaSolicitud IDÉNTICA entre cortes: sin warning", () => {
    const a: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", fSolicitud: d("2026-01-27") };
    const b: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", fSolicitud: d("2026-01-27") };
    const { warnings } = mergeRomaRows(a, b, ctx("c2", "2026-02-28", { id: "c1", fecha: "2026-01-31" }));
    assert.equal(warnings.length, 0);
  });

  test("FechaSolicitud null en uno: el otro gana, sin warning", () => {
    const a: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", fSolicitud: null };
    const b: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", fSolicitud: d("2026-01-27") };
    const { merged, warnings } = mergeRomaRows(a, b, ctx("c2", "2026-02-28", { id: "c1", fecha: "2026-01-31" }));
    assert.deepEqual(merged.fSolicitud, d("2026-01-27"));
    assert.equal(warnings.filter((w) => w.kind === "INMUTABLE_MIN_DATE_CONFLICT").length, 0);
  });

  test("INMUTABLE_FIRST (Marca): conflicto entre cortes emite warning y conserva primero", () => {
    const a: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", marca: "KIA" };
    const b: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", marca: "MG" };
    const { merged, warnings } = mergeRomaRows(a, b, ctx("c2", "2026-02-28", { id: "c1", fecha: "2026-01-31" }));
    assert.equal(merged.marca, "KIA");
    const conflicts = warnings.filter((w) => w.kind === "INMUTABLE_CHANGED" && w.field === "marca");
    assert.equal(conflicts.length, 1);
  });
});

describe("7. Conflicto de llave (VIN o VentaID)", () => {
  test("VentaID distinto: no se mergea, warning crítico", () => {
    const a: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", estado: "Pendiente" };
    const b: RomaRowMerge = { ventaId: 2, vin: "AAAAAAAAAAAAAA", estado: "Realizada" };
    const { merged, warnings } = mergeRomaRows(a, b, ctx("c2", "2026-02-28", { id: "c1", fecha: "2026-01-31" }));
    assert.equal(merged.ventaId, 1, "Existente se conserva");
    assert.equal(merged.estado, "Pendiente", "No se aplicó el merge");
    const ventaIdW = warnings.filter((w) => w.field === "ventaId" && w.kind === "INMUTABLE_CHANGED");
    assert.equal(ventaIdW.length, 1);
  });

  test("VIN distinto: warning pero igual mergea lo demás bajo llave del existente", () => {
    const a: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", estado: "Pendiente", fSolicitud: d("2026-01-27") };
    const b: RomaRowMerge = { ventaId: 1, vin: "BBBBBBBBBBBBBB", estado: "Realizada", fSolicitud: d("2026-01-27") };
    const { merged, warnings } = mergeRomaRows(a, b, ctx("c2", "2026-02-28", { id: "c1", fecha: "2026-01-31" }));
    assert.equal(merged.vin, "AAAAAAAAAAAAAA", "VIN del existente se conserva");
    assert.equal(merged.estado, "Realizada", "EVOLUTIVOS sí se aplican");
    const vinW = warnings.filter((w) => w.field === "vin" && w.kind === "INMUTABLE_CHANGED");
    assert.equal(vinW.length, 1);
  });
});

describe("Casos borde adicionales (auditoría)", () => {
  test("Corte previo NULO (primer dato evolutivo): incoming gana", () => {
    const a: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", estado: "Pendiente" };
    const b: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", estado: "Realizada" };
    // Sin cortePrevioFecha
    const { merged } = mergeRomaRows(a, b, { corteId: "c1", corteFecha: d("2026-01-31") });
    assert.equal(merged.estado, "Realizada");
  });

  test("Corte out-of-order: EVOLUTIVOS se mantienen del previo + warning", () => {
    const a: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", estado: "Realizada", fETASucursal: d("2026-03-01") };
    const b: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", estado: "Pendiente", fETASucursal: d("2026-02-01") };
    // Incoming es ENERO (más viejo) — existing viene de FEBRERO (más nuevo)
    const { merged, warnings } = mergeRomaRows(a, b, ctx("2026-01", "2026-01-31", { id: "2026-02", fecha: "2026-02-28" }));
    assert.equal(merged.estado, "Realizada", "El previo más reciente gana");
    assert.deepEqual(merged.fETASucursal, d("2026-03-01"));
    const ooo = warnings.filter((w) => w.kind === "CORTE_ANTERIOR_OUT_OF_ORDER");
    assert.equal(ooo.length, 1);
  });

  test("Campo ESTABLE: last-write-wins simple", () => {
    const a: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", varTieneLamina: "No" };
    const b: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", varTieneLamina: "Si" };
    const { merged } = mergeRomaRows(a, b, ctx("c2", "2026-02-28", { id: "c1", fecha: "2026-01-31" }));
    assert.equal(merged.varTieneLamina, "Si");
  });

  test("Campo ESTABLE: null SÍ puede pisar valor (no es protegido como las fechas)", () => {
    const a: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", sucursal: "KIA PLAZA OESTE" };
    const b: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", sucursal: null };
    const { merged } = mergeRomaRows(a, b, ctx("c2", "2026-02-28", { id: "c1", fecha: "2026-01-31" }));
    assert.equal(merged.sucursal, null);
  });

  test("Comentario evolutivo: el más reciente gana incluso si es vacío", () => {
    const a: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", comentario: "URGENTE" };
    const b: RomaRowMerge = { ventaId: 1, vin: "AAAAAAAAAAAAAA", comentario: "" };
    const { merged } = mergeRomaRows(a, b, ctx("c2", "2026-02-28", { id: "c1", fecha: "2026-01-31" }));
    assert.equal(merged.comentario, "");
  });
});

describe("consolidarRomaSerie · cadena de N cortes", () => {
  test("3 cortes consecutivos consolidan correctamente", () => {
    const enero: RomaRowMerge = { ventaId: 100, vin: "AAAAAAAAAAAAAA", estado: "Pendiente", fSolicitud: d("2026-01-15"), fETASucursal: d("2026-01-20") };
    const febrero: RomaRowMerge = { ventaId: 100, vin: "AAAAAAAAAAAAAA", estado: "Pendiente", fSolicitud: d("2026-01-15"), fETASucursal: d("2026-02-05") };
    const marzo: RomaRowMerge = { ventaId: 100, vin: "AAAAAAAAAAAAAA", estado: "Realizada", fSolicitud: d("2026-01-15"), fETASucursal: null };

    const { merged, warnings } = consolidarRomaSerie([
      { row: enero,   ctx: { corteId: "2026-01", corteFecha: d("2026-01-31") } },
      { row: febrero, ctx: { corteId: "2026-02", corteFecha: d("2026-02-28") } },
      { row: marzo,   ctx: { corteId: "2026-03", corteFecha: d("2026-03-31") } },
    ]);

    assert.equal(merged.estado, "Realizada", "Último estado gana");
    assert.deepEqual(merged.fSolicitud, d("2026-01-15"), "Fecha origen estable");
    assert.deepEqual(merged.fETASucursal, d("2026-02-05"), "ETA del corte que la tenía, no pisada por null");
    // Debería tener 1 warning: NULL_OVERWRITE_PREVENTED al pasar de feb a mar
    const preserved = warnings.filter((w) => w.kind === "NULL_OVERWRITE_PREVENTED");
    assert.equal(preserved.length, 1);
  });

  test("falla limpio con array vacío", () => {
    assert.throws(() => consolidarRomaSerie([]), /no se puede consolidar 0 cortes/);
  });
});
