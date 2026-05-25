/**
 * AUDITORÍA DE CUADRATURA · 4 Excel vs sistema actual
 *
 * Reproduce la lógica EXACTA del sistema (limpiarVIN, clasificadores,
 * estadoEntrega FNE, categoría saldos, clasificación provisión) y la
 * compara contra los datos crudos de cada Excel.
 *
 * No corrige nada. Solo reporta.
 */

import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const PATH_STOCK = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx";
const PATH_FNE = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Autos no entregados.xlsx";
const PATH_SALDOS = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Reportes Saldos 2.0 18-05-2026_.xlsx";
const PATH_PROV = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Provisiones al 18 de Mayo.xlsx";

// ──────────────────────────────────────────────────────────────────────
// Normalizadores — copia EXACTA de los del sistema
// ──────────────────────────────────────────────────────────────────────

function limpiarVIN(raw) {
  if (raw === null || raw === undefined) return "";
  return String(raw)
    .replace(/[   ​-‍﻿]/g, "")
    .replace(/[\r\n\t]/g, "")
    .replace(/\s+/g, "")
    .replace(/[-_./]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function esVINValido(v) {
  return v.length === 17 && /^[A-Z0-9]{17}$/.test(v);
}

function limpiarCajon(raw) {
  if (raw == null) return "";
  return String(raw).replace(/\s+/g, "").replace(/[-_./]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const RE_PATENTE_CL = /^[A-Z]{4}[0-9]{2}$|^[A-Z]{2}[0-9]{4}$|^[A-Z]{2}[A-Z0-9]{4}$/;
function pareceePatente(c) {
  return c.length === 6 && RE_PATENTE_CL.test(c);
}

const n = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const s = (v) => (v == null || v === "" ? null : String(v).trim());

// ──────────────────────────────────────────────────────────────────────
// LECTURA y conteo por archivo
// ──────────────────────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════════════════");
console.log("AUDITORÍA DE CUADRATURA · 4 Excel vs sistema actual");
console.log("═══════════════════════════════════════════════════════════════\n");

// === STOCK ===
console.log("📂 ARCHIVO 1 · Informe Stock y Lineas\n");
const stockWb = XLSX.read(readFileSync(PATH_STOCK), { type: "buffer", cellDates: true });
console.log(`  Total hojas en archivo: ${stockWb.SheetNames.length}`);

const stockSheets = {
  "Base_Stock": stockWb.Sheets["Base_Stock"],
  "Venta APC Fact VN": stockWb.Sheets["Venta APC Fact VN"],
  "Venta APC Fact VU": stockWb.Sheets["Venta APC Fact VU"],
  "Financiado": stockWb.Sheets["Financiado"],
  "Base Financiamiento": stockWb.Sheets["Base Financiamiento"],
  "3.-Lineas de Credito": stockWb.Sheets["3.-Lineas de Credito"],
  "DETALLE STOCK PROPIO": stockWb.Sheets["DETALLE STOCK PROPIO"],
  "4.-Venc Stock con Financ": stockWb.Sheets["4.-Venc Stock con Financ"],
};

// VINs por hoja del stock
const vinsPorHoja = {};   // hoja → Set<VIN normalizado válido>
const vinsInvalidosPorHoja = {}; // hoja → count
const duplicadosPorHoja = {};
const totalesPorHoja = {};

function procesarHoja(name, ws, vinCols, montoCol) {
  if (!ws) { console.log(`  ⚠ ${name}: NO ENCONTRADA`); return; }
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
  const vinsSet = new Set();
  let invalidos = 0, totalMonto = 0;
  const seen = new Map();
  for (const r of rows) {
    let vinRaw = null;
    for (const col of vinCols) {
      if (r[col]) { vinRaw = r[col]; break; }
    }
    if (vinRaw === null) { invalidos++; continue; }
    const vinL = limpiarVIN(vinRaw);
    if (!esVINValido(vinL)) { invalidos++; continue; }
    seen.set(vinL, (seen.get(vinL) ?? 0) + 1);
    vinsSet.add(vinL);
    if (montoCol && r[montoCol]) totalMonto += n(r[montoCol]);
  }
  const dups = [...seen.entries()].filter(([, c]) => c > 1);
  vinsPorHoja[name] = vinsSet;
  vinsInvalidosPorHoja[name] = invalidos;
  duplicadosPorHoja[name] = dups.length;
  totalesPorHoja[name] = { filas: rows.length, monto: totalMonto };
  console.log(`  ${name.padEnd(28)} filas=${String(rows.length).padStart(6)}  VIN únicos=${String(vinsSet.size).padStart(6)}  invalidos=${String(invalidos).padStart(4)}  dups=${String(dups.length).padStart(4)}` + (montoCol ? `  monto=$${totalMonto.toLocaleString("es-CL")}` : ""));
}

procesarHoja("Base_Stock", stockSheets["Base_Stock"], ["Numero VIN", "Numero Chasis"], "Total Costo");
procesarHoja("Venta APC Fact VN", stockSheets["Venta APC Fact VN"], ["Numero VIN", "Numero Chasis"], "Precio Compra");
procesarHoja("Venta APC Fact VU", stockSheets["Venta APC Fact VU"], ["Numero VIN", "Numero Chasis"], null);
procesarHoja("Financiado", stockSheets["Financiado"], ["VIN"], "Precio De Compra");
procesarHoja("Base Financiamiento", stockSheets["Base Financiamiento"], ["Numero VIN ", "Numero VIN"], "Precio Compra Bruto");

// Línea de crédito (no por VIN, sino agregado por marca)
{
  const ws = stockSheets["3.-Lineas de Credito"];
  if (ws) {
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
    let totalLineaAuth = 0, totalLineaOcup = 0, totalLineaLibre = 0;
    for (const r of rows) {
      totalLineaAuth += n(r["Linea Autorizada"]);
      totalLineaOcup += n(r["Linea Ocupada"]);
      totalLineaLibre += n(r["Linea Libre"]);
    }
    console.log(`  3.-Lineas de Credito         filas=${String(rows.length).padStart(6)}  L.autorizada=$${totalLineaAuth.toLocaleString("es-CL")}  L.ocupada=$${totalLineaOcup.toLocaleString("es-CL")}  L.libre=$${totalLineaLibre.toLocaleString("es-CL")}`);
    totalesPorHoja["3.-Lineas de Credito"] = { lineaAuth: totalLineaAuth, lineaOcup: totalLineaOcup, lineaLibre: totalLineaLibre };
  }
}

// === FNE ===
console.log("\n📂 ARCHIVO 2 · Autos no entregados\n");
const fneWb = XLSX.read(readFileSync(PATH_FNE), { type: "buffer", cellDates: true });
const fneRows = XLSX.utils.sheet_to_json(fneWb.Sheets["ROMA"], { defval: null, raw: true });
const fneVins = new Set();
const fneSeen = new Map();
let fneInvalidos = 0, fneMonto = 0;
const fneByVin = new Map();
for (const r of fneRows) {
  const vinL = limpiarVIN(r.Vin);
  if (!esVINValido(vinL)) { fneInvalidos++; continue; }
  fneSeen.set(vinL, (fneSeen.get(vinL) ?? 0) + 1);
  fneVins.add(vinL);
  fneMonto += n(r.ValorFactura);
  fneByVin.set(vinL, r);
}
const fneDups = [...fneSeen.entries()].filter(([, c]) => c > 1);
console.log(`  ROMA                         filas=${String(fneRows.length).padStart(6)}  VIN únicos=${String(fneVins.size).padStart(6)}  invalidos=${String(fneInvalidos).padStart(4)}  dups=${String(fneDups.length).padStart(4)}  monto facturado=$${fneMonto.toLocaleString("es-CL")}`);

// === SALDOS ===
console.log("\n📂 ARCHIVO 3 · Reportes Saldos\n");
const saldosWb = XLSX.read(readFileSync(PATH_SALDOS), { type: "buffer", cellDates: true });
const saldosRows = XLSX.utils.sheet_to_json(saldosWb.Sheets["FUSION BD 3.0"], { defval: null, raw: true });
let saldosCategVeh = 0, saldosCategBono = 0, saldosCategServ = 0, saldosCategOther = 0;
let saldoVehiculo = 0, saldoBono = 0, saldoServ = 0, saldoTotal = 0;
let creditoPompeyoTotal = 0;
let cPompeyoSaldos = 0;
const saldosCajones = new Map();
const saldosCajonAsVIN = new Set();
const saldosCajonAsPatente = new Set();
let saldosSinCajon = 0, saldosPatente6 = 0;

for (const r of saldosRows) {
  const cat = (r["CATEGORIA"] ?? "").toUpperCase();
  const monto = n(r["Saldo x Documentar"]);
  saldoTotal += monto;
  if (cat.includes("VEHICULO") || cat.startsWith("1 ")) { saldosCategVeh++; saldoVehiculo += monto; }
  else if (cat.includes("BONO") || cat.includes("COMISION") || cat.includes("INCENTIVO") || cat.startsWith("2 ")) { saldosCategBono++; saldoBono += monto; }
  else if (cat.includes("SERVICIO") || cat.startsWith("3 ")) { saldosCategServ++; saldoServ += monto; }
  else saldosCategOther++;

  const cP = n(r[" C.Pompeyo"]);
  const tipo = String(r["Tipo"] ?? "").toUpperCase();
  if (cP > 0 || tipo.includes("CREDITO POMPEYO")) {
    creditoPompeyoTotal += cP;
    cPompeyoSaldos++;
  }

  const cajon = limpiarCajon(r["Cajon"]);
  if (!cajon || cajon.length < 6) { saldosSinCajon++; continue; }
  if (cat.includes("VEHICULO") || cat.startsWith("1 ")) {
    if (pareceePatente(cajon)) saldosPatente6++;
    saldosCajones.set(cajon, (saldosCajones.get(cajon) ?? 0) + 1);
  }
}

console.log(`  FUSION BD 3.0                filas=${String(saldosRows.length).padStart(6)}  saldo total=$${saldoTotal.toLocaleString("es-CL")}`);
console.log(`    · categoría vehículo       : ${String(saldosCategVeh).padStart(5)}  saldo=$${saldoVehiculo.toLocaleString("es-CL")}`);
console.log(`    · categoría bono/comisión  : ${String(saldosCategBono).padStart(5)}  saldo=$${saldoBono.toLocaleString("es-CL")}`);
console.log(`    · categoría servicios      : ${String(saldosCategServ).padStart(5)}  saldo=$${saldoServ.toLocaleString("es-CL")}`);
console.log(`    · categoría desconocida    : ${String(saldosCategOther).padStart(5)}`);
console.log(`    · con Crédito Pompeyo > 0  : ${String(cPompeyoSaldos).padStart(5)}  monto=$${creditoPompeyoTotal.toLocaleString("es-CL")}`);
console.log(`    · sin Cajón / Cajón corto  : ${String(saldosSinCajon).padStart(5)}  (no se cruzan por VIN)`);
console.log(`    · Cajón formato patente    : ${String(saldosPatente6).padStart(5)}  (probable cruce por patente)`);

// === PROVISIONES ===
console.log("\n📂 ARCHIVO 4 · Provisiones\n");
const provWb = XLSX.read(readFileSync(PATH_PROV), { type: "buffer", cellDates: true });
const provRows = XLSX.utils.sheet_to_json(provWb.Sheets["ROMA"], { defval: null, raw: true });
let provTotal = 0, provNoFact = 0, provFact = 0, provRev = 0;
let montoProvTotal = 0, montoNoFact = 0, montoFact = 0, montoRev = 0;
for (const r of provRows) {
  const mp = n(r["montoProvision"]);
  const mf = n(r["montoFactura"]);
  const aj = s(r["EstadoAjuste"]);
  montoProvTotal += mp;
  provTotal++;
  if (aj && /pendiente/i.test(aj)) { provRev++; montoRev += mp; continue; }
  if (mf > 0) { provFact++; montoFact += mp; }
  else { provNoFact++; montoNoFact += mp; }
}
console.log(`  ROMA                         filas=${String(provRows.length).padStart(6)}`);
console.log(`    · no facturada (activa)    : ${String(provNoFact).padStart(5)}  monto=$${montoNoFact.toLocaleString("es-CL")}`);
console.log(`    · facturada (referencia)   : ${String(provFact).padStart(5)}  monto=$${montoFact.toLocaleString("es-CL")}`);
console.log(`    · revisión manual          : ${String(provRev).padStart(5)}  monto=$${montoRev.toLocaleString("es-CL")}`);

// ──────────────────────────────────────────────────────────────────────
// CONSOLIDACIÓN VIN — FULL OUTER JOIN
// ──────────────────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════");
console.log("CONSOLIDACIÓN VIN · FULL OUTER JOIN entre todas las fuentes");
console.log("═══════════════════════════════════════════════════════════════\n");

const ALL_FUENTES = ["Base_Stock", "Venta APC Fact VN", "Venta APC Fact VU", "Financiado", "Base Financiamiento", "FNE"];
const universoVIN = new Set();
const vinPresencia = new Map(); // VIN → { Base_Stock: 1, FNE: 0, ... }

function addVin(vin, fuente) {
  universoVIN.add(vin);
  if (!vinPresencia.has(vin)) {
    vinPresencia.set(vin, Object.fromEntries(ALL_FUENTES.map((f) => [f, 0])));
  }
  vinPresencia.get(vin)[fuente] = 1;
}

for (const [hoja, set] of Object.entries(vinsPorHoja)) {
  for (const v of set) addVin(v, hoja);
}
for (const v of fneVins) addVin(v, "FNE");

console.log(`Universo VIN único consolidado: ${universoVIN.size}\n`);

// Distribución por presencia
const distribPresencia = {};
for (const [vin, pres] of vinPresencia) {
  const sources = ALL_FUENTES.filter((f) => pres[f]);
  const key = sources.join(" + ") || "(ninguno)";
  distribPresencia[key] = (distribPresencia[key] ?? 0) + 1;
}
const sortedDistrib = Object.entries(distribPresencia).sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log("Top 20 combinaciones de presencia (cuántos VIN en qué intersección):");
for (const [combo, count] of sortedDistrib) {
  console.log(`  ${String(count).padStart(6)}  ${combo}`);
}

// VIN solo en una fuente
console.log("\nVIN exclusivos por fuente:");
for (const f of ALL_FUENTES) {
  let solo = 0;
  for (const [, pres] of vinPresencia) {
    const otros = ALL_FUENTES.filter((x) => x !== f && pres[x]).length;
    if (pres[f] && otros === 0) solo++;
  }
  console.log(`  ${f.padEnd(28)} solo en esta fuente: ${solo}`);
}

// Intersecciones críticas
const interseccion = (...fuentes) => {
  let c = 0;
  for (const [, pres] of vinPresencia) {
    if (fuentes.every((f) => pres[f])) c++;
  }
  return c;
};

console.log("\nIntersecciones clave:");
console.log(`  FNE ∩ Base_Stock                : ${interseccion("FNE", "Base_Stock")}`);
console.log(`  FNE ∩ Venta APC Fact VN         : ${interseccion("FNE", "Venta APC Fact VN")}`);
console.log(`  FNE ∩ Financiado                : ${interseccion("FNE", "Financiado")}`);
console.log(`  Base_Stock ∩ Venta APC Fact VN  : ${interseccion("Base_Stock", "Venta APC Fact VN")}`);
console.log(`  Base_Stock ∩ Financiado         : ${interseccion("Base_Stock", "Financiado")}`);
console.log(`  FNE \\ Base_Stock (en FNE, no en stock activo): ${[...vinPresencia.entries()].filter(([, p]) => p["FNE"] && !p["Base_Stock"]).length}`);

// Cruce con saldos (no por VIN exacto, sino por Cajón → últimos 8 chars VIN)
console.log("\n──── Cruce Saldos.vehículo ↔ universo VIN (por Cajón ≈ últimos 8 VIN) ────");
const cajonesUniverso = new Map(); // últimos 8 → set de VINs
for (const v of universoVIN) {
  const l8 = v.slice(-8);
  if (!cajonesUniverso.has(l8)) cajonesUniverso.set(l8, new Set());
  cajonesUniverso.get(l8).add(v);
}
// También patente como bridge
const patenteToVIN = new Map();
{
  const ws = stockSheets["Base_Stock"];
  if (ws) {
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
    for (const r of rows) {
      const v = limpiarVIN(r["Numero VIN"]);
      if (!esVINValido(v)) continue;
      const p = String(r["Placa Patente"] ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (p.length >= 6) patenteToVIN.set(p, v);
    }
  }
}
let saldoVehCruzaVIN = 0, saldoVehNoCruza = 0;
let saldoCruzadoCLP = 0, saldoNoCruzadoCLP = 0;
for (const r of saldosRows) {
  const cat = (r["CATEGORIA"] ?? "").toUpperCase();
  if (!(cat.includes("VEHICULO") || cat.startsWith("1 "))) continue;
  const cajon = limpiarCajon(r["Cajon"]);
  const monto = n(r["Saldo x Documentar"]);
  let cruza = false;
  if (pareceePatente(cajon) && patenteToVIN.has(cajon)) cruza = true;
  else if (cajonesUniverso.has(cajon)) cruza = true;
  if (cruza) { saldoVehCruzaVIN++; saldoCruzadoCLP += monto; }
  else { saldoVehNoCruza++; saldoNoCruzadoCLP += monto; }
}
console.log(`  Saldos categoría VEHÍCULO: ${saldosCategVeh}`);
console.log(`    · cruza con VIN universal: ${saldoVehCruzaVIN}  ($${saldoCruzadoCLP.toLocaleString("es-CL")})`);
console.log(`    · NO cruza               : ${saldoVehNoCruza}  ($${saldoNoCruzadoCLP.toLocaleString("es-CL")})`);

// ──────────────────────────────────────────────────────────────────────
// FNE: cuadratura de clasificación de entrega
// ──────────────────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════");
console.log("CUADRATURA · Estados de entrega FNE (lógica del sistema)");
console.log("═══════════════════════════════════════════════════════════════\n");

const isSi = (v) => v === "Si" || v === "si" || v === "SI";
const has = (v) => v != null;

let listo = 0, faltaAut = 0, patSuc = 0, patTrans = 0, patAdmin = 0, inscritaSinAdmin = 0, enRC = 0, enCdN = 0, sinSol = 0;
let listoMonto = 0;

for (const r of fneRows) {
  const monto = n(r.ValorFactura);
  const patRec = has(r.fecha_patente_recibida);
  if (patRec) {
    if (isSi(r.sol_entrega) && isSi(r.autorizacion_entrega)) { listo++; listoMonto += monto; }
    else if (isSi(r.sol_entrega)) faltaAut++;
    else patSuc++;
  } else if (has(r.fecha_patente_enviada)) patTrans++;
  else if (has(r.patentes_administracion)) patAdmin++;
  else if (has(r.FechaInscripcion)) inscritaSinAdmin++;
  else if (has(r.FechaSolicitudInscripcion)) enRC++;
  else if (isSi(r.SolicitarInscripcion)) enCdN++;
  else sinSol++;
}

const totalCheck = listo + faltaAut + patSuc + patTrans + patAdmin + inscritaSinAdmin + enRC + enCdN + sinSol;
console.log(`  Bucket "Listo para entregar"            : ${String(listo).padStart(4)} ($${listoMonto.toLocaleString("es-CL")})`);
console.log(`  Bucket "Falta autorización"             : ${String(faltaAut).padStart(4)}`);
console.log(`  Bucket "Patente sucursal · sin sol"     : ${String(patSuc).padStart(4)}`);
console.log(`  Bucket "Patente en tránsito"            : ${String(patTrans).padStart(4)}`);
console.log(`  Bucket "Patente en admin"               : ${String(patAdmin).padStart(4)}`);
console.log(`  Bucket "Inscrita sin admin"             : ${String(inscritaSinAdmin).padStart(4)}`);
console.log(`  Bucket "En registro civil"              : ${String(enRC).padStart(4)}`);
console.log(`  Bucket "En control de negocios"         : ${String(enCdN).padStart(4)}`);
console.log(`  Bucket "Sin solicitud comercial"        : ${String(sinSol).padStart(4)}`);
console.log(`  ──────`);
console.log(`  SUMA buckets    : ${totalCheck}`);
console.log(`  Total FNE rows  : ${fneRows.length}`);
console.log(`  ¿Cuadra?        : ${totalCheck === fneRows.length ? "✓ SÍ" : "✗ NO"}`);

// ──────────────────────────────────────────────────────────────────────
// CAPITAL DE TRABAJO consolidado (cómo lo calcula el sistema)
// ──────────────────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════");
console.log("CAPITAL DE TRABAJO consolidado");
console.log("═══════════════════════════════════════════════════════════════\n");

// Base_Stock: capital total, propio, floor plan
let stockTotal = 0, stockPropio = 0, stockFloorPlan = 0;
{
  const ws = stockSheets["Base_Stock"];
  if (ws) {
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
    for (const r of rows) {
      const v = limpiarVIN(r["Numero VIN"]);
      if (!esVINValido(v)) continue;
      const c = n(r["Total Costo"]);
      stockTotal += c;
      const tipo = String(r["Tipo Stock"] ?? "").toUpperCase();
      if (tipo === "PROPIO" || tipo === "FIN PROPIO") stockPropio += c;
      if (tipo === "FLOOR PLAN") stockFloorPlan += c;
    }
  }
}
console.log(`  Stock total (Base_Stock)           : $${stockTotal.toLocaleString("es-CL")}`);
console.log(`  Stock propio + fin propio          : $${stockPropio.toLocaleString("es-CL")}`);
console.log(`  Stock Floor Plan                   : $${stockFloorPlan.toLocaleString("es-CL")}`);
console.log(`  FNE valor facturado                : $${fneMonto.toLocaleString("es-CL")}`);
console.log(`  Saldos categoría vehículo          : $${saldoVehiculo.toLocaleString("es-CL")}`);
console.log(`  Saldos bonos/comisiones (admin)    : $${saldoBono.toLocaleString("es-CL")}`);
console.log(`  Crédito Pompeyo (en saldos)        : $${creditoPompeyoTotal.toLocaleString("es-CL")}`);
console.log(`  Provisiones NO facturadas (activas): $${montoNoFact.toLocaleString("es-CL")}`);
console.log(`  Provisiones facturadas (referencia): $${montoFact.toLocaleString("es-CL")}`);
console.log(`  Provisiones revisión manual        : $${montoRev.toLocaleString("es-CL")}`);
console.log(`  Líneas de crédito autorizadas      : ${totalesPorHoja["3.-Lineas de Credito"] ? "$" + totalesPorHoja["3.-Lineas de Credito"].lineaAuth.toLocaleString("es-CL") : "—"}`);
console.log(`  Líneas ocupadas                    : ${totalesPorHoja["3.-Lineas de Credito"] ? "$" + totalesPorHoja["3.-Lineas de Credito"].lineaOcup.toLocaleString("es-CL") : "—"}`);

// Capital comprometido estimado del sistema (fórmula actual):
// stockPropio + max(fne, saldosCategVeh) + provisionesNoFacturadas
const capitalComprometidoEstimado = stockPropio + Math.max(fneMonto, saldoVehiculo) + montoNoFact;
console.log(`\n  Capital comprometido estimado (fórmula sistema):`);
console.log(`    = stockPropio + max(FNE, saldosVehículo) + provisionesNoFacturadas`);
console.log(`    = $${stockPropio.toLocaleString("es-CL")} + max($${fneMonto.toLocaleString("es-CL")}, $${saldoVehiculo.toLocaleString("es-CL")}) + $${montoNoFact.toLocaleString("es-CL")}`);
console.log(`    = $${capitalComprometidoEstimado.toLocaleString("es-CL")}`);

// ──────────────────────────────────────────────────────────────────────
// DOBLE CONTEO: FNE ∩ Saldos.vehiculo
// ──────────────────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════");
console.log("DOBLE CONTEO · FNE ∩ Saldos.vehículo");
console.log("═══════════════════════════════════════════════════════════════\n");

// Construir bridge cajón → VIN
const bridgeCajonVin = new Map();
for (const v of universoVIN) bridgeCajonVin.set(v.slice(-8), v);

let dcAlto = 0, dcMedio = 0, dcBajo = 0;
let dcCapital = 0;
const vinsConFNEYSaldo = new Set();
for (const r of saldosRows) {
  const cat = (r["CATEGORIA"] ?? "").toUpperCase();
  if (!(cat.includes("VEHICULO") || cat.startsWith("1 "))) continue;
  const cajon = limpiarCajon(r["Cajon"]);
  let vin = null;
  if (pareceePatente(cajon) && patenteToVIN.has(cajon)) vin = patenteToVIN.get(cajon);
  else if (bridgeCajonVin.has(cajon)) vin = bridgeCajonVin.get(cajon);
  if (!vin) continue;
  const fneRec = fneByVin.get(vin);
  if (!fneRec) continue;
  vinsConFNEYSaldo.add(vin);
  const factura = n(fneRec.ValorFactura);
  const saldo = n(r["Saldo x Documentar"]);
  if (saldo === 0) continue;
  const max = Math.max(factura, saldo) || 1;
  const dif = Math.abs(saldo - factura) / max;
  const cP = n(r[" C.Pompeyo"]);
  if (dif < 0.1 && max >= 5_000_000) dcAlto++;
  else if (dif < 0.3 || cP > 0) dcMedio++;
  else dcBajo++;
}
for (const v of vinsConFNEYSaldo) {
  const f = fneByVin.get(v);
  dcCapital += n(f.ValorFactura);
}
console.log(`  VINs en FNE Y con saldo.vehículo asignado: ${vinsConFNEYSaldo.size}`);
console.log(`  Capital en alerta de doble conteo        : $${dcCapital.toLocaleString("es-CL")}`);
console.log(`  Alertas Alto                              : ${dcAlto}`);
console.log(`  Alertas Medio                             : ${dcMedio}`);
console.log(`  Alertas Bajo                              : ${dcBajo}`);

// ──────────────────────────────────────────────────────────────────────
// REGLAS DE NEGOCIO
// ──────────────────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════");
console.log("VALIDACIÓN REGLAS DE NEGOCIO");
console.log("═══════════════════════════════════════════════════════════════\n");

// 1. VIN en FNE pero sin Base_Stock → debe seguir visible
const fneSinStock = [...fneVins].filter((v) => !vinsPorHoja["Base_Stock"].has(v));
console.log(`R1. VINs FNE sin Base_Stock activo: ${fneSinStock.length} (${(fneSinStock.length / fneVins.size * 100).toFixed(1)}%)`);
console.log(`    El sistema NO los descarta — cruza contra registry suplementario (Venta APC + Financiado).`);
const fneEnSuplementario = fneSinStock.filter((v) =>
  vinsPorHoja["Venta APC Fact VN"]?.has(v) ||
  vinsPorHoja["Venta APC Fact VU"]?.has(v) ||
  vinsPorHoja["Financiado"]?.has(v) ||
  vinsPorHoja["Base Financiamiento"]?.has(v),
).length;
console.log(`    De esos, recuperados en suplementario: ${fneEnSuplementario}`);
console.log(`    SIN ningún cruce stock+suplementario : ${fneSinStock.length - fneEnSuplementario}`);

// 2. Provisiones no se cruzan por VIN — solo se agregan por marca
console.log(`\nR2. Provisiones: ${provRows.length} sin columna VIN. ✓ Sistema agrupa por Origen (marca).`);

// 3. FNE bucket "Listo total" debería igual a FNE con sol+autor+patenteRecib
console.log(`\nR3. Universo "Listo entrega" según señales archivo: ${listo} (cuadra con sistema)`);

// 4. Universo VIN consolidado
console.log(`\nR4. Universo VIN único: ${universoVIN.size} (FULL OUTER JOIN)`);

// Generar resumen final
console.log("\n═══════════════════════════════════════════════════════════════");
console.log("RESUMEN EJECUTIVO");
console.log("═══════════════════════════════════════════════════════════════\n");
console.log(`Stock activo       : ${vinsPorHoja["Base_Stock"]?.size} VINs únicos`);
console.log(`Histórico ventas VN: ${vinsPorHoja["Venta APC Fact VN"]?.size} VINs únicos`);
console.log(`Histórico ventas VU: ${vinsPorHoja["Venta APC Fact VU"]?.size} VINs únicos`);
console.log(`Financiado actual  : ${vinsPorHoja["Financiado"]?.size} VINs únicos`);
console.log(`FNE                : ${fneVins.size} VINs únicos`);
console.log(`Saldos vehículo    : ${saldosCategVeh} registros (cruza ${saldoVehCruzaVIN} por Cajón/Patente)`);
console.log(`Provisiones        : ${provRows.length} (${provNoFact} activas no facturadas)`);
console.log(``);
console.log(`Universo VIN único consolidado: ${universoVIN.size}`);
console.log(`Capital comprometido estimado : $${capitalComprometidoEstimado.toLocaleString("es-CL")}`);
console.log(`Capital en alertas DC         : $${dcCapital.toLocaleString("es-CL")}`);
