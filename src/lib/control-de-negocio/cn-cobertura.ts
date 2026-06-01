/**
 * Cobertura por hito · alimenta el EMBUDO vertical del módulo Control de Negocio.
 *
 * Diferencia con los otros selectores:
 *  · `cn-velocidad.ts` mide TRAMOS (entre dos hitos) — días.
 *  · `cn-quebrados.ts` mide HITOS FALTANTES sobre cohorte madura.
 *  · `cn-fne-atribuible.ts` clasifica FNE 1-a-1 por primer hito faltante.
 *  · `cn-cobertura.ts` (este) mide COBERTURA absoluta por hito sobre el
 *    universo total del mes (denominador fijo = Facturas) y calcula el
 *    delta vs hito previo.
 *
 * El embudo necesita:
 *   · 8 niveles (Facturas + 7 hitos del flujo)
 *   · Por nivel: count, %, delta vs nivel previo, responsable, banderas
 *     visuales (cobertura imperfecta cuando delta > 0, caída fuerte cuando
 *     delta ≤ -30% sobre Facturas).
 *
 * Cero React, función pura, mismo modelo operacional aprobado.
 */

import type { EntradaConsolidada } from "../historico/cruce-roma-actas";
import {
  RESPONSABLE_POR_HITO_FALTANTE,
  type HitoFaltante,
  type ResponsableHito,
} from "./cn-responsables";

export type HitoCobertura = "facturas" | HitoFaltante;

export const LABEL_HITO_COBERTURA: Record<HitoCobertura, string> = {
  facturas: "Facturas",
  solicitud_inscripcion: "Solicitud Inscripción",
  inscripcion: "Inscripción confirmada",
  patente_recibida: "Patente Recibida (RC → CdN)",
  patente_entregada: "Patente Entregada (CdN → Sucursal)",
  solicitud_entrega: "Solicitud Entrega",
  autorizacion_entrega: "Autorización Entrega",
  entrega_real: "Entrega Real",
};

/** Orden cronológico del embudo. */
export const ORDEN_COBERTURA: readonly HitoCobertura[] = [
  "facturas",
  "solicitud_inscripcion",
  "inscripcion",
  "patente_recibida",
  "patente_entregada",
  "solicitud_entrega",
  "autorizacion_entrega",
  "entrega_real",
] as const;

/**
 * Predicado "tiene el hito" para cada nivel del embudo.
 *
 * Notas:
 *  · `facturas` siempre devuelve true sobre el universo CN (que ya tiene
 *    `fFactura !== null`). El nivel raíz del embudo es 100% por construcción.
 *  · Tramos sin timestamp (5-6) se evalúan por el flag literal "Si"
 *    (validado en parser-actas.ts:572).
 *  · `entrega_real` usa la bandera `entregado` (derivada del parser por
 *    `entrega_auto_txt === "Cargado"` — fuente única, regla aprobada).
 */
const TIENE: Record<HitoCobertura, (f: EntradaConsolidada) => boolean> = {
  facturas:              (f) => f.fFactura instanceof Date,
  solicitud_inscripcion: (f) => f.fSolicitudInscripcion !== null,
  inscripcion:           (f) => f.fInscripcion !== null,
  patente_recibida:      (f) => f.fPatenteRecibida !== null,
  patente_entregada:     (f) => f.fPatenteEntregada !== null,
  solicitud_entrega:     (f) => (f.solEntrega ?? "").trim() === "Si",
  autorizacion_entrega:  (f) => (f.autorizacionEntrega ?? "").trim() === "Si",
  entrega_real:          (f) => f.entregado,
};

/** Umbral para marcar caída fuerte (⚠) — % vs facturas. */
const THRESHOLD_CAIDA_FUERTE = -30;

export interface FilaEmbudo {
  hito: HitoCobertura;
  label: string;
  count: number;
  /** % sobre el universo (denominador fijo = facturas). */
  pctSobreFacturas: number;
  /** Casos que NO tienen este hito en el universo (= facturas - count). */
  sinHito: number;
  /** count - count(hito previo). Positivo o negativo. 0 para facturas. */
  deltaAbs: number;
  /** Delta en puntos de % sobre facturas. */
  deltaPctSobreFacturas: number;
  /** Bandera *: cobertura imperfecta (hito posterior con más cobertura que el previo). */
  esCoberturaImperfecta: boolean;
  /** Bandera ⚠: caída fuerte (delta ≤ -30 pp). */
  esCaidaFuerte: boolean;
  /** Responsable operacional del hito. null para `facturas`. */
  responsable: ResponsableHito | null;
}

export interface EmbudoCobertura {
  universo: number;
  filas: FilaEmbudo[];
}

export function calcularEmbudoCobertura(
  universo: EntradaConsolidada[],
): EmbudoCobertura {
  const n = universo.length;
  if (n === 0) {
    return { universo: 0, filas: [] };
  }

  // Pre-computar counts (8 filtros sobre el universo, no es costoso).
  const counts: Record<HitoCobertura, number> = {
    facturas: 0,
    solicitud_inscripcion: 0,
    inscripcion: 0,
    patente_recibida: 0,
    patente_entregada: 0,
    solicitud_entrega: 0,
    autorizacion_entrega: 0,
    entrega_real: 0,
  };
  for (const h of ORDEN_COBERTURA) {
    counts[h] = universo.filter(TIENE[h]).length;
  }

  const filas: FilaEmbudo[] = [];
  let prevCount = counts.facturas;

  for (const h of ORDEN_COBERTURA) {
    const count = counts[h];
    const pct = (count / n) * 100;
    const deltaAbs = h === "facturas" ? 0 : count - prevCount;
    const deltaPctSobreFacturas = h === "facturas" ? 0 : (deltaAbs / n) * 100;
    const responsable = h === "facturas" ? null : RESPONSABLE_POR_HITO_FALTANTE[h];
    filas.push({
      hito: h,
      label: LABEL_HITO_COBERTURA[h],
      count,
      pctSobreFacturas: pct,
      sinHito: n - count,
      deltaAbs,
      deltaPctSobreFacturas,
      esCoberturaImperfecta: h !== "facturas" && deltaAbs > 0,
      esCaidaFuerte: deltaPctSobreFacturas <= THRESHOLD_CAIDA_FUERTE,
      responsable,
    });
    prevCount = count;
  }

  return { universo: n, filas };
}

/** Filas del universo que NO tienen el hito (para drill al click en barra). */
export function filasSinHito(
  universo: EntradaConsolidada[],
  hito: HitoCobertura,
): EntradaConsolidada[] {
  if (hito === "facturas") return [];
  return universo.filter((f) => !TIENE[hito](f));
}

/** Filas del universo que SÍ tienen el hito (uso secundario). */
export function filasConHito(
  universo: EntradaConsolidada[],
  hito: HitoCobertura,
): EntradaConsolidada[] {
  return universo.filter((f) => TIENE[hito](f));
}
