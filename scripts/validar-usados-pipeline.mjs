/**
 * VALIDACIÓN · Filtro global USADOS tras el fix (usado → owner USADOS).
 * Replica la NUEVA getMarcaOperacional y confirma qué devuelve el filtro USADOS
 * en cada fuente (stock, FNE, saldos, provisiones). Solo lee, no modifica.
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const DIR = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";
const read = (f, sheet) => {
  const wb = XLSX.read(readFileSync(DIR + f), { type: "buffer", cellDates: true });
  const sh = sheet ?? wb.SheetNames[0];
  return { rows: XLSX.utils.sheet_to_json(wb.Sheets[sh], { defval: null, raw: true }), sheet: sh, sheets: wb.SheetNames };
};
const up = (s) => (s ?? "").toString().toUpperCase().trim();
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const fmt = (n) => "$" + Math.round(n).toLocaleString("es-CL");

const MARCA_CANON = {
  "KIA": "KIA MOTORS", "KIA MOTORS": "KIA MOTORS", "MG": "MG", "PEUGEOT": "PEUGEOT", "PEUGEOT LIVIANOS": "PEUGEOT",
  "GEELY": "GEELY", "GEELY LIVIANOS": "GEELY", "OPEL": "OPEL", "CITROEN": "CITROEN", "CITROËN": "CITROEN",
  "DFSK": "DFSK", "NISSAN": "NISSAN", "NISSAN FLOTAS": "NISSAN FLOTAS", "SUBARU": "SUBARU", "SUZUKI": "SUZUKI",
  "USADOS": "USADOS", "VU EN NUEVOS": "VU EN NUEVOS", "VU EN USADOS": "VU EN USADOS", "GREAT WALL": "GREAT WALL",
  "DFM": "DFM", "LEAPMOTOR": "LEAPMOTOR", "LANDKING": "LANDKING", "NAMMI": "NAMMI",
};
const canon = (raw) => { if (!raw) return null; const k = up(raw); return MARCA_CANON[k] ?? k; };
const GRUPO = new Set(["KIA MOTORS","MG","GEELY","PEUGEOT","OPEL","CITROEN","DFSK","NISSAN","NISSAN FLOTAS","SUBARU","SUZUKI","GREAT WALL","DFM","LEAPMOTOR","LANDKING","NAMMI"]);
function norm(v) {
  if (v == null || String(v).trim() === "") return "SIN MARCA ORIGEN";
  const c = up(canon(v));
  if (c === "USADOS" || c === "VU EN NUEVOS" || c === "VU EN USADOS") return "USADOS";
  if (GRUPO.has(c)) return c;
  return "OTRAS MARCAS";
}
function esUsado(r) {
  if (up(r["Unidad Negocio"]) === "USADOS") return true;
  if (up(r["Condicion Vehiculo"]).includes("USADO")) return true;
  const mp = up(r["Marca Pompeyo"]);
  return mp === "USADOS" || mp === "VU EN NUEVOS" || mp === "VU EN USADOS";
}
// flags categoría usados
const costo = (r) => num(r[" Costo Neto "] ?? r["Costo Neto"]);
const dias = (r) => num(r["Días Stock"]);
function esVPP(r) {
  const ab = up(r["Stock A/B"]);
  if (ab.includes("JUDICIAL") || ab === "B" || ab === "STOCK B") return false;
  const d = up(r["Estado Dealer"]);
  if (d === "TEST CAR" || d === "TRASPASO A 3RO" || d === "PRE-INSCRITO") return false;
  if (up(r["Estado AutoPro"]) === "PROCESO RETOMA") return true;
  const f = (r["Folio Retoma"] ?? "").toString().trim();
  return up(r["Status Stock"]) === "APROBADA" && f && f !== "0";
}
const esJud = (r) => up(r["Stock A/B"]).includes("JUDICIAL");
const esB = (r) => { const a = up(r["Stock A/B"]); return a === "B" || a === "STOCK B"; };
const esTescar = (r) => up(r["Estado Dealer"]).includes("TEST CAR") || up(r["Condicion Vehiculo"]).includes("TEST CAR");
const esPagado = (r) => up(r["Pagado?"]) === "PAGADO" || up(r["Tipo Stock"]).includes("PROPIO") || up(r["Condicion Vehiculo"]) === "USADO PROPIO PAGADO";
function cat(r) {
  if (esVPP(r)) return "CAPITAL_PUENTE";
  if (esJud(r)) return "JUDICIAL";
  if (esB(r)) return "STOCK_B";
  if (esTescar(r)) return "TESCAR";
  if (esPagado(r) && dias(r) > 180) return "INMOVILIZADO";
  return "STOCK_REAL";
}

// ── STOCK ───────────────────────────────────────────────────────────────
const { rows: stock } = read("Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx", "Base_Stock");
const usados = stock.filter(esUsado);
console.log(`\n══ FILTRO GLOBAL = USADOS · qué devuelve cada fuente (post-fix) ══`);
console.log(`\n▸ STOCK (Base_Stock): ${usados.length} u · ${fmt(usados.reduce((s,r)=>s+costo(r),0))}`);
const byCat = {};
for (const r of usados) { const c = cat(r); (byCat[c] ??= {u:0,cap:0}); byCat[c].u++; byCat[c].cap += costo(r); }
for (const [c,e] of Object.entries(byCat).sort((a,b)=>b[1].cap-a[1].cap))
  console.log(`    ${c.padEnd(16)} ${e.u.toString().padStart(4)} u · ${fmt(e.cap).padStart(18)}`);
const puente = byCat.CAPITAL_PUENTE ?? {u:0,cap:0};
console.log(`    → CAPITAL PUENTE bajo USADOS: ${puente.u} u · ${fmt(puente.cap)}  ${puente.cap>0?"✓ (antes 0)":"✗"}`);

// ── FNE ─────────────────────────────────────────────────────────────────
function tryFNE() {
  const { rows, sheet } = read("Autos no entregados.xlsx");
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const sucCol = cols.find((c)=>up(c).includes("SUCURSAL"));
  // owner FNE = por sucursal (infiere marca grupo, nunca USADOS) → esperamos 0
  const marcaCol = cols.find((c)=>up(c)==="MARCA" || up(c).includes("MARCA"));
  let usadosFne = 0;
  for (const r of rows) {
    const m = marcaCol ? norm(r[marcaCol]) : "SIN MARCA ORIGEN";
    if (m === "USADOS") usadosFne++;
  }
  console.log(`\n▸ FNE (${sheet}): ${rows.length} reg · col sucursal=${sucCol||"—"} · col marca=${marcaCol||"—"}`);
  console.log(`    FNE atribuibles a USADOS: ${usadosFne}  ${usadosFne===0?"→ correcto: el archivo FNE no trae usados":""}`);
}
try { tryFNE(); } catch(e){ console.log("  FNE no leído:", e.message); }

// ── SALDOS ──────────────────────────────────────────────────────────────
function trySaldos() {
  const { rows, sheet, sheets } = read("Reportes Saldos 2.0 18-05-2026_.xlsx", "FUSION BD 3.0");
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const marcaCol = cols.find((c)=>up(c)==="MARCA");
  const vals = new Set();
  let usadosSal = 0;
  for (const r of rows) {
    const raw = marcaCol ? r[marcaCol] : null;
    if (raw) vals.add(up(raw));
    if (norm(raw) === "USADOS") usadosSal++;
  }
  console.log(`\n▸ SALDOS (${sheet} de [${sheets.join(", ")}]): ${rows.length} reg · col marca=${marcaCol||"—"}`);
  console.log(`    Saldos atribuibles a USADOS: ${usadosSal}`);
  console.log(`    ¿Algún valor de Marca contiene "USADO"? ${[...vals].filter(v=>v.includes("USADO")).join(", ")||"NINGUNO → no etiquetan usados como marca"}`);
}
try { trySaldos(); } catch(e){ console.log("  Saldos no leído:", e.message); }

// ── PROVISIONES ──────────────────────────────────────────────────────────
function tryProv() {
  const { rows, sheet } = read("Provisiones al 18 de Mayo.xlsx", "ROMA");
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const origenCol = cols.find((c)=>up(c).includes("ORIGEN")) || cols.find((c)=>up(c).includes("MARCA"));
  let usadosProv = 0;
  const vals = new Set();
  for (const r of rows) {
    const raw = origenCol ? r[origenCol] : null;
    if (raw) vals.add(up(raw));
    if (norm(raw) === "USADOS") usadosProv++;
  }
  console.log(`\n▸ PROVISIONES (${sheet}): ${rows.length} reg · col origen=${origenCol||"—"}`);
  console.log(`    Provisiones atribuibles a USADOS: ${usadosProv}`);
  console.log(`    Valores con "USADO": ${[...vals].filter(v=>v.includes("USADO")).join(", ")||"ninguno"}`);
}
try { tryProv(); } catch(e){ console.log("  Provisiones no leído:", e.message); }

console.log("");
