import * as XLSX from "xlsx";
import { readFileSync } from "fs";
const buf = readFileSync("/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Autos no entregados.xlsx");
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
const sh = wb.Sheets["ROMA"];
const rows = XLSX.utils.sheet_to_json(sh, { defval: null, raw: true });
console.log("Total registros:", rows.length);

// Distribución de etapas
const etapas = {};
for (const r of rows) etapas[r.etapa] = (etapas[r.etapa] ?? 0) + 1;
console.log("\nEtapas:", etapas);

// entrega_auto != null = ya entregado?
const entregados = rows.filter((r) => r.entrega_auto !== null);
console.log("\nentrega_auto != null:", entregados.length);
console.log("entrega_auto == null:", rows.filter((r) => r.entrega_auto === null).length);

// entrega_auto_txt
const txt = {};
for (const r of rows) txt[r.entrega_auto_txt ?? "(null)"] = (txt[r.entrega_auto_txt ?? "(null)"] ?? 0) + 1;
console.log("\nentrega_auto_txt:", txt);

// Sucursales
const sucs = {};
for (const r of rows) sucs[r.Sucursal] = (sucs[r.Sucursal] ?? 0) + 1;
console.log("\nSucursales (top 15):");
Object.entries(sucs).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

// Total ValorFactura
const valor = rows.reduce((s, r) => s + (r.ValorFactura || 0), 0);
console.log("\nValor total facturado:", valor.toLocaleString("es-CL"));

// Con VPP (PatenteVpp != null)
const conVPP = rows.filter((r) => r.PatenteVpp !== null);
console.log("\nCon PatenteVpp:", conVPP.length);
console.log("Sin PatenteVpp:", rows.length - conVPP.length);
console.log("Valor con VPP:", conVPP.reduce((s, r) => s + (r.ValorFactura || 0), 0).toLocaleString("es-CL"));

// VIN únicos
const vins = new Set(rows.map((r) => r.Vin));
console.log("\nVIN únicos:", vins.size, "de", rows.length, "registros");

// Aging desde FechaFactura
const hoy = new Date("2026-05-20");
const ages = { "0-3": 0, "4-7": 0, "8-15": 0, "16-30": 0, "31-60": 0, "61+": 0, "sin_fecha": 0 };
for (const r of rows) {
  if (!r.FechaFactura) { ages["sin_fecha"]++; continue; }
  const d = Math.floor((hoy - new Date(r.FechaFactura)) / 86400000);
  if (d <= 3) ages["0-3"]++;
  else if (d <= 7) ages["4-7"]++;
  else if (d <= 15) ages["8-15"]++;
  else if (d <= 30) ages["16-30"]++;
  else if (d <= 60) ages["31-60"]++;
  else ages["61+"]++;
}
console.log("\nAging desde FechaFactura (vs 2026-05-20):", ages);
