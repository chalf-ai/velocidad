/**
 * Universo del módulo Logística V1.
 *
 * Reglas:
 *  1. tipoSolicitud canonizable a VENTA o VITRINA (brief §3 · TIPOS_EXCLUIDOS).
 *  2. R3 + brief §3 sobre la sucursal destino (vía clasificarCanal).
 *  3. Cruce VIN ↔ Actas/ROMA (useHistoricoStore.cruce) para validar retail-nuevo.
 *     Si el VIN tiene una fila en el cruce y es usado (esUsadoHistorico),
 *     queda fuera. Si no tiene fila en el cruce, NO se excluye (volumen
 *     histórico ROMIA es mayor que el cruce reciente).
 *  4. Filtros globales R2 (marca + sucursal del Header).
 *  5. Filtro principal del módulo: Mes de Compra Marca (fCompraMarca).
 *
 * El resultado son `LogisticaOperacionVIN[]` listos para los 3 motores y el
 * stock crítico.
 */

import type { LogisticaOperacionVIN } from "./modelo";
import type { EntradaConsolidada, ResultadoCruce } from "../historico/cruce-roma-actas";
import { normalizarMarcaOperacional } from "../selectors/owner-operacional";
import { esUsadoHistorico } from "../historico/vista-derivados";
import { clasificarCanal } from "../control-de-negocio/cn-canales";
import { limpiarVIN } from "../parser/venta-apc";
import { canonizarTipoSolicitud } from "./log-responsables";

export type MesCompraMarcaKey = string; // "YYYY-MM"

export interface MesCompraMarcaOption {
  key: MesCompraMarcaKey;
  label: string;
  count: number;
}

const MESES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export function mesCompraKey(d: Date | null | undefined): MesCompraMarcaKey | null {
  if (!(d instanceof Date)) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function labelMes(k: MesCompraMarcaKey): string {
  const [y, m] = k.split("-");
  const i = Number(m) - 1;
  if (i < 0 || i > 11) return k;
  return `${MESES_ES[i]} ${y}`;
}

export interface FiltrosLog {
  marcaGlobal: string | null;
  sucursalGlobal: string | null;
  mes: MesCompraMarcaKey | null;
}

/**
 * Universo madre. Aplica todas las reglas en orden. Devuelve las filas listas.
 */
export function universoLog(
  logisticaPorVin: Map<string, LogisticaOperacionVIN> | null,
  cruce: ResultadoCruce | null,
  filtros: FiltrosLog,
): LogisticaOperacionVIN[] {
  if (!logisticaPorVin) return [];

  const marcaObj = filtros.marcaGlobal
    ? normalizarMarcaOperacional(filtros.marcaGlobal)
    : null;

  // Index del cruce por VIN limpio · usado para validar retail-nuevo cuando
  // la fila está presente. Si NO está, asumimos válida (el universo ROMIA es
  // más amplio que el cruce reciente y ya filtra tipos no-retail por
  // tipoSolicitud arriba).
  const cruceByVin = new Map<string, EntradaConsolidada>();
  if (cruce) {
    for (const f of cruce.filas) {
      const k = limpiarVIN(f.vin);
      if (k) cruceByVin.set(k, f);
    }
  }

  const out: LogisticaOperacionVIN[] = [];
  for (const op of logisticaPorVin.values()) {
    // 1. Tipo solicitud canonizable
    const tipo = canonizarTipoSolicitud(op.tipoSolicitud);
    if (!tipo) continue;

    // 2. Excluir por sucursal destino (usados/mayorista/liquidación)
    if (clasificarCanal(op.sucursalDestino) === "EXCLUIDO") continue;

    // 3. Cruce ROMA↔Actas (sólo si está): excluir usados
    const fila = cruceByVin.get(op.vin);
    if (fila && esUsadoHistorico(fila)) continue;

    // 4. R2 · marca global
    if (marcaObj) {
      const m = normalizarMarcaOperacional(op.marca);
      if (m !== marcaObj) continue;
    }
    // R2 · sucursal global
    if (filtros.sucursalGlobal && (op.sucursalDestino ?? null) !== filtros.sucursalGlobal) {
      continue;
    }

    // 5. Filtro principal · mes de compra marca
    if (filtros.mes) {
      const k = mesCompraKey(op.fCompraMarca);
      if (k !== filtros.mes) continue;
    }

    out.push(op);
  }
  return out;
}

/**
 * Opciones del selector de mes (compra marca) sobre el universo YA filtrado
 * por marca + sucursal globales (consistencia con el universo real del
 * módulo, igual que CN).
 */
export function mesesDisponiblesLog(
  logisticaPorVin: Map<string, LogisticaOperacionVIN> | null,
  cruce: ResultadoCruce | null,
  filtros: Omit<FiltrosLog, "mes">,
): MesCompraMarcaOption[] {
  const sinMes = universoLog(logisticaPorVin, cruce, { ...filtros, mes: null });
  const m = new Map<MesCompraMarcaKey, number>();
  for (const op of sinMes) {
    const k = mesCompraKey(op.fCompraMarca);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Array.from(m, ([key, count]) => ({ key, count, label: labelMes(key) }))
    .sort((a, b) => b.key.localeCompare(a.key));
}
