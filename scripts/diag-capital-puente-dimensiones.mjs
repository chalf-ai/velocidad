/**
 * AUDITORÍA · Capital puente / BU en Nuevos — DOS DIMENSIONES.
 *
 * Read-only. Cuantifica, sobre Base_Stock real, cómo se atribuye el capital
 * puente (VPP/BU) según los TRES resolvedores de marca que conviven hoy:
 *   A) getMarcaOperacional  (filtro global)      → todo usado/VPP = USADOS
 *   B) obtenerOwnerOperacional (KIA page)        → VPP = marca originadora (sucursal)
 *   C) capitalTrabajoPorMarca (capital-trabajo)  → marca física del auto
 *
 * No modifica nada. Replica las reglas del parser (deriveEstadoComercial,
 * inferirMarcaOriginadoraDesdeSucursal) para no depender del build.
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const DIR = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";
const wb = XLSX.read(
  readFileSync(DIR + "Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx"),
  { type: "buffer", cellDates: true },
);
const rawRows = XLSX.utils.sheet_to_json(wb.Sheets["Base_Stock"], { defval: null, raw: true });
// El parser real trimea todas las keys (out[k.trim()]=v) — replicamos.
const rows = rawRows.map((r) => {
  const o = {};
  for (const [k, v] of Object.entries(r)) o[k.trim()] = v;
  return o;
});

const up = (s) => (s ?? "").toString().toUpperCase().trim();
const num = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const fmt = (n) => "$" + Math.round(n).toLocaleString("es-CL");
const fmtM = (n) => "$" + (n / 1_000_000).toFixed(1) + "M";

// ── inferirMarcaOriginadoraDesdeSucursal (réplica) ──
const SUC_NO_INFERIBLE = ["LOGISTICA POMPEYO", "SEMINUEVOS", "AUTOSHOPPING", "TEST CARS", "VN CON PATENTE", "CPD"];
const MARCAS_INF = [
  { n: ["KIA"], c: "KIA MOTORS" }, { n: ["MG"], c: "MG" }, { n: ["PEUGEOT"], c: "PEUGEOT" },
  { n: ["GEELY"], c: "GEELY" }, { n: ["DFSK"], c: "DFSK" }, { n: ["SUBARU"], c: "SUBARU" },
  { n: ["NISSAN"], c: "NISSAN" }, { n: ["CITROEN", "CITROËN"], c: "CITROEN" }, { n: ["OPEL"], c: "OPEL" },
  { n: ["LANDKING"], c: "LANDKING" }, { n: ["NAMMI"], c: "NAMMI" }, { n: ["LEAP MOTOR", "LEAPMOTOR"], c: "LEAPMOTOR" },
];
const MARCAS_GRUPO = new Set(["KIA MOTORS","MG","GEELY","PEUGEOT","OPEL","CITROEN","DFSK","NISSAN","NISSAN FLOTAS","SUBARU","SUZUKI","GREAT WALL","DFM","LEAPMOTOR","LANDKING","NAMMI"]);
function inferSuc(suc) {
  if (!suc) return null;
  const u = up(suc);
  if (SUC_NO_INFERIBLE.some((n) => u.includes(n))) return null;
  for (const { n, c } of MARCAS_INF) if (n.some((x) => u.includes(x))) return c;
  return null;
}
// normalizarMarcaOperacional aproximado para marca física
function normFisica(marcaRaw) {
  const c = up(marcaRaw);
  if (!c) return "SIN MARCA ORIGEN";
  if (c.includes("USADO") || c.includes("VU EN")) return "USADOS";
  for (const { n, cc } of MARCAS_INF.map(x => ({ n: x.n, cc: x.c }))) if (n.some((y) => c.includes(y))) return cc;
  if (MARCAS_GRUPO.has(c)) return c;
  return "OTRAS MARCAS";
}

const C = {
  estadoAutoPro: "Estado AutoPro", statusStock: "Status Stock", folioRetoma: "Folio Retoma",
  stockAB: "Stock A/B", estadoDealer: "Estado Dealer", costo: "Costo Neto", sucursal: "Sucursal",
  marcaPompeyo: "Marca Pompeyo", marcaFisica: "Marca", dias: "Días Stock", unidad: "Unidad Negocio",
};

// ── esVPPComprometido (réplica de deriveEstadoComercial) ──
function esVPP(r) {
  const stockAB = up(r[C.stockAB]);
  const dealer = up(r[C.estadoDealer]);
  if (stockAB === "JUDICIAL" || stockAB === "B") return false;
  if (dealer === "TEST CAR" || dealer === "TRASPASO A 3RO" || dealer === "PRE-INSCRITO") return false;
  const ap = (r[C.estadoAutoPro] ?? "").toString();
  const ss = (r[C.statusStock] ?? "").toString();
  const fr = r[C.folioRetoma];
  if (ap === "Proceso Retoma") return true;
  if (ss === "Aprobada" && fr) return true;
  return false;
}

const vpp = rows.filter(esVPP);
const totalCap = vpp.reduce((s, r) => s + num(r[C.costo]), 0);
const totalCostoTotal = vpp.reduce((s, r) => s + num(r["Total Costo"]), 0);
const conCostoNeto = vpp.filter((r) => num(r[C.costo]) > 0).length;
console.log(`\n[debug cost] VPP con 'Costo Neto'>0: ${conCostoNeto}/${vpp.length} · suma CostoNeto=${fmtM(totalCap)} · suma 'Total Costo'=${fmtM(totalCostoTotal)}`);
const dias = vpp.map((r) => num(r[C.dias])).filter((d) => d > 0);
const agingProm = dias.length ? Math.round(dias.reduce((a, b) => a + b, 0) / dias.length) : 0;

console.log(`\n════════ CAPITAL PUENTE (VPP/BU) — UNIVERSO TOTAL ════════`);
console.log(`  Unidades ............. ${vpp.length}`);
console.log(`  Capital (Costo Neto).. ${fmt(totalCap)}  (${fmtM(totalCap)})`);
console.log(`  Aging promedio ....... ${agingProm}d`);
console.log(`  Aging >60d ........... ${vpp.filter((r) => num(r[C.dias]) > 60).length}`);
console.log(`  Aging >180d .......... ${vpp.filter((r) => num(r[C.dias]) > 180).length}`);

// BU nuevos vs usados (Marca Pompeyo)
const buNuevos = vpp.filter((r) => up(r[C.marcaPompeyo]).includes("NUEVO"));
const buUsados = vpp.filter((r) => up(r[C.marcaPompeyo]).includes("USADO"));
console.log(`\n  BU en NUEVOS ......... ${buNuevos.length} u · ${fmtM(buNuevos.reduce((s, r) => s + num(r[C.costo]), 0))}`);
console.log(`  BU en USADOS ......... ${buUsados.length} u · ${fmtM(buUsados.reduce((s, r) => s + num(r[C.costo]), 0))}`);

// ── Dimensión B: por marca ORIGINADORA (sucursal) — KIA page / capital-taxonomia ──
console.log(`\n════════ DIMENSIÓN ORIGINADORA (sucursal marca-específica) ════════`);
console.log(`  [KIA page · obtenerOwnerOperacional · capitalPorMarcaOriginadora]`);
const porOrig = new Map();
for (const r of vpp) {
  const o = inferSuc(r[C.sucursal]) ?? "USADOS (no inferible)";
  const e = porOrig.get(o) ?? { u: 0, cap: 0 };
  e.u++; e.cap += num(r[C.costo]);
  porOrig.set(o, e);
}
for (const [m, e] of [...porOrig.entries()].sort((a, b) => b[1].cap - a[1].cap)) {
  console.log(`  ${m.padEnd(26)} ${String(e.u).padStart(4)} u · ${fmtM(e.cap).padStart(9)}`);
}

// ── Dimensión A: getMarcaOperacional (filtro global) → todo USADOS ──
console.log(`\n════════ DIMENSIÓN OWNER OPERACIONAL (filtro global) ════════`);
console.log(`  [getMarcaOperacional · useDatosFiltrados]`);
console.log(`  USADOS ..................... ${vpp.length} u · ${fmtM(totalCap)}   (100% — colapsa originadora)`);
console.log(`  KIA MOTORS / MG / SUBARU... 0 u · $0.0M   (capital puente DESAPARECE de la marca)`);

// ── Dimensión C: marca FÍSICA (capital-trabajo-marca) ──
console.log(`\n════════ DIMENSIÓN MARCA FÍSICA (capital-trabajo-marca) ════════`);
console.log(`  [v.marca ?? v.marcaPompeyo → normalizarMarcaOperacional]`);
const porFis = new Map();
for (const r of vpp) {
  const m = normFisica(r[C.marcaFisica] ?? r[C.marcaPompeyo]);
  const e = porFis.get(m) ?? { u: 0, cap: 0 };
  e.u++; e.cap += num(r[C.costo]);
  porFis.set(m, e);
}
for (const [m, e] of [...porFis.entries()].sort((a, b) => b[1].cap - a[1].cap)) {
  console.log(`  ${m.padEnd(26)} ${String(e.u).padStart(4)} u · ${fmtM(e.cap).padStart(9)}`);
}

// ── Comparación: ¿la originadora coincide con la física? ──
let coincide = 0, distinta = 0;
for (const r of vpp) {
  const o = inferSuc(r[C.sucursal]);
  const f = normFisica(r[C.marcaFisica] ?? r[C.marcaPompeyo]);
  if (o && o === f) coincide++; else distinta++;
}
console.log(`\n════════ ¿originadora == física? ════════`);
console.log(`  Coinciden .......... ${coincide}`);
console.log(`  Distintas .......... ${distinta}  (el VU físico ≠ marca que lo tomó → atribución divergente)`);
