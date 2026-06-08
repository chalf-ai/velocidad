/**
 * Histórico Fase 1b-C · atribución de variación entre dos snapshots de score.
 *
 * Función pura aplicable a Score Capital, Gerencial y Velocidad.
 *
 * ΔScore = score(N) − score(N−1) = − Σ ΔPuntos_i
 *
 * donde ΔPuntos_i > 0 = el driver i empeoró (más penalización).
 *       ΔPuntos_i < 0 = el driver i mejoró (menos penalización).
 *
 * Solo emite atribución si ambos snapshots tienen score numérico.
 * Si previo es null o falta score → atribución = null + responsable "n/d".
 * Marzo siempre sin atribución (no hay N−1 comparable).
 *
 * Drivers que estaban en uno pero no en el otro (ausencia de fuente cambió
 * entre períodos) se reportan como "cambio_de_cobertura" y NO contribuyen a la
 * narrativa principal (el cambio no es del negocio sino de los datos).
 */

import type { Driver, ScoreResult } from "./extraer-1b-b";

// ────────────────────────────────────────────────────────────────────
// Tipos públicos
// ────────────────────────────────────────────────────────────────────

export type DireccionDelta = "mejora" | "deterioro" | "neutro";

export interface AtribucionDeltaDriver {
  id: string;
  nombre: string;
  puntosActual: number;
  puntosPrevio: number;
  /** Δ puntos = actual − previo. Positivo = empeoró. */
  deltaPuntos: number;
  direccion: DireccionDelta;
  /** % de la magnitud absoluta del Δ total que este driver representa. */
  contribucionPct: number;
  /**
   * "presente" = driver con valor en ambos snapshots.
   * "cambio_de_cobertura" = driver apareció o desapareció — no contribuye al
   *   responsable principal porque el cambio puede ser de datos, no del negocio.
   */
  estado: "presente" | "cambio_de_cobertura";
}

export interface AtribucionDelta {
  /** ΔScore = actual − previo. Positivo = score subió (mejoró). */
  delta: number;
  /** Drivers ordenados por |ΔPuntos| descendente. */
  drivers: AtribucionDeltaDriver[];
  /** id del driver con mayor |ΔPuntos| entre los "presente". null si ninguno aplica. */
  responsablePrincipal: string | null;
  /** Narrativa textual lista para UI. */
  narrativa: string;
}

// ────────────────────────────────────────────────────────────────────
// Implementación
// ────────────────────────────────────────────────────────────────────

const UMBRAL_NEUTRO = 0.5; // |ΔPuntos| menor a esto = "neutro"

function direccionDe(deltaPuntos: number): DireccionDelta {
  if (Math.abs(deltaPuntos) < UMBRAL_NEUTRO) return "neutro";
  // Δpuntos > 0 = más penalización = score empeoró
  return deltaPuntos > 0 ? "deterioro" : "mejora";
}

function findDriver(drivers: Driver[], id: string): Driver | null {
  return drivers.find((d) => d.id === id) ?? null;
}

/**
 * Calcula la atribución de variación.
 *
 * @returns AtribucionDelta o null si previo es null o alguno de los scores es null.
 */
export function atribuirVariacion(
  actual: ScoreResult,
  previo: ScoreResult | null,
): AtribucionDelta | null {
  if (!previo) return null;
  if (actual.score === null || previo.score === null) return null;

  // Recolectar ids de drivers de ambos snapshots
  const ids = new Set<string>();
  for (const d of actual.drivers) ids.add(d.id);
  for (const d of previo.drivers) ids.add(d.id);

  const driversOut: AtribucionDeltaDriver[] = [];
  for (const id of ids) {
    const dA = findDriver(actual.drivers, id);
    const dP = findDriver(previo.drivers, id);
    const presenteA = dA && dA.valor !== null;
    const presenteP = dP && dP.valor !== null;

    if (presenteA && presenteP) {
      const deltaPuntos = (dA as Driver).puntos - (dP as Driver).puntos;
      driversOut.push({
        id,
        nombre: (dA as Driver).nombre,
        puntosActual: (dA as Driver).puntos,
        puntosPrevio: (dP as Driver).puntos,
        deltaPuntos,
        direccion: direccionDe(deltaPuntos),
        contribucionPct: 0,
        estado: "presente",
      });
    } else if (presenteA !== presenteP) {
      driversOut.push({
        id,
        nombre: (dA?.nombre ?? dP?.nombre ?? id),
        puntosActual: dA?.puntos ?? 0,
        puntosPrevio: dP?.puntos ?? 0,
        deltaPuntos: (dA?.puntos ?? 0) - (dP?.puntos ?? 0),
        direccion: "neutro",
        contribucionPct: 0,
        estado: "cambio_de_cobertura",
      });
    }
    // ambos ausentes → ignoramos
  }

  // Contribución sobre el total ABS de los presentes (cambios de cobertura
  // no entran al denominador para no distorsionar la lectura del negocio).
  const presentes = driversOut.filter((d) => d.estado === "presente");
  const sumAbs = presentes.reduce(
    (s, d) => s + Math.abs(d.deltaPuntos),
    0,
  );
  for (const d of presentes) {
    d.contribucionPct =
      sumAbs > 0 ? Math.round((Math.abs(d.deltaPuntos) / sumAbs) * 100) : 0;
  }
  // Ordenar por magnitud (presentes primero, dentro de cada grupo por |Δ|)
  driversOut.sort((a, b) => {
    if (a.estado !== b.estado) return a.estado === "presente" ? -1 : 1;
    return Math.abs(b.deltaPuntos) - Math.abs(a.deltaPuntos);
  });

  const delta = (actual.score ?? 0) - (previo.score ?? 0);

  // Responsable principal: el driver "presente" con mayor |Δ| no neutro.
  const candidatos = presentes.filter((d) => d.direccion !== "neutro");
  const responsable = candidatos[0] ?? null;
  const responsablePrincipal = responsable?.id ?? null;

  // Narrativa
  let narrativa: string;
  if (Math.abs(delta) < UMBRAL_NEUTRO) {
    narrativa = "Score estable vs N-1 — sin variación material";
  } else if (responsable) {
    const accion = delta > 0 ? "subió" : "bajó";
    const signoDelta = delta > 0 ? `+${delta}` : `${delta}`;
    const driverDir =
      responsable.direccion === "mejora" ? "mejora" : "deterioro";
    const signoDriver = -responsable.deltaPuntos; // mejora → +; deterioro → -
    const signoStr = signoDriver > 0 ? `+${signoDriver.toFixed(1)}` : `${signoDriver.toFixed(1)}`;
    narrativa = `Score ${accion} ${signoDelta} puntos: principalmente por ${driverDir} en ${responsable.nombre} (${signoStr} pts)`;
  } else {
    narrativa = `Score se movió ${delta > 0 ? "+" : ""}${delta} puntos sin un driver dominante`;
  }

  return { delta, drivers: driversOut, responsablePrincipal, narrativa };
}
