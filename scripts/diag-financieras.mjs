import * as XLSX from "xlsx";
import { readFileSync } from "fs";
const wb = XLSX.read(readFileSync("/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx"), { type: "buffer", cellDates: true });

const n = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const s = (v) => (v == null || v === "" ? null : String(v).trim());

// AUX Financiera Linea Autorizada → mapa marca → financiera
const auxRows = XLSX.utils.sheet_to_json(wb.Sheets["AUX Financiera Linea Autorizada"], { defval: null, raw: true });
console.log("AUX columnas:", auxRows.length ? Object.keys(auxRows[0]) : "vacío");
const marcaToFin = new Map();
for (const r of auxRows) {
  const marca = s(r["MARCA"]) ?? s(r["Marca"]);
  const fin = s(r["FINANCIERA"]) ?? s(r["Financiera"]);
  if (marca && fin) marcaToFin.set(marca.toUpperCase(), fin);
}
console.log("\nMapa marca→financiera:", marcaToFin.size, "entradas");
for (const [m, f] of [...marcaToFin].slice(0, 30)) console.log(`  ${m} → ${f}`);

// Líneas de crédito (header en alguna fila)
const lineasRaw = XLSX.utils.sheet_to_json(wb.Sheets["3.-Lineas de Credito"], { header: 1, defval: null, raw: true });
// Detectar la fila de datos: las que tienen marca en col 6 (índice) + montos
console.log("\n--- Líneas de crédito (filas con marca + montos) ---");
const porFinanciera = new Map();
let totalAuth = 0, totalOcup = 0;
for (const row of lineasRaw) {
  if (!row) continue;
  // Buscar marca string y montos
  const marca = s(row[6]); // col G índice 6 según vimos "CITROEN" etc
  const auth = n(row[7]);
  const ocup = n(row[8]);
  const libre = n(row[9]);
  if (!marca || auth <= 0) continue;
  if (/marca|linea|total/i.test(marca)) continue;
  const fin = marcaToFin.get(marca.toUpperCase()) ?? "(sin financiera)";
  if (!porFinanciera.has(fin)) porFinanciera.set(fin, { auth: 0, ocup: 0, libre: 0, marcas: [] });
  const e = porFinanciera.get(fin);
  e.auth += auth;
  e.ocup += ocup;
  e.libre += libre;
  e.marcas.push(marca);
  totalAuth += auth;
  totalOcup += ocup;
  console.log(`  ${marca.padEnd(22)} fin=${(fin).padEnd(20)} auth=$${auth.toLocaleString("es-CL").padStart(15)} ocup=$${ocup.toLocaleString("es-CL").padStart(15)}`);
}

console.log("\n════════ AGREGADO POR FINANCIERA ════════");
const ordenado = [...porFinanciera.entries()].sort((a, b) => b[1].ocup - a[1].ocup);
for (const [fin, e] of ordenado) {
  const sobregiro = e.ocup > e.auth ? e.ocup - e.auth : 0;
  console.log(`  ${fin.padEnd(22)} auth=$${e.auth.toLocaleString("es-CL").padStart(15)} ocup=$${e.ocup.toLocaleString("es-CL").padStart(15)} libre=$${(e.auth - e.ocup).toLocaleString("es-CL").padStart(15)} ${sobregiro > 0 ? "SOBREGIRO $" + sobregiro.toLocaleString("es-CL") : ""}`);
  console.log(`     marcas: ${e.marcas.join(", ")}`);
}
console.log(`\n  TOTAL auth=$${totalAuth.toLocaleString("es-CL")} ocup=$${totalOcup.toLocaleString("es-CL")}`);
