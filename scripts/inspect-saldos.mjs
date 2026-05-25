import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const path = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Reportes Saldos 2.0 18-05-2026_.xlsx";
const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true });
console.log("Hojas:", wb.SheetNames);
console.log("Total hojas:", wb.SheetNames.length);

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  console.log(`\n══ ${name} (range ${ws["!ref"]}) ══`);
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  console.log("Filas totales (crudas):", raw.length);

  // Detectar header row (la que tenga más strings)
  let headerRow = -1;
  let maxStrings = 0;
  for (let i = 0; i < Math.min(20, raw.length); i++) {
    const cnt = (raw[i] ?? []).filter((v) => typeof v === "string" && v.length > 0).length;
    if (cnt > maxStrings) { maxStrings = cnt; headerRow = i; }
  }
  console.log("Header probable en fila idx:", headerRow);
  if (headerRow >= 0) {
    const h = raw[headerRow] ?? [];
    console.log("Headers:", h.filter(Boolean).slice(0, 40));
  }

  // Primeras 3 filas crudas
  for (let i = 0; i < Math.min(4, raw.length); i++) {
    console.log(`  r${i}:`, JSON.stringify((raw[i] ?? []).slice(0, 12)));
  }

  // Buscar Cajón y VIN-like en muestras
  const samples = { cajones: new Set(), vins: new Set(), columnasConContenido: {} };
  const cajRegex = /^[A-Z]{2,3}[0-9]{4,8}$/i; // patrón típico: 2-3 letras + 4-8 dígitos
  const vinRegex = /^[A-HJ-NPR-Z0-9]{17}$/i;
  for (let i = headerRow + 1; i < Math.min(raw.length, headerRow + 200); i++) {
    const row = raw[i] ?? [];
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (typeof v !== "string") continue;
      const s = v.trim();
      if (vinRegex.test(s)) samples.vins.add(s);
      if (cajRegex.test(s) && s.length <= 12) samples.cajones.add(s);
    }
  }
  console.log("VINs detectados (muestra):", [...samples.vins].slice(0, 5));
  console.log("Cajones detectados (muestra):", [...samples.cajones].slice(0, 8));

  // Si hay header detectado, listar valores únicos de columnas clave
  if (headerRow >= 0) {
    const headers = raw[headerRow] ?? [];
    const rows = XLSX.utils.sheet_to_json(ws, { range: headerRow, defval: null, raw: true });
    console.log("Filas con header parseado:", rows.length);
    if (rows.length > 0) {
      console.log("\nMuestra registro 1:");
      const r1 = rows[0];
      for (const [k, v] of Object.entries(r1)) {
        if (v === null || v === undefined) continue;
        const sv = String(v).slice(0, 60);
        console.log(`  ${String(k).padEnd(30)}: ${sv}`);
      }
    }
  }
}
