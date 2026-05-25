/**
 * VERIFICACIÓN · cruce Capital puente (VU/BU) ↔ operación nueva (FNE) por PatenteVpp.
 * Read-only. Confirma cuántos VU/BU cruzan con su operación nueva originadora.
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";
const DIR = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";

const wbS = XLSX.read(readFileSync(DIR + "Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx"), { type: "buffer", cellDates: true });
const stock = XLSX.utils.sheet_to_json(wbS.Sheets["Base_Stock"], { defval: null, raw: true }).map((r) => { const o = {}; for (const [k, v] of Object.entries(r)) o[k.trim()] = v; return o; });
const wbF = XLSX.read(readFileSync(DIR + "Autos no entregados.xlsx"), { type: "buffer", cellDates: true });
const fne = XLSX.utils.sheet_to_json(wbF.Sheets["ROMA"], { defval: null, raw: true });

const up = (s) => (s ?? "").toString().toUpperCase().trim();
const normPat = (p) => up(p).replace(/[^A-Z0-9]/g, "");
function esVPP(r) {
  const ab = up(r["Stock A/B"]), d = up(r["Estado Dealer"]);
  if (ab === "JUDICIAL" || ab === "B") return false;
  if (["TEST CAR", "TRASPASO A 3RO", "PRE-INSCRITO"].includes(d)) return false;
  if ((r["Estado AutoPro"] ?? "") === "Proceso Retoma") return true;
  if ((r["Status Stock"] ?? "") === "Aprobada" && r["Folio Retoma"]) return true;
  return false;
}
const vpp = stock.filter(esVPP);

// índice FNE por patenteVpp normalizada
const fnePorPat = new Map();
let fneConPatVpp = 0;
for (const f of fne) {
  const p = normPat(f["PatenteVpp"]);
  if (!p) continue;
  fneConPatVpp++;
  if (!fnePorPat.has(p)) fnePorPat.set(p, f);
}

let cruzan = 0, sinVinculo = 0;
const ejemplos = [];
for (const v of vpp) {
  const p = normPat(v["Placa Patente"]);
  const f = p ? fnePorPat.get(p) : null;
  if (f) { cruzan++; if (ejemplos.length < 4) ejemplos.push({ vu: v, f }); }
  else sinVinculo++;
}

console.log(`\n════ CRUCE Capital puente ↔ operación nueva (FNE.PatenteVpp) ════`);
console.log(`  VU/BU (capital puente) ........ ${vpp.length}`);
console.log(`  FNE con PatenteVpp poblada ..... ${fneConPatVpp} de ${fne.length}`);
console.log(`  ✔ cruzan con operación nueva ... ${cruzan}`);
console.log(`  ✗ sin vínculo .................. ${sinVinculo}`);
console.log(`\n── Ejemplos de cruce ──`);
for (const { vu, f } of ejemplos) {
  console.log(`  VU pat=${vu["Placa Patente"]} (${vu["Marca"]}) · sucursal=${vu["Sucursal"]}`);
  console.log(`    → FNE nuevo: VIN=${f["Vin"] ?? f["VIN"]} · cliente=${f["Cliente"] ?? f["Nombre Cliente"] ?? "?"} · suc=${f["Sucursal"] ?? "?"}`);
}
// columnas FNE disponibles (para mapear cliente/vin)
console.log(`\n── Columnas FNE (muestra) ──`);
console.log("  " + Object.keys(fne[0] ?? {}).slice(0, 30).join(" · "));
