/**
 * Tabla oficial de responsabilidades — Control de Negocio V1.0 REV.1.
 *
 * Regla aprobada: la causa raíz se asigna al área que debe INICIAR el
 * siguiente hito faltante, no a quien lo procesa.
 *
 * Fuente única de verdad para:
 *  · ProcesoQuebradoCard (Capa B)
 *  · FNEGrupoCard (Capa C)
 *  · ColaGestionableCN (columna "Responsable operacional")
 *
 * Anexo C del BRIEF_IMPLEMENTACION_Modulo_Control_de_Negocio_V1.md.
 */

export type HitoFaltante =
  | "solicitud_inscripcion"
  | "inscripcion"
  | "patente_recibida"
  | "patente_entregada"
  | "solicitud_entrega"
  | "autorizacion_entrega"
  | "entrega_real";

export interface ResponsableHito {
  area: AreaResponsable;
  rol: string;
}

export type AreaResponsable =
  | "COMERCIAL"
  | "COMERCIAL_SUCURSAL"
  | "COMERCIAL_CLIENTE"
  | "CONTROL_DE_NEGOCIO"
  | "CONTROL_DE_NEGOCIO_RC";

export const RESPONSABLE_POR_HITO_FALTANTE: Record<HitoFaltante, ResponsableHito> = {
  solicitud_inscripcion: { area: "COMERCIAL",              rol: "Vendedor / Adm. Sucursal" },
  inscripcion:           { area: "CONTROL_DE_NEGOCIO",     rol: "CdN (gestor RC)" },
  patente_recibida:      { area: "CONTROL_DE_NEGOCIO_RC",  rol: "CdN gestor patentes / RC" },
  patente_entregada:     { area: "CONTROL_DE_NEGOCIO",     rol: "CdN (despacho interno)" },
  solicitud_entrega:     { area: "COMERCIAL_SUCURSAL",     rol: "Vendedor" },
  autorizacion_entrega:  { area: "CONTROL_DE_NEGOCIO",     rol: "Jefe Sucursal / CdN" },
  entrega_real:          { area: "COMERCIAL_CLIENTE",      rol: "Vendedor + Cliente" },
};

export const ACCION_POR_HITO_FALTANTE: Record<HitoFaltante, string> = {
  solicitud_inscripcion: "Vendedor debe ingresar solicitud al sistema.",
  inscripcion:           "CdN debe escalar seguimiento al Registro Civil.",
  patente_recibida:      "CdN debe reclamar entrega de patente al Registro Civil.",
  patente_entregada:     "CdN debe despachar la patente a la sucursal.",
  solicitud_entrega:     "Vendedor debe iniciar la solicitud de entrega.",
  autorizacion_entrega:  "Autorizador debe revisar y autorizar entrega.",
  entrega_real:          "Vendedor debe coordinar entrega con cliente y cargar acta.",
};

/** Label legible del hito faltante para títulos de UI. */
export const LABEL_HITO_FALTANTE: Record<HitoFaltante, string> = {
  solicitud_inscripcion: "Sin solicitud inscripción",
  inscripcion:           "Sin inscripción",
  patente_recibida:      "Sin patente recibida",
  patente_entregada:     "Sin patente entregada",
  solicitud_entrega:     "Sin solicitud entrega",
  autorizacion_entrega:  "Sin autorización entrega",
  entrega_real:          "Sin entrega real",
};

/**
 * Orden cronológico del flujo. CRÍTICO para clasificar FNE por "primer hito
 * faltante" (Capa C) y para detectar el cuello dominante de cada caso.
 */
export const ORDEN_HITOS: readonly HitoFaltante[] = [
  "solicitud_inscripcion",
  "inscripcion",
  "patente_recibida",
  "patente_entregada",
  "solicitud_entrega",
  "autorizacion_entrega",
  "entrega_real",
] as const;

/** Color tag por área responsable (paleta aprobada en brief §12). */
export const COLOR_POR_AREA: Record<AreaResponsable, string> = {
  COMERCIAL:              "#B83B6A",
  COMERCIAL_SUCURSAL:     "#B83B6A",
  COMERCIAL_CLIENTE:      "#27AE60",
  CONTROL_DE_NEGOCIO:     "#1F2A44",
  CONTROL_DE_NEGOCIO_RC:  "#8E44AD",
};

export const LABEL_AREA: Record<AreaResponsable, string> = {
  COMERCIAL:              "Comercial",
  COMERCIAL_SUCURSAL:     "Comercial / Sucursal",
  COMERCIAL_CLIENTE:      "Comercial / Cliente",
  CONTROL_DE_NEGOCIO:     "Control de Negocio",
  CONTROL_DE_NEGOCIO_RC:  "Control de Negocio · RC",
};
