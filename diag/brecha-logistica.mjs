#!/usr/bin/env node
/**
 * Brecha viejo vs nuevo: Logistica + Diciembre-Mayo ROMA  ↔  SCHIAPP + KAR.
 *
 * Para cada hito del timeline FNE responde:
 *   - ¿qué columna lo alimentaba en el modelo viejo?
 *   - ¿qué columna lo alimentaría en SCHIAPP / KAR?
 *   - ¿cuántos VINs del universo FNE operativo (854) tienen esa columna poblada
 *     en cada uno de los dos archivos nuevos?
 *
 * Cierra con un dump completo del VIN VR3KAHPY3VS000844 en SCHIAPP y KAR.
 */
import XLSX from "xlsx";

const BASE = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive";
const F_ACTAS = `${BASE}/Actas al 28 de Mayo.xlsx`;
const F_SCHIAPP = `${BASE}/SCHIAPPCASSE 28 de Mayo.xlsx`;
const F_KAR = `${BASE}/KAR-LOGISTICS 28 de Mayo.xlsx`;
const VIN_FOCO = "VR3KAHPY3VS000844";

function norm(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s.toUpperCase();
}
function isPopulated(v) {
  if (v === null || v === undefined || v === "") return false;
  if (v === 0 || v === "0") return false;
  return true;
}

// 1) Universo FNE operativo (854 VINs)
const wbActas = XLSX.readFile(F_ACTAS, { cellDates: true });
const rowsActas = XLSX.utils.sheet_to_json(wbActas.Sheets["ROMA"], { defval: null, raw: true });
const fneOperativos = new Set();
for (const r of rowsActas) {
  if (!r["Vin"]) continue;
  const t = String(r["entrega_auto_txt"] ?? "").trim();
  if (t !== "Cargado") fneOperativos.add(norm(r["Vin"]));
}
console.log("════════════════════════════════════════════════════════════════════════════════");
console.log("  BRECHA viejo vs nuevo — mapeo de hitos timeline FNE");
console.log("════════════════════════════════════════════════════════════════════════════════");
console.log(`  Universo FNE operativo (referencia): ${fneOperativos.size}`);
console.log("");

// 2) Cargar Schiapp y KAR, indexar por VIN para acceso rápido
function loadByVin(file, sheetVinCol) {
  const wb = XLSX.readFile(file, { cellDates: true });
  const out = {};
  for (const [sheet, vinCol] of Object.entries(sheetVinCol)) {
    const ws = wb.Sheets[sheet];
    if (!ws) { out[sheet] = new Map(); continue; }
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
    const m = new Map();
    for (const r of rows) {
      const v = norm(r[vinCol]);
      if (v) m.set(v, r);
    }
    out[sheet] = m;
  }
  return out;
}

const schiapp = loadByVin(F_SCHIAPP, {
  "Compra Marca": "VIN",
  "Almacenamiento ": "VIN",
  "Distribución": "VIN",
  "ENTRADAS": "VIN",
  "SALIDAS": "VIN",
  "Solicitud Venta": "Vin",
  "Solicitud Vitrina": "vin",
});
const kar = loadByVin(F_KAR, {
  "Compras Marca": "VIN",
  "Almacenamiento": "VIN",
  "Distribucion": "VIN",
  "ENTRADAS": "VIN",
  "SALIDAS": "VIN",
  "Solicitud Venta": "Vin",
  "Solicitud Vitrina": "vin",
});

// 3) Helper: cuántos VINs de fneOperativos tienen X campo poblado en hoja Y
function coverage(sheetMap, colName) {
  let c = 0;
  for (const vin of fneOperativos) {
    const r = sheetMap.get(vin);
    if (r && isPopulated(r[colName])) c++;
  }
  return c;
}

// 4) Tabla brecha: hito → fuente vieja → candidato nuevo → cobertura FNE
const brecha = [
  {
    hito: "solicitud_vendedor",
    viejoFuente: "Diciembre-Mayo ROMA",
    viejoCol: "FechaSolicitud",
    nuevoCandidatos: [
      { archivo: "SCHIAPP", hoja: "Solicitud Venta", col: "FechaSolicitud" },
      { archivo: "SCHIAPP", hoja: "Distribución",    col: "Fecha de solicitud" },
      { archivo: "KAR",     hoja: "Solicitud Venta", col: "FechaSolicitud" },
      { archivo: "KAR",     hoja: "Distribucion",    col: "Fecha  Solicitud" },
    ],
  },
  {
    hito: "respuesta_logistica",
    viejoFuente: "Diciembre-Mayo ROMA",
    viejoCol: "fecha_RespuestaGestionLogistica",
    nuevoCandidatos: [
      { archivo: "SCHIAPP", hoja: "Solicitud Venta", col: "PasoActual" },
      { archivo: "KAR",     hoja: "Solicitud Venta", col: "FechaAdjunto" },
    ],
  },
  {
    hito: "ingreso_apc",
    viejoFuente: "Logistica.xlsx",
    viejoCol: "Fecha Ingreso APC",
    nuevoCandidatos: [
      { archivo: "SCHIAPP", hoja: "Almacenamiento ", col: "1° dia Almacenaje en bodega" },
      { archivo: "KAR",     hoja: "Almacenamiento",  col: "1° dia Almacenaje en bodega" },
      { archivo: "KAR",     hoja: "Distribucion",    col: "1° dia Almacenaje" },
    ],
  },
  {
    hito: "solicitud_bodega",
    viejoFuente: "Logistica.xlsx",
    viejoCol: "Fecha de solicitud a STLI",
    nuevoCandidatos: [
      { archivo: "SCHIAPP", hoja: "Distribución",  col: "Fecha de solicitud" },
      { archivo: "KAR",     hoja: "Distribucion",  col: "Fecha  Solicitud" },
    ],
  },
  {
    hito: "planificacion_despacho",
    viejoFuente: "Logistica.xlsx",
    viejoCol: "Fecha Planificacion STLI",
    nuevoCandidatos: [
      { archivo: "SCHIAPP", hoja: "Distribución",  col: "Fecha teorica STLI" },
      { archivo: "KAR",     hoja: "Distribucion",  col: "Fecha limite" },
    ],
  },
  {
    hito: "despacho",
    viejoFuente: "Logistica.xlsx",
    viejoCol: "Fecha despacho a sucursal",
    nuevoCandidatos: [
      { archivo: "SCHIAPP", hoja: "Distribución",  col: "Fecha despacho a sucursal" },
      { archivo: "KAR",     hoja: "Distribucion",  col: "Fecha despacho a sucursal" },
      { archivo: "SCHIAPP", hoja: "SALIDAS",       col: "Fecha Sal" },
      { archivo: "KAR",     hoja: "SALIDAS",       col: "Fecha Salida" },
    ],
  },
  {
    hito: "llegada_sucursal",
    viejoFuente: "Diciembre-Mayo ROMA",
    viejoCol: "FechaETASucursal",
    nuevoCandidatos: [
      { archivo: "SCHIAPP", hoja: "Solicitud Venta", col: "FechaEstimadaLLegadaSucursal_Calculo" },
      { archivo: "KAR",     hoja: "Solicitud Venta", col: "FechaEstimadaLLegadaSucursal_Calculo" },
      { archivo: "KAR",     hoja: "ENTRADAS",        col: "Fecha Entrada" },
      { archivo: "SCHIAPP", hoja: "ENTRADAS",        col: "Fecha Ent" },
    ],
  },
  {
    hito: "entrega_comprometida",
    viejoFuente: "Diciembre-Mayo ROMA",
    viejoCol: "FechaEstimadaEntrega",
    nuevoCandidatos: [
      { archivo: "SCHIAPP", hoja: "Solicitud Venta", col: "FechaEstimadaEntrega" },
      { archivo: "KAR",     hoja: "Solicitud Venta", col: "FechaEstimadaEntrega" },
    ],
  },
];

console.log("  Tabla brecha — cobertura sobre 854 FNE operativos:");
console.log("");
for (const b of brecha) {
  console.log(`  ─── HITO: ${b.hito} ───`);
  console.log(`      VIEJO  ${b.viejoFuente}  →  ${b.viejoCol}`);
  console.log(`      CANDIDATOS NUEVOS:`);
  for (const c of b.nuevoCandidatos) {
    const map = c.archivo === "SCHIAPP" ? schiapp[c.hoja] : kar[c.hoja];
    const cob = map ? coverage(map, c.col) : 0;
    const pct = (cob / fneOperativos.size * 100).toFixed(1);
    console.log(`        ${c.archivo.padEnd(8)} ${c.hoja.padEnd(20)} ${c.col.padEnd(40)} cobertura ${String(cob).padStart(3)}/854 (${pct}%)`);
  }
  console.log("");
}

// 5) Cobertura FNE total — VIN aparece en al menos UNA hoja del archivo
function inAny(maps, vin) {
  for (const m of Object.values(maps)) {
    if (m.has(vin)) return true;
  }
  return false;
}
let inSchiapp = 0;
let inKar = 0;
let inAmbos = 0;
let inNada = 0;
for (const vin of fneOperativos) {
  const a = inAny(schiapp, vin);
  const b = inAny(kar, vin);
  if (a) inSchiapp++;
  if (b) inKar++;
  if (a && b) inAmbos++;
  if (!a && !b) inNada++;
}
console.log("  COBERTURA FNE en archivos nuevos:");
console.log(`    En SCHIAPP (cualquier hoja):  ${inSchiapp} de 854 (${(inSchiapp / 854 * 100).toFixed(1)}%)`);
console.log(`    En KAR     (cualquier hoja):  ${inKar} de 854 (${(inKar / 854 * 100).toFixed(1)}%)`);
console.log(`    En AMBOS                    : ${inAmbos}`);
console.log(`    En NINGUNO (sin track)      : ${inNada} ⚠`);
console.log("");

// 6) Dump VIN específico
console.log("════════════════════════════════════════════════════════════════════════════════");
console.log(`  VIN FOCO: ${VIN_FOCO}`);
console.log("════════════════════════════════════════════════════════════════════════════════");
function dumpVinIn(file, label, maps) {
  console.log(`\n  ${label}:`);
  let found = false;
  for (const [sheet, map] of Object.entries(maps)) {
    const r = map.get(VIN_FOCO);
    if (!r) { console.log(`    ${sheet.padEnd(20)} → no figura`); continue; }
    found = true;
    console.log(`    ${sheet.padEnd(20)} → FILA ENCONTRADA:`);
    for (const [k, v] of Object.entries(r)) {
      const display = v === null || v === undefined ? "null" : v instanceof Date ? v.toISOString() : String(v);
      const isEmpty = v === null || v === undefined || v === "" || v === 0 || v === "0";
      const marker = isEmpty ? "  (vacío)" : "";
      console.log(`         ${k.padEnd(36)}  ${display.slice(0, 60).padEnd(60)}${marker}`);
    }
  }
  if (!found) console.log(`    (VIN no aparece en ninguna hoja de ${label})`);
}
dumpVinIn(F_SCHIAPP, "SCHIAPPACASSE", schiapp);
dumpVinIn(F_KAR, "KAR-LOGISTICS", kar);

console.log("\n════════════════════════════════════════════════════════════════════════════════");
