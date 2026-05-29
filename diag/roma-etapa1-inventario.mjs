#!/usr/bin/env node
/**
 * ETAPA 1 — Inventario completo por archivo + identificación del mes/corte.
 *
 * Detecta el mes que cada archivo representa por max(FechaSolicitud) y muestra:
 *  - cantidad total de filas
 *  - VIN únicos
 *  - VentaID únicos
 *  - rango de fechas (solicitud, factura, inscripción)
 *  - distribución mensual de FechaSolicitud
 *  - estados / pasos / sucursales
 *  - cobertura de campos críticos
 */
import XLSX from "xlsx";

const ARCHIVOS = [
  { path: "/Users/Daviid/Downloads/LOG Enero.xlsx", alias: "A" },
  { path: "/Users/Daviid/Downloads/tmp-export-3-29-05-2026_334 (8).xlsx", alias: "B" },
  { path: "/Users/Daviid/Downloads/tmp-export-3-29-05-2026_335 (23).xlsx", alias: "C" },
  { path: "/Users/Daviid/Downloads/tmp-export-3-29-05-2026_335 (10).xlsx", alias: "D" },
  { path: "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Log Roma 29-05-2026 .xlsx", alias: "E" },
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
function ymKey(d) { return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}` : "null"; }
function fmt(d) { return d ? d.toISOString().slice(0, 10) : "—"; }

const datasets = new Map();
for (const a of ARCHIVOS) {
  const wb = XLSX.readFile(a.path, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["ROMA"], { defval: null, raw: true });
  // Indexar y agregar derivados
  const enriched = rows.map((r) => ({
    raw: r,
    ventaId: r["VentaID"] != null ? Number(r["VentaID"]) : null,
    vin: r["Vin"] ? String(r["Vin"]).trim().toUpperCase() : null,
    fSolicitud: toDate(r["FechaSolicitud"]),
    fFactura: toDate(r["FechaFactura"]),
    fInscripcion: toDate(r["FechaEnprocesoIns"]),
    fETASucursal: toDate(r["FechaETASucursal"]),
    fEstimadaEntrega: toDate(r["FechaEstimadaEntrega"]),
    estado: r["Estado"],
    paso: r["PasoActual"],
    sucursal: r["Sucursal"],
    marca: r["Marca"],
    gerencia: r["Gerencia"],
  }));
  datasets.set(a.alias, { archivo: a.path.split("/").pop(), rows: enriched });
}

// ── ETAPA 1 — Inventario por archivo ────────────────────────────────────────
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  ETAPA 1 — INVENTARIO POR ARCHIVO");
console.log("══════════════════════════════════════════════════════════════════════════════");

const resumen = [];
for (const [alias, d] of datasets) {
  const rows = d.rows;
  const vins = new Set(rows.map((r) => r.vin).filter(Boolean));
  const ventas = new Set(rows.map((r) => r.ventaId).filter(Boolean));
  const fSol = rows.map((r) => r.fSolicitud).filter(Boolean).map((d) => d.getTime());
  const fFac = rows.map((r) => r.fFactura).filter(Boolean).map((d) => d.getTime());
  const fIns = rows.map((r) => r.fInscripcion).filter(Boolean).map((d) => d.getTime());

  const estados = new Set(rows.map((r) => r.estado).filter(Boolean));
  const pasos = new Set(rows.map((r) => r.paso).filter(Boolean));
  const sucursales = new Set(rows.map((r) => r.sucursal).filter(Boolean));

  // Distribución mensual FechaSolicitud
  const distSol = new Map();
  for (const r of rows) {
    const k = ymKey(r.fSolicitud);
    distSol.set(k, (distSol.get(k) ?? 0) + 1);
  }

  console.log(`\n── ARCHIVO ${alias} · ${d.archivo} ──`);
  console.log(`  Filas:        ${rows.length}`);
  console.log(`  VINs únicos:  ${vins.size}`);
  console.log(`  VentaID únicos: ${ventas.size}`);
  console.log(`  FechaSolicitud:    ${fmt(new Date(Math.min(...fSol)))} → ${fmt(new Date(Math.max(...fSol)))}`);
  console.log(`  FechaFactura:      ${fmt(new Date(Math.min(...fFac)))} → ${fmt(new Date(Math.max(...fFac)))}`);
  console.log(`  FechaInscripción:  ${fmt(new Date(Math.min(...fIns)))} → ${fmt(new Date(Math.max(...fIns)))}`);
  console.log(`  Estados (${estados.size}): ${[...estados].slice(0,5).join(" · ")}`);
  console.log(`  PasoActual (${pasos.size}): ${[...pasos].join(" · ")}`);
  console.log(`  Sucursales: ${sucursales.size}`);
  console.log(`  Distribución FechaSolicitud por mes:`);
  const sortedDist = [...distSol.entries()].sort((a,b) => a[0].localeCompare(b[0]));
  for (const [k, n] of sortedDist) {
    const bar = "█".repeat(Math.min(40, Math.round(n / 30)));
    console.log(`    ${k}  ${String(n).padStart(5)}  ${bar}`);
  }

  resumen.push({
    alias, filas: rows.length, vins: vins.size, ventas: ventas.size,
    minSol: new Date(Math.min(...fSol)), maxSol: new Date(Math.max(...fSol)),
    distSol: sortedDist,
  });
}

// ── Tabla comparativa ──
console.log("\n══════════════════════════════════════════════════════════════════════════════");
console.log("  TABLA COMPARATIVA");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  Alias  Filas   VINs   VentaIDs   maxSol         Mes inferido");
console.log("  " + "─".repeat(70));
for (const r of resumen.sort((a,b) => a.maxSol - b.maxSol)) {
  const mesInferido = ymKey(r.maxSol);
  console.log(`  ${r.alias}      ${String(r.filas).padStart(5)}   ${String(r.vins).padStart(4)}   ${String(r.ventas).padStart(7)}    ${fmt(r.maxSol).padEnd(13)}  ${mesInferido}`);
}
console.log("");
