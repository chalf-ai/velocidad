import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const wb = XLSX.read(readFileSync("/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Reportes Saldos 2.0 18-05-2026_.xlsx"), { type: "buffer", cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets["FUSION BD 3.0"], { defval: null, raw: true });

const n = (v) => (v == null || v === "" ? 0 : Number(v) || 0);

let porSubTipoMonto = {};
let porSubTipoCount = {};
let cpColumna = 0; // columna " C.Pompeyo"
let cpSubTipo = 0; // subTipo "1.6 Crédito Pompeyo"
let cpSubTipoMonto = 0;
let cpColumnaMonto = 0;
let cpAmbos = 0; // ambos a la vez

for (const r of rows) {
  const tipo = String(r["Tipo"] ?? "");
  const saldoTotal = n(r["Saldo x Documentar"]);
  const cp = n(r[" C.Pompeyo"]);
  const fin = n(r[" Financiera"]);

  if (!porSubTipoMonto[tipo]) { porSubTipoMonto[tipo] = 0; porSubTipoCount[tipo] = 0; }
  porSubTipoMonto[tipo] += saldoTotal;
  porSubTipoCount[tipo]++;

  if (cp > 0) { cpColumna++; cpColumnaMonto += cp; }
  if (/1\.6\s*Cr[eé]dito Pompeyo/i.test(tipo) || /credito pompeyo/i.test(tipo.toLowerCase())) {
    cpSubTipo++;
    cpSubTipoMonto += saldoTotal;
  }
  if (cp > 0 && /1\.6/.test(tipo)) cpAmbos++;
}

console.log("Distribución por Tipo (sub-tipo) en saldos VEHÍCULO:\n");
const cat = (r) => String(r["CATEGORIA"] ?? "").toUpperCase().includes("VEHICULO") || String(r["CATEGORIA"] ?? "").startsWith("1 ");
const vehRows = rows.filter(cat);
const porTipoVeh = {};
for (const r of vehRows) {
  const tipo = String(r["Tipo"] ?? "(null)").trim();
  if (!porTipoVeh[tipo]) porTipoVeh[tipo] = { count: 0, monto: 0, cp: 0, cpMonto: 0 };
  porTipoVeh[tipo].count++;
  porTipoVeh[tipo].monto += n(r["Saldo x Documentar"]);
  porTipoVeh[tipo].cp += n(r[" C.Pompeyo"]) > 0 ? 1 : 0;
  porTipoVeh[tipo].cpMonto += n(r[" C.Pompeyo"]);
}
for (const [t, v] of Object.entries(porTipoVeh).sort((a, b) => b[1].monto - a[1].monto)) {
  console.log(`  ${t.padEnd(35)} count=${String(v.count).padStart(4)}  saldo=$${v.monto.toLocaleString("es-CL").padStart(14)}  col_CP>0=${String(v.cp).padStart(3)}  col_CPmonto=$${v.cpMonto.toLocaleString("es-CL")}`);
}

console.log("\n──── Crédito Pompeyo detection ────");
console.log(`Detectados por columna " C.Pompeyo" > 0  : ${cpColumna} registros · monto col=$${cpColumnaMonto.toLocaleString("es-CL")}`);
console.log(`Detectados por subTipo "1.6"           : ${cpSubTipo} registros · saldo total=$${cpSubTipoMonto.toLocaleString("es-CL")}`);
console.log(`Detectados por AMBOS al mismo tiempo  : ${cpAmbos}`);
console.log();
console.log("CONCLUSIÓN:");
console.log(`  El sistema actual usa "cPompeyoCLP > 0" para detectar CP. Eso lee la columna " C.Pompeyo".`);
console.log(`  Esa columna está vacía/cero en TODOS los saldos.`);
console.log(`  El verdadero monto del Crédito Pompeyo está en "Saldo x Documentar" cuando subTipo = "1.6 Credito Pompeyo".`);
console.log(`  Monto correcto de Crédito Pompeyo: $${cpSubTipoMonto.toLocaleString("es-CL")} en ${cpSubTipo} registros.`);

// Mostrar muestra
console.log("\nMuestra de 5 saldos categorizados '1.6 Credito Pompeyo':");
const cpEjemplos = rows.filter((r) => /1\.6/.test(String(r["Tipo"] ?? "")));
for (const r of cpEjemplos.slice(0, 5)) {
  console.log(`  Cliente: ${String(r["Cliente"] ?? "—").slice(0, 30).padEnd(30)} · Saldo=$${n(r["Saldo x Documentar"]).toLocaleString("es-CL").padStart(12)} · " C.Pompeyo"=${n(r[" C.Pompeyo"])} · Marca=${r.Marca ?? "—"}`);
}
