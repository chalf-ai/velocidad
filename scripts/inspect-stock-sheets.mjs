import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const path = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx";
const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true });
console.log("Hojas:", wb.SheetNames);

const SHEETS_OF_INTEREST = [
  "Base_Stock",
  "DETALLE STOCK PROPIO",
  "4.-Venc Stock con Financ",
  "3.-Lineas de Credito",
  "Detalle1",
];

for (const name of SHEETS_OF_INTEREST) {
  const ws = wb.Sheets[name];
  if (!ws) { console.log(`\n--- ${name}: NO ENCONTRADA ---`); continue; }
  console.log(`\n--- ${name} ---`);
  console.log("Range:", ws["!ref"]);
  // Probar parse con varios header positions
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
  console.log("Filas (header default):", rows.length);
  if (rows.length > 0) {
    console.log("Columnas:", Object.keys(rows[0]).slice(0, 50));
  }
  // Buscar VINs en las primeras filas crudas
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  console.log("Primeras 3 filas crudas (10 primeras cols):");
  for (let i = 0; i < Math.min(3, raw.length); i++) {
    const r = raw[i];
    console.log(`  r${i}:`, JSON.stringify((r ?? []).slice(0, 10)));
  }
}
