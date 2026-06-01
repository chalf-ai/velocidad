/**
 * Constantes operacionales del módulo Logística V1.
 *
 * Colores, labels y responsables canónicos del modelo Logística V1.0
 * (los 3 motores). Cualquier vista del módulo lee de acá.
 */

export type OwnerLog = "SUCURSAL_COMERCIAL" | "OPERADOR";

export const COLOR_POR_OWNER: Record<OwnerLog, string> = {
  SUCURSAL_COMERCIAL: "#E67E22", // naranja · brief V1.0
  OPERADOR: "#1F2A44", // navy · brief V1.0
};

export const LABEL_OWNER: Record<OwnerLog, string> = {
  SUCURSAL_COMERCIAL: "Sucursal + Comercial",
  OPERADOR: "Operador (KAR / SCHIAPP)",
};

export type MotorId = "m1" | "m2" | "m3";

export interface MotorMeta {
  id: MotorId;
  numero: 1 | 2 | 3;
  nombre: string;
  cubre: string;
  owner: OwnerLog;
  unidad: "dias" | "porcentaje";
}

export const MOTORES: Record<MotorId, MotorMeta> = {
  m1: {
    id: "m1",
    numero: 1,
    nombre: "Disponibilidad Comercial",
    cubre: "Almacén → Solicitud de despacho",
    owner: "SUCURSAL_COMERCIAL",
    unidad: "dias",
  },
  m2: {
    id: "m2",
    numero: 2,
    nombre: "Ejecución del Operador",
    cubre: "Solicitud → Despacho efectivo",
    owner: "OPERADOR",
    unidad: "dias",
  },
  m3: {
    id: "m3",
    numero: 3,
    nombre: "Cumplimiento del Operador",
    cubre: "Despachos cumplidos vs fecha prometida",
    owner: "OPERADOR",
    unidad: "porcentaje",
  },
};

// ── Operadores ────────────────────────────────────────────────────────────────
export type OperadorLog = "SCHIAPP" | "KAR";

export const COLOR_OPERADOR: Record<OperadorLog, string> = {
  SCHIAPP: "#8E44AD",
  KAR: "#2E86C1",
};

// ── Tipo de solicitud (sub-corte del M1) ──────────────────────────────────────
export type TipoSolicitudCanonico = "VENTA" | "VITRINA";

/** Tipos a EXCLUIR del módulo según brief §3 (R3 ampliado). */
export const TIPOS_EXCLUIDOS = new Set<string>([
  "TRASPASO",
  "TEST CAR",
  "TESTCAR",
  "DONANTE",
  "EN PROCESO",
  "USADOS",
  "FLOTA",
  "FLOTAS",
  "MAYORISTA",
]);

/** Pasa el tipoSolicitud crudo a un canónico (VENTA / VITRINA / null si excluido). */
export function canonizarTipoSolicitud(
  tipo: string | null | undefined,
): TipoSolicitudCanonico | null {
  if (!tipo) return null;
  const u = tipo.toUpperCase().trim();
  if (TIPOS_EXCLUIDOS.has(u)) return null;
  if (u.includes("VITRINA")) return "VITRINA";
  if (u.includes("VENTA")) return "VENTA";
  return null;
}
