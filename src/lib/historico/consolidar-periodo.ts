/**
 * Histórico Fase 1b · orquestador de consolidación de un período.
 *
 * Flujo:
 *   1) Buscar OperationalSnapshot del período.
 *      Si no existe → nada que consolidar (Fase 1a aún no lo creó).
 *   2) Localizar archivos GANADORES (mayor prioridadCierre) por fuente
 *      dentro de SnapshotHistoricoArchivo del período.
 *   3) Re-hidratar payloads JSONB → estructuras tipadas. Resucita Dates
 *      ISO y reconstruye Map.vinsExtra del Stock.
 *   4) Ejecutar extraer1bA() para obtener KPIs + warnings + parche JSON.
 *   5) UPDATE el snapshot:
 *        · si status="draft" → update directo
 *        · si status="closed" → crear snapshotType="correction" con
 *          version incrementada (NO sobrescribir el cerrado)
 *
 * Idempotencia: misma data de entrada → mismo output. Si los KPIs no
 * cambiaron, la fila queda igual salvo `lastRecalculatedAt` y `version`.
 *
 * NUNCA debe romper el flujo de ingesta. Si falla, el caller captura
 * y sigue (mismo patrón que persistirHistorico).
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { extraer1bA } from "./extraer-1b-a";
import { extraer1bB } from "./extraer-1b-b";
import { extraer1bC } from "./extraer-1b-c";
import { atribuirVariacion } from "./atribucion-delta";
import type { ScoreResult } from "./extraer-1b-b";
import type {
  ParsedExcel,
  ParsedFNE,
  ParsedProvisiones,
  ParsedSaldos,
} from "../types";

// ────────────────────────────────────────────────────────────────────
// Helpers de re-hidratación (server-safe, no dependen de "use client")
// ────────────────────────────────────────────────────────────────────

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

/** Resucita recursivamente strings ISO 8601 → Date. Idempotente. */
function reviveDates<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    if (ISO_DATE_RE.test(obj)) {
      const d = new Date(obj);
      if (!Number.isNaN(d.getTime())) return d as unknown as T;
    }
    return obj;
  }
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) {
    return obj.map((x) => reviveDates(x)) as unknown as T;
  }
  if (typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = reviveDates(v);
    }
    return out as T;
  }
  return obj;
}

/**
 * Rehidrata el payload Stock: reconstruye Map.vinsExtra desde array de
 * entries (el cliente lo serializa con `serializeStockPayload`).
 */
function rehidratarStock(payload: unknown): ParsedExcel | null {
  if (!payload || typeof payload !== "object") return null;
  const revived = reviveDates(payload) as ParsedExcel & { vinsExtra: unknown };
  const ve = revived.vinsExtra;
  if (Array.isArray(ve)) {
    revived.vinsExtra = new Map(ve as Array<[string, unknown]>) as ParsedExcel["vinsExtra"];
  } else if (!(ve instanceof Map)) {
    revived.vinsExtra = new Map();
  }
  return revived as ParsedExcel;
}

function rehidratarFNE(payload: unknown): ParsedFNE | null {
  if (!payload || typeof payload !== "object") return null;
  return reviveDates(payload) as ParsedFNE;
}

function rehidratarSaldos(payload: unknown): ParsedSaldos | null {
  if (!payload || typeof payload !== "object") return null;
  return reviveDates(payload) as ParsedSaldos;
}

function rehidratarProvisiones(payload: unknown): ParsedProvisiones | null {
  if (!payload || typeof payload !== "object") return null;
  return reviveDates(payload) as ParsedProvisiones;
}

// ────────────────────────────────────────────────────────────────────
// Resultado público
// ────────────────────────────────────────────────────────────────────

export interface ConsolidarPeriodoResult {
  ok: boolean;
  snapshotPeriod: string;
  /** Lista de KPIs efectivamente llenados (no null). */
  kpisLlenados: string[];
  /** Lista de KPIs que quedaron null porque faltó fuente. */
  kpisNull: string[];
  /** Si el snapshot estaba 'closed' y se creó correction. */
  correctionCreada: boolean;
  warnings: string[];
  error?: string;
}

// ────────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────────

export async function consolidarPeriodo(
  snapshotPeriod: string,
): Promise<ConsolidarPeriodoResult> {
  const baseResult: Omit<ConsolidarPeriodoResult, "ok"> = {
    snapshotPeriod,
    kpisLlenados: [],
    kpisNull: [],
    correctionCreada: false,
    warnings: [],
  };

  // 1) Localizar el OperationalSnapshot del período (preferir monthly)
  const snapshot = await prisma.operationalSnapshot.findFirst({
    where: { snapshotPeriod, snapshotType: "monthly" },
  });
  if (!snapshot) {
    return {
      ...baseResult,
      ok: false,
      error: "OperationalSnapshot monthly del período no existe (Fase 1a no lo creó)",
    };
  }

  // 2) Archivos ganadores por fuente.
  //
  // El payload se persistió en SnapshotHistoricoArchivo a partir de la
  // segunda iteración de Fase 1a. Para archivos cargados antes de esa
  // mejora, hacemos FALLBACK: cruzar por hashSha256 contra Snapshot
  // (tabla vivo) y leer el payload de ahí. Idéntico contenido (hash es
  // el mismo). El fallback se loggea para auditoría.
  const fuentes = ["BASE_STOCK", "SALDOS", "FNE", "PROVISIONES"] as const;
  const ganadores: Record<
    string,
    { payload: unknown; nombre: string; viaFallback: boolean } | null
  > = {
    BASE_STOCK: null,
    SALDOS: null,
    FNE: null,
    PROVISIONES: null,
  };
  // Acumular nombres de archivos cuyo payload no se pudo recuperar
  // (archivo histórico sin payload Y sin Snapshot vivo con el MISMO nombre).
  const sinPayload: { fuente: string; nombre: string }[] = [];

  for (const f of fuentes) {
    // Buscar TODOS los archivos del período y elegir el ganador.
    // Criterio: mayor prioridadCierre. Si empata, preferir el que tenga
    // payload guardado (esto destraba escenarios donde existían registros
    // viejos sin payload de versiones anteriores de Fase 1a).
    const archivos = await prisma.snapshotHistoricoArchivo.findMany({
      where: { fuente: f, snapshotPeriod },
      orderBy: [{ prioridadCierre: "desc" }, { snapshotDate: "desc" }],
      select: { payload: true, nombreOriginal: true, hashSha256: true, prioridadCierre: true },
    });
    if (archivos.length === 0) continue;
    const maxPrio = archivos[0].prioridadCierre;
    const conMaxPrio = archivos.filter((a) => a.prioridadCierre === maxPrio);
    // Entre los empatados, el primero con payload no null gana.
    const archivo = conMaxPrio.find((a) => a.payload != null) ?? conMaxPrio[0];
    let payload: unknown = archivo.payload;
    let viaFallback = false;
    if (payload == null) {
      // Fallback estricto: SOLO match por nombre exacto con Snapshot vivo.
      // Si no hay match, payload queda null y se reporta como sin payload
      // — JAMÁS sustituir por otro Snapshot vivo de la fuente, eso sería
      // inventar datos del período.
      const vivoPorNombre = await prisma.snapshot.findFirst({
        where: { fuente: f, nombre: archivo.nombreOriginal },
        orderBy: { createdAt: "desc" },
        select: { payload: true },
      });
      if (vivoPorNombre?.payload != null) {
        payload = vivoPorNombre.payload;
        viaFallback = true;
      } else {
        sinPayload.push({ fuente: String(f), nombre: archivo.nombreOriginal });
        continue;
      }
    }
    ganadores[f] = { payload, nombre: archivo.nombreOriginal, viaFallback };
  }

  // 3) Re-hidratar
  const stock = rehidratarStock(ganadores.BASE_STOCK?.payload);
  const fne = rehidratarFNE(ganadores.FNE?.payload);
  const saldos = rehidratarSaldos(ganadores.SALDOS?.payload);
  const provisiones = rehidratarProvisiones(ganadores.PROVISIONES?.payload);

  // Anotar fallbacks por hash (payload reconstruido desde Snapshot vivo)
  const fallbacks: string[] = [];
  for (const [fuente, g] of Object.entries(ganadores)) {
    if (g?.viaFallback) fallbacks.push(fuente);
  }
  const warningsOrquestador: string[] = [];
  if (fallbacks.length > 0) {
    warningsOrquestador.push(
      `1b-A: payload reconstruido desde Snapshot vivo (fallback por nombre exacto) para: ${fallbacks.join(", ")}. Ingestas futuras serán autocontenidas.`,
    );
  }
  for (const sp of sinPayload) {
    warningsOrquestador.push(
      `1b-A: payload NO disponible para ${sp.fuente} ("${sp.nombre}"). Archivo histórico sin payload y sin Snapshot vivo con el mismo nombre. Re-subir el archivo para autocompletar.`,
    );
  }

  // 4) Extraer KPIs · usamos snapshotDate como "hoy" para que la fotografía
  //    sea reproducible y no dependa de la fecha en que corre el motor.
  const { kpis, warnings: warningsExtractorRaw, scoreComponentesPatch, contexto } = extraer1bA({
    stock,
    fne,
    saldos,
    provisiones,
    hoy: snapshot.snapshotDate,
  });
  const warningsExtractor = [...warningsOrquestador, ...warningsExtractorRaw];

  // 4b) Fase 1b-B · Score Capital + Score Gerencial.
  //
  // Para G5 (reincidencia) leemos vinsEnAlertaCritAlta del período N-1.
  // Buscamos el snapshot monthly inmediatamente anterior por snapshotDate
  // y lo extraemos del scoreComponentes JSON que persistimos abajo.
  const previo = await prisma.operationalSnapshot.findFirst({
    where: {
      snapshotType: "monthly",
      snapshotDate: { lt: snapshot.snapshotDate },
    },
    orderBy: { snapshotDate: "desc" },
    select: {
      scoreComponentes: true,
      snapshotPeriod: true,
      aging180MasUnidades: true,
    },
  });
  let vinsCritAltaPrevio: Set<string> | null = null;
  let aging180UnidadesGlobalPrevio: number | null = null;
  let aging180UnidadesPorMarcaPrevio: Record<string, number> | null = null;
  let scoreCapitalPrevio: ScoreResult | null = null;
  let scoreGerencialPrevio: ScoreResult | null = null;
  let scoreVelocidadPrevio: ScoreResult | null = null;
  if (previo) {
    aging180UnidadesGlobalPrevio = previo.aging180MasUnidades ?? null;
    if (previo.scoreComponentes) {
      const prev = previo.scoreComponentes as Record<string, unknown>;
      const fase1bB = prev.fase1bB as Record<string, unknown> | undefined;
      const vinsArr = fase1bB?.vinsEnAlertaCritAlta;
      if (Array.isArray(vinsArr)) {
        vinsCritAltaPrevio = new Set(vinsArr as string[]);
      }
      // ScoreResults previos para atribución delta
      const sc = (fase1bB?.scoreCapital as Record<string, unknown> | undefined)?.global;
      const sg = (fase1bB?.scoreGerencial as Record<string, unknown> | undefined)?.global;
      if (sc) scoreCapitalPrevio = sc as ScoreResult;
      if (sg) scoreGerencialPrevio = sg as ScoreResult;

      const fase1bC = prev.fase1bC as Record<string, unknown> | undefined;
      const sv = (fase1bC?.scoreVelocidad as Record<string, unknown> | undefined)?.global;
      if (sv) scoreVelocidadPrevio = sv as ScoreResult;
      const porMarcaAging = fase1bC?.aging180UnidadesPorMarca;
      if (porMarcaAging && typeof porMarcaAging === "object") {
        aging180UnidadesPorMarcaPrevio = porMarcaAging as Record<string, number>;
      }
    }
  }

  // Bucket de KPIs llenos vs null para auditoría — incluye 1b-B
  const kpisLlenados: string[] = [];
  const kpisNull: string[] = [];
  for (const [k, v] of Object.entries(kpis)) {
    if (v === null) kpisNull.push(k);
    else kpisLlenados.push(k);
  }

  let scoreCapital: number | null = null;
  let scoreGerencial: number | null = null;
  let scoreComponentesPatchB: Record<string, unknown> = {};
  let marcasConBrechas1bB: number | null = null;

  // Solo correr 1b-B si tenemos vehículos cruzados (sin stock no hay nada).
  if (contexto.vus.length > 0) {
    try {
      const res1bB = extraer1bB({
        contexto,
        vinsEnAlertaCritAltaPrevio: vinsCritAltaPrevio,
      });
      scoreCapital = res1bB.scoreCapitalGlobal.score;
      scoreGerencial = res1bB.scoreGerencialGlobal.score;
      marcasConBrechas1bB = res1bB.marcasConBrechas;

      // Listo: warnings 1b-B se mergean
      for (const w of res1bB.warnings) warningsExtractor.push(`1b-B: ${w}`);
      for (const w of res1bB.scoreCapitalGlobal.warnings) {
        warningsExtractor.push(`1b-B/SC global: ${w}`);
      }
      for (const w of res1bB.scoreGerencialGlobal.warnings) {
        warningsExtractor.push(`1b-B/SG global: ${w}`);
      }

      // Track en bucket de llenos/null
      if (scoreCapital === null) kpisNull.push("scoreCapital");
      else kpisLlenados.push("scoreCapital");
      if (scoreGerencial === null) kpisNull.push("scoreGerencial");
      else kpisLlenados.push("scoreGerencial");

      scoreComponentesPatchB = {
        fase1bB: {
          consolidadoAt: new Date().toISOString(),
          scoreCapital: {
            global: res1bB.scoreCapitalGlobal,
            porMarca: res1bB.scoreCapitalPorMarca,
          },
          scoreGerencial: {
            global: res1bB.scoreGerencialGlobal,
            porMarca: res1bB.scoreGerencialPorMarca,
          },
          marcasConBrechas: res1bB.marcasConBrechas,
          marcasBajoUmbral: res1bB.marcasBajoUmbral,
          // Persistido para que el siguiente período lo lea como N-1 en G5.
          vinsEnAlertaCritAlta: res1bB.vinsEnAlertaCritAlta,
          tienePrevio: vinsCritAltaPrevio !== null,
        },
      };
    } catch (e) {
      warningsExtractor.push(
        `1b-B falló: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } else {
    warningsExtractor.push("1b-B: sin VUs (BASE_STOCK ausente) → scores omitidos");
  }

  // Actualizar `marcasConBrechas` del 1b-A con el cálculo real de 1b-B
  if (marcasConBrechas1bB !== null) {
    kpis.marcasConBrechas = marcasConBrechas1bB;
    const idx = kpisNull.indexOf("marcasConBrechas");
    if (idx >= 0) {
      kpisNull.splice(idx, 1);
      kpisLlenados.push("marcasConBrechas");
    }
  }

  // Inyectar scoreCapital y scoreGerencial en kpis para que mapKpisToFields
  // los persista en las columnas correspondientes.
  kpis.scoreCapital = scoreCapital;
  kpis.scoreGerencial = scoreGerencial;

  // ── Fase 1b-C · Score Velocidad + atribución delta ──────────────
  let scoreVelocidad: number | null = null;
  let scoreComponentesPatchC: Record<string, unknown> = {};
  let scoreCapitalActual: ScoreResult | null = null;
  let scoreGerencialActual: ScoreResult | null = null;
  let scoreVelocidadActual: ScoreResult | null = null;

  if (contexto.vus.length > 0) {
    // Reextraer 1b-B una segunda vez NO — ya tenemos los resultados en patch.
    // Pero necesito los objetos para atribución. Los recuperamos del patch.
    const fase1bB = scoreComponentesPatchB.fase1bB as
      | Record<string, unknown>
      | undefined;
    const sc = fase1bB
      ? (fase1bB.scoreCapital as Record<string, unknown>).global
      : null;
    const sg = fase1bB
      ? (fase1bB.scoreGerencial as Record<string, unknown>).global
      : null;
    if (sc) scoreCapitalActual = sc as ScoreResult;
    if (sg) scoreGerencialActual = sg as ScoreResult;

    try {
      const res1bC = extraer1bC({
        contexto,
        aging180UnidadesGlobalPrevio,
        aging180UnidadesPorMarcaPrevio,
      });
      scoreVelocidad = res1bC.scoreVelocidadGlobal.score;
      scoreVelocidadActual = res1bC.scoreVelocidadGlobal;

      for (const w of res1bC.warnings) warningsExtractor.push(`1b-C: ${w}`);
      for (const w of res1bC.scoreVelocidadGlobal.warnings) {
        warningsExtractor.push(`1b-C/SV global: ${w}`);
      }

      if (scoreVelocidad === null) kpisNull.push("scoreVelocidad");
      else kpisLlenados.push("scoreVelocidad");

      // ── Atribución delta sobre los 3 scores ──
      const atribucionCapital = atribuirVariacion(
        scoreCapitalActual as ScoreResult,
        scoreCapitalPrevio,
      );
      const atribucionGerencial = atribuirVariacion(
        scoreGerencialActual as ScoreResult,
        scoreGerencialPrevio,
      );
      const atribucionVelocidad = atribuirVariacion(
        scoreVelocidadActual,
        scoreVelocidadPrevio,
      );

      // Construir map aging180 por marca para el siguiente período
      const aging180PorMarcaActual: Record<string, number> = {};
      for (const vu of contexto.vus) {
        if (!vu.enStockActivo) continue;
        if ((vu.diasStock ?? 0) <= 180) continue;
        const m = (vu.marca ?? vu.marcaOriginadora ?? "SIN MARCA").toUpperCase();
        aging180PorMarcaActual[m] = (aging180PorMarcaActual[m] ?? 0) + 1;
      }

      scoreComponentesPatchC = {
        fase1bC: {
          consolidadoAt: new Date().toISOString(),
          scoreVelocidad: {
            global: res1bC.scoreVelocidadGlobal,
            porMarca: res1bC.scoreVelocidadPorMarca,
          },
          aging180UnidadesPorMarca: aging180PorMarcaActual,
          atribucionDelta: {
            capital: atribucionCapital,
            gerencial: atribucionGerencial,
            velocidad: atribucionVelocidad,
          },
          tienePrevio: previo !== null,
        },
      };

      if (!previo) {
        warningsExtractor.push(
          "1b-C: período N-1 inexistente → atribución delta = null en los 3 scores",
        );
      }
    } catch (e) {
      warningsExtractor.push(
        `1b-C falló: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } else {
    warningsExtractor.push("1b-C: sin VUs → score velocidad omitido");
  }

  kpis.scoreVelocidad = scoreVelocidad;

  // 5) Merge del scoreComponentes existente (si lo había) con los parches 1bA, 1bB y 1bC
  const existenteJson = (snapshot.scoreComponentes ?? {}) as Record<string, unknown>;
  const nuevoScoreComponentes: Record<string, unknown> = {
    ...existenteJson,
    ...scoreComponentesPatch,
    ...scoreComponentesPatchB,
    ...scoreComponentesPatchC,
    fase1bA: {
      consolidadoAt: new Date().toISOString(),
      kpisLlenados,
      kpisNull,
      warnings: warningsExtractor,
    },
  };

  // 6) Decidir: update directo (draft) vs correction (closed)
  let correctionCreada = false;

  if (snapshot.status === "closed") {
    // Crear correction con version+1 — NO sobrescribir el closed
    const ultimaVersion = await prisma.operationalSnapshot.findFirst({
      where: { snapshotPeriod },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    await prisma.operationalSnapshot.create({
      data: {
        snapshotDate: snapshot.snapshotDate,
        snapshotPeriod,
        snapshotType: "correction",
        status: "draft",
        version: (ultimaVersion?.version ?? snapshot.version) + 1,
        ...mapKpisToFields(kpis),
        scoreComponentes: nuevoScoreComponentes as Prisma.InputJsonValue,
        fuentesUsadas: snapshot.fuentesUsadas,
        fuentesEsperadas: snapshot.fuentesEsperadas,
        sourceFiles: snapshot.sourceFiles,
        sourceHashes: snapshot.sourceHashes,
        completionPct: snapshot.completionPct,
        warnings: [
          ...snapshot.warnings,
          ...warningsExtractor,
          `Consolidación 1b-A creada como correction (snapshot original cerrado)`,
        ],
        lastRecalculatedAt: new Date(),
      },
    });
    correctionCreada = true;
  } else {
    // Update directo (draft)
    await prisma.operationalSnapshot.update({
      where: { id: snapshot.id },
      data: {
        ...mapKpisToFields(kpis),
        scoreComponentes: nuevoScoreComponentes as Prisma.InputJsonValue,
        warnings: dedupeWarnings([...snapshot.warnings, ...warningsExtractor]),
        lastRecalculatedAt: new Date(),
      },
    });
  }

  return {
    ...baseResult,
    ok: true,
    kpisLlenados,
    kpisNull,
    correctionCreada,
    warnings: warningsExtractor,
  };
}

// ────────────────────────────────────────────────────────────────────
// Helpers privados
// ────────────────────────────────────────────────────────────────────

/**
 * Mapea el record genérico de extraer1bA a campos columna por columna,
 * filtrando claves que no correspondan a columnas conocidas. Esto evita
 * que un cambio futuro del extractor lance error de Prisma por unknown
 * field; las claves nuevas quedan loggeadas pero no se persisten hasta
 * agregar la columna explícitamente.
 */
const CAMPOS_PERSISTIBLES = new Set([
  // 1b-A
  "capitalTrabajoTotal",
  "capitalTrabajoUtilizado",
  "capitalTrabajoDisponible",
  "fneBloqueadosCp",
  "fneBloqueadosInscripcion",
  "fneBloqueadosLogistica",
  "fneBloqueadosComercial",
  "alertasCriticas",
  "alertasAltas",
  "alertasMedias",
  "sucursalesConBrechas",
  "marcasConBrechas",
  // 1b-B
  "scoreCapital",
  "scoreGerencial",
  // 1b-C
  "scoreVelocidad",
]);

function mapKpisToFields(
  kpis: Record<string, number | null>,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(kpis)) {
    if (CAMPOS_PERSISTIBLES.has(k)) out[k] = v;
  }
  return out;
}

/** Mantiene el orden y elimina duplicados exactos. */
function dedupeWarnings(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of arr) {
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}
