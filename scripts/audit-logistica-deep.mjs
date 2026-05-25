/**
 * AUDITORÍA PROFUNDA · logística operacional.
 * Legendas, etapas (PasoActual), sentinelas de fecha, cobertura de cruce por VIN.
 * Solo lee.
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const DIR = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";
const read = (f, sheet) => {
  const wb = XLSX.read(readFileSync(DIR + f), { type: "buffer", cellDates: true });
  return { rows: XLSX.utils.sheet_to_json(wb.Sheets[sheet ?? wb.SheetNames[0]], { defval: null, raw: true }), sheets: wb.SheetNames, wb };
};
const up = (s) => (s ?? "").toString().toUpperCase().trim();
const limpiarVIN = (raw) => raw == null ? "" :
  String(raw).replace(/\s+/g, "").replace(/[-_./]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const dist = (rows, fn, top = 30) => {
  const m = new Map();
  for (const r of rows) { const k = (fn(r) ?? "(vacío)").toString() || "(vacío)"; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
};

// ── Legendas ───────────────────────────────────────────────────────────────
console.log("══ LEGENDA Logistica.xlsx / Hoja1 ══");
for (const r of read("Logistica.xlsx", "Hoja1").rows) console.log(`  ${JSON.stringify(r)}`);
console.log("\n══ LEGENDA Diciembre-Mayo ROMA / Hoja1 ══");
for (const r of read("Diciembre-Mayo ROMA.xlsx", "Hoja1").rows) console.log(`  ${JSON.stringify(r)}`);

// ── ROMA: etapas + estado + sentinelas ──────────────────────────────────────
const roma = read("Diciembre-Mayo ROMA.xlsx", "ROMA").rows;
console.log(`\n══ ROMA (${roma.length}) · PasoActual ══`);
for (const [k, v] of dist(roma, (r) => r["PasoActual"])) console.log(`  ${String(v).padStart(5)}  ${k}`);
console.log(`\n── ROMA · Estado ──`);
for (const [k, v] of dist(roma, (r) => r["Estado"])) console.log(`  ${String(v).padStart(5)}  ${k}`);

// sentinelas de fecha en ROMA (strings)
const dateColsRoma = ["FechaEstimadaEntrega","FechaSolicitud","FechaFactura","FechaEnprocesoIns","fecha_recepcion","FechaETASucursal","FechaEstimadaLLegadaSucursal_Calcu","fecha_RespuestaInstalacionAcc","fecha_RespuestaGestionLogistica"];
const isDMY = (s) => /^\d{2}-\d{2}-\d{4}$/.test(String(s ?? "").trim());
const isSentinel = (s) => { const t = up(s); return t === "" || t === "00-00-0000" || t === "EN PROCESO" || t === "PENDIENTE"; };
console.log(`\n── ROMA · parseabilidad de fechas (de ${roma.length}) ──`);
for (const c of dateColsRoma) {
  let ok = 0, sent = 0, otro = 0, ceros = 0;
  const ejemplosOtro = new Set();
  for (const r of roma) {
    const v = r[c];
    if (v == null || String(v).trim() === "") { sent++; continue; }
    if (String(v).trim() === "00-00-0000") { ceros++; continue; }
    if (isDMY(v)) ok++;
    else if (isSentinel(v)) sent++;
    else { otro++; if (ejemplosOtro.size < 4) ejemplosOtro.add(String(v).slice(0, 20)); }
  }
  console.log(`  ${c.padEnd(38)} fecha:${String(ok).padStart(4)} 00-00-0000:${String(ceros).padStart(4)} vacío/proc:${String(sent).padStart(4)} otro:${String(otro).padStart(3)} ${[...ejemplosOtro].join("|")}`);
}

// ── Logistica Hoja2: tipo solicitud, cumplimiento, sentinelas ───────────────
const logi = read("Logistica.xlsx", "Hoja2").rows;
console.log(`\n══ Logistica Hoja2 (${logi.length}) · Tipo solicitud ══`);
for (const [k, v] of dist(logi, (r) => r["Tipo solicitud"])) console.log(`  ${String(v).padStart(5)}  ${k}`);
console.log(`\n── Cumplimiento despacho ──`);
for (const [k, v] of dist(logi, (r) => r["Cumplimiento despacho"])) console.log(`  ${String(v).padStart(5)}  ${k}`);

// ── CRUCE POR VIN ────────────────────────────────────────────────────────────
const stock = read("Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx", "Base_Stock").rows;
const fne = read("Autos no entregados.xlsx").rows;
const stockVins = new Set(stock.map((r) => limpiarVIN(r["Numero VIN"])).filter(Boolean));
const fneVins = new Set(fne.map((r) => limpiarVIN(r["Vin"])).filter(Boolean));
const romaVins = new Set(roma.map((r) => limpiarVIN(r["Vin"])).filter(Boolean));
const logiVins = new Set(logi.map((r) => limpiarVIN(r["VIN"])).filter(Boolean));

const inter = (a, b) => [...a].filter((x) => b.has(x)).length;
console.log(`\n══ CRUCE POR VIN (VINs únicos) ══`);
console.log(`  Logistica Hoja2: ${logiVins.size} VINs · ROMA: ${romaVins.size} VINs`);
console.log(`  Base_Stock: ${stockVins.size} · FNE: ${fneVins.size}`);
console.log(`\n  Logistica ∩ ROMA:       ${inter(logiVins, romaVins)}`);
console.log(`  Logistica ∩ Base_Stock: ${inter(logiVins, stockVins)}  (${Math.round(inter(logiVins, stockVins)/logiVins.size*100)}%)`);
console.log(`  Logistica ∩ FNE:        ${inter(logiVins, fneVins)}`);
console.log(`  ROMA ∩ Base_Stock:      ${inter(romaVins, stockVins)}  (${Math.round(inter(romaVins, stockVins)/romaVins.size*100)}%)`);
console.log(`  ROMA ∩ FNE:             ${inter(romaVins, fneVins)}  (${Math.round(inter(romaVins, fneVins)/romaVins.size*100)}%)`);

// ¿ROMA Estado=Pendiente cruza más con stock/FNE? (universo vivo)
const romaPend = roma.filter((r) => up(r["Estado"]) === "PENDIENTE");
const romaPendVins = new Set(romaPend.map((r) => limpiarVIN(r["Vin"])).filter(Boolean));
console.log(`\n  ROMA Estado=Pendiente: ${romaPend.length} filas · ${romaPendVins.size} VINs`);
console.log(`    Pendiente ∩ Base_Stock: ${inter(romaPendVins, stockVins)}`);
console.log(`    Pendiente ∩ FNE:        ${inter(romaPendVins, fneVins)}`);
console.log(`    Pendiente ∩ Logistica:  ${inter(romaPendVins, logiVins)}`);
console.log("");
