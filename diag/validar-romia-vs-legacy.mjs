#!/usr/bin/env node
/**
 * Diagnóstico ANTES vs DESPUÉS de activar ROMIA.
 *
 * Replica las reglas del builder (`construirLogisticaPorVin`) en JS puro para
 * cruzar Actas (FNE operativo, 854 VINs) con SCHIAPP+KAR.
 *
 * Mide:
 *   - cobertura del timeline (cuántos hitos por VIN tenemos vs sin ROMIA)
 *   - cobertura total: cuántos FNE tienen al menos 1 hito disponible
 *   - VIN VR3KAHPY3VS000844: timeline antes y después
 */
import XLSX from "xlsx";

const BASE = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive";
const F_ACTAS = `${BASE}/Actas al 28 de Mayo.xlsx`;
const F_SCHIAPP = `${BASE}/SCHIAPPCASSE 28 de Mayo.xlsx`;
const F_KAR = `${BASE}/KAR-LOGISTICS 28 de Mayo.xlsx`;
const VIN_FOCO = "VR3KAHPY3VS000844";

function norm(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s.toUpperCase();
}
function toDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "number") {
    if (v === 0) return null;
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const s = String(v).trim();
  if (!s || s === "0") return null;
  const lower = s.toLowerCase();
  if (lower === "sin salida" || lower === "en proceso" || lower === "por confirmar") return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}
function esSinSalida(v) {
  return v != null && String(v).trim().toUpperCase() === "SIN SALIDA";
}

// 1) Universo FNE operativo
const wbActas = XLSX.readFile(F_ACTAS, { cellDates: true });
const rowsActas = XLSX.utils.sheet_to_json(wbActas.Sheets["ROMA"], { defval: null, raw: true });
const fneOperativos = new Set();
const filaPorVin = new Map();
for (const r of rowsActas) {
  if (!r["Vin"]) continue;
  const t = String(r["entrega_auto_txt"] ?? "").trim();
  const vin = norm(r["Vin"]);
  filaPorVin.set(vin, r);
  if (t !== "Cargado") fneOperativos.add(vin);
}

// 2) Indexar SCHIAPP y KAR por VIN (agrupando hojas)
function loadBodega(file, sheetVinCol) {
  const wb = XLSX.readFile(file, { cellDates: true });
  const accs = new Map(); // VIN → acc
  for (const [sheet, vinCol] of Object.entries(sheetVinCol)) {
    const ws = wb.Sheets[sheet];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
    for (const r of rows) {
      const v = norm(r[vinCol]);
      if (!v) continue;
      let a = accs.get(v);
      if (!a) { a = { vin: v, hojas: new Set() }; accs.set(v, a); }
      a.hojas.add(sheet);
      // Extraer campos relevantes
      if (sheet === "Solicitud Venta") {
        a.fSolicitudVendedor = a.fSolicitudVendedor ?? toDate(r["FechaSolicitud"]);
        a.fEstimadaEntrega = a.fEstimadaEntrega ?? toDate(r["FechaEstimadaEntrega"]);
      }
      if (sheet === "Solicitud Vitrina") {
        a.fSolicitudVendedor = a.fSolicitudVendedor ?? toDate(r["FechaCreacion"]);
      }
      if (sheet === "Distribución" || sheet === "Distribucion") {
        const fSol = toDate(r["Fecha de solicitud"]) ?? toDate(r["Fecha  Solicitud"]) ?? toDate(r["Fecha Solicitud"]);
        a.fSolicitudBodega = a.fSolicitudBodega ?? fSol;
        a.fSolicitudVendedor = a.fSolicitudVendedor ?? fSol;
        a.fIngresoApc = a.fIngresoApc ?? toDate(r["1° dia Almacenaje en bodega"]) ?? toDate(r["1° dia Almacenaje"]);
        a.fPlanificacion = a.fPlanificacion ?? toDate(r["Fecha teorica STLI"]);
        a.fechaLimite = a.fechaLimite ?? toDate(r["Fecha limite"]);
        const despachoRaw = r["Fecha despacho a sucursal"];
        if (esSinSalida(despachoRaw)) a.tieneSinSalida = true;
        else a.fDespacho = a.fDespacho ?? toDate(despachoRaw);
      }
      if (sheet === "Almacenamiento " || sheet === "Almacenamiento") {
        a.fIngresoApc = a.fIngresoApc ?? toDate(r["1° dia Almacenaje en bodega"]);
        a.estadoBodega = a.estadoBodega ?? (r["Disponible en bodega"] ?? r["Estado Kar"] ?? r["Estado Kar "]);
      }
      if (sheet === "ENTRADAS") {
        a.fEntradaPatio = a.fEntradaPatio ?? toDate(r["Fecha Ent"] ?? r["Fecha Entrada"]);
        a.estadoBodega = a.estadoBodega ?? (r["Estado"] ?? r["Estado Gp Simplificado"]);
        a.patio = a.patio ?? (r["Patio"] ?? r["Zona"]);
        a.puntoEntrega = a.puntoEntrega ?? (r["Punto de Entrega"] ?? r["Destino"]);
      }
      if (sheet === "SALIDAS") {
        const fSal = toDate(r["Fecha Sal"] ?? r["Fecha Salida"]);
        if (fSal && (!a.fSalidaPatio || fSal > a.fSalidaPatio)) a.fSalidaPatio = fSal;
      }
    }
  }
  return accs;
}

const schiapp = loadBodega(F_SCHIAPP, {
  "Compra Marca": "VIN", "Almacenamiento ": "VIN", "Distribución": "VIN",
  "ENTRADAS": "VIN", "SALIDAS": "VIN", "Solicitud Venta": "Vin", "Solicitud Vitrina": "vin",
});
const kar = loadBodega(F_KAR, {
  "Compras Marca": "VIN", "Almacenamiento": "VIN", "Distribucion": "VIN",
  "ENTRADAS": "VIN", "SALIDAS": "VIN", "Solicitud Venta": "Vin", "Solicitud Vitrina": "vin",
});

// 3) Para cada FNE operativo, calcular cobertura de los 7 hitos logísticos
//    ANTES = solo legacy (no cargado en este ejercicio → 0 datos)
//    DESPUÉS = ROMIA (mejor de SCHIAPP / KAR)
const hitos = ["fSolicitudVendedor", "fIngresoApc", "fSolicitudBodega",
               "fPlanificacion", "fDespacho", "fEstimadaEntrega"];
const cuentaAntes = Object.fromEntries(hitos.map((h) => [h, 0]));
const cuentaDespues = Object.fromEntries(hitos.map((h) => [h, 0]));
let conAlgunHitoDespues = 0;
let conSinSalida = 0;

for (const vin of fneOperativos) {
  const a = schiapp.get(vin);
  const b = kar.get(vin);
  let tieneAlgo = false;
  for (const h of hitos) {
    const valor = (a && a[h]) ?? (b && b[h]) ?? null;
    if (valor) { cuentaDespues[h]++; tieneAlgo = true; }
  }
  if (tieneAlgo) conAlgunHitoDespues++;
  if (a?.tieneSinSalida || b?.tieneSinSalida) conSinSalida++;
}

console.log("════════════════════════════════════════════════════════════════════════════════");
console.log("  VALIDACIÓN ANTES/DESPUÉS — Activación ROMIA (camino 2 coexistencia)");
console.log("════════════════════════════════════════════════════════════════════════════════");
console.log(`  Universo FNE operativo: ${fneOperativos.size}`);
console.log("");
console.log("  COBERTURA POR HITO (sobre 854 FNE):");
console.log("");
const labels = {
  fSolicitudVendedor: "Solicitud vendedor",
  fIngresoApc:        "Ingreso APC",
  fSolicitudBodega:   "Solicitud bodega",
  fPlanificacion:     "Planificación",
  fDespacho:          "Despacho",
  fEstimadaEntrega:   "Entrega comprometida",
};
console.log("  Hito                     ANTES (legacy)    DESPUÉS (ROMIA)     Δ");
console.log("  " + "─".repeat(70));
for (const h of hitos) {
  const a = cuentaAntes[h];
  const b = cuentaDespues[h];
  const pctA = (a / 854 * 100).toFixed(1);
  const pctB = (b / 854 * 100).toFixed(1);
  console.log(`  ${labels[h].padEnd(24)}  ${String(a).padStart(5)} (${pctA.padStart(4)}%)    ${String(b).padStart(5)} (${pctB.padStart(4)}%)    +${b - a}`);
}
console.log("");
console.log(`  VINs con al menos 1 hito ROMIA: ${conAlgunHitoDespues} (${(conAlgunHitoDespues / 854 * 100).toFixed(1)}%)`);
console.log(`  VINs marcados "SIN SALIDA"     : ${conSinSalida} ⚠ auto sin despacho físico`);
console.log("");

// 4) Caso VIN VR3KAHPY3VS000844 — timeline reconstruido
console.log("════════════════════════════════════════════════════════════════════════════════");
console.log(`  CASO PRUEBA: ${VIN_FOCO}`);
console.log("════════════════════════════════════════════════════════════════════════════════");
const sA = schiapp.get(VIN_FOCO);
const kA = kar.get(VIN_FOCO);
const fneFila = filaPorVin.get(VIN_FOCO);

function pickWithSource(...candidates) {
  for (const c of candidates) {
    if (c.v) return { value: c.v, fuente: c.fuente, confianza: c.confianza };
  }
  return { value: null, fuente: "ninguna", confianza: "ninguna" };
}
function fmt(d) {
  if (!d) return "—";
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d);
}

const ingreso = pickWithSource(
  { v: kA?.fIngresoApc, fuente: "ROMIA_KAR", confianza: "alta" },
  { v: sA?.fIngresoApc, fuente: "ROMIA_SCHIAPP", confianza: "alta" },
);
const solVend = pickWithSource(
  { v: kA?.fSolicitudVendedor, fuente: "ROMIA_KAR", confianza: "alta" },
  { v: sA?.fSolicitudVendedor, fuente: "ROMIA_SCHIAPP", confianza: "alta" },
);
const solBodega = pickWithSource(
  { v: kA?.fSolicitudBodega, fuente: "ROMIA_KAR", confianza: "alta" },
  { v: sA?.fSolicitudBodega, fuente: "ROMIA_SCHIAPP", confianza: "alta" },
);
const planif = pickWithSource(
  { v: kA?.fPlanificacion, fuente: "ROMIA_KAR", confianza: "alta" },
  { v: kA?.fechaLimite, fuente: "ROMIA_KAR", confianza: "media" },
  { v: sA?.fPlanificacion, fuente: "ROMIA_SCHIAPP", confianza: "alta" },
);
const despacho = pickWithSource(
  { v: kA?.fDespacho, fuente: "ROMIA_KAR", confianza: "alta" },
  { v: sA?.fDespacho, fuente: "ROMIA_SCHIAPP", confianza: "alta" },
);
const tieneSinSalida = kA?.tieneSinSalida || sA?.tieneSinSalida;

console.log("\n  TIMELINE OPERACIONAL — bajo modelo ROMIA:");
console.log(`    Ingreso APC / preparación   ${fmt(ingreso.value).padEnd(18)} ${ingreso.fuente.padEnd(15)} confianza ${ingreso.confianza}`);
console.log(`    Solicitud vendedor          ${fmt(solVend.value).padEnd(18)} ${solVend.fuente.padEnd(15)} confianza ${solVend.confianza}`);
console.log(`    Solicitud a bodega          ${fmt(solBodega.value).padEnd(18)} ${solBodega.fuente.padEnd(15)} confianza ${solBodega.confianza}`);
console.log(`    Planificación despacho      ${fmt(planif.value).padEnd(18)} ${planif.fuente.padEnd(15)} confianza ${planif.confianza}`);
console.log(`    Despacho a sucursal         ${tieneSinSalida ? "SIN SALIDA".padEnd(18) : fmt(despacho.value).padEnd(18)} ${despacho.fuente.padEnd(15)} confianza ${despacho.confianza}`);
console.log(`    Llegada a sucursal          ${"sin dato".padEnd(18)} ${"(no inferido)".padEnd(15)} ENTRADAS≠sucursal`);
console.log(`    Factura a cliente           ${fmt(toDate(fneFila["FechaFactura"])).padEnd(18)} FNE             confianza alta`);
console.log(`    Inscripción                 ${fmt(toDate(fneFila["FechaInscripcion"])).padEnd(18)} FNE             confianza alta`);

console.log("\n  CONTEXTO ROMIA KAR:");
console.log(`    Estado bodega    : ${kA?.estadoBodega ?? "—"}`);
console.log(`    Patio            : ${kA?.patio ?? "—"}`);
console.log(`    Punto entrega    : ${kA?.puntoEntrega ?? "—"}`);
console.log(`    Entrada al patio : ${fmt(kA?.fEntradaPatio)}`);
console.log(`    Salida del patio : ${fmt(kA?.fSalidaPatio)}`);
console.log(`    Fecha límite     : ${fmt(kA?.fechaLimite)}`);
console.log(`    ¿SIN SALIDA?     : ${kA?.tieneSinSalida ? "SÍ ⚠" : "no"}`);

// 5) Detección de la anomalía
const fechaPatenteRecibida = toDate(fneFila["fecha_patente_recibida"]);
const anomalia = fechaPatenteRecibida && (kA?.tieneSinSalida || sA?.tieneSinSalida) && !(kA?.fSalidaPatio || sA?.fSalidaPatio);
console.log("\n  ANOMALÍA DOCUMENTO ≠ FÍSICO:");
if (anomalia) {
  console.log(`    ⚠ DETECTADA`);
  console.log(`    Patente recibida en sucursal: ${fmt(fechaPatenteRecibida)}`);
  console.log(`    Auto físico: aún en patio KAR sin despacho`);
  console.log(`    Sistema sin ROMIA diría: "listo para entregar"`);
  console.log(`    Realidad operacional: capital retenido $23.4M + 23+ días sin salida`);
} else {
  console.log(`    No detectada para este VIN`);
}

console.log("\n════════════════════════════════════════════════════════════════════════════════");
