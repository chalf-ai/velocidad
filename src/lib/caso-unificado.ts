/**
 * CAPA MADRE · CasoOperacionalUnificado — una sola verdad por VIN.
 *
 * Construye, EN PARALELO y de forma ADITIVA, la vista completa de un VIN
 * componiendo las capas que YA existen (sin reescribirlas ni reemplazarlas):
 *   - VehiculoUnificado  (buildVehiculosUnificados): stock + FNE + saldos + líneas + capital
 *   - Vehiculo crudo     (Base_Stock): estado comercial/financiero/usado fino
 *   - AutoNoEntregado    (FNE): recorrido de inscripción / patente
 *   - LogisticaOperacionVIN (merge ROMA+STLI): hitos, bloqueos, owner, SLA
 *   - CasoOperacional    (construirCaso): gestión + score + logística + alertas
 *   - clasificarUsadoOperacional: usados / capital puente
 *
 * NO toca el sistema vivo (Centro de Acción, Dashboard, score, filtros, owner,
 * gestión). Es un selector PURO para auditar y validar la unificación ANTES de
 * conectarla. Cruce por VIN normalizado (misma llave del resto del sistema).
 *
 * GAP conocido: las provisiones NO traen VIN (son por marca, clave PROV-{ID}) →
 * no se pueden adjuntar a un VIN. Se reportan a nivel agregado en la auditoría.
 */

import type {
  AutoNoEntregado,
  ParsedExcel,
  ParsedFNE,
  ParsedProvisiones,
  ParsedSaldos,
  Vehiculo,
} from "./types";
import type { GestionVIN } from "./gestion/types";
import { limpiarVIN } from "./parser/venta-apc";
import {
  buildVehiculosUnificados,
  type VehiculoUnificado,
} from "./selectors/vehiculo-unificado";
import { calcularScore } from "./selectors/score";
import {
  construirCaso,
  type LogisticaCasoResumen,
} from "./gestion/caso";
import { getMarcaOperacional, normalizarMarcaOperacional } from "./selectors/owner-operacional";
import { clasificarUsadoOperacional, type CategoriaUsado } from "./selectors/usados-operacional";
import {
  bloqueosDe,
  derivarEstadoLogistico,
  type LogisticaOperacionVIN,
} from "./logistica/modelo";

// ───────────────────────────── Fuentes ──────────────────────────────────────

export interface CasoUnificadoSources {
  data: ParsedExcel | null;
  fne: ParsedFNE | null;
  saldos: ParsedSaldos | null;
  provisiones: ParsedProvisiones | null;
  logisticaPorVin: Map<string, LogisticaOperacionVIN> | null;
  gestionMap: Record<string, GestionVIN>;
  hoy?: Date;
}

// ───────────────────────────── Secciones ────────────────────────────────────

export interface SeccionIdentidad {
  vin: string;
  patente: string | null;
  marcaOperacional: string;
  marcaFisica: string | null;
  modelo: string | null;
  version: string | null;
  sucursal: string | null;
  cliente: string | null;
  vendedor: string | null;
}

export interface SeccionComercial {
  enFNE: boolean;
  facturado: boolean;
  entregado: boolean;
  pendienteEntrega: boolean;
  estadoComercial: string | null;
  fechaFactura: Date | null;
  fechaEntregaComprometida: Date | null;
  fechaEntregaReal: Date | null; // GAP: no existe en los archivos (ver auditoría)
}

export interface SeccionFinanciero {
  stockPagado: boolean;
  financiado: boolean;
  lineaMarca: string | null;
  lineaDiasParaVencer: number | null;
  lineaSobregirada: boolean;
  saldoCliente: number;
  creditoPompeyo: number;
  capitalRetenido: number;
  capitalFuente: string;
}

export interface SeccionLogistica {
  resumen: LogisticaCasoResumen;
}

export interface SeccionInscripcion {
  solicitarInscripcion: boolean | null;
  fechaSolicitudInscripcion: Date | null;
  fechaInscripcion: Date | null;
  patenteEnAdministracion: boolean;
  patenteEnTransito: boolean;
  patenteEnSucursal: boolean;
  faltaAutorizacion: boolean;
  faltaSolicitudEntrega: boolean;
}

export interface SeccionOperacional {
  listoParaEntregar: boolean;
  bloqueado: boolean;
  causaBloqueo: string | null;
  slaRoto: boolean;
  agingEtapa: number;
  capitalRetenido: number;
  esUsado: boolean;
  categoriaUsado: CategoriaUsado | null;
  esCapitalPuente: boolean;
  esJudicial: boolean;
}

export interface SeccionGestion {
  responsable: string | null;
  prioridadManual: string | null;
  fechaCompromiso: string | null;
  proximaAccion: string | null;
  comentario: string | null;
  estadoSeguimiento: string;
  enSeguimiento: boolean;
}

export interface SeccionScore {
  /** 0-100, 100 = sano/veloz. Vista unificada — NO reemplaza el score vivo. */
  financiero: number;
  operativo: number;
  logistico: number | null;
  entrega: number | null;
  total: number;
  /** presión operacional cruda del score vivo (0-100, mayor = peor). */
  presionViva: number;
  razones: string[];
}

export type SeveridadContra = "alta" | "media" | "info";

export interface ContradiccionUnificada {
  codigo: string;
  descripcion: string;
  severidad: SeveridadContra;
}

// ───────────────────────── Verdad física del auto ───────────────────────────
//
// Señal ÚNICA consolidada de dónde está físicamente el auto, derivada de stock +
// logística + FNE/patente (no hardcodeada). Detecta contradicciones entre capas
// (ej. FNE dice "patente en sucursal" pero logística dice "en tránsito").

export type EstadoFisicoVIN =
  | "en_sucursal"
  | "en_transito"
  | "en_bodega"
  | "despachado_no_recepcionado"
  | "entregado"
  | "desconocido"
  | "inconsistente";

export const ESTADO_FISICO_LABEL: Record<EstadoFisicoVIN, string> = {
  en_sucursal: "En sucursal",
  en_transito: "En tránsito",
  en_bodega: "En bodega",
  despachado_no_recepcionado: "Despachado, no recepcionado",
  entregado: "Entregado",
  desconocido: "Desconocido",
  inconsistente: "Inconsistente (capas en conflicto)",
};

export interface VerdadFisicaVIN {
  estado: EstadoFisicoVIN;
  /** Capas que aportaron evidencia (logística / FNE-patente / stock). */
  fuentes: string[];
  contradicciones: string[];
  confianza: "alta" | "media" | "baja";
  owner: string | null;
  accion: string;
  detalle: string;
}

export interface CasoOperacionalUnificado {
  vin: string;
  identidad: SeccionIdentidad;
  comercial: SeccionComercial;
  financiero: SeccionFinanciero;
  logistica: SeccionLogistica | null;
  inscripcion: SeccionInscripcion;
  operacional: SeccionOperacional;
  gestion: SeccionGestion;
  score: SeccionScore;
  /** Qué capas de datos tiene este VIN (stock, fne, logistica, saldos, gestion…). */
  capas: string[];
  contradicciones: ContradiccionUnificada[];
  /** Señales de CALIDAD DE DATO (no son contradicciones operacionales). */
  calidadDato: string[];
  /** Verdad física consolidada: dónde está el auto (señal única cross-capa). */
  verdadFisica: VerdadFisicaVIN;
}

// ───────────────────────────── Helpers ──────────────────────────────────────

const up = (s: string | null | undefined) => (s ?? "").toUpperCase().trim();
const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
const isDate = (d: unknown): d is Date => d instanceof Date && !isNaN(d.getTime());

/** Tokens significativos de una sucursal (para comparar entre fuentes). */
function sucTokens(s: string | null | undefined): Set<string> {
  return new Set(
    up(s)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[\s\-_./]+/)
      .filter((t) => t.length >= 3 && !["STOCK", "OFICINA", "BODEGA", "POMPEYO", "AUTOS"].includes(t)),
  );
}
function sucursalesDistintas(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const ta = sucTokens(a);
  const tb = sucTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  for (const t of ta) if (tb.has(t)) return false;
  return true;
}

/**
 * REGLA #1 — Señal REAL de entrega al cliente.
 * NO basta ROMA Estado=Realizada (eso solo cierra la solicitud logística / llegada
 * a sucursal). Sólo cuenta una señal de entrega efectiva: patente entregada al
 * cliente o registro explícito de entrega en el propio FNE.
 */
function fneEntregadoReal(fne: AutoNoEntregado | null): boolean {
  if (!fne) return false;
  if (isDate(fne.fechaPatenteEntregada)) return true;
  const e = up(fne.entregaAuto);
  if (e === "SI" || e === "SÍ" || e === "ENTREGADO") return true;
  if (up(fne.entregaAutoTxt).includes("ENTREGAD")) return true;
  return false;
}

/**
 * REGLA #2 — Sucursales NO retail (ubicación física / administrativa). Una
 * diferencia stock↔FNE que involucre estas NO es contradicción: es el flujo
 * normal (auto en bodega/logística/demo, o facturación desde la oficina de marca).
 */
const SUC_NO_RETAIL = [
  "LOGISTICA", "CPD", "VN CON PATENTE", "TEST CAR", "SEMINUEVO",
  "AUTOSHOPPING", "OUTLET", "BODEGA", "CASA MATRIZ", "COMPANY",
  "KAR", "SCHIAPP", "LONQUEN",
];
function esSucursalRetail(s: string | null): boolean {
  const u = up(s);
  if (!u) return false;
  if (u.startsWith("OFICINA")) return false; // facturación administrativa de marca
  return !SUC_NO_RETAIL.some((n) => u.includes(n));
}
function marcaTokenSuc(s: string | null): string {
  return up(s).replace(/^OFICINA\s+/, "").split(/\s+/)[0] ?? "";
}

// ── Scores derivados (vista unificada; transparentes y aditivos) ─────────────

function scoreFinanciero(vu: VehiculoUnificado): number {
  let s = 100;
  if (vu.creditoPompeyo > 0) s -= 40;
  if (vu.saldoCliente > 0) s -= 15;
  if (vu.lineaSobregirada) s -= 25;
  if (vu.esStockPagadoViejo) s -= 20;
  if (vu.lineaDiasParaVencer != null && vu.lineaDiasParaVencer < 7) s -= 15;
  return clamp(s);
}

function scoreEntrega(vu: VehiculoUnificado): number | null {
  if (!vu.enFNE) return null;
  if (vu.fneEstado === "listo_para_entregar") {
    // listo pero retenido pierde puntos por día
    return clamp(100 - Math.min(vu.fneDiasEnEstado ?? 0, 30));
  }
  const dias = vu.fneDiasEnEstado ?? 0;
  return clamp(85 - Math.min(dias, 60) - vu.fneBloqueos.length * 5);
}

// ───────────────────────── Contradicciones ──────────────────────────────────

function detectarContradicciones(args: {
  vu: VehiculoUnificado;
  vehiculo: Vehiculo | null;
  fneRec: AutoNoEntregado | null;
  log: LogisticaOperacionVIN | null;
  logResumen: LogisticaCasoResumen | null;
}): ContradiccionUnificada[] {
  const { vu, vehiculo, fneRec, logResumen } = args;
  const c: ContradiccionUnificada[] = [];
  const entregadoReal = fneEntregadoReal(fneRec);

  // REGLA #1 · FNE pero entregado — SOLO con señal real de entrega al cliente
  // (no ROMA Estado=Realizada, que solo cierra la solicitud logística).
  if (vu.enFNE && entregadoReal)
    c.push({ codigo: "fne_pero_entregado", descripcion: "Sigue en FNE pero hay señal real de entrega al cliente (patente entregada / entrega registrada).", severidad: "alta" });

  // Listo para entregar pero sin logística cruzada.
  if (vu.fneEstado === "listo_para_entregar" && !args.log)
    c.push({ codigo: "listo_sin_logistica", descripcion: "Listo para entregar pero sin registro logístico.", severidad: "media" });

  // Patente en sucursal pero no autorizado.
  if (fneRec && isDate(fneRec.fechaPatenteRecibida) && fneRec.autorizacionEntrega !== true)
    c.push({ codigo: "patente_sin_autorizacion", descripcion: "Patente recibida en sucursal pero entrega no autorizada.", severidad: "media" });

  // Auto en línea (financiado) pero marcado pagado.
  if (vehiculo && vehiculo.esPagado && up(vehiculo.tipoStock).includes("FINAN"))
    c.push({ codigo: "linea_pero_pagado", descripcion: "Marcado pagado pero el tipo de stock indica financiado/línea.", severidad: "media" });

  // Capital puente sin operación (sin folio retoma).
  if (vehiculo && vehiculo.esVPPComprometido && !vehiculo.folioRetoma)
    c.push({ codigo: "puente_sin_operacion", descripcion: "Capital puente (VPP) sin folio de retoma asociado.", severidad: "media" });

  // Logística pendiente pero entrega realizada — REGLA #1: señal real, no ROMA.
  if (logResumen && logResumen.bloqueos.length > 0 && entregadoReal)
    c.push({ codigo: "logistica_pendiente_entregado", descripcion: "Bloqueo logístico activo pero hay señal real de entrega al cliente.", severidad: "alta" });

  // REGLA #2 · Sucursal inconsistente — SOLO retail vs retail (excluye bodega/
  // logística/demo/oficina = ubicación física vs sucursal de venta, normal).
  const sStock = vu.sucursal;
  const sFne = fneRec?.sucursal ?? null;
  if (sFne && esSucursalRetail(sStock) && esSucursalRetail(sFne) && sucursalesDistintas(sStock, sFne)) {
    const distMarca = marcaTokenSuc(sStock) !== marcaTokenSuc(sFne);
    c.push({
      codigo: distMarca ? "sucursal_inconsistente_marca" : "sucursal_inconsistente_retail",
      descripcion: `Sucursal retail distinta entre stock ("${sStock}") y FNE ("${sFne}")${distMarca ? " · marca distinta" : " · misma marca"}.`,
      severidad: distMarca ? "media" : "info",
    });
  }

  // Marca operacional inconsistente (stock vs FNE) — informativo.
  if (vehiculo && fneRec) {
    const mStock = getMarcaOperacional(vehiculo);
    const mFne = getMarcaOperacional(fneRec);
    if (mStock !== mFne)
      c.push({ codigo: "marca_inconsistente", descripcion: `Marca operacional distinta: stock=${mStock} · FNE=${mFne}.`, severidad: "info" });
  }

  return c;
}

/**
 * Señales de CALIDAD DE DATO (no son contradicciones operacionales).
 * Hoy: FNE sin fecha de factura válida (00-00-0000 / inválida en el archivo).
 */
function calidadDatoDe(vu: VehiculoUnificado, fneRec: AutoNoEntregado | null): string[] {
  const q: string[] = [];
  if (vu.enFNE && fneRec && !isDate(fneRec.fechaFactura)) q.push("fne_sin_fecha_factura");
  return q;
}

const diasHasta = (d: Date | null, hoy: Date): number | null =>
  d ? Math.round((hoy.getTime() - d.getTime()) / 86_400_000) : null;

const FISICO_OWNER: Record<EstadoFisicoVIN, string | null> = {
  en_sucursal: "Sucursal",
  en_transito: "Logística / transporte",
  en_bodega: "STLI / bodega",
  despachado_no_recepcionado: "Logística / transporte",
  entregado: null,
  desconocido: null,
  inconsistente: "Revisión (datos en conflicto)",
};
const FISICO_ACCION: Record<EstadoFisicoVIN, string> = {
  en_sucursal: "Auto en sucursal: avanzar inscripción / entrega.",
  en_transito: "Seguir el tránsito; confirmar recepción al llegar.",
  en_bodega: "Solicitar el despacho a sucursal.",
  despachado_no_recepcionado: "Confirmar recepción física en sucursal o escalar al transportista.",
  entregado: "Cerrar la operación.",
  desconocido: "Levantar la ubicación física del auto.",
  inconsistente: "Conciliar capas: verificar recepción real vs estado de logística/FNE.",
};

/**
 * VERDAD FÍSICA del auto — señal única consolidada (no hardcodeada). Deriva de:
 * stock (vu.enStockActivo + sucursal), logística (despacho/llegada/estado) y
 * FNE/patente (fechaPatenteRecibida). Marca "inconsistente" si las capas se
 * contradicen fuerte (ej. patente en sucursal vs logística en tránsito).
 */
function calcularVerdadFisica(
  vu: VehiculoUnificado,
  fneRec: AutoNoEntregado | null,
  op: LogisticaOperacionVIN | null,
  hoy: Date,
): VerdadFisicaVIN {
  const despachado = !!(op && isDate(op.fDespacho));
  const recepLog = !!(op && isDate(op.fLlegadaSucursal));
  const patenteSuc = isDate(fneRec?.fechaPatenteRecibida);
  const enStock = vu.enStockActivo;
  const sucRetail = esSucursalRetail(vu.sucursal);
  const enStockSucursal = enStock && sucRetail;
  const enStockBodega = enStock && !sucRetail;
  const logEstado = op ? derivarEstadoLogistico(op) : null;
  const enTransitoLog = logEstado === "en_transito";
  const transitoProlongado = op ? bloqueosDe(op, hoy).includes("transito_prolongado") : false;
  const diasDesp = op ? diasHasta(op.fDespacho, hoy) : null;

  const evidenciaSucursal = recepLog || patenteSuc || enStockSucursal;
  const evidenciaTransito = (despachado && !recepLog) || enTransitoLog;

  const fuentes: string[] = [];
  if (op) fuentes.push("logística");
  if (fneRec) fuentes.push("FNE/patente");
  if (enStock) fuentes.push("stock");

  const contradicciones: string[] = [];
  if (patenteSuc && evidenciaTransito)
    contradicciones.push("FNE marca patente en sucursal, pero logística indica en tránsito sin recepción.");
  if (enStockSucursal && evidenciaTransito)
    contradicciones.push("Stock visible en sucursal, pero logística en tránsito.");

  let estado: EstadoFisicoVIN;
  if (fneEntregadoReal(fneRec)) estado = "entregado";
  else if (evidenciaSucursal && evidenciaTransito) estado = "inconsistente";
  else if (evidenciaSucursal) estado = "en_sucursal";
  else if (despachado && !recepLog) estado = transitoProlongado ? "despachado_no_recepcionado" : "en_transito";
  else if (enTransitoLog) estado = "en_transito";
  else if (enStockBodega) estado = "en_bodega";
  else estado = "desconocido";

  const confianza: VerdadFisicaVIN["confianza"] =
    estado === "inconsistente" || estado === "desconocido"
      ? "baja"
      : fuentes.length >= 2
        ? "alta"
        : "media";

  // Narrativa
  const partes: string[] = [];
  const tDesp = diasDesp != null ? ` hace ${diasDesp}d` : "";
  if (estado === "despachado_no_recepcionado")
    partes.push(`Auto despachado desde STLI${tDesp}. No hay recepción confirmada en sucursal${!enStock ? "; no aparece en stock activo" : ""}.`);
  else if (estado === "en_transito") partes.push(`Auto en tránsito a sucursal${tDesp}.`);
  else if (estado === "en_sucursal")
    partes.push(
      [
        recepLog ? "Recepción confirmada en sucursal." : null,
        patenteSuc ? "Patente recibida en sucursal." : null,
        enStockSucursal ? "Visible en stock de sucursal." : null,
      ].filter(Boolean).join(" "),
    );
  else if (estado === "en_bodega") partes.push(`En stock de bodega/logística (${vu.sucursal ?? "—"}), sin despacho.`);
  else if (estado === "entregado") partes.push("Señal de entrega real registrada.");
  else if (estado === "inconsistente") partes.push(`Capas en conflicto. ${contradicciones.join(" ")}`);
  else partes.push("Sin señales físicas suficientes para ubicar el auto.");

  return {
    estado,
    fuentes,
    contradicciones,
    confianza,
    owner: FISICO_OWNER[estado],
    accion: FISICO_ACCION[estado],
    detalle: partes.join(" ").trim(),
  };
}

// ───────────────────────── Builders ─────────────────────────────────────────

interface IndexedSources {
  vehiculoPorVin: Map<string, Vehiculo>;
  fnePorVin: Map<string, AutoNoEntregado>;
  sources: CasoUnificadoSources;
}

function indexar(sources: CasoUnificadoSources): IndexedSources {
  const vehiculoPorVin = new Map<string, Vehiculo>();
  for (const v of sources.data?.vehiculos ?? []) {
    const k = limpiarVIN(v.vin);
    if (k && !vehiculoPorVin.has(k)) vehiculoPorVin.set(k, v);
  }
  const fnePorVin = new Map<string, AutoNoEntregado>();
  for (const r of sources.fne?.registros ?? []) {
    const k = limpiarVIN(r.vin);
    if (k && !fnePorVin.has(k)) fnePorVin.set(k, r);
  }
  return { vehiculoPorVin, fnePorVin, sources };
}

function construirDesde(vu: VehiculoUnificado, idx: IndexedSources): CasoOperacionalUnificado {
  const { sources } = idx;
  const hoy = sources.hoy ?? new Date();
  const vin = vu.vinLimpio;
  const vehiculo = idx.vehiculoPorVin.get(vin) ?? null;
  const fneRec = idx.fnePorVin.get(vin) ?? null;
  const log = sources.logisticaPorVin?.get(vin) ?? null;
  const gestion = sources.gestionMap[vin] ?? null;

  const score = calcularScore(vu);
  const caso = construirCaso(vu, score, gestion, hoy, log);
  const logResumen = caso.logistica;

  // ── Secciones ──────────────────────────────────────────────────────────
  const identidad: SeccionIdentidad = {
    vin,
    patente: vu.patente,
    marcaOperacional: vehiculo ? getMarcaOperacional(vehiculo) : normalizarMarcaOperacional(vu.marca),
    marcaFisica: vehiculo ? normalizarMarcaOperacional(vehiculo.marcaPompeyo ?? vehiculo.marca) : vu.marca,
    modelo: vu.modelo,
    version: vehiculo?.version ?? null,
    sucursal: vu.sucursal,
    cliente: vu.cliente,
    vendedor: vu.vendedor,
  };

  const logEntregado = up(log?.estadoArchivo) === "REALIZADA";
  const comercial: SeccionComercial = {
    enFNE: vu.enFNE,
    facturado: isDate(fneRec?.fechaFactura) || (vehiculo?.folioVenta != null && vehiculo.folioVenta !== ""),
    entregado: logEntregado,
    pendienteEntrega: vu.enFNE && !logEntregado,
    estadoComercial: vehiculo?.estadoComercial ?? null,
    fechaFactura: fneRec?.fechaFactura ?? null,
    fechaEntregaComprometida: log?.fEntregaComprometida ?? null,
    fechaEntregaReal: null, // GAP
  };

  const financiado = up(vehiculo?.tipoStock).includes("FINAN");
  const financiero: SeccionFinanciero = {
    stockPagado: vehiculo?.esPagado ?? false,
    financiado,
    lineaMarca: vu.marcaLineaVinculada,
    lineaDiasParaVencer: vu.lineaDiasParaVencer,
    lineaSobregirada: vu.lineaSobregirada,
    saldoCliente: vu.saldoCliente,
    creditoPompeyo: vu.creditoPompeyo,
    capitalRetenido: vu.capitalComprometido,
    capitalFuente: vu.capitalComprometidoFuente,
  };

  const inscripcion: SeccionInscripcion = {
    solicitarInscripcion: fneRec?.solicitarInscripcion ?? null,
    fechaSolicitudInscripcion: fneRec?.fechaSolicitudInscripcion ?? null,
    fechaInscripcion: fneRec?.fechaInscripcion ?? null,
    patenteEnAdministracion: isDate(fneRec?.patentesAdministracion),
    patenteEnTransito: isDate(fneRec?.fechaPatenteEnviada) && !isDate(fneRec?.fechaPatenteRecibida),
    patenteEnSucursal: isDate(fneRec?.fechaPatenteRecibida),
    faltaAutorizacion: isDate(fneRec?.fechaPatenteRecibida) && fneRec?.autorizacionEntrega !== true,
    faltaSolicitudEntrega: isDate(fneRec?.fechaPatenteRecibida) && fneRec?.solEntrega !== true,
  };

  const usado = vehiculo ? clasificarUsadoOperacional(vehiculo) : { esUsado: false, categoria: null };
  const operacional: SeccionOperacional = {
    listoParaEntregar: vu.fneEstado === "listo_para_entregar",
    bloqueado: (logResumen?.bloqueos.length ?? 0) > 0 || vu.fneBloqueos.length > 0,
    causaBloqueo:
      logResumen?.bloqueos[0] != null
        ? logResumen.estadoLabel
        : vu.fneBloqueos[0]?.descripcion ?? null,
    slaRoto: caso.sla.roto || (logResumen?.slaRoto ?? false),
    agingEtapa: logResumen?.aging ?? caso.aging,
    capitalRetenido: vu.capitalComprometido,
    esUsado: usado.esUsado,
    categoriaUsado: usado.categoria,
    esCapitalPuente: usado.categoria === "USADOS_CAPITAL_PUENTE" || vu.esVPP,
    esJudicial: vu.esJudicial,
  };

  const gestionSec: SeccionGestion = {
    responsable: caso.responsable,
    prioridadManual: gestion?.prioridadManual ?? null,
    fechaCompromiso: caso.fechaCompromiso,
    proximaAccion: caso.proximaAccion,
    comentario: caso.contexto,
    estadoSeguimiento: caso.estado,
    enSeguimiento: caso.enSeguimiento,
  };

  const sFin = scoreFinanciero(vu);
  const sOper = clamp(100 - score.total);
  const sLog = logResumen?.score ?? null;
  const sEnt = scoreEntrega(vu);
  const disponibles = [sFin, sOper, sLog, sEnt].filter((x): x is number => x != null);
  const total = disponibles.length ? clamp(disponibles.reduce((a, b) => a + b, 0) / disponibles.length) : 100;
  const scoreSec: SeccionScore = {
    financiero: sFin,
    operativo: sOper,
    logistico: sLog,
    entrega: sEnt,
    total,
    presionViva: score.total,
    razones: caso.factores.map((f) => f.label),
  };

  // ── Capas presentes + contradicciones ────────────────────────────────────
  const capas: string[] = [];
  if (vu.enStockActivo || vehiculo) capas.push("stock");
  if (vu.enFNE) capas.push("fne");
  if (log) capas.push("logistica");
  if (vu.enSaldos || vu.saldoCliente > 0) capas.push("saldos");
  if (operacional.esCapitalPuente) capas.push("capital_puente");
  if (operacional.esUsado) capas.push("usados");
  if (vu.marcaLineaVinculada) capas.push("linea");
  if (gestion) capas.push("gestion");

  const contradicciones = detectarContradicciones({ vu, vehiculo, fneRec, log, logResumen });
  const calidadDato = calidadDatoDe(vu, fneRec);
  const verdadFisica = calcularVerdadFisica(vu, fneRec, log, hoy);

  return {
    vin,
    identidad,
    comercial,
    financiero,
    logistica: logResumen ? { resumen: logResumen } : null,
    inscripcion,
    operacional,
    gestion: gestionSec,
    score: scoreSec,
    capas,
    contradicciones,
    calidadDato,
    verdadFisica,
  };
}

/** Construye TODOS los casos unificados (Map por VIN normalizado). Puro. */
export function buildCasosOperacionalesUnificados(
  sources: CasoUnificadoSources,
): Map<string, CasoOperacionalUnificado> {
  const idx = indexar(sources);
  const universo = buildVehiculosUnificados(
    { data: sources.data, fne: sources.fne, saldos: sources.saldos },
    sources.hoy ?? new Date(),
  );
  const out = new Map<string, CasoOperacionalUnificado>();
  for (const vu of universo.values()) out.set(vu.vinLimpio, construirDesde(vu, idx));
  return out;
}

/**
 * Construye el caso unificado de UN VIN (sin armar el mapa completo). Puro.
 * Arma el universo (necesario para el VehiculoUnificado) e indexa una vez, pero
 * sólo compone el caso del VIN pedido.
 */
export function buildCasoOperacionalUnificado(
  vinRaw: string,
  sources: CasoUnificadoSources,
): CasoOperacionalUnificado | null {
  const vin = limpiarVIN(vinRaw);
  if (!vin) return null;
  const universo = buildVehiculosUnificados(
    { data: sources.data, fne: sources.fne, saldos: sources.saldos },
    sources.hoy ?? new Date(),
  );
  const vu = universo.get(vin);
  if (!vu) return null;
  return construirDesde(vu, indexar(sources));
}

/**
 * Resuelve el caso + su VehiculoUnificado en UNA sola construcción del universo.
 * Devuelve null si el VIN no está en ninguna fuente cruzada (stock / FNE / saldos /
 * registry suplementario). Útil para la ficha autocontenida y el fallback "Caso".
 */
export function resolverCasoVIN(
  vinRaw: string,
  sources: CasoUnificadoSources,
): { caso: CasoOperacionalUnificado; vu: VehiculoUnificado } | null {
  const vin = limpiarVIN(vinRaw);
  if (!vin) return null;
  const universo = buildVehiculosUnificados(
    { data: sources.data, fne: sources.fne, saldos: sources.saldos },
    sources.hoy ?? new Date(),
  );
  const vu = universo.get(vin);
  if (!vu) return null;
  return { caso: construirDesde(vu, indexar(sources)), vu };
}

// ───────────────────────── Explicación legible ──────────────────────────────

/** Resumen en texto del caso (qué pasa, por qué, quién, cuánta caja, qué sigue). */
export function explicarCasoOperacional(caso: CasoOperacionalUnificado): string {
  const { identidad: id, operacional: op, gestion: g, financiero: fin } = caso;
  const partes: string[] = [];
  partes.push(`${id.marcaOperacional} ${id.modelo ?? ""} (${id.vin})`.trim());
  partes.push(`Capas: ${caso.capas.join(", ") || "—"}.`);
  if (op.bloqueado) partes.push(`Bloqueado: ${op.causaBloqueo ?? "—"} (aging ${op.agingEtapa}d).`);
  else if (op.listoParaEntregar) partes.push("Listo para entregar.");
  if (fin.capitalRetenido > 0)
    partes.push(`Capital retenido: $${Math.round(fin.capitalRetenido).toLocaleString("es-CL")} (${fin.capitalFuente}).`);
  if (caso.logistica?.resumen.ownerLogistico) partes.push(`Owner: ${caso.logistica.resumen.ownerLogistico}.`);
  if (g.proximaAccion) partes.push(`Próxima acción: ${g.proximaAccion}.`);
  if (caso.contradicciones.length > 0)
    partes.push(`⚠ ${caso.contradicciones.length} contradicción(es): ${caso.contradicciones.map((x) => x.codigo).join(", ")}.`);
  return partes.join(" ");
}

// ───────────────────────── Auditoría de cobertura ───────────────────────────

export interface CoberturaUnificada {
  totalVin: number;
  conStock: number;
  conFNE: number;
  conLogistica: number;
  conSaldos: number;
  conCapitalPuente: number;
  conUsados: number;
  conGestion: number;
  con2OMasCapas: number;
  conContradicciones: number;
  /** Conteo por código de contradicción. */
  contradiccionesPorCodigo: Record<string, number>;
  /** Conteo de contradicciones por severidad (alta/media/info). */
  contradiccionesPorSeveridad: Record<SeveridadContra, number>;
  /** Capital comprometido de los VIN con ≥1 contradicción de severidad ≥ media. */
  capitalContradiccionReal: number;
  /** Señales de calidad de dato por código (no contradicciones). */
  calidadDatoPorCodigo: Record<string, number>;
  /** Provisiones: no cruzan por VIN (gap). Conteo agregado. */
  provisionesSinVin: number;
  provisionesFacturadas: number;
  /** Saldos.vehículo cuyo VIN no cruza con el universo (saldo sin VIN). */
  saldosSinCruce: number;
}

export function auditarCoberturaCasoUnificado(
  casos: Map<string, CasoOperacionalUnificado>,
  sources: CasoUnificadoSources,
): CoberturaUnificada {
  const cont: Record<string, number> = {};
  const calidad: Record<string, number> = {};
  const porSev: Record<SeveridadContra, number> = { alta: 0, media: 0, info: 0 };
  let conStock = 0, conFNE = 0, conLog = 0, conSaldos = 0, conPuente = 0, conUsados = 0, conGestion = 0, con2 = 0, conContra = 0;
  let capitalContradiccionReal = 0;
  for (const c of casos.values()) {
    if (c.capas.includes("stock")) conStock++;
    if (c.capas.includes("fne")) conFNE++;
    if (c.capas.includes("logistica")) conLog++;
    if (c.capas.includes("saldos")) conSaldos++;
    if (c.capas.includes("capital_puente")) conPuente++;
    if (c.capas.includes("usados")) conUsados++;
    if (c.capas.includes("gestion")) conGestion++;
    if (c.capas.length >= 2) con2++;
    if (c.contradicciones.length > 0) conContra++;
    for (const x of c.contradicciones) {
      cont[x.codigo] = (cont[x.codigo] ?? 0) + 1;
      porSev[x.severidad]++;
    }
    if (c.contradicciones.some((x) => x.severidad === "alta" || x.severidad === "media"))
      capitalContradiccionReal += c.financiero.capitalRetenido;
    for (const q of c.calidadDato) calidad[q] = (calidad[q] ?? 0) + 1;
  }

  // Provisiones (gap VIN) + facturadas.
  const provs = sources.provisiones?.registros ?? [];
  const provisionesFacturadas = provs.filter((p) => p.estado === "facturada").length;

  // Saldos vehículo sin cruce con el universo.
  const vins = new Set(casos.keys());
  let saldosSinCruce = 0;
  for (const s of sources.saldos?.registros ?? []) {
    if (s.categoria !== "vehiculo") continue;
    const k = limpiarVIN(s.vinResuelto ?? "");
    if (!k || !vins.has(k)) saldosSinCruce++;
  }

  return {
    totalVin: casos.size,
    conStock,
    conFNE,
    conLogistica: conLog,
    conSaldos,
    conCapitalPuente: conPuente,
    conUsados,
    conGestion,
    con2OMasCapas: con2,
    conContradicciones: conContra,
    contradiccionesPorCodigo: cont,
    contradiccionesPorSeveridad: porSev,
    capitalContradiccionReal,
    calidadDatoPorCodigo: calidad,
    provisionesSinVin: provs.length,
    provisionesFacturadas,
    saldosSinCruce,
  };
}
