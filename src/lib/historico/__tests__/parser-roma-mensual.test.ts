/**
 * Tests unitarios — Parser ROMA mensual.
 *
 * Usa `node:test`. Construye workbooks sintéticos con `xlsx.utils` para
 * cubrir todos los escenarios sin tocar archivos reales.
 *
 * Cobertura obligatoria:
 *  1. Detección de mes alta (max y moda coinciden)
 *  2. Detección de mes media (max es borde del mes siguiente, ≤7 días)
 *  3. Detección de mes baja (discrepancia grande)
 *  4. Hoja ROMA ausente
 *  5. Columnas obligatorias faltan
 *  6. Filas sin VentaID
 *  7. VIN inválido (longitud / caracteres)
 *  8. Tipos de fecha: serial Excel, dd-mm-yyyy, ISO
 *  9. Duplicado interno (mismo VentaID con dos VIN distintos)
 * 10. Archivo sin filas válidas
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  parseRomaMensualBuffer,
  RomaParserError,
  ROMA_PARSER_ERROR_CODES,
  distribuirDescartes,
} from "../parser-roma-mensual.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers para construir fixtures sintéticos
// ─────────────────────────────────────────────────────────────────────────────

type Fila = Record<string, unknown>;

function mkWorkbook(rows: Fila[], opts: { sheetName?: string } = {}): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, opts.sheetName ?? "ROMA");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new Uint8Array(buf);
}

/** Genera N filas con FechaSolicitud distribuida en el rango dado. */
function genFilas(opts: {
  ventaIdBase: number;
  cantidad: number;
  fechaInicio: string; // "2026-01-15"
  fechaFin: string;
  marca?: string;
  estado?: string;
  comentario?: string;
}): Fila[] {
  const ini = new Date(opts.fechaInicio).getTime();
  const fin = new Date(opts.fechaFin).getTime();
  const paso = (fin - ini) / Math.max(opts.cantidad - 1, 1);
  return Array.from({ length: opts.cantidad }, (_, i) => {
    const f = new Date(ini + paso * i);
    return {
      VentaID: opts.ventaIdBase + i,
      // VIN sintético válido (17 chars, alfanumérico, sin I O Q)
      Vin: `TEST${String(opts.ventaIdBase + i).padStart(13, "A")}`.slice(0, 17),
      Marca: opts.marca ?? "KIA",
      Modelo: "SONET",
      Gerencia: opts.marca ?? "KIA",
      Cajon: `CJ${i}`,
      ColorReferencial: "BLANCO",
      FechaSolicitud: f,
      FechaFactura: f,
      FechaEnprocesoIns: f,
      Estado: opts.estado ?? "Pendiente",
      PasoActual: "Respuesta Jefe Sucursal",
      Comentario: opts.comentario ?? "",
      Sucursal: "KIA PLAZA OESTE",
      VentaAcc: "CON ACCESORIOS",
      varTieneLamina: "No",
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suites
// ─────────────────────────────────────────────────────────────────────────────

describe("1. Detección de mes ALTA (max y moda coinciden)", () => {
  test("todas las solicitudes en 2026-03 → mes detectado 2026-03, alta", () => {
    const filas = genFilas({
      ventaIdBase: 100000,
      cantidad: 50,
      fechaInicio: "2026-03-02",
      fechaFin: "2026-03-30",
    });
    const buf = mkWorkbook(filas);
    const result = parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength);

    assert.equal(result.corte.id, "2026-03");
    assert.equal(result.report.mesDetectado, "2026-03");
    assert.equal(result.report.metodoDeteccion, "moda_y_max_coinciden");
    assert.equal(result.report.confianzaMesDeteccion, "alta");
    assert.equal(result.filas.length, 50);
  });
});

describe("2. Detección de mes MEDIA (max es borde del mes siguiente)", () => {
  test("90% en 2026-04, max en 2026-05-02 → mes 2026-04 con confianza media", () => {
    // 45 filas en abril + 5 filas en primeros días de mayo (borde típico)
    const abril = genFilas({
      ventaIdBase: 200000,
      cantidad: 45,
      fechaInicio: "2026-04-05",
      fechaFin: "2026-04-29",
    });
    const mayoBorde = genFilas({
      ventaIdBase: 200100,
      cantidad: 5,
      fechaInicio: "2026-05-01",
      fechaFin: "2026-05-05",
    });
    const buf = mkWorkbook([...abril, ...mayoBorde]);
    const result = parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength);

    assert.equal(result.corte.id, "2026-04", "Moda gana");
    assert.equal(result.report.confianzaMesDeteccion, "media");
    assert.equal(result.report.metodoDeteccion, "moda_gana_max_es_borde");
    assert.ok(
      result.report.detalleDeteccion.diasEntreModaYMax !== null &&
        result.report.detalleDeteccion.diasEntreModaYMax <= 7,
    );
  });
});

describe("3. Detección de mes BAJA (discrepancia grande)", () => {
  test("mayoría en 2026-02, una fila aislada en 2026-04 → confianza baja", () => {
    const febrero = genFilas({
      ventaIdBase: 300000,
      cantidad: 30,
      fechaInicio: "2026-02-05",
      fechaFin: "2026-02-28",
    });
    const aislada = genFilas({
      ventaIdBase: 300100,
      cantidad: 1,
      fechaInicio: "2026-04-20",
      fechaFin: "2026-04-20",
    });
    const buf = mkWorkbook([...febrero, ...aislada]);
    const result = parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength);

    assert.equal(result.corte.id, "2026-02", "Moda gana aun con discrepancia");
    assert.equal(result.report.confianzaMesDeteccion, "baja");
    assert.equal(result.report.metodoDeteccion, "moda_gana_pero_discrepa_fuerte");
    const dias = result.report.detalleDeteccion.diasEntreModaYMax;
    assert.ok(dias !== null && dias > 7);
  });
});

describe("4. Hoja ROMA ausente", () => {
  test("falla con código HOJA_AUSENTE", () => {
    const buf = mkWorkbook(genFilas({ ventaIdBase: 1, cantidad: 1, fechaInicio: "2026-01-01", fechaFin: "2026-01-01" }), {
      sheetName: "OTRA_HOJA",
    });
    assert.throws(
      () => parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength),
      (e: unknown) => {
        assert.ok(e instanceof RomaParserError);
        assert.equal((e as RomaParserError).code, ROMA_PARSER_ERROR_CODES.HOJA_AUSENTE);
        return true;
      },
    );
  });
});

describe("5. Columnas obligatorias faltantes", () => {
  test("sin VentaID → COLUMNAS_FALTAN", () => {
    const rows = [
      { Vin: "AAAAAAAAAAAAAAAAA", FechaSolicitud: new Date("2026-01-15"), Marca: "KIA" },
    ];
    const buf = mkWorkbook(rows);
    assert.throws(
      () => parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength),
      (e: unknown) => {
        assert.ok(e instanceof RomaParserError);
        assert.equal((e as RomaParserError).code, ROMA_PARSER_ERROR_CODES.COLUMNAS_FALTAN);
        return true;
      },
    );
  });

  test("sin FechaSolicitud → COLUMNAS_FALTAN", () => {
    const rows = [{ VentaID: 1, Vin: "AAAAAAAAAAAAAAAAA", Marca: "KIA" }];
    const buf = mkWorkbook(rows);
    assert.throws(() => parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength), RomaParserError);
  });
});

describe("6. Filas sin VentaID se descartan", () => {
  test("4 válidas + 2 sin VentaID → 4 procesadas, 2 descartes con razón sin_ventaId", () => {
    const validas = genFilas({ ventaIdBase: 500000, cantidad: 4, fechaInicio: "2026-03-10", fechaFin: "2026-03-20" });
    const sinVenta = [
      { VentaID: null, Vin: "BBBBBBBBBBBBBBBBB", FechaSolicitud: new Date("2026-03-15") },
      { VentaID: "", Vin: "CCCCCCCCCCCCCCCCC", FechaSolicitud: new Date("2026-03-16") },
    ];
    const buf = mkWorkbook([...validas, ...sinVenta]);
    const result = parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength);

    assert.equal(result.filas.length, 4);
    assert.equal(result.report.filasDescartadas, 2);
    const dist = distribuirDescartes(result.report.descartes);
    assert.equal(dist.sin_ventaId, 2);
  });

  test("VentaID no numérico → razon ventaId_no_numerico", () => {
    const validas = genFilas({ ventaIdBase: 600000, cantidad: 2, fechaInicio: "2026-03-10", fechaFin: "2026-03-12" });
    const noNumerico = [
      { VentaID: "abc", Vin: "DDDDDDDDDDDDDDDDD", FechaSolicitud: new Date("2026-03-11") },
    ];
    const buf = mkWorkbook([...validas, ...noNumerico]);
    const result = parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength);

    assert.equal(result.filas.length, 2);
    const dist = distribuirDescartes(result.report.descartes);
    assert.equal(dist.ventaId_no_numerico, 1);
  });
});

describe("7. VIN inválido (longitud / caracteres)", () => {
  test("VIN demasiado corto y con I/O/Q se descartan como vin_invalido", () => {
    const ok = genFilas({ ventaIdBase: 700000, cantidad: 2, fechaInicio: "2026-03-10", fechaFin: "2026-03-12" });
    const corto = [{ VentaID: 700100, Vin: "ABC", FechaSolicitud: new Date("2026-03-11") }];
    const conI = [{ VentaID: 700200, Vin: "IIIIIIIIIIIIIIIII", FechaSolicitud: new Date("2026-03-11") }];
    const buf = mkWorkbook([...ok, ...corto, ...conI]);
    const result = parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength);

    assert.equal(result.filas.length, 2);
    const dist = distribuirDescartes(result.report.descartes);
    assert.equal(dist.vin_invalido, 2);
  });

  test("VIN ausente → sin_vin", () => {
    const ok = genFilas({ ventaIdBase: 800000, cantidad: 1, fechaInicio: "2026-03-10", fechaFin: "2026-03-10" });
    const sinVin = [{ VentaID: 800100, Vin: null, FechaSolicitud: new Date("2026-03-12") }];
    const buf = mkWorkbook([...ok, ...sinVin]);
    const result = parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength);

    const dist = distribuirDescartes(result.report.descartes);
    assert.equal(dist.sin_vin, 1);
  });
});

describe("8. Tipos de fecha aceptados", () => {
  test("serial Excel se parsea a Date correcta", () => {
    // Serial 46388 = días desde 1900 hasta una fecha de finales 2026.
    // Verificación: el parser debe producir una Date válida del año 2026-2027.
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["VentaID", "Vin", "FechaSolicitud", "Marca"],
      [900000, "EEEEEEEEEEEEEEEEE", 46388, "KIA"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "ROMA");
    const buf = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    const result = parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.filas.length, 1);
    const fSol = result.filas[0].fSolicitud;
    assert.ok(fSol instanceof Date && Number.isFinite(fSol.getTime()));
    // Serial 46388 produce alguna fecha de finales 2026 / inicio 2027 según TZ.
    const year = fSol!.getFullYear();
    assert.ok(year === 2026 || year === 2027, `Año inesperado: ${year}`);
  });

  test("string 'dd-mm-yyyy' se parsea correctamente", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["VentaID", "Vin", "FechaSolicitud", "Marca"],
      [900100, "FFFFFFFFFFFFFFFFF", "15-03-2026", "KIA"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "ROMA");
    const buf = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    const result = parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength);
    const fSol = result.filas[0].fSolicitud;
    assert.ok(fSol);
    assert.equal(fSol?.getFullYear(), 2026);
    assert.equal(fSol?.getMonth(), 2); // marzo (0-based)
    assert.equal(fSol?.getDate(), 15);
  });

  test("sentinel '0' y '00-00-0000' devuelven null", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["VentaID", "Vin", "FechaSolicitud", "FechaFactura", "FechaEnprocesoIns"],
      [900200, "GGGGGGGGGGGGGGGGG", "15-03-2026", "0", "00-00-0000"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "ROMA");
    const buf = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    const result = parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.filas.length, 1);
    assert.equal(result.filas[0].fFactura, null);
    assert.equal(result.filas[0].fInscripcion, null);
  });
});

describe("9. Duplicado interno (mismo VentaID con dos VIN distintos)", () => {
  test("registra duplicadosInternos y descarta segunda aparición", () => {
    const rows = [
      { VentaID: 1000000, Vin: "AAAAAAAAAAAAAAAAA", FechaSolicitud: new Date("2026-03-15"), Marca: "KIA" },
      { VentaID: 1000000, Vin: "BBBBBBBBBBBBBBBBB", FechaSolicitud: new Date("2026-03-16"), Marca: "KIA" },
    ];
    const buf = mkWorkbook(rows);
    const result = parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength);

    assert.equal(result.filas.length, 1);
    assert.equal(result.report.duplicadosInternos.length, 1);
    assert.equal(result.report.duplicadosInternos[0].ventaId, 1000000);
    const dist = distribuirDescartes(result.report.descartes);
    assert.equal(dist.duplicado_interno_ventaId, 1);
  });

  test("mismo VentaID + mismo VIN → solo descarte, no duplicadoInterno", () => {
    const rows = [
      { VentaID: 1100000, Vin: "CCCCCCCCCCCCCCCCC", FechaSolicitud: new Date("2026-03-15") },
      { VentaID: 1100000, Vin: "CCCCCCCCCCCCCCCCC", FechaSolicitud: new Date("2026-03-15") },
    ];
    const buf = mkWorkbook(rows);
    const result = parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength);

    assert.equal(result.filas.length, 1);
    assert.equal(result.report.duplicadosInternos.length, 0, "VIN idéntico no es duplicado real");
    const dist = distribuirDescartes(result.report.descartes);
    assert.equal(dist.duplicado_interno_ventaId, 1);
  });
});

describe("10. Archivo sin filas válidas", () => {
  test("todas las filas con VentaID null → SIN_FILAS_VALIDAS", () => {
    const rows = [
      { VentaID: null, Vin: "DDDDDDDDDDDDDDDDD", FechaSolicitud: new Date("2026-01-01") },
      { VentaID: null, Vin: "EEEEEEEEEEEEEEEEE", FechaSolicitud: new Date("2026-01-02") },
    ];
    const buf = mkWorkbook(rows);
    assert.throws(
      () => parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength),
      (e: unknown) => {
        assert.ok(e instanceof RomaParserError);
        assert.equal((e as RomaParserError).code, ROMA_PARSER_ERROR_CODES.SIN_FILAS_VALIDAS);
        return true;
      },
    );
  });

  test("hoja ROMA completamente vacía → SIN_FILAS_VALIDAS", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["VentaID", "Vin", "FechaSolicitud"]]);
    XLSX.utils.book_append_sheet(wb, ws, "ROMA");
    const buf = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    assert.throws(() => parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength), RomaParserError);
  });
});

describe("Cobertura adicional", () => {
  test("filas devueltas tienen forma RomaRowMerge compatible con MergePolicy", () => {
    const filas = genFilas({ ventaIdBase: 2000000, cantidad: 3, fechaInicio: "2026-03-10", fechaFin: "2026-03-20" });
    const buf = mkWorkbook(filas);
    const result = parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength);

    for (const f of result.filas) {
      assert.equal(typeof f.ventaId, "number");
      assert.equal(typeof f.vin, "string");
      assert.ok(f.vin.length >= 11 && f.vin.length <= 17);
      // No incluye campos extra fuera de RomaRowMerge
      const allowedKeys = new Set([
        "ventaId", "vin", "marca", "modelo", "gerencia", "colorReferencial", "cajon",
        "fSolicitud", "fFactura", "fInscripcion", "fVenta",
        "estado", "pasoActual", "comentario",
        "fETASucursal", "fEstimadaEntrega", "fRespuestaLogistica",
        "fRespuestaInstalacionAcc", "fETALlegadaCalc",
        "sucursal", "ventaAcc", "varTieneLamina",
      ]);
      for (const k of Object.keys(f)) {
        assert.ok(allowedKeys.has(k), `Campo extra inesperado: ${k}`);
      }
    }
  });

  test("distribución mensual incluye TODOS los meses con datos", () => {
    const ene = genFilas({ ventaIdBase: 3000000, cantidad: 5, fechaInicio: "2026-01-10", fechaFin: "2026-01-30" });
    const feb = genFilas({ ventaIdBase: 3000100, cantidad: 20, fechaInicio: "2026-02-05", fechaFin: "2026-02-28" });
    const buf = mkWorkbook([...ene, ...feb]);
    const result = parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength);

    const meses = result.report.distribucionMesFechaSolicitud.map((d) => d.mes);
    assert.deepEqual(meses, ["2026-01", "2026-02"]);
    assert.equal(result.corte.id, "2026-02", "Moda de febrero gana");
  });

  test("corte.fecha es el último día del mes detectado", () => {
    const filas = genFilas({ ventaIdBase: 4000000, cantidad: 10, fechaInicio: "2026-03-05", fechaFin: "2026-03-25" });
    const buf = mkWorkbook(filas);
    const result = parseRomaMensualBuffer(buf, "test.xlsx", buf.byteLength);
    assert.ok(result.corte.fecha);
    assert.equal(result.corte.fecha?.getMonth(), 2); // marzo
    assert.equal(result.corte.fecha?.getDate(), 31);
  });
});
