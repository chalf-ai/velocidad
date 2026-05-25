/**
 * Selectores para la nueva taxonomía de capital operacional.
 *
 * Foco: clasificar y atribuir, NO consolidar todavía.
 * La consolidación financiera final ("capital total por marca incluyendo todo")
 * es un módulo futuro — acá solo damos las primitivas para construirlo.
 */

import type { DestinoOperacional, EstadoCapitalOperacional, NaturalezaCapital, Vehiculo } from "../types";
import { normalizarMarcaOperacional } from "./owner-operacional";

export interface DistribucionEstadoCapital {
  estado: EstadoCapitalOperacional;
  unidades: number;
  capital: number;
}

const ORDEN: EstadoCapitalOperacional[] = [
  "VPP_EXPLICITO",
  "PROCESO_CPD",
  "FNE_EN_OPERACION",
  "PROCESO_VENTA",
  "USADO_PAGADO_INMOVIL",
  "INMOVILIZADO",
  "POR_LLEGAR",
  "RETAIL_DISPONIBLE",
  "DESCONOCIDO",
];

export const ESTADO_LABEL: Record<EstadoCapitalOperacional, string> = {
  VPP_EXPLICITO: "VPP explícito",
  PROCESO_CPD: "Proceso CPD",
  FNE_EN_OPERACION: "FNE en operación",
  PROCESO_VENTA: "Proceso de venta",
  USADO_PAGADO_INMOVIL: "Usado pagado inmóvil",
  INMOVILIZADO: "Inmovilizado",
  POR_LLEGAR: "Por llegar",
  RETAIL_DISPONIBLE: "Retail disponible",
  DESCONOCIDO: "Desconocido",
};

export const ESTADO_DESC: Record<EstadoCapitalOperacional, string> = {
  VPP_EXPLICITO: "Folio Retoma + Proceso Retoma — vehículo recibido como parte de pago.",
  PROCESO_CPD: "Marca Pompeyo C. = Proceso CPD — documentación / preparación / habilitación.",
  FNE_EN_OPERACION: "Vendido + Status Vigente/Aprobada — facturado y no entregado.",
  PROCESO_VENTA: "Marca Pompeyo C. = Proceso de Venta — cliente comprometido, negocio abierto.",
  USADO_PAGADO_INMOVIL: "Condicion = USADO PROPIO PAGADO — usado pagado sin operación viva.",
  INMOVILIZADO: "Judicial, Stock B, TESCAR activos, Traspaso a 3°.",
  POR_LLEGAR: "Por Llegar / Pre-Inscrito — todavía no en stock físico.",
  RETAIL_DISPONIBLE: "Estado Dealer = Disponible — stock libre vendible.",
  DESCONOCIDO: "Sin clasificar — revisar.",
};

export const ESTADO_TONE: Record<EstadoCapitalOperacional, "info" | "warning" | "danger" | "success" | "muted"> = {
  VPP_EXPLICITO: "warning",
  PROCESO_CPD: "warning",
  FNE_EN_OPERACION: "info",
  PROCESO_VENTA: "info",
  USADO_PAGADO_INMOVIL: "danger",
  INMOVILIZADO: "danger",
  POR_LLEGAR: "muted",
  RETAIL_DISPONIBLE: "success",
  DESCONOCIDO: "muted",
};

// ── Naturaleza del capital ──

const ORDEN_NATURALEZA: NaturalezaCapital[] = [
  "puente",
  "operativo",
  "atrapado",
  "judicial",
  "transito",
  "retail",
  "indefinido",
];

export const NATURALEZA_LABEL: Record<NaturalezaCapital, string> = {
  puente: "Capital puente",
  operativo: "Facturados no entregados",
  atrapado: "Capital pagado",
  judicial: "Judiciales",
  transito: "Vehículos por llegar",
  retail: "En línea",
  indefinido: "Pendiente clasificación",
};

export const NATURALEZA_DESC: Record<NaturalezaCapital, string> = {
  puente:
    "VPP recibido + CPD usados fuera de línea, todavía no pagados — capital en transición que aún no se monetiza.",
  operativo:
    "Vehículos nuevos y usados con factura emitida pero todavía no entregados al cliente. Mantienen la operación abierta.",
  atrapado:
    "Usados pagados, stock viejo, inmovilizados, TESCAR pagados ≥180 días — caja propia desembolsada esperando rotar.",
  judicial:
    "Stock en proceso judicial — situación legal distinta del resto, no comparable con inmovilizado normal.",
  transito:
    "Vehículos por llegar o pre-inscritos — todavía no están físicamente en stock.",
  retail:
    "Stock en línea de crédito y disponible operacionalmente. Puede no estar pagado, pero está listo para venta.",
  indefinido:
    "Casos sin clasificación clara — faltan señales en el Excel. Requiere revisión.",
};

export const NATURALEZA_TONE: Record<NaturalezaCapital, "info" | "warning" | "danger" | "success" | "muted"> = {
  puente: "warning",
  operativo: "info",
  atrapado: "danger",
  judicial: "danger",
  transito: "muted",
  retail: "success",
  indefinido: "muted",
};

export interface DistribucionNaturaleza {
  naturaleza: NaturalezaCapital;
  unidades: number;
  capital: number;
}

// ── Destino operacional ──

export const DESTINO_LABEL: Record<DestinoOperacional, string> = {
  demo: "Demo (TESCAR)",
  renting: "Renting",
  company: "Company car",
  vdr: "VDR",
  interno: "Interno / activo fijo",
  vn_con_patente: "VN con patente (TM)",
  marketing: "Marketing",
  flota: "Flota",
  desconocido: "Sin clasificar",
};

export const DESTINO_TONE: Record<
  DestinoOperacional,
  "info" | "warning" | "success" | "muted" | "accent"
> = {
  demo: "info",
  renting: "warning",
  company: "accent",
  vdr: "muted",
  interno: "muted",
  vn_con_patente: "success",
  marketing: "info",
  flota: "info",
  desconocido: "muted",
};

const ORDEN_DESTINO: DestinoOperacional[] = [
  "demo",
  "renting",
  "company",
  "vn_con_patente",
  "vdr",
  "interno",
  "marketing",
  "flota",
  "desconocido",
];

export interface DistribucionDestino {
  destino: DestinoOperacional | null;
  unidades: number;
  capital: number;
}

export function distribucionDestino(vehiculos: Vehiculo[]): DistribucionDestino[] {
  const unique = uniqByVin(vehiculos);
  const map = new Map<DestinoOperacional | null, DistribucionDestino>();
  for (const d of ORDEN_DESTINO) map.set(d, { destino: d, unidades: 0, capital: 0 });
  map.set(null, { destino: null, unidades: 0, capital: 0 });
  for (const v of unique) {
    const row = map.get(v.destinoOperacional)!;
    row.unidades++;
    row.capital += v.costoNeto;
  }
  // Ordenar: con destino primero (orden declarado), luego null al final
  return [
    ...ORDEN_DESTINO.map((d) => map.get(d)!).filter((r) => r.unidades > 0),
    map.get(null)!,
  ];
}

export function distribucionNaturaleza(vehiculos: Vehiculo[]): DistribucionNaturaleza[] {
  const unique = uniqByVin(vehiculos);
  const map = new Map<NaturalezaCapital, DistribucionNaturaleza>();
  for (const n of ORDEN_NATURALEZA) map.set(n, { naturaleza: n, unidades: 0, capital: 0 });
  for (const v of unique) {
    const row = map.get(v.naturalezaCapital)!;
    row.unidades++;
    row.capital += v.costoNeto;
  }
  return ORDEN_NATURALEZA.map((n) => map.get(n)!);
}

function uniqByVin(vs: Vehiculo[]): Vehiculo[] {
  const seen = new Set<string>();
  const out: Vehiculo[] = [];
  for (const v of vs) {
    if (seen.has(v.vin)) continue;
    seen.add(v.vin);
    out.push(v);
  }
  return out;
}

export function distribucionEstadoCapital(vehiculos: Vehiculo[]): DistribucionEstadoCapital[] {
  const unique = uniqByVin(vehiculos);
  const map = new Map<EstadoCapitalOperacional, DistribucionEstadoCapital>();
  for (const e of ORDEN) map.set(e, { estado: e, unidades: 0, capital: 0 });
  for (const v of unique) {
    const row = map.get(v.estadoCapital)!;
    row.unidades++;
    row.capital += v.costoNeto;
  }
  return ORDEN.map((e) => map.get(e)!);
}

export interface CoberturaMarcaOriginadora {
  fuente: string;
  unidades: number;
  capital: number;
  pctSobreTotal: number;
}

export function coberturaMarcaOriginadora(vehiculos: Vehiculo[]): CoberturaMarcaOriginadora[] {
  const unique = uniqByVin(vehiculos);
  const total = unique.length;
  const map = new Map<string, { unidades: number; capital: number }>();
  for (const v of unique) {
    const k = v.marcaOriginadoraFuente;
    if (!map.has(k)) map.set(k, { unidades: 0, capital: 0 });
    const r = map.get(k)!;
    r.unidades++;
    r.capital += v.costoNeto;
  }
  return [...map.entries()].map(([fuente, r]) => ({
    fuente,
    unidades: r.unidades,
    capital: r.capital,
    pctSobreTotal: total > 0 ? r.unidades / total : 0,
  }));
}

export interface CapitalAtribuidoPorMarca {
  marca: string | null;
  unidades: number;
  capitalTotal: number;
  /** Desglose por estado dentro de la misma marca. */
  porEstado: Partial<Record<EstadoCapitalOperacional, { unidades: number; capital: number }>>;
  /** Si la marca tuvo VPP/EN_PROCESO con VU de marca DISTINTA. */
  capitalDeVUOtraMarca: number;
  unidadesDeVUOtraMarca: number;
}

/**
 * Capital atribuido a la marca ORIGINADORA, no a la marca del vehículo.
 *
 * Esto materializa el insight clave de Pompeyo:
 *   un MAZDA usado en KIA REDCUBE consume capital de KIA.
 *
 * Aún NO calcula "capital total por marca" — eso será módulo futuro
 * cuando se sumen también líneas, créditos, saldos, etc. Acá solo
 * exponemos el subset que vive en Base_Stock.
 */
export interface ComposicionMarca {
  marca: string;
  capitalTotal: number;
  unidadesTotal: number;
  buckets: {
    naturaleza: NaturalezaCapital;
    capital: number;
    unidades: number;
    pct: number;
  }[];
}

/**
 * Composición del capital de UNA marca por naturaleza (puente / operativo /
 * atrapado / tránsito / retail / indefinido).
 *
 * Útil para el drilldown del Dashboard: click en marca → ver cómo se reparte
 * su capital entre los buckets.
 */
export function composicionPorMarca(
  vehiculos: Vehiculo[],
  marcaOriginadora: string,
): ComposicionMarca {
  const seen = new Set<string>();
  const own: Vehiculo[] = [];
  // El gráfico ejecutivo agrupa por marca operacional (marcas ajenas → OTRAS
  // MARCAS), así que el drill compara el mismo bucket normalizado. Si llega un
  // bucket consolidado ("OTRAS MARCAS") captura todas las marcas ajenas.
  const target = normalizarMarcaOperacional(marcaOriginadora);
  for (const v of vehiculos) {
    if (seen.has(v.vin)) continue;
    seen.add(v.vin);
    if (normalizarMarcaOperacional(v.marcaOriginadora) === target) own.push(v);
  }

  const map = new Map<NaturalezaCapital, { cap: number; un: number }>();
  let capitalTotal = 0;
  for (const v of own) {
    capitalTotal += v.costoNeto;
    const k = v.naturalezaCapital;
    if (!map.has(k)) map.set(k, { cap: 0, un: 0 });
    const r = map.get(k)!;
    r.cap += v.costoNeto;
    r.un += 1;
  }

  const orden: NaturalezaCapital[] = [
    "puente",
    "operativo",
    "atrapado",
    "judicial",
    "transito",
    "retail",
    "indefinido",
  ];

  const buckets = orden
    .filter((n) => map.has(n))
    .map((n) => {
      const r = map.get(n)!;
      return {
        naturaleza: n,
        capital: r.cap,
        unidades: r.un,
        pct: capitalTotal > 0 ? r.cap / capitalTotal : 0,
      };
    });

  return {
    marca: marcaOriginadora,
    capitalTotal,
    unidadesTotal: own.length,
    buckets,
  };
}

export function capitalPorMarcaOriginadora(vehiculos: Vehiculo[]): CapitalAtribuidoPorMarca[] {
  const unique = uniqByVin(vehiculos);
  const map = new Map<string, CapitalAtribuidoPorMarca>();
  const ensure = (k: string | null): CapitalAtribuidoPorMarca => {
    const key = k ?? "(no inferible)";
    let r = map.get(key);
    if (!r) {
      r = {
        marca: k,
        unidades: 0,
        capitalTotal: 0,
        porEstado: {},
        capitalDeVUOtraMarca: 0,
        unidadesDeVUOtraMarca: 0,
      };
      map.set(key, r);
    }
    return r;
  };

  for (const v of unique) {
    const row = ensure(v.marcaOriginadora);
    row.unidades++;
    row.capitalTotal += v.costoNeto;

    const slot = (row.porEstado[v.estadoCapital] ??= { unidades: 0, capital: 0 });
    slot.unidades++;
    slot.capital += v.costoNeto;

    // Detectar VU de marca distinta — solo para estados donde la atribución
    // viene de la sucursal (VPP / Proceso CPD / Proceso de Venta)
    if (
      v.marcaOriginadora &&
      v.marcaPompeyo &&
      (v.estadoCapital === "VPP_EXPLICITO" ||
        v.estadoCapital === "PROCESO_CPD" ||
        v.estadoCapital === "PROCESO_VENTA") &&
      v.marcaOriginadora.toUpperCase() !== v.marcaPompeyo.toUpperCase()
    ) {
      row.capitalDeVUOtraMarca += v.costoNeto;
      row.unidadesDeVUOtraMarca++;
    }
  }

  return [...map.values()].sort((a, b) => b.capitalTotal - a.capitalTotal);
}
