/**
 * DISPATCHER DE INGESTA · detecta el tipo de cada Excel, llama al parser EXISTENTE
 * correcto, actualiza el store de datos (useExcelStore), registra metadatos
 * (useIngestaStore) y persiste snapshots oficiales para todos los usuarios.
 *
 * Reglas de validación (del usuario):
 *   - NUNCA bloquear por fecha, archivo viejo ni fuente faltante.
 *   - SOLO bloquear (por archivo) si no parsea / falta hoja-columna mínima / corrupto.
 *   - Las inconsistencias de corte se reportan como ALERTA, no detienen nada.
 */

"use client";

import * as XLSX from "xlsx";
import { detectarFuente, type FuenteTipo } from "../parser/detectar-fuente";
import { parseExcelFile } from "../parser";
import { parseFNEFile } from "../parser/autos-no-entregados";
import { parseSaldosFile } from "../parser/saldos";
import { parseProvisionesFile } from "../parser/provisiones";
import { parseLogisticaFile } from "../parser/logistica";
import { limpiarVIN } from "../parser/venta-apc";
import { useExcelStore } from "../store";
import { useIngestaStore, type FuenteId, type IngestaMeta } from "./store";
import {
  postSnapshot,
  serializeStockPayload,
  type FuenteSnapshot,
} from "../snapshot-client";

export interface IngestaResultado {
  archivoNombre: string;
  tipo: FuenteTipo;
  fuenteId: FuenteId | null;
  ok: boolean;
  reemplazo: boolean;
  registros: number;
  vins: number | null;
  fechaCorte: Date | null;
  advertencias: string[];
  error: string | null;
  motivoDeteccion: string;
}

const maxDate = (ds: (Date | null | undefined)[]): Date | null => {
  let m: number | null = null;
  for (const d of ds) {
    if (d && Number.isFinite(d.getTime())) m = m == null ? d.getTime() : Math.max(m, d.getTime());
  }
  return m == null ? null : new Date(m);
};

const contarVins = (vins: (string | null | undefined)[]): number => {
  const set = new Set<string>();
  for (const v of vins) {
    const k = limpiarVIN(v ?? "");
    if (k) set.add(k);
  }
  return set.size;
};

async function persistirSnapshot(args: {
  file: File;
  fuente: FuenteSnapshot;
  payload: unknown;
  registros: number;
  fechaCorte?: Date | null;
}): Promise<string | null> {
  try {
    await postSnapshot({
      nombre: args.file.name,
      tamano: args.file.size,
      fechaCorte: args.fechaCorte ?? null,
      fuente: args.fuente,
      payload: args.payload,
      registros: args.registros,
    });
    return null;
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    console.error(`[snapshot] ${args.fuente} persistencia falló:`, detalle);
    return `No se persistió en servidor; otros usuarios no verán este corte. Detalle: ${detalle}`;
  }
}

/**
 * Procesa UN archivo: detecta, parsea, actualiza stores. Nunca lanza: cualquier
 * fallo se devuelve como `ok:false` + error para que el resto de archivos siga.
 */
export async function procesarArchivo(file: File): Promise<IngestaResultado> {
  const base: IngestaResultado = {
    archivoNombre: file.name,
    tipo: "desconocido",
    fuenteId: null,
    ok: false,
    reemplazo: false,
    registros: 0,
    vins: null,
    fechaCorte: null,
    advertencias: [],
    error: null,
    motivoDeteccion: "",
  };

  let tipo: FuenteTipo;
  try {
    const buf = await file.arrayBuffer();
    // Solo el encabezado: barato aun en archivos grandes.
    const wbHead = XLSX.read(buf, { type: "array", sheetRows: 1 });
    const det = detectarFuente(wbHead);
    tipo = det.tipo;
    base.tipo = det.tipo;
    base.motivoDeteccion = det.motivo;
  } catch (e) {
    return {
      ...base,
      error: `No se pudo leer el archivo (¿corrupto o no es Excel?): ${e instanceof Error ? e.message : "error"}`,
    };
  }

  const excel = useExcelStore.getState();
  const ingesta = useIngestaStore.getState();
  const aplicarMeta = (m: IngestaMeta) => ingesta.setMeta(m);

  try {
    switch (tipo) {
      case "stock": {
        const reemplazo = excel.data != null;
        const parsed = await parseExcelFile(file);
        excel.setData(parsed);
        const adv: string[] = [];
        const rep = parsed.report;
        if (rep.vinsDuplicados.length) adv.push(`${rep.vinsDuplicados.length} VIN duplicados`);
        if (rep.fechasInvalidas) adv.push(`${rep.fechasInvalidas} fechas inválidas`);
        if (rep.marcasSinMapeo.length) adv.push(`${rep.marcasSinMapeo.length} marcas sin mapeo`);
        if (rep.fechaCorteExcel == null) adv.push("Sin fecha de corte detectada");
        const persistencia = await persistirSnapshot({
          file,
          fuente: "BASE_STOCK",
          payload: serializeStockPayload(parsed),
          registros: rep.totalVehiculos,
          fechaCorte: rep.fechaCorteExcel,
        });
        if (persistencia) adv.push(persistencia);
        const meta: IngestaMeta = {
          fuenteId: "stock",
          archivoNombre: file.name,
          archivoSize: file.size,
          fechaCarga: new Date(),
          fechaCorte: rep.fechaCorteExcel,
          registros: rep.totalVehiculos,
          vins: rep.totalVinsUnicos,
          advertencias: adv,
        };
        aplicarMeta(meta);
        // TESCAR viene DENTRO del Excel de stock (hoja Control TestCars).
        aplicarMeta({
          fuenteId: "tescar",
          archivoNombre: file.name,
          archivoSize: file.size,
          fechaCarga: new Date(),
          fechaCorte: rep.fechaCorteExcel,
          registros: parsed.tescarControl.length,
          vins: contarVins(parsed.tescarControl.map((t) => t.vinLimpio)),
          advertencias: parsed.tescarControl.length === 0 ? ["Sin filas TEST CARS/BDR"] : [],
        });
        return { ...base, fuenteId: "stock", ok: true, reemplazo, registros: meta.registros, vins: meta.vins, fechaCorte: meta.fechaCorte, advertencias: adv };
      }

      case "fne": {
        const reemplazo = excel.fne != null;
        const parsed = await parseFNEFile(file);
        excel.setFNE(parsed);
        const adv: string[] = [];
        if (parsed.report.filasOmitidas) adv.push(`${parsed.report.filasOmitidas} filas sin VIN`);
        if (parsed.report.vinsDuplicados.length) adv.push(`${parsed.report.vinsDuplicados.length} VIN duplicados`);
        const fechaCorte = maxDate(parsed.registros.map((r) => r.fechaFactura));
        const vins = contarVins(parsed.registros.map((r) => r.vin));
        const persistencia = await persistirSnapshot({
          file,
          fuente: "FNE",
          payload: parsed,
          registros: parsed.report.filasProcesadas,
          fechaCorte,
        });
        if (persistencia) adv.push(persistencia);
        aplicarMeta({ fuenteId: "fne", archivoNombre: file.name, archivoSize: file.size, fechaCarga: new Date(), fechaCorte, registros: parsed.report.filasProcesadas, vins, advertencias: adv });
        return { ...base, fuenteId: "fne", ok: true, reemplazo, registros: parsed.report.filasProcesadas, vins, fechaCorte, advertencias: adv };
      }

      case "saldos": {
        const reemplazo = excel.saldos != null;
        const parsed = await parseSaldosFile(file);
        excel.setSaldos(parsed);
        const adv: string[] = [];
        if (parsed.report.cajonesSinFormato) adv.push(`${parsed.report.cajonesSinFormato} cajones sin formato`);
        if (parsed.report.filasOmitidas) adv.push(`${parsed.report.filasOmitidas} filas omitidas`);
        const fechaCorte = maxDate(parsed.registros.map((r) => r.fechaVenta));
        const vins = contarVins(parsed.registros.map((r) => r.vinResuelto));
        const persistencia = await persistirSnapshot({
          file,
          fuente: "SALDOS",
          payload: parsed,
          registros: parsed.report.filasProcesadas,
          fechaCorte,
        });
        if (persistencia) adv.push(persistencia);
        aplicarMeta({ fuenteId: "saldos", archivoNombre: file.name, archivoSize: file.size, fechaCarga: new Date(), fechaCorte, registros: parsed.report.filasProcesadas, vins, advertencias: adv });
        return { ...base, fuenteId: "saldos", ok: true, reemplazo, registros: parsed.report.filasProcesadas, vins, fechaCorte, advertencias: adv };
      }

      case "provisiones": {
        const reemplazo = excel.provisiones != null;
        const parsed = await parseProvisionesFile(file);
        excel.setProvisiones(parsed);
        const adv: string[] = [];
        if (parsed.report.filasOmitidas) adv.push(`${parsed.report.filasOmitidas} filas sin ID`);
        const fechaCorte = maxDate(parsed.registros.map((r) => r.fechaCreacion));
        const persistencia = await persistirSnapshot({
          file,
          fuente: "PROVISIONES",
          payload: parsed,
          registros: parsed.report.filasProcesadas,
          fechaCorte,
        });
        if (persistencia) adv.push(persistencia);
        aplicarMeta({ fuenteId: "provisiones", archivoNombre: file.name, archivoSize: file.size, fechaCarga: new Date(), fechaCorte, registros: parsed.report.filasProcesadas, vins: null, advertencias: adv });
        return { ...base, fuenteId: "provisiones", ok: true, reemplazo, registros: parsed.report.filasProcesadas, vins: null, fechaCorte, advertencias: adv };
      }

      case "logistica_roma":
      case "logistica_stli": {
        const parsed = await parseLogisticaFile(file);
        const fuenteId: FuenteId = parsed.kind === "ROMA" ? "logistica_roma" : "logistica_stli";
        const reemplazo =
          parsed.kind === "ROMA" ? excel.logisticaRoma != null : excel.logisticaSTLI != null;
        let fechaCorte: Date | null = null;
        let vins = 0;
        const adv: string[] = [];
        if (parsed.kind === "ROMA" && parsed.roma) {
          excel.setLogisticaRoma(parsed.roma);
          fechaCorte = maxDate(parsed.roma.flatMap((r) => [r.fLlegadaSucursal, r.fFactura, r.fSolicitud]));
          vins = contarVins(parsed.roma.map((r) => r.vin));
          const persistencia = await persistirSnapshot({
            file,
            fuente: "LOGISTICA_ROMA",
            payload: parsed.roma,
            registros: parsed.report.filasProcesadas,
            fechaCorte,
          });
          if (persistencia) adv.push(persistencia);
        } else if (parsed.stli) {
          excel.setLogisticaSTLI(parsed.stli);
          fechaCorte = maxDate(parsed.stli.flatMap((r) => [r.fDespacho, r.fSolicitudBodega, r.fIngresoApc]));
          vins = contarVins(parsed.stli.map((r) => r.vin));
          const persistencia = await persistirSnapshot({
            file,
            fuente: "LOGISTICA_STLI",
            payload: parsed.stli,
            registros: parsed.report.filasProcesadas,
            fechaCorte,
          });
          if (persistencia) adv.push(persistencia);
        }
        const omit = parsed.report.filasTotales - parsed.report.filasProcesadas;
        if (omit > 0) adv.push(`${omit} filas sin VIN`);
        aplicarMeta({ fuenteId, archivoNombre: file.name, archivoSize: file.size, fechaCarga: new Date(), fechaCorte, registros: parsed.report.filasProcesadas, vins, advertencias: adv });
        return { ...base, tipo: fuenteId, fuenteId, ok: true, reemplazo, registros: parsed.report.filasProcesadas, vins, fechaCorte, advertencias: adv };
      }

      case "tescar": {
        // El TESCAR oficial vive dentro del Excel de stock (hoja Control TestCars).
        // Un archivo standalone con esa hoja no se aplica solo: se informa.
        return {
          ...base,
          tipo: "tescar",
          ok: false,
          advertencias: ["TESCAR se carga junto con el Excel de Stock (hoja Control TestCars). Sube el archivo maestro de stock."],
        };
      }

      default:
        return {
          ...base,
          error: "Archivo no reconocido como ninguna fuente operacional conocida.",
        };
    }
  } catch (e) {
    return {
      ...base,
      error: e instanceof Error ? e.message : "Error al parsear el archivo.",
    };
  }
}

/** Limpia una fuente: borra sus datos del store y su metadato. */
export function limpiarFuente(id: FuenteId): void {
  const s = useExcelStore.getState();
  const ing = useIngestaStore.getState();
  switch (id) {
    case "stock":
      s.reset();
      ing.clearMeta("stock");
      ing.clearMeta("tescar"); // tescar vive dentro del stock
      return;
    case "tescar":
      // TESCAR no es independiente: limpiarlo equivale a limpiar el stock.
      s.reset();
      ing.clearMeta("stock");
      ing.clearMeta("tescar");
      return;
    case "fne":
      s.resetFNE();
      ing.clearMeta("fne");
      return;
    case "saldos":
      s.resetSaldos();
      ing.clearMeta("saldos");
      return;
    case "provisiones":
      s.resetProvisiones();
      ing.clearMeta("provisiones");
      return;
    case "logistica_roma":
    case "logistica_stli":
      // El store maneja ROMA+STLI juntos; limpiar una limpia la logística completa.
      s.clearLogistica();
      ing.clearMeta("logistica_roma");
      ing.clearMeta("logistica_stli");
      return;
  }
}

/** Limpia TODO (datos + metadatos). */
export function limpiarTodo(): void {
  const s = useExcelStore.getState();
  s.reset();
  s.resetFNE();
  s.resetSaldos();
  s.resetProvisiones();
  s.clearLogistica();
  useIngestaStore.getState().clearAll();
}

export interface ResumenCortes {
  fechas: { fuenteId: FuenteId; fecha: Date }[];
  alineados: boolean;
  spreadDias: number;
}

/** Compara las fechas de corte entre fuentes. Solo informa; nunca bloquea. */
export function resumenCortes(metas: Partial<Record<FuenteId, IngestaMeta>>): ResumenCortes {
  const fechas: { fuenteId: FuenteId; fecha: Date }[] = [];
  for (const m of Object.values(metas)) {
    if (m && m.fechaCorte && Number.isFinite(m.fechaCorte.getTime()))
      fechas.push({ fuenteId: m.fuenteId, fecha: m.fechaCorte });
  }
  if (fechas.length < 2) return { fechas, alineados: true, spreadDias: 0 };
  const dias = (d: Date) => Math.floor(d.getTime() / 86400000);
  const valores = fechas.map((f) => dias(f.fecha));
  const spreadDias = Math.max(...valores) - Math.min(...valores);
  const alineados = new Set(valores).size <= 1;
  return { fechas, alineados, spreadDias };
}
