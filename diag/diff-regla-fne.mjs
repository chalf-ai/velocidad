#!/usr/bin/env node
/**
 * Cuántos VINs CAMBIAN de estado entre la regla vieja vs la nueva?
 *
 * Regla VIEJA: entregado = entrega_auto ∈ {Si,Sí,yes,true,1}
 * Regla NUEVA: entregado = entrega_auto_txt === "Cargado"
 *
 * Identifica:
 *  - VINs que antes eran NO entregados y ahora SÍ → desaparecerían del FNE
 *  - VINs que antes eran entregados y ahora NO → reaparecen
 *  - VINs que mantienen estado en ambas reglas
 */
import XLSX from "xlsx";

const FILE = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Actas al 28 de Mayo.xlsx";
const wb = XLSX.readFile(FILE, { cellDates: true });
const ws = wb.Sheets["ROMA"];
const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });

function reglaVieja(r) {
  const s = String(r["entrega_auto"] ?? "").trim().toLowerCase();
  return s === "si" || s === "sí" || s === "yes" || s === "true" || s === "1";
}
function reglaNueva(r) {
  const t = String(r["entrega_auto_txt"] ?? "").trim();
  return t === "Cargado";
}

let total = 0;
let viejaSi = 0, viejaNo = 0;
let nuevaSi = 0, nuevaNo = 0;
let ambasSi = 0, ambasNo = 0;
let soloVieja = 0;     // antes entregado, ahora no
let soloNueva = 0;     // antes no entregado, ahora sí

for (const r of rows) {
  if (!r["Vin"]) continue;
  total++;
  const v = reglaVieja(r);
  const n = reglaNueva(r);
  if (v) viejaSi++; else viejaNo++;
  if (n) nuevaSi++; else nuevaNo++;
  if (v && n) ambasSi++;
  if (!v && !n) ambasNo++;
  if (v && !n) soloVieja++;
  if (!v && n) soloNueva++;
}

console.log("════════════════════════════════════════════════════════════════════════");
console.log("  COMPARATIVA REGLA VIEJA vs NUEVA — efecto por VIN");
console.log("════════════════════════════════════════════════════════════════════════");
console.log(`  Total filas con VIN: ${total}`);
console.log("");
console.log(`  Regla VIEJA (entrega_auto in {Si,Sí,...}):`);
console.log(`    Entregados (verdad):     ${viejaSi}`);
console.log(`    NO entregados:           ${viejaNo}`);
console.log("");
console.log(`  Regla NUEVA (entrega_auto_txt === "Cargado"):`);
console.log(`    Entregados (verdad):     ${nuevaSi}`);
console.log(`    NO entregados:           ${nuevaNo}`);
console.log("");
console.log(`  Cruce:`);
console.log(`    Coinciden ENTREGADOS:     ${ambasSi}`);
console.log(`    Coinciden NO ENTREGADOS:  ${ambasNo}`);
console.log(`    SOLO vieja decía SÍ:      ${soloVieja}  (antes excluidos, ahora aparecen)`);
console.log(`    SOLO nueva dice SÍ:       ${soloNueva}  (antes aparecían, ahora se excluyen)`);
console.log("");
console.log("  Conclusión: si SoloNueva = 0, ningún VIN que antes aparecía ahora desaparece");
console.log("════════════════════════════════════════════════════════════════════════");
