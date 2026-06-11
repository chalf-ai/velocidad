/**
 * Reconstrucción server-side del Score Gerencial LEGACY por DÍA dentro
 * de un período (vista "evolución diaria" de /tendencias V5 · Etapa A).
 *
 * Política operacional aprobada por usuario:
 *   · Solo días con cargas reales. No inventar puntos.
 *   · Para cada día con cargas, usar la última versión disponible de cada
 *     fuente hasta el final de ese día (criterio "más reciente", NO
 *     "mayor prioridadCierre" — porque acá nos interesa el avance temporal).
 *   · Si en un día las 4 fuentes acumuladas no están presentes → datos
 *     insuficientes para ese día.
 *   · Otros 3 scores (Capital, Cumplimiento, Velocidad) → quedan para fase
 *     futura. NO se calculan acá.
 *   · Filtro por marca se propaga.
 *   · Sin schema nuevo, sin tocar Railway.
 */

import { prisma } from "@/lib/prisma";
import { Fuente } from "@prisma/client";
import {
  calcularSGLegacyDesdePayloads,
  rehidratarFNE,
  rehidratarProvisiones,
  rehidratarSaldos,
  rehidratarStock,
  type ResultadoScoreGerencialHistorico,
} from "./calcular-score-gerencial-historico";
import { capitalDesdePayloads, type CapitalCorte } from "./capital-por-corte";

// ────────────────────────────────────────────────────────────────────
// Tipos públicos
// ────────────────────────────────────────────────────────────────────

export interface ArchivoCarga {
  id: string;
  fuente: string;
  nombreOriginal: string;
  createdAt: Date;
  /** Fecha de corte declarada o detectada por el parser. null si no hay. */
  fechaCorte: Date | null;
  prioridadCierre: number;
  esCierreMensual: boolean;
}

export interface PuntoDiario {
  /** Formato YYYY-MM-DD (fecha de carga). */
  dia: string;
  /** Fecha humanizada de carga (ej. "07 jun 2026"). */
  diaLabel: string;
  /** Cargas hechas en ese día. */
  cargasDelDia: ArchivoCarga[];
  /** Score Gerencial legacy reconstruido al final de ese día. */
  sgLegacy: ResultadoScoreGerencialHistorico;
  /** Delta vs el punto anterior (si existe y ambos confiables). null si no se puede comparar. */
  deltaSG: number | null;
  /** Componentes reales del capital de trabajo en este corte. A diferencia
   *  del score (que exige las 4 fuentes), cada componente se calcula con
   *  SU fuente — null solo si esa fuente falta. */
  capital: CapitalCorte;
  /** Fecha de corte mínima detectada entre los archivos del día. */
  fechaCorteMin: Date | null;
  /** Fecha de corte máxima detectada entre los archivos del día. */
  fechaCorteMax: Date | null;
}

// ────────────────────────────────────────────────────────────────────
// Helper · archivo ganador hasta una fecha (criterio: más reciente)
// ────────────────────────────────────────────────────────────────────

const FUENTES_SG: Fuente[] = ["BASE_STOCK", "SALDOS", "PROVISIONES", "FNE"];

async function archivoMasRecienteHasta(
  fuente: Fuente,
  snapshotPeriod: string,
  hastaFecha: Date,
): Promise<{ payload: unknown; nombreOriginal: string } | null> {
  const archivos = await prisma.snapshotHistoricoArchivo.findMany({
    where: {
      fuente,
      snapshotPeriod,
      createdAt: { lte: hastaFecha },
    },
    orderBy: { createdAt: "desc" },
    select: { payload: true, nombreOriginal: true },
  });
  if (archivos.length === 0) return null;
  const archivo = archivos.find((a) => a.payload != null) ?? archivos[0];

  if (archivo.payload != null) {
    return { payload: archivo.payload, nombreOriginal: archivo.nombreOriginal };
  }

  // Fallback estricto: Snapshot vivo por nombre exacto
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
// Entry point
// ────────────────────────────────────────────────────────────────────

const MESES_CORTOS = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

export async function calcularSGLegacyPorDia(args: {
  snapshotPeriod: string;
  marca: string | null;
}): Promise<PuntoDiario[]> {
  const { snapshotPeriod, marca } = args;

  // 1) Cargar todas las cargas del período (incluye fechas de corte)
  const todasRaw = await prisma.snapshotHistoricoArchivo.findMany({
    where: { snapshotPeriod },
    select: {
      id: true,
      fuente: true,
      nombreOriginal: true,
      createdAt: true,
      fechaCorteDetectada: true,
      fechaCorteDeclarada: true,
      prioridadCierre: true,
      esCierreMensual: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Adaptar al shape ArchivoCarga consolidando fechaCorte
  const todas: (ArchivoCarga & { snapshotPeriod?: never })[] = todasRaw.map((c) => ({
    id: c.id,
    fuente: c.fuente,
    nombreOriginal: c.nombreOriginal,
    createdAt: c.createdAt,
    fechaCorte: c.fechaCorteDetectada ?? c.fechaCorteDeclarada ?? null,
    prioridadCierre: c.prioridadCierre,
    esCierreMensual: c.esCierreMensual,
  }));

  if (todas.length === 0) return [];

  // 2) Agrupar por día (UTC, basado en createdAt)
  const porDia = new Map<string, ArchivoCarga[]>();
  for (const c of todas) {
    const dia = c.createdAt.toISOString().slice(0, 10);
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia)!.push(c);
  }

  // 3) Para cada día con cargas, reconstruir SG legacy
  const dias = Array.from(porDia.keys()).sort();
  const puntos: PuntoDiario[] = [];

  for (const dia of dias) {
    const fechaFin = new Date(`${dia}T23:59:59.999Z`);

    // Buscar archivo más reciente hasta esa fecha por cada fuente
    const ganadores: Record<string, { payload: unknown; nombreOriginal: string } | null> = {};
    for (const f of FUENTES_SG) {
      ganadores[f] = await archivoMasRecienteHasta(f, snapshotPeriod, fechaFin);
    }

    const fuentesPresentes = FUENTES_SG.filter((f) => ganadores[f] !== null);
    const fuentesFaltantes = FUENTES_SG.filter((f) => ganadores[f] === null);

    let sgLegacy: ResultadoScoreGerencialHistorico;
    if (fuentesFaltantes.length > 0) {
      sgLegacy = {
        score: null,
        esConfiable: false,
        fuentesPresentes,
        fuentesFaltantes,
        indicadores: null,
        causaRaizPrincipal: null,
        marca,
        nVUs: 0,
        warnings: [
          `Score Gerencial legacy: datos insuficientes al ${dia}. Faltan: ${fuentesFaltantes.join(", ")}.`,
        ],
      };
    } else {
      sgLegacy = calcularSGLegacyDesdePayloads({
        stock: rehidratarStock(ganadores.BASE_STOCK!.payload),
        fne: rehidratarFNE(ganadores.FNE!.payload),
        saldos: rehidratarSaldos(ganadores.SALDOS!.payload),
        provisiones: rehidratarProvisiones(ganadores.PROVISIONES!.payload),
        marca,
        fuentesPresentes,
        fuentesFaltantes: [],
      });
    }

    // Capital de trabajo del corte — por componente, con lo que haya.
    const capital = capitalDesdePayloads({
      stock: ganadores.BASE_STOCK ? rehidratarStock(ganadores.BASE_STOCK.payload) : null,
      saldos: ganadores.SALDOS ? rehidratarSaldos(ganadores.SALDOS.payload) : null,
      provisiones: ganadores.PROVISIONES
        ? rehidratarProvisiones(ganadores.PROVISIONES.payload)
        : null,
      marca,
    });

    const [year, mes, diaNum] = dia.split("-");
    const mNum = parseInt(mes, 10);
    const diaLabel = `${parseInt(diaNum, 10).toString().padStart(2, "0")} ${MESES_CORTOS[mNum - 1] ?? "?"} ${year}`;

    // Rango de fechas de corte entre los archivos del día
    const cargasDelDia = porDia.get(dia)!;
    const cortesValidos = cargasDelDia
      .map((c) => c.fechaCorte)
      .filter((d): d is Date => d !== null && Number.isFinite(d.getTime()));
    const fechaCorteMin =
      cortesValidos.length > 0
        ? new Date(Math.min(...cortesValidos.map((d) => d.getTime())))
        : null;
    const fechaCorteMax =
      cortesValidos.length > 0
        ? new Date(Math.max(...cortesValidos.map((d) => d.getTime())))
        : null;

    puntos.push({
      dia,
      diaLabel,
      cargasDelDia,
      sgLegacy,
      deltaSG: null, // se completa abajo
      capital,
      fechaCorteMin,
      fechaCorteMax,
    });
  }

  // 4) Calcular delta vs día anterior (solo cuando ambos confiables)
  for (let i = 1; i < puntos.length; i++) {
    const actual = puntos[i].sgLegacy;
    const previo = puntos[i - 1].sgLegacy;
    if (
      actual.esConfiable &&
      previo.esConfiable &&
      actual.score !== null &&
      previo.score !== null
    ) {
      puntos[i].deltaSG = actual.score - previo.score;
    }
  }

  return puntos;
}
