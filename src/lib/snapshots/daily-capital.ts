/**
 * Snapshot diario del ESTADO VIGENTE del sistema — Tendencias persistentes.
 *
 * Regla clave: la foto representa "cómo estaba el sistema ese día", no "qué
 * archivo se cargó ese día". Por eso NO lee Excel ni reprocesa archivos:
 * consume los Snapshot vigentes (activo: true) que la app ya ingestó,
 * normalizó y dejó como fuente de verdad, y calcula con los MISMOS
 * selectores que usa el resto del sistema.
 *
 * Una fila por día (hora Chile) y por scope: TOTAL Pompeyo + cada marca
 * operacional presente en el stock vigente. Si el job corre dos veces el
 * mismo día, actualiza la foto del día — nunca duplica (unique
 * fecha+scopeTipo+marca).
 */

import { prisma } from "@/lib/prisma";
import { Fuente, Prisma, ScopeSnapshotDiario } from "@prisma/client";
import {
  calcularSGLegacyDesdePayloads,
  rehidratarFNE,
  rehidratarProvisiones,
  rehidratarSaldos,
  rehidratarStock,
} from "@/lib/historico/calcular-score-gerencial-historico";
import {
  capitalDesdePayloads,
  marcasConCapital,
} from "@/lib/historico/capital-por-corte";
import { ETIQUETA_FUENTE } from "@/lib/historico/calcular-scores-por-dia";
import type {
  ParsedExcel,
  ParsedFNE,
  ParsedProvisiones,
  ParsedSaldos,
} from "@/lib/types";

const FUENTES_CAPITAL: Fuente[] = ["BASE_STOCK", "SALDOS", "PROVISIONES", "FNE"];

/** Entrada de auditoría por fuente en la columna JSON `cobertura`. */
export interface CoberturaVigente {
  fuente: Fuente;
  etiqueta: string;
  presente: boolean;
  /** id del Snapshot vivo usado. null si la fuente no estaba vigente. */
  snapshotId: string | null;
  nombre: string | null;
  fechaCorte: string | null; // ISO
  cargadoEl: string | null; // ISO (createdAt del Snapshot vivo)
}

export interface ResumenGeneracion {
  fecha: string; // YYYY-MM-DD (día Chile)
  scopes: number;
  marcas: string[];
  cobertura: CoberturaVigente[];
  eliminadosStale: number;
  /** true si la foto usó Provisiones/FNE en vivo posteados por el Job Amazon. */
  romaEnVivo: boolean;
}

/**
 * Datos de ROMA EN VIVO que el Job Amazon puede postear (ROMA no es alcanzable
 * desde Railway). Si se entrega, OVERRIDE las Provisiones/FNE del scope TOTAL
 * (ROMA entrega totales, no por marca). Si no se entrega, se usan los snapshots
 * activos (fuente Excel validada equivalente a ROMA). Forward-compatible.
 */
export interface RomaPosted {
  /** Provisiones >90d Venta desde ROMA vivo. */
  provisiones?: { casos: number; monto: number; agingMax?: number | null };
  /** FNE operativo desde ROMA vivo (Reporte Actas, Acta=NO, FechaFactura≥2026-01-01). */
  fne?: { unidades: number; monto: number };
}

/** Día actual en America/Santiago, normalizado a 00:00 UTC (columna DATE). */
export function fechaHoySantiago(): { ymd: string; fecha: Date } {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
  }).format(new Date());
  return { ymd, fecha: new Date(`${ymd}T00:00:00.000Z`) };
}

interface PayloadsVigentes {
  stock: ParsedExcel | null;
  saldos: ParsedSaldos | null;
  provisiones: ParsedProvisiones | null;
  fne: ParsedFNE | null;
  cobertura: CoberturaVigente[];
}

async function cargarPayloadsVigentes(): Promise<PayloadsVigentes> {
  const vigentes = await Promise.all(
    FUENTES_CAPITAL.map((fuente) =>
      prisma.snapshot.findFirst({
        where: { fuente, activo: true },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          nombre: true,
          fechaCorte: true,
          createdAt: true,
          payload: true,
        },
      }),
    ),
  );

  const porFuente = new Map(FUENTES_CAPITAL.map((f, i) => [f, vigentes[i]]));
  const cobertura: CoberturaVigente[] = FUENTES_CAPITAL.map((fuente) => {
    const s = porFuente.get(fuente) ?? null;
    return {
      fuente,
      etiqueta: ETIQUETA_FUENTE[fuente] ?? fuente,
      presente: s !== null && s.payload != null,
      snapshotId: s?.id ?? null,
      nombre: s?.nombre ?? null,
      fechaCorte: s?.fechaCorte?.toISOString() ?? null,
      cargadoEl: s?.createdAt.toISOString() ?? null,
    };
  });

  const payloadDe = (f: Fuente) => {
    const s = porFuente.get(f);
    return s?.payload != null ? s.payload : null;
  };
  const stockPayload = payloadDe("BASE_STOCK");
  const saldosPayload = payloadDe("SALDOS");
  const provisionesPayload = payloadDe("PROVISIONES");
  const fnePayload = payloadDe("FNE");

  return {
    stock: stockPayload ? rehidratarStock(stockPayload) : null,
    saldos: saldosPayload ? rehidratarSaldos(saldosPayload) : null,
    provisiones: provisionesPayload ? rehidratarProvisiones(provisionesPayload) : null,
    fne: fnePayload ? rehidratarFNE(fnePayload) : null,
    cobertura,
  };
}

/**
 * Genera (o reemplaza) el snapshot diario de hoy para TOTAL + cada marca.
 * Idempotente por día: upsert sobre [fecha, scopeTipo, marca] y limpieza de
 * scopes de marca que ya no existan en el stock vigente.
 */
export async function generarDailyCapitalSnapshot(
  opts: { roma?: RomaPosted } = {},
): Promise<ResumenGeneracion> {
  const { ymd, fecha } = fechaHoySantiago();
  const { stock, saldos, provisiones, fne, cobertura } = await cargarPayloadsVigentes();
  let romaEnVivo = false;

  const marcas = marcasConCapital({ stock, saldos, provisiones, fne });
  const scopes: { scopeTipo: ScopeSnapshotDiario; marca: string }[] = [
    { scopeTipo: "TOTAL", marca: "" },
    ...marcas.map((m) => ({ scopeTipo: "MARCA" as ScopeSnapshotDiario, marca: m })),
  ];

  const fuentesPresentes = cobertura.filter((c) => c.presente).map((c) => c.fuente);
  const fuentesFaltantes = cobertura.filter((c) => !c.presente).map((c) => c.fuente);
  const coberturaJson = JSON.parse(JSON.stringify(cobertura));

  for (const scope of scopes) {
    const marcaFiltro = scope.scopeTipo === "MARCA" ? scope.marca : null;

    const capital = capitalDesdePayloads({
      stock,
      saldos,
      provisiones,
      fne,
      marca: marcaFiltro,
    });

    // ROMA EN VIVO (Job Amazon): override de Provisiones/FNE SOLO en TOTAL
    // (ROMA entrega totales, no por marca). Sin ROMA → snapshots activos.
    const usarRoma = scope.scopeTipo === "TOTAL" && opts.roma != null;
    if (usarRoma) romaEnVivo = true;
    const provComp =
      usarRoma && opts.roma!.provisiones
        ? { unidades: opts.roma!.provisiones.casos, monto: opts.roma!.provisiones.monto }
        : capital.provisiones90;
    const provAgingMax =
      usarRoma && opts.roma!.provisiones
        ? opts.roma!.provisiones.agingMax ?? null
        : capital.provisionesAgingMax;
    const fneComp =
      usarRoma && opts.roma!.fne
        ? { unidades: opts.roma!.fne.unidades, monto: opts.roma!.fne.monto }
        : capital.fne;

    // Score Gerencial legacy: exige las 4 fuentes vigentes. Con menos, null
    // (misma política que el histórico — no se calculan parciales).
    // FUENTE ÚNICA: este score + su descomposición es lo que muestran TANTO
    // /score-gerencial (último punto) como /tendencias (serie). Nadie recalcula
    // por su lado. En TOTAL con ROMA-vivo, I2 usa la Provisión ROMA (override).
    let scoreGerencial: number | null = null;
    let scoreComponentes: Prisma.InputJsonValue | undefined;
    if (fuentesFaltantes.length === 0) {
      const sg = calcularSGLegacyDesdePayloads({
        stock: stock!,
        fne: fne!,
        saldos: saldos!,
        provisiones: provisiones!,
        marca: marcaFiltro,
        fuentesPresentes,
        fuentesFaltantes: [],
        provisionesOverride:
          usarRoma && opts.roma!.provisiones
            ? {
                casos: opts.roma!.provisiones.casos,
                monto: opts.roma!.provisiones.monto,
              }
            : undefined,
      });
      scoreGerencial = sg.score;
      if (sg.estado != null && sg.indicadores != null) {
        scoreComponentes = {
          estado: sg.estado,
          indicadores: sg.indicadores,
        } as unknown as Prisma.InputJsonValue;
      }
    }

    // Las 4 métricas OFICIALES (fuente única capital-trabajo.ts). El total es
    // la suma de los montos presentes — mismo capital que pondera Score.
    const montosPresentes = [
      capital.stockPagado?.monto,
      capital.saldosT3?.monto,
      capital.creditoPompeyo15?.monto,
      provComp?.monto,
    ].filter((m): m is number => m != null);
    const capitalTrabajoTotal =
      montosPresentes.length > 0 ? montosPresentes.reduce((a, b) => a + b, 0) : null;

    const datos = {
      scoreGerencial,
      // Descomposición canónica del score (estado + 4 indicadores). FUENTE ÚNICA
      // para /score-gerencial y /tendencias. DbNull si el score no se calculó.
      scoreComponentes: scoreComponentes ?? Prisma.DbNull,
      // Reservados — se llenan cuando exista su motor server-side.
      scoreCapital: null,
      scoreCumplimientoOperacional: null,
      scoreVelocidad: null,
      stockPagadoUnidades: capital.stockPagado?.unidades ?? null,
      stockPagadoMonto: capital.stockPagado?.monto ?? null,
      // columna `saldos*` ahora porta Saldos Vehículo T3+ (definición oficial).
      saldosUnidades: capital.saldosT3?.unidades ?? null,
      saldosMonto: capital.saldosT3?.monto ?? null,
      // columna `provisiones*` ahora porta Provisiones >90 días (definición oficial).
      provisionesUnidades: provComp?.unidades ?? null,
      provisionesMonto: provComp?.monto ?? null,
      // Crédito Pompeyo >15 días (cuarta métrica oficial — columnas nuevas).
      cpUnidades: capital.creditoPompeyo15?.unidades ?? null,
      cpMonto: capital.creditoPompeyo15?.monto ?? null,
      // `bonos*` DEPRECADO (no es una de las 4 oficiales) — se deja de poblar.
      bonosUnidades: null,
      bonosMonto: null,
      capitalTrabajoTotal,
      // ── PR 2 · métricas oficiales nuevas (persistencia histórica explícita) ──
      cajaComercialUnidades: capital.cajaComercial?.unidades ?? null,
      cajaComercialMonto: capital.cajaComercial?.monto ?? null,
      cajaTotalUnidades: capital.cajaTotal?.unidades ?? null,
      cajaTotalMonto: capital.cajaTotal?.monto ?? null,
      testCarUnidades: capital.testCars?.unidades ?? null,
      testCarMonto: capital.testCars?.monto ?? null,
      autosCompaniaUnidades: capital.autosCompania?.unidades ?? null,
      autosCompaniaMonto: capital.autosCompania?.monto ?? null,
      judicialUnidades: capital.judicial?.unidades ?? null,
      judicialMonto: capital.judicial?.monto ?? null,
      fneUnidades: fneComp?.unidades ?? null,
      fneMonto: fneComp?.monto ?? null,
      provisionesAgingMax: provAgingMax ?? null,
      cobertura: coberturaJson,
    };

    await prisma.dailyCapitalSnapshot.upsert({
      where: {
        fecha_scopeTipo_marca: {
          fecha,
          scopeTipo: scope.scopeTipo,
          marca: scope.marca,
        },
      },
      update: datos,
      create: { fecha, scopeTipo: scope.scopeTipo, marca: scope.marca, ...datos },
    });
  }

  // Reemplazo limpio del día: si una marca dejó de existir en el stock
  // vigente respecto a una corrida anterior de HOY, su fila queda stale.
  const { count: eliminadosStale } = await prisma.dailyCapitalSnapshot.deleteMany({
    where: {
      fecha,
      scopeTipo: "MARCA",
      marca: { notIn: marcas.length > 0 ? marcas : [""] },
    },
  });

  return { fecha: ymd, scopes: scopes.length, marcas, cobertura, eliminadosStale, romaEnVivo };
}

