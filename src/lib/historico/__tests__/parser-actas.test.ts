/**
 * Tests unitarios — Parser Actas histórico.
 *
 * Usa `node:test`. Construye workbooks sintéticos con `xlsx.utils` para
 * cubrir todos los escenarios sin tocar archivos reales.
 *
 * Cobertura obligatoria:
 *  1. Hoja ROMA ausente
 *  2. Columnas obligatorias faltantes
 *  3. Sin VIN / VIN inválido / duplicado interno VIN
 *  4. Entregado por `entrega_auto_txt === "Cargado"`
 *  5. Entregado por red de seguridad (`fecha_patente_entregada` con txt vacío)
 *  6. No entregado (txt vacío y sin red de seguridad)
 *  7. `fDocListoDerivado` cascade:
 *      - fPatenteRecibida + fInscripcion → patente_recibida
 *      - solo fInscripcion → inscripcion
 *      - ninguna → ninguna
 *  8. `nivelDocumental`:
 *      - completo (factura + inscripción + patente recibida [+ entrega])
 *      - parcial (factura + inscripción sin patente recibida)
 *      - minimo (factura sin inscripción)
 *  9. Métricas `cumplimiento.entregadosSinPatenteRecibida` y vecinas
 * 10. Huérfanos candidatos Tipo 1 / Tipo 2
 * 11. Detección de corte con confianza alta/media/baja
 * 12. Round-trip API: `parseActasFile` ↔ `parseActasBuffer`
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  parseActasBuffer,
  ActasParserError,
  ACTAS_PARSER_ERROR_CODES,
  distribuirDescartesActas,
} from "../parser-actas.js";

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

/** Genera VIN sintético válido de 17 chars (sin I/O/Q) a partir de un seed. */
function mkVin(seed: number): string {
  const base = `TEST${String(seed).padStart(13, "A")}`;
  return base.slice(0, 17).toUpperCase().replace(/[IOQ]/g, "A");
}

interface FilaActasOpts {
  vin?: string;
  fVenta?: Date | string | null;
  fFactura?: Date | string | null;
  fSolIns?: Date | string | null;
  fIns?: Date | string | null;
  fPatAdmin?: Date | string | null;
  fPatEnviada?: Date | string | null;
  fPatRecibida?: Date | string | null;
  fPatEntregada?: Date | string | null;
  txt?: string | null;
  aut?: string | null;
  sol?: string | null;
  sucursal?: string;
  cliente?: string;
  vendedor?: string;
  id?: number;
}

/** Construye una fila Actas con todos los campos. Campos ausentes → null. */
function mkFila(seed: number, opts: FilaActasOpts = {}): Fila {
  return {
    ID: opts.id ?? seed,
    Sucursal: opts.sucursal ?? "KIA PLAZA OESTE",
    Nombre_Cliente: opts.cliente ?? "CLIENTE TEST",
    Nombre_Vendedor: opts.vendedor ?? "VENDEDOR TEST",
    Vin: opts.vin ?? mkVin(seed),
    FechaVenta: opts.fVenta ?? null,
    FechaFactura: opts.fFactura ?? null,
    ValorFactura: 10_000_000,
    FechaSolicitudInscripcion: opts.fSolIns ?? null,
    FechaInscripcion: opts.fIns ?? null,
    patentes_administracion: opts.fPatAdmin ?? null,
    fecha_patente_enviada: opts.fPatEnviada ?? null,
    fecha_patente_recibida: opts.fPatRecibida ?? null,
    fecha_patente_entregada: opts.fPatEntregada ?? null,
    autorizacion_entrega: opts.aut ?? null,
    sol_entrega: opts.sol ?? null,
    entrega_auto_txt: opts.txt ?? null,
    etapa: 8,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Hoja ROMA ausente
// ─────────────────────────────────────────────────────────────────────────────

describe("1. Hoja ROMA ausente", () => {
  test("falla con código HOJA_AUSENTE", () => {
    const buf = mkWorkbook([mkFila(1, { fFactura: new Date("2026-03-15") })], {
      sheetName: "OTRA",
    });
    assert.throws(
      () => parseActasBuffer(buf, "test.xlsx", buf.byteLength),
      (e: unknown) => {
        assert.ok(e instanceof ActasParserError);
        assert.equal((e as ActasParserError).code, ACTAS_PARSER_ERROR_CODES.HOJA_AUSENTE);
        return true;
      },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Columnas obligatorias faltantes
// ─────────────────────────────────────────────────────────────────────────────

describe("2. Columnas obligatorias faltantes", () => {
  test("sin Vin → COLUMNAS_FALTAN", () => {
    const rows = [
      {
        FechaVenta: new Date("2026-01-01"),
        FechaFactura: new Date("2026-01-02"),
        entrega_auto_txt: "Cargado",
      },
    ];
    const buf = mkWorkbook(rows);
    assert.throws(
      () => parseActasBuffer(buf, "test.xlsx", buf.byteLength),
      (e: unknown) => {
        assert.ok(e instanceof ActasParserError);
        assert.equal((e as ActasParserError).code, ACTAS_PARSER_ERROR_CODES.COLUMNAS_FALTAN);
        return true;
      },
    );
  });

  test("sin entrega_auto_txt → COLUMNAS_FALTAN", () => {
    const rows = [
      {
        Vin: mkVin(1),
        FechaVenta: new Date("2026-01-01"),
        FechaFactura: new Date("2026-01-02"),
      },
    ];
    const buf = mkWorkbook(rows);
    assert.throws(
      () => parseActasBuffer(buf, "test.xlsx", buf.byteLength),
      ActasParserError,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. VIN inválido / sin VIN / duplicado
// ─────────────────────────────────────────────────────────────────────────────

describe("3. Sin VIN / VIN inválido / duplicado interno VIN", () => {
  test("filas sin VIN se descartan como sin_vin", () => {
    const rows = [
      mkFila(1, { fFactura: new Date("2026-03-10"), txt: "Cargado", fPatEntregada: new Date("2026-03-15") }),
      { ...mkFila(2, { fFactura: new Date("2026-03-11"), txt: "Cargado" }), Vin: null },
      { ...mkFila(3, { fFactura: new Date("2026-03-12"), txt: "Cargado" }), Vin: "" },
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.filas.length, 1);
    const dist = distribuirDescartesActas(result.report.descartes);
    assert.equal(dist.sin_vin, 2);
  });

  test("VIN demasiado corto y con I/O/Q se descartan como vin_invalido", () => {
    const rows = [
      mkFila(1, { fFactura: new Date("2026-03-10"), txt: "Cargado", fPatEntregada: new Date("2026-03-15") }),
      { ...mkFila(2, { fFactura: new Date("2026-03-11"), txt: "Cargado" }), Vin: "ABC" },
      { ...mkFila(3, { fFactura: new Date("2026-03-12"), txt: "Cargado" }), Vin: "IIIIIIIIIIIIIIIII" },
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.filas.length, 1);
    const dist = distribuirDescartesActas(result.report.descartes);
    assert.equal(dist.vin_invalido, 2);
  });

  test("VIN duplicado: segunda aparición se descarta como duplicado_interno_vin", () => {
    const vin = mkVin(1000);
    const rows = [
      mkFila(1, { vin, fFactura: new Date("2026-03-10"), txt: "Cargado", fPatEntregada: new Date("2026-03-15") }),
      mkFila(2, { vin, fFactura: new Date("2026-03-11"), txt: "Cargado", fPatEntregada: new Date("2026-03-16") }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.filas.length, 1);
    const dist = distribuirDescartesActas(result.report.descartes);
    assert.equal(dist.duplicado_interno_vin, 1);
    assert.equal(result.report.duplicadosInternosVin.length, 1);
    assert.equal(result.report.duplicadosInternosVin[0], vin);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Entregado por entrega_auto_txt === "Cargado"
// ─────────────────────────────────────────────────────────────────────────────

describe("4. Entregado por entrega_auto_txt === 'Cargado'", () => {
  test("txt='Cargado' + fPatenteEntregada → entregado, fuente=entrega_auto_txt", () => {
    const rows = [
      mkFila(1, {
        fFactura: new Date("2026-03-01"),
        fIns: new Date("2026-03-05"),
        fPatRecibida: new Date("2026-03-10"),
        fPatEntregada: new Date("2026-03-15"),
        txt: "Cargado",
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.filas.length, 1);
    const f = result.filas[0];
    assert.equal(f.entregado, true);
    assert.equal(f.fuenteEntrega, "entrega_auto_txt");
    assert.ok(f.fEntregaReal instanceof Date);
    assert.equal(f.fEntregaReal!.getTime(), new Date("2026-03-15").getTime());
  });

  test("txt='Cargado' SIN fPatenteEntregada → entregado pero fEntregaReal=null (sin fecha)", () => {
    const rows = [
      mkFila(1, {
        fFactura: new Date("2026-03-01"),
        fIns: new Date("2026-03-05"),
        fPatRecibida: new Date("2026-03-10"),
        txt: "Cargado",
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    const f = result.filas[0];
    assert.equal(f.entregado, true);
    assert.equal(f.fEntregaReal, null);
    assert.equal(result.report.totalSinFechaEntregaReal, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Entregado por red de seguridad
// ─────────────────────────────────────────────────────────────────────────────

describe("5. Entregado por red de seguridad (txt vacío + fPatenteEntregada)", () => {
  test("txt vacío + fPatenteEntregada presente → entregado, fuente=fecha_patente_entregada", () => {
    const rows = [
      mkFila(1, {
        fFactura: new Date("2026-03-01"),
        fIns: new Date("2026-03-05"),
        fPatRecibida: new Date("2026-03-10"),
        fPatEntregada: new Date("2026-03-15"),
        txt: null,
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.filas.length, 1);
    const f = result.filas[0];
    assert.equal(f.entregado, true);
    assert.equal(f.fuenteEntrega, "fecha_patente_entregada");
    assert.equal(f.fEntregaReal?.getTime(), new Date("2026-03-15").getTime());
    assert.equal(result.report.totalRedSeguridad, 1);
    assert.equal(result.report.totalCargadoTxt, 0);
  });

  test("txt='Pendiente' + fPatenteEntregada → entregado por red de seguridad", () => {
    const rows = [
      mkFila(1, {
        fFactura: new Date("2026-03-01"),
        fPatEntregada: new Date("2026-03-15"),
        txt: "Pendiente",
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    const f = result.filas[0];
    assert.equal(f.entregado, true);
    assert.equal(f.fuenteEntrega, "fecha_patente_entregada");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. No entregado
// ─────────────────────────────────────────────────────────────────────────────

describe("6. No entregado", () => {
  test("txt vacío y sin fPatenteEntregada → entregado=false", () => {
    const rows = [
      mkFila(1, {
        fFactura: new Date("2026-03-01"),
        fIns: new Date("2026-03-05"),
        txt: null,
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    const f = result.filas[0];
    assert.equal(f.entregado, false);
    assert.equal(f.fuenteEntrega, "ninguna");
    assert.equal(f.fEntregaReal, null);
    assert.equal(result.report.totalNoEntregados, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. fDocListoDerivado cascade
// ─────────────────────────────────────────────────────────────────────────────

describe("7. fDocListoDerivado cascade", () => {
  test("fPatenteRecibida + fInscripcion → fDocListoDerivado = fPatenteRecibida", () => {
    const rows = [
      mkFila(1, {
        fFactura: new Date("2026-03-01"),
        fIns: new Date("2026-03-05"),
        fPatRecibida: new Date("2026-03-10"),
        txt: "Cargado",
        fPatEntregada: new Date("2026-03-15"),
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    const f = result.filas[0];
    assert.equal(f.fuenteDocListo, "patente_recibida");
    assert.equal(f.fDocListoDerivado?.getTime(), new Date("2026-03-10").getTime());
  });

  test("solo fInscripcion (sin fPatenteRecibida) → fDocListoDerivado = fInscripcion", () => {
    const rows = [
      mkFila(1, {
        fFactura: new Date("2026-03-01"),
        fIns: new Date("2026-03-05"),
        txt: "Cargado",
        fPatEntregada: new Date("2026-03-15"),
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    const f = result.filas[0];
    assert.equal(f.fuenteDocListo, "inscripcion");
    assert.equal(f.fDocListoDerivado?.getTime(), new Date("2026-03-05").getTime());
  });

  test("ninguna fecha documental → fDocListoDerivado = null, fuente=ninguna", () => {
    const rows = [
      mkFila(1, {
        fFactura: new Date("2026-03-01"),
        txt: null,
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    const f = result.filas[0];
    assert.equal(f.fDocListoDerivado, null);
    assert.equal(f.fuenteDocListo, "ninguna");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. nivelDocumental
// ─────────────────────────────────────────────────────────────────────────────

describe("8. nivelDocumental", () => {
  test("entregado + factura + inscripción + patente recibida + entrega real → completo", () => {
    const rows = [
      mkFila(1, {
        fFactura: new Date("2026-03-01"),
        fIns: new Date("2026-03-05"),
        fPatRecibida: new Date("2026-03-10"),
        fPatEntregada: new Date("2026-03-15"),
        txt: "Cargado",
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.filas[0].nivelDocumental, "completo");
    assert.equal(result.report.cumplimiento.porNivelDocumental.completo, 1);
  });

  test("no entregado + factura + inscripción + patente recibida → completo", () => {
    const rows = [
      mkFila(1, {
        fFactura: new Date("2026-03-01"),
        fIns: new Date("2026-03-05"),
        fPatRecibida: new Date("2026-03-10"),
        txt: null,
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.filas[0].nivelDocumental, "completo");
  });

  test("factura + inscripción sin patente recibida → parcial", () => {
    const rows = [
      mkFila(1, {
        fFactura: new Date("2026-03-01"),
        fIns: new Date("2026-03-05"),
        txt: null,
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.filas[0].nivelDocumental, "parcial");
    assert.equal(result.report.cumplimiento.porNivelDocumental.parcial, 1);
  });

  test("factura sin inscripción → minimo", () => {
    const rows = [
      mkFila(1, {
        fFactura: new Date("2026-03-01"),
        txt: null,
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.filas[0].nivelDocumental, "minimo");
    assert.equal(result.report.cumplimiento.porNivelDocumental.minimo, 1);
  });

  test("entregado SIN fEntregaReal (txt='Cargado', sin fPatenteEntregada) → no es completo (es parcial)", () => {
    const rows = [
      mkFila(1, {
        fFactura: new Date("2026-03-01"),
        fIns: new Date("2026-03-05"),
        fPatRecibida: new Date("2026-03-10"),
        txt: "Cargado",
        // sin fPatEntregada
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    const f = result.filas[0];
    assert.equal(f.entregado, true);
    assert.equal(f.fEntregaReal, null);
    // No puede ser "completo" porque no hay fEntregaReal pese a entregado=true
    assert.equal(f.nivelDocumental, "parcial");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Métricas cumplimiento
// ─────────────────────────────────────────────────────────────────────────────

describe("9. Métricas cumplimiento operacional", () => {
  test("entregadosSinPatenteRecibida cuenta entregados sin fPatenteRecibida", () => {
    const rows = [
      // Entregado con patente recibida
      mkFila(1, {
        fFactura: new Date("2026-03-01"),
        fIns: new Date("2026-03-05"),
        fPatRecibida: new Date("2026-03-10"),
        fPatEntregada: new Date("2026-03-15"),
        txt: "Cargado",
        aut: "Si",
        sol: "Si",
      }),
      // Entregado sin patente recibida (caso típico operacional)
      mkFila(2, {
        fFactura: new Date("2026-03-02"),
        fIns: new Date("2026-03-06"),
        fPatEntregada: new Date("2026-03-16"),
        txt: "Cargado",
        aut: "Si",
        sol: "Si",
      }),
      // Entregado sin patente recibida y sin aut ni sol
      mkFila(3, {
        fFactura: new Date("2026-03-03"),
        fIns: new Date("2026-03-07"),
        fPatEntregada: new Date("2026-03-17"),
        txt: "Cargado",
      }),
      // NO entregado, no debería contar en métricas de cumplimiento
      mkFila(4, {
        fFactura: new Date("2026-03-04"),
        fIns: new Date("2026-03-08"),
        txt: null,
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.report.totalEntregados, 3);
    assert.equal(result.report.totalNoEntregados, 1);
    assert.equal(result.report.cumplimiento.entregadosSinPatenteRecibida, 2);
    assert.equal(result.report.cumplimiento.entregadosSinAutorizacion, 1);
    assert.equal(result.report.cumplimiento.entregadosSinSolicitudEntrega, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Huérfanos candidatos
// ─────────────────────────────────────────────────────────────────────────────

describe("10. Huérfanos candidatos", () => {
  test("Tipo 1: no entregado + fInscripcion + sin autorización + sin solicitud", () => {
    const rows = [
      mkFila(1, {
        fFactura: new Date("2026-03-01"),
        fIns: new Date("2026-03-05"),
        txt: null,
        aut: null,
        sol: null,
      }),
      // No entregado pero con inscripción y autorización → NO es huérfano tipo 1
      mkFila(2, {
        fFactura: new Date("2026-03-02"),
        fIns: new Date("2026-03-06"),
        txt: null,
        aut: "Si",
        sol: "Si",
      }),
      // Entregado con inscripción → NO es tipo 1
      mkFila(3, {
        fFactura: new Date("2026-03-03"),
        fIns: new Date("2026-03-07"),
        fPatRecibida: new Date("2026-03-10"),
        fPatEntregada: new Date("2026-03-15"),
        txt: "Cargado",
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.report.huerfanosCandidatos.tipo1ProbableEntregaNoRegistrada, 1);
  });

  test("Tipo 2: entregado pero sin fInscripcion (cierre inconsistente)", () => {
    const rows = [
      // Entregado SIN inscripción → tipo 2
      mkFila(1, {
        fFactura: new Date("2026-03-01"),
        fPatEntregada: new Date("2026-03-15"),
        txt: "Cargado",
      }),
      // Entregado CON inscripción → no es tipo 2
      mkFila(2, {
        fFactura: new Date("2026-03-02"),
        fIns: new Date("2026-03-06"),
        fPatEntregada: new Date("2026-03-16"),
        txt: "Cargado",
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.report.huerfanosCandidatos.tipo2EntregadoConCierreInconsistente, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Detección de corte
// ─────────────────────────────────────────────────────────────────────────────

describe("11. Detección de corte", () => {
  test("confianza alta: las 3 fechas (entrega, patente, factura) ≤7d del ganador", () => {
    // Usamos Date local (no UTC) para evitar drift en el roundtrip xlsx
    const rows = [
      mkFila(1, {
        fFactura: new Date(2026, 4, 26),
        fPatRecibida: new Date(2026, 4, 27),
        fPatEntregada: new Date(2026, 4, 28),
        txt: "Cargado",
      }),
      mkFila(2, {
        fFactura: new Date(2026, 4, 25),
        fPatRecibida: new Date(2026, 4, 26),
        fPatEntregada: new Date(2026, 4, 27),
        txt: "Cargado",
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.report.confianzaCorte, "alta");
    assert.equal(result.report.metodoDeteccionCorte, "max_fecha_entrega");
    // El ganador es el max de fPatEntregada (28-mayo en local). Por roundtrip
    // xlsx puede caer en 27 o 28 según TZ del runner.
    assert.ok(["2026-05-27", "2026-05-28"].includes(result.report.detalleCorte.corteEstimado ?? ""));
  });

  test("confianza media: 2 de 3 fechas dentro del rango", () => {
    const rows = [
      // factura y patente cerca del corte; entrega real muy atrasada
      mkFila(1, {
        fFactura: new Date("2026-05-26"),
        fPatRecibida: new Date("2026-05-27"),
        fPatEntregada: new Date("2026-01-15"),
        txt: "Cargado",
      }),
      mkFila(2, {
        fFactura: new Date("2026-05-25"),
        fPatRecibida: new Date("2026-05-26"),
        fPatEntregada: new Date("2026-01-10"),
        txt: "Cargado",
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.report.confianzaCorte, "media");
  });

  test("confianza baja: solo 1 fecha cerca del ganador", () => {
    const rows = [
      mkFila(1, {
        fFactura: new Date("2026-01-05"),
        fPatRecibida: new Date("2026-03-15"),
        fPatEntregada: new Date("2026-05-28"),
        txt: "Cargado",
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.report.confianzaCorte, "baja");
  });

  test("sin fechas → confianza ninguna, corte.fecha=null", () => {
    const rows = [
      // Para no caer en fechas_incoherentes el fVenta y fEntregaReal deben ser coherentes
      mkFila(1, {
        fFactura: null,
        fVenta: null,
        txt: null,
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.report.confianzaCorte, "ninguna");
    assert.equal(result.report.metodoDeteccionCorte, "ninguno");
    assert.equal(result.corte.fecha, null);
    assert.equal(result.corte.id, "indeterminado");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Cobertura adicional
// ─────────────────────────────────────────────────────────────────────────────

describe("12. Cobertura adicional", () => {
  test("forma de ActasRowMerge: campos esperados y nada más", () => {
    const rows = [
      mkFila(1, {
        fFactura: new Date("2026-03-01"),
        fIns: new Date("2026-03-05"),
        fPatRecibida: new Date("2026-03-10"),
        fPatEntregada: new Date("2026-03-15"),
        txt: "Cargado",
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    const f = result.filas[0];
    const allowed = new Set([
      "vin", "id", "sucursal", "cliente", "vendedor",
      "valorFactura",
      "fVenta", "fFactura", "fSolicitudInscripcion", "fInscripcion",
      "fPatenteAdmin", "fPatenteEnviada", "fPatenteRecibida", "fPatenteEntregada",
      "autorizacionEntrega", "solEntrega", "entregaAutoTxt",
      "entregado", "fEntregaReal", "fuenteEntrega",
      "fDocListoDerivado", "fuenteDocListo", "nivelDocumental",
      "estadoEntregaOriginal", "etapa",
    ]);
    for (const k of Object.keys(f)) {
      assert.ok(allowed.has(k), `Campo extra inesperado en ActasRowMerge: ${k}`);
    }
  });

  test("string 'dd-mm-yyyy' como fecha se parsea correctamente", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Vin", "FechaVenta", "FechaFactura", "FechaInscripcion", "entrega_auto_txt"],
      [mkVin(1), "01-03-2026", "02-03-2026", "05-03-2026", null],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "ROMA");
    const buf = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    const f = result.filas[0];
    assert.equal(f.fFactura?.getMonth(), 2);
    assert.equal(f.fFactura?.getDate(), 2);
    assert.equal(f.fInscripcion?.getDate(), 5);
  });

  test("sentinel '0' y '00-00-0000' en fechas devuelven null", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Vin", "FechaVenta", "FechaFactura", "FechaInscripcion", "fecha_patente_recibida", "entrega_auto_txt"],
      [mkVin(1), "01-03-2026", "02-03-2026", "0", "00-00-0000", null],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "ROMA");
    const buf = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    const f = result.filas[0];
    assert.equal(f.fInscripcion, null);
    assert.equal(f.fPatenteRecibida, null);
  });

  test("cobertura de fechas se calcula en % redondeado a 2 decimales", () => {
    const rows = [
      mkFila(1, { fFactura: new Date("2026-03-01"), fIns: new Date("2026-03-05"), fPatRecibida: new Date("2026-03-10"), txt: null }),
      mkFila(2, { fFactura: new Date("2026-03-02"), fIns: new Date("2026-03-06"), txt: null }),
      mkFila(3, { fFactura: new Date("2026-03-03"), txt: null }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.report.cobertura.fFactura, 100);
    assert.equal(result.report.cobertura.fInscripcion, 66.67);
    assert.equal(result.report.cobertura.fPatenteRecibida, 33.33);
  });

  test("descarte por fechas incoherentes (entrega anterior a venta por >1 año)", () => {
    const rows = [
      // Entrega 2024-01-15, venta 2026-03-01 → incoherente
      mkFila(1, {
        fVenta: new Date("2026-03-01"),
        fFactura: new Date("2026-03-02"),
        fPatEntregada: new Date("2024-01-15"),
        txt: "Cargado",
      }),
      // Caso válido
      mkFila(2, {
        fVenta: new Date("2026-03-01"),
        fFactura: new Date("2026-03-02"),
        fPatEntregada: new Date("2026-03-20"),
        txt: "Cargado",
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    assert.equal(result.filas.length, 1);
    const dist = distribuirDescartesActas(result.report.descartes);
    assert.equal(dist.fechas_incoherentes, 1);
  });

  test("corte.id refleja la fecha del corte (YYYY-MM-DD)", () => {
    // Local Date para evitar drift TZ en roundtrip xlsx
    const rows = [
      mkFila(1, {
        fFactura: new Date(2026, 4, 26),
        fPatRecibida: new Date(2026, 4, 27),
        fPatEntregada: new Date(2026, 4, 28),
        txt: "Cargado",
      }),
    ];
    const buf = mkWorkbook(rows);
    const result = parseActasBuffer(buf, "test.xlsx", buf.byteLength);
    assert.ok(/^2026-05-(27|28)$/.test(result.corte.id), `corte.id inesperado: ${result.corte.id}`);
    assert.ok(result.corte.fecha instanceof Date);
  });
});
