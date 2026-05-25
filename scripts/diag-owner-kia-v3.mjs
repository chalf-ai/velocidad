// v3: separar STOCK KIA retail vs CAPITAL PUENTE KIA (VU/BU en parte de pago) y
// determinar la columna correcta de "valor total con IVA" para el KPI de stock.

import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const PATH =
  "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx";
const wb = XLSX.read(readFileSync(PATH), { type: "buffer", cellDates: true });
const raw = XLSX.utils.sheet_to_json(wb.Sheets["Base_Stock"], { defval: null, raw: true });
// trim headers (igual que el parser real)
const rows = raw.map((r) => {
  const o = {};
  for (const [k, v] of Object.entries(r)) o[k.trim()] = v;
  return o;
});

const up = (v) => (v == null ? "" : String(v)).toUpperCase().trim();
const num = (v) => (v == null || v === "" ? 0 : Number(v) || 0);

const inferSuc = (suc) => {
  const u = up(suc);
  if (!u) return null;
  if (["LOGISTICA POMPEYO", "SEMINUEVOS", "AUTOSHOPPING", "TEST CARS", "VN CON PATENTE", "CPD"].some((n) => u.includes(n))) return null;
  for (const [nd, c] of [[["KIA"], "KIA MOTORS"], [["MG"], "MG"], [["PEUGEOT"], "PEUGEOT"], [["GEELY"], "GEELY"], [["NISSAN"], "NISSAN"], [["CITROEN"], "CITROEN"], [["OPEL"], "OPEL"], [["SUBARU"], "SUBARU"], [["DFSK"], "DFSK"], [["LANDKING"], "LANDKING"], [["LEAP MOTOR", "LEAPMOTOR"], "LEAPMOTOR"]])
    if (nd.some((n) => u.includes(n))) return c;
  return null;
};
const canonMP = (m) => (up(m).includes("KIA") ? "KIA MOTORS" : up(m));

const isVPP = (r) => {
  const eap = up(r["Estado AutoPro"]);
  const ss = up(r["Status Stock"]);
  const f = r["Folio Retoma"];
  const tf = f != null && String(f).trim() !== "" && String(f).trim() !== "0";
  return eap === "PROCESO RETOMA" || (ss === "APROBADA" && tf);
};

function owner(r) {
  const cond = up(r["Condicion de Stock"]);
  const tipo = up(r["Tipo de Stock"]);
  const condV = up(r["Condicion Vehiculo"]);
  const suc = up(r["Sucursal"]);
  const auxTM = up(r["AUX TM"]);
  if (isVPP(r)) return inferSuc(suc) ?? "USADOS";
  if (cond.includes("RENTING") || suc.includes("RENTING")) return "RENTING";
  if (cond.includes("COMPANY") || suc.includes("COMPANY") || tipo.includes("COMPAÑ") || tipo.includes("COMPAN")) return "COMPANY CAR";
  if (auxTM === "VDR") return "VDR";
  if (cond.includes("TEST CAR") || condV.includes("TEST CAR EN USO") || suc.includes("TEST CAR")) return "TEST CARS";
  if (tipo.includes("USADO") || cond.includes("USADO") || cond.startsWith("VU") || suc.includes("SEMINUEVO") || suc.includes("AUTOSHOPPING")) return "USADOS";
  const sm = inferSuc(suc);
  if (sm) return sm;
  return canonMP(r["Marca Pompeyo"] ?? r["Marca"]);
}

const COLS = ["Costo Neto", "Total Costo", "Precio Compra Neto", "Precio Venta Total", "Precio Lista"];
const fmt = (n) => "$" + Math.round(n).toLocaleString("es-CL");

let stockN = 0, puenteN = 0;
const stockSums = {}, puenteSums = {};
for (const c of COLS) { stockSums[c] = 0; puenteSums[c] = 0; }
const stockSuc = new Map();
let logistica = 0, resciliacion = 0;
const puenteCondStock = new Map();
let ratioSum = 0, ratioN = 0;

for (const r of rows) {
  if (!r["Numero VIN"]) continue;
  if (owner(r) !== "KIA MOTORS") continue;
  const vpp = isVPP(r);
  const cn = num(r["Costo Neto"]);
  const tc = num(r["Total Costo"]);
  if (cn > 0 && tc > 0) { ratioSum += tc / cn; ratioN++; }
  if (vpp) {
    puenteN++;
    for (const c of COLS) puenteSums[c] += num(r[c]);
    puenteCondStock.set(up(r["Condicion de Stock"]) || "(vacío)", (puenteCondStock.get(up(r["Condicion de Stock"]) || "(vacío)") ?? 0) + 1);
  } else {
    stockN++;
    for (const c of COLS) stockSums[c] += num(r[c]);
    const s = r["Sucursal"] ?? "(sin sucursal)";
    stockSuc.set(s, (stockSuc.get(s) ?? 0) + 1);
    if (up(s).includes("LOGISTICA")) logistica++;
    if (up(r["Estado Dealer"]).includes("RESCIL")) resciliacion++;
  }
}

console.log("\n══ Comparación de columnas de valor (muestra 3 filas KIA) ══");
let shown = 0;
for (const r of rows) {
  if (shown >= 3) break;
  if (!r["Numero VIN"] || owner(r) !== "KIA MOTORS" || isVPP(r)) continue;
  console.log("  " + COLS.map((c) => `${c}=${fmt(num(r[c]))}`).join("  "));
  shown++;
}
console.log(`\n  Ratio promedio Total Costo / Costo Neto = ${(ratioSum / ratioN).toFixed(4)}  (IVA 19% → 1.19)`);

console.log(`\n══ STOCK KIA RETAIL (owner KIA, NO VPP) ══`);
console.log(`  Unidades: ${stockN}`);
for (const c of COLS) console.log(`  ${c.padEnd(20)} ${fmt(stockSums[c])}`);
console.log(`  → en Logística Pompeyo: ${logistica} | en Resciliación: ${resciliacion}`);

console.log(`\n══ CAPITAL PUENTE KIA (owner KIA, VPP / VU-BU en parte de pago) ══`);
console.log(`  Unidades: ${puenteN}`);
for (const c of COLS) console.log(`  ${c.padEnd(20)} ${fmt(puenteSums[c])}`);
console.log(`  Condicion de Stock:`); for (const [k, n] of [...puenteCondStock].sort((a, b) => b[1] - a[1])) console.log(`    ${String(k).padEnd(24)} ${n}`);

console.log(`\n══ Sucursales STOCK KIA RETAIL ══`);
for (const [k, n] of [...stockSuc].sort((a, b) => b[1] - a[1])) console.log(`  ${String(k).padEnd(34)} ${n}`);

console.log(`\n  TOTAL owner KIA = ${stockN + puenteN}  (stock ${stockN} + puente ${puenteN})`);
