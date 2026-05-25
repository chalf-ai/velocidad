import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const path = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Provisiones al 18 de Mayo.xlsx";
const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true });
console.log("Hojas:", wb.SheetNames);
console.log("Total hojas:", wb.SheetNames.length);

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  console.log(`\n══ ${name} (range ${ws["!ref"]}) ══`);
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  console.log("Filas crudas:", raw.length);

  // Header row (la fila con más strings)
  let headerRow = -1;
  let maxStrings = 0;
  for (let i = 0; i < Math.min(15, raw.length); i++) {
    const cnt = (raw[i] ?? []).filter((v) => typeof v === "string" && v.length > 0).length;
    if (cnt > maxStrings) { maxStrings = cnt; headerRow = i; }
  }
  console.log("Header probable en fila idx:", headerRow);
  if (headerRow >= 0) {
    console.log("Headers:", (raw[headerRow] ?? []).filter(Boolean).slice(0, 50));
  }

  // Primeras 3 filas crudas
  for (let i = 0; i < Math.min(4, raw.length); i++) {
    console.log(`  r${i}:`, JSON.stringify((raw[i] ?? []).slice(0, 14)));
  }

  // Parse con header
  if (headerRow >= 0) {
    const rows = XLSX.utils.sheet_to_json(ws, { range: headerRow, defval: null, raw: true });
    console.log("Filas parseadas:", rows.length);
    if (rows.length > 0) {
      console.log("\nMuestra registro 1:");
      for (const [k, v] of Object.entries(rows[0])) {
        if (v === null || v === undefined) continue;
        const sv = String(v).slice(0, 80);
        console.log(`  ${String(k).padEnd(35)}: ${sv}`);
      }
      if (rows.length > 5) {
        console.log("\nMuestra registro 5:");
        for (const [k, v] of Object.entries(rows[4])) {
          if (v === null || v === undefined) continue;
          const sv = String(v).slice(0, 80);
          console.log(`  ${String(k).padEnd(35)}: ${sv}`);
        }
      }
    }
  }
}
