/**
 * AUDITORÍA TÉCNICA · Capital Puente (BU/VPP) desde Base_Stock.
 *
 * Objetivo: entender cómo vienen modelados los BU/VPP en Base_Stock ANTES de
 * rehacer el selector. Reporta columnas disponibles + las 11 métricas pedidas.
 * NO modifica nada — solo lee el Excel real y reporta a consola.
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const DIR =
  "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";
const wb = XLSX.read(
  readFileSync(DIR + "Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx"),
  { type: "buffer", cellDates: true },
);
const rows = XLSX.utils.sheet_to_json(wb.Sheets["Base_Stock"], { defval: null, raw: true });

// ── 1. Columnas disponibles ──────────────────────────────────────────────
const cols = Object.keys(rows[0] ?? {});
console.log(`\n══ Base_Stock: ${rows.length} filas · ${cols.length} columnas ══`);

const PATRONES = [
  "vpp", "bu", "retoma", "folio", "operac", "apc", "venta apc", "vin",
  "patente", "placa", "cliente", "vendedor", "sucursal", "fecha", "factura",
  "condic", "tipo", "stock", "estado", "dealer", "proveedor", "marca",
  "origen", "pompeyo", "unidad", "negocio", "status", "autopro", "r2",
];
console.log("\n── Columnas relacionadas (match por patrón) ──");
for (const c of cols) {
  const lc = c.toLowerCase();
  if (PATRONES.some((p) => lc.includes(p))) console.log(`  · ${JSON.stringify(c)}`);
}

// helper: encontrar la 1ª columna cuyo nombre incluye alguno de los tokens
const findCol = (...tokens) =>
  cols.find((c) => tokens.every((t) => c.toLowerCase().includes(t.toLowerCase()))) ?? null;

const COL = {
  estadoAutoPro: findCol("estado", "autopro") ?? findCol("autopro"),
  statusStock: findCol("status", "stock"),
  folioRetoma: findCol("folio", "retoma"),
  fechaRetoma: findCol("fecha", "retoma"),
  folioVenta: findCol("folio", "venta"),
  fechaVenta: findCol("fecha", "venta"),
  fechaFactura: findCol("fecha", "factura"),
  vendedor: findCol("vendedor"),
  sucursal: findCol("sucursal"),
  patente: findCol("placa") ?? findCol("patente"),
  marca: findCol("marca", "pompeyo") ?? findCol("marca"),
  condVehiculo: findCol("condic", "veh"),
  condStock: findCol("condic", "stock"),
  tipoStock: findCol("tipo", "stock"),
  estadoDealer: findCol("estado", "dealer"),
  unidadNegocio: findCol("unidad"),
  proveedor: findCol("proveedor"),
};
console.log("\n── Columnas mapeadas ──");
for (const [k, v] of Object.entries(COL)) console.log(`  ${k.padEnd(14)} → ${v ? JSON.stringify(v) : "(no encontrada)"}`);

// columnas tipo VIN / patente extra (VIN R, VIN R2, patente VPP, etc.)
console.log("\n── Posibles columnas de VÍNCULO (VIN/patente extra) ──");
for (const c of cols) {
  const lc = c.toLowerCase();
  if ((lc.includes("vin") || lc.includes("patente") || lc.includes("placa")) && c !== COL.patente) {
    const sample = rows.find((r) => r[c] != null)?.[c];
    console.log(`  · ${JSON.stringify(c)} — ej: ${JSON.stringify(sample ?? null)}`);
  }
}

// ── 2. Detección BU/VPP (misma regla del parser) ─────────────────────────
const val = (r, c) => (c ? r[c] : null);
const esVPP = (r) => {
  const ap = (val(r, COL.estadoAutoPro) ?? "").toString();
  const ss = (val(r, COL.statusStock) ?? "").toString();
  const fr = val(r, COL.folioRetoma);
  return ap.includes("Proceso Retoma") || (ss === "Aprobada" && fr);
};
const vpp = rows.filter(esVPP);

// ── BU_NUEVOS vs BU_USADOS: heurística por marca/condición ───────────────
// Hipótesis a validar: si la operación que recibió el VPP es de una marca de
// auto NUEVO → BU_NUEVOS; si es de USADOS/seminuevos → BU_USADOS.
const up = (s) => (s ?? "").toString().toUpperCase();
// Campo MAESTRO: "Marca Pompeyo" = "VU en Nuevos" / "VU en Usados".
const clasifBU = (r) => {
  const m = up(val(r, COL.marca));
  if (m.includes("NUEVO")) return "BU_NUEVOS";
  if (m.includes("USADO")) return "BU_USADOS";
  return "SIN_CLASIFICAR";
};

let bu = 0, conFolioRetoma = 0, conFolioVenta = 0, conVin = 0, conPatente = 0,
  conFechaRetoma = 0, conMarca = 0, nuevos = 0, usados = 0, sinClasif = 0;
const distCond = {}, distEstado = {};
for (const r of vpp) {
  bu++;
  if (val(r, COL.folioRetoma)) conFolioRetoma++;
  if (val(r, COL.folioVenta)) conFolioVenta++;
  if (val(r, "VIN") || val(r, "Vin")) conVin++;
  if (val(r, COL.patente)) conPatente++;
  if (val(r, COL.fechaRetoma)) conFechaRetoma++;
  if (val(r, COL.marca)) conMarca++;
  const k = clasifBU(r);
  if (k === "BU_NUEVOS") nuevos++;
  else if (k === "BU_USADOS") usados++;
  else sinClasif++;
  const c = up(val(r, COL.condVehiculo)) || "(vacío)";
  distCond[c] = (distCond[c] ?? 0) + 1;
  const e = (val(r, COL.estadoAutoPro) ?? "(vacío)").toString();
  distEstado[e] = (distEstado[e] ?? 0) + 1;
};

// vínculo directo sin FNE = tiene folio venta O folio retoma (ancla operacional)
const vinculoDirecto = vpp.filter((r) => val(r, COL.folioVenta) || val(r, COL.folioRetoma)).length;
const requiereConcil = bu - vinculoDirecto;

console.log(`\n══ BU/VPP detectados: ${bu} ══`);
console.log(`  1. Total BU/VPP ................ ${bu}`);
console.log(`  2. BU/VPP en NUEVOS (heur.) .... ${nuevos}`);
console.log(`  3. BU/VPP en USADOS (heur.) .... ${usados}`);
console.log(`     sin clasificar .............. ${sinClasif}`);
console.log(`  4. con Folio Retoma ............ ${conFolioRetoma}`);
console.log(`  5. con Folio Venta ............. ${conFolioVenta}`);
console.log(`  6. con VIN relacionado ......... ${conVin}`);
console.log(`  7. con Patente ................. ${conPatente}`);
console.log(`  8. con Fecha Retoma ............ ${conFechaRetoma}`);
console.log(`  9. con Marca ................... ${conMarca}`);
console.log(` 10. vínculo directo (folio) ..... ${vinculoDirecto}`);
console.log(` 11. requiere conciliación ....... ${requiereConcil}`);

console.log("\n── Distribución Condición Vehículo (en BU/VPP) ──");
for (const [k, v] of Object.entries(distCond).sort((a, b) => b[1] - a[1])) console.log(`  ${v.toString().padStart(4)}  ${k}`);
console.log("\n── Distribución Estado AutoPro (en BU/VPP) ──");
for (const [k, v] of Object.entries(distEstado).sort((a, b) => b[1] - a[1])) console.log(`  ${v.toString().padStart(4)}  ${k}`);

// ── Distribución "Marca Pompeyo" (campo maestro de tipo BU) ──────────────
const distMarcaP = {};
for (const r of vpp) {
  const m = (val(r, COL.marca) ?? "(vacío)").toString();
  distMarcaP[m] = (distMarcaP[m] ?? 0) + 1;
}
console.log('\n── Distribución "Marca Pompeyo" (en BU/VPP) ──');
for (const [k, v] of Object.entries(distMarcaP).sort((a, b) => b[1] - a[1])) console.log(`  ${v.toString().padStart(4)}  ${k}`);

// ── Columnas de vínculo extra: VIN R / VIN R2 / folio venta real ─────────
let vinR = 0, vinR2 = 0, folioVentaReal = 0, condStockVU = 0;
for (const r of vpp) {
  if ((val(r, "VIN R") ?? "").toString().trim()) vinR++;
  if ((val(r, "VIN R2") ?? "").toString().trim()) vinR2++;
  const fv = val(r, COL.folioVenta);
  if (fv && Number(fv) > 0) folioVentaReal++;
  if (up(val(r, COL.condStock)).includes("RECIBIR")) condStockVU++;
}
console.log("\n── Campos de vínculo en BU/VPP ──");
console.log(`  VIN R poblado .............. ${vinR}`);
console.log(`  VIN R2 poblado ............. ${vinR2}`);
console.log(`  Folio Venta > 0 ............ ${folioVentaReal}`);
console.log(`  Cond. Stock "VU por Recibir" ${condStockVU}`);

// ── Cruce potencial con FNE por patente ──────────────────────────────────
try {
  const wf = XLSX.read(readFileSync(DIR + "Autos no entregados.xlsx"), { type: "buffer", cellDates: true });
  const fne = XLSX.utils.sheet_to_json(wf.Sheets["ROMA"], { defval: null, raw: true });
  const norm = (p) => (p ?? "").toString().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const patFne = new Set(fne.map((r) => norm(r["PatenteVpp"])).filter(Boolean));
  let crucePatente = 0;
  for (const r of vpp) if (patFne.has(norm(val(r, COL.patente)))) crucePatente++;
  console.log("\n── Enriquecimiento FNE potencial ──");
  console.log(`  FNE registros .............. ${fne.length}`);
  console.log(`  FNE con PatenteVpp ......... ${patFne.size}`);
  console.log(`  BU/VPP que enriquecen x pat. ${crucePatente} de ${bu}`);
  console.log(`  BU/VPP solo Base_Stock ..... ${bu - crucePatente} (válidos igual, sin detalle FNE)`);
} catch (e) {
  console.log("\n(FNE no disponible:", e.message, ")");
}

// ── Muestra de 3 BU/VPP con sus campos de vínculo ────────────────────────
console.log("\n── Muestra de 3 BU/VPP (campos de vínculo) ──");
for (const r of vpp.slice(0, 3)) {
  console.log("  ─────");
  for (const [k, c] of Object.entries(COL)) {
    if (c) console.log(`    ${k.padEnd(14)} ${JSON.stringify(val(r, c))}`);
  }
}
