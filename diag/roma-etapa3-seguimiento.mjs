#!/usr/bin/env node
/**
 * ETAPA 3 — Seguimiento de casos reales entre archivos.
 *
 * Objetivos:
 *  1. Confirmar la hipótesis "cada export es un período único" o desmentirla.
 *  2. Seguir casos representativos a través de la cadena.
 *  3. Verificar si el VIN VR3KAHPY3VS000844 vive en uno o varios archivos.
 *  4. Buscar evidencia de "casos que viven semanalmente" o "casos que se mueven".
 *
 * Si los archivos son exports filtrados por FechaSolicitud del mes,
 * los 22 VentaID que se repiten serán bordes (último día del mes A
 * que entró por error al export del mes B).
 */
import XLSX from "xlsx";

const ARCHIVOS = [
  { alias: "A", mes: "Enero", path: "/Users/Daviid/Downloads/LOG Enero.xlsx" },
  { alias: "B", mes: "Febrero", path: "/Users/Daviid/Downloads/tmp-export-3-29-05-2026_334 (8).xlsx" },
  { alias: "D", mes: "Marzo", path: "/Users/Daviid/Downloads/tmp-export-3-29-05-2026_335 (10).xlsx" },
  { alias: "C", mes: "Abril", path: "/Users/Daviid/Downloads/tmp-export-3-29-05-2026_335 (23).xlsx" },
  { alias: "E", mes: "Mayo", path: "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Log Roma 29-05-2026 .xlsx" },
];

function toDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "number") {
    if (v === 0) return null;
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const s = String(v).trim();
  if (!s || s === "0" || s === "00-00-0000") return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}
function fmt(d) { return d ? d.toISOString().slice(0, 10) : "—"; }

function load(path) {
  const wb = XLSX.readFile(path, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["ROMA"], { defval: null, raw: true });
  const byVenta = new Map();
  const byVin = new Map();
  for (const r of rows) {
    const venta = r["VentaID"] != null ? Number(r["VentaID"]) : null;
    const vin = r["Vin"] ? String(r["Vin"]).trim().toUpperCase() : null;
    const obj = {
      venta, vin,
      estado: r["Estado"],
      paso: r["PasoActual"],
      comentario: r["Comentario"],
      fSolicitud: toDate(r["FechaSolicitud"]),
      fFactura: toDate(r["FechaFactura"]),
      fInscripcion: toDate(r["FechaEnprocesoIns"]),
      fEstimadaEntrega: toDate(r["FechaEstimadaEntrega"]),
      fETASucursal: toDate(r["FechaETASucursal"]),
      fRespuesta: toDate(r["fecha_RespuestaGestionLogistica"]),
      sucursal: r["Sucursal"],
    };
    if (venta) byVenta.set(venta, obj);
    if (vin) byVin.set(vin, obj);
  }
  return { byVenta, byVin };
}

const data = new Map();
for (const a of ARCHIVOS) data.set(a.alias, { ...a, ...load(a.path) });
const orden = ["A", "B", "D", "C", "E"];

// ── 1) Hipótesis: ¿son exports filtrados por FechaSolicitud del mes? ──
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  ETAPA 3 — HIPÓTESIS: exports filtrados por FechaSolicitud del mes");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("");
console.log("  Para cada archivo, ¿qué porcentaje de filas tienen FechaSolicitud en");
console.log("  el rango canónico esperado (mes-1 día 28 → mes+1 día 7)?");
console.log("");
const expectedRange = {
  A: { from: new Date(2025,11,1),  to: new Date(2026,1,7),   label: "dic-1 a feb-7" },
  B: { from: new Date(2026,0,1),   to: new Date(2026,2,7),   label: "ene-1 a mar-7" },
  D: { from: new Date(2026,1,1),   to: new Date(2026,3,7),   label: "feb-1 a abr-7" },
  C: { from: new Date(2026,2,1),   to: new Date(2026,4,7),   label: "mar-1 a may-7" },
  E: { from: new Date(2026,3,1),   to: new Date(2026,5,7),   label: "abr-1 a jun-7" },
};
for (const o of orden) {
  const d = data.get(o);
  const exp = expectedRange[o];
  let inRange = 0, outRange = 0;
  for (const item of d.byVenta.values()) {
    if (!item.fSolicitud) continue;
    if (item.fSolicitud >= exp.from && item.fSolicitud <= exp.to) inRange++;
    else outRange++;
  }
  const total = inRange + outRange;
  console.log(`  ${d.mes.padEnd(10)} (${d.alias})  ${inRange}/${total} en rango ${exp.label} (${(inRange/total*100).toFixed(1)}%)`);
}

// ── 2) Análisis de los 22 VentaIDs que se repiten ──
console.log("\n══════════════════════════════════════════════════════════════════════════════");
console.log("  Los 22 VentaIDs que se repiten — ¿son bordes o anomalías?");
console.log("══════════════════════════════════════════════════════════════════════════════");
const allVentas = new Map();
for (const o of orden) {
  const d = data.get(o);
  for (const [v, it] of d.byVenta) {
    if (!allVentas.has(v)) allVentas.set(v, []);
    allVentas.get(v).push({ archivo: o, ...it });
  }
}
const repetidos = [...allVentas.entries()].filter(([_, arr]) => arr.length > 1);
console.log(`  Total: ${repetidos.length} VentaIDs aparecen en >1 archivo`);
for (const [vid, arr] of repetidos.slice(0, 15)) {
  const archivos = arr.map((p) => p.archivo).join("→");
  const fechas = arr.map((p) => fmt(p.fSolicitud)).join(", ");
  const estados = arr.map((p) => p.estado).join("→");
  console.log(`  VentaID ${String(vid).padStart(7)}  archivos: ${archivos.padEnd(10)} fSol: ${fechas.padEnd(40)} estados: ${estados}`);
}

// ── 3) Buscar VR3KAHPY3VS000844 ──
console.log("\n══════════════════════════════════════════════════════════════════════════════");
console.log("  VIN VR3KAHPY3VS000844 a través de la cadena");
console.log("══════════════════════════════════════════════════════════════════════════════");
const vinFoco = "VR3KAHPY3VS000844";
for (const o of orden) {
  const d = data.get(o);
  const item = d.byVin.get(vinFoco);
  if (item) {
    console.log(`  ${d.mes} (${o}): ENCONTRADO`);
    console.log(`     VentaID: ${item.venta}`);
    console.log(`     Estado: ${item.estado} · Paso: ${item.paso}`);
    console.log(`     FechaSolicitud: ${fmt(item.fSolicitud)}`);
    console.log(`     FechaETASucursal: ${fmt(item.fETASucursal)}`);
    console.log(`     fecha_RespuestaGestionLogistica: ${fmt(item.fRespuesta)}`);
    console.log(`     Sucursal: ${item.sucursal}`);
    if (item.comentario) console.log(`     Comentario: ${String(item.comentario).slice(0, 100)}`);
  } else {
    console.log(`  ${d.mes} (${o}): no aparece`);
  }
}

// ── 4) Muestra de casos que SÍ se siguen entre archivos ──
console.log("\n══════════════════════════════════════════════════════════════════════════════");
console.log("  TRAZA: Casos reales que SÍ aparecen en múltiples archivos");
console.log("══════════════════════════════════════════════════════════════════════════════");
// Tomar 3 ejemplos de los repetidos
for (const [vid, arr] of repetidos.slice(0, 5)) {
  console.log(`\n  VentaID ${vid}:`);
  for (const p of arr) {
    console.log(`    [${p.archivo} ${data.get(p.archivo).mes}]  Estado=${p.estado} · Paso=${p.paso}`);
    console.log(`        fSol=${fmt(p.fSolicitud)}  fFac=${fmt(p.fFactura)}  fIns=${fmt(p.fInscripcion)}`);
    console.log(`        fETASucursal=${fmt(p.fETASucursal)}  fRespuesta=${fmt(p.fRespuesta)}`);
    if (p.comentario) console.log(`        Comentario: ${String(p.comentario).slice(0, 80)}`);
  }
}

// ── 5) Estado por archivo (distribución) ──
console.log("\n══════════════════════════════════════════════════════════════════════════════");
console.log("  Distribución de Estado y PasoActual por archivo");
console.log("══════════════════════════════════════════════════════════════════════════════");
for (const o of orden) {
  const d = data.get(o);
  const ests = new Map();
  const pasos = new Map();
  for (const it of d.byVenta.values()) {
    ests.set(it.estado, (ests.get(it.estado) ?? 0) + 1);
    pasos.set(it.paso, (pasos.get(it.paso) ?? 0) + 1);
  }
  console.log(`  ${d.mes} (${o}):`);
  console.log(`    Estados: ${[...ests.entries()].map(([k,v]) => `${k}=${v}`).join(" · ")}`);
  console.log(`    Pasos:`);
  for (const [k, v] of pasos) console.log(`      ${k.padEnd(45)} ${v}`);
}
