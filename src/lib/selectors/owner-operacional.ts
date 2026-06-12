/**
 * FUNCIÓN MADRE · Marca Operacional / Marca Origen.
 *
 * Única fuente, centralizada y auditable, para resolver la marca que GESTIONA
 * la operación de cualquier registro del sistema. Reemplaza la lógica ad-hoc
 * por módulo (cada pantalla calculaba la marca distinto).
 *
 * ───────────────────────── REGLA MADRE ─────────────────────────
 * La marca operacional NO es la marca física del auto: es la marca que
 * explica/gestiona el capital. La fuente PRINCIPAL es el campo que ya alimenta
 * la columna "Marca origen" del Stock Explorer:  Vehiculo.marcaOriginadora
 * (derivado por el parser en base-stock.ts → deriveMarcaOriginadora).
 *
 * Prioridad de fuentes (sin inventar nada):
 *   1. Marca Origen del registro (marcaOriginadora) — STOCK.
 *   2. Origen/marca propia del registro cuando la fuente no es stock:
 *        - Provisiones → ProvisionRegistro.origen (marca).
 *        - Saldos vehículo → SaldoRegistro.marca.
 *        - Saldos bonos/comisiones → no traen marca → sucursal de negocio.
 *        - FNE → no trae marca → sucursal de venta marca-específica.
 *   3. Si nada de lo anterior resuelve → "SIN MARCA ORIGEN" (= EN CONCILIACIÓN).
 *
 * NO se usa: marca física como fallback, tokens "contiene KIA", ni la sucursal
 * como regla principal del stock (solo se usa sucursal en fuentes que NO traen
 * marca: FNE y bonos, documentado como excepción de esas fuentes).
 *
 * La CATEGORÍA operacional (stock retail / capital puente / no retail / …) es
 * ORTOGONAL a la marca: un mismo owner puede tener stock y capital puente.
 *
 * Módulo PURO: sin estado, sin React, sin side effects. No toca gestión.
 */

import type {
  AutoNoEntregado,
  LineaCredito,
  ProvisionRegistro,
  SaldoRegistro,
  Vehiculo,
} from "../types";
import { canonicalMarca, inferirMarcaOriginadoraDesdeSucursal } from "../parser/normalize";

// ── Buckets especiales de marca operacional ───────────────────────────────
export const MARCA_SIN_ORIGEN = "SIN MARCA ORIGEN"; // = EN CONCILIACIÓN
export const MARCA_USADOS = "USADOS";
export const MARCA_OTRAS = "OTRAS MARCAS";

/**
 * MARCAS DEL GRUPO POMPEYO — marcas que el grupo comercializa/financia.
 * Cualquier marca física FUERA de este set (Volkswagen, GAC, Hyundai, Toyota…
 * que entran como usado/parte de pago o base antigua) se agrupa en
 * "OTRAS MARCAS" para no ensuciar el filtro global ni los desgloses por marca.
 *
 * ▸ EXTENSIBLE: cuando el grupo sume una marca nueva, agrégala aquí (en MAYÚSCULAS,
 *   forma canónica de canonicalMarca). Base = maestro financiero oficial.
 */
export const MARCAS_GRUPO = new Set<string>([
  "KIA MOTORS",
  "MG",
  "GEELY",
  "PEUGEOT",
  "OPEL",
  "CITROEN",
  "DFSK",
  "NISSAN",
  "NISSAN FLOTAS",
  "SUBARU",
  "SUZUKI",
  "GREAT WALL",
  "DFM", // aún sin stock; entrará cuando el grupo la sume
  "LEAPMOTOR",
  "LANDKING",
  "NAMMI",
]);

export type CategoriaOperacional =
  | "stock_retail" // auto nuevo retail de la marca
  | "capital_puente" // VU/BU recibido en parte de pago (no es stock)
  | "no_retail" // renting / company car / test car / VDR / interno
  | "fne" // facturado no entregado
  | "saldo" // saldo por cobrar
  | "provision" // provisión
  | "sin_clasificar";

/** Cualquier registro del sistema con dimensión de marca operacional. */
export type RegistroOperacional =
  | Vehiculo
  | AutoNoEntregado
  | SaldoRegistro
  | ProvisionRegistro;

const up = (v: string | null | undefined): string => (v ?? "").toString().toUpperCase().trim();

// ── Type guards (duck-typing por campos únicos) ───────────────────────────
function esVehiculo(r: RegistroOperacional): r is Vehiculo {
  return "marcaOriginadora" in r && "estadoCapital" in r;
}
function esProvision(r: RegistroOperacional): r is ProvisionRegistro {
  return "montoProvision" in r && "claveGestion" in r;
}
function esSaldo(r: RegistroOperacional): r is SaldoRegistro {
  return "categoria" in r && "saldoXDocumentar" in r;
}
function esFNE(r: RegistroOperacional): r is AutoNoEntregado {
  return "valorFactura" in r && "etapa" in r;
}

/**
 * Normaliza un valor de marca a su forma operacional canónica.
 * - vacío/null → SIN MARCA ORIGEN
 * - familia de usados (USADOS, VU EN NUEVOS, VU EN USADOS) → USADOS
 * - "OTRAS MARCAS" → OTRAS MARCAS
 * - marca del grupo Pompeyo → su glosa canónica (KIA MOTORS, GEELY, …)
 * - marca física fuera del grupo (VW, GAC, Hyundai…) → OTRAS MARCAS
 */
export function normalizarMarcaOperacional(valor: string | null | undefined): string {
  if (valor == null || String(valor).trim() === "") return MARCA_SIN_ORIGEN;
  const { canon } = canonicalMarca(valor);
  const c = up(canon ?? String(valor));
  if (c === "USADOS" || c === "VU EN NUEVOS" || c === "VU EN USADOS") return MARCA_USADOS;
  if (c === "OTRAS MARCAS") return MARCA_OTRAS;
  // Idempotencia: el bucket "SIN MARCA ORIGEN" es un valor de marca válido
  // (filtro global, scopes de snapshot) — no debe colapsar en OTRAS MARCAS.
  if (c === MARCA_SIN_ORIGEN) return MARCA_SIN_ORIGEN;
  if (MARCAS_GRUPO.has(c)) return c;
  return MARCA_OTRAS; // marca fuera del grupo Pompeyo
}

/** Owner desde sucursal marca-específica (solo fuentes sin marca: FNE, bonos). */
function marcaPorSucursal(sucursal: string | null | undefined): string {
  return normalizarMarcaOperacional(inferirMarcaOriginadoraDesdeSucursal(sucursal ?? null));
}

/**
 * ¿El vehículo pertenece a la UNIDAD OPERACIONAL USADOS?
 *
 * USADOS es una marca operacional como cualquier otra del grupo (igual que KIA o
 * MG): el capital de un usado lo gestiona la unidad de usados, NO la marca del VN
 * que lo recibió en parte de pago. Por eso el owner de TODO usado —incluido el
 * capital puente (VU en Nuevos / VU en Usados)— es USADOS, sin importar la marca
 * originadora derivada por sucursal.
 *
 * Señales en Base_Stock (las mismas de la taxonomía de usados):
 *   - Unidad Negocio = "Usados"
 *   - Condicion Vehiculo contiene "USADO"
 *   - Marca Pompeyo ∈ {USADOS, VU en Nuevos, VU en Usados}
 *
 * Esta es la fuente ÚNICA del predicado; la taxonomía (usados-operacional.ts) lo
 * reexporta para clasificar subcategorías ENCIMA de este universo.
 */
export function esUsadoOperacional(v: Vehiculo): boolean {
  if (v.unidadNegocio === "Usados") return true;
  if (up(v.condicionVehiculo).includes("USADO")) return true;
  const mp = up(v.marcaPompeyo);
  return mp === "USADOS" || mp === "VU EN NUEVOS" || mp === "VU EN USADOS";
}

/**
 * Sucursales que NO son retail de marca (usados, demos, renting, company).
 * Para limpiar el SELECTOR de sucursales en contexto retail: una marca puede
 * tener un auto físicamente en estas ubicaciones, pero no son sucursales retail.
 * Logística y "VN con patente" SÍ son retail (stock en tránsito/patentado).
 */
const SUCURSALES_NO_RETAIL = ["SEMINUEVO", "AUTOSHOPPING", "RENTING", "COMPANY", "TEST CAR"];

/** ¿La sucursal es una sucursal RETAIL operacional (no usados/demo/renting)? */
export function sucursalEsRetailOperacional(sucursal: string | null | undefined): boolean {
  const u = up(sucursal);
  if (!u) return true; // sin sucursal (tránsito) — no se excluye
  return !SUCURSALES_NO_RETAIL.some((n) => u.includes(n));
}

/**
 * Sucursales de la UNIDAD USADOS (puntos de venta de usados).
 * Una operación realizada en estas sucursales es usados, aunque el archivo no
 * traiga marca (caso FNE: el archivo "Autos no entregados" no tiene columna de
 * marca/unidad → la sucursal es la única señal self-contained de usados).
 * Validado contra el archivo real: "USADOS …", "AUTOSHOPPING", "SEMINUEVO",
 * "OUTLET", "CPD".
 */
const SUCURSALES_USADOS = ["SEMINUEVO", "USADO", "AUTOSHOPPING", "OUTLET", "CPD"];

/** ¿La sucursal pertenece a la unidad de usados? (señal operacional, no marca). */
export function sucursalEsUsados(sucursal: string | null | undefined): boolean {
  const u = up(sucursal);
  if (!u) return false;
  return SUCURSALES_USADOS.some((n) => u.includes(n));
}

/**
 * MARCA OPERACIONAL de cualquier registro. Fuente principal: Marca Origen.
 */
export function getMarcaOperacional(r: RegistroOperacional): string {
  if (esVehiculo(r)) {
    // USADOS es una unidad operacional: todo usado (incl. capital puente VU) lo
    // gestiona la unidad de usados, sin importar la marca del VN que lo originó.
    // Esto hace que el filtro global USADOS devuelva su universo completo (stock,
    // capital puente, judicial, inmovilizado) en vez de repartirlo entre marcas.
    if (esUsadoOperacional(r)) return MARCA_USADOS;
    return normalizarMarcaOperacional(r.marcaOriginadora);
  }
  if (esProvision(r)) return normalizarMarcaOperacional(r.origen);
  if (esSaldo(r)) {
    // Empresa "PC Automóviles" = gerencia de USADOS (en SALVING, separada de
    // "PC Spa" = vehículos nuevos). TODO su saldo lo gestiona usados, sin importar
    // la marca FÍSICA del auto vendido (un MG/KIA usado vendido por usados es saldo
    // de USADOS, no de la marca nueva). Esto es la dimensión owner del saldo.
    if (r.empresa === "PC Automoviles") return MARCA_USADOS;
    // bonos/comisiones no traen marca → atribuir por sucursal de negocio.
    if (r.categoria === "bono_comision") return marcaPorSucursal(r.sucursal);
    return normalizarMarcaOperacional(r.marca);
  }
  if (esFNE(r)) {
    // El archivo FNE no trae marca. La unidad usados se detecta por dos señales:
    //  • flag esUsado (enriquecido al cruzar VIN→stock usado en el store) — captura
    //    usados vendidos por oficinas de marca, sin sucursal de usados.
    //  • sucursal de usados (fallback self-contained si el cruce aún no corrió).
    if (r.esUsado === true || sucursalEsUsados(r.sucursal)) return MARCA_USADOS;
    return marcaPorSucursal(r.sucursal);
  }
  return MARCA_SIN_ORIGEN;
}

/** ¿El vehículo es un destino NO retail (renting/company/test/vdr/interno)? */
function esNoRetail(v: Vehiculo): boolean {
  const cond = up(v.condicionDeStock);
  const condV = up(v.condicionVehiculo);
  const tipo = up(v.tipoDeStock);
  if (
    v.destinoOperacional === "renting" ||
    v.destinoOperacional === "company" ||
    v.destinoOperacional === "vdr" ||
    v.destinoOperacional === "interno"
  ) {
    return true;
  }
  if (cond.includes("RENTING") || cond.includes("COMPANY")) return true;
  if (tipo.includes("COMPAÑ") || tipo.includes("COMPAN")) return true;
  if (cond.includes("TEST CAR") || condV.includes("TEST CAR EN USO")) return true;
  return false;
}

/**
 * CATEGORÍA operacional (ortogonal a la marca). Para stock separa el capital
 * puente (VU/BU recibidos) del stock retail y del no-retail.
 */
export function getCategoriaOperacional(r: RegistroOperacional): CategoriaOperacional {
  if (esVehiculo(r)) {
    if (r.esVPPComprometido) return "capital_puente";
    if (esNoRetail(r)) return "no_retail";
    return "stock_retail";
  }
  if (esProvision(r)) return "provision";
  if (esSaldo(r)) return "saldo";
  if (esFNE(r)) return "fne";
  return "sin_clasificar";
}

/** ¿El registro quedó sin marca origen (en conciliación)? */
export function esSinMarcaOperacional(r: RegistroOperacional): boolean {
  return getMarcaOperacional(r) === MARCA_SIN_ORIGEN;
}

/** Filtra un array por marca operacional (normaliza la marca buscada). */
export function filtrarPorMarcaOperacional<T extends RegistroOperacional>(
  registros: T[],
  marca: string,
): T[] {
  const objetivo = normalizarMarcaOperacional(marca);
  return registros.filter((r) => getMarcaOperacional(r) === objetivo);
}

// ── SEGUNDA DIMENSIÓN · marca ORIGINADORA (atribución financiera / de origen) ──
//
// El owner operacional dice QUIÉN GESTIONA (un VU/BU recibido en parte de pago →
// USADOS). El originador dice QUÉ MARCA CONSUMIÓ LA CAJA/LÍNEA: ese mismo VU/BU,
// si lo tomó una operación KIA, tiene originador KIA aunque lo gestione USADOS.
// Son dos lecturas legítimas del MISMO capital (no se suman dos veces: cada VIN
// entra una sola vez por vista). Para registros sin dualidad (stock retail, FNE,
// saldos, provisiones) el originador coincide con el owner.

/**
 * MARCA ORIGINADORA de un registro (atribución financiera). Para vehículos usa
 * `marcaOriginadora` (derivada por el parser: marca del VN, o sucursal marca-
 * específica para VPP/CPD). Para el resto, = owner operacional.
 */
export function getMarcaOriginadora(r: RegistroOperacional): string {
  if (esVehiculo(r)) return normalizarMarcaOperacional(r.marcaOriginadora);
  return getMarcaOperacional(r);
}

/**
 * ¿El registro pertenece a la marca por CUALQUIERA de sus dos dimensiones —
 * owner (quién gestiona) U originador (qué marca originó el capital)? Es la regla
 * del FILTRO GLOBAL: filtrar "KIA" trae su stock retail (owner) Y el capital
 * puente que KIA originó (originador, gestionado por USADOS). Para "USADOS" trae
 * todo lo que gestiona usados (los VPP entran por owner). Sin doble conteo.
 */
export function coincideOwnerUOriginador(r: RegistroOperacional, marca: string): boolean {
  const objetivo = normalizarMarcaOperacional(marca);
  return getMarcaOperacional(r) === objetivo || getMarcaOriginadora(r) === objetivo;
}

/** Filtra por marca usando AMBAS dimensiones (owner U originador). */
export function filtrarPorMarcaOwnerUOriginador<T extends RegistroOperacional>(
  registros: T[],
  marca: string,
): T[] {
  return registros.filter((r) => coincideOwnerUOriginador(r, marca));
}

/**
 * MARCA DUEÑA del capital puente (quién consumió la caja/línea):
 *   - VU en Nuevos (Marca Pompeyo ⊃ "NUEVO") → la marca nueva originadora.
 *   - VU en Usados (BU) → USADOS (lo originó la propia unidad de usados; su
 *     originador queda "sin marca origen" por la sucursal de usados no inferible).
 * Solo aplica a vehículos esVPPComprometido.
 */
export function duenaCapitalPuente(v: Vehiculo): string {
  const esNuevos = (v.marcaPompeyo ?? "").toUpperCase().includes("NUEVO");
  return esNuevos ? getMarcaOriginadora(v) : MARCA_USADOS;
}

/**
 * Vehículos cuyo CAPITAL pertenece a la marca activa: excluye el capital puente
 * cuya marca DUEÑA ≠ marca (VU en nuevos en el lente USADOS, etc.). Sin marca
 * ("Todas") devuelve todo. Úsalo para AGREGAR capital sin doble conteo; para
 * drills/cuentas de gestión usa el universo completo
 * (filtrarPorMarcaOwnerUOriginador), donde el VU en nuevos sigue visible.
 */
export function vehiculosCapitalDeMarca(vehiculos: Vehiculo[], marca: string | null): Vehiculo[] {
  if (!marca) return vehiculos;
  const objetivo = normalizarMarcaOperacional(marca);
  // Dedup por VIN tomando la PRIMERA ocurrencia (igual que uniqByVin de los KPIs):
  // si filtráramos filas sueltas, al haber VINs duplicados un uniqByVin posterior
  // promovería otra fila del mismo VIN y lo reclasificaría (inflando financiado).
  // Por eso se excluye el VIN completo cuando su fila representativa es puente ajeno.
  const seen = new Set<string>();
  const out: Vehiculo[] = [];
  for (const v of vehiculos) {
    if (v.vin && seen.has(v.vin)) continue;
    if (v.vin) seen.add(v.vin);
    if (v.esVPPComprometido && duenaCapitalPuente(v) !== objetivo) continue;
    out.push(v);
  }
  return out;
}

/**
 * Filtra líneas de crédito por marca operacional. La línea ES de la marca
 * (no es un vehículo físico): se matchea por su glosa de marca/marcaPompeyo.
 */
export function filtrarLineasPorMarcaOperacional(
  lineas: LineaCredito[],
  marca: string,
): LineaCredito[] {
  const objetivo = normalizarMarcaOperacional(marca);
  return lineas.filter((l) => normalizarMarcaOperacional(l.marcaPompeyo ?? l.marca) === objetivo);
}

/**
 * Lista de marcas operacionales presentes en un universo de stock, ordenadas
 * por cantidad de registros (para poblar el selector global de marca).
 */
export function marcasOperacionalesDisponibles(vehiculos: Vehiculo[]): string[] {
  const counts = new Map<string, number>();
  for (const v of vehiculos) {
    const m = getMarcaOperacional(v);
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  // Marcas del grupo primero (por volumen); los buckets especiales al final.
  const orden = (m: string) => (m === MARCA_OTRAS ? 2 : m === MARCA_SIN_ORIGEN ? 3 : 1);
  return [...counts.entries()]
    .sort((a, b) => orden(a[0]) - orden(b[0]) || b[1] - a[1])
    .map(([m]) => m);
}

export interface ExplicacionMarca {
  marca: string;
  categoria: CategoriaOperacional;
  /** De qué campo/fuente se resolvió. */
  fuente: string;
  /** Marca física del vehículo (si aplica). */
  marcaFisica: string | null;
  /** ¿La marca operacional coincide con la física? */
  coincide: boolean;
  /** Texto legible para auditoría. */
  motivo: string;
}

/** Trazabilidad: explica por qué un registro tiene su marca operacional. */
export function explicarMarcaOperacional(r: RegistroOperacional): ExplicacionMarca {
  const marca = getMarcaOperacional(r);
  const categoria = getCategoriaOperacional(r);
  if (esVehiculo(r)) {
    const fisica = normalizarMarcaOperacional(r.marcaPompeyo ?? r.marca);
    const coincide = marca === fisica;
    return {
      marca,
      categoria,
      fuente: "Marca origen (marcaOriginadora)",
      marcaFisica: fisica,
      coincide,
      motivo:
        marca === MARCA_SIN_ORIGEN
          ? "Sin Marca Origen — operación no atribuible (VPP/CPD en sucursal no marca-específica). En conciliación."
          : coincide
            ? `Marca origen = ${marca} (coincide con la física).`
            : `Marca origen = ${marca}; marca física = ${fisica}. Manda la operacional.`,
    };
  }
  if (esProvision(r)) {
    return { marca, categoria, fuente: "Provisión.origen", marcaFisica: null, coincide: true, motivo: `Provisión originada por ${marca}.` };
  }
  if (esSaldo(r)) {
    const fuente = r.categoria === "bono_comision" ? "Saldo bono/comisión → sucursal" : "Saldo.marca";
    return { marca, categoria, fuente, marcaFisica: normalizarMarcaOperacional(r.marca), coincide: true, motivo: `Saldo (${r.categoria}) atribuido a ${marca}.` };
  }
  if (esFNE(r)) {
    return { marca, categoria, fuente: "FNE → sucursal de venta", marcaFisica: null, coincide: true, motivo: `FNE de sucursal ${r.sucursal ?? "—"} → ${marca}.` };
  }
  return { marca, categoria, fuente: "—", marcaFisica: null, coincide: false, motivo: "Tipo de registro no reconocido." };
}

// ── Auditoría por marca (sobre el universo de stock) ──────────────────────
export interface AuditMarcaRow {
  marca: string;
  registros: number;
  monto: number; // costo neto
  stockRetail: number;
  capitalPuente: number;
  noRetail: number;
  /** registros donde la marca física ≠ marca operacional. */
  fisicaDistinta: number;
}

/**
 * Resumen por marca operacional sobre Base_Stock. Para validar la cuadratura
 * y detectar contaminación (marca física ≠ operacional) y sin-marca.
 */
export function auditarMarcasOperacionales(vehiculos: Vehiculo[]): AuditMarcaRow[] {
  const m = new Map<string, AuditMarcaRow>();
  for (const v of vehiculos) {
    const marca = getMarcaOperacional(v);
    const cat = getCategoriaOperacional(v);
    const fisica = normalizarMarcaOperacional(v.marcaPompeyo ?? v.marca);
    const row =
      m.get(marca) ??
      { marca, registros: 0, monto: 0, stockRetail: 0, capitalPuente: 0, noRetail: 0, fisicaDistinta: 0 };
    row.registros++;
    row.monto += v.costoNeto || 0;
    if (cat === "capital_puente") row.capitalPuente++;
    else if (cat === "no_retail") row.noRetail++;
    else if (cat === "stock_retail") row.stockRetail++;
    if (marca !== fisica) row.fisicaDistinta++;
    m.set(marca, row);
  }
  return [...m.values()].sort((a, b) => b.monto - a.monto);
}
