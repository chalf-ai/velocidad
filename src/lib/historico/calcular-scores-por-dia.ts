/**
 * Reconstrucción server-side del Score Gerencial LEGACY por FECHA DE CORTE
 * dentro de un período (vista "evolución por corte" de /tendencias).
 *
 * Política operacional aprobada por usuario (2026-06, revisión post-PR #29):
 *   · Cada punto del gráfico es una FECHA DE CORTE REAL (la fecha que declara
 *     o detecta el archivo), NO la fecha en que se subió. La fecha de carga
 *     (createdAt) queda solo como metadato de auditoría.
 *   · Un punto usa SOLO archivos cuyo corte es esa fecha. Nunca se mezclan
 *     cortes distintos en un mismo punto (un corte sin saldos queda sin
 *     saldos, aunque exista un archivo de saldos de otro corte).
 *   · Si hay varios archivos de la misma fuente para el mismo corte, gana el
 *     más reciente por createdAt (la re-subida pisa a la anterior).
 *   · Si a un corte le falta alguna fuente, el punto se calcula con lo
 *     disponible (capital por componente) y se marca cobertura incompleta.
 *     El score exige las 4 fuentes — con menos, queda "datos insuficientes".
 *   · Solo cortes con cargas reales. No inventar puntos.
 *   · Filtro por marca se propaga.
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
  /** Fecha de corte detectada o declarada por el parser. null si no hay. */
  fechaCorte: Date | null;
  prioridadCierre: number;
  esCierreMensual: boolean;
}

/** Cobertura de una fuente dentro de un corte. */
export interface CoberturaFuente {
  fuente: Fuente;
  /** Nombre humano de la fuente (Stock, Saldos, FNE, Provisiones). */
  etiqueta: string;
  presente: boolean;
  /** Archivo ganador considerado para este corte. null si la fuente falta. */
  nombreOriginal: string | null;
  /** Día de carga (YYYY-MM-DD) del archivo ganador. null si la fuente falta. */
  fechaCarga: string | null;
}

export interface PuntoDiario {
  /** Formato YYYY-MM-DD — fecha de CORTE real (no de carga). */
  dia: string;
  /** Fecha de corte humanizada (ej. "04 jun 2026"). */
  diaLabel: string;
  /** Archivos del corte (todos, incluidas versiones pisadas por re-subida). */
  cargasDelDia: ArchivoCarga[];
  /** Días (YYYY-MM-DD) en que se cargaron los archivos considerados. */
  fechasCarga: string[];
  /** Cobertura por fuente: qué archivo respalda cada componente del corte. */
  cobertura: CoberturaFuente[];
  /** true si alguna de las 4 fuentes no tiene archivo en este corte. */
  coberturaIncompleta: boolean;
  /** true si el archivo no traía fecha de corte y se agrupó por fecha de carga. */
  corteDesdeCarga: boolean;
  /** Score Gerencial legacy reconstruido con los archivos de este corte. */
  sgLegacy: ResultadoScoreGerencialHistorico;
  /** Delta vs el corte anterior (si existe y ambos confiables). null si no se puede comparar. */
  deltaSG: number | null;
  /** Componentes reales del capital de trabajo en este corte. A diferencia
   *  del score (que exige las 4 fuentes), cada componente se calcula con
   *  SU fuente — null solo si esa fuente falta en el corte. */
  capital: CapitalCorte;
  /** Fecha de corte mínima entre los archivos del punto (auditoría). */
  fechaCorteMin: Date | null;
  /** Fecha de corte máxima entre los archivos del punto (auditoría). */
  fechaCorteMax: Date | null;
}

// ────────────────────────────────────────────────────────────────────
// Fuentes que alimentan el score
// ────────────────────────────────────────────────────────────────────

const FUENTES_SG: Fuente[] = ["BASE_STOCK", "SALDOS", "PROVISIONES", "FNE"];

export const ETIQUETA_FUENTE: Record<string, string> = {
  BASE_STOCK: "Stock",
  SALDOS: "Saldos",
  PROVISIONES: "Provisiones",
  FNE: "FNE",
};

/**
 * Payload de un archivo histórico concreto. Si el registro histórico no
 * guardó payload, fallback estricto al Snapshot vivo con el mismo nombre.
 */
async function payloadDeArchivo(
  archivo: ArchivoCarga,
): Promise<{ payload: unknown; nombreOriginal: string } | null> {
  const historico = await prisma.snapshotHistoricoArchivo.findUnique({
    where: { id: archivo.id },
    select: { payload: true },
  });
  if (historico?.payload != null) {
    return { payload: historico.payload, nombreOriginal: archivo.nombreOriginal };
  }

  const vivoPorNombre = await prisma.snapshot.findFirst({
    where: { fuente: archivo.fuente as Fuente, nombre: archivo.nombreOriginal },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  if (vivoPorNombre?.payload != null) {
    return { payload: vivoPorNombre.payload, nombreOriginal: archivo.nombreOriginal };
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
  const todas: ArchivoCarga[] = todasRaw.map((c) => ({
    id: c.id,
    fuente: c.fuente,
    nombreOriginal: c.nombreOriginal,
    createdAt: c.createdAt,
    fechaCorte: c.fechaCorteDetectada ?? c.fechaCorteDeclarada ?? null,
    prioridadCierre: c.prioridadCierre,
    esCierreMensual: c.esCierreMensual,
  }));

  if (todas.length === 0) return [];

  // 2) Agrupar por FECHA DE CORTE (UTC). Si el archivo no trae corte,
  //    fallback al día de carga — el punto queda marcado corteDesdeCarga.
  const porCorte = new Map<string, { archivos: ArchivoCarga[]; conFallback: boolean }>();
  for (const c of todas) {
    const conCorte = c.fechaCorte !== null && Number.isFinite(c.fechaCorte.getTime());
    const dia = (conCorte ? c.fechaCorte! : c.createdAt).toISOString().slice(0, 10);
    if (!porCorte.has(dia)) porCorte.set(dia, { archivos: [], conFallback: false });
    const grupo = porCorte.get(dia)!;
    grupo.archivos.push(c);
    if (!conCorte) grupo.conFallback = true;
  }

  // 3) Para cada corte, reconstruir SG legacy con SOLO los archivos del corte
  const dias = Array.from(porCorte.keys()).sort();
  const puntos: PuntoDiario[] = [];

  for (const dia of dias) {
    const { archivos: archivosDelCorte, conFallback } = porCorte.get(dia)!;

    // Ganador por fuente dentro del corte: el más reciente por createdAt.
    const ganadorArchivo: Partial<Record<Fuente, ArchivoCarga>> = {};
    for (const a of archivosDelCorte) {
      const f = a.fuente as Fuente;
      if (!FUENTES_SG.includes(f)) continue;
      const actual = ganadorArchivo[f];
      if (!actual || a.createdAt > actual.createdAt) ganadorArchivo[f] = a;
    }

    const ganadores: Record<string, { payload: unknown; nombreOriginal: string } | null> = {};
    for (const f of FUENTES_SG) {
      const archivo = ganadorArchivo[f];
      ganadores[f] = archivo ? await payloadDeArchivo(archivo) : null;
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
          `Score Gerencial legacy: cobertura incompleta en el corte ${dia}. Faltan: ${fuentesFaltantes
            .map((f) => ETIQUETA_FUENTE[f] ?? f)
            .join(", ")}.`,
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

    // Cobertura y auditoría de cargas del punto
    const cobertura: CoberturaFuente[] = FUENTES_SG.map((f) => {
      const archivo = ganadores[f] !== null ? (ganadorArchivo[f] ?? null) : null;
      return {
        fuente: f,
        etiqueta: ETIQUETA_FUENTE[f] ?? f,
        presente: ganadores[f] !== null,
        nombreOriginal: archivo?.nombreOriginal ?? null,
        fechaCarga: archivo ? archivo.createdAt.toISOString().slice(0, 10) : null,
      };
    });
    const fechasCarga = Array.from(
      new Set(
        cobertura
          .map((c) => c.fechaCarga)
          .filter((d): d is string => d !== null),
      ),
    ).sort();

    const cortesValidos = archivosDelCorte
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
      cargasDelDia: archivosDelCorte,
      fechasCarga,
      cobertura,
      coberturaIncompleta: fuentesFaltantes.length > 0,
      corteDesdeCarga: conFallback,
      sgLegacy,
      deltaSG: null, // se completa abajo
      capital,
      fechaCorteMin,
      fechaCorteMax,
    });
  }

  // 4) Calcular delta vs corte anterior (solo cuando ambos confiables)
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
