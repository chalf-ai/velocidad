#!/usr/bin/env node
/**
 * ANÁLISIS DE RELACIONES — siguiendo el VIN como llave maestra.
 *
 * Cruza:
 *  - SCHIAPPACASSE vs KAR-LOGISTICS (mismo VIN en ambas bodegas?)
 *  - Logística (Schiapp + Kar combinados) vs Actas al 28 de Mayo (universo FNE + entregados)
 *  - VINs únicos por etapa del flujo (Compra → Almacén → Distribución → Salida)
 *  - Cobertura cruzada
 */
import XLSX from "xlsx";
import path from "node:path";

const BASE = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive";
const F_SCHIAPP = `${BASE}/SCHIAPPCASSE 28 de Mayo.xlsx`;
const F_KAR = `${BASE}/KAR-LOGISTICS 28 de Mayo.xlsx`;
const F_ACTAS = `${BASE}/Actas al 28 de Mayo.xlsx`;

function norm(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s.toUpperCase();
}

function extractVins(wb, sheetName, colName, headerOffset = 0) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return new Set();
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true, range: headerOffset });
  const set = new Set();
  for (const r of rows) {
    const v = norm(r[colName]);
    if (v) set.add(v);
  }
  return set;
}

function loadVinsBySheet(file, sheetVinCol) {
  const wb = XLSX.readFile(file, { cellDates: true });
  const map = {};
  for (const [sheet, col] of Object.entries(sheetVinCol)) {
    map[sheet] = extractVins(wb, sheet, col);
  }
  return { wb, sheets: map };
}

console.log("════════════════════════════════════════════════════════════════════════════════");
console.log("  RELACIONES — Flujo VIN cross-archivo");
console.log("════════════════════════════════════════════════════════════════════════════════");

// ─────────────── SCHIAPPACASSE ───────────────
const schiapp = loadVinsBySheet(F_SCHIAPP, {
  "Compra Marca": "VIN",
  "Almacenamiento ": "VIN",
  "Distribución": "VIN",
  "ENTRADAS": "VIN",
  "SALIDAS": "VIN",
  "Solicitud Venta": "Vin",
  "Solicitud Vitrina": "vin",
});

console.log("\n  SCHIAPPACASSE — VINs únicos por hoja:");
for (const [k, s] of Object.entries(schiapp.sheets)) {
  console.log(`    ${k.padEnd(25)} ${String(s.size).padStart(6)} VINs`);
}

// ─────────────── KAR-LOGISTICS ───────────────
const kar = loadVinsBySheet(F_KAR, {
  "Compras Marca": "VIN",
  "Almacenamiento": "VIN",
  "Distribucion": "VIN",
  "ENTRADAS": "VIN",
  "SALIDAS": "VIN",
  "Solicitud Venta": "Vin",
  "Solicitud Vitrina": "vin",
});

console.log("\n  KAR-LOGISTICS — VINs únicos por hoja:");
for (const [k, s] of Object.entries(kar.sheets)) {
  console.log(`    ${k.padEnd(25)} ${String(s.size).padStart(6)} VINs`);
}

// ─────────────── SCHIAPP vs KAR ───────────────
const allSchiapp = new Set();
const allKar = new Set();
for (const s of Object.values(schiapp.sheets)) for (const v of s) allSchiapp.add(v);
for (const s of Object.values(kar.sheets)) for (const v of s) allKar.add(v);

const interseccion = new Set([...allSchiapp].filter((v) => allKar.has(v)));
const soloSchiapp = new Set([...allSchiapp].filter((v) => !allKar.has(v)));
const soloKar = new Set([...allKar].filter((v) => !allSchiapp.has(v)));

console.log("\n  CRUCE SCHIAPP ∩ KAR:");
console.log(`    Universo total VINs en SCHIAPP   ${String(allSchiapp.size).padStart(6)}`);
console.log(`    Universo total VINs en KAR       ${String(allKar.size).padStart(6)}`);
console.log(`    VINs SOLO en SCHIAPP             ${String(soloSchiapp.size).padStart(6)}`);
console.log(`    VINs SOLO en KAR                 ${String(soloKar.size).padStart(6)}`);
console.log(`    VINs en AMBAS bodegas            ${String(interseccion.size).padStart(6)} ⚠`);

if (interseccion.size > 0 && interseccion.size <= 20) {
  console.log(`    Detalle (overlap operacional):`);
  for (const v of interseccion) console.log(`      ${v}`);
}

// ─────────────── FLUJO interno por bodega ───────────────

function flowReport(label, sheets) {
  console.log(`\n  FLUJO ${label}:`);
  const orden = label === "SCHIAPPACASSE"
    ? ["Compra Marca", "Almacenamiento ", "ENTRADAS", "Distribución", "SALIDAS"]
    : ["Compras Marca", "Almacenamiento", "ENTRADAS", "Distribucion", "SALIDAS"];
  let prev = null;
  for (const sheet of orden) {
    const s = sheets[sheet];
    if (!s) continue;
    let line = `    ${sheet.padEnd(20)} ${String(s.size).padStart(6)} VINs`;
    if (prev) {
      const intersect = [...prev.s].filter((v) => s.has(v)).length;
      const new_ = [...s].filter((v) => !prev.s.has(v)).length;
      const drop = [...prev.s].filter((v) => !s.has(v)).length;
      line += `   ↘ con ${prev.name}: ${intersect} compartidos · ${new_} nuevos en ${sheet} · ${drop} no avanzaron`;
    }
    console.log(line);
    prev = { name: sheet, s };
  }
}

flowReport("SCHIAPPACASSE", schiapp.sheets);
flowReport("KAR-LOGISTICS", kar.sheets);

// ─────────────── Solicitudes activas (Venta + Vitrina) vs Distribución ───────────────
console.log("\n  COHERENCIA SOLICITUDES vs DISTRIBUCIÓN:");
for (const [label, sh] of [["SCHIAPP", schiapp.sheets], ["KAR", kar.sheets]]) {
  const distribKey = label === "SCHIAPP" ? "Distribución" : "Distribucion";
  const distrib = sh[distribKey];
  const solVenta = sh["Solicitud Venta"];
  const solVit = sh["Solicitud Vitrina"];
  const vEnDistrib = [...solVenta].filter((v) => distrib.has(v)).length;
  const vitEnDistrib = [...solVit].filter((v) => distrib.has(v)).length;
  console.log(`    ${label.padEnd(10)} Solicitud Venta:  ${solVenta.size} ⇢ ${vEnDistrib} ya en Distribución (${(vEnDistrib / Math.max(solVenta.size, 1) * 100).toFixed(0)}%)`);
  console.log(`               Solicitud Vitrina: ${solVit.size} ⇢ ${vitEnDistrib} ya en Distribución (${(vitEnDistrib / Math.max(solVit.size, 1) * 100).toFixed(0)}%)`);
}

// ─────────────── Logística vs ACTAS (universo FNE / entregados) ───────────────
console.log("\n  CRUCE LOGÍSTICA (Schiapp+Kar) vs ACTAS al 28 de Mayo:");
const wbActas = XLSX.readFile(F_ACTAS, { cellDates: true });
const wsActas = wbActas.Sheets["ROMA"];
const actasRows = XLSX.utils.sheet_to_json(wsActas, { defval: null, raw: true });
const actasAll = new Set();
const actasFNE = new Set(); // no entregados
const actasEntregados = new Set();
for (const r of actasRows) {
  const v = norm(r["Vin"]);
  if (!v) continue;
  actasAll.add(v);
  const txt = (r["entrega_auto_txt"] ?? "").toString().trim();
  if (txt === "Cargado") actasEntregados.add(v);
  else actasFNE.add(v);
}
console.log(`    Actas total VINs            ${String(actasAll.size).padStart(6)}`);
console.log(`    ├─ Entregados (Cargado)     ${String(actasEntregados.size).padStart(6)}`);
console.log(`    └─ FNE operativo            ${String(actasFNE.size).padStart(6)}`);

const logTodo = new Set([...allSchiapp, ...allKar]);
const inActas = [...logTodo].filter((v) => actasAll.has(v));
const inActasEnt = [...logTodo].filter((v) => actasEntregados.has(v));
const inActasFNE = [...logTodo].filter((v) => actasFNE.has(v));
console.log(`    VINs logística (todos)       ${String(logTodo.size).padStart(6)}`);
console.log(`    ├─ Aparecen en Actas         ${String(inActas.length).padStart(6)}  (${(inActas.length / logTodo.size * 100).toFixed(1)}%)`);
console.log(`    ├─── cruce con Entregados   ${String(inActasEnt.length).padStart(6)}`);
console.log(`    ├─── cruce con FNE          ${String(inActasFNE.length).padStart(6)}`);
console.log(`    └─ NO están en Actas         ${String(logTodo.size - inActas.length).padStart(6)} ⚠ histórico pre-venta`);

// Inverso: cuántos FNE están en logística?
const fneEnLog = [...actasFNE].filter((v) => logTodo.has(v));
const fneSchiapp = [...actasFNE].filter((v) => allSchiapp.has(v));
const fneKar = [...actasFNE].filter((v) => allKar.has(v));
const fneNoEnLog = [...actasFNE].filter((v) => !logTodo.has(v));
console.log(`\n  COBERTURA FNE OPERATIVO (854) en logística:`);
console.log(`    En Schiapp                   ${String(fneSchiapp.length).padStart(6)}  (${(fneSchiapp.length / actasFNE.size * 100).toFixed(1)}%)`);
console.log(`    En Kar                       ${String(fneKar.length).padStart(6)}  (${(fneKar.length / actasFNE.size * 100).toFixed(1)}%)`);
console.log(`    En cualquiera                ${String(fneEnLog.length).padStart(6)}  (${(fneEnLog.length / actasFNE.size * 100).toFixed(1)}%)`);
console.log(`    NO en logística              ${String(fneNoEnLog.length).padStart(6)}  ⚠ FNE sin track logístico`);

// Por sheet específica — ¿en qué etapa están?
function intersectCount(setA, setB) { return [...setA].filter((v) => setB.has(v)).length; }
console.log(`\n  FNE OPERATIVO — etapa logística actual (Schiapp):`);
for (const [k, s] of Object.entries(schiapp.sheets)) {
  console.log(`    ${k.padEnd(25)} ${String(intersectCount(actasFNE, s)).padStart(5)} de ${actasFNE.size}`);
}
console.log(`\n  FNE OPERATIVO — etapa logística actual (KAR):`);
for (const [k, s] of Object.entries(kar.sheets)) {
  console.log(`    ${k.padEnd(25)} ${String(intersectCount(actasFNE, s)).padStart(5)} de ${actasFNE.size}`);
}

console.log("\n════════════════════════════════════════════════════════════════════════════════");
