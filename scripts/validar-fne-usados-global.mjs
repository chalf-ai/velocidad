/**
 * VALIDACIÓN · Filtro global USADOS para FNE tras enriquecer (esUsado).
 * Replica getMarcaOperacional(FNE) post-enriquecimiento:
 *   owner = (esUsado=true | sucursalEsUsados) ? USADOS : marcaPorSucursal
 * donde esUsado = sucursalEsUsados ∪ (VIN cruza stock usado).
 * Confirma 76 y que las marcas nuevas solo pierden FNE que son usados reales.
 * Solo lee. NO modifica.
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
const limpiarVIN = (raw) => raw == null ? "" :
  String(raw).replace(/\s+/g, "").replace(/[-_./]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// owner helpers (réplica owner-operacional)
const GRUPO = new Set(["KIA MOTORS","MG","GEELY","PEUGEOT","OPEL","CITROEN","DFSK","NISSAN","NISSAN FLOTAS","SUBARU","SUZUKI","GREAT WALL","DFM","LEAPMOTOR","LANDKING","NAMMI"]);
const MARCAS_INFERIBLES = [
  { n: ["KIA"], c: "KIA MOTORS" }, { n: ["MG"], c: "MG" }, { n: ["PEUGEOT"], c: "PEUGEOT" },
  { n: ["GEELY"], c: "GEELY" }, { n: ["DFSK"], c: "DFSK" }, { n: ["SUBARU"], c: "SUBARU" },
  { n: ["NISSAN"], c: "NISSAN" }, { n: ["CITROEN", "CITROËN"], c: "CITROEN" }, { n: ["OPEL"], c: "OPEL" },
  { n: ["LANDKING"], c: "LANDKING" }, { n: ["NAMMI"], c: "NAMMI" }, { n: ["LEAP MOTOR", "LEAPMOTOR"], c: "LEAPMOTOR" },
];
const SUC_NO_INF = ["LOGISTICA POMPEYO", "SEMINUEVOS", "AUTOSHOPPING", "TEST CARS", "VN CON PATENTE", "CPD"];
function inferirMarca(suc) {
  if (!suc) return null;
  const u = up(suc);
  if (SUC_NO_INF.some((n) => u.includes(n))) return null;
  for (const { n, c } of MARCAS_INFERIBLES) if (n.some((x) => u.includes(x))) return c;
  return null;
}
function norm(v) {
  if (v == null || String(v).trim() === "") return "SIN MARCA ORIGEN";
  const c = up(v);
  if (GRUPO.has(c)) return c;
  return "OTRAS MARCAS";
}
const marcaPorSucursal = (suc) => norm(inferirMarca(suc));
const SUC_USADOS = ["SEMINUEVO", "USADO", "AUTOSHOPPING", "OUTLET", "CPD"];
const sucursalEsUsados = (suc) => { const u = up(suc); return !!u && SUC_USADOS.some((n) => u.includes(n)); };

// stock usado VIN set
const stock = read("Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx", "Base_Stock");
const esUsadoStock = (r) => up(r["Unidad Negocio"]) === "USADOS" || up(r["Condicion Vehiculo"]).includes("USADO") ||
  ["USADOS", "VU EN NUEVOS", "VU EN USADOS"].includes(up(r["Marca Pompeyo"]));
const usadoVins = new Set();
for (const r of stock) if (esUsadoStock(r)) { const k = limpiarVIN(r["Numero VIN"]); if (k) usadoVins.add(k); }

// FNE
const fne = read("Autos no entregados.xlsx");
const val = (r) => num(r["ValorFactura"]);

let porSuc = 0, porVin = 0, union = 0, unionVal = 0;
const ownerPre = new Map();   // baseline (sin detección usados)
const ownerPost = new Map();  // con enriquecimiento
for (const r of fne) {
  const suc = r["Sucursal"];
  const esSuc = sucursalEsUsados(suc);
  const esVin = usadoVins.has(limpiarVIN(r["Vin"]));
  const esUsado = esSuc || esVin;
  if (esSuc) porSuc++;
  if (esVin) porVin++;
  if (esUsado) { union++; unionVal += val(r); }

  const pre = marcaPorSucursal(suc); // antes de TODO (ni sucursal usados)
  ownerPre.set(pre, (ownerPre.get(pre) ?? 0) + 1);
  const post = esUsado ? "USADOS" : marcaPorSucursal(suc);
  ownerPost.set(post, (ownerPost.get(post) ?? 0) + 1);
}

console.log(`\n══ FNE USADOS · detección ══`);
console.log(`  Por sucursal usados:        ${porSuc}`);
console.log(`  Por VIN→stock usado:        ${porVin}`);
console.log(`  UNIÓN (filtro global post): ${union} FNE · ${fmt(unionVal)}`);
console.log(`  Solo VIN (no sucursal):     ${union - porSuc}  ← los que el enriquecimiento agrega al filtro global`);

console.log(`\n══ FNE por marca: ANTES (solo sucursal-marca) vs DESPUÉS (con USADOS) ══`);
const marcas = new Set([...ownerPre.keys(), ...ownerPost.keys()]);
console.log(`  ${"marca".padEnd(18)} ${"antes".padStart(6)} ${"después".padStart(8)}  Δ`);
for (const m of [...marcas].sort((a, b) => (ownerPost.get(b) ?? 0) - (ownerPost.get(a) ?? 0))) {
  const a = ownerPre.get(m) ?? 0, d = ownerPost.get(m) ?? 0;
  const delta = d - a;
  console.log(`  ${m.padEnd(18)} ${a.toString().padStart(6)} ${d.toString().padStart(8)}  ${delta === 0 ? "—" : delta > 0 ? "+" + delta : delta}`);
}

console.log(`\n══ VALIDACIÓN ══`);
console.log(`  Filtro global USADOS (FNE): ${ownerPost.get("USADOS") ?? 0}  (esperado 76)`);
console.log(`  Monto: ${fmt(unionVal)}  (esperado ≈ $1.003B)`);
console.log(`  Total FNE intacto: ${fne.length} (suma debe cuadrar)`);
const sumaPost = [...ownerPost.values()].reduce((a, b) => a + b, 0);
console.log(`  Suma owner post = ${sumaPost} ${sumaPost === fne.length ? "✓" : "✗ NO CUADRA"}`);
console.log("");
