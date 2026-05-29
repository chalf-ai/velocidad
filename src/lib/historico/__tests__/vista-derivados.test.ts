/**
 * Tests — selectores derivados de la Vista Histórica.
 *
 * Construye un `ResultadoCruce` sintético chico y verifica:
 *  1. filtrarFilas por cada dimensión
 *  2. agregadosEje1 (velocidad)
 *  3. agregadosEje2 (cumplimiento global + por sucursal/marca/vendedor)
 *  4. agregadosEje3 (calidad cierre + huérfanos por tipo + inconsistentes por kind)
 *  5. topPorDimension
 *  6. extraerOpciones
 *  7. fingerprintGlobal
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  filtrarFilas,
  agregadosEje1,
  agregadosEje2,
  agregadosEje3,
  topPorDimension,
  extraerOpciones,
  fingerprintGlobal,
  inferirTipoHuerfano,
  FILTROS_VACIOS,
} from "../vista-derivados.js";
import type { EntradaConsolidada, ResultadoCruce } from "../cruce-roma-actas.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helper para construir una fila consolidada de prueba
// ─────────────────────────────────────────────────────────────────────────────

function mkFila(overrides: Partial<EntradaConsolidada>): EntradaConsolidada {
  const base: EntradaConsolidada = {
    ventaId: 1,
    vin: "TESTVIN0000000001",
    marca: "KIA",
    modelo: "SONET",
    sucursal: "KIA PLAZA OESTE",
    gerencia: "KIA",
    vendedor: "JUAN",
    cliente: "CLIENTE",
    valorFactura: 10_000_000,

    fSolicitud: new Date(2026, 2, 1),
    fRespuestaLogistica: null,
    fETASucursalPromesa: null,
    fEstimadaEntrega: null,
    estadoRoma: "Pendiente",
    pasoActualRoma: null,

    bodegaFisica: null,
    fIngresoBodega: null,
    fSolicitudBodega: null,
    fPlanificacionFisica: null,
    fSalidaFisica: null,
    tieneSinSalida: false,
    estadoBodega: null,
    patio: null,
    puntoEntrega: null,
    cumplimientoDespacho: null,

    fFactura: new Date(2026, 2, 5),
    fSolicitudInscripcion: null,
    fInscripcion: new Date(2026, 2, 10),
    fPatenteAdmin: null,
    fPatenteEnviada: null,
    fPatenteRecibida: new Date(2026, 2, 15),
    fPatenteEntregada: new Date(2026, 2, 25),
    autorizacionEntrega: "Si",
    solEntrega: "Si",
    nivelDocumental: "completo",
    fDocListoDerivado: new Date(2026, 2, 15),
    fuenteDocListo: "patente_recibida",

    fAutoFisicoListo: null,
    fDocumentacionLista: new Date(2026, 2, 15),
    fListoParaEntrega: null,
    fEntregaReal: new Date(2026, 2, 25),
    entregado: true,

    diasLogistica: null,
    diasControlNegocio: 10,
    diasEsperaEntrega: null,
    diasTotales: 24,

    ejeVelocidad: {
      diasTotales: 24,
      bucket: "normal",
      segmentoMasLento: "control_negocio",
    },
    ejeCumplimiento: {
      nivelDocumental: "completo",
      faltaPatenteRecibida: false,
      faltaAutorizacionEntrega: false,
      faltaSolicitudEntrega: false,
      banda: "ok",
    },
    ejeCalidadCierre: "correcto",
    cuelloPrincipal: "Mixto",

    esVentaVigente: true,
    ventaIdsMismoVin: [1],
    origenCaso: "roma_con_actas",
    mesesRoma: ["2026-03"],
    cortesActas: ["2026-03-31"],
    enRoma: true,
    enActas: true,
    enRomia: false,
    conflictos: [],
  };
  return { ...base, ...overrides };
}

function mkCruce(filas: EntradaConsolidada[]): ResultadoCruce {
  const byVentaId = new Map<number, EntradaConsolidada>();
  const byVin = new Map<string, EntradaConsolidada[]>();
  for (const f of filas) {
    if (f.ventaId !== null) byVentaId.set(f.ventaId, f);
    if (!byVin.has(f.vin)) byVin.set(f.vin, []);
    byVin.get(f.vin)!.push(f);
  }
  return {
    filas,
    byVentaId,
    byVin,
    reporte: {
      totales: {
        filas: filas.length,
        ventaIds: byVentaId.size,
        vinsUnicos: byVin.size,
        enActas: filas.filter((f) => f.enActas).length,
        enRomia: filas.filter((f) => f.enRomia).length,
        entregados: filas.filter((f) => f.entregado).length,
        huerfanosActasSinRoma: filas.filter((f) => f.origenCaso === "actas_sin_roma").length,
        huerfanosRomaSinActas: filas.filter((f) => f.origenCaso === "roma_sin_actas").length,
        vinsConMultiplesVentaId: 0,
      },
      distribucionCuello: [],
      distribucionVelocidad: { rapido: 0, normal: 0, lento: 0, muy_lento: 0, sin_datos: 0 },
      distribucionCumplimiento: { ok: 0, menor: 0, mayor: 0, no_evaluable: 0 },
      distribucionCalidadCierre: { correcto: 0, huerfano: 0, inconsistente: 0, no_evaluable: 0 },
      conflictosMateriales: {
        total: 0,
        porTipo: {
          CONFLICTO_VIN: 0,
          CONFLICTO_FFACTURA: 0,
          CONFLICTO_FINSCRIPCION: 0,
          CONFLICTO_ENTREGA: 0,
          FECHA_IMPOSIBLE_ENTREGA_ANTES_DE_SOLICITUD: 0,
          FECHA_IMPOSIBLE_ENTREGA_ANTES_DE_FACTURA: 0,
          FECHA_IMPOSIBLE_PATENTE_ANTES_DE_INSCRIPCION: 0,
          ESTADO_TERMINAL_DEGRADADO: 0,
        },
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. filtrarFilas
// ─────────────────────────────────────────────────────────────────────────────

describe("1. filtrarFilas", () => {
  const cruce = mkCruce([
    mkFila({ ventaId: 1, vin: "AAAAAAAAAAAAAAAA1", marca: "KIA", sucursal: "S1", vendedor: "JUAN", entregado: true,  ejeCalidadCierre: "correcto",     cuelloPrincipal: "Logística" }),
    mkFila({ ventaId: 2, vin: "AAAAAAAAAAAAAAAA2", marca: "KIA", sucursal: "S2", vendedor: "ANA",  entregado: false, ejeCalidadCierre: undefined,      cuelloPrincipal: "Control de Negocio" }),
    mkFila({ ventaId: 3, vin: "AAAAAAAAAAAAAAAA3", marca: "PEUGEOT", sucursal: "S1", vendedor: "JUAN", entregado: true, ejeCalidadCierre: "huerfano",  cuelloPrincipal: "Comercial" }),
    mkFila({ ventaId: 4, vin: "AAAAAAAAAAAAAAAA4", marca: "KIA", sucursal: "S3", vendedor: "ANA",  entregado: true, ejeCalidadCierre: "inconsistente", cuelloPrincipal: "Mixto" }),
  ]);

  test("sin filtros → todas", () => {
    assert.equal(filtrarFilas(cruce, FILTROS_VACIOS).length, 4);
  });

  test("filtro marca KIA → 3", () => {
    assert.equal(filtrarFilas(cruce, { ...FILTROS_VACIOS, marca: "KIA" }).length, 3);
  });

  test("filtro sucursal S1 → 2", () => {
    assert.equal(filtrarFilas(cruce, { ...FILTROS_VACIOS, sucursal: "S1" }).length, 2);
  });

  test("filtro vendedor JUAN → 2", () => {
    assert.equal(filtrarFilas(cruce, { ...FILTROS_VACIOS, vendedor: "JUAN" }).length, 2);
  });

  test("filtro entregado=si → 3", () => {
    assert.equal(filtrarFilas(cruce, { ...FILTROS_VACIOS, entregado: "si" }).length, 3);
  });

  test("filtro entregado=no → 1", () => {
    assert.equal(filtrarFilas(cruce, { ...FILTROS_VACIOS, entregado: "no" }).length, 1);
  });

  test("filtro calidadCierre=huerfano → 1", () => {
    assert.equal(filtrarFilas(cruce, { ...FILTROS_VACIOS, calidadCierre: "huerfano" }).length, 1);
  });

  test("filtro calidadCierre=no_evaluable → 1 (la no entregada)", () => {
    const r = filtrarFilas(cruce, { ...FILTROS_VACIOS, calidadCierre: "no_evaluable" });
    assert.equal(r.length, 1);
    assert.equal(r[0].entregado, false);
  });

  test("filtro cuello=Comercial → 1", () => {
    assert.equal(filtrarFilas(cruce, { ...FILTROS_VACIOS, cuelloPrincipal: "Comercial" }).length, 1);
  });

  test("combinación marca+sucursal+entregado", () => {
    const r = filtrarFilas(cruce, { ...FILTROS_VACIOS, marca: "KIA", sucursal: "S1", entregado: "si" });
    assert.equal(r.length, 1);
    assert.equal(r[0].ventaId, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. agregadosEje1 — Velocidad
// ─────────────────────────────────────────────────────────────────────────────

describe("2. agregadosEje1", () => {
  test("totales y mediana/p90 sobre diasTotales", () => {
    const cruce = mkCruce([
      mkFila({ ventaId: 1, diasTotales: 10, ejeVelocidad: { diasTotales: 10, bucket: "rapido", segmentoMasLento: "logistica" } }),
      mkFila({ ventaId: 2, diasTotales: 20, ejeVelocidad: { diasTotales: 20, bucket: "rapido", segmentoMasLento: "logistica" } }),
      mkFila({ ventaId: 3, diasTotales: 40, ejeVelocidad: { diasTotales: 40, bucket: "normal", segmentoMasLento: "control_negocio" } }),
      mkFila({ ventaId: 4, diasTotales: 100, ejeVelocidad: { diasTotales: 100, bucket: "muy_lento", segmentoMasLento: "espera_cliente" } }),
      mkFila({ ventaId: 5, diasTotales: null, ejeVelocidad: { diasTotales: null, bucket: "sin_datos", segmentoMasLento: "sin_datos" } }),
    ]);
    const a = agregadosEje1(cruce.filas);
    assert.equal(a.totalCasos, 5);
    assert.equal(a.diasTotales.nConDatos, 4);
    assert.equal(a.diasTotales.promedio, 42.5);
    assert.equal(a.diasTotales.mediana, 30);
    assert.equal(a.diasTotales.p90, 100);
    assert.equal(a.distribucionVelocidad.rapido, 2);
    assert.equal(a.distribucionVelocidad.normal, 1);
    assert.equal(a.distribucionVelocidad.muy_lento, 1);
    assert.equal(a.distribucionVelocidad.sin_datos, 1);
    assert.equal(a.distribucionSegmento.logistica, 2);
    assert.equal(a.distribucionSegmento.control_negocio, 1);
  });

  test("distribucionCuello ordenada por cantidad desc", () => {
    const cruce = mkCruce([
      mkFila({ ventaId: 1, cuelloPrincipal: "Logística" }),
      mkFila({ ventaId: 2, cuelloPrincipal: "Logística" }),
      mkFila({ ventaId: 3, cuelloPrincipal: "Logística" }),
      mkFila({ ventaId: 4, cuelloPrincipal: "Mixto" }),
      mkFila({ ventaId: 5, cuelloPrincipal: "Cliente" }),
    ]);
    const a = agregadosEje1(cruce.filas);
    assert.deepEqual(a.distribucionCuello.map((d) => d.cuello), ["Logística", "Mixto", "Cliente"]);
    assert.equal(a.distribucionCuello[0].cantidad, 3);
    assert.equal(a.distribucionCuello[0].pct, 60);
  });

  test("vacío → estructura coherente sin crash", () => {
    const a = agregadosEje1([]);
    assert.equal(a.totalCasos, 0);
    assert.equal(a.diasTotales.promedio, null);
    assert.equal(a.distribucionCuello.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. agregadosEje2 — Cumplimiento
// ─────────────────────────────────────────────────────────────────────────────

describe("3. agregadosEje2", () => {
  test("Global + desglose por sucursal/marca/vendedor", () => {
    const cruce = mkCruce([
      mkFila({ ventaId: 1, sucursal: "S1", marca: "KIA",     vendedor: "JUAN", entregado: true,  nivelDocumental: "completo", ejeCumplimiento: { nivelDocumental: "completo", faltaPatenteRecibida: false, faltaAutorizacionEntrega: false, faltaSolicitudEntrega: false, banda: "ok" } }),
      mkFila({ ventaId: 2, sucursal: "S1", marca: "KIA",     vendedor: "ANA",  entregado: true,  nivelDocumental: "parcial",  fPatenteRecibida: null, ejeCumplimiento: { nivelDocumental: "parcial",  faltaPatenteRecibida: true,  faltaAutorizacionEntrega: false, faltaSolicitudEntrega: false, banda: "menor" } }),
      mkFila({ ventaId: 3, sucursal: "S2", marca: "PEUGEOT", vendedor: "JUAN", entregado: false, nivelDocumental: "parcial",  ejeCumplimiento: { nivelDocumental: "parcial",  faltaPatenteRecibida: false, faltaAutorizacionEntrega: true,  faltaSolicitudEntrega: true,  banda: "no_evaluable" } }),
      mkFila({ ventaId: 4, sucursal: "S2", marca: "PEUGEOT", vendedor: "JUAN", entregado: true,  nivelDocumental: "minimo",  fPatenteRecibida: null, autorizacionEntrega: "No", solEntrega: null, ejeCumplimiento: { nivelDocumental: "minimo",  faltaPatenteRecibida: true,  faltaAutorizacionEntrega: true,  faltaSolicitudEntrega: true,  banda: "mayor" } }),
    ]);
    const a = agregadosEje2(cruce.filas);
    assert.equal(a.global.universo, 4);
    assert.equal(a.global.entregados, 3);
    assert.equal(a.global.noEntregados, 1);
    assert.equal(a.global.porNivelDocumental.completo, 1);
    assert.equal(a.global.porNivelDocumental.parcial, 2);
    assert.equal(a.global.porNivelDocumental.minimo, 1);
    assert.equal(a.global.porBanda.ok, 1);
    assert.equal(a.global.porBanda.menor, 1);
    assert.equal(a.global.porBanda.mayor, 1);
    assert.equal(a.global.porBanda.no_evaluable, 1);
    assert.equal(a.global.entregadosSinPatenteRecibida, 2);
    assert.equal(a.global.entregadosSinAutorizacion, 1);
    assert.equal(a.global.entregadosSinSolicitudEntrega, 1);

    const s1 = a.porSucursal.find((s) => s.sucursal === "S1")!;
    assert.equal(s1.universo, 2);
    assert.equal(s1.entregados, 2);
    const peugeot = a.porMarca.find((m) => m.marca === "PEUGEOT")!;
    assert.equal(peugeot.universo, 2);
    const juan = a.porResponsable.find((v) => v.responsable === "JUAN")!;
    assert.equal(juan.universo, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. agregadosEje3 — CalidadCierre + tipos huérfano + conflictos
// ─────────────────────────────────────────────────────────────────────────────

describe("4. agregadosEje3", () => {
  test("Distribución, huérfanos por tipo, inconsistentes por kind", () => {
    const cruce = mkCruce([
      // correcto
      mkFila({ ventaId: 1, ejeCalidadCierre: "correcto" }),
      // huérfano tipo2 (entregado sin inscripción)
      mkFila({ ventaId: 2, ejeCalidadCierre: "huerfano", entregado: true, fInscripcion: null }),
      // huérfano tipo4 (entregado sin entrega real, sin aut ni sol)
      mkFila({ ventaId: 3, ejeCalidadCierre: "huerfano", entregado: true, fInscripcion: new Date(2026, 2, 10), fEntregaReal: null, autorizacionEntrega: null, solEntrega: null }),
      // inconsistente por CONFLICTO_FFACTURA material
      mkFila({
        ventaId: 4,
        ejeCalidadCierre: "inconsistente",
        conflictos: [{ kind: "CONFLICTO_FFACTURA", esMaterial: true, detalle: "x" }],
      }),
      // inconsistente con varias kinds + un non-material (no debe contar)
      mkFila({
        ventaId: 5,
        ejeCalidadCierre: "inconsistente",
        conflictos: [
          { kind: "CONFLICTO_FINSCRIPCION", esMaterial: true, detalle: "x" },
          { kind: "CONFLICTO_FINSCRIPCION", esMaterial: false, detalle: "x" },
          { kind: "FECHA_IMPOSIBLE_ENTREGA_ANTES_DE_FACTURA", esMaterial: true, detalle: "x" },
        ],
      }),
      // no entregado → no_evaluable
      mkFila({ ventaId: 6, entregado: false, ejeCalidadCierre: undefined }),
    ]);
    const a = agregadosEje3(cruce.filas);
    assert.equal(a.distribucion.correcto, 1);
    assert.equal(a.distribucion.huerfano, 2);
    assert.equal(a.distribucion.inconsistente, 2);
    assert.equal(a.distribucion.no_evaluable, 1);
    assert.equal(a.totalHuerfanos, 2);
    assert.equal(a.totalInconsistentes, 2);
    assert.equal(a.huerfanosPorTipo.tipo2, 1);
    assert.equal(a.huerfanosPorTipo.tipo4, 1);
    assert.equal(a.inconsistentesPorConflicto.CONFLICTO_FFACTURA, 1);
    assert.equal(a.inconsistentesPorConflicto.CONFLICTO_FINSCRIPCION, 1, "Solo el material cuenta");
    assert.equal(a.inconsistentesPorConflicto.FECHA_IMPOSIBLE_ENTREGA_ANTES_DE_FACTURA, 1);
  });

  test("inferirTipoHuerfano: tipo1 (no entregado, inscripción, sin aut/sol)", () => {
    const f = mkFila({
      entregado: false,
      fInscripcion: new Date(2026, 2, 10),
      autorizacionEntrega: null,
      solEntrega: null,
      ejeCalidadCierre: undefined,
    });
    assert.equal(inferirTipoHuerfano(f), "tipo1");
  });

  test("inferirTipoHuerfano: tipo2 prioriza sobre tipo4", () => {
    const f = mkFila({
      entregado: true,
      fInscripcion: null,
      fEntregaReal: null,
      autorizacionEntrega: null,
      solEntrega: null,
    });
    assert.equal(inferirTipoHuerfano(f), "tipo2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. topPorDimension
// ─────────────────────────────────────────────────────────────────────────────

describe("5. topPorDimension", () => {
  test("Por sucursal: orden por universo, métricas correctas", () => {
    const cruce = mkCruce([
      mkFila({ ventaId: 1, sucursal: "S1", entregado: true,  diasTotales: 10, nivelDocumental: "completo" }),
      mkFila({ ventaId: 2, sucursal: "S1", entregado: true,  diasTotales: 30, nivelDocumental: "parcial" }),
      mkFila({ ventaId: 3, sucursal: "S1", entregado: false, diasTotales: null, nivelDocumental: "minimo" }),
      mkFila({ ventaId: 4, sucursal: "S2", entregado: true,  diasTotales: 20, nivelDocumental: "completo" }),
    ]);
    const top = topPorDimension(cruce.filas, "sucursal", 5);
    assert.equal(top[0].key, "S1");
    assert.equal(top[0].universo, 3);
    assert.equal(top[0].entregados, 2);
    assert.equal(top[0].pctEntregados, 66.67);
    assert.equal(top[0].pctCompleto, 33.33);
    assert.equal(top[0].diasMediana, 20);
    assert.equal(top[1].key, "S2");
  });

  test("Por marca y por vendedor", () => {
    const cruce = mkCruce([
      mkFila({ ventaId: 1, marca: "KIA",     vendedor: "JUAN" }),
      mkFila({ ventaId: 2, marca: "KIA",     vendedor: "ANA" }),
      mkFila({ ventaId: 3, marca: "PEUGEOT", vendedor: "JUAN" }),
    ]);
    const porMarca = topPorDimension(cruce.filas, "marca");
    assert.equal(porMarca[0].key, "KIA");
    assert.equal(porMarca[0].universo, 2);
    const porVendedor = topPorDimension(cruce.filas, "vendedor");
    assert.equal(porVendedor[0].key, "JUAN");
    assert.equal(porVendedor[0].universo, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. extraerOpciones
// ─────────────────────────────────────────────────────────────────────────────

describe("6. extraerOpciones", () => {
  test("Devuelve marcas/sucursales/vendedores ordenados sin duplicados ni null", () => {
    const cruce = mkCruce([
      mkFila({ ventaId: 1, marca: "PEUGEOT", sucursal: "S1", vendedor: "JUAN" }),
      mkFila({ ventaId: 2, marca: "KIA",     sucursal: "S1", vendedor: "ANA" }),
      mkFila({ ventaId: 3, marca: null,      sucursal: null, vendedor: null }),
    ]);
    const op = extraerOpciones(cruce);
    assert.deepEqual(op.marcas, ["KIA", "PEUGEOT"]);
    assert.deepEqual(op.sucursales, ["S1"]);
    assert.deepEqual(op.vendedores, ["ANA", "JUAN"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. fingerprintGlobal
// ─────────────────────────────────────────────────────────────────────────────

describe("7. fingerprintGlobal", () => {
  test("Resume totales y distribuciones clave para validación visual", () => {
    const cruce = mkCruce([
      mkFila({ ventaId: 1, vin: "V1AAAAAAAAAAAAAAA", ejeCalidadCierre: "correcto", cuelloPrincipal: "Mixto", ejeVelocidad: { diasTotales: 20, bucket: "rapido", segmentoMasLento: "logistica" }, ejeCumplimiento: { nivelDocumental: "completo", faltaPatenteRecibida: false, faltaAutorizacionEntrega: false, faltaSolicitudEntrega: false, banda: "ok" } }),
      mkFila({ ventaId: 2, vin: "V2AAAAAAAAAAAAAAA", ejeCalidadCierre: "huerfano", cuelloPrincipal: "Comercial", entregado: true, fInscripcion: null, ejeVelocidad: { diasTotales: 60, bucket: "lento", segmentoMasLento: "espera_cliente" }, ejeCumplimiento: { nivelDocumental: "minimo", faltaPatenteRecibida: false, faltaAutorizacionEntrega: false, faltaSolicitudEntrega: false, banda: "mayor" } }),
    ]);
    const fp = fingerprintGlobal(cruce);
    assert.equal(fp.totalFilas, 2);
    assert.equal(fp.ventaIdsUnicos, 2);
    assert.equal(fp.vinsUnicos, 2);
    assert.equal(fp.calidadCierre.correcto, 1);
    assert.equal(fp.calidadCierre.huerfano, 1);
    assert.equal(fp.velocidadBucket.rapido, 1);
    assert.equal(fp.velocidadBucket.lento, 1);
    assert.equal(fp.cumplimientoBanda.ok, 1);
    assert.equal(fp.cumplimientoBanda.mayor, 1);
    assert.equal(fp.cuello.length, 2);
  });
});
