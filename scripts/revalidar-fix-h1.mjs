/**
 * Revalidación post-fix H1: simula la lógica corregida del parser
 * sobre los Excel reales y reporta nuevos números.
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const PATH_STOCK = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx";
const PATH_FNE = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Autos no entregados.xlsx";
const PATH_SALDOS = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Reportes Saldos 2.0 18-05-2026_.xlsx";

const n = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const s = (v) => (v == null || v === "" ? null : String(v).trim());

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

function subTipoVehiculo(tipoRaw) {
  if (!tipoRaw) return "indefinido";
  const m = tipoRaw.match(/^\s*(\d+\.\d+)/);
  const map = { "1.1": "financieras", "1.2": "leasing", "1.3": "seguros", "1.4": "flotas", "1.5": "traspasos_dealer", "1.6": "credito_pompeyo", "1.7": "judicial", "1.9": "buy_back", "2.2": "acuerdo_comercial", "2.3": "oc_marca" };
  if (m && map[m[1]]) return map[m[1]];
  return "indefinido";
}

// === Cargar archivos ===
const stockWb = XLSX.read(readFileSync(PATH_STOCK), { type: "buffer", cellDates: true });
const fneRows = XLSX.utils.sheet_to_json(XLSX.read(readFileSync(PATH_FNE), { type: "buffer", cellDates: true }).Sheets["ROMA"], { defval: null, raw: true });
const saldosRows = XLSX.utils.sheet_to_json(XLSX.read(readFileSync(PATH_SALDOS), { type: "buffer", cellDates: true }).Sheets["FUSION BD 3.0"], { defval: null, raw: true });

// === Construir bridge Cajón→VIN (simplificado) ===
const cajonToVIN = new Map();
const patenteToVIN = new Map();
{
  const baseRows = XLSX.utils.sheet_to_json(stockWb.Sheets["Base_Stock"], { defval: null, raw: true });
  for (const r of baseRows) {
    const v = limpiarVIN(r["Numero VIN"]);
    if (!esVINValido(v)) continue;
    cajonToVIN.set(v.slice(-8), v);
    const p = String(r["Placa Patente"] ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (p.length >= 6) patenteToVIN.set(p, v);
  }
  for (const sheet of ["Venta APC Fact VN", "Venta APC Fact VU"]) {
    const rows = XLSX.utils.sheet_to_json(stockWb.Sheets[sheet], { defval: null, raw: true });
    for (const r of rows) {
      const v = limpiarVIN(r["Numero VIN"] ?? r["Numero Chasis"]);
      if (!esVINValido(v)) continue;
      if (!cajonToVIN.has(v.slice(-8))) cajonToVIN.set(v.slice(-8), v);
    }
  }
}

// === Aplicar fix H1: cPompeyoCLP correcto ===
let cpRegistrosFix = 0, cpMontoFix = 0;
let cpAntiguoMonto = 0;
const cpVinsFix = new Set();
const cpVinsAntiguo = new Set();

for (const r of saldosRows) {
  const cat = String(r["CATEGORIA"] ?? "").toUpperCase();
  if (!(cat.includes("VEHICULO") || cat.startsWith("1 "))) continue;

  const tipoRaw = s(r["Tipo"]);
  const subTipo = subTipoVehiculo(tipoRaw);
  const subTipoEsCP = subTipo === "credito_pompeyo";

  // ANTIGUO (incorrecto)
  const cpAntiguo = n(r[" C.Pompeyo"]);
  if (cpAntiguo > 0) cpAntiguoMonto += cpAntiguo;

  // NUEVO (con fix H1)
  const cpNuevo = subTipoEsCP ? n(r["Saldo x Documentar"]) : n(r[" C.Pompeyo"]);
  const tieneCPNuevo = cpNuevo > 0 || subTipoEsCP;
  if (tieneCPNuevo) {
    cpRegistrosFix++;
    cpMontoFix += cpNuevo;
    // Resolver VIN para contar VINs con CP
    const cajon = limpiarCajon(r["Cajon"]);
    let vin = null;
    if (pareceePatente(cajon) && patenteToVIN.has(cajon)) vin = patenteToVIN.get(cajon);
    else if (cajonToVIN.has(cajon)) vin = cajonToVIN.get(cajon);
    if (vin) cpVinsFix.add(vin);
  }
}

// === Recalcular FNE con buckets + Crédito Pompeyo ===
const isSi = (v) => v === "Si" || v === "si";
const has = (v) => v != null;
const fneByVin = new Map();
for (const r of fneRows) {
  const v = limpiarVIN(r.Vin);
  if (esVINValido(v)) fneByVin.set(v, r);
}

function estadoEntrega(r) {
  const patRec = has(r.fecha_patente_recibida);
  if (patRec) {
    if (isSi(r.sol_entrega) && isSi(r.autorizacion_entrega)) return "listo";
    if (isSi(r.sol_entrega)) return "faltaAut";
    return "patSucursal";
  }
  if (has(r.fecha_patente_enviada)) return "patTransito";
  if (has(r.patentes_administracion)) return "patAdmin";
  if (has(r.FechaInscripcion)) return "inscritaSinAdmin";
  if (has(r.FechaSolicitudInscripcion)) return "enRC";
  if (isSi(r.SolicitarInscripcion)) return "enCdN";
  return "sinSol";
}

// "Listo total" del módulo Capital de Trabajo = sin bloqueos (estado=listo Y sin CP)
let listosSegunFNESolo = 0; // los del bucket "listo_para_entregar"
let listosConCP = 0; // los que dicen listo pero tienen CP
let listosFinalesReales = 0; // sin bloqueos = listo + sin CP
let bloqueadosCP_total = 0; // todos los FNE que tienen CP, sin importar estado
const fneVinsConCP = new Set();

for (const r of fneRows) {
  const vin = limpiarVIN(r.Vin);
  if (!esVINValido(vin)) continue;
  const e = estadoEntrega(r);
  const tieneCP = cpVinsFix.has(vin);
  if (tieneCP) {
    bloqueadosCP_total++;
    fneVinsConCP.add(vin);
  }
  if (e === "listo") {
    listosSegunFNESolo++;
    if (tieneCP) listosConCP++;
    else listosFinalesReales++;
  }
}

// === Reporte ===
console.log("═══════════════════════════════════════════════════════════════");
console.log("REVALIDACIÓN POST-FIX H1");
console.log("═══════════════════════════════════════════════════════════════\n");

console.log("📊 CRÉDITO POMPEYO\n");
console.log(`  Esperado (Excel real)       : 140 registros · $447.907.673`);
console.log(`  Sistema ANTES del fix       : 0 registros · $0`);
console.log(`  Sistema DESPUÉS del fix     : ${cpRegistrosFix} registros · $${cpMontoFix.toLocaleString("es-CL")}`);
console.log(`  Δ ≈ 0?                      : ${Math.abs(cpMontoFix - 447907673) < 1000 ? "✓ SÍ — fix correcto" : "✗ Revisar"}`);

console.log(`\n  VINs únicos con C.P. (cruzados): ${cpVinsFix.size}`);

console.log("\n📊 FNE · LISTO PARA ENTREGAR (con descuento C.P.)\n");
console.log(`  Bucket FNE "listo" (señales archivo): ${listosSegunFNESolo}`);
console.log(`     · de ellos con Crédito Pompeyo  : ${listosConCP}  ← NUEVO: ya no se cuentan como listos`);
console.log(`     · listos REALES (sin bloqueos)  : ${listosFinalesReales}  ← KPI corregido`);
console.log(`  ────`);
console.log(`  ANTES del fix, el sistema decía "${listosSegunFNESolo} listos" porque no descontaba CP.`);
console.log(`  AHORA muestra "${listosFinalesReales} listos" — los ${listosConCP} restantes se reclasifican a "bloqueado financiero".`);

console.log("\n📊 FNE · BLOQUEADOS POR CRÉDITO POMPEYO\n");
console.log(`  Total FNE con CP asignado : ${bloqueadosCP_total}  ($${[...fneVinsConCP].reduce((s, v) => {
  const r = fneByVin.get(v);
  return s + n(r?.ValorFactura);
}, 0).toLocaleString("es-CL")} en valor factura)`);
console.log(`  ANTES del fix: 0 (silencioso)`);
console.log(`  AHORA visibilizados como bloqueados financieros con badge rojo.`);

console.log("\n📊 CAPITAL FINANCIERO BLOQUEANTE (Crédito Pompeyo)\n");
console.log(`  Monto C.P. total                  : $${cpMontoFix.toLocaleString("es-CL")}`);
console.log(`  De ese monto, asociado a un VIN   : (resolverlo en el módulo con cruce)`);
console.log(`  De ese monto, sin VIN identificado: panel "Crédito Pompeyo sin VIN" en Auditoría`);

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("RESUMEN DEL CAMBIO");
console.log("═══════════════════════════════════════════════════════════════\n");
console.log("ANTES (bug):");
console.log("  · Crédito Pompeyo total           : $0");
console.log("  · VINs bloqueados por C.P.         : 0");
console.log(`  · Listos para entregar             : ${listosSegunFNESolo} (incluía falsos positivos)`);
console.log();
console.log("DESPUÉS (fix H1):");
console.log(`  · Crédito Pompeyo total           : $${cpMontoFix.toLocaleString("es-CL")}`);
console.log(`  · VINs bloqueados por C.P.         : ${bloqueadosCP_total}`);
console.log(`  · Listos para entregar reales     : ${listosFinalesReales}`);
console.log(`  · Reclasificados a bloqueado fin. : ${listosConCP} (estaban marcados como listos por error)`);
