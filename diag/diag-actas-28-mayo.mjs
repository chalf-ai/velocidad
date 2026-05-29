#!/usr/bin/env node
/**
 * Diagnóstico obligatorio: Actas al 28 de Mayo.xlsx (hoja ROMA).
 *
 * Reporta:
 *  - hojas disponibles + total filas
 *  - distribución de entrega_auto_txt
 *  - bajo regla NUEVA (entrega_auto_txt === "Cargado"):
 *      · entregados (Cargado)
 *      · no entregados (FNE operativo)
 *      · vacíos/nulos/blancos
 *  - FNE operativo:
 *      · cuántos tienen patente (PatenteVpp)
 *      · cuántos tienen patente recibida en sucursal (fecha_patente_recibida)
 *      · cuántos están listos para entrega (regla actual)
 *  - sanity check: las cuentas suman al total
 */
import XLSX from "xlsx";

const FILE = process.argv[2] ?? "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Actas al 28 de Mayo.xlsx";

const wb = XLSX.readFile(FILE, { cellDates: true });
console.log("════════════════════════════════════════════════════════════════════════");
console.log("  DIAGNÓSTICO — Actas al 28 de Mayo.xlsx");
console.log("════════════════════════════════════════════════════════════════════════");
console.log(`  Hojas en el libro: ${wb.SheetNames.join(", ")}`);

const ws = wb.Sheets["ROMA"];
if (!ws) {
  console.error("\n❌ No existe hoja ROMA");
  process.exit(1);
}

const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
const total = rows.length;
console.log(`  Total filas (hoja ROMA): ${total.toLocaleString("es-CL")}`);
console.log("");

const cols = total > 0 ? Object.keys(rows[0]) : [];
console.log("  Columnas detectadas:");
console.log("   ", cols.join(", "));
console.log("");

// ────────────────────────────────────────────────────────────────────────
// Regla NUEVA: entregado = (entrega_auto_txt === "Cargado")
// ────────────────────────────────────────────────────────────────────────

function norm(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

const dist = new Map();
for (const r of rows) {
  const v = r["entrega_auto_txt"];
  let key;
  if (v === null || v === undefined) key = "(null)";
  else {
    const s = String(v).trim();
    key = s.length === 0 ? "(blanco)" : s;
  }
  dist.set(key, (dist.get(key) ?? 0) + 1);
}

console.log("  Distribución completa de entrega_auto_txt:");
const sorted = [...dist.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, n] of sorted) {
  const pct = (n / total * 100).toFixed(1);
  const isCargado = k === "Cargado";
  const marker = isCargado ? "  ⚠ ENTREGADO" : "";
  console.log(`    ${String(n).padStart(6)}  (${pct.padStart(4)}%)  ${k}${marker}`);
}
console.log("");

const cargados = rows.filter((r) => norm(r["entrega_auto_txt"]) === "Cargado");
const noCargados = rows.filter((r) => norm(r["entrega_auto_txt"]) !== "Cargado");
const vaciosONulos = rows.filter((r) => {
  const v = r["entrega_auto_txt"];
  if (v === null || v === undefined) return true;
  return String(v).trim().length === 0;
});

console.log("  Bajo regla NUEVA (entrega_auto_txt === \"Cargado\" ⇒ entregado):");
console.log(`    Entregados (Cargado)               ${String(cargados.length).padStart(6)}  (${(cargados.length / total * 100).toFixed(1)}%)`);
console.log(`    FNE operativo (NO Cargado)         ${String(noCargados.length).padStart(6)}  (${(noCargados.length / total * 100).toFixed(1)}%)`);
console.log(`    └── de los cuales vacíos/nulos     ${String(vaciosONulos.length).padStart(6)}  (${(vaciosONulos.length / total * 100).toFixed(1)}%)`);
console.log(`    Sanity check                       ${cargados.length + noCargados.length === total ? "✅ suma ok" : "❌ no suma"}`);
console.log("");

// ────────────────────────────────────────────────────────────────────────
// Métricas del FNE operativo (no entregados)
// ────────────────────────────────────────────────────────────────────────

function hasDate(r, key) {
  const v = r[key];
  if (v === null || v === undefined || v === "") return false;
  if (v instanceof Date) return Number.isFinite(v.getTime());
  if (typeof v === "string") return Number.isFinite(Date.parse(v));
  return false;
}

function toSiNo(v) {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (s === "si" || s === "sí" || s === "yes" || s === "true" || s === "1") return true;
  if (s === "no" || s === "false" || s === "0") return false;
  return null;
}

const conPatenteVpp = noCargados.filter((r) => norm(r["PatenteVpp"]) !== null);
const conPatenteRecibida = noCargados.filter((r) => hasDate(r, "fecha_patente_recibida"));
const conSolEntrega = noCargados.filter((r) => toSiNo(r["sol_entrega"]) === true);
const conAutorizacionEntrega = noCargados.filter((r) => toSiNo(r["autorizacion_entrega"]) === true);

// Listo para entrega = patente recibida + sol_entrega + autorizacion (regla actual)
const listosParaEntregar = noCargados.filter((r) =>
  hasDate(r, "fecha_patente_recibida") &&
  toSiNo(r["sol_entrega"]) === true &&
  toSiNo(r["autorizacion_entrega"]) === true,
);

// Variantes informativas
const listosAmpliado = noCargados.filter((r) =>
  norm(r["PatenteVpp"]) !== null &&
  hasDate(r, "fecha_patente_recibida") &&
  toSiNo(r["sol_entrega"]) === true &&
  toSiNo(r["autorizacion_entrega"]) === true,
);

console.log("  FNE operativo — señales operacionales:");
console.log(`    Universo                           ${String(noCargados.length).padStart(6)}`);
console.log(`    Con PatenteVpp (string)            ${String(conPatenteVpp.length).padStart(6)}  (${(conPatenteVpp.length / Math.max(noCargados.length, 1) * 100).toFixed(1)}%)`);
console.log(`    Con fecha_patente_recibida         ${String(conPatenteRecibida.length).padStart(6)}  (${(conPatenteRecibida.length / Math.max(noCargados.length, 1) * 100).toFixed(1)}%)`);
console.log(`    Con sol_entrega = Si               ${String(conSolEntrega.length).padStart(6)}  (${(conSolEntrega.length / Math.max(noCargados.length, 1) * 100).toFixed(1)}%)`);
console.log(`    Con autorizacion_entrega = Si      ${String(conAutorizacionEntrega.length).padStart(6)}  (${(conAutorizacionEntrega.length / Math.max(noCargados.length, 1) * 100).toFixed(1)}%)`);
console.log("");

console.log("  Listos para entrega (regla actual):");
console.log(`    fecha_patente_recibida + sol_entrega + autorizacion`);
console.log(`    → ${listosParaEntregar.length.toLocaleString("es-CL")} unidades`);
console.log(`    Variante reforzada (+ PatenteVpp existente)`);
console.log(`    → ${listosAmpliado.length.toLocaleString("es-CL")} unidades`);
console.log("");

// ────────────────────────────────────────────────────────────────────────
// Monto retenido
// ────────────────────────────────────────────────────────────────────────

const valorTotal = noCargados.reduce((acc, r) => {
  const v = Number(r["ValorFactura"]);
  return acc + (Number.isFinite(v) ? v : 0);
}, 0);
const valorEntregadosHist = cargados.reduce((acc, r) => {
  const v = Number(r["ValorFactura"]);
  return acc + (Number.isFinite(v) ? v : 0);
}, 0);
const valorListos = listosParaEntregar.reduce((acc, r) => {
  const v = Number(r["ValorFactura"]);
  return acc + (Number.isFinite(v) ? v : 0);
}, 0);

const fmtMM = (n) => `$ ${(n / 1_000_000).toLocaleString("es-CL", { maximumFractionDigits: 1 })} MM`;
console.log("  Montos:");
console.log(`    FNE operativo (no entregados)      ${fmtMM(valorTotal).padStart(16)}`);
console.log(`    Entregados (histórico)             ${fmtMM(valorEntregadosHist).padStart(16)}`);
console.log(`    Listos para entrega                ${fmtMM(valorListos).padStart(16)}`);
console.log("");

console.log("════════════════════════════════════════════════════════════════════════");
console.log("  Resumen ejecutivo:");
console.log(`    Total archivo:           ${total.toLocaleString("es-CL")}`);
console.log(`    Entregados (excluidos):  ${cargados.length.toLocaleString("es-CL")}  (${(cargados.length / total * 100).toFixed(1)}%)`);
console.log(`    FNE operativo:           ${noCargados.length.toLocaleString("es-CL")}  (${(noCargados.length / total * 100).toFixed(1)}%)`);
console.log(`    Listos para entrega:     ${listosParaEntregar.length.toLocaleString("es-CL")}`);
console.log("════════════════════════════════════════════════════════════════════════");
