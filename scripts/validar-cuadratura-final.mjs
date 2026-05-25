/**
 * Validación final cuadratura Bloque A · Origen del capital.
 * Reproduce EXACTAMENTE la lógica de kpis.ts línea 124-137.
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const wb = XLSX.read(readFileSync("/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx"), { type: "buffer", cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets["Base_Stock"], { defval: null, raw: true });

const n = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const s = (v) => (v == null || v === "" ? null : String(v).trim());

// mapTipoStock (replica exacta del parser src/lib/parser/base-stock.ts:85-94)
function mapTipoStock(v) {
  if (!v) return "Desconocido";
  const u = v.toUpperCase();
  if (u === "FLOOR PLAN") return "FloorPlan";
  if (u === "PROPIO") return "Propio";
  if (u === "FINANCIADO") return "Financiado";
  if (u === "FIN PROPIO") return "FinPropio";
  if (u === "VU POR RECIBIR") return "VuPorRecibir";
  return "Desconocido";
}

// VINs únicos (uniqByVin del sistema)
const seen = new Set();
const unique = [];
for (const r of rows) {
  const vin = s(r["Numero VIN"]);
  if (!vin) continue;
  if (seen.has(vin)) continue;
  seen.add(vin);
  unique.push(r);
}

// Aplicar la misma partición que el sistema
let capitalBruto = 0;
let capitalPropioPuro = 0, unidadesPropioPuro = 0;
let capitalFinanciadoTerceros = 0, unidadesFinanciadoTerceros = 0;
let capitalTransito = 0, unidadesTransito = 0;

for (const r of unique) {
  const c = n(r[" Costo Neto "]);
  capitalBruto += c;
  const tipo = mapTipoStock(s(r["Tipo Stock"]));
  if (tipo === "Propio" || tipo === "FinPropio") {
    capitalPropioPuro += c;
    unidadesPropioPuro++;
  } else if (tipo === "FloorPlan" || tipo === "Financiado") {
    capitalFinanciadoTerceros += c;
    unidadesFinanciadoTerceros++;
  } else {
    capitalTransito += c;
    unidadesTransito++;
  }
}

const suma = capitalPropioPuro + capitalFinanciadoTerceros + capitalTransito;
const diferencia = suma - capitalBruto;

console.log("════════════════════════════════════════════════════════════════");
console.log("VALIDACIÓN CUADRATURA · BLOQUE A · ORIGEN DEL CAPITAL");
console.log("════════════════════════════════════════════════════════════════\n");

console.log("📊 PUNTO 1 · Montos exactos\n");
console.log(`  Capital total gestionado    : $${capitalBruto.toLocaleString("es-CL").padStart(18)}  (${unique.length} VIN únicos)`);
console.log(`  Capital propio Pompeyo      : $${capitalPropioPuro.toLocaleString("es-CL").padStart(18)}  (${unidadesPropioPuro} u · Propio + FinPropio)`);
console.log(`  Financiado terceros         : $${capitalFinanciadoTerceros.toLocaleString("es-CL").padStart(18)}  (${unidadesFinanciadoTerceros} u · FloorPlan + Financiado)`);
console.log(`  Tránsito / no clasificado   : $${capitalTransito.toLocaleString("es-CL").padStart(18)}  (${unidadesTransito} u · VuPorRecibir + Desconocido)`);

console.log("\n📐 PUNTO 2 · Suma vs Total\n");
console.log(`  Suma 3 subsets              : $${suma.toLocaleString("es-CL").padStart(18)}`);
console.log(`  Capital total gestionado    : $${capitalBruto.toLocaleString("es-CL").padStart(18)}`);
console.log(`  Diferencia                  : $${diferencia.toLocaleString("es-CL").padStart(18)}`);

console.log("\n✅ PUNTO 3 · Cuadratura\n");
if (Math.abs(diferencia) < 1) {
  console.log(`  ✓ Diferencia = $${diferencia} → CUADRA EXACTO (< $1)`);
} else {
  console.log(`  ✗ Diferencia = $${diferencia.toLocaleString("es-CL")} → NO cuadra`);
}

const pctPropio = capitalPropioPuro / capitalBruto;
const pctFin = capitalFinanciadoTerceros / capitalBruto;
const pctTra = capitalTransito / capitalBruto;
const sumaPct = pctPropio + pctFin + pctTra;

console.log("\n📊 Composición porcentual:");
console.log(`  Propio Pompeyo              : ${(pctPropio * 100).toFixed(2)}%`);
console.log(`  Financiado terceros         : ${(pctFin * 100).toFixed(2)}%`);
console.log(`  Tránsito / no clasificado   : ${(pctTra * 100).toFixed(2)}%`);
console.log(`  ──────`);
console.log(`  Total                       : ${(sumaPct * 100).toFixed(2)}%`);
