/**
 * RESERVA / VENTA VIGENTE · señal visual para Caja Comercial Gestionable.
 *
 * Regla de negocio (decisión usuario 2026-06): un vehículo con reserva vigente
 * NO sale de Caja Comercial Gestionable — sigue consumiendo caja hasta un evento
 * REAL de salida (facturación / entrega / salida de stock). La reserva solo se
 * MARCA visualmente como "en proceso de salida". Este módulo NO altera la
 * membresía de la métrica; solo deriva la señal de presentación.
 *
 * Fuente (auditoría 2026-06, Base_Stock): `estadoVenta` (col 8) ∈ {Vigente,
 * Aprobada} = reserva vigente (folio/vendedor/fechaVenta presentes 45/45 en los
 * 320). `estadoVenta` NO trae "vencida"/"caída"; se derivan:
 *   · vencida → reserva vigente con aging > 15 días desde fechaVenta (sin avance).
 *   · caída   → estadoDealer = "RESCILIACION" (contrato rescindido, venta caída).
 *
 * Semáforo: vigente=verde claro · vencida=amarillo · caída=rojo suave · sin color.
 */

import type { VehiculoUnificado } from "./vehiculo-unificado";

export type EstadoReserva = "vigente" | "vencida" | "caida" | "sin_reserva";

/** Aging (días desde la reserva) sobre el cual una reserva vigente se marca
 *  "sin avance" (amarillo). Calibrable sin cambiar lógica. */
export const RESERVA_AGING_VENCIDA_DIAS = 15;

const ESTADOS_VIGENTES = new Set(["VIGENTE", "APROBADA"]);

export interface ReservaInfo {
  estado: EstadoReserva;
  /** "Vigente" | "Aprobada" | null (crudo de Base_Stock). */
  estadoVenta: string | null;
  /** true si estadoVenta = "Aprobada" (venta firmada, más avanzada). */
  aprobada: boolean;
  folio: string | null;
  vendedor: string | null;
  fechaVenta: Date | null;
  /** Días desde fechaVenta hasta `hoy` (null si no hay fecha). */
  agingDias: number | null;
  /** Texto del chip ("Reserva vigente" | "Venta aprobada" | "Reserva vencida" |
   *  "Resciliación") o null si no hay reserva. */
  badge: string | null;
}

const SIN_RESERVA = (estadoVenta: string | null): ReservaInfo => ({
  estado: "sin_reserva",
  estadoVenta,
  aprobada: false,
  folio: null,
  vendedor: null,
  fechaVenta: null,
  agingDias: null,
  badge: null,
});

/**
 * Deriva la señal de reserva de un VU. `hoy` parametrizable para determinismo
 * en tests / cálculo por corte.
 */
export function reservaDeVU(vu: VehiculoUnificado, hoy: Date = new Date()): ReservaInfo {
  const ev = (vu.estadoVenta ?? "").trim();
  const fecha = vu.fechaVenta ? new Date(vu.fechaVenta) : null;
  const aging =
    fecha && !Number.isNaN(fecha.getTime())
      ? Math.floor((hoy.getTime() - fecha.getTime()) / 86_400_000)
      : null;

  if (ESTADOS_VIGENTES.has(ev.toUpperCase())) {
    const aprobada = ev.toUpperCase() === "APROBADA";
    const vencida = aging != null && aging > RESERVA_AGING_VENCIDA_DIAS;
    return {
      estado: vencida ? "vencida" : "vigente",
      estadoVenta: ev || null,
      aprobada,
      folio: vu.folioVenta?.trim() || null,
      vendedor: vu.vendedor?.trim() || null,
      fechaVenta: fecha,
      agingDias: aging,
      badge: vencida ? "Reserva vencida" : aprobada ? "Venta aprobada" : "Reserva vigente",
    };
  }

  if ((vu.estadoDealer ?? "").toUpperCase() === "RESCILIACION") {
    return {
      estado: "caida",
      estadoVenta: ev || null,
      aprobada: false,
      folio: vu.folioVenta?.trim() || null,
      vendedor: vu.vendedor?.trim() || null,
      fechaVenta: fecha,
      agingDias: aging,
      badge: "Resciliación",
    };
  }

  return SIN_RESERVA(ev || null);
}

/** ¿El VU tiene una reserva/venta vigente (vigente o vencida)? Para conteos. */
export function tieneReservaVigente(vu: VehiculoUnificado, hoy: Date = new Date()): boolean {
  const e = reservaDeVU(vu, hoy).estado;
  return e === "vigente" || e === "vencida";
}
