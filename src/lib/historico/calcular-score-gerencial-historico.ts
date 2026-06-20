/**
 * Reconstrucción server-side del Score Gerencial LEGACY (40/40/10/10)
 * para un período histórico, leyendo los payloads guardados en
 * SnapshotHistoricoArchivo + fallback al Snapshot vivo por nombre exacto.
 *
 * Sin schema nuevo. Sin tocar Railway. Sin tocar la fórmula legacy.
 *
 * Política operacional (Velocity OS · decisión usuario 2026-06):
 *   · El Score Gerencial legacy solo se reporta cuando están las 4 fuentes
 *     centrales (BASE_STOCK + SALDOS + PROVISIONES + FNE). Si falta alguna,
 *     score = null y esConfiable = false. NO calculamos parciales porque
 *     producirían números falsamente buenos (un período sin PROVISIONES
 *     tendría I2 perfecto e infla el score → eso sería inventar datos).
 *   · Si hay marca, los VUs se filtran por marca operacional canónica;
 *     saldos y provisiones también se filtran a la marca antes del cálculo.
 *   · No se persiste — se recalcula on-demand desde los archivos históricos.
 */

import { prisma } from "@/lib/prisma";
import { Fuente } from "@prisma/client";
import {
  calcularScoreGerencial,
  type Indicador,
  type EstadoScore,
} from "@/lib/selectors/score-gerencial";
import { buildVehiculosUnificados } from "@/lib/selectors/vehiculo-unificado";
import { normalizarMarcaOperacional } from "@/lib/selectors/owner-operacional";
import type {
  ParsedExcel,
  ParsedFNE,
  ParsedProvisiones,
  ParsedSaldos,
} from "@/lib/types";

// ────────────────────────────────────────────────────────────────────
// Rehidratación de payloads JSONB (mismo patrón de consolidar-periodo)
// ────────────────────────────────────────────────────────────────────

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

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

export function rehidratarStock(payload: unknown): ParsedExcel | null {
  if (!payload || typeof payload !== "object") return null;
  const revived = reviveDates(payload) as ParsedExcel & { vinsExtra: unknown };
  const ve = revived.vinsExtra;
  if (Array.isArray(ve)) {
    revived.vinsExtra = new Map(
      ve as Array<[string, unknown]>,
    ) as ParsedExcel["vinsExtra"];
  } else if (!(ve instanceof Map)) {
    revived.vinsExtra = new Map();
  }
  return revived as ParsedExcel;
}

export function rehidratarFNE(payload: unknown): ParsedFNE | null {
  if (!payload || typeof payload !== "object") return null;
  return reviveDates(payload) as ParsedFNE;
}

export function rehidratarSaldos(payload: unknown): ParsedSaldos | null {
  if (!payload || typeof payload !== "object") return null;
  return reviveDates(payload) as ParsedSaldos;
}

export function rehidratarProvisiones(payload: unknown): ParsedProvisiones | null {
  if (!payload || typeof payload !== "object") return null;
  return reviveDates(payload) as ParsedProvisiones;
}

// ────────────────────────────────────────────────────────────────────
// Tipos públicos
// ────────────────────────────────────────────────────────────────────

export interface ResultadoScoreGerencialHistorico {
  score: number | null;
  /** Estado semántico del score (bueno/riesgo/critico). null si score null. */
  estado: EstadoScore | null;
  /** true sólo si están las 4 fuentes (BASE_STOCK + SALDOS + PROVISIONES + FNE). */
  esConfiable: boolean;
  fuentesPresentes: string[];
  fuentesFaltantes: string[];
  indicadores: Indicador[] | null;
  /** Indicador que más castiga el score (mayor `peso − puntos`). */
  causaRaizPrincipal: string | null;
  /** Marca canónica usada (null = global todas las marcas). */
  marca: string | null;
  /** Cantidad de VUs operacionales después del filtro de marca. */
  nVUs: number;
  warnings: string[];
}

// ────────────────────────────────────────────────────────────────────
// Helper: archivo ganador por (fuente, período) con fallback estricto
// ────────────────────────────────────────────────────────────────────

const FUENTES_REQUERIDAS: Fuente[] = [
  "BASE_STOCK",
  "SALDOS",
  "PROVISIONES",
  "FNE",
];

async function archivoGanador(
  fuente: Fuente,
  snapshotPeriod: string,
): Promise<{ payload: unknown; nombreOriginal: string } | null> {
  const archivos = await prisma.snapshotHistoricoArchivo.findMany({
    where: { fuente, snapshotPeriod },
    orderBy: [{ prioridadCierre: "desc" }, { snapshotDate: "desc" }],
    select: { payload: true, nombreOriginal: true, prioridadCierre: true },
  });
  if (archivos.length === 0) return null;
  const maxPrio = archivos[0].prioridadCierre;
  const conMaxPrio = archivos.filter((a) => a.prioridadCierre === maxPrio);
  const archivo = conMaxPrio.find((a) => a.payload != null) ?? conMaxPrio[0];

  if (archivo.payload != null) {
    return { payload: archivo.payload, nombreOriginal: archivo.nombreOriginal };
  }

  // Fallback estricto: Snapshot vivo con el MISMO nombre.
  const vivoPorNombre = await prisma.snapshot.findFirst({
    where: { fuente, nombre: archivo.nombreOriginal },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  if (vivoPorNombre?.payload != null) {
    return {
      payload: vivoPorNombre.payload,
      nombreOriginal: archivo.nombreOriginal,
    };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────
// Función pura · cálculo desde payloads ya rehidratados
//
// Útil para reusar la lógica desde otros flujos (ej. evolución diaria,
// donde los archivos ganadores se eligen con criterio "más reciente
// hasta fecha X" en lugar de "mayor prioridadCierre").
// ────────────────────────────────────────────────────────────────────

export function calcularSGLegacyDesdePayloads(args: {
  stock: ParsedExcel | null;
  fne: ParsedFNE | null;
  saldos: ParsedSaldos | null;
  provisiones: ParsedProvisiones | null;
  marca: string | null;
  /** Lista de fuentes que sí estaban presentes en este snapshot (para auditoría). */
  fuentesPresentes?: string[];
  /** Lista de fuentes que faltaron en este snapshot. */
  fuentesFaltantes?: string[];
  /** Override canónico de Provisiones >90d (I2) — p.ej. ROMA-vivo. Se pasa tal
   *  cual a calcularScoreGerencial (no cambia la fórmula). */
  provisionesOverride?: { casos: number; monto: number };
}): ResultadoScoreGerencialHistorico {
  const { stock, fne, saldos, provisiones, marca } = args;
  const fuentesPresentes = args.fuentesPresentes ?? [];
  const fuentesFaltantes = args.fuentesFaltantes ?? [];

  if (!stock || !fne || !saldos || !provisiones) {
    return {
      score: null,
      estado: null,
      esConfiable: false,
      fuentesPresentes,
      fuentesFaltantes:
        fuentesFaltantes.length > 0
          ? fuentesFaltantes
          : FUENTES_REQUERIDAS.filter(
              (f) =>
                (f === "BASE_STOCK" && !stock) ||
                (f === "FNE" && !fne) ||
                (f === "SALDOS" && !saldos) ||
                (f === "PROVISIONES" && !provisiones),
            ),
      indicadores: null,
      causaRaizPrincipal: null,
      marca,
      nVUs: 0,
      warnings: ["Score Gerencial legacy requiere las 4 fuentes presentes."],
    };
  }

  // Construir VUs
  const vusMap = buildVehiculosUnificados({ data: stock, fne, saldos });
  let vus = Array.from(vusMap.values());

  // Filtro por marca
  const marcaCanonica = marca ? normalizarMarcaOperacional(marca) : null;
  if (marcaCanonica) {
    vus = vus.filter((vu) => {
      const m = normalizarMarcaOperacional(
        vu.marca ?? vu.marcaOriginadora ?? "SIN MARCA",
      );
      return m === marcaCanonica;
    });
  }

  let saldosRegistros = saldos.registros;
  let provRegistros = provisiones.registros;
  if (marcaCanonica) {
    const vinsMarca = new Set(vus.map((vu) => vu.vinLimpio));
    saldosRegistros = saldos.registros.filter((s) => {
      if (s.categoria !== "vehiculo") return false;
      if (!s.vinResuelto) return false;
      const v = s.vinResuelto.replace(/\s+/g, "").toUpperCase();
      return vinsMarca.has(v);
    });
    provRegistros = provisiones.registros.filter((p) => {
      const m = normalizarMarcaOperacional(p.origen ?? "");
      return m === marcaCanonica;
    });
  }

  if (vus.length === 0 && marcaCanonica) {
    return {
      score: null,
      estado: null,
      esConfiable: false,
      fuentesPresentes,
      fuentesFaltantes: [],
      indicadores: null,
      causaRaizPrincipal: null,
      marca: marcaCanonica,
      nVUs: 0,
      warnings: [`Sin VUs en stock activo para la marca "${marcaCanonica}".`],
    };
  }

  const result = calcularScoreGerencial({
    marca: marcaCanonica ?? "Todas las marcas",
    vus,
    saldos: saldosRegistros,
    provisiones: provRegistros,
    provisionesOverride: args.provisionesOverride,
  });

  const ordenadosPorCastigo = [...result.indicadores].sort(
    (a, b) => b.peso - b.puntos - (a.peso - a.puntos),
  );
  const top = ordenadosPorCastigo[0];
  const castigoTop = top ? top.peso - top.puntos : 0;
  const causaRaizPrincipal =
    top && castigoTop > 0
      ? `${top.nombre} · ${top.valorTexto}`
      : "Todos los indicadores en meta";

  return {
    score: result.score,
    estado: result.estado,
    esConfiable: true,
    fuentesPresentes,
    fuentesFaltantes: [],
    indicadores: result.indicadores,
    causaRaizPrincipal,
    marca: marcaCanonica,
    nVUs: vus.length,
    warnings: [],
  };
}

// ────────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────────

export async function calcularScoreGerencialHistorico(args: {
  snapshotPeriod: string;
  marca: string | null;
}): Promise<ResultadoScoreGerencialHistorico> {
  const { snapshotPeriod, marca } = args;
  const warnings: string[] = [];

  // 1) Resolver archivos ganadores para las 4 fuentes
  const ganadores: Record<string, { payload: unknown; nombreOriginal: string } | null> = {};
  for (const fuente of FUENTES_REQUERIDAS) {
    ganadores[fuente] = await archivoGanador(fuente, snapshotPeriod);
  }

  const fuentesPresentes = FUENTES_REQUERIDAS.filter(
    (f) => ganadores[f] !== null,
  );
  const fuentesFaltantes = FUENTES_REQUERIDAS.filter(
    (f) => ganadores[f] === null,
  );
  const esConfiable = fuentesFaltantes.length === 0;

  if (!esConfiable) {
    return {
      score: null,
      estado: null,
      esConfiable: false,
      fuentesPresentes,
      fuentesFaltantes,
      indicadores: null,
      causaRaizPrincipal: null,
      marca,
      nVUs: 0,
      warnings: [
        `Score Gerencial legacy requiere las 4 fuentes (BASE_STOCK + SALDOS + PROVISIONES + FNE). Faltan: ${fuentesFaltantes.join(", ")}.`,
      ],
    };
  }

  // 2) Rehidratar payloads y delegar a función pura
  return calcularSGLegacyDesdePayloads({
    stock: rehidratarStock(ganadores.BASE_STOCK!.payload),
    fne: rehidratarFNE(ganadores.FNE!.payload),
    saldos: rehidratarSaldos(ganadores.SALDOS!.payload),
    provisiones: rehidratarProvisiones(ganadores.PROVISIONES!.payload),
    marca,
    fuentesPresentes,
    fuentesFaltantes: [],
  });
}
