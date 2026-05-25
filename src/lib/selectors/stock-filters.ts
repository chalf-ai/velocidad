/**
 * Lógica de filtrado para Stock Explorer. URL-encoded para permitir drilldown
 * desde Dashboard / Alertas con pre-filtros aplicados.
 */

import type {
  DestinoOperacional,
  EstadoCapitalOperacional,
  NaturalezaCapital,
  TipoStock,
  UnidadNegocio,
  Vehiculo,
} from "../types";

export interface StockFilters {
  /** Marca real del vehículo (col Marca, no marcaPompeyo).
   *  Filtrar "KIA MOTORS" captura nuevos Y usados de esa marca.
   *  Para retro-compat con URLs viejas, también matchea marcaPompeyo. */
  marca: string[];
  /** Modelo del vehículo (col Modelo). */
  modelo: string[];
  /** Unidad de negocio: Nuevos / Usados / AutosCompania. */
  unidadNegocio: UnidadNegocio[];
  sucursal: string[];
  naturaleza: NaturalezaCapital[];
  estadoCapital: EstadoCapitalOperacional[];
  /** Especial: "_null" en la lista significa "sin destino" (retail). */
  destinoOperacional: (DestinoOperacional | "_null")[];
  tipoStock: TipoStock[];
  marcaOriginadora: string[];
  estadoDealer: string[];
  estadoFlujoVO: string[];
  /** Búsqueda libre — matchea VIN, patente, modelo, vendedor, folio venta. */
  q: string;
  /** "≥60", "≥180" o vacío. */
  diasMinimo: "" | "60" | "180";
  /** Solo VIN únicos (deduplicar). */
  soloVinUnico: boolean;
  /** Banderas booleanas activas. */
  flags: ("pagado" | "noPagado" | "vpp" | "fne" | "judicial" | "stockB" | "tescar" | "tescarOperacional" | "duplicado" | "conPatente" | "sinPatente")[];
}

export const EMPTY_FILTERS: StockFilters = {
  marca: [],
  modelo: [],
  unidadNegocio: [],
  sucursal: [],
  naturaleza: [],
  estadoCapital: [],
  destinoOperacional: [],
  tipoStock: [],
  marcaOriginadora: [],
  estadoDealer: [],
  estadoFlujoVO: [],
  q: "",
  diasMinimo: "",
  soloVinUnico: true,
  flags: [],
};

export function isFilterActive(f: StockFilters): boolean {
  return (
    f.marca.length > 0 ||
    f.modelo.length > 0 ||
    f.unidadNegocio.length > 0 ||
    f.sucursal.length > 0 ||
    f.naturaleza.length > 0 ||
    f.estadoCapital.length > 0 ||
    f.destinoOperacional.length > 0 ||
    f.tipoStock.length > 0 ||
    f.marcaOriginadora.length > 0 ||
    f.estadoDealer.length > 0 ||
    f.estadoFlujoVO.length > 0 ||
    f.q.trim() !== "" ||
    f.diasMinimo !== "" ||
    f.flags.length > 0
  );
}

export function countActiveFilters(f: StockFilters): number {
  return (
    f.marca.length +
    f.modelo.length +
    f.unidadNegocio.length +
    f.sucursal.length +
    f.naturaleza.length +
    f.estadoCapital.length +
    f.destinoOperacional.length +
    f.tipoStock.length +
    f.marcaOriginadora.length +
    f.estadoDealer.length +
    f.estadoFlujoVO.length +
    (f.q.trim() !== "" ? 1 : 0) +
    (f.diasMinimo !== "" ? 1 : 0) +
    f.flags.length
  );
}

/** Encode/decode con URLSearchParams para shareability + drilldown. */
export function encodeFilters(f: StockFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.marca.length) p.set("marca", f.marca.join(","));
  if (f.modelo.length) p.set("modelo", f.modelo.join(","));
  if (f.unidadNegocio.length) p.set("unidadNegocio", f.unidadNegocio.join(","));
  if (f.sucursal.length) p.set("sucursal", f.sucursal.join(","));
  if (f.naturaleza.length) p.set("naturaleza", f.naturaleza.join(","));
  if (f.estadoCapital.length) p.set("estadoCapital", f.estadoCapital.join(","));
  if (f.destinoOperacional.length) p.set("destino", f.destinoOperacional.join(","));
  if (f.tipoStock.length) p.set("tipoStock", f.tipoStock.join(","));
  if (f.marcaOriginadora.length) p.set("marcaOriginadora", f.marcaOriginadora.join(","));
  if (f.estadoDealer.length) p.set("estadoDealer", f.estadoDealer.join(","));
  if (f.estadoFlujoVO.length) p.set("estadoFlujoVO", f.estadoFlujoVO.join(","));
  if (f.q.trim() !== "") p.set("q", f.q.trim());
  if (f.diasMinimo !== "") p.set("dias", f.diasMinimo);
  if (!f.soloVinUnico) p.set("dup", "1");
  if (f.flags.length) p.set("flags", f.flags.join(","));
  return p;
}

const VALID_NATURALEZA = new Set([
  "puente",
  "operativo",
  "atrapado",
  "judicial",
  "transito",
  "retail",
  "indefinido",
]);

const VALID_ESTADO_CAPITAL = new Set([
  "VPP_EXPLICITO",
  "PROCESO_CPD",
  "FNE_EN_OPERACION",
  "PROCESO_VENTA",
  "USADO_PAGADO_INMOVIL",
  "INMOVILIZADO",
  "POR_LLEGAR",
  "RETAIL_DISPONIBLE",
  "DESCONOCIDO",
]);

const VALID_UN = new Set(["Nuevos", "Usados", "AutosCompania", "Desconocido"]);

const VALID_DESTINO = new Set([
  "demo",
  "renting",
  "company",
  "vdr",
  "interno",
  "vn_con_patente",
  "marketing",
  "flota",
  "desconocido",
  "_null",
]);

const VALID_TIPO_STOCK = new Set([
  "FloorPlan",
  "Propio",
  "Financiado",
  "FinPropio",
  "VuPorRecibir",
  "Desconocido",
]);

const VALID_FLAGS = new Set([
  "pagado",
  "noPagado",
  "vpp",
  "fne",
  "judicial",
  "stockB",
  "tescar",
  "tescarOperacional",
  "duplicado",
  "conPatente",
  "sinPatente",
]);

const split = (s: string | null): string[] =>
  s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];

export function decodeFilters(params: URLSearchParams | ReadonlyURLSearchParams): StockFilters {
  return {
    marca: split(params.get("marca")),
    modelo: split(params.get("modelo")),
    unidadNegocio: split(params.get("unidadNegocio")).filter((x) => VALID_UN.has(x)) as UnidadNegocio[],
    sucursal: split(params.get("sucursal")),
    naturaleza: split(params.get("naturaleza")).filter((x) => VALID_NATURALEZA.has(x)) as NaturalezaCapital[],
    estadoCapital: split(params.get("estadoCapital")).filter((x) => VALID_ESTADO_CAPITAL.has(x)) as EstadoCapitalOperacional[],
    destinoOperacional: split(params.get("destino")).filter((x) => VALID_DESTINO.has(x)) as StockFilters["destinoOperacional"],
    tipoStock: split(params.get("tipoStock")).filter((x) => VALID_TIPO_STOCK.has(x)) as TipoStock[],
    marcaOriginadora: split(params.get("marcaOriginadora")),
    estadoDealer: split(params.get("estadoDealer")),
    estadoFlujoVO: split(params.get("estadoFlujoVO")),
    q: params.get("q") ?? "",
    diasMinimo: (params.get("dias") === "60" || params.get("dias") === "180")
      ? (params.get("dias") as "60" | "180")
      : "",
    soloVinUnico: params.get("dup") !== "1",
    flags: split(params.get("flags")).filter((x) => VALID_FLAGS.has(x)) as StockFilters["flags"],
  };
}

interface ReadonlyURLSearchParams {
  get(key: string): string | null;
}

const includes = (haystack: string | null | undefined, needle: string): boolean => {
  if (!haystack) return false;
  return haystack.toString().toLowerCase().includes(needle);
};

export function filterVehiculos(vehiculos: Vehiculo[], f: StockFilters): Vehiculo[] {
  const q = f.q.trim().toLowerCase();
  const seen = new Set<string>();
  const out: Vehiculo[] = [];

  for (const v of vehiculos) {
    if (f.soloVinUnico) {
      if (seen.has(v.vin)) continue;
      seen.add(v.vin);
    }

    if (f.marca.length) {
      // Match contra marca REAL del vehículo, con fallback a marcaPompeyo.
      // Caso especial: si "USADOS" está seleccionado, también matchea los buckets
      // VU en Nuevos / VU en Usados (sub-categorías de usados según Pompeyo).
      const expanded = new Set(f.marca);
      if (f.marca.includes("USADOS")) {
        expanded.add("VU en Nuevos");
        expanded.add("VU en Usados");
      }
      const realMatch = f.marca.includes(v.marca);
      const pompeyoMatch = expanded.has(v.marcaPompeyo);
      if (!realMatch && !pompeyoMatch) continue;
    }
    if (f.modelo.length) {
      // Match case-insensitive contra v.modelo. Soporta sub-string match
      // (filtro "SPORTAGE" captura "SPORTAGE LX 2.0L GSL 6MT 2WD 6AB").
      const modeloVeh = (v.modelo ?? "").toUpperCase();
      if (!f.modelo.some((m) => modeloVeh.includes(m.toUpperCase()))) continue;
    }
    if (f.unidadNegocio.length && !f.unidadNegocio.includes(v.unidadNegocio)) continue;
    if (f.sucursal.length && (!v.sucursal || !f.sucursal.includes(v.sucursal))) continue;
    if (f.naturaleza.length && !f.naturaleza.includes(v.naturalezaCapital)) continue;
    if (f.estadoCapital.length && !f.estadoCapital.includes(v.estadoCapital)) continue;
    if (f.destinoOperacional.length) {
      const key = v.destinoOperacional ?? "_null";
      if (!f.destinoOperacional.includes(key)) continue;
    }
    if (f.tipoStock.length && !f.tipoStock.includes(v.tipoStock)) continue;
    if (f.marcaOriginadora.length && (!v.marcaOriginadora || !f.marcaOriginadora.includes(v.marcaOriginadora)))
      continue;
    if (f.estadoDealer.length && (!v.estadoDealer || !f.estadoDealer.includes(v.estadoDealer))) continue;
    if (f.estadoFlujoVO.length && (!v.estadoFlujoVO || !f.estadoFlujoVO.includes(v.estadoFlujoVO)))
      continue;

    if (f.diasMinimo === "60" && (v.diasStock ?? 0) < 60) continue;
    if (f.diasMinimo === "180" && (v.diasStock ?? 0) < 180) continue;

    if (q) {
      const haystack =
        (v.vin ?? "") +
        " " +
        (v.patente ?? "") +
        " " +
        (v.marca ?? "") +
        " " +
        (v.marcaPompeyo ?? "") +
        " " +
        (v.modelo ?? "") +
        " " +
        (v.version ?? "") +
        " " +
        (v.vendedor ?? "") +
        " " +
        (v.folioVenta ?? "");
      if (!includes(haystack, q)) continue;
    }

    let passFlags = true;
    for (const flag of f.flags) {
      if (flag === "pagado" && !v.esPagado) passFlags = false;
      if (flag === "noPagado" && v.esPagado) passFlags = false;
      if (flag === "vpp" && !v.esVPPComprometido) passFlags = false;
      if (flag === "fne" && v.estadoCapital !== "FNE_EN_OPERACION") passFlags = false;
      if (flag === "judicial" && !v.esJudicial) passFlags = false;
      if (flag === "stockB" && !v.esStockB) passFlags = false;
      if (flag === "tescar" && !v.esTescar) passFlags = false;
      if (flag === "tescarOperacional" && !v.esTescarOperacional) passFlags = false;
      if (flag === "duplicado" && !v.esDuplicado) passFlags = false;
      if (flag === "conPatente" && !v.patente) passFlags = false;
      if (flag === "sinPatente" && v.patente) passFlags = false;
    }
    if (!passFlags) continue;

    out.push(v);
  }
  return out;
}

export interface FilterOptions {
  /** Marcas Pompeyo (consolidadas) — usadas en el filtro principal "Marca". */
  marcas: string[];
  /** Modelos primarios (solo el primer token significativo). */
  modelos: string[];
  sucursales: string[];
  estadosDealer: string[];
  marcasOriginadoras: string[];
  estadosFlujoVO: string[];
}

export function extractFilterOptions(
  vehiculos: Vehiculo[],
  /** Lista de marcas válidas de Pompeyo (típicamente las que tienen línea de crédito). */
  marcasPompeyoValidas?: string[],
): FilterOptions {
  // Marca = SOLO marcas Pompeyo válidas (con línea de crédito) + "USADOS".
  // El search libre (q) sigue buscando en marca real para casos como "TOYOTA usado".
  const m = new Set<string>();
  const modelosCount = new Map<string, number>();
  const s = new Set<string>();
  const ed = new Set<string>();
  const mo = new Set<string>();
  const ef = new Set<string>();

  // Set de validación (case-insensitive)
  const valid = new Set<string>();
  if (marcasPompeyoValidas) {
    for (const v of marcasPompeyoValidas) valid.add(v.toUpperCase().trim());
  }
  valid.add("USADOS");

  for (const v of vehiculos) {
    if (v.marcaPompeyo) {
      if (!marcasPompeyoValidas || valid.has(v.marcaPompeyo.toUpperCase().trim())) {
        m.add(v.marcaPompeyo);
      }
    }
    // Modelo "primario" = primer token significativo (mayúsculas, ≥3 chars)
    if (v.modelo) {
      const primary = v.modelo
        .toString()
        .trim()
        .split(/\s+/)
        .find((tok) => tok.length >= 3 && /[A-Za-z]/.test(tok));
      if (primary) {
        const k = primary.toUpperCase();
        modelosCount.set(k, (modelosCount.get(k) ?? 0) + 1);
      }
    }
    if (v.sucursal) s.add(v.sucursal);
    if (v.estadoDealer) ed.add(v.estadoDealer);
    if (v.marcaOriginadora) mo.add(v.marcaOriginadora);
    if (v.estadoFlujoVO) ef.add(v.estadoFlujoVO);
  }
  const sortStr = (arr: Set<string>) => Array.from(arr).sort((a, b) => a.localeCompare(b));
  // Modelos: ordenar por frecuencia (más usados arriba), descartar singleton noise
  const modelos = Array.from(modelosCount.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
  return {
    marcas: sortStr(m),
    modelos,
    sucursales: sortStr(s),
    estadosDealer: sortStr(ed),
    marcasOriginadoras: sortStr(mo),
    estadosFlujoVO: sortStr(ef),
  };
}

export interface FilteredStats {
  unidades: number;
  capital: number;
  marcasUnicas: number;
  sucursalesUnicas: number;
}

export function statsFromFiltered(filtered: Vehiculo[]): FilteredStats {
  const marcas = new Set<string>();
  const sucs = new Set<string>();
  let cap = 0;
  for (const v of filtered) {
    cap += v.costoNeto;
    if (v.marcaPompeyo) marcas.add(v.marcaPompeyo);
    if (v.sucursal) sucs.add(v.sucursal);
  }
  return {
    unidades: filtered.length,
    capital: cap,
    marcasUnicas: marcas.size,
    sucursalesUnicas: sucs.size,
  };
}
