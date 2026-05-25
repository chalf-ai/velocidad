import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const path = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Provisiones al 18 de Mayo.xlsx";
const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets["ROMA"], { defval: null, raw: true });

console.log(`Total registros: ${rows.length}\n`);

function distrib(field, top = 15) {
  const m = {};
  for (const r of rows) m[r[field] ?? "(null)"] = (m[r[field] ?? "(null)"] ?? 0) + 1;
  console.log(`\n--- ${field} ---`);
  Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, top).forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${k}`));
}

distrib("Estado");
distrib("Concepto");
distrib("Origen", 30);
distrib("motivo", 30);
distrib("estado_conta");
distrib("EstadoAjuste", 10);
distrib("RazonSocial");

// Sumas totales
const total = rows.reduce((s, r) => s + (Number(r.montoProvision) || 0), 0);
const factTotal = rows.reduce((s, r) => s + (Number(r.montoFactura) || 0), 0);
const saldoTotal = rows.reduce((s, r) => s + (Number(r.saldo) || 0), 0);
console.log(`\nTotal montoProvision: $${total.toLocaleString("es-CL")}`);
console.log(`Total montoFactura  : $${factTotal.toLocaleString("es-CL")}`);
console.log(`Total saldo         : $${saldoTotal.toLocaleString("es-CL")}`);

// Estados según saldo
const sin_factura = rows.filter((r) => !r.montoFactura || r.montoFactura === 0);
const con_factura_con_saldo = rows.filter((r) => Number(r.montoFactura) > 0 && Number(r.saldo) > 0);
const con_factura_sin_saldo = rows.filter((r) => Number(r.montoFactura) > 0 && (!r.saldo || Number(r.saldo) <= 0));
console.log(`\nSin facturar (montoFactura=0)        : ${sin_factura.length} · $${sin_factura.reduce((s, r) => s + (Number(r.montoProvision) || 0), 0).toLocaleString("es-CL")}`);
console.log(`Facturada con saldo (>0)            : ${con_factura_con_saldo.length} · $${con_factura_con_saldo.reduce((s, r) => s + (Number(r.saldo) || 0), 0).toLocaleString("es-CL")}`);
console.log(`Facturada sin saldo (cobrada/cero)  : ${con_factura_sin_saldo.length} · $${con_factura_sin_saldo.reduce((s, r) => s + (Number(r.montoProvision) || 0), 0).toLocaleString("es-CL")}`);

// VINs?
const colsConVin = Object.keys(rows[0]).filter((k) => /vin|chasis|cajon|patente/i.test(k));
console.log(`\nColumnas que podrían tener VIN: ${colsConVin.length ? colsConVin : "ninguna"}`);

// Periodos
distrib("periodo", 20);

// Aging desde fechaCreacion
const hoy = new Date("2025-05-18");
const aging = { "0-30": 0, "31-60": 0, "61-90": 0, "91-180": 0, "180+": 0 };
const agingMonto = { "0-30": 0, "31-60": 0, "61-90": 0, "91-180": 0, "180+": 0 };
for (const r of rows) {
  if (!r.fechaCreacion) continue;
  const f = new Date(r.fechaCreacion);
  const d = Math.floor((hoy - f) / 86400000);
  const k = d <= 30 ? "0-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" : d <= 180 ? "91-180" : "180+";
  aging[k]++;
  agingMonto[k] += Number(r.montoProvision) || 0;
}
console.log("\n--- Aging desde fechaCreacion (vs 18-may-2025) ---");
for (const k of Object.keys(aging)) {
  console.log(`  ${k.padEnd(8)} ${String(aging[k]).padStart(5)} u · $${agingMonto[k].toLocaleString("es-CL")}`);
}
