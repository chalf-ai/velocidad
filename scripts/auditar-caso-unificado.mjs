/**
 * AUDITORÍA · cobertura y contradicciones del Caso Operacional Unificado.
 * Cruza por VIN normalizado: Base_Stock, FNE, Logística (ROMA+STLI).
 * (Saldos vía bridge cajón→VIN y gestión localStorage son runtime; se anotan.)
 * Solo lee. NO modifica nada.
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const DIR = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";
const read = (f, sheet) => {
  const wb = XLSX.read(readFileSync(DIR + f), { type: "buffer", cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet ?? wb.SheetNames[0]], { defval: null, raw: true });
};
const up = (s) => (s ?? "").toString().toUpperCase().trim();
const isDate = (v) => v instanceof Date && !isNaN(v);
const limpiarVIN = (raw) => raw == null ? "" :
  String(raw).replace(/\s+/g, "").replace(/[-_./]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const tok = (s) => new Set(up(s).normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[\s\-_./]+/).filter((t) => t.length >= 3 && !["STOCK","OFICINA","BODEGA","POMPEYO","AUTOS"].includes(t)));
const distintas = (a, b) => { if (!a || !b) return false; const ta = tok(a), tb = tok(b); if (!ta.size || !tb.size) return false; for (const t of ta) if (tb.has(t)) return false; return true; };

// ── fuentes ──────────────────────────────────────────────────────────────
const stock = read("Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx", "Base_Stock");
const fne = read("Autos no entregados.xlsx");
const roma = read("Diciembre-Mayo ROMA.xlsx", "ROMA");
const stli = read("Logistica.xlsx", "Hoja2");

const esUsadoStock = (r) => up(r["Unidad Negocio"]) === "USADOS" || up(r["Condicion Vehiculo"]).includes("USADO") || ["USADOS","VU EN NUEVOS","VU EN USADOS"].includes(up(r["Marca Pompeyo"]));
const esVPP = (r) => up(r["Estado AutoPro"]) === "PROCESO RETOMA" || (up(r["Status Stock"]) === "APROBADA" && r["Folio Retoma"] && String(r["Folio Retoma"]) !== "0");

const stockByVin = new Map();
for (const r of stock) { const k = limpiarVIN(r["Numero VIN"]); if (k && !stockByVin.has(k)) stockByVin.set(k, r); }
const fneByVin = new Map();
for (const r of fne) { const k = limpiarVIN(r["Vin"]); if (k && !fneByVin.has(k)) fneByVin.set(k, r); }
const logVins = new Set();
const romaByVin = new Map();
for (const r of roma) { const k = limpiarVIN(r["Vin"]); if (k) { logVins.add(k); if (!romaByVin.has(k)) romaByVin.set(k, r); } }
for (const r of stli) { const k = limpiarVIN(r["VIN"]); if (k) logVins.add(k); }

// universo = stock ∪ FNE (backbone operacional; ROMA histórico no siembra)
const universo = new Set([...stockByVin.keys(), ...fneByVin.keys()]);

// ── cobertura ──────────────────────────────────────────────────────────────
let conStock = 0, conFNE = 0, conLog = 0, conPuente = 0, conUsados = 0, con2 = 0;
for (const vin of universo) {
  const capas = [];
  if (stockByVin.has(vin)) capas.push("stock");
  if (fneByVin.has(vin)) capas.push("fne");
  if (logVins.has(vin)) capas.push("logistica");
  const sr = stockByVin.get(vin);
  if (sr && esVPP(sr)) capas.push("puente");
  if (sr && esUsadoStock(sr)) capas.push("usados");
  if (capas.includes("stock")) conStock++;
  if (capas.includes("fne")) conFNE++;
  if (capas.includes("logistica")) conLog++;
  if (capas.includes("puente")) conPuente++;
  if (capas.includes("usados")) conUsados++;
  if (capas.length >= 2) con2++;
}

console.log(`\n══ COBERTURA CASO UNIFICADO (universo = stock ∪ FNE) ══`);
console.log(`  1. Total VIN únicos:        ${universo.size}`);
console.log(`  2. Con stock:               ${conStock}`);
console.log(`  3. Con FNE:                 ${conFNE}`);
console.log(`  4. Con logística:           ${conLog}`);
console.log(`  5. Con saldos:              (runtime: bridge cajón→VIN)`);
console.log(`  6. Con provisiones:         0 — provisiones NO traen VIN (gap, son por marca)`);
console.log(`  7. Con capital puente:      ${conPuente}`);
console.log(`  8. Con gestión:             (runtime: localStorage)`);
console.log(`  9. Con 2+ capas:            ${con2}`);
console.log(`  + Con usados:               ${conUsados}`);

// ── contradicciones ──────────────────────────────────────────────────────────
const fneEstado = (r) => {
  const recibida = isDate(r["fecha_patente_recibida"]);
  const sol = up(r["sol_entrega"]) === "SI";
  const aut = up(r["autorizacion_entrega"]) === "SI";
  if (recibida) { if (sol && aut) return "listo_para_entregar"; if (sol) return "falta_solo_autorizacion"; return "patente_en_sucursal"; }
  return "en_proceso";
};
const cont = {};
const add = (c) => (cont[c] = (cont[c] ?? 0) + 1);
for (const vin of universo) {
  const sr = stockByVin.get(vin);
  const fr = fneByVin.get(vin);
  const rr = romaByVin.get(vin);
  const enFNE = !!fr;
  const logRealizada = up(rr?.["Estado"]) === "REALIZADA";
  if (enFNE && logRealizada) add("fne_pero_entregado");
  if (enFNE && fneEstado(fr) === "listo_para_entregar" && !logVins.has(vin)) add("listo_sin_logistica");
  if (fr && isDate(fr["fecha_patente_recibida"]) && up(fr["autorizacion_entrega"]) !== "SI") add("patente_sin_autorizacion");
  if (sr && sr["Pagado?"] && up(sr["Pagado?"]) === "PAGADO" && up(sr["Tipo Stock"]).includes("FINAN")) add("linea_pero_pagado");
  if (sr && esVPP(sr) && (!sr["Folio Retoma"] || String(sr["Folio Retoma"]) === "0")) add("puente_sin_operacion");
  if (sr && fr && distintas(sr["Sucursal"], fr["Sucursal"])) add("sucursal_inconsistente_stock_fne");
  if (fr && rr && distintas(fr["Sucursal"], rr["Sucursal"])) add("sucursal_inconsistente_fne_log");
}

console.log(`\n══ 10. CONTRADICCIONES detectadas ══`);
for (const [k, v] of Object.entries(cont).sort((a, b) => b[1] - a[1]))
  console.log(`  ${k.padEnd(34)} ${v}`);
if (Object.keys(cont).length === 0) console.log("  (ninguna)");

// ── gaps agregados ───────────────────────────────────────────────────────────
const prov = read("Provisiones al 18 de Mayo.xlsx", "ROMA");
const provFact = prov.filter((p) => Number(p["Facturado"] ?? p["MontoFactura"] ?? 0) > 0).length;
console.log(`\n══ GAPS agregados ══`);
console.log(`  Provisiones totales: ${prov.length} (sin VIN → no adjuntables a un caso)`);
console.log(`  FNE sin cruce a stock: ${[...fneByVin.keys()].filter((v) => !stockByVin.has(v)).length} de ${fneByVin.size}`);
console.log(`  Logística sin cruce a universo vivo: ${[...logVins].filter((v) => !universo.has(v)).length} de ${logVins.size} (histórico)`);
console.log("");
