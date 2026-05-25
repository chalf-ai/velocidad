import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const wb = XLSX.read(readFileSync("/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Cruce Saldos.xlsx"), { type: "buffer" });
const nm = XLSX.utils.sheet_to_json(wb.Sheets["Saldos_No_Cruzados"]);

console.log("Sin match:", nm.length, "\n");

// Largo Cajón
const porLargo = {};
for (const r of nm) porLargo[r["Largo Cajón"] ?? 0] = (porLargo[r["Largo Cajón"] ?? 0] ?? 0) + 1;
console.log("Por largo Cajón:", porLargo, "\n");

// Sin Cajón: clientes
const sinCajon = nm.filter((r) => !r["Largo Cajón"]);
const clientesUnicos = {};
for (const r of sinCajon) clientesUnicos[r.Cliente ?? "(sin)"] = (clientesUnicos[r.Cliente ?? "(sin)"] ?? 0) + 1;
const topClientes = Object.entries(clientesUnicos).sort((a, b) => b[1] - a[1]).slice(0, 30);
console.log("Top 30 clientes en SIN MATCH y sin Cajón:");
for (const [c, n] of topClientes) console.log(`  ${n.toString().padStart(4)}  ${c}`);

// Con Cajón pero no cruza (largo 6,7,8)
const conCajon = nm.filter((r) => r["Largo Cajón"] >= 6);
console.log(`\nCon Cajón (≥6 chars) pero sin match: ${conCajon.length}`);
console.log("Muestra (primeros 30):");
for (const r of conCajon.slice(0, 30)) {
  console.log(`  Cajón=${(r["Cajón saldos"] || "—").padEnd(15)} largo=${r["Largo Cajón"]} marca=${(r.Marca || "—").padEnd(12)} cliente=${(r.Cliente || "—").slice(0, 35).padEnd(35)} saldo=${(r.Saldo || 0).toLocaleString("es-CL")}`);
}
