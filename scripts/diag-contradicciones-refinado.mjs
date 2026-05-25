/**
 * RECÁLCULO · contradicciones tras reglas #1 y #2 (capa paralela). Solo lee.
 * Compara ANTES (regla amplia) vs DESPUÉS (refinada) → falsos positivos eliminados.
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const DIR = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";
const read = (f, sheet) => {
  const wb = XLSX.read(readFileSync(DIR + f), { type: "buffer", cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet ?? wb.SheetNames[0]], { defval: null, raw: true });
};
const up = (s) => (s ?? "").toString().toUpperCase().trim();
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const fmt = (n) => "$" + Math.round(n).toLocaleString("es-CL");
const isDate = (v) => v instanceof Date && !isNaN(v);
const limpiarVIN = (raw) => raw == null ? "" : String(raw).replace(/\s+/g, "").replace(/[-_./]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const tok = (s) => new Set(up(s).normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[\s\-_./]+/).filter((t) => t.length >= 3 && !["STOCK","OFICINA","BODEGA","POMPEYO","AUTOS"].includes(t)));
const distintas = (a, b) => { if (!a || !b) return false; const ta = tok(a), tb = tok(b); if (!ta.size || !tb.size) return false; for (const t of ta) if (tb.has(t)) return false; return true; };
const marcaTok = (s) => up(s).replace(/^OFICINA\s+/, "").split(/\s+/)[0] || "";
const NO_RETAIL = ["LOGISTICA","CPD","VN CON PATENTE","TEST CAR","SEMINUEVO","AUTOSHOPPING","OUTLET","BODEGA","CASA MATRIZ","COMPANY","KAR","SCHIAPP","LONQUEN"];
const esRetail = (s) => { const u = up(s); if (!u) return false; if (u.startsWith("OFICINA")) return false; return !NO_RETAIL.some((n) => u.includes(n)); };

const stock = read("Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx", "Base_Stock");
const fne = read("Autos no entregados.xlsx");
const roma = read("Diciembre-Mayo ROMA.xlsx", "ROMA");

const stockByVin = new Map();
for (const r of stock) { const k = limpiarVIN(r["Numero VIN"]); if (k && !stockByVin.has(k)) stockByVin.set(k, r); }
const romaByVin = new Map();
for (const r of roma) { const k = limpiarVIN(r["Vin"]); if (k && !romaByVin.has(k)) romaByVin.set(k, r); }

const entregadoReal = (r) => isDate(r["fecha_patente_entregada"]) || ["SI","SÍ","ENTREGADO"].includes(up(r["entrega_auto"])) || up(r["entrega_auto_txt"]).includes("ENTREGAD");

// ── P1 ANTES vs DESPUÉS ──────────────────────────────────────────────────────
let p1Antes = 0, p1AntesCap = 0, p1Despues = 0, p1DespuesCap = 0;
const p1Reales = [];
for (const r of fne) {
  const vin = limpiarVIN(r["Vin"]); if (!vin) continue;
  const rr = romaByVin.get(vin);
  const antes = up(rr?.["Estado"]) === "REALIZADA"; // regla vieja
  const despues = entregadoReal(r); // regla #1
  if (antes) { p1Antes++; p1AntesCap += num(r["ValorFactura"]); }
  if (despues) { p1Despues++; p1DespuesCap += num(r["ValorFactura"]); p1Reales.push(r); }
}

console.log(`\n══ P1 · FNE pero entregado ══`);
console.log(`  ANTES (ROMA Realizada):        ${p1Antes} VIN · ${fmt(p1AntesCap)}`);
console.log(`  DESPUÉS (señal real entrega):  ${p1Despues} VIN · ${fmt(p1DespuesCap)}`);
console.log(`  Falsos positivos eliminados:   ${p1Antes - p1Despues} · ${fmt(p1AntesCap - p1DespuesCap)}`);
if (p1Reales.length) for (const r of p1Reales.slice(0, 20)) console.log(`     ${limpiarVIN(r["Vin"])} ${r["Sucursal"]} ${fmt(num(r["ValorFactura"]))}`);

// ── P2 ANTES vs DESPUÉS ──────────────────────────────────────────────────────
let p2Antes = 0, p2AntesCap = 0;
const reales = [];
for (const r of fne) {
  const vin = limpiarVIN(r["Vin"]); const sr = stockByVin.get(vin); if (!sr) continue;
  if (!distintas(sr["Sucursal"], r["Sucursal"])) continue;
  p2Antes++; p2AntesCap += num(r["ValorFactura"]);
  if (esRetail(sr["Sucursal"]) && esRetail(r["Sucursal"])) {
    const distMarca = marcaTok(sr["Sucursal"]) !== marcaTok(r["Sucursal"]);
    reales.push({ vin, sucStock: sr["Sucursal"], sucFne: r["Sucursal"], modelo: sr["Modelo"], monto: num(r["ValorFactura"]), severidad: distMarca ? "media" : "info", tipo: distMarca ? "marca distinta" : "misma marca" });
  }
}
const p2Cap = reales.reduce((s, c) => s + c.monto, 0);
console.log(`\n══ P2 · Sucursal inconsistente stock vs FNE ══`);
console.log(`  ANTES (cualquier diferencia):  ${p2Antes} VIN · ${fmt(p2AntesCap)}`);
console.log(`  DESPUÉS (solo retail vs retail): ${reales.length} VIN · ${fmt(p2Cap)}`);
console.log(`  Falsos positivos eliminados:   ${p2Antes - reales.length} · ${fmt(p2AntesCap - p2Cap)}`);
const sev = {}; for (const r of reales) sev[r.severidad] = (sev[r.severidad] ?? 0) + 1;
console.log(`  Severidad: ${Object.entries(sev).map(([k, v]) => `${k}=${v}`).join(" · ")}`);
console.log(`  Casos reales:`);
for (const r of reales.sort((a, b) => b.monto - a.monto))
  console.log(`     ${r.vin} ${(r.modelo ?? "").slice(0,16).padEnd(16)} stock:${(r.sucStock ?? "").padEnd(22)} fne:${(r.sucFne ?? "").padEnd(20)} ${fmt(r.monto).padStart(14)} [${r.tipo}]`);

// ── Señal de calidad de dato: FNE sin fecha factura ──────────────────────────
const facturaValida = (v) => {
  if (isDate(v)) return true;
  const s = String(v ?? "").trim();
  if (!s || s.includes("00-00-0000") || up(s) === "EN PROCESO") return false;
  return !isNaN(new Date(s).getTime());
};
const sinFactura = fne.filter((r) => !facturaValida(r["FechaFactura"]));
const ejemplos = [...new Set(sinFactura.map((r) => up(r["FechaFactura"]) || "(vacío)"))].slice(0, 4);
console.log(`\n══ CALIDAD DE DATO (no contradicción) ══`);
console.log(`  FNE sin fecha de factura válida: ${sinFactura.length} de ${fne.length}  ej: ${ejemplos.join(" | ") || "—"}`);

// ── Resumen ──────────────────────────────────────────────────────────────────
console.log(`\n══ RESUMEN ══`);
const realTotal = p1Despues + reales.length;
const fpTotal = (p1Antes - p1Despues) + (p2Antes - reales.length);
console.log(`  Contradicciones REALES tras refinar: ${realTotal} (P1 ${p1Despues} + P2 ${reales.length})`);
console.log(`  Falsos positivos eliminados:         ${fpTotal} (P1 ${p1Antes - p1Despues} + P2 ${p2Antes - reales.length})`);
console.log(`  Capital realmente afectado:          ${fmt(p1DespuesCap + p2Cap)}  (antes ${fmt(p1AntesCap + p2AntesCap)})`);
console.log("");
