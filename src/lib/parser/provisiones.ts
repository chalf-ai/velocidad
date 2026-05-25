/**
 * Parser de "Provisiones al 18 de Mayo.xlsx" — fuente oficial del módulo
 * Provisiones / Capital de trabajo no facturado.
 *
 * Una sola hoja "ROMA" con 1,893 registros. No tiene VIN/Cajón — la llave
 * de gestión se construye desde `ID` como `PROV-{ID}`.
 *
 * Clasificación operacional:
 *   - no_facturada  → universo activo, consume capital, KPIs + gestión.
 *   - facturada     → fuera del módulo, referencia secundaria.
 *   - revision_manual → EstadoAjuste pendiente o saldo negativo raro.
 */

import * as XLSX from "xlsx";
import type {
  AgingProvision,
  AreaProvision,
  EstadoProvision,
  ParsedProvisiones,
  ProvisionRegistro,
} from "../types";

const SHEET_NAME = "ROMA";

function s(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t.length === 0 ? null : t;
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function nOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function d(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t) : null;
  }
  return null;
}

function classifyEstado(montoFactura: number, estadoAjuste: string | null): EstadoProvision {
  // Revisión manual tiene prioridad — un ajuste pendiente bloquea la clasificación
  // financiera por más que ya tenga factura.
  if (estadoAjuste && /pendiente/i.test(estadoAjuste)) return "revision_manual";
  if (montoFactura > 0) return "facturada";
  return "no_facturada";
}

function classifyArea(concepto: string | null, motivo: string | null): AreaProvision {
  const txt = `${concepto ?? ""} ${motivo ?? ""}`;
  return /post\s*vent/i.test(txt) ? "postventa" : "ventas";
}

function agingBucket(dias: number | null): AgingProvision {
  if (dias === null || !Number.isFinite(dias)) return "sin_fecha";
  if (dias <= 30) return "0-30";
  if (dias <= 60) return "31-60";
  if (dias <= 90) return "61-90";
  if (dias <= 180) return "91-180";
  return "180+";
}

export async function parseProvisionesFile(file: File): Promise<ParsedProvisiones> {
  const t0 = performance.now();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, {
    type: "array",
    cellDates: true,
    cellStyles: false,
  });
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) {
    throw new Error(
      `No se encontró la hoja "${SHEET_NAME}" en el archivo. Hojas disponibles: ${wb.SheetNames.join(", ")}`,
    );
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: null,
    raw: true,
  });

  // Fecha "hoy" para aging — usamos la mayor fechaCreacion del archivo como
  // proxy de fecha de corte. Más robusto que asumir new Date() porque los
  // archivos pueden cargarse meses después del corte oficial.
  const fechasValidas: Date[] = [];
  for (const r of rows) {
    const dt = d(r["fechaCreacion"]);
    if (dt) fechasValidas.push(dt);
  }
  const fechaCorte = fechasValidas.length
    ? new Date(Math.max(...fechasValidas.map((x) => x.getTime())))
    : new Date();

  const registros: ProvisionRegistro[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const id = nOrNull(r["ID"]);
    if (id === null) continue; // descarta filas sin ID — no se pueden gestionar

    const fechaCreacion = d(r["fechaCreacion"]);
    const montoFactura = num(r["montoFactura"]);
    const estadoAjuste = s(r["EstadoAjuste"]);
    const concepto = s(r["Concepto"]);
    const motivo = s(r["motivo"]);

    const estado = classifyEstado(montoFactura, estadoAjuste);
    const area = classifyArea(concepto, motivo);
    const agingDias = fechaCreacion
      ? Math.floor((fechaCorte.getTime() - fechaCreacion.getTime()) / 86400000)
      : null;

    registros.push({
      rowIndex: i + 2,
      id,
      fechaCreacion,
      solicitante: s(r["Solicitante"]),
      razonSocial: s(r["RazonSocial"]),
      periodo: s(r["periodo"]),
      concepto,
      origen: s(r["Origen"]),
      tipo: s(r["tipo"]),
      motivo,
      estadoArchivo: s(r["Estado"]),
      montoProvision: num(r["montoProvision"]),
      montoFactura,
      saldo: num(r["saldo"]),
      ultimaFechaFactura: d(r["ultima_fecha_factura"]),
      estadoConta: nOrNull(r["estado_conta"]),
      estadoAjuste,
      notificarConta: nOrNull(r["notificar_conta"]),
      estado,
      area,
      agingDias,
      agingBucket: agingBucket(agingDias),
      claveGestion: `PROV-${id}`,
    });
  }

  return {
    registros,
    report: {
      archivoNombre: file.name,
      archivoSize: file.size,
      fechaCarga: new Date(),
      filasTotales: rows.length,
      filasProcesadas: registros.length,
      filasOmitidas: rows.length - registros.length,
      durMs: Math.round(performance.now() - t0),
    },
  };
}
