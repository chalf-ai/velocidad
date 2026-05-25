import * as XLSX from "xlsx";
import { readFileSync, readdirSync } from "fs";
import { homedir } from "os";

const fneBuf = readFileSync("/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Autos no entregados.xlsx");
const fneWb = XLSX.read(fneBuf, { type: "buffer", cellDates: true });
const fneRows = XLSX.utils.sheet_to_json(fneWb.Sheets["ROMA"], { defval: null, raw: true });

// Buscar el archivo de stock más reciente
const dir = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";
const files = readdirSync(dir).filter((f) => /\.xlsx$/i.test(f) && !f.startsWith("~$"));
console.log("Archivos xlsx en la carpeta:");
for (const f of files) console.log("  -", f);

// Asumimos que el archivo grande es el de stock
let stockFile = files.find((f) => f.toLowerCase().includes("stock") || f.toLowerCase().includes("base")) ?? files.find((f) => !f.toLowerCase().includes("entregados"));
console.log("\nUsando para stock:", stockFile);

const stockBuf = readFileSync(dir + stockFile);
const stockWb = XLSX.read(stockBuf, { type: "buffer", cellDates: true, sheets: ["Base_Stock"] });
const stockWs = stockWb.Sheets["Base_Stock"];
const stockRows = XLSX.utils.sheet_to_json(stockWs, { defval: null, raw: true });

console.log("\nStock filas:", stockRows.length);
console.log("FNE filas:", fneRows.length);

// VINs en stock (la columna real es "Numero VIN")
const stockVins = new Map();
for (const r of stockRows) {
  const vin = r["Numero VIN"] ?? r["VIN"] ?? r["Vin"];
  if (vin) stockVins.set(String(vin).trim().toUpperCase(), r);
}
console.log("\nStock VINs únicos:", stockVins.size);

// VINs en FNE
const fneVins = new Set();
for (const r of fneRows) {
  if (r.Vin) fneVins.add(String(r.Vin).trim().toUpperCase());
}
console.log("FNE VINs únicos:", fneVins.size);

// Cruce
let cruce = 0, sinCruce = 0;
const noCruzaron = [];
for (const v of fneVins) {
  if (stockVins.has(v)) cruce++;
  else { sinCruce++; if (noCruzaron.length < 10) noCruzaron.push(v); }
}
console.log("\nCruce:", cruce, "de", fneVins.size);
console.log("Sin cruce:", sinCruce);
console.log("VINs FNE sin cruce (primeros 10):", noCruzaron);

// Análisis de los que sí cruzan vs no
console.log("\n--- Análisis ---");
console.log("VINs FNE (primeros 5):", [...fneVins].slice(0, 5));
console.log("VINs stock (primeros 5):", [...stockVins.keys()].slice(0, 5));

// Análisis de columnas operacionales del FNE
let solSi = 0, solNo = 0, solNull = 0;
let autSi = 0, autNo = 0, autNull = 0;
let patRecibida = 0;
let solSiPatRecibida = 0;
let autSiPatRecibida = 0;
let solSiAutSiPatRecibida = 0;
for (const r of fneRows) {
  if (r.sol_entrega === "Si") solSi++; else if (r.sol_entrega === "No") solNo++; else solNull++;
  if (r.autorizacion_entrega === "Si") autSi++; else if (r.autorizacion_entrega === "No") autNo++; else autNull++;
  if (r.fecha_patente_recibida) {
    patRecibida++;
    if (r.sol_entrega === "Si") solSiPatRecibida++;
    if (r.autorizacion_entrega === "Si") autSiPatRecibida++;
    if (r.sol_entrega === "Si" && r.autorizacion_entrega === "Si") solSiAutSiPatRecibida++;
  }
}
console.log("\nsol_entrega: Si=" + solSi, "No=" + solNo, "null=" + solNull);
console.log("autorizacion_entrega: Si=" + autSi, "No=" + autNo, "null=" + autNull);
console.log("Patente recibida en sucursal:", patRecibida);
console.log("Pat recibida + sol_entrega=Si:", solSiPatRecibida);
console.log("Pat recibida + autorizacion=Si:", autSiPatRecibida);
console.log("Pat recibida + sol=Si + aut=Si:", solSiAutSiPatRecibida);
