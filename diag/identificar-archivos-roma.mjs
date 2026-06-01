#!/usr/bin/env node
/**
 * Identifica el mes/rango de cada archivo ROMA inspeccionando las fechas.
 * Sin tocar código de la app. Solo lectura.
 */
import XLSX from "xlsx";

const archivos = [
  "/Users/Daviid/Downloads/tmp-export-3-29-05-2026_335 (23).xlsx",
  "/Users/Daviid/Downloads/tmp-export-3-29-05-2026_335 (10).xlsx",
  "/Users/Daviid/Downloads/tmp-export-3-29-05-2026_334 (8).xlsx",
  "/Users/Daviid/Downloads/LOG Enero.xlsx",
  "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Log Roma 29-05-2026 .xlsx",
];

function toDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "number") {
    if (v === 0) return null;
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const s = String(v).trim();
  if (!s || s === "0" || s === "00-00-0000") return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}

for (const path of archivos) {
  console.log("════════════════════════════════════════════════════════════════════");
  console.log(`  ${path.split("/").pop()}`);
  console.log("════════════════════════════════════════════════════════════════════");
  try {
    const wb = XLSX.readFile(path, { cellDates: true });
    console.log(`  Hojas: ${wb.SheetNames.join(", ")}`);
    for (const sheet of wb.SheetNames) {
      const ws = wb.Sheets[sheet];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
      if (rows.length === 0) continue;
      const cols = Object.keys(rows[0]);
      console.log(`  Hoja "${sheet}": ${rows.length} filas, ${cols.length} columnas`);
      // Detectar columnas de fecha y obtener min/max
      const fechasCandidatas = cols.filter((c) => /fecha|date|FechaSolicitud/i.test(c));
      for (const col of fechasCandidatas.slice(0, 8)) {
        const fechas = rows.map((r) => toDate(r[col])).filter((d) => d !== null);
        if (fechas.length === 0) continue;
        const min = new Date(Math.min(...fechas.map((d) => d.getTime())));
        const max = new Date(Math.max(...fechas.map((d) => d.getTime())));
        const cov = (fechas.length / rows.length * 100).toFixed(0);
        console.log(`    ${col.padEnd(40)} cov=${cov.padStart(3)}% rango ${min.toISOString().slice(0,10)} → ${max.toISOString().slice(0,10)}`);
      }
      break; // solo primera hoja
    }
  } catch (e) {
    console.log(`  ❌ Error: ${e.message}`);
  }
  console.log("");
}
