/**
 * MERGE POLICY DECLARATIVA — Actas histórico.
 *
 * Función pura: dado un registro Actas existente y uno entrante de un corte
 * posterior, produce el merge resultante más una lista de advertencias.
 *
 * Cero side effects. Cero dependencias de Prisma, store, React, fs ni red.
 *
 * Diferencias respecto a ROMA (sección 3 de la propuesta aprobada):
 *  - La llave canónica es VIN (Actas no usa VentaID confiable).
 *  - Dos políticas nuevas:
 *      · EVOLUTIVO_TRINARIO     "Si" > "No" > null/vacío. Una vez "Si", no degrada.
 *      · EVOLUTIVO_ESTADO_TXT   "Cargado" es terminal; no se permite degradar.
 *  - Recálculo determinístico de DERIVADOS (entregado, fEntregaReal,
 *    fuenteEntrega, fDocListoDerivado, fuenteDocListo, nivelDocumental) tras
 *    el merge — replicando la regla canónica del parser-actas.
 *  - Warnings propios: INSCRIPCION_REGRESSION, ENTREGA_REGRESSION_TXT,
 *    VALOR_FACTURA_CAMBIADO, ETAPA_RETROCEDIO. (VIN_DESAPARECIO se evalúa en
 *    el consolidador, no aquí.)
 *
 * Reserva del Eje 3 (Calidad de Cierre): el tipo `CalidadCierre` se exporta
 * pero el merge NO la calcula todavía. Queda definida para que el cruce
 * ROMA↔Actas pueda poblarla en un sprint posterior.
 */

import type { ActasRowMerge, NivelDocumental, FuenteEntrega } from "./parser-actas.js";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type ActasFieldPolicy =
  | "INMUTABLE_FIRST"
  | "INMUTABLE_MIN_DATE"
  | "EVOLUTIVO"
  | "EVOLUTIVO_FECHA"
  | "EVOLUTIVO_NUM_MAX"
  | "EVOLUTIVO_TRINARIO"
  | "EVOLUTIVO_ESTADO_TXT"
  | "ESTABLE"
  | "DERIVADO";

/**
 * Reserva del tercer eje (Calidad de Cierre). El cruce ROMA↔Actas la poblará
 * más adelante; el consolidador la deja en undefined.
 */
export type CalidadCierre = "correcto" | "huerfano" | "inconsistente";

/** Estado terminal para EVOLUTIVO_ESTADO_TXT: una vez aquí, no degrada. */
export const ESTADOS_TXT_TERMINALES = new Set<string>(["Cargado"]);

/** Orden de fuerza para EVOLUTIVO_TRINARIO (mayor índice = más fuerte). */
const TRINARIO_ORDEN: Record<string, number> = {
  "": 0,
  "no": 1,
  "si": 2,
};

// ─────────────────────────────────────────────────────────────────────────────
// Política por campo (sección 3 de la propuesta aprobada)
// ─────────────────────────────────────────────────────────────────────────────

export const ACTAS_FIELD_POLICY: Record<keyof ActasRowMerge, ActasFieldPolicy> = {
  // Identidad
  vin: "INMUTABLE_FIRST",
  id: "INMUTABLE_FIRST",

  // Estables descriptivos
  sucursal: "ESTABLE",
  cliente: "ESTABLE",
  vendedor: "ESTABLE",
  valorFactura: "ESTABLE", // se reporta warning si cambia >1%

  // Eventos documentales (de origen)
  fVenta: "INMUTABLE_MIN_DATE",
  fFactura: "INMUTABLE_MIN_DATE",
  fSolicitudInscripcion: "EVOLUTIVO_FECHA",
  fInscripcion: "EVOLUTIVO_FECHA",

  // Patente — recorrido de 4 hitos
  fPatenteAdmin: "EVOLUTIVO_FECHA",
  fPatenteEnviada: "EVOLUTIVO_FECHA",
  fPatenteRecibida: "EVOLUTIVO_FECHA",
  fPatenteEntregada: "EVOLUTIVO_FECHA",

  // Señales operacionales trinarias
  autorizacionEntrega: "EVOLUTIVO_TRINARIO",
  solEntrega: "EVOLUTIVO_TRINARIO",

  // Texto de entrega — política especial con estados terminales
  entregaAutoTxt: "EVOLUTIVO_ESTADO_TXT",

  // Derivados — recalculados tras el merge
  entregado: "DERIVADO",
  fEntregaReal: "DERIVADO",
  fuenteEntrega: "DERIVADO",
  fDocListoDerivado: "DERIVADO",
  fuenteDocListo: "DERIVADO",
  nivelDocumental: "DERIVADO",

  // Originales conservados
  estadoEntregaOriginal: "EVOLUTIVO", // texto crudo del último corte
  etapa: "EVOLUTIVO_NUM_MAX",
};

// ─────────────────────────────────────────────────────────────────────────────
// Contexto del merge
// ─────────────────────────────────────────────────────────────────────────────

export interface ActasMergeContext {
  corteId: string;
  corteFecha: Date;
  cortePrevioId?: string;
  cortePrevioFecha?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Advertencias
// ─────────────────────────────────────────────────────────────────────────────

export type ActasWarningKind =
  | "INMUTABLE_CHANGED"
  | "INMUTABLE_MIN_DATE_CONFLICT"
  | "NULL_OVERWRITE_PREVENTED"
  | "CORTE_ANTERIOR_OUT_OF_ORDER"
  | "INSCRIPCION_REGRESSION"
  | "ENTREGA_REGRESSION_TXT"
  | "VALOR_FACTURA_CAMBIADO"
  | "ETAPA_RETROCEDIO"
  | "TRINARIO_DEGRADACION_PREVENIDA";

export interface ActasMergeWarning {
  kind: ActasWarningKind;
  vin: string;
  field: keyof ActasRowMerge;
  prev: unknown;
  incoming: unknown;
  resolved: unknown;
  message: string;
  corteId: string;
}

export interface ActasMergeResult {
  merged: ActasRowMerge;
  warnings: ActasMergeWarning[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isNullish(v: unknown): v is null | undefined {
  return v === null || v === undefined;
}

function isDate(v: unknown): v is Date {
  return v instanceof Date && Number.isFinite(v.getTime());
}

function sameDate(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

function normTrinario(v: string | null | undefined): string {
  if (isNullish(v)) return "";
  return String(v).trim().toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Reglas atómicas
// ─────────────────────────────────────────────────────────────────────────────

function applyImmutableFirst<T>(
  prev: T | null | undefined,
  next: T | null | undefined,
): { value: T | null | undefined; conflict: boolean } {
  if (isNullish(prev) && !isNullish(next)) return { value: next, conflict: false };
  if (!isNullish(prev) && isNullish(next)) return { value: prev, conflict: false };
  if (isNullish(prev) && isNullish(next)) return { value: prev, conflict: false };
  if (isDate(prev) && isDate(next)) {
    if (sameDate(prev, next)) return { value: prev, conflict: false };
    return { value: prev, conflict: true };
  }
  if (prev === next) return { value: prev, conflict: false };
  return { value: prev, conflict: true };
}

function applyImmutableMinDate(
  prev: Date | null | undefined,
  next: Date | null | undefined,
): { value: Date | null | undefined; conflict: boolean } {
  if (isNullish(prev) && isNullish(next)) return { value: prev, conflict: false };
  if (isNullish(prev)) return { value: next, conflict: false };
  if (isNullish(next)) return { value: prev, conflict: false };
  if (sameDate(prev, next)) return { value: prev, conflict: false };
  return { value: prev < next ? prev : next, conflict: true };
}

function applyEvolutivo<T>(
  prev: T | null | undefined,
  next: T | null | undefined,
  incomingIsNewer: boolean,
): T | null | undefined {
  return incomingIsNewer ? next : prev;
}

function applyEvolutivoFecha(
  prev: Date | null | undefined,
  next: Date | null | undefined,
  incomingIsNewer: boolean,
): { value: Date | null | undefined; preserved: boolean; regression: boolean } {
  if (!incomingIsNewer) return { value: prev, preserved: false, regression: false };
  if (isNullish(next) && !isNullish(prev)) {
    return { value: prev, preserved: true, regression: false };
  }
  // Detección de regresión: la fecha existente era válida y la nueva es anterior
  if (isDate(prev) && isDate(next) && next.getTime() < prev.getTime()) {
    return { value: next, preserved: false, regression: true };
  }
  return { value: next, preserved: false, regression: false };
}

function applyEvolutivoNumMax(
  prev: number | null | undefined,
  next: number | null | undefined,
  incomingIsNewer: boolean,
): { value: number | null | undefined; retroceso: boolean } {
  if (!incomingIsNewer) return { value: prev, retroceso: false };
  if (isNullish(next)) return { value: prev, retroceso: false };
  if (isNullish(prev)) return { value: next, retroceso: false };
  if (next < prev) return { value: prev, retroceso: true };
  return { value: next, retroceso: false };
}

function applyEvolutivoTrinario(
  prev: string | null | undefined,
  next: string | null | undefined,
  incomingIsNewer: boolean,
): { value: string | null | undefined; degradacion: boolean } {
  if (!incomingIsNewer) return { value: prev, degradacion: false };
  const np = normTrinario(prev);
  const nn = normTrinario(next);
  const op = TRINARIO_ORDEN[np] ?? 0;
  const on = TRINARIO_ORDEN[nn] ?? 0;
  if (on < op) return { value: prev, degradacion: true };
  // El nuevo es igual o más fuerte; conservar el texto entrante (preserva mayúsculas)
  if (on === 0 && op > 0) return { value: prev, degradacion: true };
  return { value: isNullish(next) ? prev : next, degradacion: false };
}

function applyEvolutivoEstadoTxt(
  prev: string | null | undefined,
  next: string | null | undefined,
  incomingIsNewer: boolean,
): { value: string | null | undefined; regression: boolean } {
  if (!incomingIsNewer) return { value: prev, regression: false };
  const prevS = isNullish(prev) ? "" : String(prev).trim();
  const nextS = isNullish(next) ? "" : String(next).trim();
  // Terminal no se degrada: si prev es terminal y next NO es el mismo terminal, conservar prev.
  if (ESTADOS_TXT_TERMINALES.has(prevS) && prevS !== nextS) {
    return { value: prev, regression: true };
  }
  // Si next es null/vacío, no pisar texto previo (a menos que prev también esté vacío)
  if (nextS === "" && prevS !== "") {
    return { value: prev, regression: false };
  }
  return { value: next, regression: false };
}

function applyEstable<T>(
  prev: T | null | undefined,
  next: T | null | undefined,
  incomingIsNewer: boolean,
): T | null | undefined {
  return incomingIsNewer ? next : prev;
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivados — réplica de la regla del parser
// ─────────────────────────────────────────────────────────────────────────────

function detectarEntregado(
  entregaAutoTxt: string | null,
  fPatenteEntregada: Date | null,
): { entregado: boolean; fEntregaReal: Date | null; fuenteEntrega: FuenteEntrega } {
  const txt = (entregaAutoTxt ?? "").trim();
  if (txt === "Cargado") {
    return { entregado: true, fEntregaReal: fPatenteEntregada, fuenteEntrega: "entrega_auto_txt" };
  }
  if (fPatenteEntregada !== null) {
    return { entregado: true, fEntregaReal: fPatenteEntregada, fuenteEntrega: "fecha_patente_entregada" };
  }
  return { entregado: false, fEntregaReal: null, fuenteEntrega: "ninguna" };
}

function derivarDocListo(
  fPatenteRecibida: Date | null,
  fInscripcion: Date | null,
): { fDocListoDerivado: Date | null; fuenteDocListo: "patente_recibida" | "inscripcion" | "ninguna" } {
  if (fPatenteRecibida) return { fDocListoDerivado: fPatenteRecibida, fuenteDocListo: "patente_recibida" };
  if (fInscripcion) return { fDocListoDerivado: fInscripcion, fuenteDocListo: "inscripcion" };
  return { fDocListoDerivado: null, fuenteDocListo: "ninguna" };
}

function derivarNivelDocumental(args: {
  entregado: boolean;
  fFactura: Date | null;
  fInscripcion: Date | null;
  fPatenteRecibida: Date | null;
  fEntregaReal: Date | null;
}): NivelDocumental {
  const { entregado, fFactura, fInscripcion, fPatenteRecibida, fEntregaReal } = args;
  if (fFactura && fInscripcion && fPatenteRecibida && (!entregado || fEntregaReal)) {
    return "completo";
  }
  if (fFactura && fInscripcion) return "parcial";
  return "minimo";
}

function recomputarDerivados(merged: ActasRowMerge): ActasRowMerge {
  const det = detectarEntregado(merged.entregaAutoTxt, merged.fPatenteEntregada);
  const doc = derivarDocListo(merged.fPatenteRecibida, merged.fInscripcion);
  const nivelDocumental = derivarNivelDocumental({
    entregado: det.entregado,
    fFactura: merged.fFactura,
    fInscripcion: merged.fInscripcion,
    fPatenteRecibida: merged.fPatenteRecibida,
    fEntregaReal: det.fEntregaReal,
  });
  return {
    ...merged,
    entregado: det.entregado,
    fEntregaReal: det.fEntregaReal,
    fuenteEntrega: det.fuenteEntrega,
    fDocListoDerivado: doc.fDocListoDerivado,
    fuenteDocListo: doc.fuenteDocListo,
    nivelDocumental,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública: mergeActasRows
// ─────────────────────────────────────────────────────────────────────────────

export function mergeActasRows(
  existing: ActasRowMerge,
  incoming: ActasRowMerge,
  context: ActasMergeContext,
): ActasMergeResult {
  const warnings: ActasMergeWarning[] = [];

  // 1) Guard de llave: VIN debe coincidir (lo decide el caller, no aquí)
  if (existing.vin !== incoming.vin) {
    warnings.push({
      kind: "INMUTABLE_CHANGED",
      vin: existing.vin,
      field: "vin",
      prev: existing.vin,
      incoming: incoming.vin,
      resolved: existing.vin,
      message: `VIN del incoming (${incoming.vin}) difiere del existente (${existing.vin}). No se mergea.`,
      corteId: context.corteId,
    });
    return { merged: existing, warnings };
  }

  // 2) ¿Es el incoming más reciente que el último corte conocido?
  const incomingIsNewer =
    !context.cortePrevioFecha ||
    context.corteFecha.getTime() > context.cortePrevioFecha.getTime();

  if (
    context.cortePrevioFecha &&
    context.corteFecha.getTime() < context.cortePrevioFecha.getTime()
  ) {
    warnings.push({
      kind: "CORTE_ANTERIOR_OUT_OF_ORDER",
      vin: existing.vin,
      field: "vin",
      prev: context.cortePrevioId ?? "(sin id previo)",
      incoming: context.corteId,
      resolved: "previo se mantiene como más reciente",
      message: `El corte ${context.corteId} es anterior a ${context.cortePrevioId}; los EVOLUTIVOS no se sobreescriben.`,
      corteId: context.corteId,
    });
  }

  // 3) Construir merged campo a campo
  const merged: ActasRowMerge = { ...existing };

  for (const field of Object.keys(ACTAS_FIELD_POLICY) as Array<keyof ActasRowMerge>) {
    if (field === "vin") continue;
    const policy = ACTAS_FIELD_POLICY[field];
    const prev = existing[field];
    const next = incoming[field];

    switch (policy) {
      case "INMUTABLE_FIRST": {
        const { value, conflict } = applyImmutableFirst(prev as unknown, next as unknown);
        if (conflict) {
          warnings.push({
            kind: "INMUTABLE_CHANGED",
            vin: existing.vin,
            field,
            prev,
            incoming: next,
            resolved: value,
            message: `Campo INMUTABLE_FIRST '${String(field)}' cambia entre cortes: ${String(prev)} → ${String(next)}. Conservado el primero.`,
            corteId: context.corteId,
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[field] = value;
        break;
      }
      case "INMUTABLE_MIN_DATE": {
        const { value, conflict } = applyImmutableMinDate(prev as Date | null, next as Date | null);
        if (conflict) {
          warnings.push({
            kind: "INMUTABLE_MIN_DATE_CONFLICT",
            vin: existing.vin,
            field,
            prev,
            incoming: next,
            resolved: value,
            message: `Campo INMUTABLE_MIN_DATE '${String(field)}' difiere entre cortes. Mantiene la fecha más antigua.`,
            corteId: context.corteId,
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[field] = value;
        break;
      }
      case "EVOLUTIVO": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[field] = applyEvolutivo(prev as unknown, next as unknown, incomingIsNewer);
        break;
      }
      case "EVOLUTIVO_FECHA": {
        const { value, preserved, regression } = applyEvolutivoFecha(
          prev as Date | null,
          next as Date | null,
          incomingIsNewer,
        );
        if (preserved) {
          warnings.push({
            kind: "NULL_OVERWRITE_PREVENTED",
            vin: existing.vin,
            field,
            prev,
            incoming: next,
            resolved: value,
            message: `Campo EVOLUTIVO_FECHA '${String(field)}' tenía fecha válida; corte nuevo trae null. Se preserva la fecha anterior.`,
            corteId: context.corteId,
          });
        }
        if (regression && field === "fInscripcion") {
          warnings.push({
            kind: "INSCRIPCION_REGRESSION",
            vin: existing.vin,
            field,
            prev,
            incoming: next,
            resolved: value,
            message: `fInscripcion retrocede entre cortes (${(prev as Date).toISOString().slice(0, 10)} → ${(next as Date).toISOString().slice(0, 10)}).`,
            corteId: context.corteId,
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[field] = value;
        break;
      }
      case "EVOLUTIVO_NUM_MAX": {
        const { value, retroceso } = applyEvolutivoNumMax(
          prev as number | null,
          next as number | null,
          incomingIsNewer,
        );
        if (retroceso) {
          warnings.push({
            kind: "ETAPA_RETROCEDIO",
            vin: existing.vin,
            field,
            prev,
            incoming: next,
            resolved: value,
            message: `Campo EVOLUTIVO_NUM_MAX '${String(field)}' retrocede: ${String(prev)} → ${String(next)}. Conservado el máximo.`,
            corteId: context.corteId,
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[field] = value;
        break;
      }
      case "EVOLUTIVO_TRINARIO": {
        const { value, degradacion } = applyEvolutivoTrinario(
          prev as string | null,
          next as string | null,
          incomingIsNewer,
        );
        if (degradacion) {
          warnings.push({
            kind: "TRINARIO_DEGRADACION_PREVENIDA",
            vin: existing.vin,
            field,
            prev,
            incoming: next,
            resolved: value,
            message: `Campo EVOLUTIVO_TRINARIO '${String(field)}' intentó degradar ${String(prev)} → ${String(next)}. Conservado el más fuerte.`,
            corteId: context.corteId,
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[field] = value;
        break;
      }
      case "EVOLUTIVO_ESTADO_TXT": {
        const { value, regression } = applyEvolutivoEstadoTxt(
          prev as string | null,
          next as string | null,
          incomingIsNewer,
        );
        if (regression) {
          warnings.push({
            kind: "ENTREGA_REGRESSION_TXT",
            vin: existing.vin,
            field,
            prev,
            incoming: next,
            resolved: value,
            message: `Campo terminal '${String(field)}' intentó degradar ${String(prev)} → ${String(next)}. Conservado el terminal.`,
            corteId: context.corteId,
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[field] = value;
        break;
      }
      case "ESTABLE": {
        // Caso especial: valorFactura emite warning si cambia >1%
        if (field === "valorFactura" && incomingIsNewer) {
          const p = typeof prev === "number" ? prev : 0;
          const n = typeof next === "number" ? next : 0;
          if (p > 0 && n > 0) {
            const diff = Math.abs(n - p) / p;
            if (diff > 0.01) {
              warnings.push({
                kind: "VALOR_FACTURA_CAMBIADO",
                vin: existing.vin,
                field,
                prev,
                incoming: next,
                resolved: next,
                message: `valorFactura cambia >1%: ${p} → ${n} (Δ=${(diff * 100).toFixed(2)}%).`,
                corteId: context.corteId,
              });
            }
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[field] = applyEstable(prev as unknown, next as unknown, incomingIsNewer);
        break;
      }
      case "DERIVADO": {
        // No se almacena directamente; se recomputa después del merge.
        break;
      }
    }
  }

  // 4) Recomputar derivados a partir del estado mergeado
  const final = recomputarDerivados(merged);

  return { merged: final, warnings };
}
