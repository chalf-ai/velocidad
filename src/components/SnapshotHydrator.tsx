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
import {
  fetchActiveSnapshot,
  deserializeStockPayload,
  reviveDates,
  type FuenteSnapshot,
} from "@/lib/snapshot-client";
import type {
  ParsedFNE,
  ParsedSaldos,
  ParsedProvisiones,
} from "@/lib/types";
import type { LogisticaRomaRow, LogisticaStliRow } from "@/lib/logistica/construir";

async function hidratarSeguro<T>(
  fuente: FuenteSnapshot,
  apply: (payload: T) => void,
): Promise<boolean> {
  try {
    const snap = await fetchActiveSnapshot<T>(fuente);
    if (!snap) return false;
    apply(snap.payload as T);
    return true;
  } catch (err) {
    console.warn(`[snapshot] hidratación ${fuente} falló:`, err);
    return false;
  }
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
      void hidratarSeguro<unknown>("BASE_STOCK", (payload) => {
        const parsed = deserializeStockPayload(payload);
        useExcelStore.getState().setData(parsed);
      });
    }

    // FNE
    // Snapshots viejos no tienen el flag `entregado` (se introdujo con el split
    // histórico/operativo). Normalizamos: si viene undefined ⇒ false. Idempotente:
    // snapshots nuevos vienen con el flag explícito y no se tocan.
    if (!store.fne) {
      void hidratarSeguro<ParsedFNE>("FNE", (payload) => {
        const revived = reviveDates(payload);
        const registros = (revived.registros ?? []).map((r) => {
          // Si vino un snapshot viejo SIN flag entregado, lo derivamos en runtime
          // aplicando la regla canónica actual: entrega_auto_txt === "Cargado".
          // Idempotente cuando el snapshot ya trae el flag explícito.
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
        useExcelStore.getState().setFNE({ ...revived, registros, report: reportNormalizado });
      });
    }

    // Saldos
    if (!store.saldos) {
      void hidratarSeguro<ParsedSaldos>("SALDOS", (payload) => {
        useExcelStore.getState().setSaldos(reviveDates(payload));
      });
    }

    // Provisiones
    if (!store.provisiones) {
      void hidratarSeguro<ParsedProvisiones>("PROVISIONES", (payload) => {
        useExcelStore.getState().setProvisiones(reviveDates(payload));
      });
    }

    // Logística ROMA (rows)
    if (!store.logisticaRoma) {
      void hidratarSeguro<LogisticaRomaRow[]>("LOGISTICA_ROMA", (payload) => {
        useExcelStore.getState().setLogisticaRoma(reviveDates(payload));
      });
    }

    // Logística STLI (rows)
    if (!store.logisticaSTLI) {
      void hidratarSeguro<LogisticaStliRow[]>("LOGISTICA_STLI", (payload) => {
        useExcelStore.getState().setLogisticaSTLI(reviveDates(payload));
      });
    }
  }, [status]);

  return null;
}
