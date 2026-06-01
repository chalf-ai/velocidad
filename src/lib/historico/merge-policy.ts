/**
 * MERGE POLICY DECLARATIVA — ROMA histórico anual.
 *
 * Función pura: dado un registro existente (consolidado de cortes anteriores)
 * y un registro entrante de un nuevo corte mensual, produce el merge resultante
 * más una lista de advertencias.
 *
 * Cero side effects. Cero dependencias de Prisma, store, React, fs ni red.
 * Diseñada para ser importable desde:
 *   - el parser ROMA acumulativo (cuando exista)
 *   - tests unitarios
 *   - scripts de análisis offline
 *
 * Política basada en la auditoría histórica documentada en
 * `diag/DECISION-HISTORICO-ROMA-ACTAS.md`, secciones 5 y 6.
 *
 * Tipología de campos:
 *   - INMUTABLE_FIRST  : primera ocurrencia gana; reportar si difiere
 *   - INMUTABLE_MIN_DATE : la fecha más antigua gana (eventos de origen)
 *   - EVOLUTIVO        : el más reciente gana (estado, comentario, paso)
 *   - EVOLUTIVO_FECHA  : el más reciente gana PERO null nunca pisa fecha válida
 *   - ESTABLE          : last-write-wins simple
 *   - DERIVADO         : no se almacena; se ignora si llega
 *
 * Nota: la decisión "no pisar fecha con null" es la sección 6.3 del documento
 * de decisiones (regla universal para campos evolutivos de tipo fecha).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type FieldPolicy =
  | "INMUTABLE_FIRST"
  | "INMUTABLE_MIN_DATE"
  | "EVOLUTIVO"
  | "EVOLUTIVO_FECHA"
  | "ESTABLE"
  | "DERIVADO";

/**
 * Fila ROMA cruda (post-parser). Subset suficiente para el merge.
 * Todos los campos opcionales: distintos meses traen distintas combinaciones.
 */
export interface RomaRowMerge {
  // Identidad (llave compuesta)
  ventaId: number;
  vin: string;

  // INMUTABLES — descriptivos del negocio
  marca?: string | null;
  modelo?: string | null;
  gerencia?: string | null;
  colorReferencial?: string | null;
  cajon?: string | null;

  // INMUTABLES de fecha (eventos de origen)
  fSolicitud?: Date | null;
  fFactura?: Date | null;
  fInscripcion?: Date | null;
  fVenta?: Date | null;

  // EVOLUTIVOS de estado
  estado?: string | null;        // Pendiente / Realizada / Anulada
  pasoActual?: string | null;
  comentario?: string | null;

  // EVOLUTIVOS de fecha (se reagendan, "no pisar con null")
  fETASucursal?: Date | null;
  fEstimadaEntrega?: Date | null;
  fRespuestaLogistica?: Date | null;
  fRespuestaInstalacionAcc?: Date | null;
  fETALlegadaCalc?: Date | null;

  // ESTABLES (raros que cambien)
  sucursal?: string | null;
  ventaAcc?: string | null;
  varTieneLamina?: string | null;
}

/**
 * Política por campo. Cada propiedad de RomaRowMerge tiene una política o es
 * implícitamente ignorada (DERIVADA / identidad). La constante exporta el
 * mapa para que sea auditable desde código y tests.
 */
export const ROMA_FIELD_POLICY: Record<keyof RomaRowMerge, FieldPolicy> = {
  // Identidad
  ventaId: "INMUTABLE_FIRST",
  vin: "INMUTABLE_FIRST",

  // INMUTABLES descriptivos
  marca: "INMUTABLE_FIRST",
  modelo: "INMUTABLE_FIRST",
  gerencia: "INMUTABLE_FIRST",
  colorReferencial: "INMUTABLE_FIRST",
  cajon: "INMUTABLE_FIRST",

  // INMUTABLES de fecha (eventos de origen)
  fSolicitud: "INMUTABLE_MIN_DATE",
  fFactura: "INMUTABLE_MIN_DATE",
  fInscripcion: "INMUTABLE_MIN_DATE",
  fVenta: "INMUTABLE_MIN_DATE",

  // EVOLUTIVOS
  estado: "EVOLUTIVO",
  pasoActual: "EVOLUTIVO",
  comentario: "EVOLUTIVO",

  // EVOLUTIVOS de fecha (no pisar con null)
  fETASucursal: "EVOLUTIVO_FECHA",
  fEstimadaEntrega: "EVOLUTIVO_FECHA",
  fRespuestaLogistica: "EVOLUTIVO_FECHA",
  fRespuestaInstalacionAcc: "EVOLUTIVO_FECHA",
  fETALlegadaCalc: "EVOLUTIVO_FECHA",

  // ESTABLES
  sucursal: "ESTABLE",
  ventaAcc: "ESTABLE",
  varTieneLamina: "ESTABLE",
};

// ─────────────────────────────────────────────────────────────────────────────
// Contexto del merge — datos del corte entrante
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Información del corte (mes/archivo) que aporta la fila entrante.
 * El consumidor (parser histórico) la inyecta; la lógica de merge la usa solo
 * para etiquetar advertencias y para la regla EVOLUTIVO (más reciente gana
 * = corte con mes posterior gana).
 */
export interface MergeContext {
  /** Identificador del corte entrante (mes YYYY-MM o fecha de corte ISO). */
  corteId: string;
  /** Fecha del corte entrante (para ordenar EVOLUTIVOS). */
  corteFecha: Date;
  /** Identificador del corte previo del registro existente (opcional). */
  cortePrevioId?: string;
  /** Fecha del corte previo (para ordenar). */
  cortePrevioFecha?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Advertencias
// ─────────────────────────────────────────────────────────────────────────────

export type WarningKind =
  | "INMUTABLE_CHANGED"
  | "INMUTABLE_MIN_DATE_CONFLICT"
  | "STATE_REGRESSION"
  | "NULL_OVERWRITE_PREVENTED"
  | "CORTE_ANTERIOR_OUT_OF_ORDER";

export interface MergeWarning {
  kind: WarningKind;
  ventaId: number;
  vin: string;
  field: keyof RomaRowMerge;
  prev: unknown;
  incoming: unknown;
  resolved: unknown;
  /** Texto explicativo legible para auditoría. */
  message: string;
  corteId: string;
}

export interface MergeResult {
  merged: RomaRowMerge;
  warnings: MergeWarning[];
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

function isStateRegression(prev: string | null | undefined, next: string | null | undefined): boolean {
  // Pendiente → cualquier cosa: avance normal
  // Realizada → Anulada: regresión observada en auditoría (documentada)
  // Realizada → Pendiente: regresión rara, alertable
  // Anulada → Pendiente: regresión rara, alertable
  if (!prev || !next || prev === next) return false;
  if (prev === "Realizada" && next === "Anulada") return true;
  if (prev === "Realizada" && next === "Pendiente") return true;
  if (prev === "Anulada" && next === "Pendiente") return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reglas atómicas
// ─────────────────────────────────────────────────────────────────────────────

/** INMUTABLE_FIRST: si difiere, advertir y conservar el existente. */
function applyImmutableFirst<T>(
  prev: T | null | undefined,
  next: T | null | undefined,
): { value: T | null | undefined; conflict: boolean } {
  if (isNullish(prev) && !isNullish(next)) return { value: next, conflict: false };
  if (!isNullish(prev) && isNullish(next)) return { value: prev, conflict: false };
  if (isNullish(prev) && isNullish(next)) return { value: prev, conflict: false };
  // Ambos definidos: comparar
  if (isDate(prev) && isDate(next)) {
    if (sameDate(prev, next)) return { value: prev, conflict: false };
    return { value: prev, conflict: true };
  }
  if (prev === next) return { value: prev, conflict: false };
  return { value: prev, conflict: true };
}

/** INMUTABLE_MIN_DATE: la fecha más antigua gana; advertir si difieren. */
function applyImmutableMinDate(
  prev: Date | null | undefined,
  next: Date | null | undefined,
): { value: Date | null | undefined; conflict: boolean } {
  if (isNullish(prev) && isNullish(next)) return { value: prev, conflict: false };
  if (isNullish(prev)) return { value: next, conflict: false };
  if (isNullish(next)) return { value: prev, conflict: false };
  if (sameDate(prev, next)) return { value: prev, conflict: false };
  // Conflicto: hay dos fechas distintas para un campo que debería ser inmutable.
  // Política: la más antigua gana (lo más cercano al evento original real).
  return { value: prev < next ? prev : next, conflict: true };
}

/** EVOLUTIVO: el corte más reciente gana, incluso si trae null. */
function applyEvolutivo<T>(
  prev: T | null | undefined,
  next: T | null | undefined,
  incomingIsNewer: boolean,
): T | null | undefined {
  return incomingIsNewer ? next : prev;
}

/** EVOLUTIVO_FECHA: el más reciente gana PERO null nunca pisa fecha válida. */
function applyEvolutivoFecha(
  prev: Date | null | undefined,
  next: Date | null | undefined,
  incomingIsNewer: boolean,
): { value: Date | null | undefined; preserved: boolean } {
  if (!incomingIsNewer) return { value: prev, preserved: false };
  // El entrante es más nuevo
  if (isNullish(next) && !isNullish(prev)) {
    // Regla "no pisar fecha con null"
    return { value: prev, preserved: true };
  }
  return { value: next, preserved: false };
}

/** ESTABLE: last-write-wins simple, sin protección de null. */
function applyEstable<T>(prev: T | null | undefined, next: T | null | undefined, incomingIsNewer: boolean): T | null | undefined {
  return incomingIsNewer ? next : prev;
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública: mergeRomaRows
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mergea dos filas ROMA del mismo VentaID+VIN según ROMA_FIELD_POLICY.
 *
 * Reglas globales:
 *   - Si la llave (ventaId, vin) difiere, retorna un warning y conserva
 *     existing sin tocar nada más.
 *   - El "más reciente" para EVOLUTIVOS es `context.corteFecha` mayor que
 *     `context.cortePrevioFecha`. Si no hay cortePrevioFecha, el incoming
 *     gana (es el primer dato evolutivo conocido).
 *   - Si corteFecha <= cortePrevioFecha, se considera "fuera de orden" y
 *     se reporta un warning suave. El merge se hace igual (las INMUTABLES
 *     no dependen del orden temporal).
 */
export function mergeRomaRows(
  existing: RomaRowMerge,
  incoming: RomaRowMerge,
  context: MergeContext,
): MergeResult {
  const warnings: MergeWarning[] = [];

  // 1) Guard: misma llave
  if (existing.ventaId !== incoming.ventaId) {
    warnings.push({
      kind: "INMUTABLE_CHANGED",
      ventaId: existing.ventaId,
      vin: existing.vin,
      field: "ventaId",
      prev: existing.ventaId,
      incoming: incoming.ventaId,
      resolved: existing.ventaId,
      message: `VentaID del incoming (${incoming.ventaId}) difiere del existente (${existing.ventaId}). No se mergea.`,
      corteId: context.corteId,
    });
    return { merged: existing, warnings };
  }
  if (existing.vin !== incoming.vin) {
    warnings.push({
      kind: "INMUTABLE_CHANGED",
      ventaId: existing.ventaId,
      vin: existing.vin,
      field: "vin",
      prev: existing.vin,
      incoming: incoming.vin,
      resolved: existing.vin,
      message: `VIN del incoming (${incoming.vin}) difiere del existente (${existing.vin}) para VentaID ${existing.ventaId}.`,
      corteId: context.corteId,
    });
    // En caso de divergencia de VIN, conservamos el existente pero no
    // hacemos return — seguimos mergeando lo demás bajo la llave del existente.
  }

  // 2) ¿El incoming es más reciente que el corte que aportó el existing?
  const incomingIsNewer =
    !context.cortePrevioFecha ||
    context.corteFecha.getTime() > context.cortePrevioFecha.getTime();

  if (
    context.cortePrevioFecha &&
    context.corteFecha.getTime() < context.cortePrevioFecha.getTime()
  ) {
    warnings.push({
      kind: "CORTE_ANTERIOR_OUT_OF_ORDER",
      ventaId: existing.ventaId,
      vin: existing.vin,
      field: "ventaId",
      prev: context.cortePrevioId ?? "(sin id previo)",
      incoming: context.corteId,
      resolved: "previo se mantiene como más reciente",
      message: `El corte ${context.corteId} es anterior a ${context.cortePrevioId}; los EVOLUTIVOS no se sobreescriben.`,
      corteId: context.corteId,
    });
  }

  // 3) Detectar regresión de estado (informativa, no bloqueante)
  if (incomingIsNewer && isStateRegression(existing.estado, incoming.estado)) {
    warnings.push({
      kind: "STATE_REGRESSION",
      ventaId: existing.ventaId,
      vin: existing.vin,
      field: "estado",
      prev: existing.estado,
      incoming: incoming.estado,
      resolved: incoming.estado,
      message: `Estado regresa de ${existing.estado} a ${incoming.estado} (comportamiento observado en histórico).`,
      corteId: context.corteId,
    });
  }

  // 4) Construir merged campo a campo según política
  const merged: RomaRowMerge = { ventaId: existing.ventaId, vin: existing.vin };

  for (const field of Object.keys(ROMA_FIELD_POLICY) as Array<keyof RomaRowMerge>) {
    if (field === "ventaId" || field === "vin") continue;
    const policy = ROMA_FIELD_POLICY[field];
    const prev = existing[field];
    const next = incoming[field];

    switch (policy) {
      case "INMUTABLE_FIRST": {
        const { value, conflict } = applyImmutableFirst(prev as unknown, next as unknown);
        if (conflict) {
          warnings.push({
            kind: "INMUTABLE_CHANGED",
            ventaId: existing.ventaId,
            vin: existing.vin,
            field,
            prev,
            incoming: next,
            resolved: value,
            message: `Campo INMUTABLE_FIRST '${field}' cambia entre cortes: ${String(prev)} → ${String(next)}. Conservado el primero.`,
            corteId: context.corteId,
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[field] = value;
        break;
      }
      case "INMUTABLE_MIN_DATE": {
        const { value, conflict } = applyImmutableMinDate(prev as Date | null | undefined, next as Date | null | undefined);
        if (conflict) {
          warnings.push({
            kind: "INMUTABLE_MIN_DATE_CONFLICT",
            ventaId: existing.ventaId,
            vin: existing.vin,
            field,
            prev,
            incoming: next,
            resolved: value,
            message: `Campo INMUTABLE_MIN_DATE '${field}' difiere entre cortes. Mantiene la fecha más antigua.`,
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
        const { value, preserved } = applyEvolutivoFecha(prev as Date | null | undefined, next as Date | null | undefined, incomingIsNewer);
        if (preserved) {
          warnings.push({
            kind: "NULL_OVERWRITE_PREVENTED",
            ventaId: existing.ventaId,
            vin: existing.vin,
            field,
            prev,
            incoming: next,
            resolved: value,
            message: `Campo EVOLUTIVO_FECHA '${field}' tenía fecha válida; corte nuevo trae null. Se preserva la fecha anterior.`,
            corteId: context.corteId,
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[field] = value;
        break;
      }
      case "ESTABLE": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[field] = applyEstable(prev as unknown, next as unknown, incomingIsNewer);
        break;
      }
      case "DERIVADO": {
        // No se almacena; se ignora.
        break;
      }
    }
  }

  return { merged, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper para construir un consolidador secuencial sobre N cortes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aplica `mergeRomaRows` secuencialmente sobre una serie de cortes para un
 * mismo VentaID+VIN, devolviendo el estado final y todas las advertencias
 * acumuladas. Cortes deben venir ordenados cronológicamente (de menor a
 * mayor `corteFecha`).
 */
export function consolidarRomaSerie(
  cortes: Array<{ row: RomaRowMerge; ctx: Omit<MergeContext, "cortePrevioId" | "cortePrevioFecha"> }>,
): MergeResult {
  if (cortes.length === 0) {
    throw new Error("consolidarRomaSerie: no se puede consolidar 0 cortes");
  }
  let acc: RomaRowMerge = cortes[0].row;
  let prevCtx = cortes[0].ctx;
  const allWarnings: MergeWarning[] = [];
  for (let i = 1; i < cortes.length; i++) {
    const { row, ctx } = cortes[i];
    const ctxFull: MergeContext = {
      ...ctx,
      cortePrevioId: prevCtx.corteId,
      cortePrevioFecha: prevCtx.corteFecha,
    };
    const { merged, warnings } = mergeRomaRows(acc, row, ctxFull);
    acc = merged;
    allWarnings.push(...warnings);
    prevCtx = ctx;
  }
  return { merged: acc, warnings: allWarnings };
}
