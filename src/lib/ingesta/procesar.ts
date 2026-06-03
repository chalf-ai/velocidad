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
import { parseRomiaFile } from "../parser/romia-logistica";
import { limpiarVIN } from "../parser/venta-apc";
import { useExcelStore } from "../store";
import { useIngestaStore, type FuenteId, type IngestaMeta } from "./store";
// Puente al motor histórico: el dispatcher histórico parsea con los parsers
// nuevos y popula `useHistoricoStore` para alimentar /velocidad-operacional.
// Una sola ingesta, muchas vistas.
import {
  procesarArchivos as procesarArchivosHistorico,
  limpiarTodo as limpiarTodoHistorico,
} from "../historico/cargar-archivos-cliente";
import { useHistoricoStore } from "../historico/store-cliente";
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
    const det = detectarFuente(wbHead, file.name);
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
        // ── DOBLE PARSEO ROMA: si es agenda ROMA, alimentar también el motor
        //    histórico (parseRomaMensualBuffer + consolidador). El parser legacy
        //    sigue ahí para el cockpit; el motor nuevo se entera del mismo file.
        if (parsed.kind === "ROMA") {
          await procesarArchivosHistorico([file]);
        }
        return { ...base, tipo: fuenteId, fuenteId, ok: true, reemplazo, registros: parsed.report.filasProcesadas, vins, fechaCorte, advertencias: adv };
      }

      case "actas": {
        // Doble dispatch (decisión usuario 2026-06):
        //   1) Histórico — alimenta `useHistoricoStore` vía dispatcher histórico.
        //   2) FNE operacional — el archivo "Actas al X.xlsx" contiene el
        //      universo completo (entregados + no entregados); parseFNEFile
        //      reusa la misma hoja (Vin / entrega_auto_txt / FechaFactura) y
        //      llena el universo FNE que consumen Centro de Acción, FNE,
        //      Score Gerencial, etc.
        // Si el parse FNE falla, NO se interrumpe la carga histórica:
        // se reporta como advertencia clara.

        // ── 1) Histórico ────────────────────────────────────────────────
        const reemplazoActas = useHistoricoStore.getState().cargaActas != null;
        await procesarArchivosHistorico([file]);
        const hs = useHistoricoStore.getState();
        const carga = hs.cargaActas;
        const corteFechaActas = hs.historicoActas?.cortes.at(-1)?.corteFecha ?? null;
        const advActas: string[] = [];
        if (!carga) {
          advActas.push("El dispatcher histórico no pudo procesar el archivo.");
        }

        // ── 2) FNE operacional ──────────────────────────────────────────
        const reemplazoFne = excel.fne != null;
        let fneOk = false;
        try {
          const parsedFne = await parseFNEFile(file);
          excel.setFNE(parsedFne);
          const fneCorte = maxDate(parsedFne.registros.map((r) => r.fechaFactura));
          const fneVins = contarVins(parsedFne.registros.map((r) => r.vin));
          const fneRegistros = parsedFne.report.filasProcesadas;
          const advFne: string[] = [];
          if (parsedFne.report.filasOmitidas)
            advFne.push(`${parsedFne.report.filasOmitidas} filas sin VIN`);
          if (parsedFne.report.vinsDuplicados.length)
            advFne.push(`${parsedFne.report.vinsDuplicados.length} VIN duplicados`);
          const persistenciaFne = await persistirSnapshot({
            file,
            fuente: "FNE",
            payload: parsedFne,
            registros: fneRegistros,
            fechaCorte: fneCorte,
          });
          if (persistenciaFne) advFne.push(persistenciaFne);
          aplicarMeta({
            fuenteId: "fne",
            archivoNombre: file.name,
            archivoSize: file.size,
            fechaCarga: new Date(),
            fechaCorte: fneCorte,
            registros: fneRegistros,
            vins: fneVins,
            advertencias: advFne,
          });
          fneOk = true;
        } catch (e) {
          const detalle = e instanceof Error ? e.message : String(e);
          console.error("[ingesta:actas] FNE parse falló:", detalle);
          advActas.push(
            `Actas cargadas para histórico, pero no se pudo actualizar FNE operacional: ${detalle}`,
          );
        }

        if (fneOk) {
          advActas.push("También se actualizó FNE operacional desde este archivo.");
        }

        // ── 3) Meta de la tarjeta "actas" ───────────────────────────────
        aplicarMeta({
          fuenteId: "actas",
          archivoNombre: file.name,
          archivoSize: file.size,
          fechaCarga: new Date(),
          fechaCorte: corteFechaActas,
          registros: carga?.filas ?? 0,
          vins: carga?.filas ?? null,
          advertencias: advActas,
        });
        return {
          ...base,
          fuenteId: "actas",
          ok: !!carga,
          reemplazo: reemplazoActas || reemplazoFne,
          registros: carga?.filas ?? 0,
          vins: carga?.filas ?? null,
          fechaCorte: corteFechaActas,
          advertencias: advActas,
        };
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

      case "romia_schiapp":
      case "romia_kar": {
        // Modelo logístico nuevo (SCHIAPPCASSE / KAR-LOGISTICS). Mismo parser
        // unificado: parseRomiaFile detecta la bodega y produce RomiaRow[].
        const parsed = await parseRomiaFile(file);
        const esperado: FuenteTipo = tipo;
        const obtenido: FuenteTipo =
          parsed.bodega === "SCHIAPP" ? "romia_schiapp" : "romia_kar";
        const fuenteId: FuenteId = obtenido;
        const reemplazo =
          parsed.bodega === "SCHIAPP" ? excel.romiaSchiapp != null : excel.romiaKar != null;
        if (parsed.bodega === "SCHIAPP") excel.setRomiaSchiapp(parsed.filas);
        else excel.setRomiaKar(parsed.filas);
        const fechaCorte = maxDate(
          parsed.filas.flatMap((r) => [
            r.fIngresoApc,
            r.fSolicitudBodega,
            r.fSolicitudVendedor,
            r.fDespacho,
            r.fEntradaPatio,
            r.fSalidaPatio,
            r.fechaLimite,
          ]),
        );
        const vins = contarVins(parsed.filas.map((r) => r.vin));
        const adv: string[] = [];
        if (esperado !== obtenido) {
          adv.push(
            `Detección por hojas dijo ${esperado}, parser identificó ${obtenido}. Se aplicó el resultado del parser.`,
          );
        }
        if (parsed.report.sinSalida > 0) {
          adv.push(
            `${parsed.report.sinSalida} VIN con "SIN SALIDA" — auto físico aún en patio.`,
          );
        }
        aplicarMeta({
          fuenteId,
          archivoNombre: file.name,
          archivoSize: file.size,
          fechaCarga: new Date(),
          fechaCorte,
          registros: parsed.filas.length,
          vins,
          advertencias: adv,
        });
        // ── Puente histórico para ROMIA: el dispatcher histórico parsea el
        //    archivo y construye el snapshot ROMIA del cruce. El archivo se
        //    parsea dos veces (legacy + histórico) — costo aceptado.
        await procesarArchivosHistorico([file]);
        return {
          ...base,
          tipo: fuenteId,
          fuenteId,
          ok: true,
          reemplazo,
          registros: parsed.filas.length,
          vins,
          fechaCorte,
          advertencias: adv,
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
    case "romia_schiapp":
    case "romia_kar":
      // El store maneja ROMA + STLI + ROMIA(SCHIAPP+KAR) juntos en
      // `logisticaPorVin`. clearLogistica los limpia todos a la vez.
      s.clearLogistica();
      ing.clearMeta("logistica_roma");
      ing.clearMeta("logistica_stli");
      ing.clearMeta("romia_schiapp");
      ing.clearMeta("romia_kar");
      // El histórico se invalida en cascada: dejamos cualquier histórico que
      // dependiera de esa fuente fuera del cruce. La forma menos invasiva
      // es limpiar todo el motor histórico — el usuario lo repuebla
      // recargando los archivos correspondientes.
      limpiarTodoHistorico();
      ing.clearMeta("actas");
      return;
    case "actas":
      // Limpieza específica de Actas: borra del histórico y libera el cruce.
      limpiarTodoHistorico();
      ing.clearMeta("actas");
      return;
  }
}

/** Limpia TODO (datos + metadatos), incluido el motor histórico. */
export function limpiarTodo(): void {
  const s = useExcelStore.getState();
  s.reset();
  s.resetFNE();
  s.resetSaldos();
  s.resetProvisiones();
  s.clearLogistica();
  useIngestaStore.getState().clearAll();
  limpiarTodoHistorico();
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
