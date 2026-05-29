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
  calcularTimelineProceso,
  filasDeTramo,
  procesoDeCuello,
  rankingPeoresVelocidad,
  rankingPeoresCumplimiento,
  rankingPeoresCierre,
  filasCerrado,
  filasAbierto,
  calcularCoberturaProceso,
  filasConHitoFaltante,
  HITOS_POR_PROCESO,
  UMBRAL_DIAS_CLIENTE_DEMORADO,
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

// ─────────────────────────────────────────────────────────────────────────────
// 8. calcularTimelineProceso — línea de tiempo por cuello
// ─────────────────────────────────────────────────────────────────────────────

describe("8. calcularTimelineProceso", () => {
  test("procesoDeCuello mapea los 4 cuellos operacionales", () => {
    assert.equal(procesoDeCuello("Control de Negocio"), "control_negocio");
    assert.equal(procesoDeCuello("Logística"), "logistica");
    assert.equal(procesoDeCuello("Cliente"), "cliente");
    assert.equal(procesoDeCuello("Comercial"), "comercial");
    assert.equal(procesoDeCuello("Mixto"), null);
    assert.equal(procesoDeCuello("Sin información suficiente"), null);
  });

  test("Control de Negocio: 5 tramos, métricas correctas, n y sinDato bien diferenciados", () => {
    const fas = (vin: string, opts: Partial<{
      fFactura: Date | null;
      fSolicitudInscripcion: Date | null;
      fInscripcion: Date | null;
      fPatenteEnviada: Date | null;
      fPatenteRecibida: Date | null;
      fEntregaReal: Date | null;
      sucursal: string;
      marca: string;
    }>): EntradaConsolidada =>
      mkFila({
        ventaId: 0,
        vin,
        cuelloPrincipal: "Control de Negocio",
        fFactura: opts.fFactura ?? new Date(2026, 0, 1),
        fSolicitudInscripcion: opts.fSolicitudInscripcion ?? null,
        fInscripcion: opts.fInscripcion ?? null,
        fPatenteEnviada: opts.fPatenteEnviada ?? null,
        fPatenteRecibida: opts.fPatenteRecibida ?? null,
        fEntregaReal: opts.fEntregaReal ?? null,
        sucursal: opts.sucursal ?? "S1",
        marca: opts.marca ?? "KIA",
      });

    const cruce = mkCruce([
      // Caso 1: completo, todas las fechas, ciclo limpio
      fas("VIN0000000000001", {
        fFactura:              new Date(2026, 0, 1),
        fSolicitudInscripcion: new Date(2026, 0, 2),  // +1d
        fInscripcion:          new Date(2026, 0, 5),  // +3d
        fPatenteEnviada:       new Date(2026, 0, 10), // +5d
        fPatenteRecibida:      new Date(2026, 0, 12), // +2d
        fEntregaReal:          new Date(2026, 0, 20), // +8d
      }),
      // Caso 2: solo factura → solins (1d), después nada
      fas("VIN0000000000002", {
        fFactura:              new Date(2026, 0, 1),
        fSolicitudInscripcion: new Date(2026, 0, 2),
        fInscripcion:          null,
      }),
      // Caso 3: factura → solins (3d) + solins → ins (5d), sin patente
      fas("VIN0000000000003", {
        fFactura:              new Date(2026, 0, 1),
        fSolicitudInscripcion: new Date(2026, 0, 4),  // +3d
        fInscripcion:          new Date(2026, 0, 9),  // +5d
        sucursal:              "S2",
      }),
      // Caso 4: cuello Mixto (NO entra al universo del proceso)
      mkFila({
        ventaId: 0,
        vin: "VIN0000000000004",
        cuelloPrincipal: "Mixto",
      }),
    ]);
    const t = calcularTimelineProceso(cruce.filas, "control_negocio");
    assert.equal(t.proceso, "control_negocio");
    assert.equal(t.universoEnProceso, 3, "Solo 3 entran al cuello Control de Negocio");
    assert.equal(t.tramos.length, 5);

    // Tramo 1: Factura → Solicitud inscripción — todos los 3 lo tienen
    const t1 = t.tramos[0];
    assert.equal(t1.id, "cn_fac_solins");
    assert.equal(t1.n, 3);
    assert.equal(t1.sinDato, 0);
    // Casos dan deltas 1d, 1d, 3d → ordenados [1, 1, 3], mediana=1, p90=3
    assert.equal(t1.medianaDias, 1);
    assert.equal(t1.p90Dias, 3);
    assert.ok(t1.topSucursal);
    // Tramo 2: solins → inscripción — solo casos 1 y 3 lo tienen
    const t2 = t.tramos[1];
    assert.equal(t2.id, "cn_solins_ins");
    assert.equal(t2.n, 2);
    assert.equal(t2.sinDato, 1);
    // Tramo 3: ins → patente enviada — solo caso 1
    const t3 = t.tramos[2];
    assert.equal(t3.n, 1);
    assert.equal(t3.sinDato, 2);
    // Tramo 5: patente recibida → entrega — solo caso 1
    const t5 = t.tramos[4];
    assert.equal(t5.id, "cn_patrec_ent");
    assert.equal(t5.n, 1);
    assert.equal(t5.medianaDias, 8);
  });

  test("Logística: 6 tramos definidos, todos calculables sobre el cuello correcto", () => {
    const t = calcularTimelineProceso([], "logistica");
    assert.equal(t.tramos.length, 6);
    assert.deepEqual(t.tramos.map((x) => x.id), [
      "lo_sol_resp",
      "lo_resp_solbod",
      "lo_solbod_ing",
      "lo_ing_plan",
      "lo_plan_sal",
      "lo_sal_ent",
    ]);
    // Universo vacío: todos los tramos en n=0
    for (const tramo of t.tramos) {
      assert.equal(tramo.n, 0);
      assert.equal(tramo.sinDato, 0);
      assert.equal(tramo.medianaDias, null);
    }
  });

  test("Cliente: 1 tramo único", () => {
    const t = calcularTimelineProceso([], "cliente");
    assert.equal(t.tramos.length, 1);
    assert.equal(t.tramos[0].id, "cl_listo_ent");
  });

  test("Comercial: solo 1 tramo medible (Solicitud → Factura)", () => {
    const t = calcularTimelineProceso([], "comercial");
    assert.equal(t.tramos.length, 1);
    assert.equal(t.tramos[0].id, "co_sol_fac");
  });

  test("Tramo hacia entrega usa fEntregaReal estricto (no sustituye por fListoParaEntrega)", () => {
    const cruce = mkCruce([
      // Tiene fPatenteRecibida + fListoParaEntrega pero NO fEntregaReal → debe contar como sinDato
      mkFila({
        vin: "VIN0000000000005",
        cuelloPrincipal: "Control de Negocio",
        fFactura: new Date(2026, 0, 1),
        fPatenteRecibida: new Date(2026, 0, 5),
        fListoParaEntrega: new Date(2026, 0, 7),
        fEntregaReal: null,
      }),
    ]);
    const t = calcularTimelineProceso(cruce.filas, "control_negocio");
    const tEntrega = t.tramos.find((x) => x.id === "cn_patrec_ent")!;
    assert.equal(tEntrega.n, 0, "Sin fEntregaReal no debe calcularse");
    assert.equal(tEntrega.sinDato, 1);
    assert.equal(tEntrega.medianaDias, null);
  });

  test("filasDeTramo devuelve solo las filas con AMBAS fechas del tramo", () => {
    const cruce = mkCruce([
      // Caso con ambas fechas del tramo factura→solins
      mkFila({
        ventaId: 100, vin: "VIN0000000000006",
        cuelloPrincipal: "Control de Negocio",
        fFactura: new Date(2026, 0, 1), fSolicitudInscripcion: new Date(2026, 0, 2),
      }),
      // Caso solo con una fecha
      mkFila({
        ventaId: 101, vin: "VIN0000000000007",
        cuelloPrincipal: "Control de Negocio",
        fFactura: new Date(2026, 0, 1), fSolicitudInscripcion: null,
      }),
      // Caso con ambas pero en otro cuello
      mkFila({
        ventaId: 102, vin: "VIN0000000000008",
        cuelloPrincipal: "Mixto",
        fFactura: new Date(2026, 0, 1), fSolicitudInscripcion: new Date(2026, 0, 5),
      }),
    ]);
    const r = filasDeTramo(cruce.filas, "control_negocio", "cn_fac_solins");
    assert.equal(r.length, 1);
    assert.equal(r[0].ventaId, 100);
  });

  test("Tramo con n=0 mantiene métricas en null y top en null", () => {
    const cruce = mkCruce([
      mkFila({
        ventaId: 0,
        vin: "VIN0000000000009",
        cuelloPrincipal: "Cliente",
        fListoParaEntrega: null,
        fEntregaReal: null,
      }),
    ]);
    const t = calcularTimelineProceso(cruce.filas, "cliente");
    const tramo = t.tramos[0];
    assert.equal(tramo.n, 0);
    assert.equal(tramo.medianaDias, null);
    assert.equal(tramo.promedioDias, null);
    assert.equal(tramo.p90Dias, null);
    assert.equal(tramo.topSucursal, null);
    assert.equal(tramo.topMarca, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Ranking peores — métricas de problema con piso de muestra
// ─────────────────────────────────────────────────────────────────────────────

describe("9. rankingPeoresVelocidad/Cumplimiento/Cierre", () => {
  /** Helper: genera N filas idénticas excepto en sucursal/marca/vendedor y diasTotales. */
  function mkN(
    n: number,
    overrides: Partial<EntradaConsolidada>,
  ): EntradaConsolidada[] {
    return Array.from({ length: n }, (_, i) =>
      mkFila({ ventaId: 1000 + i, vin: `V${String(i).padStart(16, "0")}`, ...overrides }),
    );
  }

  test("Velocidad: ordena por mediana descendente, respeta piso de muestra n≥20", () => {
    const filas = [
      // Sucursal A: 25 casos con diasTotales=10 → mediana 10
      ...mkN(25, { sucursal: "A", diasTotales: 10 }),
      // Sucursal B: 30 casos con diasTotales=50 → mediana 50 (peor)
      ...mkN(30, { sucursal: "B", diasTotales: 50 }),
      // Sucursal C: 10 casos (debajo del piso) — no debería aparecer
      ...mkN(10, { sucursal: "C", diasTotales: 100 }),
    ];
    const top = rankingPeoresVelocidad(filas, "sucursal");
    assert.equal(top.length, 2);
    assert.equal(top[0].key, "B", "Mediana 50 = peor");
    assert.equal(top[0].metrica, 50);
    assert.equal(top[0].n, 30);
    assert.equal(top[1].key, "A");
    assert.equal(top[1].metrica, 10);
  });

  test("Velocidad: minN configurable", () => {
    const filas = [
      ...mkN(5, { sucursal: "A", diasTotales: 100 }),
      ...mkN(5, { sucursal: "B", diasTotales: 50 }),
    ];
    const top = rankingPeoresVelocidad(filas, "sucursal", { minN: 3 });
    assert.equal(top.length, 2);
    assert.equal(top[0].key, "A");
  });

  test("Cumplimiento: ordena por % completo ASCENDENTE (peor = menor %)", () => {
    const filas = [
      // A: 20 filas, 18 completo (90%)
      ...mkN(18, { sucursal: "A", nivelDocumental: "completo" }),
      ...mkN(2, { sucursal: "A", nivelDocumental: "parcial" }),
      // B: 30 filas, 6 completo (20%) — peor
      ...mkN(6, { sucursal: "B", nivelDocumental: "completo" }),
      ...mkN(24, { sucursal: "B", nivelDocumental: "minimo" }),
      // C: 10 filas (debajo del piso)
      ...mkN(10, { sucursal: "C", nivelDocumental: "minimo" }),
    ];
    const top = rankingPeoresCumplimiento(filas, "sucursal");
    assert.equal(top.length, 2);
    assert.equal(top[0].key, "B", "20% es peor que 90%");
    assert.equal(top[0].metrica, 20);
    assert.equal(top[1].key, "A");
    assert.equal(top[1].metrica, 90);
  });

  test("Cierre: solo entregados cuentan; ordena por % problemático descendente", () => {
    const filas = [
      // A: 20 entregados, 10 problemáticos (50%)
      ...mkN(10, { sucursal: "A", entregado: true, ejeCalidadCierre: "correcto" }),
      ...mkN(6, { sucursal: "A", entregado: true, ejeCalidadCierre: "huerfano" }),
      ...mkN(4, { sucursal: "A", entregado: true, ejeCalidadCierre: "inconsistente" }),
      // B: 25 entregados, 5 problemáticos (20%)
      ...mkN(20, { sucursal: "B", entregado: true, ejeCalidadCierre: "correcto" }),
      ...mkN(5, { sucursal: "B", entregado: true, ejeCalidadCierre: "huerfano" }),
      // C: solo no entregados (no debe aparecer)
      ...mkN(30, { sucursal: "C", entregado: false, ejeCalidadCierre: undefined }),
    ];
    const top = rankingPeoresCierre(filas, "sucursal");
    assert.equal(top.length, 2);
    assert.equal(top[0].key, "A", "50% peor");
    assert.equal(top[0].metrica, 50);
    assert.equal(top[0].n, 20);
    // Detalle: A tiene 6 huérfanos vs 4 inconsistentes → top razón huérfano
    assert.ok(top[0].detalle?.includes("huérfano"));
    assert.equal(top[1].key, "B");
  });

  test("Ranking por marca y por vendedor funciona igual", () => {
    const filas = [
      ...mkN(25, { marca: "KIA", vendedor: "JUAN", diasTotales: 20 }),
      ...mkN(25, { marca: "PEUGEOT", vendedor: "ANA", diasTotales: 60 }),
    ];
    const porMarca = rankingPeoresVelocidad(filas, "marca");
    assert.equal(porMarca[0].key, "PEUGEOT");
    const porVend = rankingPeoresVelocidad(filas, "vendedor");
    assert.equal(porVend[0].key, "ANA");
  });

  test("Limit cap funciona", () => {
    const filas = [
      ...mkN(20, { sucursal: "A", diasTotales: 10 }),
      ...mkN(20, { sucursal: "B", diasTotales: 20 }),
      ...mkN(20, { sucursal: "C", diasTotales: 30 }),
    ];
    const top = rankingPeoresVelocidad(filas, "sucursal", { limit: 2 });
    assert.equal(top.length, 2);
    assert.equal(top[0].key, "C");
    assert.equal(top[1].key, "B");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Fase 3 — filasCerrado / filasAbierto
// ─────────────────────────────────────────────────────────────────────────────

describe("10. filasCerrado (universo cerrado por proceso)", () => {
  test("Control de Negocio: cuello CN && entregado", () => {
    const cruce = mkCruce([
      mkFila({ ventaId: 1, vin: "V0000000000000001", cuelloPrincipal: "Control de Negocio", entregado: true }),
      mkFila({ ventaId: 2, vin: "V0000000000000002", cuelloPrincipal: "Control de Negocio", entregado: false }),
      mkFila({ ventaId: 3, vin: "V0000000000000003", cuelloPrincipal: "Logística",          entregado: true }),
      mkFila({ ventaId: 4, vin: "V0000000000000004", cuelloPrincipal: "Mixto",               entregado: true }),
    ]);
    const c = filasCerrado(cruce.filas, "control_negocio");
    assert.equal(c.length, 1);
    assert.equal(c[0].ventaId, 1);
  });

  test("Logística: cuello Log && entregado", () => {
    const cruce = mkCruce([
      mkFila({ ventaId: 1, vin: "V0000000000000001", cuelloPrincipal: "Logística",          entregado: true }),
      mkFila({ ventaId: 2, vin: "V0000000000000002", cuelloPrincipal: "Logística",          entregado: false }),
      mkFila({ ventaId: 3, vin: "V0000000000000003", cuelloPrincipal: "Control de Negocio", entregado: true }),
    ]);
    const c = filasCerrado(cruce.filas, "logistica");
    assert.equal(c.length, 1);
    assert.equal(c[0].ventaId, 1);
  });

  test("Comercial: fSolicitud && fFactura — NO exige entregado", () => {
    const cruce = mkCruce([
      // Tiene los 2 hitos, NO entregado → entra al cerrado Comercial
      mkFila({ ventaId: 1, vin: "V0000000000000001", entregado: false, fSolicitud: new Date(2026, 0, 1), fFactura: new Date(2026, 0, 5) }),
      // Tiene los 2 hitos, entregado → también entra
      mkFila({ ventaId: 2, vin: "V0000000000000002", entregado: true,  fSolicitud: new Date(2026, 0, 1), fFactura: new Date(2026, 0, 5) }),
      // Le falta fFactura → no entra
      mkFila({ ventaId: 3, vin: "V0000000000000003", entregado: false, fSolicitud: new Date(2026, 0, 1), fFactura: null }),
    ]);
    const c = filasCerrado(cruce.filas, "comercial");
    assert.equal(c.length, 2);
  });

  test("Cliente: fListoParaEntrega && fEntregaReal", () => {
    const cruce = mkCruce([
      mkFila({ ventaId: 1, vin: "V0000000000000001", fListoParaEntrega: new Date(2026, 0, 5), fEntregaReal: new Date(2026, 0, 10) }),
      mkFila({ ventaId: 2, vin: "V0000000000000002", fListoParaEntrega: new Date(2026, 0, 5), fEntregaReal: null }),
      mkFila({ ventaId: 3, vin: "V0000000000000003", fListoParaEntrega: null,                 fEntregaReal: new Date(2026, 0, 10) }),
    ]);
    const c = filasCerrado(cruce.filas, "cliente");
    assert.equal(c.length, 1);
    assert.equal(c[0].ventaId, 1);
  });

  test("Cerrado NO contamina con casos del backlog abierto", () => {
    const cruce = mkCruce([
      mkFila({ ventaId: 1, vin: "V0000000000000001", cuelloPrincipal: "Control de Negocio", entregado: true,  fPatenteRecibida: new Date(2026, 0, 5) }),
      mkFila({ ventaId: 2, vin: "V0000000000000002", cuelloPrincipal: "Control de Negocio", entregado: false, fPatenteRecibida: null, fFactura: new Date(2026, 0, 1) }),
    ]);
    const c = filasCerrado(cruce.filas, "control_negocio");
    assert.equal(c.length, 1, "El backlog no entra al universo cerrado");
    assert.equal(c[0].entregado, true);
  });
});

describe("11. filasAbierto (backlog operacional por proceso)", () => {
  test("Control de Negocio: !entregado && fFactura presente", () => {
    const cruce = mkCruce([
      // Facturado sin entrega → entra
      mkFila({ ventaId: 1, vin: "V0000000000000001", entregado: false, fFactura: new Date(2026, 0, 1) }),
      // Entregado → no entra
      mkFila({ ventaId: 2, vin: "V0000000000000002", entregado: true,  fFactura: new Date(2026, 0, 1) }),
      // Sin factura → no entra
      mkFila({ ventaId: 3, vin: "V0000000000000003", entregado: false, fFactura: null }),
    ]);
    const a = filasAbierto(cruce.filas, "control_negocio");
    assert.equal(a.length, 1);
    assert.equal(a[0].ventaId, 1);
  });

  test("Logística: incluye tieneSinSalida aunque cuello no sea Logística", () => {
    const cruce = mkCruce([
      // Cuello Mixto pero con SIN SALIDA → entra
      mkFila({ ventaId: 1, vin: "V0000000000000001", entregado: false, cuelloPrincipal: "Mixto", tieneSinSalida: true }),
      // Cuello Logística sin SIN SALIDA y sin ingreso bodega → entra (cuello)
      mkFila({ ventaId: 2, vin: "V0000000000000002", entregado: false, cuelloPrincipal: "Logística", tieneSinSalida: false }),
      // Ingreso bodega sin salida → entra
      mkFila({ ventaId: 3, vin: "V0000000000000003", entregado: false, cuelloPrincipal: "Mixto", fIngresoBodega: new Date(2026, 0, 5), fSalidaFisica: null }),
      // Entregado → no entra
      mkFila({ ventaId: 4, vin: "V0000000000000004", entregado: true,  cuelloPrincipal: "Logística" }),
    ]);
    const a = filasAbierto(cruce.filas, "logistica");
    assert.equal(a.length, 3);
    const ids = a.map((f) => f.ventaId).sort();
    assert.deepEqual(ids, [1, 2, 3]);
  });

  test("Comercial: solicitud sin factura O listo sin Si en aut/sol", () => {
    const cruce = mkCruce([
      // Solicitud sin factura → entra
      mkFila({ ventaId: 1, vin: "V0000000000000001", fSolicitud: new Date(2026, 0, 1), fFactura: null }),
      // Listo + autorización=No → entra
      mkFila({ ventaId: 2, vin: "V0000000000000002", fListoParaEntrega: new Date(2026, 0, 5), autorizacionEntrega: "No", solEntrega: "Si" }),
      // Listo + ambas Si → no entra
      mkFila({ ventaId: 3, vin: "V0000000000000003", fListoParaEntrega: new Date(2026, 0, 5), autorizacionEntrega: "Si", solEntrega: "Si" }),
    ]);
    const a = filasAbierto(cruce.filas, "comercial");
    assert.equal(a.length, 2);
    const ids = a.map((f) => f.ventaId).sort();
    assert.deepEqual(ids, [1, 2]);
  });

  test("Cliente: fListoParaEntrega && !fEntregaReal", () => {
    const cruce = mkCruce([
      // Esperando retiro → entra
      mkFila({ ventaId: 1, vin: "V0000000000000001", fListoParaEntrega: new Date(2026, 0, 5), fEntregaReal: null }),
      // Ya entregado → no entra
      mkFila({ ventaId: 2, vin: "V0000000000000002", fListoParaEntrega: new Date(2026, 0, 5), fEntregaReal: new Date(2026, 0, 10) }),
      // Sin listo → no entra
      mkFila({ ventaId: 3, vin: "V0000000000000003", fListoParaEntrega: null }),
    ]);
    const a = filasAbierto(cruce.filas, "cliente");
    assert.equal(a.length, 1);
    assert.equal(a[0].ventaId, 1);
  });

  test("Abierto NO contamina con casos cerrados (entregados)", () => {
    const cruce = mkCruce([
      mkFila({ ventaId: 1, vin: "V0000000000000001", cuelloPrincipal: "Logística", entregado: true,  tieneSinSalida: true }),
      mkFila({ ventaId: 2, vin: "V0000000000000002", cuelloPrincipal: "Logística", entregado: false, tieneSinSalida: true }),
    ]);
    const a = filasAbierto(cruce.filas, "logistica");
    assert.equal(a.length, 1, "Entregado no entra al backlog");
    assert.equal(a[0].entregado, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. calcularCoberturaProceso
// ─────────────────────────────────────────────────────────────────────────────

describe("12. calcularCoberturaProceso", () => {
  test("Control de Negocio: timelineCompleto cuenta solo filas con los 4 hitos", () => {
    const cerrados = [
      // Completo (los 4 hitos)
      mkFila({ ventaId: 1, vin: "V0000000000000001", cuelloPrincipal: "Control de Negocio", entregado: true,
        fSolicitudInscripcion: new Date(2026, 0, 1),
        fInscripcion: new Date(2026, 0, 2),
        fPatenteEnviada: new Date(2026, 0, 3),
        fPatenteRecibida: new Date(2026, 0, 4) }),
      // Le falta solicitud inscripción
      mkFila({ ventaId: 2, vin: "V0000000000000002", cuelloPrincipal: "Control de Negocio", entregado: true,
        fSolicitudInscripcion: null,
        fInscripcion: new Date(2026, 0, 2),
        fPatenteEnviada: new Date(2026, 0, 3),
        fPatenteRecibida: new Date(2026, 0, 4) }),
      // Le faltan 2 hitos (cuenta en ambos faltantes)
      mkFila({ ventaId: 3, vin: "V0000000000000003", cuelloPrincipal: "Control de Negocio", entregado: true,
        fSolicitudInscripcion: new Date(2026, 0, 1),
        fInscripcion: null,
        fPatenteEnviada: null,
        fPatenteRecibida: new Date(2026, 0, 4) }),
    ];
    const cob = calcularCoberturaProceso(cerrados, "control_negocio");
    assert.equal(cob.universoCerrado, 3);
    assert.equal(cob.timelineCompleto, 1);
    assert.equal(cob.pctTimelineCompleto, 33.33);
    // 3 hitos con faltantes=1 (orden entre ellos no garantizado por sort estable
    // cuando hay empate — verificamos por set).
    assert.equal(cob.hitosFaltantes.length, 3);
    for (const h of cob.hitosFaltantes) assert.equal(h.faltantes, 1);
    const ids = cob.hitosFaltantes.map((h) => h.id).sort();
    assert.deepEqual(ids, ["cn_inscripcion", "cn_pat_enviada", "cn_sol_ins"]);
  });

  test("Ranking de hitos faltantes ordenado desc por cantidad", () => {
    const cerrados = [
      // 3 filas sin fPatenteRecibida, 1 sin fInscripcion
      mkFila({ ventaId: 1, vin: "V0000000000000001", cuelloPrincipal: "Control de Negocio", entregado: true,
        fSolicitudInscripcion: new Date(2026, 0, 1), fInscripcion: new Date(2026, 0, 2),
        fPatenteEnviada: new Date(2026, 0, 3), fPatenteRecibida: null }),
      mkFila({ ventaId: 2, vin: "V0000000000000002", cuelloPrincipal: "Control de Negocio", entregado: true,
        fSolicitudInscripcion: new Date(2026, 0, 1), fInscripcion: new Date(2026, 0, 2),
        fPatenteEnviada: new Date(2026, 0, 3), fPatenteRecibida: null }),
      mkFila({ ventaId: 3, vin: "V0000000000000003", cuelloPrincipal: "Control de Negocio", entregado: true,
        fSolicitudInscripcion: new Date(2026, 0, 1), fInscripcion: null,
        fPatenteEnviada: new Date(2026, 0, 3), fPatenteRecibida: null }),
    ];
    const cob = calcularCoberturaProceso(cerrados, "control_negocio");
    assert.equal(cob.hitosFaltantes[0].id, "cn_pat_recibida");
    assert.equal(cob.hitosFaltantes[0].faltantes, 3);
    assert.equal(cob.hitosFaltantes[0].pctUniverso, 100);
    assert.equal(cob.hitosFaltantes[1].id, "cn_inscripcion");
    assert.equal(cob.hitosFaltantes[1].faltantes, 1);
  });

  test("Un caso con varios hitos faltantes cuenta en TODAS las filas", () => {
    const cerrados = [
      // Le faltan TODOS los 4 hitos
      mkFila({ ventaId: 1, vin: "V0000000000000001", cuelloPrincipal: "Control de Negocio", entregado: true,
        fSolicitudInscripcion: null, fInscripcion: null,
        fPatenteEnviada: null, fPatenteRecibida: null }),
    ];
    const cob = calcularCoberturaProceso(cerrados, "control_negocio");
    // 1 caso → todos los 4 hitos faltantes deben tener faltantes=1
    assert.equal(cob.hitosFaltantes.length, 4);
    for (const h of cob.hitosFaltantes) assert.equal(h.faltantes, 1);
    // La SUMA es 4, pero el universo es 1 — el texto explicativo lo aclara
    const suma = cob.hitosFaltantes.reduce((a, b) => a + b.faltantes, 0);
    assert.equal(suma, 4);
    assert.equal(cob.universoCerrado, 1);
  });

  test("Comercial: hitosFaltantes vacío porque el universo ya exige ambos hitos", () => {
    const cerrados = [
      mkFila({ ventaId: 1, vin: "V0000000000000001", fSolicitud: new Date(2026, 0, 1), fFactura: new Date(2026, 0, 5) }),
      mkFila({ ventaId: 2, vin: "V0000000000000002", fSolicitud: new Date(2026, 0, 2), fFactura: new Date(2026, 0, 6) }),
    ];
    const cob = calcularCoberturaProceso(cerrados, "comercial");
    assert.equal(cob.universoCerrado, 2);
    assert.equal(cob.timelineCompleto, 2);
    assert.equal(cob.pctTimelineCompleto, 100);
    assert.deepEqual(cob.hitosFaltantes, []);
  });

  test("Cliente: hitosFaltantes vacío (mismo caso que Comercial)", () => {
    const cerrados = [
      mkFila({ ventaId: 1, vin: "V0000000000000001", fListoParaEntrega: new Date(2026, 0, 5), fEntregaReal: new Date(2026, 0, 10) }),
    ];
    const cob = calcularCoberturaProceso(cerrados, "cliente");
    assert.equal(cob.pctTimelineCompleto, 100);
    assert.equal(cob.hitosFaltantes.length, 0);
  });

  test("Universo cerrado vacío → cobertura coherente con ceros", () => {
    const cob = calcularCoberturaProceso([], "control_negocio");
    assert.equal(cob.universoCerrado, 0);
    assert.equal(cob.timelineCompleto, 0);
    assert.equal(cob.pctTimelineCompleto, 0);
    assert.deepEqual(cob.hitosFaltantes, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. filasConHitoFaltante
// ─────────────────────────────────────────────────────────────────────────────

describe("13. filasConHitoFaltante (drill por hito)", () => {
  test("Retorna solo cerrados a los que les falta el hito específico", () => {
    const cerrados = [
      mkFila({ ventaId: 1, vin: "V0000000000000001", cuelloPrincipal: "Control de Negocio", entregado: true, fPatenteRecibida: null }),
      mkFila({ ventaId: 2, vin: "V0000000000000002", cuelloPrincipal: "Control de Negocio", entregado: true, fPatenteRecibida: new Date(2026, 0, 5) }),
      mkFila({ ventaId: 3, vin: "V0000000000000003", cuelloPrincipal: "Control de Negocio", entregado: true, fPatenteRecibida: null }),
    ];
    const r = filasConHitoFaltante(cerrados, "control_negocio", "cn_pat_recibida");
    assert.equal(r.length, 2);
    const ids = r.map((f) => f.ventaId).sort();
    assert.deepEqual(ids, [1, 3]);
  });

  test("Hito ID inexistente → []", () => {
    const cerrados = [
      mkFila({ ventaId: 1, vin: "V0000000000000001", cuelloPrincipal: "Control de Negocio", entregado: true }),
    ];
    const r = filasConHitoFaltante(cerrados, "control_negocio", "inventado");
    assert.deepEqual(r, []);
  });

  test("Drill solo opera sobre cerrados: si caller pasa universo abierto, no se filtra por modo", () => {
    // La función NO discrimina cerrado/abierto — su contrato es "el caller
    // ya pasó cerrados". Confirmamos que opera sobre lo que recibe.
    const filas = [
      mkFila({ ventaId: 1, vin: "V0000000000000001", entregado: false, fPatenteRecibida: null }),
      mkFila({ ventaId: 2, vin: "V0000000000000002", entregado: true,  fPatenteRecibida: null }),
    ];
    const r = filasConHitoFaltante(filas, "control_negocio", "cn_pat_recibida");
    assert.equal(r.length, 2, "La función no discrimina — confía en el caller");
  });

  test("Drill Logística por hito Sin salida física", () => {
    const cerrados = [
      mkFila({ ventaId: 1, vin: "V0000000000000001", cuelloPrincipal: "Logística", entregado: true, fSalidaFisica: null }),
      mkFila({ ventaId: 2, vin: "V0000000000000002", cuelloPrincipal: "Logística", entregado: true, fSalidaFisica: new Date(2026, 0, 5) }),
    ];
    const r = filasConHitoFaltante(cerrados, "logistica", "lo_salida");
    assert.equal(r.length, 1);
    assert.equal(r[0].ventaId, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Anti-regresión Fase 3
// ─────────────────────────────────────────────────────────────────────────────

describe("14. Anti-regresión Fase 3", () => {
  test("HITOS_POR_PROCESO: CN tiene 4 hitos (sin factura ni entrega real)", () => {
    const hitos = HITOS_POR_PROCESO.control_negocio;
    assert.equal(hitos.length, 4);
    const ids = hitos.map((h) => h.id).sort();
    assert.deepEqual(ids, ["cn_inscripcion", "cn_pat_enviada", "cn_pat_recibida", "cn_sol_ins"]);
    // No debe estar el hito trivial de entrega
    assert.ok(!ids.some((id) => id.includes("entrega")));
  });

  test("HITOS_POR_PROCESO: Logística tiene 6 hitos (sin entrega real)", () => {
    const hitos = HITOS_POR_PROCESO.logistica;
    assert.equal(hitos.length, 6);
    assert.ok(!hitos.some((h) => h.campo === "fEntregaReal"));
  });

  test("Backlog NO contamina cobertura (cobertura solo mira cerrados)", () => {
    // Universo COMPLETO con cerrados y abiertos
    const filas = [
      // Cerrado completo CN
      mkFila({ ventaId: 1, vin: "V0000000000000001", cuelloPrincipal: "Control de Negocio", entregado: true,
        fSolicitudInscripcion: new Date(2026, 0, 1), fInscripcion: new Date(2026, 0, 2),
        fPatenteEnviada: new Date(2026, 0, 3), fPatenteRecibida: new Date(2026, 0, 4) }),
      // Abierto CN sin patente — NO debe contar en faltantes de cobertura
      mkFila({ ventaId: 2, vin: "V0000000000000002", cuelloPrincipal: "Control de Negocio", entregado: false,
        fFactura: new Date(2026, 0, 1),
        fSolicitudInscripcion: null, fInscripcion: null,
        fPatenteEnviada: null, fPatenteRecibida: null }),
    ];
    const cerrados = filasCerrado(filas, "control_negocio");
    const cob = calcularCoberturaProceso(cerrados, "control_negocio");
    assert.equal(cob.universoCerrado, 1);
    assert.equal(cob.timelineCompleto, 1);
    assert.equal(cob.pctTimelineCompleto, 100);
    assert.equal(cob.hitosFaltantes.length, 0, "El backlog no aparece como faltante");
  });

  test("Mediana cerrada no se contamina con backlog abierto", () => {
    // Mezclo cerrados y abiertos en el universo total
    const filas = [
      // Cerrado: timeline factura→entrega computable
      mkFila({ ventaId: 1, vin: "V0000000000000001", cuelloPrincipal: "Control de Negocio", entregado: true,
        fFactura: new Date(2026, 0, 1), fEntregaReal: new Date(2026, 0, 11) }),
      // Cerrado: 20 días
      mkFila({ ventaId: 2, vin: "V0000000000000002", cuelloPrincipal: "Control de Negocio", entregado: true,
        fFactura: new Date(2026, 0, 1), fEntregaReal: new Date(2026, 0, 21) }),
      // Abierto: !entregado pero con fFactura — NO aporta a mediana cerrada
      mkFila({ ventaId: 3, vin: "V0000000000000003", cuelloPrincipal: "Control de Negocio", entregado: false,
        fFactura: new Date(2026, 0, 1), fEntregaReal: null }),
    ];
    const cerrados = filasCerrado(filas, "control_negocio");
    assert.equal(cerrados.length, 2, "Solo los 2 entregados entran al cerrado");
    // La fila abierta (ventaId=3) NO está en cerrados, por lo que no contamina nada.
    const abiertos = filasAbierto(filas, "control_negocio");
    assert.equal(abiertos.length, 1);
    assert.equal(abiertos[0].ventaId, 3);
  });

  test("UMBRAL_DIAS_CLIENTE_DEMORADO está definido y es 7 (preliminar)", () => {
    assert.equal(UMBRAL_DIAS_CLIENTE_DEMORADO, 7);
  });

  test("Cerrado de Comercial NO exige entregado — ese es el distintivo", () => {
    const filas = [
      // Tiene los 2 hitos comerciales y NO está entregado: ENTRA al cerrado Comercial
      mkFila({ ventaId: 1, vin: "V0000000000000001", entregado: false,
        fSolicitud: new Date(2026, 0, 1), fFactura: new Date(2026, 0, 5) }),
    ];
    const c = filasCerrado(filas, "comercial");
    assert.equal(c.length, 1);
    assert.equal(c[0].entregado, false);
  });

  test("Cerrado de CN/Log SÍ exige entregado", () => {
    const filas = [
      // Tiene cuello CN pero NO entregado: NO entra al cerrado CN
      mkFila({ ventaId: 1, vin: "V0000000000000001", cuelloPrincipal: "Control de Negocio", entregado: false }),
    ];
    const cn = filasCerrado(filas, "control_negocio");
    const lo = filasCerrado(filas, "logistica");
    assert.equal(cn.length, 0);
    assert.equal(lo.length, 0);
  });
});
