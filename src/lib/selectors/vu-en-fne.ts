/**
 * VU asociados a Facturados No Entregados — capital puente operacional REAL.
 *
 * Hipótesis: los VPP (vehículos en parte de pago) son los VU que entraron por
 * operaciones nuevas todavía abiertas. Ese capital está atribuido a la
 * MARCA ORIGINADORA, no a la marca del vehículo.
 *
 * Esta vista agrupa esos VU por marca originadora, mostrando cuánto capital
 * de cada marca está "atado" en operaciones FNE/VN abiertas que aún no
 * monetizaron el VU recibido.
 */

import type {
  AutoNoEntregado,
  FNERealCruzado,
  ParsedFNE,
  ParsedSaldos,
  Vehiculo,
  VINSupplementary,
} from "../types";
import { cruzarFNEConStock } from "./fne-real";
import { cruzarSaldosConStock } from "./saldos";
import { calcularCreditoPompeyoPorVIN } from "./credito-pompeyo";
import { razonesBloqueoFNE } from "./razones-bloqueo";
import { limpiarVIN } from "../parser/venta-apc";

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

export interface VUEnFNERow {
  marcaOriginadora: string;
  unidades: number;
  capital: number;
  /** Subset: VU con marca distinta a la originadora (Toyota recibido en KIA, etc) */
  unidadesOtraMarca: number;
  capitalOtraMarca: number;
  diasPromedio: number;
  marcasUsadasMixtas: string[]; // top marcas de los VU recibidos
}

export interface VUEnFNEStats {
  totalUnidades: number;
  capitalTotal: number;
  unidadesOtraMarca: number;
  capitalOtraMarca: number;
  porMarcaOriginadora: VUEnFNERow[];
}

export function calcularVUEnFNE(vehiculos: Vehiculo[]): VUEnFNEStats {
  const unique = uniqByVin(vehiculos);
  const vpp = unique.filter((v) => v.esVPPComprometido);

  const totalUnidades = vpp.length;
  const capitalTotal = vpp.reduce((s, v) => s + v.costoNeto, 0);

  let unidadesOtraMarca = 0;
  let capitalOtraMarca = 0;
  for (const v of vpp) {
    if (
      v.marcaOriginadora &&
      v.marcaPompeyo &&
      v.marcaOriginadora.toUpperCase() !== v.marcaPompeyo.toUpperCase()
    ) {
      unidadesOtraMarca++;
      capitalOtraMarca += v.costoNeto;
    }
  }

  // Agrupar por marca originadora
  const map = new Map<string, Vehiculo[]>();
  for (const v of vpp) {
    const k = v.marcaOriginadora ?? "(no inferible)";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(v);
  }

  const porMarcaOriginadora: VUEnFNERow[] = Array.from(map.entries())
    .map(([marca, vs]) => {
      const cap = vs.reduce((s, v) => s + v.costoNeto, 0);
      const dias = vs.reduce((s, v) => s + (v.diasStock ?? 0), 0);
      let uOtra = 0,
        cOtra = 0;
      const mixSet = new Map<string, number>();
      for (const v of vs) {
        if (
          v.marca &&
          marca !== "(no inferible)" &&
          !v.marca.toUpperCase().includes(marca.split(" ")[0])
        ) {
          uOtra++;
          cOtra += v.costoNeto;
          const k = v.marca || "?";
          mixSet.set(k, (mixSet.get(k) ?? 0) + 1);
        }
      }
      const topMix = Array.from(mixSet.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([m]) => m);

      return {
        marcaOriginadora: marca,
        unidades: vs.length,
        capital: cap,
        unidadesOtraMarca: uOtra,
        capitalOtraMarca: cOtra,
        diasPromedio: vs.length > 0 ? dias / vs.length : 0,
        marcasUsadasMixtas: topMix,
      };
    })
    .sort((a, b) => b.capital - a.capital);

  return {
    totalUnidades,
    capitalTotal,
    unidadesOtraMarca,
    capitalOtraMarca,
    porMarcaOriginadora,
  };
}

/** Lista detalle de los VU en FNE para drilldown. */
export function vuEnFNEDetalle(vehiculos: Vehiculo[]): Vehiculo[] {
  const unique = uniqByVin(vehiculos);
  return unique
    .filter((v) => v.esVPPComprometido)
    .sort((a, b) => b.costoNeto - a.costoNeto);
}

// ────────────────────────────────────────────────────────────────────────
// Usados pendientes de recuperación — vista operacional (lenguaje de negocio).
//
// Mismo universo (VU recibidos en parte de pago por operaciones todavía
// abiertas), pero presentado como "qué usados no hemos recuperado y qué marca
// los está reteniendo". La marca responsable es la que originó la operación
// nueva; cuando no se puede inferir, el usado pertenece a la unidad USADOS.
// ────────────────────────────────────────────────────────────────────────

/** Etiqueta de la unidad operacional que retiene el usado. */
const UNIDAD_USADOS = "USADOS";

function marcaResponsableDe(v: Vehiculo): string {
  const m = v.marcaOriginadora;
  if (!m || m === "(no inferible)") return UNIDAD_USADOS;
  return m;
}

/** ¿El usado es de una marca distinta a la responsable de la operación? */
function esUsadoExterno(v: Vehiculo, responsable: string): boolean {
  if (responsable === UNIDAD_USADOS) return false;
  if (!v.marca) return false;
  const first = responsable.split(" ")[0].toUpperCase();
  return !v.marca.toUpperCase().includes(first);
}

export interface UsadoMarcaRow {
  marca: string; // marca responsable ("USADOS" cuando no se infiere)
  esUsadosUnidad: boolean;
  unidades: number;
  capital: number;
  diasPromedio: number;
  mas30: number;
  mas60: number;
  mas90: number;
  capitalCritico: number; // capital de usados con >90 días
  unidadesExternas: number;
  pctExternos: number;
  marcasExternas: string[];
  vins: Vehiculo[];
}

export interface UsadosPendientesStats {
  totalUnidades: number;
  capitalTotal: number;
  mas30: number;
  mas60: number;
  mas90: number;
  capitalCritico: number;
  agingPromedio: number;
  porMarca: UsadoMarcaRow[];
  todos: Vehiculo[];
}

// ════════════════════════════════════════════════════════════════════════
// RECUPERACIÓN DE USADOS · cruce con la operación nueva + aging real.
//
// Cada VU/BU recibido en parte de pago (esVPPComprometido) intenta vincularse
// con su OPERACIÓN NUEVA (FNE) por varias llaves. El aging de recuperación se
// calcula desde la PRIMERA fecha confiable disponible — nunca 0 por defecto.
// Los casos sin cruce o sin fecha NO se ocultan: van a secciones auditables.
// ════════════════════════════════════════════════════════════════════════

/**
 * Tipo de capital puente — campo MAESTRO desde Base_Stock ("Marca Pompeyo"):
 *   "VU en Nuevos" → BU recibido en venta de auto NUEVO.
 *   "VU en Usados" → BU recibido en venta de auto USADO.
 * No depende de FNE.
 */
export type TipoCapitalPuente = "BU_NUEVOS" | "BU_USADOS" | "SIN_CLASIFICAR";

/**
 * Estado del vínculo con la operación origen. Base_Stock es la fuente maestra;
 * FNE solo enriquece. Por eso "sin FNE" NO es "sin operación".
 */
export type EstadoCruce =
  | "enriquecido_fne" // operación nueva encontrada en FNE → estado de entrega
  | "directo_base_stock" // válido desde Base_Stock (tipo+marca+fecha); sin detalle FNE
  | "requiere_conciliacion" // falta clasificación/marca origen → conciliar
  | "sin_datos_suficientes"; // sin fecha ni tipo

/** Confianza del enriquecimiento FNE (cuando aplica). */
export type ConfianzaCruce = "alto" | "medio" | "bajo" | "sin_cruce";

/** Clasificación operacional del caso (orden = prioridad de acción). */
export type ClaseRecuperacion =
  | "entregar_ya" // 1 · operación lista + VU retenido
  | "bloqueo_financiero" // 2 · lista pero Crédito Pompeyo pendiente
  | "falta_logistica" // 3 · auto no llega a sucursal
  | "falta_patente" // 4 · patente en tránsito / administración
  | "falta_inscripcion" // 5 · inscripción en proceso
  | "falta_solicitud" // 6 · falta solicitud / autorización
  | "sin_detalle_fne" // 7 · capital puente válido (Base_Stock), sin detalle FNE
  | "sin_fecha"; // 8 · sin fecha de origen confiable

export interface CasoRecuperacion {
  usado: Vehiculo;
  tipoCapitalPuente: TipoCapitalPuente;
  cruzado: FNERealCruzado | null;
  estadoCruce: EstadoCruce;
  confianzaCruce: ConfianzaCruce;
  /** Qué llave produjo el enriquecimiento FNE (para auditoría). */
  cruceLlave: string;
  tieneCP: boolean;
  /** Días de recuperación; null = sin fecha confiable. */
  aging: number | null;
  fechaOrigen: Date | null;
  fuenteFecha: string;
  clase: ClaseRecuperacion;
  rank: number;
  responsable: string;
}

export interface RecuperacionStats {
  totalUnidades: number;
  capitalTotal: number;
  buNuevos: { unidades: number; monto: number };
  buUsados: { unidades: number; monto: number };
  sinClasificar: { unidades: number; monto: number };
  enriquecidoFNE: number;
  directoBaseStock: number;
  requiereConciliacion: { unidades: number; monto: number };
  sinFecha: { unidades: number; monto: number };
  mas30: number;
  mas60: number;
  mas90: number;
  capitalCritico: number;
  agingPromedio: number;
  porMarca: RecupMarcaRow[];
  casos: CasoRecuperacion[];
}

export interface RecupMarcaRow {
  marca: string;
  esUsadosUnidad: boolean;
  unidades: number;
  capital: number;
  diasPromedio: number;
  mas30: number;
  mas90: number;
  buNuevos: number;
  buUsados: number;
  requiereConciliacion: number;
  sinFecha: number;
  unidadesExternas: number;
  pctExternos: number;
  marcasExternas: string[];
  casos: CasoRecuperacion[];
}

function normPatente(p: string | null | undefined): string {
  return (p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ════════════════════════════════════════════════════════════════════════
// ORIGEN del capital puente · cruce ligero VU/BU → operación nueva (FNE).
//
// El caso a gestionar es la OPERACIÓN NUEVA originadora, no el VU recibido. La
// llave principal es FNE.PatenteVpp ↔ patente del VU; fallback por folio. Esto
// es un resolver O(1) por VU (índice precomputado) para usar en cualquier drill
// de capital puente sin reconstruir el cruce completo. NO inventa vínculo.
// ════════════════════════════════════════════════════════════════════════

export interface FNEOrigenIndex {
  porPatente: Map<string, AutoNoEntregado>;
  porFolio: Map<string, AutoNoEntregado>;
}

/** Índice de FNE por PatenteVpp y por folio (id). Construir una vez por universo. */
export function indexarFNEPorOrigen(fneRegistros: AutoNoEntregado[]): FNEOrigenIndex {
  const porPatente = new Map<string, AutoNoEntregado>();
  const porFolio = new Map<string, AutoNoEntregado>();
  for (const f of fneRegistros) {
    const p = normPatente(f.patenteVpp);
    if (p && !porPatente.has(p)) porPatente.set(p, f);
    if (f.id != null) {
      const k = String(f.id);
      if (!porFolio.has(k)) porFolio.set(k, f);
    }
  }
  return { porPatente, porFolio };
}

export type LlaveOrigenPuente = "patente_vpp" | "folio" | "sin_vinculo";

/**
 * Estado del capital puente. CLAVE: "sin FNE" NO es un error — Base_Stock es la
 * fuente MAESTRA del VU/BU. Es una COLA DE HIGIENE operacional (regularizar el
 * origen), no una falla técnica. La conciliación real es la excepción.
 *   - origen_enriquecido          → cruce FNE confiable: existe operación nueva.
 *   - origen_pendiente_regularizar → BU/VPP válido por Base_Stock, falta vincular
 *                                    la operación nueva (revisar nota de venta / BPP
 *                                    ingresado / PatenteVpp en FNE). NO es error.
 *   - conciliacion_real           → faltan TODAS las señales base (sin fecha/folio
 *                                    retoma, patente ni tipo BU). Alerta técnica.
 */
export type EstadoOrigenPuente =
  | "origen_enriquecido"
  | "origen_pendiente_regularizar"
  | "conciliacion_real";

export interface OrigenPuente {
  /** VIN normalizado de la operación nueva; null si no hay vínculo confiable. */
  nuevoVin: string | null;
  /** Registro FNE de la operación nueva (cliente, estado, factura…). null si no cruza. */
  fne: AutoNoEntregado | null;
  llave: LlaveOrigenPuente;
  estado: EstadoOrigenPuente;
  /** Validado por Base_Stock (tiene ≥1 señal base) — no es conciliación. */
  baseStockValido: boolean;
}

/** ¿El VU/BU tiene señales base suficientes (Base_Stock) para ser capital puente válido? */
function baseSuficiente(usado: Vehiculo): boolean {
  const tipoBU = /NUEVO|USADO/.test((usado.marcaPompeyo ?? "").toUpperCase());
  return !!usado.fechaRetoma || !!usado.folioRetoma || !!usado.patente || tipoBU;
}

/**
 * Resuelve la operación nueva que originó un VU/BU recibido en parte de pago.
 * Prioridad de cruce: PatenteVpp → folio. Si no cruza pero Base_Stock es válido
 * → base_stock_valido (NO conciliación). Solo si faltan TODAS las señales base
 * → conciliacion_real. NUNCA inventa cliente/VIN origen.
 */
export function resolverOrigenPuente(usado: Vehiculo, idx: FNEOrigenIndex): OrigenPuente {
  const pat = normPatente(usado.patente);
  let fne = pat ? idx.porPatente.get(pat) ?? null : null;
  let llave: LlaveOrigenPuente = fne ? "patente_vpp" : "sin_vinculo";
  if (!fne) {
    const folio =
      (usado.folioVenta && idx.porFolio.get(String(usado.folioVenta))) ||
      (usado.folioRetoma && idx.porFolio.get(String(usado.folioRetoma))) ||
      null;
    if (folio) {
      fne = folio;
      llave = "folio";
    }
  }
  const baseStockValido = baseSuficiente(usado);
  const estado: EstadoOrigenPuente = fne
    ? "origen_enriquecido"
    : baseStockValido
      ? "origen_pendiente_regularizar"
      : "conciliacion_real";
  return { nuevoVin: fne ? limpiarVIN(fne.vin) : null, fne, llave, estado, baseStockValido };
}

/**
 * Owner secundario del capital puente (cola de regularización): vendedor / jefe
 * de local que originó la operación. USADOS es siempre el owner principal.
 */
export function ownerSecundarioPuente(usado: Vehiculo): string | null {
  const partes = [usado.vendedor, usado.sucursal].filter((x): x is string => !!x && x.trim() !== "");
  return partes.length ? partes.join(" · ") : null;
}

function diasDesdeFecha(d: Date | null, hoy: Date): number | null {
  if (!d) return null;
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  const dias = Math.floor((hoy.getTime() - t) / 86_400_000);
  return dias >= 0 ? dias : null; // fecha futura = dato no confiable → sin fecha
}

/**
 * Fecha de origen del capital puente, por prioridad:
 *   1. factura/venta de la operación nueva (FNE)
 *   2/4. fecha de retoma del usado (documento/Base_Stock del VPP)
 *   3. fecha de venta registrada del usado
 * Si nada existe → null ("sin fecha", a conciliación). NUNCA 0 por defecto.
 */
function fechaOrigenDe(
  usado: Vehiculo,
  cruzado: FNERealCruzado | null,
): { fecha: Date | null; fuente: string } {
  if (cruzado) {
    if (cruzado.fne.fechaFactura) return { fecha: cruzado.fne.fechaFactura, fuente: "factura operación nueva" };
    if (cruzado.fne.fechaVenta) return { fecha: cruzado.fne.fechaVenta, fuente: "venta operación nueva" };
  }
  if (usado.fechaRetoma) return { fecha: usado.fechaRetoma, fuente: "retoma del usado" };
  if (usado.fechaVenta) return { fecha: usado.fechaVenta, fuente: "venta registrada" };
  return { fecha: null, fuente: "sin fecha de origen" };
}

const CLASE_RANK: Record<ClaseRecuperacion, number> = {
  entregar_ya: 1,
  bloqueo_financiero: 2,
  falta_logistica: 3,
  falta_patente: 4,
  falta_inscripcion: 5,
  falta_solicitud: 6,
  sin_detalle_fne: 7,
  sin_fecha: 8,
};

/** Tipo de capital puente desde Base_Stock ("Marca Pompeyo"). Fuente maestra. */
function tipoBUDe(v: Vehiculo): TipoCapitalPuente {
  const m = (v.marcaPompeyo ?? "").toUpperCase();
  if (m.includes("NUEVO")) return "BU_NUEVOS";
  if (m.includes("USADO")) return "BU_USADOS"; // "VU EN USADOS" / "USADOS"
  return "SIN_CLASIFICAR";
}

function clasificarRecuperacion(
  cruzado: FNERealCruzado | null,
  tieneCP: boolean,
  aging: number | null,
): ClaseRecuperacion {
  if (aging == null) return "sin_fecha";
  // Sin enriquecimiento FNE = caso válido de Base_Stock, sin detalle de entrega.
  if (!cruzado) return "sin_detalle_fne";
  if (cruzado.listoParaEntregar) return tieneCP ? "bloqueo_financiero" : "entregar_ya";
  if (cruzado.autoEnSucursal === "no") return "falta_logistica";
  const e = cruzado.estadoEntrega;
  if (e === "patente_en_transito" || e === "patente_en_admin") return "falta_patente";
  if (
    e === "inscrita_sin_admin" ||
    e === "en_registro_civil" ||
    e === "en_control_negocios" ||
    e === "sin_solicitud_inscripcion"
  )
    return "falta_inscripcion";
  return "falta_solicitud"; // patente_en_sucursal / falta_solo_autorizacion
}

/**
 * Construye los casos de capital puente. FUENTE MAESTRA = Base_Stock (VPP):
 * tipo (BU nuevos/usados), marca operacional, aging (retoma) salen de ahí.
 * FNE SOLO enriquece el estado de entrega de la operación nueva (por patente/
 * folio). Sin FNE NO es "sin operación": es un caso válido sin detalle FNE.
 * Pura: recibe los registros ya filtrados por el filtro global de marca.
 */
export function recuperacionUsados(
  vehiculos: Vehiculo[],
  fne: ParsedFNE | null,
  saldos: ParsedSaldos | null,
  vinsExtra: Map<string, VINSupplementary> | null,
  hoy: Date = new Date(),
): RecuperacionStats {
  const cruzados = fne ? cruzarFNEConStock(fne.registros, vehiculos, vinsExtra, hoy) : [];
  const porPatente = new Map<string, FNERealCruzado>();
  const porFolio = new Map<string, FNERealCruzado>();
  for (const c of cruzados) {
    const pat = normPatente(c.fne.patenteVpp);
    if (pat && !porPatente.has(pat)) porPatente.set(pat, c);
    const folio = c.fne.id != null ? String(c.fne.id) : "";
    if (folio && !porFolio.has(folio)) porFolio.set(folio, c);
  }
  const creditoMap = calcularCreditoPompeyoPorVIN(
    saldos ? cruzarSaldosConStock(saldos.registros, vehiculos, vinsExtra, fne) : [],
  );
  const tieneCPDe = (c: FNERealCruzado) =>
    razonesBloqueoFNE(c, creditoMap).some((b) => b.tipo === "financiero");

  const vpp = uniqByVin(vehiculos).filter((v) => v.esVPPComprometido);
  const casos: CasoRecuperacion[] = vpp.map((usado) => {
    const tipoCapitalPuente = tipoBUDe(usado);

    // Enriquecimiento FNE (NO es la fuente del caso): patente VPP → folio.
    let cruzado: FNERealCruzado | null = porPatente.get(normPatente(usado.patente)) ?? null;
    let confianzaCruce: ConfianzaCruce = cruzado ? "alto" : "sin_cruce";
    let cruceLlave = cruzado ? "patente VPP" : "—";
    if (!cruzado) {
      const folio =
        (usado.folioVenta && porFolio.get(String(usado.folioVenta))) ||
        (usado.folioRetoma && porFolio.get(String(usado.folioRetoma))) ||
        null;
      if (folio) {
        cruzado = folio;
        confianzaCruce = "medio";
        cruceLlave = "folio operación";
      }
    }

    const tieneCP = cruzado ? tieneCPDe(cruzado) : false;
    const { fecha, fuente } = fechaOrigenDe(usado, cruzado);
    let aging = diasDesdeFecha(fecha, hoy);
    let fuenteFecha = fuente;
    if (aging == null && (usado.diasStock ?? 0) > 0) {
      aging = usado.diasStock as number;
      fuenteFecha = "días en stock";
    }

    // Estado del vínculo (Base_Stock master + FNE enrich).
    let estadoCruce: EstadoCruce;
    if (cruzado) estadoCruce = "enriquecido_fne";
    else if (tipoCapitalPuente !== "SIN_CLASIFICAR" && aging != null) estadoCruce = "directo_base_stock";
    else if (aging == null) estadoCruce = "sin_datos_suficientes";
    else estadoCruce = "requiere_conciliacion";

    const clase = clasificarRecuperacion(cruzado, tieneCP, aging);
    return {
      usado,
      tipoCapitalPuente,
      cruzado,
      estadoCruce,
      confianzaCruce,
      cruceLlave,
      tieneCP,
      aging,
      fechaOrigen: fecha,
      fuenteFecha,
      clase,
      rank: CLASE_RANK[clase],
      responsable: marcaResponsableDe(usado),
    };
  });

  const sumMonto = (cs: CasoRecuperacion[]) => cs.reduce((s, c) => s + (c.usado.costoNeto || 0), 0);
  const totalUnidades = casos.length;
  const capitalTotal = sumMonto(casos);
  const conFecha = casos.filter((c) => c.aging != null);
  const agingPromedio =
    conFecha.length > 0
      ? Math.round(conFecha.reduce((s, c) => s + (c.aging as number), 0) / conFecha.length)
      : 0;
  const mas30 = casos.filter((c) => c.aging != null && (c.aging as number) > 30).length;
  const mas60 = casos.filter((c) => c.aging != null && (c.aging as number) > 60).length;
  const mas90 = casos.filter((c) => c.aging != null && (c.aging as number) > 90).length;
  const capitalCritico = sumMonto(casos.filter((c) => c.aging != null && (c.aging as number) > 90));
  const nuevosCasos = casos.filter((c) => c.tipoCapitalPuente === "BU_NUEVOS");
  const usadosCasos = casos.filter((c) => c.tipoCapitalPuente === "BU_USADOS");
  const sinClasifCasos = casos.filter((c) => c.tipoCapitalPuente === "SIN_CLASIFICAR");
  const concilCasos = casos.filter(
    (c) => c.estadoCruce === "requiere_conciliacion" || c.estadoCruce === "sin_datos_suficientes",
  );
  const sinFechaCasos = casos.filter((c) => c.aging == null);

  // Agrupar por marca responsable.
  const map = new Map<string, CasoRecuperacion[]>();
  for (const c of casos) {
    if (!map.has(c.responsable)) map.set(c.responsable, []);
    map.get(c.responsable)!.push(c);
  }
  const porMarca: RecupMarcaRow[] = [...map.entries()]
    .map(([marca, cs]) => {
      const conF = cs.filter((c) => c.aging != null);
      const dias = conF.reduce((s, c) => s + (c.aging as number), 0);
      const externos = cs.filter((c) => esUsadoExterno(c.usado, marca));
      const mixSet = new Map<string, number>();
      for (const c of externos) mixSet.set(c.usado.marca || "?", (mixSet.get(c.usado.marca || "?") ?? 0) + 1);
      return {
        marca,
        esUsadosUnidad: marca === UNIDAD_USADOS,
        unidades: cs.length,
        capital: sumMonto(cs),
        diasPromedio: conF.length > 0 ? Math.round(dias / conF.length) : 0,
        mas30: cs.filter((c) => c.aging != null && (c.aging as number) > 30).length,
        mas90: cs.filter((c) => c.aging != null && (c.aging as number) > 90).length,
        buNuevos: cs.filter((c) => c.tipoCapitalPuente === "BU_NUEVOS").length,
        buUsados: cs.filter((c) => c.tipoCapitalPuente === "BU_USADOS").length,
        requiereConciliacion: cs.filter(
          (c) => c.estadoCruce === "requiere_conciliacion" || c.estadoCruce === "sin_datos_suficientes",
        ).length,
        sinFecha: cs.filter((c) => c.aging == null).length,
        unidadesExternas: externos.length,
        pctExternos: cs.length > 0 ? externos.length / cs.length : 0,
        marcasExternas: [...mixSet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([m]) => m),
        casos: cs,
      };
    })
    .sort((a, b) => b.capital - a.capital);

  return {
    totalUnidades,
    capitalTotal,
    buNuevos: { unidades: nuevosCasos.length, monto: sumMonto(nuevosCasos) },
    buUsados: { unidades: usadosCasos.length, monto: sumMonto(usadosCasos) },
    sinClasificar: { unidades: sinClasifCasos.length, monto: sumMonto(sinClasifCasos) },
    enriquecidoFNE: casos.filter((c) => c.estadoCruce === "enriquecido_fne").length,
    directoBaseStock: casos.filter((c) => c.estadoCruce === "directo_base_stock").length,
    requiereConciliacion: { unidades: concilCasos.length, monto: sumMonto(concilCasos) },
    sinFecha: { unidades: sinFechaCasos.length, monto: sumMonto(sinFechaCasos) },
    mas30,
    mas60,
    mas90,
    capitalCritico,
    agingPromedio,
    porMarca,
    casos,
  };
}

export function usadosPendientesRecuperacion(vehiculos: Vehiculo[]): UsadosPendientesStats {
  const unique = uniqByVin(vehiculos);
  const vpp = unique
    .filter((v) => v.esVPPComprometido)
    .sort((a, b) => (b.diasStock ?? 0) - (a.diasStock ?? 0));

  const totalUnidades = vpp.length;
  const capitalTotal = vpp.reduce((s, v) => s + (v.costoNeto || 0), 0);
  const diasTot = vpp.reduce((s, v) => s + (v.diasStock ?? 0), 0);
  const agingPromedio = totalUnidades > 0 ? Math.round(diasTot / totalUnidades) : 0;
  const mas30 = vpp.filter((v) => (v.diasStock ?? 0) > 30).length;
  const mas60 = vpp.filter((v) => (v.diasStock ?? 0) > 60).length;
  const mas90 = vpp.filter((v) => (v.diasStock ?? 0) > 90).length;
  const capitalCritico = vpp
    .filter((v) => (v.diasStock ?? 0) > 90)
    .reduce((s, v) => s + (v.costoNeto || 0), 0);

  const map = new Map<string, Vehiculo[]>();
  for (const v of vpp) {
    const k = marcaResponsableDe(v);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(v);
  }

  const porMarca: UsadoMarcaRow[] = [...map.entries()]
    .map(([marca, vs]) => {
      const capital = vs.reduce((s, v) => s + (v.costoNeto || 0), 0);
      const dias = vs.reduce((s, v) => s + (v.diasStock ?? 0), 0);
      const externos = vs.filter((v) => esUsadoExterno(v, marca));
      const mixSet = new Map<string, number>();
      for (const v of externos) {
        const k = v.marca || "?";
        mixSet.set(k, (mixSet.get(k) ?? 0) + 1);
      }
      return {
        marca,
        esUsadosUnidad: marca === UNIDAD_USADOS,
        unidades: vs.length,
        capital,
        diasPromedio: vs.length > 0 ? Math.round(dias / vs.length) : 0,
        mas30: vs.filter((v) => (v.diasStock ?? 0) > 30).length,
        mas60: vs.filter((v) => (v.diasStock ?? 0) > 60).length,
        mas90: vs.filter((v) => (v.diasStock ?? 0) > 90).length,
        capitalCritico: vs
          .filter((v) => (v.diasStock ?? 0) > 90)
          .reduce((s, v) => s + (v.costoNeto || 0), 0),
        unidadesExternas: externos.length,
        pctExternos: vs.length > 0 ? externos.length / vs.length : 0,
        marcasExternas: [...mixSet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([m]) => m),
        vins: vs,
      };
    })
    .sort((a, b) => b.capital - a.capital);

  return {
    totalUnidades,
    capitalTotal,
    mas30,
    mas60,
    mas90,
    capitalCritico,
    agingPromedio,
    porMarca,
    todos: vpp,
  };
}

// ════════════════════════════════════════════════════════════════════════
// CONCILIACIÓN PENDIENTE · candidatos FNE para usados sin operación vinculada.
//
// Para los VPP que NO cruzaron por patente/folio, busca operaciones nuevas
// (FNE) candidatas por coincidencia FLEXIBLE (sucursal, vendedor, fecha
// cercana, y re-chequeo de patente/folio). NO vincula automáticamente: solo
// propone candidatos con confianza para que un humano concilie.
//
// Nota de datos: el usado (Base_Stock) NO trae "cliente", así que ese criterio
// no se puede matchear desde el usado; sí vendedor, sucursal, folios y fechas.
// ════════════════════════════════════════════════════════════════════════

export type ConfianzaCandidato = "alto" | "medio" | "bajo";

export interface CandidatoFNE {
  fne: AutoNoEntregado;
  vinNuevo: string;
  score: number;
  confianza: ConfianzaCandidato;
  /** Señales que coincidieron (auditable). */
  senales: string[];
}

export type EstadoConciliacion =
  | "candidato_alto"
  | "candidato_medio"
  | "candidato_bajo"
  | "sin_candidato";

export interface CasoConciliacion {
  caso: CasoRecuperacion;
  candidatos: CandidatoFNE[];
  estado: EstadoConciliacion;
}

function normTxt(s: string | null | undefined): string {
  return (s ?? "").toString().toUpperCase().replace(/\s+/g, " ").trim();
}

function confianzaDeScore(score: number): ConfianzaCandidato {
  if (score >= 80) return "alto";
  if (score >= 30) return "medio";
  return "bajo";
}

/** Candidatos FNE para un usado sin cruce, por coincidencia flexible. */
export function candidatosFNEParaUsado(
  usado: Vehiculo,
  fneRegistros: AutoNoEntregado[],
  hoy: Date = new Date(),
): CandidatoFNE[] {
  void hoy;
  const patUsado = normPatente(usado.patente);
  const foliosUsado = [usado.folioVenta, usado.folioRetoma]
    .filter((f): f is string => !!f)
    .map((f) => String(f));
  const vendUsado = normTxt(usado.vendedor);
  const sucUsado = normTxt(usado.sucursal);
  const fechaRef = usado.fechaRetoma ?? usado.fechaVenta ?? null;

  const out: CandidatoFNE[] = [];
  for (const fne of fneRegistros) {
    let score = 0;
    const senales: string[] = [];

    if (patUsado && normPatente(fne.patenteVpp) === patUsado) {
      score += 100;
      senales.push("misma patente VPP");
    }
    if (fne.id != null && foliosUsado.includes(String(fne.id))) {
      score += 80;
      senales.push("mismo folio");
    }
    if (vendUsado && normTxt(fne.vendedor) === vendUsado) {
      score += 25;
      senales.push("mismo vendedor");
    }
    if (sucUsado && normTxt(fne.sucursal) === sucUsado) {
      score += 15;
      senales.push("misma sucursal");
    }
    const refFne = fne.fechaVenta ?? fne.fechaFactura ?? null;
    if (fechaRef && refFne) {
      const diff = Math.abs(Math.round((fechaRef.getTime() - refFne.getTime()) / 86_400_000));
      if (diff <= 15) {
        score += 20;
        senales.push(`fecha ≤15d (${diff}d)`);
      } else if (diff <= 45) {
        score += 10;
        senales.push(`fecha ≤45d (${diff}d)`);
      }
    }

    if (score > 0) {
      out.push({
        fne,
        vinNuevo: limpiarVIN(fne.vin),
        score,
        confianza: confianzaDeScore(score),
        senales,
      });
    }
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

/** Lista de conciliación: casos sin cruce + sus candidatos FNE. */
export function conciliacionPendiente(
  stats: RecuperacionStats,
  fne: ParsedFNE | null,
  hoy: Date = new Date(),
): CasoConciliacion[] {
  const registros = fne?.registros ?? [];
  // Conciliación REAL = casos sin clasificar / sin datos en Base_Stock.
  // (El enriquecimiento FNE faltante NO es conciliación: es caso válido.)
  const pendientes = stats.casos.filter(
    (c) => c.estadoCruce === "requiere_conciliacion" || c.estadoCruce === "sin_datos_suficientes",
  );
  return pendientes
    .map<CasoConciliacion>((caso) => {
      const candidatos = candidatosFNEParaUsado(caso.usado, registros, hoy);
      const best = candidatos[0];
      const estado: EstadoConciliacion = !best
        ? "sin_candidato"
        : best.confianza === "alto"
          ? "candidato_alto"
          : best.confianza === "medio"
            ? "candidato_medio"
            : "candidato_bajo";
      return { caso, candidatos, estado };
    })
    .sort((a, b) => (b.candidatos[0]?.score ?? 0) - (a.candidatos[0]?.score ?? 0));
}
