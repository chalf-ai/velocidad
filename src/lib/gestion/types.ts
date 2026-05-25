/**
 * Capa de gestión accionable por VIN.
 *
 * Persiste por VIN en localStorage (key: GESTION_STORAGE_KEY). Si vuelve
 * a cargarse una base nueva con el mismo VIN, los datos de gestión se
 * recuperan automáticamente.
 *
 * El módulo es genérico — sirve para FNE, pero también para futuros
 * módulos (capital pagado, judicial, etc.) que necesiten dejar notas
 * accionables por vehículo.
 */

// ─────────────────────────────────────────────────────────────────────────
// ROADMAP · FASE MULTIUSUARIO  (NO implementado todavía — solo planificado)
//
// Hoy la gestión vive client-side por VIN en localStorage (un solo usuario,
// un solo navegador). El objetivo futuro es migrar a una base compartida
// multiusuario sin reescribir el modelo. Este bloque documenta el plan y deja
// constancia de que el modelo ACTUAL no cierra esa posibilidad.
//
// Objetivo futuro:
//   - Varios gerentes/jefes comentan el MISMO VIN.
//   - Cada comentario queda con usuario, fecha y rol.
//   - Asignación de responsable + (futuro) notificación por correo.
//   - Maestro de responsables por sucursal, marca, módulo y tipo de bloqueo.
//
// Por qué el modelo actual YA es forward-compatible (no requiere romper nada):
//   1. La gestión se indexa por VIN normalizado (no por módulo/página/fila),
//      así que ya es la unidad correcta para colaboración multiusuario.
//   2. `GestionVIN` es un objeto plano: agregar campos OPCIONALES nuevos
//      (`usuario`, `rol`, `notificado`) es aditivo y NO rompe los registros
//      ya guardados en localStorage (los viejos quedan con esos campos
//      undefined). NO se debe bumpear GESTION_SCHEMA_VERSION por agregar
//      campos opcionales — solo si cambia la forma de los existentes.
//   3. `HistorialEntry` es una lista append-only: cada entrada puede ganar
//      `usuario`/`rol` opcionales por cambio, manteniendo las entradas viejas.
//   4. `maestroResponsables` será una TABLA/STORE SEPARADO (no toca GestionVIN),
//      así que se puede sumar sin migración del modelo de gestión.
//
// Migración a backend (futuro): el store (useGestionStore) ya aísla la
// persistencia en loadFromStorage/saveToStorage. Reemplazar ese sink por una
// API/DB no obliga a tocar los componentes (siguen llamando setGestion/byVin).
//
// Columnas/estructuras futuras (NO crear todavía):
//   GestionVIN.usuario?: string            // quién tiene el caso
//   GestionVIN.rol?: string                // gerente / jefe sucursal / finanzas
//   GestionVIN.notificado?: boolean        // notificadoSí/No al responsable
//   HistorialEntry.usuario?: string        // autor del cambio
//   HistorialEntry.rol?: string
//   interface MaestroResponsable {         // tabla maestro separada
//     responsable: string; rol: string;
//     sucursal?: string; marca?: string;
//     modulo?: string; tipoBloqueo?: string; email?: string;
//   }
//
// Por ahora: NO programar email, NO usuarios, NO backend. Solo este roadmap.
// ─────────────────────────────────────────────────────────────────────────

export type EstadoGestion =
  | "abierto"
  | "en_curso"
  | "esperando"
  | "resuelto"
  | "cancelado";

export type PrioridadManual = "baja" | "media" | "alta" | "critica" | null;

export interface HistorialEntry {
  /** ISO datetime. */
  fecha: string;
  /** Campo que cambió ("estadoGestion", "comentario", etc.). */
  campo: string;
  /** Valor anterior como texto (null → "—"). */
  valorAnterior: string;
  /** Valor nuevo como texto. */
  valorNuevo: string;
}

export interface GestionVIN {
  vin: string;
  /** CONTEXTO: por qué está detenido / blocker / situación actual. */
  comentario: string | null;
  /**
   * PRÓXIMA ACCIÓN concreta a ejecutar (distinta del contexto).
   * OPCIONAL y aditivo: los registros viejos en localStorage no lo traen
   * (quedan `undefined`). NO bumpear GESTION_SCHEMA_VERSION por esto — es
   * un campo opcional nuevo, compatible hacia atrás (ver roadmap arriba).
   */
  proximaAccion?: string | null;
  responsable: string | null;
  /**
   * Email del responsable — PREPARADO para notificación automática futura.
   * OPCIONAL y aditivo (registros viejos quedan `undefined`). NO bumpear
   * GESTION_SCHEMA_VERSION por esto (ver roadmap arriba). Hoy NO se envían
   * correos: solo se captura para que el notificador futuro lo consuma.
   */
  responsableEmail?: string | null;
  /**
   * Ownership: quién creó / posee el caso (futuro multiusuario). OPCIONAL y
   * aditivo. Hoy informativo; base de la atribución multiusuario futura.
   */
  ownership?: string | null;
  /** ISO date (YYYY-MM-DD). */
  fechaCompromiso: string | null;
  estadoGestion: EstadoGestion;
  /** Override manual del score automático. null = usar el calculado. */
  prioridadManual: PrioridadManual;
  /** Historial de cambios — FIFO con cap de 50 entradas. */
  historial: HistorialEntry[];
  /** ISO datetime — actualizado en cada write. */
  ultimaActualizacion: string;
}

export const ESTADO_GESTION_LABEL: Record<EstadoGestion, string> = {
  abierto: "Abierto",
  en_curso: "En curso",
  esperando: "Esperando tercero",
  resuelto: "Resuelto",
  cancelado: "Cancelado",
};

export const ESTADO_GESTION_TONE: Record<
  EstadoGestion,
  "muted" | "info" | "warning" | "success" | "danger"
> = {
  abierto: "muted",
  en_curso: "info",
  esperando: "warning",
  resuelto: "success",
  cancelado: "danger",
};

export const ESTADOS_GESTION_ORDEN: EstadoGestion[] = [
  "abierto",
  "en_curso",
  "esperando",
  "resuelto",
  "cancelado",
];

/** Versión de schema — bump si cambia la forma de GestionVIN. */
export const GESTION_SCHEMA_VERSION = 1;

export const GESTION_STORAGE_KEY = `stock-command-center:gestion:v${GESTION_SCHEMA_VERSION}`;
