import * as XLSX from "xlsx";
import { readFileSync } from "fs";
const wb = XLSX.read(readFileSync("/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx"), { type: "buffer", cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets["Base_Stock"], { defval: null, raw: true });
const cols = Object.keys(rows[0]);
const cost = cols.filter((c) => /cost/i.test(c));
console.log("Cost cols:", cost.map((c) => `[${c}]`));
const r = rows[0];
for (const c of cost) console.log(`  ${c}:`, r[c]);
