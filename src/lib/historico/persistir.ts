/**
 * Motor histórico de snapshots · server-side helper.
 *
 * Cada vez que se carga un archivo en `/ingesta` y se persiste el `Snapshot`
 * vivo, este helper deriva una fotografía histórica del momento:
 *   1) Registra el archivo en `SnapshotHistoricoArchivo` (INMUTABLE).
 *   2) Hace UPSERT del `OperationalSnapshot` mensual (mientras esté draft).
 *
 * Reglas (decisión usuario 2026-06):
 *   · Archivos = INMUTABLES. Unique por (fuente, snapshotDate, hashSha256).
 *     Reintentar el mismo archivo es idempotente.
 *   · Snapshot mensual = UPSERT por (snapshotPeriod, snapshotType="monthly").
 *     Se va completando con cada fuente nueva del mismo período.
 *   · Si el snapshot ya está `closed`, NO se actualiza. Se crea uno nuevo
 *     con snapshotType="correction" y version incrementada.
 *   · Series parciales aceptadas — campos sin fuente quedan null.
 *   · Recálculo seguro — si falla la extracción de KPIs, se guarda warning
 *     y se persiste lo que sí se pudo calcular.
 *
 * Fase 1a: KPIs nativos por fuente (Stock, Saldos, FNE, Provisiones).
 * Scores y cumplimiento del Velocity OS quedan para Fase 1b cuando estén
 * todas las fuentes del período.
 */

import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { Fuente } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos auxiliares
// ─────────────────────────────────────────────────────────────────────────────

interface ExtractResult {
  /** Campos a setear en OperationalSnapshot. */
  kpis: Record<string, unknown>;
  warnings: string[];
}

export interface PersistirHistoricoInput {
  fuente: Fuente;
  payload: unknown;
  nombreArchivo: string;
  tamano: number;
  /** Fecha de corte declarada por el archivo (la del POST). */
  fechaCorteArchivo: Date | null;
  /**
   * Fallback opcional cuando el parser no detectó fecha de corte interna.
   * Se guarda con `fuenteFechaCorte: "fallback"` y warning explícito.
   * No interrumpe el flujo: si tampoco hay fallback y la fecha sigue null,
   * el snapshot no se persiste (return temprano).
   */
  fechaCorteFallback?: Date | null;
  userId: string;
}

export interface PersistirHistoricoResult {
  /** Si se creó el registro de archivo (false = ya existía). */
  archivoCreado: boolean;
  /** Período derivado (ej: "2026-02"). null si no se pudo derivar. */
  snapshotPeriod: string | null;
  /** Si se creó/actualizó la fila de OperationalSnapshot. */
  snapshotActualizado: boolean;
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Reglas de derivación
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detecta "Cierre <Mes> <Año>" en el nombre del archivo. Devuelve el período
 * canónico que el nombre declara, o null si no se reconoce el patrón.
 *
 * Casos típicos del proveedor de informes:
 *   · "Informe Stock y Lineas - Cierre Abril 2026 - Pompeyo Carrasco.xlsx"
 *     → fechaCorteExcel interna = 04-may-2026 (primer día hábil del mes siguiente).
 *     La derivación por fecha lo asignaría a Mayo (incorrecto).
 *     El nombre dice "Cierre Abril" → override a 2026-04.
 *
 * Esto es estrictamente un override DECLARATIVO del cliente: si el archivo
 * dice explícitamente "Cierre <Mes>", confiamos en eso por sobre la fecha
 * interna del Excel.
 */
const MESES_ES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
};

export function derivarPeriodoDeNombre(
  nombreArchivo: string,
): { snapshotDate: Date; snapshotPeriod: string } | null {
  const n = nombreArchivo.toLowerCase();
  // patrón: "cierre <mes> <año>"
  const m = n.match(/\bcierre\s+([a-záéíóú]+)\s+(\d{4})\b/i);
  if (!m) return null;
  const mes = MESES_ES[m[1].toLowerCase()];
  const year = parseInt(m[2], 10);
  if (!mes || !Number.isFinite(year)) return null;
  // mes 0-indexed
  const snapshotDate = new Date(Date.UTC(year, mes, 0)); // día 0 del mes siguiente = último día del mes
  const snapshotPeriod = `${year}-${String(mes).padStart(2, "0")}`;
  return { snapshotDate, snapshotPeriod };
}

/**
 * Deriva el período canónico desde la fecha de corte declarada.
 *
 * Regla "Informe 02-Marzo = cierre Febrero":
 *   · Día 01 a 03 del mes → cierre del mes anterior.
 *   · Día 04 a 31 → cierre del mes del archivo.
 *
 * snapshotDate = último día del mes canónico (UTC).
 * snapshotPeriod = "YYYY-MM" del mes canónico.
 */
export function derivarPeriodo(
  fechaArchivo: Date | null,
): { snapshotDate: Date; snapshotPeriod: string } | null {
  if (!fechaArchivo || !Number.isFinite(fechaArchivo.getTime())) return null;
  const dia = fechaArchivo.getUTCDate();
  let year = fechaArchivo.getUTCFullYear();
  let month = fechaArchivo.getUTCMonth(); // 0-indexed
  if (dia >= 1 && dia <= 3) {
    // Cierre del mes anterior
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  // Último día del mes canónico (día 0 del mes siguiente)
  const snapshotDate = new Date(Date.UTC(year, month + 1, 0));
  const snapshotPeriod = `${year}-${String(month + 1).padStart(2, "0")}`;
  return { snapshotDate, snapshotPeriod };
}

/**
 * Hash determinístico del payload — idempotencia.
 *
 * Excluye campos NO estables que cambian entre parseos del mismo archivo:
 *   · `report.fechaCarga` (new Date() del momento del parseo)
 *   · `report.durMs` (tiempo de parseo, varía)
 *   · `*.report.fechaCarga` / `*.report.durMs` (mismo patrón en sub-parsers
 *     como saldos/fne/provisiones)
 *
 * Sin esto, el mismo Excel subido dos veces produce hashes distintos y
 * el chequeo de idempotencia falla — la DB acumula duplicados.
 */
export function hashPayload(payload: unknown): string {
  const norm: unknown = JSON.parse(JSON.stringify(payload));
  // Limpieza recursiva acotada a objetos `report` directamente
  function stripReport(o: unknown): void {
    if (!o || typeof o !== "object") return;
    const obj = o as Record<string, unknown>;
    const rep = obj.report;
    if (rep && typeof rep === "object") {
      const r = rep as Record<string, unknown>;
      delete r.fechaCarga;
      delete r.durMs;
    }
  }
  stripReport(norm);
  return crypto.createHash("sha256").update(JSON.stringify(norm)).digest("hex");
}

/**
 * Calcula prioridad de cierre de un archivo · 0-100.
 *
 * Mayor prioridad = mejor candidato a "ganar" los KPIs del período cuando
 * hay múltiples archivos de la misma fuente. Reglas:
 *
 *   1. Distancia al fin de mes (max 60 pts)
 *      · Día del archivo = último día del mes canónico → +60
 *      · Cada día de distancia resta 2 pts
 *   2. Palabra "cierre" en el nombre → +30 pts
 *   3. Fecha fin de mes en el nombre (28/29/30/31 - MM) → +10 pts
 *
 * Umbral `esCierreMensual = prioridad >= 70`.
 *
 * Ejemplos:
 *   · "Cierre Mayo 2026" (fecha 31-may, snapshotDate 31-may) → 60 + 30 = 90 → cierre
 *   · "08 Mayo 2026"      (fecha 08-may, snapshotDate 31-may) → 60-46+0+0 ≈ 14 → intermedio
 *   · "Cierre Mayo" sin fecha → 0+30 = 30 → bajo pero marcado por nombre
 */
export function calcularPrioridadCierre(
  fechaCorteArchivo: Date | null,
  nombreArchivo: string,
  snapshotDate: Date,
): { prioridad: number; esCierreMensual: boolean } {
  let prioridad = 0;
  if (fechaCorteArchivo && Number.isFinite(fechaCorteArchivo.getTime())) {
    const dias = Math.abs(
      (snapshotDate.getTime() - fechaCorteArchivo.getTime()) / 86_400_000,
    );
    prioridad = Math.max(0, 60 - dias * 2);
  }
  const nombreNorm = nombreArchivo.toLowerCase();
  if (/\bcierre\b/.test(nombreNorm)) prioridad += 30;
  if (/\b(?:28|29|30|31)[-_\s](?:0?[1-9]|1[0-2])\b/.test(nombreNorm)) {
    prioridad += 10;
  }
  prioridad = Math.min(100, Math.round(prioridad));
  return { prioridad, esCierreMensual: prioridad >= 70 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Extractores de KPIs por fuente
//
// Cada extractor es defensivo: cualquier excepción se captura y se reporta
// como warning. Los KPIs que se puedan calcular sí se devuelven.
// ─────────────────────────────────────────────────────────────────────────────

function extraerKpisStock(payload: unknown): ExtractResult {
  const warnings: string[] = [];
  const kpis: Record<string, unknown> = {};
  try {
    const p = payload as { vehiculos?: unknown[]; lineas?: unknown[] };
    const vehiculos = Array.isArray(p.vehiculos) ? p.vehiculos : [];
    const lineas = Array.isArray(p.lineas) ? p.lineas : [];

    let stockUnidades = 0;
    let stockMontoTotal = 0;
    let stockPagado = 0;
    let stockFinanciado = 0;
    const aging = {
      "0-30": { u: 0, m: 0 },
      "31-60": { u: 0, m: 0 },
      "61-90": { u: 0, m: 0 },
      "91-120": { u: 0, m: 0 },
      "121-180": { u: 0, m: 0 },
      "180+": { u: 0, m: 0 },
    };
    const seen = new Set<string>();
    for (const raw of vehiculos) {
      const v = raw as {
        vin?: string;
        costoNeto?: number;
        tipoStock?: string;
        diasStock?: number;
        esDuplicado?: boolean;
      };
      if (!v.vin || seen.has(v.vin)) continue;
      if (v.esDuplicado === true) continue;
      seen.add(v.vin);
      stockUnidades++;
      const costo = Number(v.costoNeto) || 0;
      stockMontoTotal += costo;
      const t = v.tipoStock;
      if (t === "Propio" || t === "FinPropio") stockPagado += costo;
      else if (t === "Financiado" || t === "FloorPlan") stockFinanciado += costo;
      const d = Number(v.diasStock) || 0;
      const bucket: keyof typeof aging =
        d <= 30 ? "0-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" :
        d <= 120 ? "91-120" : d <= 180 ? "121-180" : "180+";
      aging[bucket].u++;
      aging[bucket].m += costo;
    }

    let lineaAutorizada = 0;
    let lineaUtilizada = 0;
    for (const raw of lineas) {
      const l = raw as { lineaAutorizada?: number; lineaOcupada?: number };
      lineaAutorizada += Number(l.lineaAutorizada) || 0;
      lineaUtilizada += Number(l.lineaOcupada) || 0;
    }
    const lineaDisponible = lineaAutorizada - lineaUtilizada;
    const lineaUtilizacionPct =
      lineaAutorizada > 0 ? (lineaUtilizada / lineaAutorizada) * 100 : null;

    kpis.stockUnidades = stockUnidades;
    kpis.stockMontoTotal = stockMontoTotal;
    kpis.stockPagadoMonto = stockPagado;
    kpis.stockFinanciadoMonto = stockFinanciado;
    kpis.lineaAutorizada = lineaAutorizada;
    kpis.lineaUtilizada = lineaUtilizada;
    kpis.lineaDisponible = lineaDisponible;
    kpis.lineaUtilizacionPct = lineaUtilizacionPct;
    kpis.aging0_30Unidades = aging["0-30"].u;
    kpis.aging31_60Unidades = aging["31-60"].u;
    kpis.aging61_90Unidades = aging["61-90"].u;
    kpis.aging91_120Unidades = aging["91-120"].u;
    kpis.aging121_180Unidades = aging["121-180"].u;
    kpis.aging180MasUnidades = aging["180+"].u;
    kpis.aging0_30Monto = aging["0-30"].m;
    kpis.aging31_60Monto = aging["31-60"].m;
    kpis.aging61_90Monto = aging["61-90"].m;
    kpis.aging91_120Monto = aging["91-120"].m;
    kpis.aging121_180Monto = aging["121-180"].m;
    kpis.aging180MasMonto = aging["180+"].m;
  } catch (e) {
    warnings.push(`extraerKpisStock falló: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { kpis, warnings };
}

function extraerKpisSaldos(payload: unknown): ExtractResult {
  const warnings: string[] = [];
  const kpis: Record<string, unknown> = {};
  try {
    const p = payload as { registros?: unknown[] };
    const registros = Array.isArray(p.registros) ? p.registros : [];
    let total = 0;
    let vehiculo = 0;
    let bonos = 0;
    let servicios = 0;
    let cpMonto = 0;
    let cpCasos = 0;
    for (const raw of registros) {
      const r = raw as {
        categoria?: string;
        saldoXDocumentar?: number;
        creditoPompeyo?: number;
      };
      const monto = Number(r.saldoXDocumentar) || 0;
      total += monto;
      if (r.categoria === "vehiculo") vehiculo += monto;
      else if (r.categoria === "bono_comision") bonos += monto;
      else if (r.categoria === "servicio") servicios += monto;
      const cp = Number(r.creditoPompeyo) || 0;
      if (cp > 0) {
        cpMonto += cp;
        cpCasos++;
      }
    }
    kpis.saldosMontoTotal = total;
    kpis.saldosVehiculoMonto = vehiculo;
    kpis.saldosBonosMonto = bonos;
    kpis.saldosServiciosMonto = servicios;
    if (cpCasos > 0) {
      kpis.creditoPompeyoMonto = cpMonto;
      kpis.creditoPompeyoCasos = cpCasos;
    }
  } catch (e) {
    warnings.push(`extraerKpisSaldos falló: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { kpis, warnings };
}

function extraerKpisFNE(payload: unknown): ExtractResult {
  const warnings: string[] = [];
  const kpis: Record<string, unknown> = {};
  try {
    const p = payload as { registros?: unknown[] };
    const registros = Array.isArray(p.registros) ? p.registros : [];
    let unidades = 0;
    let monto = 0;
    let listos = 0;
    let sumaDias = 0;
    let conDia = 0;
    const ahora = Date.now();
    for (const raw of registros) {
      const r = raw as {
        entregado?: boolean;
        valorFactura?: number;
        fechaFactura?: string | Date | null;
        solEntrega?: boolean;
        autorizacionEntrega?: boolean;
      };
      if (r.entregado === true) continue;
      unidades++;
      monto += Number(r.valorFactura) || 0;
      if (r.solEntrega === true && r.autorizacionEntrega === true) listos++;
      if (r.fechaFactura) {
        const t = new Date(r.fechaFactura).getTime();
        if (Number.isFinite(t)) {
          sumaDias += Math.max(0, Math.floor((ahora - t) / 86400000));
          conDia++;
        }
      }
    }
    kpis.fneUnidades = unidades;
    kpis.fneMonto = monto;
    kpis.fneListosEntrega = listos;
    kpis.fneDiasPromedio = conDia > 0 ? sumaDias / conDia : null;
  } catch (e) {
    warnings.push(`extraerKpisFNE falló: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { kpis, warnings };
}

function extraerKpisProvisiones(payload: unknown): ExtractResult {
  const warnings: string[] = [];
  const kpis: Record<string, unknown> = {};
  try {
    const p = payload as { registros?: unknown[] };
    const registros = Array.isArray(p.registros) ? p.registros : [];
    let total = 0;
    let noFactMonto = 0;
    let noFactUnidades = 0;
    for (const raw of registros) {
      const r = raw as {
        saldo?: number;
        estado?: string;
        facturada?: boolean;
      };
      const saldo = Number(r.saldo) || 0;
      total += saldo;
      if (r.estado === "no_facturada" || r.facturada === false) {
        noFactMonto += saldo;
        noFactUnidades++;
      }
    }
    kpis.provisionesTotalMonto = total;
    kpis.provisionesNoFacturadasMonto = noFactMonto;
    kpis.provisionesNoFacturadasUnidades = noFactUnidades;
  } catch (e) {
    warnings.push(`extraerKpisProvisiones falló: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { kpis, warnings };
}

/** Despacha al extractor según la fuente. Fuentes sin extractor devuelven kpis vacíos. */
function extraerKpisPorFuente(fuente: Fuente, payload: unknown): ExtractResult {
  switch (fuente) {
    case "BASE_STOCK":
      return extraerKpisStock(payload);
    case "SALDOS":
      return extraerKpisSaldos(payload);
    case "FNE":
      return extraerKpisFNE(payload);
    case "PROVISIONES":
      return extraerKpisProvisiones(payload);
    default:
      // Logística ROMA/STLI → solo registramos el archivo, sin KPIs específicos.
      return { kpis: {}, warnings: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fuentes esperadas (configurable; afecta completionPct)
// ─────────────────────────────────────────────────────────────────────────────

const FUENTES_ESPERADAS_DEFAULT: string[] = [
  "BASE_STOCK",
  "SALDOS",
  "FNE",
  "PROVISIONES",
];

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function persistirHistorico(
  input: PersistirHistoricoInput,
): Promise<PersistirHistoricoResult> {
  const warnings: string[] = [];

  // ── Resolución de fecha de corte (con fallback opcional) ───────────────
  let fechaCorteEfectiva: Date | null = input.fechaCorteArchivo;
  let fuenteFechaCorte: "excel" | "fallback" = "excel";
  if (!fechaCorteEfectiva && input.fechaCorteFallback) {
    fechaCorteEfectiva = input.fechaCorteFallback;
    fuenteFechaCorte = "fallback";
    warnings.push(
      `Fecha de corte asignada por fallback (parser no detectó): ${fechaCorteEfectiva.toISOString()}`,
    );
  }
  // Override declarativo por nombre · si el archivo declara "Cierre <Mes>"
  // y la fecha interna apunta a OTRO mes (caso típico: informe de cierre
  // generado el primer día hábil del mes siguiente), confiamos en el nombre.
  const periodoNombre = derivarPeriodoDeNombre(input.nombreArchivo);
  const periodoFecha = derivarPeriodo(fechaCorteEfectiva);
  let periodo = periodoFecha;
  if (periodoNombre && (!periodoFecha || periodoFecha.snapshotPeriod !== periodoNombre.snapshotPeriod)) {
    periodo = periodoNombre;
    warnings.push(
      `Período derivado del NOMBRE del archivo (${periodoNombre.snapshotPeriod}) — fecha interna sugería ${periodoFecha?.snapshotPeriod ?? "n/d"}. Override declarativo "Cierre <Mes>".`,
    );
  }
  if (!periodo) {
    return {
      archivoCreado: false,
      snapshotPeriod: null,
      snapshotActualizado: false,
      warnings: [
        ...warnings,
        "No se pudo derivar período: fecha de corte ausente o inválida (sin fallback)",
      ],
    };
  }

  const hashSha256 = hashPayload(input.payload);

  // Idempotencia · si ya existe el mismo (fuente, fecha, hash) NO duplicamos
  // el registro. Pero si el existente NO tiene payload guardado (cargado en
  // versión previa de Fase 1a) y ahora sí lo tenemos, hacemos UPDATE
  // retroactivo solo del payload. Esto destraba el motor 1b-A para archivos
  // viejos sin re-cargar todo el flujo.
  const archivoExistente = await prisma.snapshotHistoricoArchivo.findFirst({
    where: {
      fuente: input.fuente,
      snapshotDate: periodo.snapshotDate,
      hashSha256,
    },
    select: { id: true, payload: true },
  });
  if (archivoExistente) {
    if (archivoExistente.payload == null && input.payload != null) {
      await prisma.snapshotHistoricoArchivo.update({
        where: { id: archivoExistente.id },
        data: { payload: input.payload as object },
      });
      return {
        archivoCreado: false,
        snapshotPeriod: periodo.snapshotPeriod,
        snapshotActualizado: false,
        warnings: [
          ...warnings,
          "Archivo ya registrado (mismo hash) — payload retroactivo añadido para destrabar 1b-A",
        ],
      };
    }
    return {
      archivoCreado: false,
      snapshotPeriod: periodo.snapshotPeriod,
      snapshotActualizado: false,
      warnings: ["Archivo ya registrado (mismo hash) — idempotente"],
    };
  }

  // ── Calcular prioridad de cierre de ESTE archivo ───────────────────────
  const { prioridad: prioridadNueva, esCierreMensual } = calcularPrioridadCierre(
    fechaCorteEfectiva,
    input.nombreArchivo,
    periodo.snapshotDate,
  );

  const extract = extraerKpisPorFuente(input.fuente, input.payload);
  warnings.push(...extract.warnings);

  // Transacción · archivo inmutable + upsert snapshot
  const { snapshotActualizado } = await prisma.$transaction(async (tx) => {
    // Consultar prioridad del archivo GANADOR actual para esta (fuente, período).
    // Si el nuevo tiene menor prioridad, NO sobrescribe los KPIs (solo registra archivo).
    const ganadorActual = await tx.snapshotHistoricoArchivo.findFirst({
      where: {
        fuente: input.fuente,
        snapshotPeriod: periodo.snapshotPeriod,
      },
      orderBy: { prioridadCierre: "desc" },
      select: { prioridadCierre: true, nombreOriginal: true },
    });
    const prioridadGanadora = ganadorActual?.prioridadCierre ?? -1;
    const debeEscribirKpis = prioridadNueva >= prioridadGanadora;
    if (!debeEscribirKpis) {
      warnings.push(
        `KPIs no actualizados: "${input.nombreArchivo}" prioridad=${prioridadNueva}` +
          ` < ganador "${ganadorActual?.nombreOriginal ?? "?"}" prioridad=${prioridadGanadora}.` +
          ` Cierre real no debe ser pisado por corte intermedio.`,
      );
    }

    await tx.snapshotHistoricoArchivo.create({
      data: {
        fuente: input.fuente,
        snapshotDate: periodo.snapshotDate,
        snapshotPeriod: periodo.snapshotPeriod,
        nombreOriginal: input.nombreArchivo,
        hashSha256,
        tamano: input.tamano,
        fechaCorteDeclarada: input.fechaCorteArchivo,
        fechaCorteDetectada: input.fechaCorteArchivo,
        fuenteFechaCorte,
        esCierreMensual,
        prioridadCierre: prioridadNueva,
        parseStatus: extract.warnings.length > 0 ? "parcial" : "ok",
        warnings: extract.warnings,
        origenDeteccion: "ingesta",
        // Payload duplicado intencionalmente: el archivo histórico debe ser
        // AUTOCONTENIDO. Si mañana se rota/borra el Snapshot vivo, el motor
        // 1b-A sigue pudiendo reconstruir VUs del período. Cost: ~10 MB por
        // ingesta de Stock; aceptable para el horizonte histórico actual.
        payload: input.payload as object,
        userId: input.userId,
      },
    });

    // Si la fuente no produce KPIs (ej. logística), solo registramos archivo.
    if (Object.keys(extract.kpis).length === 0) {
      return { snapshotActualizado: false };
    }

    const fuenteStr = String(input.fuente);
    const existente = await tx.operationalSnapshot.findUnique({
      where: {
        snapshotPeriod_snapshotType: {
          snapshotPeriod: periodo.snapshotPeriod,
          snapshotType: "monthly",
        },
      },
    });

    if (existente?.status === "closed") {
      // Período cerrado · crear corrección
      const ultimaVersion = await tx.operationalSnapshot.findFirst({
        where: { snapshotPeriod: periodo.snapshotPeriod },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const esperadas = existente.fuentesEsperadas.length || FUENTES_ESPERADAS_DEFAULT.length;
      await tx.operationalSnapshot.create({
        data: {
          snapshotDate: periodo.snapshotDate,
          snapshotPeriod: periodo.snapshotPeriod,
          snapshotType: "correction",
          status: "draft",
          version: (ultimaVersion?.version ?? 1) + 1,
          ...extract.kpis,
          fuentesUsadas: [fuenteStr],
          fuentesEsperadas: existente.fuentesEsperadas,
          sourceFiles: [input.nombreArchivo],
          sourceHashes: [hashSha256],
          completionPct: Math.round((1 / esperadas) * 100),
          warnings: [
            ...warnings,
            `Período ${periodo.snapshotPeriod} ya estaba cerrado — creado como corrección`,
          ],
          lastRecalculatedAt: new Date(),
        },
      });
      return { snapshotActualizado: true };
    }

    if (existente) {
      // Update · siempre merge trazabilidad; KPIs solo si tiene prioridad >= ganador.
      const nuevosFiles = Array.from(new Set([...existente.sourceFiles, input.nombreArchivo]));
      const nuevosHashes = Array.from(new Set([...existente.sourceHashes, hashSha256]));
      const nuevasFuentes = Array.from(new Set([...existente.fuentesUsadas, fuenteStr]));
      const esperadas = existente.fuentesEsperadas.length || FUENTES_ESPERADAS_DEFAULT.length;
      const completion = Math.min(100, Math.round((nuevasFuentes.length / esperadas) * 100));
      await tx.operationalSnapshot.update({
        where: { id: existente.id },
        data: {
          // KPIs solo si este archivo tiene prioridad ≥ que el ganador previo
          ...(debeEscribirKpis ? extract.kpis : {}),
          sourceFiles: nuevosFiles,
          sourceHashes: nuevosHashes,
          fuentesUsadas: nuevasFuentes,
          completionPct: completion,
          warnings: [...existente.warnings, ...warnings],
          version: existente.version + 1,
          lastRecalculatedAt: new Date(),
        },
      });
      return { snapshotActualizado: true };
    }

    // Crear nuevo (draft)
    const esperadas = FUENTES_ESPERADAS_DEFAULT;
    await tx.operationalSnapshot.create({
      data: {
        snapshotDate: periodo.snapshotDate,
        snapshotPeriod: periodo.snapshotPeriod,
        snapshotType: "monthly",
        status: "draft",
        version: 1,
        ...extract.kpis,
        fuentesUsadas: [fuenteStr],
        fuentesEsperadas: esperadas,
        sourceFiles: [input.nombreArchivo],
        sourceHashes: [hashSha256],
        completionPct: Math.round((1 / esperadas.length) * 100),
        warnings,
        lastRecalculatedAt: new Date(),
      },
    });
    return { snapshotActualizado: true };
  });

  return {
    archivoCreado: true,
    snapshotPeriod: periodo.snapshotPeriod,
    snapshotActualizado,
    warnings,
  };
}
