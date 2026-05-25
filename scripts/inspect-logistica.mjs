/**
 * AUDITORÍA ESTRUCTURAL · Logistica.xlsx + Diciembre-Mayo ROMA.xlsx
 * No asume estructura. Reporta hojas, columnas, tipos, fill rate, fechas, IDs.
 * Solo lee.
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const DIR = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";

function inspectFile(fname) {
  console.log(`\n\n══════════════════════════════════════════════════════════════`);
  console.log(`  ARCHIVO: ${fname}`);
  console.log(`══════════════════════════════════════════════════════════════`);
  const wb = XLSX.read(readFileSync(DIR + fname), { type: "buffer", cellDates: true });
  console.log(`  Hojas (${wb.SheetNames.length}): ${wb.SheetNames.join(" · ")}`);

  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null, raw: true });
    console.log(`\n┌─ HOJA "${sheetName}" · ${rows.length} filas ──────────────────`);
    if (rows.length === 0) { console.log("│  (vacía)"); continue; }
    const cols = Object.keys(rows[0]);
    console.log(`│  Columnas (${cols.length}):`);

    for (const c of cols) {
      let nNull = 0, nDate = 0, nNum = 0, nStr = 0, nBool = 0;
      const samples = [];
      for (const r of rows) {
        const v = r[c];
        if (v === null || v === undefined || v === "") { nNull++; continue; }
        if (v instanceof Date) nDate++;
        else if (typeof v === "number") nNum++;
        else if (typeof v === "boolean") nBool++;
        else nStr++;
        if (samples.length < 3 && !samples.includes(v)) {
          samples.push(v instanceof Date ? v.toISOString().slice(0, 10) : v);
        }
      }
      const fill = Math.round(((rows.length - nNull) / rows.length) * 100);
      const tipo = nDate > nNum && nDate > nStr ? "FECHA" : nNum > nStr ? "num" : nBool ? "bool" : "str";
      const flag = tipo === "FECHA" ? "📅" : /VIN|FOLIO|\bID\b|PATENTE|RUT|NUMERO/i.test(c) ? "🔑" : "  ";
      console.log(
        `│   ${flag} ${c.padEnd(34).slice(0, 34)} ${tipo.padEnd(5)} fill ${String(fill).padStart(3)}%  ej: ${samples.map((s) => JSON.stringify(s)).join(", ").slice(0, 70)}`,
      );
    }
  }
}

inspectFile("Logistica.xlsx");
inspectFile("Diciembre-Mayo ROMA.xlsx");
console.log("");
