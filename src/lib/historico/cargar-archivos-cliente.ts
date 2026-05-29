/**
 * DISPATCHER DE CARGA — Vista Histórica /velocidad-operacional.
 *
 * Recibe una lista de archivos (drop / file picker), detecta el tipo por
 * nombre, parsea con los parsers ya validados del motor histórico y deja el
 * estado consolidado en `useHistoricoStore`. Reejecuta el cruce cuando hay
 * datos mínimos (ROMA + Actas).
 *
 * 100% cliente. Cero red, cero Prisma, cero `useExcelStore`.
 */

"use client";

import * as XLSX from "xlsx";
import { parseRomaMensualBuffer } from "./parser-roma-mensual.js";
import { parseActasBuffer } from "./parser-actas.js";
import {
  crearHistoricoVacio,
  aplicarCortes as aplicarCortesRoma,
} from "./consolidador.js";
import {
  crearHistoricoActasVacio,
  aplicarCorteActas,
} from "./consolidador-actas.js";
import {
  cruzarRomaActas,
  type SnapshotRomia,
  type RomiaConsolidadoMin,
} from "./cruce-roma-actas.js";
import type { ResultadoIngestaRoma } from "./parser-roma-mensual.js";
import { useHistoricoStore, type CargaRomaMeta } from "./store-cliente.js";

// ─────────────────────────────────────────────────────────────────────────────
// Detección por nombre
// ─────────────────────────────────────────────────────────────────────────────

export type TipoArchivoHistorico = "roma" | "actas" | "schiapp" | "kar" | "desconocido";

const RE_ROMA = /(^|[\s_/-])log\b.*\.xlsx?$/i;
const RE_ACTAS = /\bactas?\b.*\.xlsx?$/i;
const RE_SCHIAPP = /schiapp/i;
const RE_KAR = /kar[-\s_]?logistics?/i;

export function detectarTipo(nombre: string): TipoArchivoHistorico {
  const n = nombre.toLowerCase();
  if (RE_SCHIAPP.test(n)) return "schiapp";
  if (RE_KAR.test(n)) return "kar";
  if (RE_ACTAS.test(n)) return "actas";
  if (RE_ROMA.test(n)) return "roma";
  return "desconocido";
}

/** Heurística para etiquetar el mes ROMA por nombre. Devuelve "YYYY-MM" o null. */
function inferirMesRoma(nombre: string): string | null {
  const n = nombre.toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/\benero\b/, "2026-01"],
    [/\bfebrero\b/, "2026-02"],
    [/\bmarzo\b/, "2026-03"],
    [/\babril\b/, "2026-04"],
    [/\bmayo\b/, "2026-05"],
  ];
  for (const [re, mes] of map) if (re.test(n)) return mes;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de parseo ROMIA (idénticos a diag/validar-cruce-vs-csv.mjs)
// ─────────────────────────────────────────────────────────────────────────────

function toDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "number") {
    if (v === 0) return null;
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const s = String(v).trim();
  if (!s || s === "0" || s === "00-00-0000") return null;
  const low = s.toLowerCase();
  if (low === "sin salida" || low === "en proceso" || low === "por confirmar") return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}

function nz<T>(v: T | "" | 0 | "0" | null | undefined): T | null {
  return v == null || v === "" || (v as unknown) === 0 || v === "0" ? null : (v as T);
}

function vinKey(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  return s.length >= 11 ? s : null;
}

function rowsOf(ws: XLSX.WorkSheet): Array<Record<string, unknown>> {
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: true });
}

function esSinSalida(v: unknown): boolean {
  return v != null && String(v).trim().toUpperCase() === "SIN SALIDA";
}

interface RomiaAcc extends RomiaConsolidadoMin {
  // RomiaAcc es alias estructural pero permite mutación durante el parse.
  fEntradaPatio?: Date | null;
}

function cargarRomiaWorkbook(
  wb: XLSX.WorkBook,
  bodega: "SCHIAPP" | "KAR",
): Map<string, RomiaConsolidadoMin> {
  const out = new Map<string, RomiaAcc>();
  const ensure = (vin: string): RomiaAcc => {
    let a = out.get(vin);
    if (!a) {
      a = {
        vin,
        bodega,
        fCompraMarca: null,
        fIngresoBodega: null,
        fSolicitudBodega: null,
        fPlanificacionFisica: null,
        fSalidaFisica: null,
        fLlegadaPatio: null,
        tieneSinSalida: false,
        estadoBodega: null,
        patio: null,
        puntoEntrega: null,
        cumplimientoDespacho: null,
      };
      out.set(vin, a);
    }
    return a;
  };

  const hAlm = wb.SheetNames.find((n) => /^almacenamiento\s*$/i.test(n));
  const hDist = wb.SheetNames.find((n) => /^distribuci[oó]n\s*$/i.test(n));
  const hEnt = wb.SheetNames.find((n) => /^entradas\s*$/i.test(n));
  const hSal = wb.SheetNames.find((n) => /^salidas\s*$/i.test(n));

  if (hAlm) {
    for (const r of rowsOf(wb.Sheets[hAlm])) {
      const vin = vinKey(r["VIN"]);
      if (!vin) continue;
      const a = ensure(vin);
      a.fIngresoBodega = a.fIngresoBodega ?? toDate(r["1° dia Almacenaje en bodega"]);
      a.estadoBodega =
        a.estadoBodega ??
        nz(r["Disponible en bodega"] as string) ??
        nz(r["Estado Kar"] as string) ??
        nz(r["Estado Kar "] as string);
      a.fCompraMarca = a.fCompraMarca ?? toDate(r["Fecha compra marca"] ?? r["Fecha Compra marca"]);
    }
  }
  if (hDist) {
    for (const r of rowsOf(wb.Sheets[hDist])) {
      const vin = vinKey(r["VIN"]);
      if (!vin) continue;
      const a = ensure(vin);
      a.fCompraMarca =
        a.fCompraMarca ?? toDate(r["Fecha compra marca"] ?? r["Fecha Compra Marca"]);
      a.fIngresoBodega =
        a.fIngresoBodega ?? toDate(r["1° dia Almacenaje en bodega"] ?? r["1° dia Almacenaje"]);
      const fSol =
        toDate(r["Fecha de solicitud"]) ??
        toDate(r["Fecha  Solicitud"]) ??
        toDate(r["Fecha Solicitud"]);
      a.fSolicitudBodega = a.fSolicitudBodega ?? fSol;
      a.fPlanificacionFisica = a.fPlanificacionFisica ?? toDate(r["Fecha teorica STLI"]);
      const desp = r["Fecha despacho a sucursal"];
      if (esSinSalida(desp)) a.tieneSinSalida = true;
      else a.fSalidaFisica = a.fSalidaFisica ?? toDate(desp);
      a.cumplimientoDespacho =
        a.cumplimientoDespacho ??
        nz(r["Cumplimiento despacho"] as string) ??
        nz(r["Cumplimiento fecha limite"] as string);
    }
  }
  if (hEnt) {
    for (const r of rowsOf(wb.Sheets[hEnt])) {
      const vin = vinKey(r["VIN"]);
      if (!vin) continue;
      const a = ensure(vin);
      a.fLlegadaPatio = a.fLlegadaPatio ?? toDate(r["Fecha Ent"] ?? r["Fecha Entrada"]);
      a.estadoBodega =
        a.estadoBodega ??
        nz(r["Estado"] as string) ??
        nz(r["Estado Gp Simplificado"] as string);
      a.patio = a.patio ?? nz(r["Patio"] as string) ?? nz(r["Zona"] as string);
      a.puntoEntrega =
        a.puntoEntrega ??
        nz(r["Punto de Entrega"] as string) ??
        nz(r["Destino"] as string);
    }
  }
  if (hSal) {
    for (const r of rowsOf(wb.Sheets[hSal])) {
      const vin = vinKey(r["VIN"]);
      if (!vin) continue;
      const a = ensure(vin);
      const fSal = toDate(r["Fecha Sal"] ?? r["Fecha Salida"]);
      if (fSal && (!a.fSalidaFisica || fSal > a.fSalidaFisica)) a.fSalidaFisica = fSal;
    }
  }

  return out as Map<string, RomiaConsolidadoMin>;
}

function fusionarRomia(
  schiapp: Map<string, RomiaConsolidadoMin> | null,
  kar: Map<string, RomiaConsolidadoMin> | null,
): SnapshotRomia | null {
  if (!schiapp && !kar) return null;
  const porVin = new Map<string, RomiaConsolidadoMin>();
  const allVins = new Set<string>([
    ...(schiapp ? schiapp.keys() : []),
    ...(kar ? kar.keys() : []),
  ]);
  for (const vin of allVins) {
    const k = kar?.get(vin);
    const s = schiapp?.get(vin);
    if (k && s) {
      const merged: RomiaConsolidadoMin = { ...k };
      for (const key of Object.keys(s) as Array<keyof RomiaConsolidadoMin>) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((merged as any)[key] == null && (s as any)[key] != null) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (merged as any)[key] = (s as any)[key];
        }
      }
      if (s.tieneSinSalida) merged.tieneSinSalida = true;
      merged.bodega = `${k.bodega}+${s.bodega}`;
      porVin.set(vin, merged);
    } else if (k) porVin.set(vin, k);
    else if (s) porVin.set(vin, s);
  }
  return { porVin, meta: { fechaCarga: new Date() } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado interno del dispatcher (acumula ROMA antes de aplicar)
// ─────────────────────────────────────────────────────────────────────────────

interface AcumuladorRoma {
  cortes: Array<{ corte: ResultadoIngestaRoma; meta: CargaRomaMeta }>;
}

let romiaSchiappAcum: Map<string, RomiaConsolidadoMin> | null = null;
let romiaKarAcum: Map<string, RomiaConsolidadoMin> | null = null;
let romaAcum: AcumuladorRoma = { cortes: [] };

function resetAcumuladores() {
  romiaSchiappAcum = null;
  romiaKarAcum = null;
  romaAcum = { cortes: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

export async function procesarArchivos(files: File[]): Promise<void> {
  const store = useHistoricoStore.getState();

  store.setProgreso({ enCurso: true, total: files.length, procesados: 0, archivoActual: null });

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    store.setProgreso({ archivoActual: file.name, procesados: i });

    try {
      await procesarUno(file);
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      store.addError({ archivoNombre: file.name, mensaje });
    }
  }

  // Reaplicar todo el pipeline tras el lote
  await reconsolidar();

  store.setProgreso({ enCurso: false, archivoActual: null, procesados: files.length });
}

async function procesarUno(file: File): Promise<void> {
  const tipo = detectarTipo(file.name);
  if (tipo === "desconocido") {
    throw new Error(
      `No se reconoce el tipo del archivo "${file.name}". Esperaba ROMA (LOG_*), Actas, SCHIAPP o KAR.`,
    );
  }

  const buf = await file.arrayBuffer();

  if (tipo === "roma") {
    const corte = parseRomaMensualBuffer(new Uint8Array(buf), file.name, file.size);
    const meta: CargaRomaMeta = {
      mes: inferirMesRoma(file.name) ?? corte.corte.id,
      archivoNombre: file.name,
      archivoSize: file.size,
      filas: corte.filas.length,
      corte: corte.corte.id,
      confianzaMesDeteccion: corte.report.confianzaMesDeteccion,
    };
    // Reemplazar si ya hay un corte del mismo mes
    romaAcum.cortes = romaAcum.cortes.filter((x) => x.meta.mes !== meta.mes);
    romaAcum.cortes.push({ corte, meta });
    return;
  }

  if (tipo === "actas") {
    const corte = parseActasBuffer(new Uint8Array(buf), file.name, file.size);
    const h0 = crearHistoricoActasVacio();
    const r = aplicarCorteActas(h0, corte);
    useHistoricoStore.getState().setHistoricoActas(r.historico, {
      archivoNombre: file.name,
      archivoSize: file.size,
      filas: corte.filas.length,
      corte: corte.corte.id,
      confianzaCorte: corte.report.confianzaCorte,
    });
    return;
  }

  if (tipo === "schiapp" || tipo === "kar") {
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const consolidado = cargarRomiaWorkbook(wb, tipo === "schiapp" ? "SCHIAPP" : "KAR");
    if (tipo === "schiapp") {
      romiaSchiappAcum = consolidado;
      useHistoricoStore.getState().setRomiaSchiapp({
        archivoNombre: file.name,
        archivoSize: file.size,
        vins: consolidado.size,
      });
    } else {
      romiaKarAcum = consolidado;
      useHistoricoStore.getState().setRomiaKar({
        archivoNombre: file.name,
        archivoSize: file.size,
        vins: consolidado.size,
      });
    }
    return;
  }
}

async function reconsolidar(): Promise<void> {
  const store = useHistoricoStore.getState();

  // Ordenar cortes ROMA cronológicamente por mes
  const cortesOrdenados = [...romaAcum.cortes].sort((a, b) => a.meta.mes.localeCompare(b.meta.mes));

  if (cortesOrdenados.length > 0) {
    const h0Roma = crearHistoricoVacio();
    const { historicoFinal } = aplicarCortesRoma(
      h0Roma,
      cortesOrdenados.map((x) => x.corte),
    );
    store.setHistoricoRoma(
      historicoFinal,
      cortesOrdenados.map((x) => x.meta),
    );
  }

  // Snapshot ROMIA si hay alguno
  const snap = fusionarRomia(romiaSchiappAcum, romiaKarAcum);
  if (snap) store.setSnapshotRomia(snap);

  // Cruce final si hay datos mínimos
  const s2 = useHistoricoStore.getState();
  if (s2.historicoRoma && s2.historicoActas) {
    const cruce = cruzarRomaActas({
      historicoRoma: s2.historicoRoma,
      historicoActas: s2.historicoActas,
      romiaSnapshot: s2.romiaSnapshot ?? undefined,
    });
    store.setCruce(cruce);
  }
}

/** Limpia todo el estado de carga (cortes acumulados y store). */
export function limpiarTodo(): void {
  resetAcumuladores();
  useHistoricoStore.getState().resetAll();
}
