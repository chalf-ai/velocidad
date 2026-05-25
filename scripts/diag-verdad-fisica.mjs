/**
 * VALIDACIÓN · verdad física del VIN ejemplo (replica calcularVerdadFisica).
 * Solo lee. Confirma que LJD3BA1DAT0089938 queda explicado.
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const DIR = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";
const read = (f, sheet) => {
  const wb = XLSX.read(readFileSync(DIR + f), { type: "buffer", cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet ?? wb.SheetNames[0]], { defval: null, raw: true });
};
const up = (s) => (s ?? "").toString().toUpperCase().trim();
const isDate = (v) => v instanceof Date && !isNaN(v);
const limpiarVIN = (raw) => raw == null ? "" : String(raw).replace(/\s+/g, "").replace(/[-_./]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const NO_RETAIL = ["LOGISTICA","CPD","VN CON PATENTE","TEST CAR","SEMINUEVO","AUTOSHOPPING","OUTLET","BODEGA","CASA MATRIZ","COMPANY","KAR","SCHIAPP","LONQUEN"];
const esRetail = (s) => { const u = up(s); if (!u) return false; if (u.startsWith("OFICINA")) return false; return !NO_RETAIL.some((n) => u.includes(n)); };
const HOY = new Date("2026-05-24");

const TARGET = limpiarVIN(process.argv[2] || "LJD3BA1DAT0089938");

const stock = read("Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx", "Base_Stock");
const fne = read("Autos no entregados.xlsx");
const roma = read("Diciembre-Mayo ROMA.xlsx", "ROMA");
const stli = read("Logistica.xlsx", "Hoja2");

const sRow = stock.find((r) => limpiarVIN(r["Numero VIN"]) === TARGET) ?? null;
const fRow = fne.find((r) => limpiarVIN(r["Vin"]) === TARGET) ?? null;
const rRow = roma.find((r) => limpiarVIN(r["Vin"]) === TARGET) ?? null;
const lRow = stli.find((r) => limpiarVIN(r["VIN"]) === TARGET) ?? null;

console.log(`\n══ VIN ${TARGET} ══`);
console.log(`  En Base_Stock: ${sRow ? `sí · sucursal ${sRow["Sucursal"]} · condición ${sRow["Condicion de Stock"]}` : "NO"}`);
console.log(`  En FNE: ${fRow ? `sí · sucursal ${fRow["Sucursal"]} · patente recibida: ${isDate(fRow["fecha_patente_recibida"]) ? "SÍ" : "no"} · autoriz: ${fRow["autorizacion_entrega"]} · sol_entrega: ${fRow["sol_entrega"]}` : "NO"}`);
console.log(`  ROMA: ${rRow ? `sí · estado ${rRow["Estado"]} · pasoActual ${rRow["PasoActual"]} · ETA/llegada ${rRow["FechaETASucursal"] ?? "—"} · entrega comprom. ${rRow["FechaEstimadaEntrega"] ?? "—"}` : "NO"}`);
console.log(`  STLI: ${lRow ? `sí · despacho ${lRow["Fecha despacho a sucursal"] ?? "—"} · cumplimiento ${lRow["Cumplimiento despacho"]}` : "NO"}`);

// señales
const pDMY = (s) => { const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(s ?? "").trim()); if (!m) return null; const [, d, mo, y] = m; if (d === "00" || y === "0000") return null; const dt = new Date(+y, +mo - 1, +d); return isNaN(dt) ? null : dt; };
const fDespacho = lRow ? (isDate(lRow["Fecha despacho a sucursal"]) ? lRow["Fecha despacho a sucursal"] : null) : null;
const fLlegada = rRow ? pDMY(rRow["FechaETASucursal"]) : null;
const despachado = !!fDespacho;
const recepLog = !!fLlegada;
const patenteSuc = isDate(fRow?.["fecha_patente_recibida"]);
const enStock = !!sRow;
const sucRetail = esRetail(sRow?.["Sucursal"]);
const enStockSucursal = enStock && sucRetail;
const enTransitoLog = despachado && !recepLog;
const transitoProlongado = despachado && !recepLog && fDespacho && Math.round((HOY - fDespacho) / 86400000) > 6;
const evidenciaSucursal = recepLog || patenteSuc || enStockSucursal;
const evidenciaTransito = despachado && !recepLog;

let estado;
if (false) estado = "entregado";
else if (evidenciaSucursal && evidenciaTransito) estado = "inconsistente";
else if (evidenciaSucursal) estado = "en_sucursal";
else if (despachado && !recepLog) estado = transitoProlongado ? "despachado_no_recepcionado" : "en_transito";
else if (enStock && !sucRetail) estado = "en_bodega";
else estado = "desconocido";

console.log(`\n── Señales físicas ──`);
console.log(`  despachado=${despachado} · recepción logística=${recepLog} · patente en sucursal=${patenteSuc} · en stock=${enStock} (retail=${sucRetail})`);
console.log(`  evidencia sucursal=${evidenciaSucursal} · evidencia tránsito=${evidenciaTransito} · tránsito prolongado=${transitoProlongado}`);
console.log(`\n  ▶ estadoFisicoVIN = ${estado.toUpperCase()}`);
if (estado === "inconsistente") {
  const c = [];
  if (patenteSuc && evidenciaTransito) c.push("FNE marca patente en sucursal, pero logística indica en tránsito sin recepción.");
  if (enStockSucursal && evidenciaTransito) c.push("Stock visible en sucursal, pero logística en tránsito.");
  console.log(`  Contradicciones: ${c.join(" ")}`);
}
console.log("");
