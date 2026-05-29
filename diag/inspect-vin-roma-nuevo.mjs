#!/usr/bin/env node
import XLSX from "xlsx";
const FILE = "/Users/Daviid/Downloads/tmp-export-3-29-05-2026_229 (5).xlsx";
const VIN = "VR3KAHPY3VS000844";

const wb = XLSX.readFile(FILE, { cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets["ROMA"], { defval: null, raw: true });
const fila = rows.find((r) => String(r["Vin"] ?? "").trim().toUpperCase() === VIN);

console.log("════════════════════════════════════════════════════════════════════════");
console.log(`  VIN ${VIN} en ROMA actualizado (29-05-2026):`);
console.log("════════════════════════════════════════════════════════════════════════");

if (!fila) {
  console.log("  ❌ NO está en este archivo ROMA");
  process.exit(0);
}

for (const [k, v] of Object.entries(fila)) {
  if (v === null || v === undefined || v === "" || v === "00-00-0000") continue;
  const txt = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  console.log(`    ${k.padEnd(40)}  ${txt}`);
}

console.log("");
console.log("  Hitos del timeline que se llenarían (si cargás este archivo):");
const hitos = [
  ["Solicitud del vendedor", "FechaSolicitud"],
  ["Respuesta de logística", "fecha_RespuestaGestionLogistica"],
  ["Llegada a sucursal", "FechaETASucursal"],
  ["Entrega comprometida", "FechaEstimadaEntrega"],
];
for (const [hito, col] of hitos) {
  const v = fila[col];
  const ok = v && v !== "00-00-0000" && v !== "";
  console.log(`    ${ok ? "✅" : "⚪"} ${hito.padEnd(28)} ← ${col}: ${ok ? (v instanceof Date ? v.toISOString().slice(0,10) : v) : "(sin dato)"}`);
}
console.log("════════════════════════════════════════════════════════════════════════");
