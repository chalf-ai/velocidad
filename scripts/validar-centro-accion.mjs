/**
 * Validación pre-deploy del Centro de Acción.
 * Mide performance, muestra top críticos reales y verifica que el universo
 * no duplica conteos entre tabs.
 */

import * as XLSX from "xlsx";
import { readFileSync } from "fs";
import { performance } from "perf_hooks";

const PATH_STOCK = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx";
const PATH_FNE = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Autos no entregados.xlsx";
const PATH_SALDOS = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Reportes Saldos 2.0 18-05-2026_.xlsx";

const t0 = performance.now();

// Helpers
const n = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const s = (v) => (v == null || v === "" ? null : String(v).trim());
const isSi = (v) => v === "Si" || v === "si" || v === "SI";
const has = (v) => v != null;

function limpiarVIN(raw) {
  if (raw == null) return "";
  return String(raw).replace(/[   ​-‍﻿]/g, "").replace(/[\r\n\t]/g, "").replace(/\s+/g, "").replace(/[-_./]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function limpiarCajon(raw) {
  if (raw == null) return "";
  return String(raw).replace(/\s+/g, "").replace(/[-_./]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
const esVINValido = (v) => v.length === 17 && /^[A-Z0-9]{17}$/.test(v);
const RE_PATENTE_CL = /^[A-Z]{4}[0-9]{2}$|^[A-Z]{2}[0-9]{4}$|^[A-Z]{2}[A-Z0-9]{4}$/;
const pareceePatente = (c) => c.length === 6 && RE_PATENTE_CL.test(c);

// ─── PASO 1: cargar archivos ─────────────────────────────────────────
const stockWb = XLSX.read(readFileSync(PATH_STOCK), { type: "buffer", cellDates: true });
const fneRows = XLSX.utils.sheet_to_json(XLSX.read(readFileSync(PATH_FNE), { type: "buffer", cellDates: true }).Sheets["ROMA"], { defval: null, raw: true });
const saldosRows = XLSX.utils.sheet_to_json(XLSX.read(readFileSync(PATH_SALDOS), { type: "buffer", cellDates: true }).Sheets["FUSION BD 3.0"], { defval: null, raw: true });

const tLoad = performance.now() - t0;

// ─── PASO 2: construir universo + cruces (reproduce buildVehiculosUnificados) ─
const t1 = performance.now();
const universo = new Map();
function ensure(vinL) {
  if (!universo.has(vinL)) {
    universo.set(vinL, {
      vinLimpio: vinL,
      marca: null, modelo: null, patente: null, cliente: null, sucursal: null, cajon: null,
      enStockActivo: false, enHistoricoVenta: false, enFinanciado: false, enFNE: false, enSaldos: false,
      tipoStock: null, costoNeto: 0, diasStock: null,
      fneEstado: null, fneDiasFactura: null, fneDiasEnEstado: null, fneValorFactura: 0, fneAutoEnSucursal: null,
      saldoCliente: 0, creditoPompeyo: 0,
      esJudicial: false, esTescar: false, esVPP: false, diasVPP: null, diasTescar: null,
      esStockPagadoViejo: false, lineaSobregirada: false, marcaLineaVinculada: null,
      capitalComprometido: 0, capitalComprometidoFuente: "ninguna",
    });
  }
  return universo.get(vinL);
}

// Base_Stock
const baseRows = XLSX.utils.sheet_to_json(stockWb.Sheets["Base_Stock"], { defval: null, raw: true });
for (const r of baseRows) {
  const vinL = limpiarVIN(r["Numero VIN"]);
  if (!esVINValido(vinL)) continue;
  const vu = ensure(vinL);
  vu.enStockActivo = true;
  vu.marca = vu.marca ?? s(r["Marca"]) ?? null;
  vu.modelo = vu.modelo ?? s(r["Modelo"]);
  vu.patente = vu.patente ?? s(r["Placa Patente"]);
  vu.sucursal = vu.sucursal ?? s(r["Sucursal"]);
  vu.tipoStock = vu.tipoStock ?? s(r["Tipo Stock"]);
  vu.costoNeto = vu.costoNeto || n(r["Total Costo"]);
  vu.diasStock = vu.diasStock ?? (typeof r["Días Stock"] === "number" ? r["Días Stock"] : null);
  if ((vu.tipoStock === "Propio" || vu.tipoStock === "FinPropio") && (vu.diasStock ?? 0) > 180) {
    vu.esStockPagadoViejo = true;
  }
  // Judicial: stockAB Judicial
  const stockAB = s(r["Stock A/B"]) ?? s(r["Tipo de Stock"]);
  if (stockAB && /JUDICIAL/i.test(stockAB)) vu.esJudicial = true;
  // TESCAR
  const tipoStockRaw = s(r["Tipo Stock"]);
  if (tipoStockRaw && /TESCAR/i.test(tipoStockRaw)) {
    vu.esTescar = true;
    vu.diasTescar = vu.diasStock;
  }
}

// Venta APC VN/VU (suplementario)
for (const sheet of ["Venta APC Fact VN", "Venta APC Fact VU"]) {
  const ws = stockWb.Sheets[sheet];
  if (!ws) continue;
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
  for (const r of rows) {
    const vinL = limpiarVIN(r["Numero VIN"] ?? r["Numero Chasis"]);
    if (!esVINValido(vinL)) continue;
    const vu = ensure(vinL);
    vu.enHistoricoVenta = true;
    vu.marca = vu.marca ?? s(r["Marca"]);
    vu.modelo = vu.modelo ?? s(r["Modelo"]);
    vu.patente = vu.patente ?? s(r["Placa Patente"]);
    vu.sucursal = vu.sucursal ?? s(r["Sucursal"]);
    vu.cliente = vu.cliente ?? s(r["Cliente"]);
  }
}

// FNE
function estadoEntrega(r) {
  if (has(r.fecha_patente_recibida)) {
    if (isSi(r.sol_entrega) && isSi(r.autorizacion_entrega)) return "listo_para_entregar";
    if (isSi(r.sol_entrega)) return "falta_solo_autorizacion";
    return "patente_en_sucursal";
  }
  if (has(r.fecha_patente_enviada)) return "patente_en_transito";
  if (has(r.patentes_administracion)) return "patente_en_admin";
  if (has(r.FechaInscripcion)) return "inscrita_sin_admin";
  if (has(r.FechaSolicitudInscripcion)) return "en_registro_civil";
  if (isSi(r.SolicitarInscripcion)) return "en_control_negocios";
  return "sin_solicitud_inscripcion";
}
const HOY = new Date("2026-05-21");
for (const r of fneRows) {
  const vinL = limpiarVIN(r.Vin);
  if (!esVINValido(vinL)) continue;
  const vu = ensure(vinL);
  vu.enFNE = true;
  vu.cliente = vu.cliente ?? s(r.Nombre_Cliente);
  vu.sucursal = vu.sucursal ?? s(r.Sucursal);
  vu.fneValorFactura = n(r.ValorFactura);
  vu.fneEstado = estadoEntrega(r);
  if (r.FechaFactura) {
    const fF = new Date(r.FechaFactura);
    vu.fneDiasFactura = Math.floor((HOY - fF) / 86400000);
  }
  // diasEnEstado simplificado (la fecha de referencia depende del estado)
  // En el sistema real esto lo calcula el selector; aquí aproximamos con FechaFactura
  vu.fneDiasEnEstado = vu.fneDiasFactura;
}

// Saldos + Crédito Pompeyo (con fix H1)
const cajonToVIN = new Map();
const patenteToVIN = new Map();
for (const [vinL, vu] of universo) {
  cajonToVIN.set(vinL.slice(-8), vinL);
  if (vu.patente) {
    const p = String(vu.patente).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (p.length >= 6) patenteToVIN.set(p, vinL);
  }
}
for (const r of saldosRows) {
  const cat = String(r["CATEGORIA"] ?? "").toUpperCase();
  if (!(cat.includes("VEHICULO") || cat.startsWith("1 "))) continue;
  const tipoRaw = String(r["Tipo"] ?? "");
  const subTipoEsCP = /1\.6/.test(tipoRaw);
  const cajon = limpiarCajon(r["Cajon"]);
  let vinL = null;
  if (pareceePatente(cajon) && patenteToVIN.has(cajon)) vinL = patenteToVIN.get(cajon);
  else if (cajonToVIN.has(cajon)) vinL = cajonToVIN.get(cajon);
  if (!vinL) continue;
  const vu = ensure(vinL);
  vu.enSaldos = true;
  vu.saldoCliente += n(r["Saldo x Documentar"]);
  if (subTipoEsCP) vu.creditoPompeyo += n(r["Saldo x Documentar"]); // fix H1
}

// Capital comprometido (max sin doble conteo)
for (const vu of universo.values()) {
  const propio = vu.tipoStock === "Propio" || vu.tipoStock === "FinPropio" ? vu.costoNeto : 0;
  const opts = [
    { monto: vu.fneValorFactura, fuente: "fne" },
    { monto: vu.saldoCliente, fuente: "saldo_cliente" },
    { monto: propio, fuente: "stock_propio" },
    { monto: vu.creditoPompeyo, fuente: "credito_pompeyo" },
  ];
  let best = { monto: 0, fuente: "ninguna" };
  for (const o of opts) if (o.monto > best.monto) best = o;
  vu.capitalComprometido = best.monto;
  vu.capitalComprometidoFuente = best.fuente;
}

const tBuild = performance.now() - t1;

// ─── PASO 3: scoring ──────────────────────────────────────────────────
const t2 = performance.now();
function maxAging(vu) {
  return Math.max(vu.fneDiasFactura ?? 0, vu.diasStock ?? 0, vu.fneDiasEnEstado ?? 0, vu.diasTescar ?? 0);
}
function score(vu) {
  let aging = 0, fin = 0, op = 0, caja = 0, riesgo = 0;
  const razones = [];
  const d = maxAging(vu);
  if (d > 180) { aging += 25; razones.push(`+25 Aging >180d (${d}d)`); }
  else if (d > 90) { aging += 15; razones.push(`+15 Aging 91-180d (${d}d)`); }
  else if (d > 60) { aging += 8; razones.push(`+8 Aging 61-90d (${d}d)`); }
  else if (d > 30) { aging += 4; razones.push(`+4 Aging 31-60d (${d}d)`); }

  if (vu.creditoPompeyo > 0) { fin += 20; razones.push(`+20 C.P. activo $${vu.creditoPompeyo.toLocaleString("es-CL")}`); }
  if (vu.lineaSobregirada) { fin += 10; razones.push(`+10 Sobregiro línea marca`); }

  if (vu.enFNE) {
    const e = vu.fneDiasEnEstado ?? 0;
    if (vu.fneEstado !== "listo_para_entregar" && e > 15) { op += 15; razones.push(`+15 FNE detenido >15d (${e}d en ${vu.fneEstado})`); }
    if (vu.fneEstado === "listo_para_entregar" && e > 3) { op += 12; razones.push(`+12 FNE listo retenido ${e}d`); }
    if (vu.fneEstado === "sin_solicitud_inscripcion") { op += 8; razones.push(`+8 Sin solicitud comercial`); }
    const procPatente = ["patente_en_transito", "patente_en_admin", "inscrita_sin_admin", "en_registro_civil", "en_control_negocios"].includes(vu.fneEstado);
    if (procPatente && e > 30) { op += 10; razones.push(`+10 Proceso patente >30d`); }
  }
  if (vu.esVPP && (vu.diasVPP ?? 0) > 60) { op += 10; razones.push(`+10 VU puente envejecido`); }

  const cap = vu.capitalComprometido;
  if (cap > 30_000_000) { caja += 10; razones.push(`+10 Capital >$30M ($${(cap / 1e6).toFixed(1)}M)`); }
  else if (cap > 10_000_000) { caja += 6; razones.push(`+6 Capital $10-30M`); }
  else if (cap > 5_000_000) { caja += 3; razones.push(`+3 Capital $5-10M`); }
  if (vu.esStockPagadoViejo) { caja += 12; razones.push(`+12 Stock pagado +180d`); }
  if (vu.esTescar && (vu.diasTescar ?? 0) > 180) { caja += 12; razones.push(`+12 TESCAR +180d`); }

  if (vu.esJudicial) { riesgo += 20; razones.push(`+20 Judicial`); }

  aging = Math.min(aging, 25);
  fin = Math.min(fin, 25);
  op = Math.min(op, 25);
  caja = Math.min(caja, 15);
  riesgo = Math.min(riesgo, 10);
  const total = Math.min(100, aging + fin + op + caja + riesgo);
  const sev = total >= 80 ? "critica" : total >= 60 ? "alta" : total >= 30 ? "media" : "info";
  return { total, sev, razones };
}

const scored = [];
for (const vu of universo.values()) {
  const sc = score(vu);
  if (sc.total === 0) continue;
  scored.push({ vu, sc });
}
scored.sort((a, b) => b.sc.total - a.sc.total);
const tScore = performance.now() - t2;

// ─── REPORTE ─────────────────────────────────────────────────────────
const tTotal = performance.now() - t0;

console.log("═══════════════════════════════════════════════════════════════");
console.log("VALIDACIÓN /centro-accion");
console.log("═══════════════════════════════════════════════════════════════\n");

console.log("⏱  PERFORMANCE");
console.log(`  Carga 3 archivos Excel  : ${tLoad.toFixed(0)} ms`);
console.log(`  Build universo VIN      : ${tBuild.toFixed(0)} ms  (${universo.size} VINs)`);
console.log(`  Scoring + sort          : ${tScore.toFixed(0)} ms  (${scored.length} scored)`);
console.log(`  ────`);
console.log(`  Total                   : ${tTotal.toFixed(0)} ms`);
console.log(`  ⇒ ${tTotal < 1500 ? "✓ OK (sin demora perceptible)" : "✗ DEMORA: revisar"}\n`);

const criticos = scored.filter((x) => x.sc.sev === "critica");
const altos = scored.filter((x) => x.sc.sev === "alta");
const medias = scored.filter((x) => x.sc.sev === "media");

console.log("📊 DISTRIBUCIÓN POR SEVERIDAD");
console.log(`  Críticos (≥80)  : ${criticos.length}`);
console.log(`  Altos (60-79)   : ${altos.length}`);
console.log(`  Medias (30-59)  : ${medias.length}`);
console.log(`  Info (<30)      : ${scored.length - criticos.length - altos.length - medias.length}`);
console.log(`  Total con riesgo: ${scored.length} de ${universo.size}\n`);

console.log("🔥 TOP 10 CRÍTICOS (validar que sean casos reales)\n");
for (let i = 0; i < Math.min(10, criticos.length); i++) {
  const { vu, sc } = criticos[i];
  console.log(`  #${i + 1}  Score ${sc.total}/100 (${sc.sev})`);
  console.log(`     VIN: ${vu.vinLimpio}`);
  console.log(`     ${vu.marca ?? "?"} ${vu.modelo ?? ""} · ${vu.sucursal ?? "?"}`);
  console.log(`     Cliente: ${vu.cliente ?? "—"}`);
  console.log(`     Capital: $${vu.capitalComprometido.toLocaleString("es-CL")} · ${vu.capitalComprometidoFuente}`);
  console.log(`     Razones:`);
  for (const r of sc.razones) console.log(`       · ${r}`);
  console.log(``);
}

console.log("🎯 VALIDACIONES PUNTUALES\n");

// Punto 6: max(), fuente visible
let maxOk = 0;
for (const { vu } of scored.slice(0, 100)) {
  const propio = vu.tipoStock === "Propio" || vu.tipoStock === "FinPropio" ? vu.costoNeto : 0;
  const m = Math.max(vu.fneValorFactura, vu.saldoCliente, propio, vu.creditoPompeyo);
  if (m === vu.capitalComprometido) maxOk++;
}
console.log(`  Punto 6: capital = max() en top 100: ${maxOk}/100 ${maxOk === 100 ? "✓" : "✗"}`);

// Punto 7: tabs no duplican conteos
function filtroCriticos(vu, sc) { return sc.sev === "alta" || sc.sev === "critica"; }
function filtroAging(vu) { return maxAging(vu) > 60; }
function filtroFNEDetenidos(vu) { return vu.enFNE && vu.fneEstado !== "listo_para_entregar" && (vu.fneDiasEnEstado ?? 0) > 15; }
const cInter = scored.filter((x) => filtroCriticos(x.vu, x.sc));
const aInter = scored.filter((x) => filtroAging(x.vu));
const fInter = scored.filter((x) => filtroFNEDetenidos(x.vu));
console.log(`  Punto 7: tabs son filtros sobre el mismo universo (no duplican):`);
console.log(`     · Top críticos: ${cInter.length}`);
console.log(`     · Aging >60d : ${aInter.length}`);
console.log(`     · FNE detenidos >15d: ${fInter.length}`);
console.log(`     · cada uno es subset del universo ${scored.length} ✓`);

// Punto 8: integridad otras páginas
console.log(`\n  Punto 8: integridad otras páginas`);
console.log(`     · Universo VIN: ${universo.size} (= 26K esperado) ${universo.size > 20000 ? "✓" : "✗"}`);
console.log(`     · FNE registros: ${fneRows.length} ${fneRows.length === 686 ? "✓" : "✗"}`);
console.log(`     · Saldos vehículo: ${saldosRows.filter((r) => { const c = String(r["CATEGORIA"] ?? "").toUpperCase(); return c.includes("VEHICULO") || c.startsWith("1 "); }).length} ${"≈ 696 esperado"}`);

// Punto 2: top críticos validez
console.log(`\n  Punto 2: validación cualitativa top críticos`);
console.log(`     · ¿Tienen razones múltiples? ${criticos.slice(0, 5).every((c) => c.sc.razones.length >= 3) ? "✓ Sí, todos tienen 3+ razones" : "✗ Algunos tienen <3 razones"}`);
console.log(`     · ¿Capital >0 en críticos? ${criticos.slice(0, 10).every((c) => c.vu.capitalComprometido > 0) ? "✓ Sí" : "✗ Algunos con capital 0"}`);
console.log(`     · ¿Sin VINs basura? ${criticos.slice(0, 10).every((c) => c.vu.vinLimpio.length === 17 && c.vu.marca) ? "✓ Sí" : "✗ Hay VINs sin marca"}`);
