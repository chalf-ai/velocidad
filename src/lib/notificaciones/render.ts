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
  const lineas: string[] = [];
  lineas.push(`${input.nombreAsignado}, tienes una nueva gestión asignada:`);
  if (input.vin) lineas.push(`VIN: ${input.vin}`);
  if (input.patente) lineas.push(`Patente: ${input.patente}`);
  const marcaModelo = [input.marca, input.modelo].filter(Boolean).join(" ");
  if (marcaModelo) lineas.push(`Marca/modelo: ${marcaModelo}`);
  if (input.motivo) lineas.push(`Motivo: ${input.motivo}`);
  if (input.mensaje.trim()) lineas.push(`Mensaje: ${input.mensaje.trim()}`);
  if (input.fechaCompromiso) {
    lineas.push(`Fecha compromiso: ${FECHA_CL.format(input.fechaCompromiso)}`);
  }
  lineas.push(`Solicitado por: ${input.nombreCreador}`);
  lineas.push(`Abrir caso: ${input.link}`);
  return lineas.join("\n");
}
