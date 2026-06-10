/**
 * Render del mensaje de notificación de tarea asignada.
 *
 * El mensaje se construye UNA vez al crear la tarea y queda congelado en
 * AlertaLog.mensaje (histórico inmutable — si la base cambia después, el
 * texto enviado no muta). Mismo principio de snapshot que usa el motor
 * histórico.
 *
 * F1: el mensaje se copia manualmente desde /notificaciones.
 * F2: César lo enviará tal cual vía whatsapp.py — por eso el formato usa
 *     *negrita* estilo WhatsApp y cero markdown web.
 */

export interface RenderTareaInput {
  /** Primer nombre del asignado ("Francisco"). */
  nombreAsignado: string;
  /** Cliente del caso ("Juan Pérez"). Si no existe, la línea se omite. */
  cliente?: string | null;
  vin: string | null;
  patente: string | null;
  marca: string | null;
  modelo: string | null;
  motivo: string | null;
  mensaje: string;
  /** Nombre de quien asigna ("David"). */
  nombreCreador: string;
  fechaCompromiso: Date | null;
  /** Link al caso (absoluto si hay APP_URL). */
  link: string;
}

/** Primer nombre a partir del nombre completo ("Francisco Marambio" → "Francisco"). */
export function primerNombre(nombre: string | null | undefined): string {
  const limpio = (nombre ?? "").trim();
  if (!limpio) return "Hola";
  return limpio.split(/\s+/)[0];
}

/**
 * Link al caso. Absoluto si APP_URL está definida (necesario para que el
 * link funcione en WhatsApp), relativo como fallback local.
 */
export function linkCaso(vin: string | null, claveCaso: string): string {
  const base = process.env.APP_URL?.replace(/\/+$/, "") ?? "";
  // VIN → ficha operacional vía Centro de Acción (deep-link existente).
  // Documental (SALDO-/BONO-/PROV-) → ruta del módulo correspondiente (futuro).
  const path = vin
    ? `/centro-accion?vin=${encodeURIComponent(vin)}`
    : `/centro-accion?clave=${encodeURIComponent(claveCaso)}`;
  return `${base}${path}`;
}

const FECHA_CL = new Intl.DateTimeFormat("es-CL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function renderMensajeTarea(input: RenderTareaInput): string {
  // Bloques separados por línea en blanco (formato WhatsApp legible).
  // Identificación en orden de prioridad: Cliente → Patente → Marca/modelo → VIN
  // — el asignado reconoce el caso por el cliente sin abrir el VIN.
  const identificacion: string[] = [];
  if (input.cliente?.trim()) identificacion.push(`Cliente: ${input.cliente.trim()}`);
  if (input.patente) identificacion.push(`Patente: ${input.patente}`);
  const marcaModelo = [input.marca, input.modelo].filter(Boolean).join(" ");
  if (marcaModelo) identificacion.push(`Marca/modelo: ${marcaModelo}`);
  if (input.vin) identificacion.push(`VIN: ${input.vin}`);

  const bloques: string[] = [];
  bloques.push(`${input.nombreAsignado}, tienes una nueva gestión asignada:`);
  if (identificacion.length) bloques.push(identificacion.join("\n"));
  if (input.motivo) bloques.push(`Motivo: ${input.motivo}`);
  if (input.mensaje.trim()) bloques.push(`Mensaje: ${input.mensaje.trim()}`);
  if (input.fechaCompromiso) {
    bloques.push(`Fecha compromiso: ${FECHA_CL.format(input.fechaCompromiso)}`);
  }
  bloques.push(`Solicitado por: ${input.nombreCreador}`);
  bloques.push(`Abrir caso:\n${input.link}`);
  return bloques.join("\n\n");
}
