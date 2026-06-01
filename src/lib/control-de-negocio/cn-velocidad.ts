/**
 * Capa A · Velocidad — brief §7.
 *
 * Pregunta operacional: "Cuando el proceso se ejecuta completo, ¿cuánto
 * demora cada tramo?"
 *
 * Para cada uno de los 7 tramos, calcula sobre los casos con AMBOS hitos
 * presentes: n, mediana, promedio, p90, max. Para los tramos 5-7 (sin
 * timestamp, sólo Si/No), entrega cobertura del flag — no días.
 *
 * Cero React.
 */

import type { EntradaConsolidada } from "../historico/cruce-roma-actas";
import {
  RESPONSABLE_POR_HITO_FALTANTE,
  type ResponsableHito,
} from "./cn-responsables";

const MS_DIA = 86_400_000;

export type TramoId =
  | "fac_sol_ins"
  | "sol_ins_ins"
  | "ins_pat_rec"
  | "pat_rec_pat_ent"
  | "pat_ent_sol_ent"
  | "sol_ent_aut"
  | "aut_ent_real";

/** Tramos con timestamp en ambos extremos — se mide en días. */
export interface TramoMedidoEnDias {
  kind: "dias";
  id: TramoId;
  label: string;
  hitoInicio: string;
  hitoFin: string;
  responsable: ResponsableHito;
  /** Casos con ambas fechas presentes. */
  n: number;
  /** Casos donde una de las dos fechas falta. */
  sinDato: number;
  promedio: number | null;
  mediana: number | null;
  p90: number | null;
  max: number | null;
}

/**
 * Tramos sin timestamp (5-6-7 según brief §4). Los flags son Si/No sin fecha.
 * Sólo medimos cobertura del flag dentro del universo del tramo previo.
 */
export interface TramoSoloCobertura {
  kind: "cobertura";
  id: TramoId;
  label: string;
  hitoInicio: string;
  hitoFin: string;
  responsable: ResponsableHito;
  /** Casos donde el hito inicio está cumplido (universo del tramo). */
  universo: number;
  /** Subconjunto que pasó el flag a "Si". */
  conFlag: number;
  /** Pct (0-100). */
  pct: number;
  /** Bandera para que la UI muestre la leyenda obligatoria. */
  leyenda: "sin granularidad temporal — pendiente instrumentación";
}

export type Tramo = TramoMedidoEnDias | TramoSoloCobertura;

export interface CapaA {
  tramos: Tramo[];
}

// ─── Helpers estadísticos ──────────────────────────────────────────────────

function diasEntre(a: Date | null, b: Date | null): number | null {
  if (!(a instanceof Date) || !(b instanceof Date)) return null;
  const d = (b.getTime() - a.getTime()) / MS_DIA;
  return d >= 0 ? d : null; // descartar negativos (brief §7)
}

function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function promedio(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function percentil(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

function maxOrNull(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return Math.max(...xs);
}

// ─── Definición de los 7 tramos ────────────────────────────────────────────

type DefTramoDias = {
  kind: "dias";
  id: TramoId;
  label: string;
  hitoInicio: string;
  hitoFin: string;
  responsable: ResponsableHito;
  getDesde: (f: EntradaConsolidada) => Date | null;
  getHasta: (f: EntradaConsolidada) => Date | null;
};

type DefTramoCobertura = {
  kind: "cobertura";
  id: TramoId;
  label: string;
  hitoInicio: string;
  hitoFin: string;
  responsable: ResponsableHito;
  universoTiene: (f: EntradaConsolidada) => boolean;
  flagSi: (f: EntradaConsolidada) => boolean;
};

const RESP = RESPONSABLE_POR_HITO_FALTANTE;

const DEF_TRAMOS: (DefTramoDias | DefTramoCobertura)[] = [
  {
    kind: "dias",
    id: "fac_sol_ins",
    label: "Factura → Solicitud Inscripción",
    hitoInicio: "FechaFactura",
    hitoFin: "FechaSolicitudInscripcion",
    responsable: RESP.solicitud_inscripcion,
    getDesde: (f) => f.fFactura,
    getHasta: (f) => f.fSolicitudInscripcion,
  },
  {
    kind: "dias",
    id: "sol_ins_ins",
    label: "Solicitud Inscripción → Inscripción",
    hitoInicio: "FechaSolicitudInscripcion",
    hitoFin: "FechaInscripcion",
    responsable: RESP.inscripcion,
    getDesde: (f) => f.fSolicitudInscripcion,
    getHasta: (f) => f.fInscripcion,
  },
  {
    kind: "dias",
    id: "ins_pat_rec",
    label: "Inscripción → Patente Recibida",
    hitoInicio: "FechaInscripcion",
    hitoFin: "fecha_patente_recibida",
    responsable: RESP.patente_recibida,
    getDesde: (f) => f.fInscripcion,
    getHasta: (f) => f.fPatenteRecibida,
  },
  {
    kind: "dias",
    id: "pat_rec_pat_ent",
    label: "Patente Recibida → Patente Entregada",
    hitoInicio: "fecha_patente_recibida",
    hitoFin: "fecha_patente_entregada",
    responsable: RESP.patente_entregada,
    getDesde: (f) => f.fPatenteRecibida,
    getHasta: (f) => f.fPatenteEntregada,
  },
  // Tramos 5-7 → sin timestamp. Cobertura del flag.
  {
    kind: "cobertura",
    id: "pat_ent_sol_ent",
    label: "Patente Entregada → Solicitud Entrega",
    hitoInicio: "fecha_patente_entregada",
    hitoFin: "sol_entrega = Si",
    responsable: RESP.solicitud_entrega,
    universoTiene: (f) => f.fPatenteEntregada instanceof Date,
    flagSi: (f) => (f.solEntrega ?? "").trim() === "Si",
  },
  {
    kind: "cobertura",
    id: "sol_ent_aut",
    label: "Solicitud Entrega → Autorización Entrega",
    hitoInicio: "sol_entrega = Si",
    hitoFin: "autorizacion_entrega = Si",
    responsable: RESP.autorizacion_entrega,
    universoTiene: (f) => (f.solEntrega ?? "").trim() === "Si",
    flagSi: (f) => (f.autorizacionEntrega ?? "").trim() === "Si",
  },
  {
    kind: "cobertura",
    id: "aut_ent_real",
    label: "Autorización Entrega → Entrega Real",
    hitoInicio: "autorizacion_entrega = Si",
    hitoFin: "entrega_auto (entrega real)",
    responsable: RESP.entrega_real,
    universoTiene: (f) => (f.autorizacionEntrega ?? "").trim() === "Si",
    flagSi: (f) => f.entregado,
  },
];

// ─── Cálculo ───────────────────────────────────────────────────────────────

function calcularTramoDias(
  d: DefTramoDias,
  universo: EntradaConsolidada[],
): TramoMedidoEnDias {
  const dias: number[] = [];
  let sinDato = 0;
  for (const f of universo) {
    const x = diasEntre(d.getDesde(f), d.getHasta(f));
    if (x === null) sinDato++;
    else dias.push(x);
  }
  return {
    kind: "dias",
    id: d.id,
    label: d.label,
    hitoInicio: d.hitoInicio,
    hitoFin: d.hitoFin,
    responsable: d.responsable,
    n: dias.length,
    sinDato,
    promedio: promedio(dias),
    mediana: mediana(dias),
    p90: percentil(dias, 0.9),
    max: maxOrNull(dias),
  };
}

function calcularTramoCobertura(
  d: DefTramoCobertura,
  universo: EntradaConsolidada[],
): TramoSoloCobertura {
  let universoN = 0;
  let conFlag = 0;
  for (const f of universo) {
    if (!d.universoTiene(f)) continue;
    universoN++;
    if (d.flagSi(f)) conFlag++;
  }
  return {
    kind: "cobertura",
    id: d.id,
    label: d.label,
    hitoInicio: d.hitoInicio,
    hitoFin: d.hitoFin,
    responsable: d.responsable,
    universo: universoN,
    conFlag,
    pct: universoN > 0 ? (conFlag / universoN) * 100 : 0,
    leyenda: "sin granularidad temporal — pendiente instrumentación",
  };
}

/** Función principal de la capa. Recibe el universo CN del mes. */
export function calcularCapaA(universo: EntradaConsolidada[]): CapaA {
  const tramos: Tramo[] = DEF_TRAMOS.map((d) =>
    d.kind === "dias"
      ? calcularTramoDias(d, universo)
      : calcularTramoCobertura(d, universo),
  );
  return { tramos };
}

/** Helper para el filtrado de la cola al click en un tramo. */
export function filasTramo(
  universo: EntradaConsolidada[],
  tramoId: TramoId,
): EntradaConsolidada[] {
  const def = DEF_TRAMOS.find((d) => d.id === tramoId);
  if (!def) return [];
  if (def.kind === "dias") {
    return universo.filter(
      (f) => def.getDesde(f) instanceof Date && def.getHasta(f) instanceof Date,
    );
  }
  // cobertura: filas del universo del tramo (con flag de inicio cumplido)
  return universo.filter((f) => def.universoTiene(f));
}
