/**
 * Parser de "Reportes Saldos 2.0" — fuente oficial del módulo Saldos /
 * Capital de Trabajo no-vehicular.
 *
 * Estructura: una hoja relevante "FUSION BD 3.0" con ~1,761 registros.
 * Mezcla 3 categorías: vehículos (cruzan VIN), bonos/comisiones (facturas
 * administrativas), servicios (post-venta, no son venta — se excluyen del
 * módulo de capital de trabajo de ventas).
 */

import * as XLSX from "xlsx";
import type {
  CategoriaSaldo,
  EmpresaPompeyo,
  ParsedSaldos,
  SaldoRegistro,
  StatusDPS,
  SubTipoSaldoVehiculo,
} from "../types";

const SHEET_NAME = "FUSION BD 3.0";

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

function dt(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t) : null;
  }
  return null;
}

export function limpiarCajon(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw)
    .replace(/\s+/g, "")
    .replace(/[-_./]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Patente chilena: 6 chars, formato AAAA00 / AA0000 / mezcla. */
const RE_PATENTE_CL = /^[A-Z]{4}[0-9]{2}$|^[A-Z]{2}[0-9]{4}$|^[A-Z]{2}[A-Z0-9]{4}$/;
export function pareceePatente(cajonLimpio: string): boolean {
  return cajonLimpio.length === 6 && RE_PATENTE_CL.test(cajonLimpio);
}

function categorizar(rawCat: string | null, rawTipo: string | null): CategoriaSaldo {
  const c = (rawCat ?? "").toUpperCase();
  if (c.includes("VEHICULO") || c.startsWith("1 ")) return "vehiculo";
  if (c.includes("BONO") || c.includes("INCENTIVO") || c.includes("COMISION") || c.startsWith("2 "))
    return "bono_comision";
  if (c.includes("SERVICIO") || c.startsWith("3 ")) return "servicio";
  // Fallback por subtipo (a veces solo viene "Tipo")
  const t = (rawTipo ?? "").toUpperCase();
  if (/^1\./.test(t)) return "vehiculo";
  if (/^2\./.test(t)) return "bono_comision";
  if (/^3\./.test(t)) return "servicio";
  return "desconocido";
}

const SUBTIPO_VEHICULO_BY_PREFIX: Record<string, SubTipoSaldoVehiculo> = {
  "1.1": "financieras",
  "1.2": "leasing",
  "1.3": "seguros",
  "1.4": "flotas",
  "1.5": "traspasos_dealer",
  "1.6": "credito_pompeyo",
  "1.7": "judicial",
  "1.9": "buy_back",
  "2.2": "acuerdo_comercial",
  "2.3": "oc_marca",
};

export function subTipoVehiculo(tipoRaw: string | null): SubTipoSaldoVehiculo {
  if (!tipoRaw) return "indefinido";
  const m = tipoRaw.match(/^\s*(\d+\.\d+)/);
  if (m && SUBTIPO_VEHICULO_BY_PREFIX[m[1]]) return SUBTIPO_VEHICULO_BY_PREFIX[m[1]];
  const u = tipoRaw.toUpperCase();
  if (/FINANCIER/.test(u)) return "financieras";
  if (/LEASING/.test(u)) return "leasing";
  if (/SEGURO/.test(u)) return "seguros";
  if (/FLOTA/.test(u)) return "flotas";
  if (/TRASPASO/.test(u)) return "traspasos_dealer";
  if (/CREDITO POMPEYO|CRÉDITO POMPEYO/.test(u)) return "credito_pompeyo";
  if (/JUDICIAL/.test(u)) return "judicial";
  if (/BUY ?BACK/.test(u)) return "buy_back";
  if (/ACUERDO COMERCIAL/.test(u)) return "acuerdo_comercial";
  if (/OC MARCA/.test(u)) return "oc_marca";
  return "indefinido";
}

/**
 * Subtipo de saldo vehículo · cruzando `Tipo` con `Entidad Financiera`.
 *
 * Decisión usuario 2026-06 tras auditoría:
 * El reporte oficial PC Spa clasifica como Crédito Pompeyo todos los
 * registros donde la `Entidad Financiera` es "Credito Pompeyo",
 * INDEPENDIENTE del `Tipo` que declare el archivo. El parser viejo solo
 * miraba `Tipo` y dejaba ~45 registros KIA mal clasificados en
 * Financieras (Tipo 1.1) cuando realmente eran CP (Entidad Financiera CP).
 *
 * Regla canónica:
 *   1. Si Entidad Financiera (normalizada) === "CREDITO POMPEYO" → credito_pompeyo
 *   2. Si no, caer a la clasificación por `Tipo` (subTipoVehiculo).
 *
 * Esto alinea el sistema con el Excel oficial al 92% (~6 registros de
 * diferencia residual, probablemente noise del proceso manual del Excel).
 */
export function subTipoVehiculoCanonico(
  tipoRaw: string | null,
  entidadFinanciera: string | null,
): SubTipoSaldoVehiculo {
  const ef = (entidadFinanciera ?? "").trim().toUpperCase();
  if (ef === "CREDITO POMPEYO" || ef === "CRÉDITO POMPEYO") {
    return "credito_pompeyo";
  }
  return subTipoVehiculo(tipoRaw);
}

function statusFromString(raw: string | null): StatusDPS {
  if (!raw) return "Desconocido";
  const u = raw.toUpperCase();
  if (u.includes("POR VENCER")) return "Por Vencer";
  if (u.startsWith("T1")) return "T1";
  if (u.startsWith("T2")) return "T2";
  if (u.startsWith("T3")) return "T3";
  if (u.startsWith("T4")) return "T4";
  if (u.startsWith("T5")) return "T5";
  if (u.startsWith("T6")) return "T6";
  if (u.startsWith("T7")) return "T7";
  return "Desconocido";
}

function empresaFrom(raw: string | null): EmpresaPompeyo {
  if (!raw) return "Desconocido";
  const u = raw.toUpperCase();
  if (u.includes("AUTOMOVILES") || u.includes("AUTOMÓVILES") || u.includes("PC AUTOMOV"))
    return "PC Automoviles";
  if (u.includes("SPA") || u === "PC SPA") return "PC Spa";
  return "Desconocido";
}

export async function parseSaldosFile(file: File): Promise<ParsedSaldos> {
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

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: null,
    raw: true,
  });
  // Los headers del archivo traen espacios alrededor (" Empresa ", " Financiera ",
  // " C.Pompeyo "). El parser leía r[" Empresa"] (solo espacio inicial) → undefined
  // → empresa "Desconocido" y financiera/CP en 0 para TODAS las filas. Normalizamos
  // (trim) todas las keys una vez para leerlas de forma fiable por nombre limpio.
  const rows = rawRows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) o[k.trim()] = v;
    return o;
  });

  const registros: SaldoRegistro[] = [];
  let cajonesSinFormato = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const categoriaRaw = s(r["CATEGORIA"]);
    const tipoRaw = s(r["Tipo"]);
    const entidadFinancieraRaw = s(r["Entidad Financiera"]) ?? s(r["Entidad"]) ?? s(r["Financiera"]);
    const categoria = categorizar(categoriaRaw, tipoRaw);
    const cajonRaw = s(r["Cajon"]);
    const cajonLimpio = limpiarCajon(cajonRaw);

    // Determinar subtipo según categoría · vehiculo cruza Tipo con Entidad
    // Financiera (CP "disfrazado" de Financiera) — ver subTipoVehiculoCanonico.
    let subTipo: string = "indefinido";
    if (categoria === "vehiculo") subTipo = subTipoVehiculoCanonico(tipoRaw, entidadFinancieraRaw);
    else if (categoria === "bono_comision") {
      const u = (tipoRaw ?? "").toUpperCase();
      if (u.includes("COMISION")) subTipo = "comisiones";
      else if (u.includes("INCENTIVO")) subTipo = "incentivos";
      else if (u.includes("BONO")) subTipo = "bonos";
      else subTipo = tipoRaw ?? "indefinido";
    } else {
      subTipo = tipoRaw ?? "indefinido";
    }

    if (categoria === "vehiculo" && cajonLimpio.length === 0) cajonesSinFormato++;

    // cPompeyoCLP (alimenta score vía vu.creditoPompeyo): se mantiene la regla
    // existente — el CP "fuerte" vive en "Saldo x Documentar" del subTipo 1.6
    // Crédito Pompeyo. (Antes el `else` leía " C.Pompeyo" con key mal formada y
    // daba 0; ahora explícito 0 para NO cambiar el score.)
    const subTipoEsCreditoPompeyo =
      categoria === "vehiculo" && subTipo === "credito_pompeyo";
    const cPompeyoCLP = subTipoEsCreditoPompeyo ? num(r["Saldo x Documentar"]) : 0;

    registros.push({
      rowIndex: i + 2,
      categoria,
      subTipo,
      empresa: empresaFrom(s(r[" Empresa"]) ?? s(r["Empresa"])),
      tipoRaw,
      categoriaRaw,
      cajon: cajonRaw,
      cajonLimpio: cajonLimpio || null,
      vinResuelto: null, // se llena en el selector tras bridge
      patente: pareceePatente(cajonLimpio) ? cajonLimpio : null,
      marca: s(r["Marca"]),
      modelo: s(r["Modelo"]),
      cliente: s(r["Cliente"]),
      rutCliente: s(r["Rut Cliente"]) ?? s(r["Rut_Cliente"]),
      numNota: (r["N° Nota"] as string | number | null) ?? null,
      numeroFactura: (r["Número factura"] as string | number | null) ?? null,
      sucursal: s(r["Sucursal"]) ?? s(r["Sucursales"]),
      vendedor: s(r["Vendedor"]),
      saldoXDocumentar: num(r["Saldo x Documentar"]),
      financieraCLP: num(r["Financiera"]),
      cPompeyoCLP,
      // Columna " C.Pompeyo " real (composición del saldo) — SOLO display, no
      // alimenta el score. Antes se perdía por el header con espacios.
      cPompeyoColCLP: num(r["C.Pompeyo"]),
      entidadFinanciera: s(r["Entidad Financiera"]) ?? s(r["Entidad"]) ?? s(r["Financiera"]),
      origen: s(r["Origen"]),
      fechaVenta: dt(r["Fecha Venta"]),
      fechaVencimiento: dt(r["Fecha de vencimiento"]) ?? dt(r["Fecha c-recep"]),
      fchPago: dt(r["Fch_Pago"]),
      diasArchivo: typeof r["Días"] === "number" ? (r["Días"] as number) : null,
      statusDPS: statusFromString(s(r["Status"])),
      statusRaw: s(r["Status"]),
      estadoPago: s(r["E°_Pago"]),
      estadoEntrega: s(r["E°entrega"]),
      entregado: s(r[" Entregado"]) ?? s(r["Entregado"]),
      inscrito: s(r[" Inscrito"]) ?? s(r["Inscrito"]),
      clasificacionSalvin: s(r["CLASIFICASIÓN SALVIN"]) ?? s(r["Clasiicación"]),
      comentariosFinanzas: s(r["COMENTARIOS FINANZAS"]),
      numOperacion: s(r["N° OPERACIÓN"]),
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
      cajonesSinFormato,
      durMs: Math.round(performance.now() - t0),
    },
  };
}
