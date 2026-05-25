// AUDITORÍA de "Marca Operacional" basada en marcaOriginadora (= "Marca origen"
// del Stock Explorer). Replica FIELMENTE deriveMarcaOriginadora del parser.
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const DIR = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";
const wb = XLSX.read(readFileSync(DIR + "Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx"), { type: "buffer", cellDates: true });
const raw = XLSX.utils.sheet_to_json(wb.Sheets["Base_Stock"], { defval: null, raw: true });
const rows = raw.map((r) => { const o = {}; for (const [k, v] of Object.entries(r)) o[k.trim()] = v; return o; });

const up = (v) => (v == null ? "" : String(v)).toUpperCase().trim();
const num = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const fmt = (n) => "$" + Math.round(n).toLocaleString("es-CL");

// canonicalMarca (MARCA_CANON de normalize.ts)
const MARCA_CANON = { KIA: "KIA MOTORS", "KIA MOTORS": "KIA MOTORS", MG: "MG", PEUGEOT: "PEUGEOT", "PEUGEOT LIVIANOS": "PEUGEOT", GEELY: "GEELY", "GEELY LIVIANOS": "GEELY", OPEL: "OPEL", CITROEN: "CITROEN", "CITROËN": "CITROEN", DFSK: "DFSK", NISSAN: "NISSAN", "NISSAN FLOTAS": "NISSAN FLOTAS", SUBARU: "SUBARU", SUZUKI: "SUZUKI", CHEVROLET: "CHEVROLET", HYUNDAI: "HYUNDAI", LEAPMOTOR: "LEAPMOTOR", CHERY: "CHERY", LANDKING: "LANDKING", "LANDKING CAMIONES": "LANDKING", NAMMI: "NAMMI", DFM: "DFM", DONGFENG: "NAMMI", "DONGFENG/NAMMI": "NAMMI", "GREAT WALL": "GREAT WALL", USADOS: "USADOS", "VU EN NUEVOS": "VU EN NUEVOS", "VU EN USADOS": "VU EN USADOS" };
const canon = (rawV) => { if (!rawV) return null; const k = up(rawV); return MARCA_CANON[k] ?? k; };

// inferSucursal (normalize.ts)
const MARCAS_INF = [["KIA", "KIA MOTORS"], ["MG", "MG"], ["PEUGEOT", "PEUGEOT"], ["GEELY", "GEELY"], ["DFSK", "DFSK"], ["SUBARU", "SUBARU"], ["NISSAN", "NISSAN"], ["CITROEN", "CITROEN"], ["OPEL", "OPEL"], ["LANDKING", "LANDKING"], ["NAMMI", "NAMMI"], ["LEAP MOTOR", "LEAPMOTOR"]];
const NO_INF = ["LOGISTICA POMPEYO", "SEMINUEVOS", "AUTOSHOPPING", "TEST CARS", "VN CON PATENTE", "CPD"];
const inferSuc = (s) => { const u = up(s); if (!u) return null; if (NO_INF.some((n) => u.includes(n))) return null; for (const [n, c] of MARCAS_INF) if (u.includes(n)) return c; return null; };

const esVPP = (r) => { const ap = up(r["Estado AutoPro"]), ss = up(r["Status Stock"]), f = r["Folio Retoma"]; const tf = f != null && String(f).trim() !== "" && String(f).trim() !== "0"; return ap === "PROCESO RETOMA" || (ss === "APROBADA" && tf); };
const stockAB = (r) => { const v = up(r["Stock A/B"]); if (v.includes("JUDICIAL")) return "Judicial"; if (v === "B") return "B"; return "A"; };

function estadoCapital(r) {
  if (esVPP(r)) return "VPP_EXPLICITO";
  const ab = stockAB(r), dealer = up(r["Estado Dealer"]), condV = up(r["Condicion Vehiculo"]);
  const ap = up(r["Estado AutoPro"]), ss = up(r["Status Stock"]), flujo = up(r["Marca Pompeyo C."]);
  if (ab === "JUDICIAL" || ab === "B") return "INMOVILIZADO";
  if (dealer === "TEST CAR" || dealer === "TRASPASO A 3RO") return "INMOVILIZADO";
  if (condV === "USADO PROPIO PAGADO") return "USADO_PAGADO_INMOVIL";
  if (ap === "VENDIDO" && (ss === "VIGENTE" || ss === "APROBADA")) return "FNE_EN_OPERACION";
  if (flujo === "PROCESO DE VENTA") return "PROCESO_VENTA";
  if (flujo === "PROCESO CPD") return "PROCESO_CPD";
  return "RETAIL_OTRO";
}

// deriveMarcaOriginadora (base-stock.ts)
function marcaOriginadora(r) {
  const ec = estadoCapital(r);
  const mp = canon(r["Marca Pompeyo"] ?? r["Marca"]);
  if (ec === "FNE_EN_OPERACION") return mp;
  if (ec === "VPP_EXPLICITO" || ec === "PROCESO_CPD" || ec === "PROCESO_VENTA") return inferSuc(r["Sucursal"]);
  return mp;
}

// normalizarMarcaOperacional (espejo de owner-operacional.ts)
const SIN_MARCA = "SIN MARCA ORIGEN";
const USADOS = "USADOS";
const OTRAS = "OTRAS MARCAS";
const MARCAS_GRUPO = new Set([
  "KIA MOTORS", "MG", "GEELY", "PEUGEOT", "OPEL", "CITROEN", "DFSK",
  "NISSAN", "NISSAN FLOTAS", "SUBARU", "SUZUKI", "GREAT WALL", "DFM",
  "LEAPMOTOR", "LANDKING", "NAMMI",
]);
function normalizar(valor) {
  if (valor == null || String(valor).trim() === "") return SIN_MARCA;
  const c = up(canon(valor));
  if (c === "USADOS" || c === "VU EN NUEVOS" || c === "VU EN USADOS") return USADOS;
  if (c === "OTRAS MARCAS") return OTRAS;
  if (MARCAS_GRUPO.has(c)) return c;
  return OTRAS; // marca ajena al grupo (HYUNDAI, GAC, VW, etc.) → OTRAS MARCAS
}

// categoría operacional (orthogonal a marca)
function categoria(r) {
  if (esVPP(r)) return "capital_puente";
  const cond = up(r["Condicion de Stock"]), condV = up(r["Condicion Vehiculo"]), tipo = up(r["Tipo de Stock"]), auxTM = up(r["AUX TM"]);
  if (cond.includes("RENTING")) return "no_retail";
  if (cond.includes("COMPANY") || tipo.includes("COMPAÑ") || tipo.includes("COMPAN")) return "no_retail";
  if (auxTM === "VDR") return "no_retail";
  if (cond.includes("TEST CAR") || condV.includes("TEST CAR EN USO")) return "no_retail";
  return "stock_retail";
}

const inc = (m, k, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
const tally = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);

let total = 0, sinMarca = 0, fisDistOper = 0;
const dist = new Map(), distMonto = new Map();
// KIA detalle
let kiaTotal = 0, kiaStock = 0, kiaPuente = 0, kiaNoRetail = 0;
let kiaStockMonto = 0, kiaPuenteMonto = 0;
const kiaFisicaNoOper = new Map();   // físico KIA que NO es operacional KIA
const kiaOperNoFisica = new Map();   // operacional KIA que NO es físico KIA

for (const r of rows) {
  if (!r["Numero VIN"]) continue;
  total++;
  const oper = normalizar(marcaOriginadora(r));
  const fisica = normalizar(r["Marca Pompeyo"] ?? r["Marca"]);
  const cat = categoria(r);
  const costo = num(r["Costo Neto"]);
  inc(dist, oper); inc(distMonto, oper, costo);
  if (oper === SIN_MARCA) sinMarca++;
  if (oper !== fisica && oper !== SIN_MARCA) fisDistOper++;
  if (oper === "KIA MOTORS") {
    kiaTotal++;
    if (cat === "capital_puente") { kiaPuente++; kiaPuenteMonto += costo; }
    else if (cat === "no_retail") kiaNoRetail++;
    else { kiaStock++; kiaStockMonto += costo; }
    if (!up(r["Marca Pompeyo"] ?? r["Marca"]).includes("KIA")) inc(kiaOperNoFisica, fisica);
  }
  if (up(r["Marca Pompeyo"] ?? r["Marca"]).includes("KIA") && oper !== "KIA MOTORS") inc(kiaFisicaNoOper, oper);
}

console.log(`\n══ AUDITORÍA MARCA OPERACIONAL (Base_Stock: ${total} VIN) ══`);
console.log(`\n── Distribución por marca operacional ──`);
for (const [k, n] of tally(dist)) console.log(`  ${String(k).padEnd(22)} ${String(n).padStart(5)}   ${fmt(distMonto.get(k) ?? 0)}`);
console.log(`\nSin marca origen: ${sinMarca}`);
console.log(`Marca física ≠ marca operacional: ${fisDistOper}`);

console.log(`\n── KIA (operacional) ──`);
console.log(`  Total: ${kiaTotal}`);
console.log(`  Stock retail:   ${kiaStock}  ${fmt(kiaStockMonto)}`);
console.log(`  Capital puente: ${kiaPuente}  ${fmt(kiaPuenteMonto)}`);
console.log(`  No retail:      ${kiaNoRetail}`);
console.log(`\n  Físicos KIA que NO son operacional KIA (van a):`);
for (const [k, n] of tally(kiaFisicaNoOper)) console.log(`     ${String(k).padEnd(22)} ${n}`);
console.log(`  Operacional KIA con marca física NO-KIA (parte de pago):`);
for (const [k, n] of tally(kiaOperNoFisica)) console.log(`     ${String(k).padEnd(22)} ${n}`);
