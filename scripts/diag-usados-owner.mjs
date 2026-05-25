/**
 * BLAST RADIUS · ¿Qué pasa si USADOS pasa a ser una marca operacional normal?
 *
 * Hoy getMarcaOperacional(vehiculo) = normalizarMarcaOperacional(marcaOriginadora).
 * Para los usados, la marcaOriginadora se deriva así (deriveMarcaOriginadora):
 *   - VPP/CPD/VENTA → inferida por sucursal (KIA, MG, …) o null
 *   - retail/inmovilizado → marcaPompeyo (USADOS / VU en… → USADOS)
 * Por eso muchos usados (capital puente, usados con marca física) NO quedan como
 * owner=USADOS: se reparten en KIA/MG/etc o SIN MARCA ORIGEN.
 *
 * Propuesta: si esUsadoOperacional(v) → owner = USADOS (antes que marcaOriginadora).
 * Este script mide EXACTAMENTE cuántas unidades / cuánto capital se mueven y de
 * qué marca salen. Solo lee el Excel real. NO modifica nada.
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const DIR = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";
const wb = XLSX.read(
  readFileSync(DIR + "Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx"),
  { type: "buffer", cellDates: true },
);
const rows = XLSX.utils.sheet_to_json(wb.Sheets["Base_Stock"], { defval: null, raw: true });

const clean = (x) => {
  if (x == null) return null;
  const s = String(x).trim();
  return s === "" || s === "#N/A" ? null : s;
};
const up = (s) => (s ?? "").toString().toUpperCase().trim();
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const costo = (r) => num(r[" Costo Neto "] ?? r["Costo Neto"]);
const fmt = (n) => "$" + Math.round(n).toLocaleString("es-CL");

// ── canonicalMarca (subset suficiente) ────────────────────────────────────
const MARCA_CANON = {
  "KIA": "KIA MOTORS", "KIA MOTORS": "KIA MOTORS", "MG": "MG", "PEUGEOT": "PEUGEOT",
  "PEUGEOT LIVIANOS": "PEUGEOT", "GEELY": "GEELY", "GEELY LIVIANOS": "GEELY", "OPEL": "OPEL",
  "CITROEN": "CITROEN", "CITROËN": "CITROEN", "DFSK": "DFSK", "NISSAN": "NISSAN",
  "NISSAN FLOTAS": "NISSAN FLOTAS", "SUBARU": "SUBARU", "SUZUKI": "SUZUKI", "CHEVROLET": "CHEVROLET",
  "HYUNDAI": "HYUNDAI", "LEAPMOTOR": "LEAPMOTOR", "CHERY": "CHERY", "LANDKING": "LANDKING",
  "LANDKING CAMIONES": "LANDKING", "NAMMI": "NAMMI", "DFM": "DFM", "DONGFENG": "NAMMI",
  "DONGFENG/NAMMI": "NAMMI", "GREAT WALL": "GREAT WALL", "USADOS": "USADOS",
  "VU EN NUEVOS": "VU EN NUEVOS", "VU EN USADOS": "VU EN USADOS",
};
const canon = (raw) => { if (!raw) return null; const k = up(raw); return MARCA_CANON[k] ?? k; };

const MARCAS_GRUPO = new Set([
  "KIA MOTORS", "MG", "GEELY", "PEUGEOT", "OPEL", "CITROEN", "DFSK", "NISSAN",
  "NISSAN FLOTAS", "SUBARU", "SUZUKI", "GREAT WALL", "DFM", "LEAPMOTOR", "LANDKING", "NAMMI",
]);

function normalizarMarcaOperacional(valor) {
  if (valor == null || String(valor).trim() === "") return "SIN MARCA ORIGEN";
  const c = up(canon(valor));
  if (c === "USADOS" || c === "VU EN NUEVOS" || c === "VU EN USADOS") return "USADOS";
  if (c === "OTRAS MARCAS") return "OTRAS MARCAS";
  if (MARCAS_GRUPO.has(c)) return c;
  return "OTRAS MARCAS";
}

// ── inferirMarcaOriginadoraDesdeSucursal ──────────────────────────────────
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

// ── esVPPComprometido + estadoCapital (subset) ────────────────────────────
function esVPP(r) {
  const stockAB = up(r["Stock A/B"]);
  if (stockAB.includes("JUDICIAL")) return false;
  if (stockAB === "B" || stockAB === "STOCK B") return false;
  const dealer = up(r["Estado Dealer"]);
  if (dealer === "TEST CAR" || dealer === "TRASPASO A 3RO" || dealer === "PRE-INSCRITO") return false;
  if (up(r["Estado AutoPro"]) === "PROCESO RETOMA") return true;
  const folio = clean(r["Folio Retoma"]);
  if (up(r["Status Stock"]) === "APROBADA" && folio && folio !== "0") return true;
  return false;
}
function estadoCapital(r) {
  if (esVPP(r)) return "VPP_EXPLICITO";
  const stockAB = up(r["Stock A/B"]);
  if (stockAB.includes("JUDICIAL") || stockAB === "B" || stockAB === "STOCK B") return "INMOVILIZADO";
  const dealer = up(r["Estado Dealer"]);
  if (dealer === "TEST CAR" || dealer === "TRASPASO A 3RO") return "INMOVILIZADO";
  if (up(r["Condicion Vehiculo"]) === "USADO PROPIO PAGADO") return "USADO_PAGADO_INMOVIL";
  const autopro = up(r["Estado AutoPro"]);
  const status = up(r["Status Stock"]);
  if (autopro === "VENDIDO" && (status === "VIGENTE" || status === "APROBADA")) return "FNE_EN_OPERACION";
  const flujo = up(r["Marca Pompeyo C."]);
  if (flujo === "PROCESO DE VENTA") return "PROCESO_VENTA";
  if (flujo === "PROCESO CPD") return "PROCESO_CPD";
  return "OTRO";
}

// ── deriveMarcaOriginadora ────────────────────────────────────────────────
function marcaOriginadora(r) {
  const ec = estadoCapital(r);
  const mp = canon(clean(r["Marca Pompeyo"]) ?? clean(r["Marca"]));
  const suc = clean(r["Sucursal"]);
  if (ec === "FNE_EN_OPERACION") return mp ?? null;
  if (ec === "VPP_EXPLICITO" || ec === "PROCESO_CPD" || ec === "PROCESO_VENTA") {
    return inferirMarca(suc); // o null
  }
  return mp ?? null;
}
const ownerActual = (r) => normalizarMarcaOperacional(marcaOriginadora(r));

// ── esUsadoOperacional ────────────────────────────────────────────────────
function esUsado(r) {
  if (up(r["Unidad Negocio"]) === "USADOS") return true;
  if (up(r["Condicion Vehiculo"]).includes("USADO")) return true;
  const mp = up(r["Marca Pompeyo"]);
  return mp === "USADOS" || mp === "VU EN NUEVOS" || mp === "VU EN USADOS";
}

// ═══════════════════════════════════════════════════════════════════════════
const usados = rows.filter(esUsado);
console.log(`\n══ Universo físico USADOS: ${usados.length} u · ${fmt(usados.reduce((s, r) => s + costo(r), 0))} ══`);

// 1. Owner ACTUAL de los usados (cómo se reparten hoy)
const ownerDist = new Map();
for (const r of usados) {
  const o = ownerActual(r);
  const e = ownerDist.get(o) ?? { u: 0, cap: 0 };
  e.u++; e.cap += costo(r); ownerDist.set(o, e);
}
console.log(`\n── Owner ACTUAL de los usados (a quién se atribuyen hoy) ──`);
for (const [o, e] of [...ownerDist.entries()].sort((a, b) => b[1].cap - a[1].cap))
  console.log(`  ${o.padEnd(20)} ${e.u.toString().padStart(4)} u · ${fmt(e.cap).padStart(18)}`);

const yaUsados = ownerDist.get("USADOS") ?? { u: 0, cap: 0 };
const seMueven = usados.length - yaUsados.u;
const capMueve = usados.reduce((s, r) => s + costo(r), 0) - yaUsados.cap;
console.log(`\n  → Ya owner=USADOS hoy: ${yaUsados.u} u · ${fmt(yaUsados.cap)}`);
console.log(`  → SE MOVERÍAN a USADOS: ${seMueven} u · ${fmt(capMueve)}`);

// 2. De qué marca de grupo salen (blast radius por marca)
console.log(`\n── Capital que SALE de cada marca hacia USADOS (con la propuesta) ──`);
for (const [o, e] of [...ownerDist.entries()].filter(([k]) => k !== "USADOS").sort((a, b) => b[1].cap - a[1].cap))
  console.log(`  ${o.padEnd(20)} -${e.u.toString().padStart(4)} u · -${fmt(e.cap)}`);

// 3. ¿Cuántos de los que se mueven son CAPITAL PUENTE?
const puente = usados.filter(esVPP);
const puenteNoUsadosOwner = puente.filter((r) => ownerActual(r) !== "USADOS");
console.log(`\n── Capital puente (VPP) dentro de usados ──`);
console.log(`  Total capital puente usados: ${puente.length} u · ${fmt(puente.reduce((s, r) => s + costo(r), 0))}`);
console.log(`  De esos, hoy NO son owner=USADOS: ${puenteNoUsadosOwner.length} u · ${fmt(puenteNoUsadosOwner.reduce((s, r) => s + costo(r), 0))}`);
const puenteOwner = new Map();
for (const r of puenteNoUsadosOwner) {
  const o = ownerActual(r);
  puenteOwner.set(o, (puenteOwner.get(o) ?? 0) + 1);
}
console.log(`  Owner actual del puente que se movería:`);
for (const [o, u] of [...puenteOwner.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`     ${o.padEnd(18)} ${u} u`);

// 4. KIA antes/después (owner global, todos los vehículos)
function kiaResumen(excluirUsados) {
  let u = 0, cap = 0;
  for (const r of rows) {
    if (excluirUsados && esUsado(r)) continue;
    const o = excluirUsados && esUsado(r) ? "USADOS" : ownerActual(r);
    if (o === "KIA MOTORS") { u++; cap += costo(r); }
  }
  return { u, cap };
}
const kiaAntes = kiaResumen(false);
const kiaDespues = kiaResumen(true);
console.log(`\n── KIA MOTORS como owner (impacto) ──`);
console.log(`  ANTES (usados cuentan):   ${kiaAntes.u} u · ${fmt(kiaAntes.cap)}`);
console.log(`  DESPUÉS (usados→USADOS):  ${kiaDespues.u} u · ${fmt(kiaDespues.cap)}`);
console.log(`  Δ KIA: -${kiaAntes.u - kiaDespues.u} u · -${fmt(kiaAntes.cap - kiaDespues.cap)}`);

console.log("");
