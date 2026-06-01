"use client";

/**
 * SnapshotHydrator — al montar la app (dentro del shell autenticado), pide al
 * backend el snapshot activo de cada fuente y lo carga al store en memoria.
 *
 * Reglas:
 *   · Corre UNA sola vez por sesión (flag local).
 *   · Sólo hidrata las fuentes cuyo slot del store esté vacío. Así no pisa una
 *     carga manual hecha por el admin en esa misma sesión.
 *   · Falla silenciosa: si la API devuelve 404 (no hay snapshot) o 401 (sin
 *     sesión todavía), no rompe la UI. Logea a consola para diagnóstico.
 *   · No bloquea el render — la app se ve aunque la hidratación no haya
 *     terminado; los módulos siguen mostrando "carga un Excel" si están vacíos.
 */

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useExcelStore } from "@/lib/store";
import { useIngestaStore, type FuenteId } from "@/lib/ingesta/store";
import {
  fetchActiveSnapshot,
  deserializeStockPayload,
  reviveDates,
  type ActiveSnapshotResult,
  type FuenteSnapshot,
} from "@/lib/snapshot-client";
import type { ParsedFNE, ParsedSaldos, ParsedProvisiones } from "@/lib/types";
import type { LogisticaRomaRow, LogisticaStliRow } from "@/lib/logistica/construir";
import { limpiarVIN } from "@/lib/parser/venta-apc";

async function hidratarSeguro<T>(
  fuente: FuenteSnapshot,
  apply: (snapshot: ActiveSnapshotResult<T>) => void,
): Promise<boolean> {
  try {
    const snap = await fetchActiveSnapshot<T>(fuente);
    if (!snap) return false;
    apply(snap);
    return true;
  } catch (err) {
    console.warn(`[snapshot] hidratación ${fuente} falló:`, err);
    return false;
  }
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function contarVins(vins: Array<string | null | undefined>): number {
  const out = new Set<string>();
  for (const vin of vins) {
    const limpio = limpiarVIN(vin ?? "");
    if (limpio) out.add(limpio);
  }
  return out.size;
}

function setMetaFromSnapshot(args: {
  fuenteId: FuenteId;
  snapshot: ActiveSnapshotResult;
  registros: number;
  vins: number | null;
  fechaCorte?: Date | null;
  advertencias?: string[];
}) {
  useIngestaStore.getState().setMeta({
    fuenteId: args.fuenteId,
    archivoNombre: args.snapshot.nombre,
    archivoSize: args.snapshot.tamano,
    fechaCarga: new Date(args.snapshot.createdAt),
    fechaCorte: args.fechaCorte ?? toDate(args.snapshot.fechaCorte),
    registros: args.registros,
    vins: args.vins,
    advertencias: args.advertencias ?? [],
  });
}

export function SnapshotHydrator() {
  const { status } = useSession();
  const hidratado = useRef(false);

  useEffect(() => {
    if (hidratado.current) return;
    if (status !== "authenticated") return; // espera la sesión

    hidratado.current = true;
    const store = useExcelStore.getState();

    // Stock maestro — payload es ParsedExcel; vinsExtra (Map) requiere reviver.
    if (!store.data) {
      void hidratarSeguro<unknown>("BASE_STOCK", (snap) => {
        const parsed = deserializeStockPayload(snap.payload);
        useExcelStore.getState().setData(parsed);
        setMetaFromSnapshot({
          fuenteId: "stock",
          snapshot: snap,
          registros: parsed.report.totalVehiculos,
          vins: parsed.report.totalVinsUnicos,
          fechaCorte: parsed.report.fechaCorteExcel,
          advertencias: [
            ...(parsed.report.vinsDuplicados.length
              ? [`${parsed.report.vinsDuplicados.length} VIN duplicados`]
              : []),
            ...(parsed.report.fechasInvalidas
              ? [`${parsed.report.fechasInvalidas} fechas inválidas`]
              : []),
            ...(parsed.report.marcasSinMapeo.length
              ? [`${parsed.report.marcasSinMapeo.length} marcas sin mapeo`]
              : []),
          ],
        });
        setMetaFromSnapshot({
          fuenteId: "tescar",
          snapshot: snap,
          registros: parsed.tescarControl.length,
          vins: contarVins(parsed.tescarControl.map((t) => t.vinLimpio)),
          fechaCorte: parsed.report.fechaCorteExcel,
          advertencias: parsed.tescarControl.length === 0 ? ["Sin filas TEST CARS/BDR"] : [],
        });
      });
    }

    // FNE
    // Snapshots viejos no tienen el flag `entregado` (se introdujo con el split
    // histórico/operativo). Normalizamos: si viene undefined ⇒ false. Idempotente:
    // snapshots nuevos vienen con el flag explícito y no se tocan.
    if (!store.fne) {
      void hidratarSeguro<ParsedFNE>("FNE", (snap) => {
        const revived = reviveDates(snap.payload);
        // Si vino un snapshot viejo SIN flag entregado, lo derivamos en runtime
        // aplicando la regla canónica actual: entrega_auto_txt === "Cargado".
        // Idempotente cuando el snapshot ya trae el flag explícito.
        const registros = (revived.registros ?? []).map((r) => {
          const entregaTxtNorm = (r.entregaAutoTxt ?? "").trim();
          const derivado = r.entregado === true || entregaTxtNorm === "Cargado";
          return {
            ...r,
            entregado: derivado,
            fechaEntregaReal: r.fechaEntregaReal ?? (derivado ? r.fechaPatenteEntregada ?? null : null),
            estadoEntregaOriginal: r.estadoEntregaOriginal ?? r.entregaAutoTxt ?? null,
            fuenteEntrega: r.fuenteEntrega ?? (derivado ? "entrega_auto_txt" : "ninguna"),
          };
        });
        const reportNormalizado = {
          ...revived.report,
          entregadosCount:
            revived.report?.entregadosCount ?? registros.filter((r) => r.entregado).length,
          noEntregadosCount:
            revived.report?.noEntregadosCount ?? registros.filter((r) => !r.entregado).length,
        };
        const parsed = { ...revived, registros, report: reportNormalizado };
        useExcelStore.getState().setFNE(parsed);
        setMetaFromSnapshot({
          fuenteId: "fne",
          snapshot: snap,
          registros: parsed.report.filasProcesadas,
          vins: contarVins(parsed.registros.map((r) => r.vin)),
          fechaCorte: toDate(snap.fechaCorte),
          advertencias: [
            ...(parsed.report.filasOmitidas ? [`${parsed.report.filasOmitidas} filas sin VIN`] : []),
            ...(parsed.report.vinsDuplicados.length
              ? [`${parsed.report.vinsDuplicados.length} VIN duplicados`]
              : []),
          ],
        });
      });
    }

    // Saldos
    if (!store.saldos) {
      void hidratarSeguro<ParsedSaldos>("SALDOS", (snap) => {
        const parsed = reviveDates(snap.payload);
        useExcelStore.getState().setSaldos(parsed);
        setMetaFromSnapshot({
          fuenteId: "saldos",
          snapshot: snap,
          registros: parsed.report.filasProcesadas,
          vins: contarVins(parsed.registros.map((r) => r.vinResuelto)),
          fechaCorte: toDate(snap.fechaCorte),
          advertencias: [
            ...(parsed.report.cajonesSinFormato
              ? [`${parsed.report.cajonesSinFormato} cajones sin formato`]
              : []),
            ...(parsed.report.filasOmitidas ? [`${parsed.report.filasOmitidas} filas omitidas`] : []),
          ],
        });
      });
    }

    // Provisiones
    if (!store.provisiones) {
      void hidratarSeguro<ParsedProvisiones>("PROVISIONES", (snap) => {
        const parsed = reviveDates(snap.payload);
        useExcelStore.getState().setProvisiones(parsed);
        setMetaFromSnapshot({
          fuenteId: "provisiones",
          snapshot: snap,
          registros: parsed.report.filasProcesadas,
          vins: null,
          fechaCorte: toDate(snap.fechaCorte),
          advertencias: parsed.report.filasOmitidas
            ? [`${parsed.report.filasOmitidas} filas sin ID`]
            : [],
        });
      });
    }

    // Logística ROMA (rows)
    if (!store.logisticaRoma) {
      void hidratarSeguro<LogisticaRomaRow[]>("LOGISTICA_ROMA", (snap) => {
        const parsed = reviveDates(snap.payload);
        useExcelStore.getState().setLogisticaRoma(parsed);
        setMetaFromSnapshot({
          fuenteId: "logistica_roma",
          snapshot: snap,
          registros: parsed.length,
          vins: contarVins(parsed.map((r) => r.vin)),
          fechaCorte: toDate(snap.fechaCorte),
        });
      });
    }

    // Logística STLI (rows)
    if (!store.logisticaSTLI) {
      void hidratarSeguro<LogisticaStliRow[]>("LOGISTICA_STLI", (snap) => {
        const parsed = reviveDates(snap.payload);
        useExcelStore.getState().setLogisticaSTLI(parsed);
        setMetaFromSnapshot({
          fuenteId: "logistica_stli",
          snapshot: snap,
          registros: parsed.length,
          vins: contarVins(parsed.map((r) => r.vin)),
          fechaCorte: toDate(snap.fechaCorte),
        });
      });
    }
  }, [status]);

  return null;
}
