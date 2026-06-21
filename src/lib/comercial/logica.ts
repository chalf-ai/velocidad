/**
 * Velocity Comercial V1 · lógica de decisión (pura, sin ROMA).
 *
 * Clasifica cada modelo en una situación y emite SOLO acciones del catálogo
 * oficial, en la jerarquía oficial de intención (VPP > crédito). En ROMA vivo
 * hoy solo está la VPP activa; los peldaños finos (tasada/inspeccionada/carta)
 * y P4 (mover VPP detenida) quedan declarados pendientes de AutoRed.
 */

import type { ModeloComercial } from "./queries";

export type Situacion = "atencion" | "oportunidad" | "estable";
export type AccionId = "A1" | "A2" | "A3a" | "P3" | "P4" | "P5" | "P1";

export const ACCIONES: Record<AccionId, string> = {
  A1: "Conseguir stock",
  A2: "Redistribuir stock",
  A3a: "Priorizar foco comercial",
  P3: "Destrabar financiamiento",
  P4: "Mover VPP / tasación detenida",
  P5: "Destrabar venta vigente",
  P1: "Reactivar cotización",
};

export type Accion = { id: AccionId; nombre: string; detalle: string };

export type EvalModelo = {
  situacion: Situacion;
  motivo: string;
  acciones: Accion[];
  accionPrincipal: Accion | null;
  altaIntencion: number; // negocios de alta intención = VPP activa + sin firmar + aprobados
};

// Umbrales (calibración inicial — explícitos para auditar).
const STOCK_BAJO = 10;
const ENVEJECIDO_PCT = 0.3;
const SIN_FIRMAR_ALTO = 8;

export function tendenciaTexto(m: ModeloComercial): string {
  const d = m.demanda;
  switch (d.tendencia) {
    case "creciente": return `demanda en alza (+${d.deltaPct}% vs mes anterior)`;
    case "cayendo": return `demanda a la baja (${d.deltaPct}% vs mes anterior)`;
    case "estable": return "demanda estable vs mes anterior";
    default: return "sin base comparable del mes anterior";
  }
}

export function evaluarModelo(m: ModeloComercial): EvalModelo {
  const { disponibles, sobre90, diasMax } = m.stock;
  const creciente = m.demanda.tendencia === "creciente";
  const sinFirmar = m.vigentes.creditoSinFirmar;
  const vpp = m.vigentes.vppActiva;
  const aprob = m.credito.aprobado;
  const solic = m.credito.solicitud;

  const quiebre = disponibles > 0 && disponibles <= STOCK_BAJO && creciente;
  const envejecido = disponibles > 0 && (sobre90 / disponibles >= ENVEJECIDO_PCT || sobre90 >= 10);
  const sinFirmarAlto = sinFirmar >= SIN_FIRMAR_ALTO;

  const altaIntencion = vpp + sinFirmar + aprob;

  // ── Acciones, en JERARQUÍA OFICIAL (VPP > crédito), luego stock ──
  const acciones: Accion[] = [];
  if (vpp > 0)
    acciones.push({ id: "P5", nombre: ACCIONES.P5, detalle: `Asegurar cierre de ${vpp} vigentes con VPP activa (trade-in tomado, señal #1)` });
  if (sinFirmar > 0)
    acciones.push({ id: "P3", nombre: ACCIONES.P3, detalle: `Perseguir la firma de ${sinFirmar} créditos sin firmar` });
  if (aprob > 0)
    acciones.push({ id: "A3a", nombre: ACCIONES.A3a, detalle: `Empujar ${aprob} aprobados a cierre antes de que se enfríen` });
  if (quiebre)
    acciones.push({ id: "A1", nombre: ACCIONES.A1, detalle: `Reponer stock: ${disponibles} u. con demanda en alza` });
  if (envejecido)
    acciones.push({ id: "A2", nombre: ACCIONES.A2, detalle: `Mover ${sobre90} u. sobre 90 días (máx ${diasMax}d)` });
  // P1 solo si NO hay intención alta y hay cotizaciones simples vivas.
  if (altaIntencion === 0 && solic > 0)
    acciones.push({ id: "P1", nombre: ACCIONES.P1, detalle: `Reactivar ${solic} solicitudes sin avance` });

  // ── Situación + motivo ──
  let situacion: Situacion;
  const motivos: string[] = [];
  if (quiebre) motivos.push("stock bajo + demanda en alza");
  if (envejecido) motivos.push(`${sobre90} u. envejecidas (>90d)`);
  if (sinFirmarAlto) motivos.push(`${sinFirmar} ventas trabadas en crédito`);

  if (quiebre || envejecido || sinFirmarAlto) {
    situacion = "atencion";
  } else if (altaIntencion > 0) {
    situacion = "oportunidad";
    if (vpp > 0) motivos.push(`${vpp} VPP activas`);
    if (aprob > 0) motivos.push(`${aprob} aprobados sin cerrar`);
  } else {
    situacion = "estable";
    motivos.push("sin señales de alta intención hoy");
  }

  return {
    situacion,
    motivo: motivos.slice(0, 2).join(" · "),
    acciones,
    accionPrincipal: acciones[0] ?? null,
    altaIntencion,
  };
}

export const SITUACION_META: Record<Situacion, { label: string; color: string; chip: string }> = {
  atencion: { label: "Requiere atención", color: "var(--color-danger)", chip: "bg-[--color-danger-dim] text-[--color-danger]" },
  oportunidad: { label: "Oportunidad", color: "var(--color-success)", chip: "bg-[--color-success-dim] text-[--color-success]" },
  estable: { label: "Estable", color: "var(--color-fg-dim)", chip: "bg-[--color-bg-elev-3] text-[--color-fg-muted]" },
};
