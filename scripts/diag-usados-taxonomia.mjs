/**
 * AUDITORÍA · Taxonomía operacional oficial de USADOS desde Base_Stock.
 * Solo lee el Excel real y reporta. NO modifica nada.
 *
 * Fase 1: dump de distribuciones para entender cómo vienen modelados los usados
 * y sus subcategorías (retail/mayorista/CPD/outlet), flags de puente/judicial/
 * stockB/tescar/inmovilizado.
 * Fase 2: clasificación operacional (6 categorías, mutuamente excluyentes).
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const DIR = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";
const wb = XLSX.read(
  readFileSync(DIR + "Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx"),
  { type: "buffer", cellDates: true },
);
const rows = XLSX.utils.sheet_to_json(wb.Sheets["Base_Stock"], { defval: null, raw: true });

const up = (s) => (s ?? "").toString().toUpperCase().trim();
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const costo = (r) => num(r[" Costo Neto "] ?? r["Costo Neto"]);
const dias = (r) => num(r["Días Stock"]);

function dist(label, fn, universe = rows) {
  const m = new Map();
  for (const r of universe) {
    const k = (fn(r) ?? "(vacío)").toString() || "(vacío)";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  console.log(`\n── ${label} (${universe.length}) ──`);
  for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25))
    console.log(`  ${v.toString().padStart(5)}  ${k}`);
}

console.log(`\n══ Base_Stock: ${rows.length} filas ══`);
dist("Unidad Negocio", (r) => r["Unidad Negocio"]);
dist("Condicion Vehiculo", (r) => r["Condicion Vehiculo"]);
dist("Marca Pompeyo", (r) => r["Marca Pompeyo"]);

// ── Universo USADOS: Unidad Negocio = Usados (candidato maestro) ──────────
const esUsado = (r) =>
  up(r["Unidad Negocio"]).includes("USADO") ||
  up(r["Condicion Vehiculo"]).includes("USADO") ||
  ["USADOS", "VU EN NUEVOS", "VU EN USADOS"].includes(up(r["Marca Pompeyo"]));
const usados = rows.filter(esUsado);
console.log(`\n══ Universo USADOS candidato: ${usados.length} ══`);

dist("[USADOS] Condicion de Stock", (r) => r["Condicion de Stock"], usados);
dist("[USADOS] Tipo Stock", (r) => r["Tipo Stock"], usados);
dist("[USADOS] Tipo Stock Usados", (r) => r["Tipo Stock Usados"], usados);
dist("[USADOS] Status Stock", (r) => r["Status Stock"], usados);
dist("[USADOS] Estado Dealer", (r) => r["Estado Dealer"], usados);
dist("[USADOS] Stock A/B", (r) => r["Stock A/B"], usados);
dist("[USADOS] Estado AutoPro", (r) => r["Estado AutoPro"], usados);
dist("[USADOS] Marca Pompeyo", (r) => r["Marca Pompeyo"], usados);

// ── Flags operacionales ───────────────────────────────────────────────────
const esVPP = (r) =>
  up(r["Estado AutoPro"]).includes("PROCESO RETOMA") ||
  (up(r["Status Stock"]) === "APROBADA" && r["Folio Retoma"]) ||
  up(r["Condicion de Stock"]).includes("VU POR RECIBIR") ||
  up(r["Tipo Stock"]).includes("VU POR RECIBIR");
const esJudicial = (r) => up(r["Stock A/B"]).includes("JUDICIAL");
const esStockB = (r) => up(r["Stock A/B"]) === "STOCK B" || up(r["Stock A/B"]) === "B";
const esTescar = (r) =>
  up(r["Estado Dealer"]).includes("TEST CAR") || up(r["Condicion Vehiculo"]).includes("TEST CAR");
const esPagado = (r) => up(r["Pagado?"]) === "PAGADO" || up(r["Tipo Stock"]).includes("PROPIO");
const esInmovilizado = (r) => esPagado(r) && dias(r) > 180;

// subcategoría de stock real
const subReal = (r) => {
  const t = up(r["Tipo Stock Usados"]) || up(r["Condicion de Stock"]) || up(r["Tipo Stock"]);
  if (t.includes("MAYOR")) return "mayorista";
  if (t.includes("CPD")) return "CPD";
  if (t.includes("OUTLET")) return "outlet";
  if (t.includes("RETAIL") || t.includes("VITRINA")) return "retail";
  return "retail"; // por defecto venta directa
};

// ── Clasificación operacional (prioridad → mutuamente excluyente) ────────
function clasificar(r) {
  if (esVPP(r)) return "USADOS_CAPITAL_PUENTE";
  if (esJudicial(r)) return "USADOS_JUDICIAL";
  if (esStockB(r)) return "USADOS_STOCK_B";
  if (esTescar(r)) return "USADOS_TESCAR";
  if (esInmovilizado(r)) return "USADOS_INMOVILIZADO";
  return "USADOS_STOCK_REAL";
}

const cats = {};
const subs = {};
let ambiguos = 0;
for (const r of usados) {
  const c = clasificar(r);
  if (!cats[c]) cats[c] = { u: 0, cap: 0, dias: 0, conDias: 0 };
  const e = cats[c];
  e.u++;
  e.cap += costo(r);
  if (dias(r) > 0) { e.dias += dias(r); e.conDias++; }
  if (c === "USADOS_STOCK_REAL") {
    const s = subReal(r);
    if (!subs[s]) subs[s] = { u: 0, cap: 0 };
    subs[s].u++;
    subs[s].cap += costo(r);
  }
  if (!up(r["Marca Pompeyo"]) && !up(r["Condicion de Stock"])) ambiguos++;
}

console.log("\n══ CLASIFICACIÓN OPERACIONAL USADOS ══");
const fmt = (n) => "$" + Math.round(n).toLocaleString("es-CL");
for (const [c, e] of Object.entries(cats).sort((a, b) => b[1].cap - a[1].cap)) {
  const agingProm = e.conDias > 0 ? Math.round(e.dias / e.conDias) : 0;
  console.log(`  ${c.padEnd(24)} ${e.u.toString().padStart(5)} u · ${fmt(e.cap).padStart(18)} · aging ${agingProm}d`);
}
console.log("\n── Subcategorías STOCK_REAL ──");
for (const [s, e] of Object.entries(subs).sort((a, b) => b[1].cap - a[1].cap))
  console.log(`  ${s.padEnd(12)} ${e.u.toString().padStart(5)} u · ${fmt(e.cap)}`);
console.log(`\n  Ambiguos (sin señales mínimas): ${ambiguos}`);
