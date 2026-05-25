/**
 * VehiculoUnificado · cruce maestro por VIN.
 *
 * Una sola función que produce Map<vinLimpio, VehiculoUnificado> con TODAS
 * las dimensiones consolidadas. Es la base del motor de priorización y del
 * Centro de Acción.
 *
 * Principio operacional:
 *   - marca    = precisión financiera (agregaciones contables)
 *   - sucursal = precisión operacional (ejecución de entrega)
 *   - VIN      = precisión absoluta (gestión accionable individual)
 *
 * Este selector pertenece al nivel VIN.
 */

import type {
  AutoNoEntregado,
  EstadoEntrega,
  LineaCredito,
  ParsedExcel,
  ParsedFNE,
  ParsedSaldos,
  SaldoRegistro,
  TipoStock,
  Vehiculo,
  VINSupplementary,
} from "../types";
import { limpiarVIN } from "../parser/venta-apc";
import { limpiarCajon, pareceePatente } from "../parser/saldos";
import { cruzarFNEConStock } from "./fne-real";
import { cruzarSaldosConStock } from "./saldos";
import { razonesBloqueoFNE, type Bloqueo } from "./razones-bloqueo";
import { calcularCreditoPompeyoPorVIN } from "./credito-pompeyo";

export type FuenteCapital = "fne" | "saldo_cliente" | "stock_propio" | "credito_pompeyo" | "ninguna";

export interface VehiculoUnificado {
  vin: string;            // VIN original (puede traer espacios)
  vinLimpio: string;      // VIN normalizado

  // Identificación (mejor fuente disponible)
  marca: string | null;          // marca FÍSICA del auto (identificación)
  /** Marca ORIGINADORA (atribución financiera): qué marca originó/consumió el
   *  capital. Para un VU/BU en parte de pago es la marca de la operación que lo
   *  tomó (≠ owner operacional, que es USADOS). null si no es inferible. */
  marcaOriginadora: string | null;
  modelo: string | null;
  patente: string | null;
  cajon: string | null;
  cliente: string | null;
  sucursal: string | null;
  bodega: string | null;
  vendedor: string | null;

  // Presencia en cada fuente (FULL OUTER JOIN)
  enStockActivo: boolean;
  enHistoricoVenta: boolean;
  enFinanciado: boolean;
  enFNE: boolean;
  enSaldos: boolean;
  /** Universo operacional activo: está en stock vivo, FNE o saldos.
   *  EXCLUYE los VINs que solo están en histórico Venta APC (ya entregados
   *  hace meses). El Centro de Acción opera solo sobre activos. */
  esOperacionalActivo: boolean;

  // Stock
  tipoStock: TipoStock | null;
  costoNeto: number;
  diasStock: number | null;

  // Financiamiento (vinculado por marca → línea)
  marcaLineaVinculada: string | null;
  lineaFechaVencimiento: Date | null;
  lineaDiasParaVencer: number | null;
  lineaSobregirada: boolean;       // si la marca tiene sobregiro

  // FNE
  fneEstado: EstadoEntrega | null;
  fneDiasFactura: number | null;
  fneDiasEnEstado: number | null;
  fneValorFactura: number;
  fneAutoEnSucursal: "si" | "no" | "por_validar" | null;
  fneBloqueos: Bloqueo[];

  // Saldos cliente
  saldoCliente: number;             // suma saldos.vehículo asignados a este VIN
  creditoPompeyo: number;           // subset: solo subTipo credito_pompeyo
  saldosDetalle: SaldoRegistro[];   // para drilldown

  // Señales de riesgo / naturaleza
  esJudicial: boolean;
  esTescar: boolean;
  esTescarOperacional: boolean;
  diasTescar: number | null;        // proxy: diasStock si esTescar
  esStockPagadoViejo: boolean;      // tipoStock=Propio + diasStock>180
  esVPP: boolean;
  diasVPP: number | null;

  // Capital comprometido — el max() para no doble contar
  capitalComprometido: number;
  capitalComprometidoFuente: FuenteCapital;
}

interface BuildInputs {
  data: ParsedExcel | null;
  fne: ParsedFNE | null;
  saldos: ParsedSaldos | null;
}

/** Marca con sobregiro = lineaOcupada > lineaAutorizada para esa marca. */
function marcasConSobregiro(lineas: LineaCredito[]): Set<string> {
  const out = new Set<string>();
  for (const l of lineas) {
    if (l.lineaOcupada > l.lineaAutorizada) {
      const k = (l.marcaPompeyo ?? l.marca).toUpperCase();
      out.add(k);
    }
  }
  return out;
}

function findLineaParaMarca(
  marca: string | null,
  lineas: LineaCredito[],
): LineaCredito | null {
  if (!marca) return null;
  const u = marca.toUpperCase();
  // Match por marcaPompeyo > marca, con substring fallback
  return (
    lineas.find((l) => (l.marcaPompeyo ?? "").toUpperCase() === u) ??
    lineas.find((l) => l.marca.toUpperCase() === u) ??
    lineas.find((l) => u.includes((l.marcaPompeyo ?? l.marca).toUpperCase().split(" ")[0])) ??
    null
  );
}

/** Calcula el capital comprometido SIN doble conteo. */
function calcularCapitalComprometido(args: {
  fneValorFactura: number;
  saldoCliente: number;
  costoNetoPropio: number; // solo si tipoStock=Propio/FinPropio, sino 0
  creditoPompeyo: number;
}): { monto: number; fuente: FuenteCapital } {
  const opts: { monto: number; fuente: FuenteCapital }[] = [
    { monto: args.fneValorFactura, fuente: "fne" },
    { monto: args.saldoCliente, fuente: "saldo_cliente" },
    { monto: args.costoNetoPropio, fuente: "stock_propio" },
    { monto: args.creditoPompeyo, fuente: "credito_pompeyo" },
  ];
  let best: { monto: number; fuente: FuenteCapital } = { monto: 0, fuente: "ninguna" };
  for (const o of opts) if (o.monto > best.monto) best = o;
  return best;
}

export function buildVehiculosUnificados(
  inputs: BuildInputs,
  hoy: Date = new Date(),
): Map<string, VehiculoUnificado> {
  const { data, fne, saldos } = inputs;
  const universo = new Map<string, VehiculoUnificado>();

  // ──────────────────────────────────────────────────────────────────
  // 1) Sembrar el universo con Base_Stock + suplementario + FNE
  // ──────────────────────────────────────────────────────────────────

  const sobregiros = marcasConSobregiro(data?.lineas ?? []);

  function ensure(vinLimpio: string, vinOriginal: string): VehiculoUnificado {
    let vu = universo.get(vinLimpio);
    if (!vu) {
      vu = {
        vin: vinOriginal,
        vinLimpio,
        marca: null,
        marcaOriginadora: null,
        modelo: null,
        patente: null,
        cajon: null,
        cliente: null,
        sucursal: null,
        bodega: null,
        vendedor: null,
        enStockActivo: false,
        enHistoricoVenta: false,
        enFinanciado: false,
        enFNE: false,
        enSaldos: false,
        esOperacionalActivo: false,
        tipoStock: null,
        costoNeto: 0,
        diasStock: null,
        marcaLineaVinculada: null,
        lineaFechaVencimiento: null,
        lineaDiasParaVencer: null,
        lineaSobregirada: false,
        fneEstado: null,
        fneDiasFactura: null,
        fneDiasEnEstado: null,
        fneValorFactura: 0,
        fneAutoEnSucursal: null,
        fneBloqueos: [],
        saldoCliente: 0,
        creditoPompeyo: 0,
        saldosDetalle: [],
        esJudicial: false,
        esTescar: false,
        esTescarOperacional: false,
        diasTescar: null,
        esStockPagadoViejo: false,
        esVPP: false,
        diasVPP: null,
        capitalComprometido: 0,
        capitalComprometidoFuente: "ninguna",
      };
      universo.set(vinLimpio, vu);
    }
    return vu;
  }

  // 1a) Base_Stock — vehículos activos
  if (data) {
    for (const v of data.vehiculos) {
      const vinL = limpiarVIN(v.vin);
      if (!vinL || vinL.length !== 17) continue;
      const vu = ensure(vinL, v.vin);
      vu.enStockActivo = true;
      vu.marca = vu.marca ?? v.marca ?? v.marcaPompeyo ?? null;
      vu.marcaOriginadora = vu.marcaOriginadora ?? v.marcaOriginadora ?? null;
      vu.modelo = vu.modelo ?? v.modelo ?? null;
      vu.patente = vu.patente ?? v.patente ?? null;
      vu.sucursal = vu.sucursal ?? v.sucursal ?? null;
      vu.bodega = vu.bodega ?? v.bodega ?? null;
      vu.vendedor = vu.vendedor ?? v.vendedor ?? null;
      vu.tipoStock = vu.tipoStock ?? v.tipoStock;
      vu.costoNeto = vu.costoNeto || v.costoNeto;
      vu.diasStock = vu.diasStock ?? v.diasStock;
      vu.esJudicial = vu.esJudicial || v.esJudicial;
      vu.esTescar = vu.esTescar || v.esTescar;
      vu.esTescarOperacional = vu.esTescarOperacional || v.esTescarOperacional;
      vu.esVPP = vu.esVPP || v.esVPPComprometido;
      if (vu.esVPP && vu.diasVPP === null) vu.diasVPP = v.diasStock;
      if (vu.esTescar && vu.diasTescar === null) vu.diasTescar = v.diasStock;
      if (
        (v.tipoStock === "Propio" || v.tipoStock === "FinPropio") &&
        (v.diasStock ?? 0) > 180
      ) {
        vu.esStockPagadoViejo = true;
      }
    }
  }

  // 1b) Registry suplementario (Venta APC + Financiado)
  if (data?.vinsExtra) {
    for (const [vinL, info] of data.vinsExtra) {
      const vu = ensure(vinL, vinL);
      if (info.fuente === "Venta APC Fact VN" || info.fuente === "Venta APC Fact VU") {
        vu.enHistoricoVenta = true;
      }
      if (info.fuente === "Financiado" || info.fuente === "Base Financiamiento") {
        vu.enFinanciado = true;
      }
      vu.marca = vu.marca ?? info.marca;
      vu.modelo = vu.modelo ?? info.modelo;
      vu.patente = vu.patente ?? info.patente;
      vu.sucursal = vu.sucursal ?? info.sucursal;
      vu.cliente = vu.cliente ?? info.cliente;
      vu.vendedor = vu.vendedor ?? info.vendedor;
    }
  }

  // 1c) FNE cruzado (re-uso del selector existente)
  let cruzadosFNE: ReturnType<typeof cruzarFNEConStock> = [];
  if (fne) {
    cruzadosFNE = cruzarFNEConStock(
      fne.registros,
      data?.vehiculos ?? [],
      data?.vinsExtra ?? null,
      hoy,
    );
  }

  // 1d) Saldos cruzados (re-uso del selector existente)
  let cruzadosSaldos: ReturnType<typeof cruzarSaldosConStock> = [];
  if (saldos) {
    cruzadosSaldos = cruzarSaldosConStock(
      saldos.registros,
      data?.vehiculos ?? [],
      data?.vinsExtra ?? null,
      fne,
    );
  }

  const creditoMap = calcularCreditoPompeyoPorVIN(cruzadosSaldos);

  // Inyectar info de FNE en el universo
  for (const c of cruzadosFNE) {
    const vinL = limpiarVIN(c.fne.vin);
    if (!vinL || vinL.length !== 17) continue;
    const vu = ensure(vinL, c.fne.vin);
    vu.enFNE = true;
    vu.fneEstado = c.estadoEntrega;
    vu.fneDiasFactura = c.diasDesdeFactura;
    vu.fneDiasEnEstado = c.diasEnEstado;
    vu.fneValorFactura = c.fne.valorFactura;
    vu.fneAutoEnSucursal = c.autoEnSucursal;
    vu.fneBloqueos = razonesBloqueoFNE(c, creditoMap);
    vu.cliente = vu.cliente ?? c.fne.cliente;
    vu.sucursal = vu.sucursal ?? c.fne.sucursal;
    vu.cajon = vu.cajon ?? c.fne.cajon;
  }

  // Inyectar info de Saldos en el universo (solo vehículo)
  for (const c of cruzadosSaldos) {
    if (c.saldo.categoria !== "vehiculo") continue;
    const vin = c.saldo.vinResuelto;
    if (!vin) continue;
    const vu = ensure(vin, vin);
    vu.enSaldos = true;
    vu.saldoCliente += c.saldo.saldoXDocumentar;
    if (c.saldo.subTipo === "credito_pompeyo") {
      vu.creditoPompeyo += c.saldo.cPompeyoCLP;
    }
    vu.saldosDetalle.push(c.saldo);
    vu.marca = vu.marca ?? c.saldo.marca;
    vu.modelo = vu.modelo ?? c.saldo.modelo;
    vu.cliente = vu.cliente ?? c.saldo.cliente;
  }

  // ──────────────────────────────────────────────────────────────────
  // 2) Enriquecer con línea financiera vinculada (por marca)
  // ──────────────────────────────────────────────────────────────────

  if (data) {
    for (const vu of universo.values()) {
      const linea = findLineaParaMarca(vu.marca, data.lineas);
      if (linea) {
        vu.marcaLineaVinculada = linea.marcaPompeyo ?? linea.marca;
        // LineaCredito no expone vencimiento explícito por marca todavía.
        // Cuando lo tenga, llenar vu.lineaFechaVencimiento y vu.lineaDiasParaVencer.
        vu.lineaSobregirada = sobregiros.has(
          (linea.marcaPompeyo ?? linea.marca).toUpperCase(),
        );
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // 3) Capital comprometido SIN doble conteo (max + fuente visible)
  // ──────────────────────────────────────────────────────────────────

  for (const vu of universo.values()) {
    const costoPropio =
      vu.tipoStock === "Propio" || vu.tipoStock === "FinPropio" ? vu.costoNeto : 0;
    const { monto, fuente } = calcularCapitalComprometido({
      fneValorFactura: vu.fneValorFactura,
      saldoCliente: vu.saldoCliente,
      costoNetoPropio: costoPropio,
      creditoPompeyo: vu.creditoPompeyo,
    });
    vu.capitalComprometido = monto;
    vu.capitalComprometidoFuente = fuente;

    // Universo operacional activo: stock vivo, FNE o saldos vehículo.
    // Excluye históricos APC (ya entregados).
    vu.esOperacionalActivo = vu.enStockActivo || vu.enFNE || vu.enSaldos;
  }

  return universo;
}

/** Label para la fuente del capital comprometido — texto visible. */
export const FUENTE_CAPITAL_LABEL: Record<FuenteCapital, string> = {
  fne: "FNE valor factura",
  saldo_cliente: "Saldo cliente",
  stock_propio: "Stock propio",
  credito_pompeyo: "Crédito Pompeyo",
  ninguna: "Sin capital comprometido",
};
