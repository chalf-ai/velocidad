/**
 * Tests unitarios — Consolidador histórico ROMA.
 *
 * Usa `node:test`. Construye `ResultadoIngestaRoma` sintéticos para no
 * depender del parser; eso aísla los bugs.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  crearHistoricoVacio,
  aplicarCorte,
  aplicarCortes,
  obtenerEntrada,
  listarEntradas,
  describirHistorico,
  serializarHistorico,
  deserializarHistorico,
  agruparWarnings,
  topVentaIdsProblematicos,
  SEVERIDAD_POR_KIND,
  HISTORICO_SCHEMA_VERSION,
  type MergeWarningEnriquecido,
} from "../consolidador.js";
import type { RomaRowMerge } from "../merge-policy.js";
import type { ResultadoIngestaRoma } from "../parser-roma-mensual.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers para fixtures
// ─────────────────────────────────────────────────────────────────────────────

const d = (iso: string) => new Date(iso);

function mkCorte(opts: {
  mes: string;
  fechaCorte?: string;
  filas: RomaRowMerge[];
  archivoNombre?: string;
}): ResultadoIngestaRoma {
  // Default: el último día del mes
  const fecha = opts.fechaCorte
    ? d(opts.fechaCorte)
    : ((): Date => {
        const [y, m] = opts.mes.split("-").map(Number);
        return new Date(y, m, 0); // último día
      })();
  return {
    corte: {
      id: opts.mes,
      fecha,
      archivoNombre: opts.archivoNombre ?? `${opts.mes}.xlsx`,
      archivoSize: 1024,
      fechaCarga: new Date(),
    },
    filas: opts.filas,
    report: {
      filasTotales: opts.filas.length,
      filasProcesadas: opts.filas.length,
      filasDescartadas: 0,
      descartes: [],
      distribucionMesFechaSolicitud: [{ mes: opts.mes, filas: opts.filas.length }],
      mesDetectado: opts.mes,
      metodoDeteccion: "moda_y_max_coinciden",
      confianzaMesDeteccion: "alta",
      detalleDeteccion: {
        moda: opts.mes,
        filasEnModa: opts.filas.length,
        maxFechaSolicitud: null,
        maxFechaSolicitudMes: null,
        diasEntreModaYMax: 0,
      },
      duplicadosInternos: [],
    },
  };
}

function mkRow(opts: Partial<RomaRowMerge> & { ventaId: number; vin?: string }): RomaRowMerge {
  const base: RomaRowMerge = {
    ventaId: opts.ventaId,
    vin: opts.vin ?? `VIN${String(opts.ventaId).padStart(14, "0")}`,
    marca: "KIA",
    modelo: "SONET",
    gerencia: "KIA",
    cajon: `CJ${opts.ventaId}`,
    fSolicitud: null,
    fFactura: null,
    fInscripcion: null,
    fVenta: null,
    estado: "Pendiente",
    pasoActual: "Respuesta Jefe Sucursal",
    comentario: "",
    fETASucursal: null,
    fEstimadaEntrega: null,
    fRespuestaLogistica: null,
    fRespuestaInstalacionAcc: null,
    fETALlegadaCalc: null,
    sucursal: "KIA PLAZA OESTE",
    ventaAcc: "CON ACCESORIOS",
    varTieneLamina: "No",
  };
  return { ...base, ...opts };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("1. Histórico vacío + aplicar 1 corte → N entradas, 0 warnings", () => {
  test("3 filas nuevas → 3 entradas, 0 warnings, marca origen=corte", () => {
    const h0 = crearHistoricoVacio();
    assert.equal(h0.entradas.size, 0);
    assert.equal(h0.schemaVersion, HISTORICO_SCHEMA_VERSION);

    const corte = mkCorte({
      mes: "2026-01",
      filas: [
        mkRow({ ventaId: 1, fSolicitud: d("2026-01-10") }),
        mkRow({ ventaId: 2, fSolicitud: d("2026-01-15") }),
        mkRow({ ventaId: 3, fSolicitud: d("2026-01-20") }),
      ],
    });
    const { historico, resumen, warnings } = aplicarCorte(h0, corte);

    assert.equal(historico.entradas.size, 3);
    assert.equal(resumen.ventaIdsNuevos, 3);
    assert.equal(resumen.ventaIdsActualizados, 0);
    assert.equal(warnings.length, 0);
    for (const v of [1, 2, 3]) {
      const e = obtenerEntrada(historico, v);
      assert.ok(e);
      assert.equal(e!.corteIdOrigen, "2026-01");
      assert.equal(e!.presenteEn.length, 1);
    }
  });
});

describe("2. Mismo corte aplicado dos veces", () => {
  test("la segunda aplicación es idempotente", () => {
    const h0 = crearHistoricoVacio();
    const corte = mkCorte({
      mes: "2026-01",
      filas: [mkRow({ ventaId: 100, fSolicitud: d("2026-01-10") })],
    });
    const { historico: h1, resumen: r1 } = aplicarCorte(h0, corte);
    const { historico: h2, resumen: r2 } = aplicarCorte(h1, corte);

    assert.equal(r1.ventaIdsNuevos, 1);
    assert.equal(r2.ventaIdsNuevos, 0);
    assert.equal(r2.ventaIdsSinCambio, 1);
    // El histórico tras la segunda aplicación tiene 2 cortes registrados,
    // pero la entrada sigue con presenteEn=["2026-01"] (no se duplica).
    assert.equal(h2.entradas.size, 1);
    assert.equal(h2.cortes.length, 2);
    assert.deepEqual(h2.entradas.get(100)!.presenteEn, ["2026-01"]);
  });
});

describe("3. Cortes desordenados → warning + EVOLUTIVOS no se sobrescriben", () => {
  test("aplicar marzo después de febrero, luego enero → warning OOO", () => {
    const h0 = crearHistoricoVacio();
    const enero = mkCorte({
      mes: "2026-01",
      filas: [mkRow({ ventaId: 1, fSolicitud: d("2026-01-10"), estado: "Pendiente", fETASucursal: d("2026-01-20") })],
    });
    const marzo = mkCorte({
      mes: "2026-03",
      filas: [mkRow({ ventaId: 1, fSolicitud: d("2026-01-10"), estado: "Realizada", fETASucursal: d("2026-03-15") })],
    });

    // Aplicar marzo PRIMERO
    const { historico: h1 } = aplicarCorte(h0, marzo);
    // Luego enero (fuera de orden, fecha más antigua)
    const { historico: h2, warnings } = aplicarCorte(h1, enero);

    const oooWarnings = warnings.filter((w) => w.kind === "CORTE_ANTERIOR_OUT_OF_ORDER");
    assert.equal(oooWarnings.length, 1, "Debe emitir warning de orden");
    assert.equal(oooWarnings[0].severidad, "advertencia");

    const e = h2.entradas.get(1)!;
    assert.equal(e.row.estado, "Realizada", "EVOLUTIVO se mantiene del más reciente");
    assert.deepEqual(e.row.fETASucursal, d("2026-03-15"));
  });
});

describe("4. Conflicto INMUTABLE → severidad crítica capturada", () => {
  test("marca cambia entre cortes → warning crítico + callback", () => {
    const h0 = crearHistoricoVacio();
    const enero = mkCorte({
      mes: "2026-01",
      filas: [mkRow({ ventaId: 7, marca: "KIA", fSolicitud: d("2026-01-10") })],
    });
    const febrero = mkCorte({
      mes: "2026-02",
      filas: [mkRow({ ventaId: 7, marca: "MG", fSolicitud: d("2026-01-10") })],
    });

    const criticos: MergeWarningEnriquecido[] = [];
    const { historico: h1 } = aplicarCorte(h0, enero);
    const { historico: h2, warnings } = aplicarCorte(h1, febrero, {
      onWarningCritico: (w) => criticos.push(w),
    });

    const cWarn = warnings.filter((w) => w.kind === "INMUTABLE_CHANGED");
    assert.ok(cWarn.length >= 1);
    assert.equal(cWarn[0].severidad, "crítica");
    assert.equal(criticos.length, cWarn.length, "Callback invocado para cada crítico");
    // La marca se conserva como la primera
    assert.equal(h2.entradas.get(7)!.row.marca, "KIA");
  });
});

describe("5. STATE_REGRESSION → severidad info, no rompe nada", () => {
  test("Realizada → Anulada se aplica y se reporta info", () => {
    const h0 = crearHistoricoVacio();
    const enero = mkCorte({
      mes: "2026-01",
      filas: [mkRow({ ventaId: 10, estado: "Realizada", fSolicitud: d("2026-01-10") })],
    });
    const febrero = mkCorte({
      mes: "2026-02",
      filas: [mkRow({ ventaId: 10, estado: "Anulada", fSolicitud: d("2026-01-10") })],
    });

    const { historico: h1 } = aplicarCorte(h0, enero);
    const { historico: h2, warnings } = aplicarCorte(h1, febrero);

    const reg = warnings.filter((w) => w.kind === "STATE_REGRESSION");
    assert.equal(reg.length, 1);
    assert.equal(reg[0].severidad, "info");
    assert.equal(h2.entradas.get(10)!.row.estado, "Anulada");
  });
});

describe("6. Conteos cuadran (nuevos / actualizados / sinCambio)", () => {
  test("3 nuevos en feb cuando enero tenía 2, uno cambia, uno no, dos nuevos", () => {
    const h0 = crearHistoricoVacio();
    const enero = mkCorte({
      mes: "2026-01",
      filas: [
        mkRow({ ventaId: 1, estado: "Pendiente", fSolicitud: d("2026-01-10") }),
        mkRow({ ventaId: 2, estado: "Pendiente", fSolicitud: d("2026-01-15") }),
      ],
    });
    const febrero = mkCorte({
      mes: "2026-02",
      filas: [
        mkRow({ ventaId: 1, estado: "Realizada", fSolicitud: d("2026-01-10") }), // cambia
        mkRow({ ventaId: 2, estado: "Pendiente", fSolicitud: d("2026-01-15") }), // sin cambio
        mkRow({ ventaId: 3, estado: "Pendiente", fSolicitud: d("2026-02-05") }), // nuevo
        mkRow({ ventaId: 4, estado: "Pendiente", fSolicitud: d("2026-02-10") }), // nuevo
      ],
    });

    const { historico: h1 } = aplicarCorte(h0, enero);
    const { resumen } = aplicarCorte(h1, febrero);

    assert.equal(resumen.ventaIdsNuevos, 2);
    assert.equal(resumen.ventaIdsActualizados, 1);
    assert.equal(resumen.ventaIdsSinCambio, 1);
  });
});

describe("7. capturarProcedencia=true llena el sidecar correctamente", () => {
  test("procedencia mapea campos al corteId que los aportó", () => {
    const h0 = crearHistoricoVacio();
    const enero = mkCorte({
      mes: "2026-01",
      filas: [mkRow({ ventaId: 20, estado: "Pendiente", fSolicitud: d("2026-01-10") })],
    });
    const febrero = mkCorte({
      mes: "2026-02",
      filas: [mkRow({ ventaId: 20, estado: "Realizada", fSolicitud: d("2026-01-10"), comentario: "OK" })],
    });

    const { historico: h1 } = aplicarCorte(h0, enero, { capturarProcedencia: true });
    const { historico: h2 } = aplicarCorte(h1, febrero, { capturarProcedencia: true });

    const e = h2.entradas.get(20)!;
    assert.ok(e.procedencia, "Debe existir el sidecar");
    assert.equal(e.procedencia!.estado, "2026-02", "Estado vino del corte 2");
    assert.equal(e.procedencia!.comentario, "2026-02", "Comentario vino del corte 2");
    assert.equal(e.procedencia!.fSolicitud, "2026-01", "fSolicitud vino del corte 1 (origen)");
  });
});

describe("8. capturarProcedencia=false omite el sidecar", () => {
  test("entrada.procedencia es undefined", () => {
    const h0 = crearHistoricoVacio();
    const enero = mkCorte({
      mes: "2026-01",
      filas: [mkRow({ ventaId: 30 })],
    });
    const { historico } = aplicarCorte(h0, enero);
    assert.equal(historico.entradas.get(30)!.procedencia, undefined);
  });
});

describe("9. Serializar + deserializar es idempotente", () => {
  test("round-trip preserva entradas, fechas, cortes", () => {
    const h0 = crearHistoricoVacio();
    const enero = mkCorte({
      mes: "2026-01",
      filas: [
        mkRow({ ventaId: 1, fSolicitud: d("2026-01-10"), fETASucursal: d("2026-01-25") }),
        mkRow({ ventaId: 2, fSolicitud: d("2026-01-15"), estado: "Realizada" }),
      ],
    });
    const febrero = mkCorte({
      mes: "2026-02",
      filas: [mkRow({ ventaId: 1, fSolicitud: d("2026-01-10"), estado: "Anulada" })],
    });
    const { historico: h1 } = aplicarCorte(h0, enero, { capturarProcedencia: true });
    const { historico: h2 } = aplicarCorte(h1, febrero, { capturarProcedencia: true });

    const ser = serializarHistorico(h2);
    const json = JSON.parse(JSON.stringify(ser));
    const restored = deserializarHistorico(json);

    assert.equal(restored.entradas.size, h2.entradas.size);
    assert.equal(restored.cortes.length, h2.cortes.length);
    assert.equal(restored.schemaVersion, h2.schemaVersion);
    // Verificar entrada concreta
    const e2 = restored.entradas.get(1)!;
    assert.equal(e2.row.estado, "Anulada");
    assert.ok(e2.row.fETASucursal instanceof Date);
    assert.deepEqual(e2.row.fETASucursal, d("2026-01-25"));
    assert.equal(e2.corteIdOrigen, "2026-01");
    assert.equal(e2.corteIdEvolutivo, "2026-02");
    assert.deepEqual(e2.presenteEn, ["2026-01", "2026-02"]);
    assert.ok(e2.procedencia);
  });
});

describe("10. agruparWarnings y topVentaIdsProblematicos cuadran", () => {
  test("agrupación produce conteos correctos por severidad/categoría/campo", () => {
    const h0 = crearHistoricoVacio();
    const enero = mkCorte({
      mes: "2026-01",
      filas: [
        mkRow({ ventaId: 1, marca: "KIA", estado: "Realizada", fSolicitud: d("2026-01-10") }),
        mkRow({ ventaId: 2, marca: "MG", estado: "Realizada", fSolicitud: d("2026-01-15") }),
      ],
    });
    const febrero = mkCorte({
      mes: "2026-02",
      filas: [
        mkRow({ ventaId: 1, marca: "GEELY", estado: "Anulada", fSolicitud: d("2026-01-10") }), // conflicto marca + state regression
        mkRow({ ventaId: 2, marca: "MG", estado: "Pendiente", fSolicitud: d("2026-01-15") }),  // state regression
      ],
    });
    const { historico: h1 } = aplicarCorte(h0, enero);
    const { warnings } = aplicarCorte(h1, febrero);

    const agr = agruparWarnings(warnings);
    assert.equal(agr.total, warnings.length);
    assert.ok(agr.porSeveridad.crítica >= 1, "Debe haber al menos 1 crítica (marca cambia)");
    assert.ok(agr.porSeveridad.info >= 2, "Debe haber 2 info (regresiones)");
    assert.ok(agr.porVentaId.has(1));
    assert.ok(agr.porVentaId.has(2));

    const top = topVentaIdsProblematicos(warnings, 5);
    assert.ok(top.length >= 2);
    assert.equal(top[0].count, agr.porVentaId.get(top[0].ventaId)!.length);
  });
});

describe("11. describirHistorico calcula min/max/mediana correctos", () => {
  test("3 cortes: cobertura, ventaIdsPorCorte, mediana", () => {
    const h0 = crearHistoricoVacio();
    const cortes = [
      mkCorte({ mes: "2026-01", filas: [mkRow({ ventaId: 1, fSolicitud: d("2026-01-10") }), mkRow({ ventaId: 2, fSolicitud: d("2026-01-15") })] }),
      mkCorte({ mes: "2026-02", filas: [mkRow({ ventaId: 1, fSolicitud: d("2026-01-10") }), mkRow({ ventaId: 3, fSolicitud: d("2026-02-05") })] }),
      mkCorte({ mes: "2026-03", filas: [mkRow({ ventaId: 1, fSolicitud: d("2026-01-10") })] }),
    ];
    const { historicoFinal } = aplicarCortes(h0, cortes);

    const desc = describirHistorico(historicoFinal);
    assert.equal(desc.totalVentaIds, 3);
    assert.equal(desc.totalCortes, 3);
    // VentaID 1 está en 3 cortes, ventaId 2 en 1, ventaId 3 en 1 → cuentas [1,1,3], mediana = 1
    assert.equal(desc.cortesPorVentaId.min, 1);
    assert.equal(desc.cortesPorVentaId.max, 3);
    assert.equal(desc.cortesPorVentaId.mediana, 1);
    // ventaIdsPorCorte cuenta CUÁNTOS VentaIDs vivos están registrados en cada corte
    assert.equal(desc.ventaIdsPorCorte.get("2026-01"), 2);
    assert.equal(desc.ventaIdsPorCorte.get("2026-02"), 2);
    assert.equal(desc.ventaIdsPorCorte.get("2026-03"), 1);
    assert.ok(desc.cubrePeriodo);
  });
});

describe("12. Cobertura adicional", () => {
  test("listarEntradas ordena por ventaId asc por defecto", () => {
    const h0 = crearHistoricoVacio();
    const corte = mkCorte({
      mes: "2026-01",
      filas: [mkRow({ ventaId: 3 }), mkRow({ ventaId: 1 }), mkRow({ ventaId: 2 })],
    });
    const { historico } = aplicarCorte(h0, corte);
    const arr = listarEntradas(historico);
    assert.deepEqual(arr.map((e) => e.row.ventaId), [1, 2, 3]);
  });

  test("listarEntradas con desc=true invierte el orden", () => {
    const h0 = crearHistoricoVacio();
    const corte = mkCorte({
      mes: "2026-01",
      filas: [mkRow({ ventaId: 1 }), mkRow({ ventaId: 2 }), mkRow({ ventaId: 3 })],
    });
    const { historico } = aplicarCorte(h0, corte);
    const arr = listarEntradas(historico, { desc: true });
    assert.deepEqual(arr.map((e) => e.row.ventaId), [3, 2, 1]);
  });

  test("aplicarCorte no muta el histórico de entrada", () => {
    const h0 = crearHistoricoVacio();
    const corte = mkCorte({ mes: "2026-01", filas: [mkRow({ ventaId: 1 })] });
    aplicarCorte(h0, corte);
    assert.equal(h0.entradas.size, 0, "Histórico original sigue vacío");
    assert.equal(h0.cortes.length, 0);
  });

  test("aplicarCortes encadena correctamente", () => {
    const h0 = crearHistoricoVacio();
    const cortes = [
      mkCorte({ mes: "2026-01", filas: [mkRow({ ventaId: 1 }), mkRow({ ventaId: 2 })] }),
      mkCorte({ mes: "2026-02", filas: [mkRow({ ventaId: 3 })] }),
      mkCorte({ mes: "2026-03", filas: [mkRow({ ventaId: 4 })] }),
    ];
    const { historicoFinal, resultados } = aplicarCortes(h0, cortes);
    assert.equal(historicoFinal.entradas.size, 4);
    assert.equal(resultados.length, 3);
    assert.equal(resultados[0].resumen.ventaIdsNuevos, 2);
    assert.equal(resultados[1].resumen.ventaIdsNuevos, 1);
    assert.equal(resultados[2].resumen.ventaIdsNuevos, 1);
  });

  test("severidad por kind cubre todos los WarningKind", () => {
    const kinds: Array<keyof typeof SEVERIDAD_POR_KIND> = [
      "INMUTABLE_CHANGED",
      "INMUTABLE_MIN_DATE_CONFLICT",
      "STATE_REGRESSION",
      "NULL_OVERWRITE_PREVENTED",
      "CORTE_ANTERIOR_OUT_OF_ORDER",
    ];
    for (const k of kinds) {
      assert.ok(SEVERIDAD_POR_KIND[k], `Falta severidad para ${k}`);
    }
  });

  test("fecha preservada con null (NULL_OVERWRITE_PREVENTED) genera info, no rompe", () => {
    const h0 = crearHistoricoVacio();
    const enero = mkCorte({
      mes: "2026-01",
      filas: [mkRow({ ventaId: 50, fETASucursal: d("2026-01-20") })],
    });
    const febrero = mkCorte({
      mes: "2026-02",
      filas: [mkRow({ ventaId: 50, fETASucursal: null })],
    });
    const { historico: h1 } = aplicarCorte(h0, enero);
    const { historico: h2, warnings } = aplicarCorte(h1, febrero);

    const npw = warnings.filter((w) => w.kind === "NULL_OVERWRITE_PREVENTED");
    assert.equal(npw.length, 1);
    assert.equal(npw[0].severidad, "info");
    assert.deepEqual(h2.entradas.get(50)!.row.fETASucursal, d("2026-01-20"));
  });
});
