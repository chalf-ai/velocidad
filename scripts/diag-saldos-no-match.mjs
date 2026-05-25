import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const path = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Cruce Saldos.xlsx";
const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true });
const nm = XLSX.utils.sheet_to_json(wb.Sheets["Saldos_No_Cruzados"]);

console.log("Total sin match:", nm.length);

// Distribución por largo de Cajón
const porLargo = {};
for (const r of nm) {
  const l = r["Largo Cajón"] || 0;
  porLargo[l] = (porLargo[l] ?? 0) + 1;
}
console.log("\nDistribución por largo de Cajón:");
for (const k of Object.keys(porLargo).sort((a, b) => Number(a) - Number(b))) {
  console.log(`  largo ${k}: ${porLargo[k]}`);
}

// Distribución por categoría
const porCat = {};
for (const r of nm) {
  const c = r["Categoría"] ?? "(sin cat)";
  porCat[c] = (porCat[c] ?? 0) + 1;
}
console.log("\nDistribución por categoría:");
for (const [k, v] of Object.entries(porCat).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(50)} ${v}`);
}

// Top 20 sin match con saldo más alto
const top = [...nm].sort((a, b) => (b.Saldo || 0) - (a.Saldo || 0)).slice(0, 20);
console.log("\nTop 20 por saldo:");
for (const r of top) {
  console.log(`  Cajón=${(r["Cajón saldos"] || "—").padEnd(15)} largo=${r["Largo Cajón"]}  marca=${(r.Marca || "—").padEnd(12)} cliente=${(r.Cliente || "—").slice(0, 30).padEnd(30)} saldo=${(r.Saldo || 0).toLocaleString("es-CL")}`);
}

// Muestra de 20 Cajones únicos
const samples = [...new Set(nm.map((r) => r["Cajón saldos"]))].slice(0, 30);
console.log("\nMuestra de Cajones sin match (30):");
for (const c of samples) console.log(`  "${c}"`);
