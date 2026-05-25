/**
 * Auditoría de calidad de datos cross-fuente.
 *
 * Detecta inconsistencias sin corregir. Solo visibiliza para que el área
 * pueda actuar manualmente.
 */

import type {
  AutoNoEntregado,
  ParsedExcel,
  ParsedFNE,
  ParsedSaldos,
  SaldoRegistro,
  Vehiculo,
} from "../types";
import { limpiarVIN } from "../parser/venta-apc";
import { limpiarCajon } from "../parser/saldos";

export interface VINDuplicado {
  vinLimpio: string;
  cuenta: number;
  fuente: "Base_Stock" | "FNE" | "Saldos";
  detalles: string[]; // patente o cliente o sucursal
}

export interface CajonAmbiguo {
  cajon: string;
  vins: string[];
  fuentes: string[];
}

export interface VINInvalido {
  fuente: string;
  valorOriginal: string;
  valorLimpio: string;
  problema: string;
}

export interface AuditoriaCalidad {
  vinDuplicadosStock: VINDuplicado[];
  vinDuplicadosFNE: VINDuplicado[];
  vinDuplicadosSaldos: VINDuplicado[];
  cajonesAmbiguos: CajonAmbiguo[];
  vinsInvalidos: VINInvalido[];
  saldosVehiculoSinCajon: SaldoRegistro[];
  /** Para visualizar el estado del sistema. */
  archivosCargados: {
    stock: { cargado: boolean; fechaCorte: Date | null; vehiculos: number };
    fne: { cargado: boolean; archivoNombre: string | null; registros: number };
    saldos: { cargado: boolean; archivoNombre: string | null; registros: number };
  };
}

function vinPareceValido(v: string): boolean {
  return v.length === 17 && /^[A-Z0-9]{17}$/.test(v);
}

export function auditarCalidadDatos(
  data: ParsedExcel | null,
  fne: ParsedFNE | null,
  saldos: ParsedSaldos | null,
): AuditoriaCalidad {
  const out: AuditoriaCalidad = {
    vinDuplicadosStock: [],
    vinDuplicadosFNE: [],
    vinDuplicadosSaldos: [],
    cajonesAmbiguos: [],
    vinsInvalidos: [],
    saldosVehiculoSinCajon: [],
    archivosCargados: {
      stock: {
        cargado: !!data,
        fechaCorte: data?.report.fechaCorteExcel ?? null,
        vehiculos: data?.vehiculos.length ?? 0,
      },
      fne: {
        cargado: !!fne,
        archivoNombre: fne?.report.archivoNombre ?? null,
        registros: fne?.registros.length ?? 0,
      },
      saldos: {
        cargado: !!saldos,
        archivoNombre: saldos?.report.archivoNombre ?? null,
        registros: saldos?.registros.length ?? 0,
      },
    },
  };

  // Duplicados VIN en stock
  if (data) {
    const counts = new Map<string, Vehiculo[]>();
    for (const v of data.vehiculos) {
      const k = limpiarVIN(v.vin);
      if (!k) {
        out.vinsInvalidos.push({
          fuente: "Base_Stock",
          valorOriginal: String(v.vin ?? ""),
          valorLimpio: k,
          problema: "VIN vacío tras normalización",
        });
        continue;
      }
      if (!vinPareceValido(k)) {
        out.vinsInvalidos.push({
          fuente: "Base_Stock",
          valorOriginal: String(v.vin ?? ""),
          valorLimpio: k,
          problema: `Largo ${k.length}, esperado 17`,
        });
        continue;
      }
      if (!counts.has(k)) counts.set(k, []);
      counts.get(k)!.push(v);
    }
    for (const [vin, arr] of counts) {
      if (arr.length > 1) {
        out.vinDuplicadosStock.push({
          vinLimpio: vin,
          cuenta: arr.length,
          fuente: "Base_Stock",
          detalles: arr.map((v) => `${v.sucursal ?? "—"} · ${v.patente ?? "sin patente"}`),
        });
      }
    }
  }

  // Duplicados VIN en FNE
  if (fne) {
    const counts = new Map<string, AutoNoEntregado[]>();
    for (const r of fne.registros) {
      const k = limpiarVIN(r.vin);
      if (!k || !vinPareceValido(k)) {
        out.vinsInvalidos.push({
          fuente: "FNE",
          valorOriginal: String(r.vin ?? ""),
          valorLimpio: k,
          problema: !k ? "VIN vacío" : `Largo ${k.length}`,
        });
        continue;
      }
      if (!counts.has(k)) counts.set(k, []);
      counts.get(k)!.push(r);
    }
    for (const [vin, arr] of counts) {
      if (arr.length > 1) {
        out.vinDuplicadosFNE.push({
          vinLimpio: vin,
          cuenta: arr.length,
          fuente: "FNE",
          detalles: arr.map((r) => `${r.sucursal ?? "—"} · ${r.cliente ?? "—"}`),
        });
      }
    }
  }

  // Duplicados / sin Cajón en Saldos
  if (saldos) {
    const cajonCounts = new Map<string, SaldoRegistro[]>();
    for (const s of saldos.registros) {
      if (s.categoria !== "vehiculo") continue;
      if (!s.cajonLimpio || s.cajonLimpio.length < 6) {
        out.saldosVehiculoSinCajon.push(s);
        continue;
      }
      if (!cajonCounts.has(s.cajonLimpio)) cajonCounts.set(s.cajonLimpio, []);
      cajonCounts.get(s.cajonLimpio)!.push(s);
    }
    for (const [cajon, arr] of cajonCounts) {
      if (arr.length > 1) {
        // Si el VIN resuelto es distinto entre los hits, es ambiguo
        const vins = new Set(arr.map((s) => s.vinResuelto).filter(Boolean) as string[]);
        if (vins.size > 1) {
          out.cajonesAmbiguos.push({
            cajon,
            vins: [...vins],
            fuentes: ["Saldos"],
          });
        }
      }
    }
  }

  return out;
}
