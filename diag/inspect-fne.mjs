#!/usr/bin/env node
/**
 * Inspecciona el archivo "Autos no entregados.xlsx" para determinar si la nueva
 * base incluye registros entregados (Entregado = "Sí") o si sigue siendo solo
 * el universo FNE original. Reporta:
 *   - Hojas disponibles
 *   - Columnas detectadas en hoja ROMA
 *   - Distribuciones de entrega_auto, entrega_auto_txt, etapa
 *   - Conteo de candidatos a "entregado"
 *   - Sample de filas entregadas y no-entregadas
 */
import XLSX from "xlsx";
import path from "node:path";

const FILE = process.argv[2] ?? "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Autos no entregados.xlsx";

const wb = XLSX.readFile(FILE, { cellDates: true });
console.log("=== Hojas ===");
console.log(wb.SheetNames);

const ws = wb.Sheets["ROMA"];
if (!ws) {
  console.error(`No existe hoja ROMA. Hojas: ${wb.SheetNames.join(", ")}`);
  process.exit(1);
}

const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
console.log(`\n=== Total filas: ${rows.length} ===`);

console.log("\n=== Columnas detectadas (header) ===");
const headerRow = rows[0] ?? {};
const cols = Object.keys(headerRow);
console.log(cols);

function distribute(rows, col) {
  const m = new Map();
  for (const r of rows) {
    const v = r[col];
    const key = v === null || v === undefined || v === "" ? "(null)" : String(v).trim();
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

console.log("\n=== Distribución: entrega_auto ===");
for (const [k, n] of distribute(rows, "entrega_auto").slice(0, 20)) {
  console.log(`  ${n.toString().padStart(5)}  ${k}`);
}

console.log("\n=== Distribución: entrega_auto_txt ===");
for (const [k, n] of distribute(rows, "entrega_auto_txt").slice(0, 20)) {
  console.log(`  ${n.toString().padStart(5)}  ${k}`);
}

console.log("\n=== Distribución: etapa ===");
for (const [k, n] of distribute(rows, "etapa").slice(0, 20)) {
  console.log(`  ${n.toString().padStart(5)}  ${k}`);
}

console.log("\n=== Distribución: autorizacion_entrega ===");
for (const [k, n] of distribute(rows, "autorizacion_entrega").slice(0, 20)) {
  console.log(`  ${n.toString().padStart(5)}  ${k}`);
}

console.log("\n=== Distribución: sol_entrega ===");
for (const [k, n] of distribute(rows, "sol_entrega").slice(0, 20)) {
  console.log(`  ${n.toString().padStart(5)}  ${k}`);
}

// Detectar columnas adicionales potenciales relacionadas a "Entregado"
console.log("\n=== Columnas candidatas a 'Entregado/Estado entrega' ===");
const candidates = cols.filter((c) =>
  /entreg|estado|delivered|status/i.test(c),
);
console.log(candidates);
for (const c of candidates) {
  console.log(`\n--- "${c}" (top 20) ---`);
  for (const [k, n] of distribute(rows, c).slice(0, 20)) {
    console.log(`  ${n.toString().padStart(5)}  ${k}`);
  }
}

// Distribución de fechaPatenteEntregada (proxy de entrega)
console.log("\n=== fecha_patente_entregada (no-null count) ===");
const conFechaEntrega = rows.filter((r) => {
  const v = r["fecha_patente_entregada"];
  return v !== null && v !== undefined && v !== "";
});
console.log(`  ${conFechaEntrega.length} de ${rows.length} (${(conFechaEntrega.length / rows.length * 100).toFixed(1)}%)`);

// Sample 3 filas: una con entrega y una sin entrega (si las hay)
console.log("\n=== Sample: primeras 2 filas ===");
for (let i = 0; i < Math.min(2, rows.length); i++) {
  console.log(`\n--- Fila ${i + 2} ---`);
  for (const k of cols) {
    const v = rows[i][k];
    if (v !== null && v !== undefined && v !== "") {
      const sv = v instanceof Date ? v.toISOString() : String(v);
      console.log(`  ${k}: ${sv.slice(0, 80)}`);
    }
  }
}

// Si hay alguna fila con entrega_auto NO null o entrega_auto_txt no null o algun
// patron de "Si"/"Sí" en cualquier col, mostrarla
console.log("\n=== Sample: primera fila con señal de ENTREGADO (si existe) ===");
const entregada = rows.find((r) => {
  const ea = String(r["entrega_auto"] ?? "").trim().toLowerCase();
  const eat = String(r["entrega_auto_txt"] ?? "").trim().toLowerCase();
  if (ea === "si" || ea === "sí" || ea === "yes" || ea === "true" || ea === "1") return true;
  if (eat === "si" || eat === "sí" || eat === "entregado") return true;
  return false;
});
if (entregada) {
  for (const k of cols) {
    const v = entregada[k];
    if (v !== null && v !== undefined && v !== "") {
      const sv = v instanceof Date ? v.toISOString() : String(v);
      console.log(`  ${k}: ${sv.slice(0, 80)}`);
    }
  }
} else {
  console.log("  (ninguna fila con entrega_auto/entrega_auto_txt = Sí)");
}
