import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const path = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx";
const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true });

const EXTRA = [
  "Venta APC Fact VN",
  "Venta APC Fact VU",
  "Financiado",
  "Base Financiamiento",
  "Pagos Financieras",
  "1.-Stock x Responsable",
  "Detalle Usados",
];

for (const name of EXTRA) {
  const ws = wb.Sheets[name];
  if (!ws) { console.log(`\n--- ${name}: NO ---`); continue; }
  console.log(`\n--- ${name} (range ${ws["!ref"]}) ---`);
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  // Buscar fila con headers (heuristic: la que tenga más strings no-empty)
  let headerRow = -1;
  let maxStrings = 0;
  for (let i = 0; i < Math.min(15, raw.length); i++) {
    const cnt = (raw[i] ?? []).filter((v) => typeof v === "string" && v.length > 0).length;
    if (cnt > maxStrings) { maxStrings = cnt; headerRow = i; }
  }
  console.log("Header probable en fila:", headerRow);
  if (headerRow >= 0) {
    const headers = raw[headerRow] ?? [];
    console.log("Headers:", headers.slice(0, 40));
  }
  // Buscar cualquier celda con string 17 chars que parezca VIN
  let vinSamples = new Set();
  for (let i = headerRow + 1; i < raw.length && vinSamples.size < 5; i++) {
    for (const c of raw[i] ?? []) {
      if (typeof c === "string" && /^[A-HJ-NPR-Z0-9]{17}$/i.test(c.trim())) {
        vinSamples.add(c.trim());
      }
    }
  }
  console.log("Sample VINs encontrados:", [...vinSamples]);
}
