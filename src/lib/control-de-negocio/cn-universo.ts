/**
 * Universo del módulo Control de Negocio.
 *
 * Reglas (brief §3 + §13):
 *  1. R3 — excluir Usados + Mayorista + Liquidaciones por marca (usa
 *     `esUsadoHistorico` de vista-derivados, que canoniza la familia).
 *  2. Brief §3 — además excluir cualquier fila cuya SUCURSAL contenga
 *     USADOS / MAYORISTA / LIQUIDA (clasificador `esRetailNuevos`).
 *  3. Sólo facturados (fFactura !== null).
 *  4. Filtrar por marca + sucursal globales del Header (R2, cascada).
 *  5. Filtrar por mes de factura (filtro principal del módulo).
 *
 * El resultado es el universo base de todas las capas (A · B · C).
 */

import type { EntradaConsolidada } from "../historico/cruce-roma-actas";
import type { ResultadoCruce } from "../historico/cruce-roma-actas";
import {
  esUsadoHistorico,
  filtrarPorMesFactura,
  mesesFacturaDisponibles,
  type MesFacturaKey,
  type MesFacturaOption,
} from "../historico/vista-derivados";
import { normalizarMarcaOperacional } from "../selectors/owner-operacional";
import { clasificarCanal } from "./cn-canales";

/** Helper local — "YYYY-MM" de una Date (sin importar zona horaria del host). */
function mesKey(d: Date): MesFacturaKey {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export interface FiltrosCN {
  /** Marca global del Header (null = todas). */
  marcaGlobal: string | null;
  /** Sucursal global del Header (null = todas). */
  sucursalGlobal: string | null;
  /** Mes de factura seleccionado en el módulo (null = todos). */
  mes: MesFacturaKey | null;
}

/**
 * Filtro madre. Aplica TODA la cascada R2 + R3 + brief §3 sobre el cruce.
 * Entrega el universo retail nuevos del período listo para las 3 capas.
 */
export function universoCN(
  cruce: ResultadoCruce,
  filtros: FiltrosCN,
): EntradaConsolidada[] {
  const marcaObj = filtros.marcaGlobal
    ? normalizarMarcaOperacional(filtros.marcaGlobal)
    : null;

  const conMarcaYSucursal = cruce.filas.filter((f) => {
    // R2 · marca + sucursal globales (cascada del Header)
    if (marcaObj && normalizarMarcaOperacional(f.marca) !== marcaObj) return false;
    if (filtros.sucursalGlobal && (f.sucursal ?? null) !== filtros.sucursalGlobal) {
      return false;
    }
    // R3 + brief §3 · excluir usados/mayorista/liquidación por MARCA
    if (esUsadoHistorico(f)) return false;
    // Brief §3 · excluir por SUCURSAL (cubre casos donde marca está vacía pero
    // la sucursal indica "USADOS …" / "MAYORISTA" / "LIQUIDACIÓN").
    if (clasificarCanal(f.sucursal) === "EXCLUIDO") return false;
    // Sólo facturados
    if (!(f.fFactura instanceof Date)) return false;
    return true;
  });

  // Filtro principal del módulo (mes de factura)
  return filtrarPorMesFactura(conMarcaYSucursal, filtros.mes);
}

/**
 * Opciones del selector de mes de factura · YA recortado por filtros globales.
 * El counter de cada opción muestra cuántos facturados retail nuevos hay en
 * ese mes (coherente con el universo real del módulo, brief §6).
 */
export function mesesDisponiblesCN(
  cruce: ResultadoCruce,
  filtros: Pick<FiltrosCN, "marcaGlobal" | "sucursalGlobal">,
): MesFacturaOption[] {
  // Reusamos universoCN sin mes para mantener consistencia
  const sinMes = universoCN(cruce, { ...filtros, mes: null });
  return mesesFacturaDisponibles(sinMes);
}

/**
 * Cohorte madura (brief §3) — sub-universo con ≥N días desde factura al
 * corte. Sólo se usa en Capa B (procesos quebrados); asegura que el caso
 * tuvo tiempo de madurar antes de medirlo.
 *
 * REGLA CRÍTICA: `hoy` debe ser la **fecha de corte del Excel**, NO el
 * reloj real del servidor. Con datasets de meses futuros (ej. cruce
 * Mayo 2026 cargado en un servidor que corre en 2025), `new Date()`
 * produce diferencias negativas y la cohorte queda vacía.
 *
 * `diasMinimos` permite que el caller ajuste el umbral según el período
 * activo (en modo "mes" con poco volumen, 0 días = ver todo el universo;
 * en períodos largos, 30 días para asegurar madurez del proceso).
 */
const MS_DIA = 86_400_000;
export const DIAS_COHORTE_MADURA = 30;

export function cohorteMadura(
  filas: EntradaConsolidada[],
  hoy: Date = new Date(),
  diasMinimos: number = DIAS_COHORTE_MADURA,
): EntradaConsolidada[] {
  if (diasMinimos <= 0) return filas.filter((f) => f.fFactura instanceof Date);
  return filas.filter((f) => {
    if (!(f.fFactura instanceof Date)) return false;
    const dias = (hoy.getTime() - f.fFactura.getTime()) / MS_DIA;
    return dias >= diasMinimos;
  });
}

// Re-export del tipo para que los consumidores no tengan que importar 2 paths.
export type { MesFacturaKey, MesFacturaOption } from "../historico/vista-derivados";

// ════════════════════════════════════════════════════════════════════════════
// VENTANA POR FECHA DE ENTREGA · "¿Cuánto se demoró lo que entregamos en este mes?"
// ════════════════════════════════════════════════════════════════════════════
//
// Distinto a `universoCN`: ese filtra por **mes de factura** (universo de
// procesos que ARRANCARON en el mes). Este filtra por **mes de entrega real**
// (universo de procesos que CERRARON en el mes), incluyendo autos facturados
// en meses previos. Sirve para responder operacionalmente: "en mayo,
// ¿cuántos días estuvimos tardando en entregar?".
//
// Reglas R2 + R3 + brief §3 idénticas. Además, exige `fFactura` y
// `fEntregaReal` no nulas (sino no hay ciclo medible).

export interface FiltrosEntregados {
  marcaGlobal: string | null;
  sucursalGlobal: string | null;
  /** Meses incluidos (YYYY-MM). El filtro mira `fEntregaReal`, no `fFactura`. */
  mesesIncluidos: ReadonlySet<MesFacturaKey> | readonly MesFacturaKey[];
}

export function universoEntregadosEnPeriodo(
  cruce: ResultadoCruce,
  filtros: FiltrosEntregados,
): EntradaConsolidada[] {
  const set =
    filtros.mesesIncluidos instanceof Set
      ? (filtros.mesesIncluidos as ReadonlySet<MesFacturaKey>)
      : new Set<MesFacturaKey>(filtros.mesesIncluidos as readonly MesFacturaKey[]);

  // Período vacío → resultado vacío (evita falsos "todos los meses").
  if (set.size === 0) return [];

  const marcaObj = filtros.marcaGlobal
    ? normalizarMarcaOperacional(filtros.marcaGlobal)
    : null;

  return cruce.filas.filter((f) => {
    if (marcaObj && normalizarMarcaOperacional(f.marca) !== marcaObj) return false;
    if (filtros.sucursalGlobal && (f.sucursal ?? null) !== filtros.sucursalGlobal) {
      return false;
    }
    if (esUsadoHistorico(f)) return false;
    if (clasificarCanal(f.sucursal) === "EXCLUIDO") return false;
    if (!(f.fFactura instanceof Date)) return false;
    if (!(f.fEntregaReal instanceof Date)) return false;
    if (!f.entregado) return false;
    return set.has(mesKey(f.fEntregaReal));
  });
}
