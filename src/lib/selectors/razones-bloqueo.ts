/**
 * Selector razones de no-entrega por VIN FNE.
 *
 * PREGUNTA OPERACIONAL: ¿Por qué este auto facturado no se ha entregado?
 *
 * Devuelve un array de razones simultáneas. Un auto con `bloqueos = []` es
 * 100% entregable. Si tiene 1+ bloqueos, mostramos cuál(es) y a quién
 * pertenece la responsabilidad de destrabarlo.
 *
 * Las razones se ordenan por prioridad de resolución: lo financiero primero
 * (cliente paga el crédito Pompeyo → se destraba) y después la cadena
 * operacional (sucursal → CdN → RC → admin → tránsito → recepción → entrega).
 */

import type { FNERealCruzado } from "../types";
import type { CreditoPompeyoVIN } from "./credito-pompeyo";
import { limpiarVIN } from "../parser/venta-apc";

export type TipoBloqueo =
  | "financiero"              // tiene Crédito Pompeyo
  | "logistica"               // auto físicamente no está en sucursal de venta
  | "inscripcion_comercial"   // sucursal no pidió inscripción
  | "inscripcion_cdn"         // Control de Negocios no mandó a RC
  | "inscripcion_rc"          // Registro Civil no inscribe
  | "admin_pompeyo"           // RC devolvió, admin no envía a sucursal
  | "patente_transito"        // patente enviada admin→sucursal, sin recibir
  | "solicitud_entrega"       // patente en sucursal pero sol_entrega ≠ Si
  | "autorizacion";           // todo listo, falta solo autorización de entrega

export type ResponsableBloqueo =
  | "Sucursal"
  | "Control de Negocios"
  | "Registro Civil"
  | "Administración Pompeyo"
  | "Logística"
  | "Cliente"
  | "Comercial / Entrega";

export interface Bloqueo {
  tipo: TipoBloqueo;
  responsable: ResponsableBloqueo;
  descripcion: string;
  /** Información adicional según el tipo (ej. monto del Crédito Pompeyo). */
  detalle?: string;
  /** Acción concreta que destraba el caso. */
  accionSugerida: string;
}

const META: Record<TipoBloqueo, Omit<Bloqueo, "detalle">> = {
  financiero: {
    tipo: "financiero",
    responsable: "Cliente",
    descripcion: "Crédito Pompeyo pendiente",
    accionSugerida: "Cobrar diferencia al cliente",
  },
  logistica: {
    tipo: "logistica",
    responsable: "Logística",
    descripcion: "Auto no está en sucursal de venta",
    accionSugerida: "Solicitar traslado a la sucursal",
  },
  inscripcion_comercial: {
    tipo: "inscripcion_comercial",
    responsable: "Sucursal",
    descripcion: "Sucursal no ha solicitado inscripción",
    accionSugerida: "Sucursal debe pedir inscripción",
  },
  inscripcion_cdn: {
    tipo: "inscripcion_cdn",
    responsable: "Control de Negocios",
    descripcion: "Control de Negocios no envió a Registro Civil",
    accionSugerida: "CdN debe procesar y enviar a RC",
  },
  inscripcion_rc: {
    tipo: "inscripcion_rc",
    responsable: "Registro Civil",
    descripcion: "Registro Civil no inscribe aún",
    accionSugerida: "Seguimiento RC",
  },
  admin_pompeyo: {
    tipo: "admin_pompeyo",
    responsable: "Administración Pompeyo",
    descripcion: "Patente en administración, no enviada a sucursal",
    accionSugerida: "Admin debe enviar patente a sucursal",
  },
  patente_transito: {
    tipo: "patente_transito",
    responsable: "Administración Pompeyo",
    descripcion: "Patente enviada, sucursal no la recibe aún",
    accionSugerida: "Confirmar recepción en sucursal",
  },
  solicitud_entrega: {
    tipo: "solicitud_entrega",
    responsable: "Comercial / Entrega",
    descripcion: "Patente en sucursal pero falta tramitar solicitud de entrega",
    accionSugerida: "Tramitar solicitud de entrega",
  },
  autorizacion: {
    tipo: "autorizacion",
    responsable: "Comercial / Entrega",
    descripcion: "Todo listo, falta firma de autorización",
    accionSugerida: "Firmar autorización de entrega",
  },
};

/** Orden visual: financiero arriba, luego cadena operacional. */
export const ORDEN_BLOQUEOS: TipoBloqueo[] = [
  "financiero",
  "logistica",
  "inscripcion_comercial",
  "inscripcion_cdn",
  "inscripcion_rc",
  "admin_pompeyo",
  "patente_transito",
  "solicitud_entrega",
  "autorizacion",
];

export function razonesBloqueoFNE(
  fne: FNERealCruzado,
  creditoMap: Map<string, CreditoPompeyoVIN>,
): Bloqueo[] {
  const bloqueos: Bloqueo[] = [];
  const vin = limpiarVIN(fne.fne.vin);

  // Financiero
  const cp = creditoMap.get(vin);
  if (cp) {
    bloqueos.push({
      ...META.financiero,
      detalle: `$${cp.monto.toLocaleString("es-CL")} en ${cp.saldos.length} saldo${cp.saldos.length > 1 ? "s" : ""}`,
    });
  }

  // Logística — si tenemos cruce con stock y el auto NO está en sucursal
  if (fne.autoEnSucursal === "no") {
    bloqueos.push({ ...META.logistica });
  }

  // Cadena operacional — un solo bloqueo según el estado actual del pipeline.
  // Cada estado representa una etapa: cuanto más arriba en el flujo, más lejos
  // de entrega. Excluimos "listo_para_entregar" (no es bloqueo).
  switch (fne.estadoEntrega) {
    case "falta_solo_autorizacion":
      bloqueos.push({ ...META.autorizacion });
      break;
    case "patente_en_sucursal":
      bloqueos.push({ ...META.solicitud_entrega });
      break;
    case "patente_en_transito":
      bloqueos.push({ ...META.patente_transito });
      break;
    case "patente_en_admin":
      bloqueos.push({ ...META.admin_pompeyo });
      break;
    case "inscrita_sin_admin":
      bloqueos.push({
        ...META.admin_pompeyo,
        descripcion: "Inscripción completa, esperando llegada a admin Pompeyo",
        accionSugerida: "Seguir recepción de patente desde Registro Civil",
      });
      break;
    case "en_registro_civil":
      bloqueos.push({ ...META.inscripcion_rc });
      break;
    case "en_control_negocios":
      bloqueos.push({ ...META.inscripcion_cdn });
      break;
    case "sin_solicitud_inscripcion":
      bloqueos.push({ ...META.inscripcion_comercial });
      break;
    case "listo_para_entregar":
      // sin bloqueo en cadena operacional
      break;
  }

  return bloqueos;
}

export type ClasificacionOperacional =
  | "listo_total"              // sin bloqueos
  | "bloqueado_solo_financiero" // solo Crédito Pompeyo
  | "bloqueado_solo_operativo"  // sin Crédito Pompeyo, falta algo operacional
  | "bloqueado_mixto";          // financiero + operativo

export function clasificarFNE(bloqueos: Bloqueo[]): ClasificacionOperacional {
  if (bloqueos.length === 0) return "listo_total";
  const tieneFin = bloqueos.some((b) => b.tipo === "financiero");
  const tieneOp = bloqueos.some((b) => b.tipo !== "financiero");
  if (tieneFin && tieneOp) return "bloqueado_mixto";
  if (tieneFin) return "bloqueado_solo_financiero";
  return "bloqueado_solo_operativo";
}

export const CLASIFICACION_LABEL: Record<ClasificacionOperacional, string> = {
  listo_total: "Listo para entregar",
  bloqueado_solo_financiero: "Bloqueado · solo financiero",
  bloqueado_solo_operativo: "Bloqueado · operacional",
  bloqueado_mixto: "Bloqueado · financiero + operacional",
};

export const CLASIFICACION_TONE: Record<
  ClasificacionOperacional,
  "success" | "danger" | "warning" | "muted"
> = {
  listo_total: "success",
  bloqueado_solo_financiero: "danger",
  bloqueado_solo_operativo: "warning",
  bloqueado_mixto: "danger",
};

export const RESPONSABLE_TONE: Record<
  ResponsableBloqueo,
  "info" | "warning" | "danger" | "muted" | "success"
> = {
  Cliente: "danger",
  Logística: "warning",
  Sucursal: "warning",
  "Control de Negocios": "info",
  "Registro Civil": "info",
  "Administración Pompeyo": "info",
  "Comercial / Entrega": "muted",
};
