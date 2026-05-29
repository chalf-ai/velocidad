#!/usr/bin/env node
/**
 * Dump completo de la fila para un VIN específico en Actas al 28 de Mayo.
 * Sirve para confirmar qué campos vienen del Excel y cuáles deberían quedar
 * en el objeto AutoNoEntregado tras el parser.
 */
import XLSX from "xlsx";

const VIN_TARGET = (process.argv[2] ?? "VR3KAHPY3VS000844").trim().toUpperCase();
const FILE = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Actas al 28 de Mayo.xlsx";

const wb = XLSX.readFile(FILE, { cellDates: true });
const ws = wb.Sheets["ROMA"];
const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });

const fila = rows.find((r) => String(r["Vin"] ?? "").trim().toUpperCase() === VIN_TARGET);

console.log("════════════════════════════════════════════════════════════════════════════");
console.log(`  VIN: ${VIN_TARGET}`);
console.log("════════════════════════════════════════════════════════════════════════════");

if (!fila) {
  console.log("  ❌ NO se encontró el VIN en la hoja ROMA del archivo.");
  console.log("");
  console.log("  Búsqueda case-insensitive — verificá que el VIN esté correcto.");
  console.log(`  Total filas en hoja: ${rows.length}`);
  process.exit(1);
}

console.log(`  ✅ Encontrado en fila Excel ${rows.indexOf(fila) + 2}`);
console.log("");
console.log("  TODOS los campos del Excel para este VIN:");
console.log("  ────────────────────────────────────────────────────────────────────");
for (const [k, v] of Object.entries(fila)) {
  let display;
  if (v === null || v === undefined) display = "null";
  else if (v instanceof Date) display = v.toISOString();
  else display = String(v);
  const isEmpty = v === null || v === undefined || v === "" || v === 0;
  const marker = isEmpty ? "  (vacío/null/0)" : "";
  console.log(`    ${k.padEnd(36)}  ${display.padEnd(40)}${marker}`);
}
console.log("");

// ── Aplicar la misma regla del parser para ver qué quedaría en el objeto
function toStr(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}
function toDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t) : null;
  }
  return null;
}
function toSiNo(v) {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (s === "si" || s === "sí") return true;
  if (s === "no") return false;
  return null;
}

const entregaAutoTxt = toStr(fila["entrega_auto_txt"]);
const entregado = (entregaAutoTxt ?? "").trim() === "Cargado";

const parsed = {
  vin: VIN_TARGET,
  sucursal: toStr(fila["Sucursal"]),
  cliente: toStr(fila["Nombre_Cliente"]),
  vendedor: toStr(fila["Nombre_Vendedor"]),
  cajon: toStr(fila["Cajon"]),
  valorFactura: Number(fila["ValorFactura"] ?? 0),
  fechaVenta: toDate(fila["FechaVenta"]),
  fechaFactura: toDate(fila["FechaFactura"]),
  autorizacionEntrega: toSiNo(fila["autorizacion_entrega"]),
  solEntrega: toSiNo(fila["sol_entrega"]),
  entregaAuto: toStr(fila["entrega_auto"]),
  solicitarInscripcion: toSiNo(fila["SolicitarInscripcion"]),
  fechaSolicitudInscripcion: toDate(fila["FechaSolicitudInscripcion"]),
  fechaInscripcion: toDate(fila["FechaInscripcion"]),
  patentesAdministracion: toDate(fila["patentes_administracion"]),
  fechaPatenteEnviada: toDate(fila["fecha_patente_enviada"]),
  fechaPatenteRecibida: toDate(fila["fecha_patente_recibida"]),
  fechaPatenteEntregada: toDate(fila["fecha_patente_entregada"]),
  patenteVpp: toStr(fila["PatenteVpp"]),
  etapa: Number(fila["etapa"] ?? 0),
  entregaAutoTxt,
  entregado,
};

console.log("  Objeto AutoNoEntregado simulado (lo que el parser produciría):");
console.log("  ────────────────────────────────────────────────────────────────────");
for (const [k, v] of Object.entries(parsed)) {
  const display = v === null ? "null" : v instanceof Date ? v.toISOString() : String(v);
  console.log(`    ${k.padEnd(32)}  ${display}`);
}

console.log("");
console.log(`  Estado FNE: ${entregado ? "ENTREGADO (excluido del FNE operativo)" : "NO entregado (universo operativo)"}`);
console.log("");

// ── Hipótesis: ¿estos campos llegarían a un selector de ficha?
console.log("  Campos críticos para la ficha (timeline):");
console.log(`    fechaVenta                      → ${parsed.fechaVenta ?? "—"}`);
console.log(`    fechaFactura                    → ${parsed.fechaFactura ?? "—"}`);
console.log(`    fechaSolicitudInscripcion       → ${parsed.fechaSolicitudInscripcion ?? "—"}`);
console.log(`    fechaInscripcion                → ${parsed.fechaInscripcion ?? "—"}`);
console.log(`    patentesAdministracion          → ${parsed.patentesAdministracion ?? "—"}`);
console.log(`    fechaPatenteEnviada             → ${parsed.fechaPatenteEnviada ?? "—"}`);
console.log(`    fechaPatenteRecibida            → ${parsed.fechaPatenteRecibida ?? "—"}`);
console.log(`    fechaPatenteEntregada           → ${parsed.fechaPatenteEntregada ?? "—"}`);
console.log("");

console.log("════════════════════════════════════════════════════════════════════════════");
