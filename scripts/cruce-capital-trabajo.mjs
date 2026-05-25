/**
 * CRUCE FORENSE VIN: Autos no entregados ↔ Informe Stock y Lineas
 *
 * Estrategia:
 *  1. Normalizar VINs (VIN_LIMPIO) en ambas bases.
 *  2. Construir un registry consolidado desde TODAS las hojas relevantes del
 *     archivo de stock, no solo Base_Stock.
 *  3. Match en capas: exacto → últimos 8 → últimos 6 → auxiliar (marca+modelo+
 *     fecha factura, patente, folio venta).
 *  4. Exportar XLSX con 5 hojas:
 *     - Cruce_Capital_Trabajo
 *     - VIN_No_Cruzados
 *     - Auditoria_Cruce
 *     - Base_Autos_Normalizada
 *     - Base_Stock_Normalizada
 */

import * as XLSX from "xlsx";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

// ─── Paths ────────────────────────────────────────────────────────────────
const PATH_FNE =
  "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Autos no entregados.xlsx";
const PATH_STOCK =
  "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx";
const OUT_PATH =
  "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Cruce Capital Trabajo.xlsx";

// ─── Normalizadores ────────────────────────────────────────────────────────
function limpiarVIN(raw) {
  if (raw === null || raw === undefined) return "";
  let v = String(raw);
  // Quitar TODOS los caracteres invisibles (incluye U+00A0, BOM, zero-width, etc.)
  v = v
    .replace(/[   ​-‍﻿]/g, "")
    .replace(/[\r\n\t]/g, "")
    .replace(/\s+/g, "")
    .replace(/[-_./]/g, "")
    .toUpperCase()
    .trim();
  // Quitar caracteres no alfanuméricos
  v = v.replace(/[^A-Z0-9]/g, "");
  return v;
}

function esVINValido(v) {
  // VIN moderno = 17 chars alfanuméricos, sin I, O, Q. Pero ya viene normalizado.
  return typeof v === "string" && v.length === 17 && /^[A-Z0-9]{17}$/.test(v);
}

function strOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function dateOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t) : null;
  }
  return null;
}

function fmtDate(d) {
  if (!d) return "";
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

// ─── 1) Leer FNE ─────────────────────────────────────────────────────────
console.log("[1/6] Leyendo Autos no entregados.xlsx …");
const fneWb = XLSX.read(readFileSync(PATH_FNE), { type: "buffer", cellDates: true });
const fneRowsRaw = XLSX.utils.sheet_to_json(fneWb.Sheets["ROMA"], { defval: null, raw: true });

const fneBase = fneRowsRaw.map((r, idx) => {
  const vinOrig = r.Vin ?? r.VIN ?? r["Numero VIN"] ?? null;
  return {
    rowIndex: idx + 2, // +2 = 1 header + 1 1-based
    vinOriginal: strOrNull(vinOrig),
    vinLimpio: limpiarVIN(vinOrig),
    cliente: strOrNull(r.Nombre_Cliente),
    rut: r.Rut ?? null,
    sucursal: strOrNull(r.Sucursal),
    vendedor: strOrNull(r.Nombre_Vendedor),
    cajon: strOrNull(r.Cajon),
    valorFactura: Number(r.ValorFactura) || 0,
    fechaVenta: dateOrNull(r.FechaVenta),
    fechaFactura: dateOrNull(r.FechaFactura),
    autorizacionEntrega: strOrNull(r.autorizacion_entrega),
    solEntrega: strOrNull(r.sol_entrega),
    solicitarInscripcion: strOrNull(r.SolicitarInscripcion),
    fechaPatenteRecibida: dateOrNull(r.fecha_patente_recibida),
    fechaPatenteEnviada: dateOrNull(r.fecha_patente_enviada),
    patentesAdministracion: dateOrNull(r.patentes_administracion),
    fechaInscripcion: dateOrNull(r.FechaInscripcion),
    fechaSolicitudInscripcion: dateOrNull(r.FechaSolicitudInscripcion),
    etapa: r.etapa ?? null,
    patenteVpp: strOrNull(r.PatenteVpp),
    idFolio: r.ID ?? null,
  };
});

// Estado de entrega derivado
function deriveEstado(f) {
  const has = (x) => x !== null && x !== undefined;
  const isSi = (x) => x === "Si" || x === "si";
  if (has(f.fechaPatenteRecibida)) {
    if (isSi(f.solEntrega) && isSi(f.autorizacionEntrega)) return "Listo para entregar";
    if (isSi(f.solEntrega)) return "Falta solo autorización";
    return "Patente en sucursal · falta solicitud";
  }
  if (has(f.fechaPatenteEnviada)) return "Patente en tránsito";
  if (has(f.patentesAdministracion)) return "Patente en administración";
  if (has(f.fechaInscripcion)) return "Inscrita · esperando admin";
  if (has(f.fechaSolicitudInscripcion)) return "En registro civil";
  if (isSi(f.solicitarInscripcion)) return "En control de negocios";
  return "Sin solicitud comercial";
}

console.log(`    → ${fneBase.length} registros leídos`);

// ─── 2) Leer Stock + construir registry consolidado ──────────────────────
console.log("[2/6] Leyendo Informe Stock y Lineas (50 hojas) …");
const stockWb = XLSX.read(readFileSync(PATH_STOCK), { type: "buffer", cellDates: true });

/**
 * Detector genérico: dada una hoja, identifica TODAS las columnas que parezcan
 * tener VINs. Acepta encabezados típicos + heurística por contenido.
 */
function detectarColumnasVIN(rows) {
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  const candidatos = new Set();
  const hintRegex = /vin|chasis|serie/i;
  for (const h of headers) if (hintRegex.test(h)) candidatos.add(h);
  // Heurística por contenido: si >30% de las celdas pasan esVINValido tras limpiar
  for (const h of headers) {
    if (candidatos.has(h)) continue;
    let total = 0, valid = 0;
    for (let i = 0; i < Math.min(rows.length, 200); i++) {
      const v = rows[i][h];
      if (v === null || v === undefined || v === "") continue;
      total++;
      if (esVINValido(limpiarVIN(v))) valid++;
    }
    if (total >= 10 && valid / total > 0.3) candidatos.add(h);
  }
  return [...candidatos];
}

/** Stock VIN registry: VIN_LIMPIO → array de hits (un VIN puede estar en varias hojas) */
const stockRegistry = new Map();
const stockHojaInfo = []; // para auditoría

function pushHit(hoja, columna, rowIdx, vinOrig, info) {
  const vinLimpio = limpiarVIN(vinOrig);
  if (!esVINValido(vinLimpio)) return false;
  if (!stockRegistry.has(vinLimpio)) stockRegistry.set(vinLimpio, []);
  stockRegistry.get(vinLimpio).push({
    hoja,
    columna,
    rowIdx,
    vinOriginal: strOrNull(vinOrig),
    vinLimpio,
    ...info,
  });
  return true;
}

// 2a) Base_Stock — el grueso del stock activo
{
  const ws = stockWb.Sheets["Base_Stock"];
  if (ws) {
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
    const cols = detectarColumnasVIN(rows);
    let validos = 0, duplicados = 0;
    const seen = new Set();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      // Probar todas las columnas VIN-like — prioridad: Numero VIN > Numero Chasis
      const tryOrder = ["Numero VIN", "Numero Chasis", ...cols];
      const dedup = new Set();
      for (const col of tryOrder) {
        if (!cols.includes(col) && col !== "Numero VIN" && col !== "Numero Chasis") continue;
        if (dedup.has(col)) continue;
        dedup.add(col);
        const ok = pushHit("Base_Stock", col, i + 2, r[col], {
          marca: strOrNull(r["Marca"]),
          modelo: strOrNull(r["Modelo"]),
          patente: strOrNull(r["Placa Patente"]),
          sucursal: strOrNull(r["Sucursal"]),
          bodega: strOrNull(r["Bodega"]),
          tipoStock: strOrNull(r["Tipo Stock"]),
          condicionStock: strOrNull(r["Condicion de Stock"]),
          estadoDealer: strOrNull(r["Estado Dealer"]),
          estadoAutoPro: strOrNull(r["Estado AutoPro"]),
          statusStock: strOrNull(r["Status Stock"]),
          diasStock: r["Días Stock"] ?? null,
          fechaCompra: dateOrNull(r["Fecha Compra"]),
          fechaIngreso: dateOrNull(r["Fecha Ingreso"]),
          fechaFacturacion: dateOrNull(r["Fecha Facturación"]),
          fechaVenta: dateOrNull(r["Fecha Venta"]),
          fechaVencDoc: dateOrNull(r["Vencimiento Documento"]),
          folioVenta: r["Folio Venta"] ?? null,
          cliente: strOrNull(r["Venta"]),
          costoNeto: Number(r["Total Costo"]) || 0,
          precioVentaTotal: Number(r["Precio Venta Total"]) || 0,
          vendedor: strOrNull(r["Vendedor"]),
          unidadNegocio: strOrNull(r["Unidad Negocio"]),
        });
        if (ok) {
          const k = limpiarVIN(r[col]);
          if (seen.has(k)) duplicados++;
          else seen.add(k);
          validos++;
          break; // un VIN por fila
        }
      }
    }
    stockHojaInfo.push({
      hoja: "Base_Stock",
      filas: rows.length,
      vinsValidos: validos,
      duplicados,
      columnasVIN: cols,
    });
  }
}

// 2b) Venta APC Fact VN — registro histórico de facturas VN (17K rows)
{
  const ws = stockWb.Sheets["Venta APC Fact VN"];
  if (ws) {
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
    const cols = detectarColumnasVIN(rows);
    let validos = 0;
    const seen = new Set();
    let duplicados = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const tryOrder = ["Numero VIN", "Numero Chasis", "Numero Serie"];
      let inserted = false;
      for (const col of tryOrder) {
        const ok = pushHit("Venta APC Fact VN", col, i + 2, r[col], {
          marca: strOrNull(r["Marca"]),
          modelo: strOrNull(r["Modelo"]),
          patente: strOrNull(r["Placa Patente"]),
          sucursal: strOrNull(r["Sucursal"]),
          fechaVenta: dateOrNull(r["Fecha Venta"]),
          fechaFacturacion: dateOrNull(r["Fecha Facturación"]),
          folioVenta: r["Folio Venta"] ?? null,
          folioFacturacion: r["Folio Facturación"] ?? null,
          cliente: strOrNull(r["Cliente"]),
          estadoVenta: strOrNull(r["Estado Venta"]),
          precioCompra: Number(r["Precio Compra"]) || 0,
          vendedor: strOrNull(r["Vendedor"]),
        });
        if (ok) {
          const k = limpiarVIN(r[col]);
          if (seen.has(k)) duplicados++;
          else seen.add(k);
          validos++;
          inserted = true;
          break;
        }
      }
    }
    stockHojaInfo.push({
      hoja: "Venta APC Fact VN",
      filas: rows.length,
      vinsValidos: validos,
      duplicados,
      columnasVIN: cols,
    });
  }
}

// 2c) Venta APC Fact VU — registro histórico de facturas VU
{
  const ws = stockWb.Sheets["Venta APC Fact VU"];
  if (ws) {
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
    const cols = detectarColumnasVIN(rows);
    let validos = 0;
    const seen = new Set();
    let duplicados = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const tryOrder = ["Numero VIN", "Numero Chasis", "Numero Serie"];
      for (const col of tryOrder) {
        const ok = pushHit("Venta APC Fact VU", col, i + 2, r[col], {
          marca: strOrNull(r["Marca"]),
          modelo: strOrNull(r["Modelo"]),
          patente: strOrNull(r["Placa Patente"]),
          sucursal: strOrNull(r["Sucursal"]),
          fechaVenta: dateOrNull(r["Fecha Venta"]),
          fechaFacturacion: dateOrNull(r["Fecha Facturación"]),
          folioVenta: r["Folio Venta"] ?? null,
          cliente: strOrNull(r["Cliente"]),
          estadoVenta: strOrNull(r["Estado Venta"]),
        });
        if (ok) {
          const k = limpiarVIN(r[col]);
          if (seen.has(k)) duplicados++;
          else seen.add(k);
          validos++;
          break;
        }
      }
    }
    stockHojaInfo.push({
      hoja: "Venta APC Fact VU",
      filas: rows.length,
      vinsValidos: validos,
      duplicados,
      columnasVIN: cols,
    });
  }
}

// 2d) Financiado — info de línea + vencimiento
{
  const ws = stockWb.Sheets["Financiado"];
  if (ws) {
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
    const cols = detectarColumnasVIN(rows);
    let validos = 0;
    const seen = new Set();
    let duplicados = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const ok = pushHit("Financiado", "VIN", i + 2, r["VIN"], {
        marca: strOrNull(r["Marca"]),
        modelo: strOrNull(r["Modelo"]),
        sucursal: strOrNull(r["Sucursal"]),
        cajon: strOrNull(r["Cajon"]),
        precioCompra: Number(r["Precio De Compra"]) || 0,
        tipoFinanciamiento: strOrNull(r["Tipo de Financiamiento"]),
        fechaInicioFinanciamiento: dateOrNull(r["Fecha Inicio Financiamiento"]),
        plazo: r["Plazo"] ?? null,
        fechaVencimiento: dateOrNull(r["Fecha de Vencimiento"]),
        statusFinanciamiento: strOrNull(r["Status"]),
        operacion: r["Operación"] ?? null,
        financiera: strOrNull(r["Financiera/Banco"]),
        actualmenteEnStock: strOrNull(r["Actualmente en Stock?"]),
        enLineaFlag: strOrNull(r["En linea?"]),
      });
      if (ok) {
        const k = limpiarVIN(r["VIN"]);
        if (seen.has(k)) duplicados++;
        else seen.add(k);
        validos++;
      }
    }
    stockHojaInfo.push({
      hoja: "Financiado",
      filas: rows.length,
      vinsValidos: validos,
      duplicados,
      columnasVIN: cols,
    });
  }
}

// 2e) Base Financiamiento
{
  const ws = stockWb.Sheets["Base Financiamiento"];
  if (ws) {
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
    const cols = detectarColumnasVIN(rows);
    let validos = 0;
    const seen = new Set();
    let duplicados = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const ok = pushHit("Base Financiamiento", "Numero VIN ", i + 2, r["Numero VIN "], {
        marca: strOrNull(r["Marca"]),
        version: strOrNull(r["Version"]),
        cajon: strOrNull(r["Cajon"]),
        precioCompraBruto: Number(r["Precio Compra Bruto"]) || 0,
        tipoFinanciamiento: strOrNull(r["Tipo Financiamiento"]),
        fechaInicio: dateOrNull(r["Fecha Inicio"]),
        cuotas: r["Cuotas"] ?? null,
        fechaVencimientoFin: dateOrNull(r["Fecha Vencimiento"]),
        estatusStock: strOrNull(r["Estatus Stock"]),
      });
      if (ok) {
        const k = limpiarVIN(r["Numero VIN "]);
        if (seen.has(k)) duplicados++;
        else seen.add(k);
        validos++;
      }
    }
    stockHojaInfo.push({
      hoja: "Base Financiamiento",
      filas: rows.length,
      vinsValidos: validos,
      duplicados,
      columnasVIN: cols,
    });
  }
}

console.log("    → Stock registry consolidado:");
for (const r of stockHojaInfo) {
  console.log(`      ${r.hoja.padEnd(28)} ${String(r.vinsValidos).padStart(6)} VINs (${r.duplicados} dup) [${r.columnasVIN.join(", ")}]`);
}
console.log(`      ─────────`);
console.log(`      VINs únicos en registry: ${stockRegistry.size}`);

// ─── 3) Construir índices auxiliares para match en capas ─────────────────
console.log("[3/6] Construyendo índices auxiliares …");

const idxExacto = stockRegistry; // VIN_LIMPIO → hits
const idxLast8 = new Map();
const idxLast6 = new Map();
const idxPatente = new Map();
const idxFolio = new Map();
const idxMarcaModelo = new Map(); // (marca|modelo) → hits

for (const [vinLimpio, hits] of stockRegistry) {
  const l8 = vinLimpio.slice(-8);
  const l6 = vinLimpio.slice(-6);
  if (!idxLast8.has(l8)) idxLast8.set(l8, []);
  idxLast8.get(l8).push(...hits);
  if (!idxLast6.has(l6)) idxLast6.set(l6, []);
  idxLast6.get(l6).push(...hits);
  for (const h of hits) {
    if (h.patente) {
      const p = String(h.patente).toUpperCase().replace(/\s|-/g, "");
      if (!idxPatente.has(p)) idxPatente.set(p, []);
      idxPatente.get(p).push(h);
    }
    if (h.folioVenta) {
      const f = String(h.folioVenta);
      if (!idxFolio.has(f)) idxFolio.set(f, []);
      idxFolio.get(f).push(h);
    }
    if (h.marca && h.modelo) {
      const k = `${h.marca.toUpperCase()}|${h.modelo.toUpperCase()}`;
      if (!idxMarcaModelo.has(k)) idxMarcaModelo.set(k, []);
      idxMarcaModelo.get(k).push(h);
    }
  }
}

// ─── 4) Match en capas ──────────────────────────────────────────────────
console.log("[4/6] Match en capas …");

function pickBestHit(hits, fne) {
  // Prioridad de hoja: Base_Stock > Financiado > Venta APC > Base Financiamiento
  const prio = {
    "Base_Stock": 1,
    "Financiado": 2,
    "Venta APC Fact VN": 3,
    "Venta APC Fact VU": 4,
    "Base Financiamiento": 5,
  };
  return [...hits].sort((a, b) => (prio[a.hoja] ?? 99) - (prio[b.hoja] ?? 99))[0];
}

function consolidarHits(vinLimpio) {
  const hits = stockRegistry.get(vinLimpio) ?? [];
  if (hits.length === 0) return null;
  // Consolidar info de TODAS las hojas que tengan ese VIN
  const consol = {
    hoja: hits.map((h) => h.hoja).join(" + "),
    vinLimpioStock: vinLimpio,
  };
  for (const h of hits) {
    for (const [k, v] of Object.entries(h)) {
      if (v !== null && v !== undefined && consol[k] === undefined) consol[k] = v;
    }
  }
  return consol;
}

let nExacto = 0, nLast8 = 0, nLast6 = 0, nAux = 0, nNoMatch = 0;
const cruce = [];
const noMatch = [];

for (const f of fneBase) {
  if (!esVINValido(f.vinLimpio)) {
    noMatch.push({ ...f, causa: "VIN inválido o vacío" });
    nNoMatch++;
    continue;
  }

  let hit = null;
  let estadoMatch = "";
  let confianza = "";
  let observ = "";

  // Capa 1: exacto
  if (idxExacto.has(f.vinLimpio)) {
    hit = consolidarHits(f.vinLimpio);
    estadoMatch = "Exacto";
    confianza = "Alta";
    nExacto++;
  }
  // Capa 2: últimos 8
  if (!hit) {
    const l8 = f.vinLimpio.slice(-8);
    const cands = idxLast8.get(l8) ?? [];
    if (cands.length === 1) {
      hit = consolidarHits(cands[0].vinLimpio);
      estadoMatch = "Últimos 8";
      confianza = "Media";
      observ = `Match por l8=${l8} único candidato`;
      nLast8++;
    } else if (cands.length > 1) {
      // Si la marca coincide entre uno y otro, elegir
      const byMarca = cands.filter((c) => c.marca && f.vinLimpio && true); // sin marca en FNE → no podemos filtrar
      const picked = pickBestHit(cands, f);
      if (picked) {
        hit = consolidarHits(picked.vinLimpio);
        estadoMatch = "Últimos 8";
        confianza = "Baja";
        observ = `${cands.length} candidatos por l8=${l8} — se eligió hoja ${picked.hoja}`;
        nLast8++;
      }
    }
  }
  // Capa 3: últimos 6
  if (!hit) {
    const l6 = f.vinLimpio.slice(-6);
    const cands = idxLast6.get(l6) ?? [];
    if (cands.length === 1) {
      hit = consolidarHits(cands[0].vinLimpio);
      estadoMatch = "Últimos 6";
      confianza = "Baja";
      observ = `Match por l6=${l6} único candidato`;
      nLast6++;
    } else if (cands.length > 1 && cands.length <= 3) {
      const picked = pickBestHit(cands, f);
      hit = consolidarHits(picked.vinLimpio);
      estadoMatch = "Últimos 6";
      confianza = "Baja";
      observ = `${cands.length} candidatos por l6=${l6} — se eligió hoja ${picked.hoja}`;
      nLast6++;
    }
  }
  // Capa 4: auxiliar — folio venta + patente VPP
  if (!hit && f.idFolio) {
    const cands = idxFolio.get(String(f.idFolio)) ?? [];
    if (cands.length === 1) {
      hit = consolidarHits(cands[0].vinLimpio);
      estadoMatch = "Auxiliar";
      confianza = "Baja";
      observ = `Match por Folio Venta=${f.idFolio}`;
      nAux++;
    }
  }
  if (!hit && f.patenteVpp) {
    const p = String(f.patenteVpp).toUpperCase().replace(/\s|-/g, "");
    const cands = idxPatente.get(p) ?? [];
    if (cands.length === 1) {
      hit = consolidarHits(cands[0].vinLimpio);
      estadoMatch = "Auxiliar";
      confianza = "Baja";
      observ = `Match por Patente VPP=${p} (cuidado: VPP es del usado, no del VN)`;
      nAux++;
    }
  }

  if (hit) {
    cruce.push({ fne: f, stock: hit, estadoMatch, confianza, observ });
  } else {
    // Búsqueda de candidatos parciales para mostrar
    const candL8 = (idxLast8.get(f.vinLimpio.slice(-8)) ?? []).slice(0, 3).map((h) => h.vinLimpio);
    const candL6 = (idxLast6.get(f.vinLimpio.slice(-6)) ?? []).slice(0, 3).map((h) => h.vinLimpio);
    noMatch.push({
      ...f,
      causa:
        f.vinLimpio.length !== 17
          ? `VIN largo ${f.vinLimpio.length}, debe ser 17`
          : "Sin match en ninguna hoja de stock",
      candidatosL8: candL8,
      candidatosL6: candL6,
    });
    nNoMatch++;
  }
}

console.log(`    → Exacto: ${nExacto}   Últimos 8: ${nLast8}   Últimos 6: ${nLast6}   Aux: ${nAux}   Sin match: ${nNoMatch}`);
console.log(`    → Total cruzados: ${nExacto + nLast8 + nLast6 + nAux} de ${fneBase.length} (${((nExacto + nLast8 + nLast6 + nAux) / fneBase.length * 100).toFixed(1)}%)`);

// ─── 5) Construir las hojas de output ────────────────────────────────────
console.log("[5/6] Construyendo XLSX de salida …");

function diasEntre(d1, d2) {
  if (!d1 || !d2) return null;
  return Math.floor((d2.getTime() - d1.getTime()) / 86400000);
}
const HOY = new Date("2026-05-21");

// (a) Cruce_Capital_Trabajo — fila por VIN FNE
const cruceRows = [];
for (const f of fneBase) {
  const match = cruce.find((c) => c.fne === f);
  if (!match) {
    cruceRows.push({
      "VIN original FNE": f.vinOriginal ?? "",
      "VIN_LIMPIO FNE": f.vinLimpio,
      "VIN encontrado en stock": "",
      "VIN_LIMPIO stock": "",
      "Estado Match": "No encontrado",
      "Confianza Match": "Sin match",
      "Marca": "",
      "Modelo": "",
      "Cliente": f.cliente ?? "",
      "Factura (Folio FNE)": f.idFolio ?? "",
      "Fecha factura": fmtDate(f.fechaFactura),
      "Días desde factura": diasEntre(f.fechaFactura, HOY) ?? "",
      "Estado entrega": deriveEstado(f),
      "Está en stock": "No",
      "Está en línea": "No",
      "Está pagado": "No informado",
      "Días stock": "",
      "Vencimiento financiamiento": "",
      "Responsable (vendedor FNE)": f.vendedor ?? "",
      "Observación técnica": "Sin match",
    });
    continue;
  }
  const s = match.stock;
  // Estado en stock: si tiene Base_Stock vivo, asumimos sí. Si solo está en Venta APC, ya salió.
  const enStockVivo = s.hoja.includes("Base_Stock");
  const enLinea = (s.tipoStock && /floor plan/i.test(String(s.tipoStock))) || s.enLineaFlag === "Si" || s.enLineaFlag === "SI";
  const pagado =
    s.actualmenteEnStock === "No"
      ? "Sí (entregado)"
      : s.statusFinanciamiento === "Cancelado"
        ? "Sí"
        : s.estatusStock && /pagado/i.test(s.estatusStock)
          ? "Sí"
          : "No informado";

  cruceRows.push({
    "VIN original FNE": f.vinOriginal ?? "",
    "VIN_LIMPIO FNE": f.vinLimpio,
    "VIN encontrado en stock": s.vinOriginal ?? "",
    "VIN_LIMPIO stock": s.vinLimpioStock,
    "Estado Match": match.estadoMatch,
    "Confianza Match": match.confianza,
    "Marca": s.marca ?? "",
    "Modelo": s.modelo ?? "",
    "Cliente": f.cliente ?? s.cliente ?? "",
    "Factura (Folio FNE)": f.idFolio ?? "",
    "Fecha factura": fmtDate(f.fechaFactura ?? s.fechaFacturacion),
    "Días desde factura": diasEntre(f.fechaFactura ?? s.fechaFacturacion, HOY) ?? "",
    "Estado entrega": deriveEstado(f),
    "Está en stock": enStockVivo ? "Sí" : "No",
    "Está en línea": enLinea ? "Sí" : "No",
    "Está pagado": pagado,
    "Días stock": s.diasStock ?? "",
    "Vencimiento financiamiento": fmtDate(s.fechaVencimiento ?? s.fechaVencimientoFin ?? s.fechaVencDoc),
    "Responsable (vendedor FNE)": f.vendedor ?? s.vendedor ?? "",
    "Observación técnica": `Hoja(s): ${s.hoja}${match.observ ? " | " + match.observ : ""}`,
  });
}

// (b) VIN_No_Cruzados
const noMatchRows = noMatch.map((f) => ({
  "VIN original": f.vinOriginal ?? "",
  "VIN_LIMPIO": f.vinLimpio,
  "Largo VIN": f.vinLimpio?.length ?? 0,
  "Últimos 8": f.vinLimpio?.slice(-8) ?? "",
  "Últimos 6": f.vinLimpio?.slice(-6) ?? "",
  "Marca (no FNE)": "",
  "Modelo (no FNE)": "",
  "Cliente": f.cliente ?? "",
  "Factura (Folio)": f.idFolio ?? "",
  "Sucursal": f.sucursal ?? "",
  "Fecha factura": fmtDate(f.fechaFactura),
  "Posible causa": f.causa ?? "",
  "Candidatos por últimos 8": (f.candidatosL8 ?? []).join(" | "),
  "Candidatos por últimos 6": (f.candidatosL6 ?? []).join(" | "),
}));

// (c) Auditoria_Cruce
const totalCruzados = nExacto + nLast8 + nLast6 + nAux;
const auditRows = [
  { Métrica: "Total autos no entregados", Valor: fneBase.length },
  { Métrica: "Total cruzados (todas las capas)", Valor: totalCruzados },
  { Métrica: "Porcentaje match", Valor: `${(totalCruzados / fneBase.length * 100).toFixed(2)}%` },
  { Métrica: "—", Valor: "—" },
  { Métrica: "Match exacto VIN_LIMPIO", Valor: nExacto },
  { Métrica: "Match por últimos 8 caracteres", Valor: nLast8 },
  { Métrica: "Match por últimos 6 caracteres", Valor: nLast6 },
  { Métrica: "Match auxiliar (folio / patente)", Valor: nAux },
  { Métrica: "Sin match", Valor: nNoMatch },
  { Métrica: "—", Valor: "—" },
  { Métrica: "VIN duplicados en FNE", Valor: contarDuplicadosFNE() },
  { Métrica: "VINs únicos en stock registry", Valor: stockRegistry.size },
  { Métrica: "—", Valor: "—" },
  ...stockHojaInfo.map((h) => ({
    Métrica: `Hoja: ${h.hoja}`,
    Valor: `${h.vinsValidos} VINs válidos · ${h.duplicados} duplicados · cols=[${h.columnasVIN.join(", ")}]`,
  })),
];

function contarDuplicadosFNE() {
  const seen = new Map();
  for (const f of fneBase) seen.set(f.vinLimpio, (seen.get(f.vinLimpio) ?? 0) + 1);
  return [...seen.values()].filter((n) => n > 1).length;
}

// (d) Base_Autos_Normalizada
const fneNormRows = fneBase.map((f) => ({
  "VIN original": f.vinOriginal ?? "",
  "VIN_LIMPIO": f.vinLimpio,
  "Cliente": f.cliente ?? "",
  "Rut": f.rut ?? "",
  "Sucursal": f.sucursal ?? "",
  "Vendedor": f.vendedor ?? "",
  "Folio": f.idFolio ?? "",
  "Valor Factura": f.valorFactura,
  "Fecha Venta": fmtDate(f.fechaVenta),
  "Fecha Factura": fmtDate(f.fechaFactura),
  "Estado entrega": deriveEstado(f),
  "Solicitar Inscripción": f.solicitarInscripcion ?? "",
  "Solicitud Entrega": f.solEntrega ?? "",
  "Autorización Entrega": f.autorizacionEntrega ?? "",
  "Fecha Solicitud Inscripción": fmtDate(f.fechaSolicitudInscripcion),
  "Fecha Inscripción": fmtDate(f.fechaInscripcion),
  "Patentes Administración": fmtDate(f.patentesAdministracion),
  "Fecha Patente Enviada": fmtDate(f.fechaPatenteEnviada),
  "Fecha Patente Recibida": fmtDate(f.fechaPatenteRecibida),
  "Etapa": f.etapa ?? "",
  "Patente VPP": f.patenteVpp ?? "",
}));

// (e) Base_Stock_Normalizada — un row por VIN_LIMPIO con sus hojas
const stockNormRows = [];
for (const [vinLimpio, hits] of stockRegistry) {
  const consol = consolidarHits(vinLimpio);
  stockNormRows.push({
    "VIN_LIMPIO": vinLimpio,
    "VINs originales": [...new Set(hits.map((h) => h.vinOriginal ?? ""))].join(" | "),
    "Hojas": hits.map((h) => h.hoja).join(" + "),
    "Marca": consol.marca ?? "",
    "Modelo": consol.modelo ?? "",
    "Patente": consol.patente ?? "",
    "Sucursal": consol.sucursal ?? "",
    "Bodega": consol.bodega ?? "",
    "Tipo Stock": consol.tipoStock ?? "",
    "Condición Stock": consol.condicionStock ?? "",
    "Estado Dealer": consol.estadoDealer ?? "",
    "Estado AutoPro": consol.estadoAutoPro ?? "",
    "Status Stock": consol.statusStock ?? "",
    "Días Stock": consol.diasStock ?? "",
    "Folio Venta": consol.folioVenta ?? "",
    "Fecha Compra": fmtDate(consol.fechaCompra),
    "Fecha Ingreso": fmtDate(consol.fechaIngreso),
    "Fecha Facturación": fmtDate(consol.fechaFacturacion),
    "Fecha Venta": fmtDate(consol.fechaVenta),
    "Vencimiento Doc": fmtDate(consol.fechaVencDoc),
    "Costo Neto": consol.costoNeto ?? "",
    "Precio Venta Total": consol.precioVentaTotal ?? "",
    "Tipo Financiamiento": consol.tipoFinanciamiento ?? "",
    "Fecha Vencimiento Financ": fmtDate(consol.fechaVencimiento ?? consol.fechaVencimientoFin),
    "Status Financiamiento": consol.statusFinanciamiento ?? "",
    "Financiera/Banco": consol.financiera ?? "",
    "Actualmente en Stock": consol.actualmenteEnStock ?? "",
    "En linea": consol.enLineaFlag ?? "",
    "Vendedor": consol.vendedor ?? "",
  });
}

// ─── 6) Escribir XLSX ────────────────────────────────────────────────────
const wbOut = XLSX.utils.book_new();
const addSheet = (rows, name) => {
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wbOut, ws, name);
};
addSheet(cruceRows, "Cruce_Capital_Trabajo");
addSheet(noMatchRows, "VIN_No_Cruzados");
addSheet(auditRows, "Auditoria_Cruce");
addSheet(fneNormRows, "Base_Autos_Normalizada");
addSheet(stockNormRows, "Base_Stock_Normalizada");

mkdirSync(dirname(OUT_PATH), { recursive: true });
XLSX.writeFile(wbOut, OUT_PATH);

console.log(`[6/6] Archivo escrito en:\n    ${OUT_PATH}`);
console.log("\nResumen:");
console.log(`  FNE total           : ${fneBase.length}`);
console.log(`  Cruzados            : ${totalCruzados} (${(totalCruzados / fneBase.length * 100).toFixed(2)}%)`);
console.log(`    · exacto          : ${nExacto}`);
console.log(`    · últimos 8       : ${nLast8}`);
console.log(`    · últimos 6       : ${nLast6}`);
console.log(`    · auxiliar        : ${nAux}`);
console.log(`  Sin match           : ${nNoMatch}`);
console.log(`  VINs únicos stock   : ${stockRegistry.size}`);
