#!/usr/bin/env node
/**
 * DIAGNÓSTICO — CONFLICTO_FFACTURA (auditoría semántica)
 *
 * Mismo análisis que `diagnostico-conflicto-finscripcion.mjs` pero sobre
 * `fFactura`. Objetivo: decidir si CONFLICTO_FFACTURA también necesita relajación
 * de umbral, o si los 26 casos detectados son todos divergencias reales.
 *
 * No toca código productivo.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const PROJECT_ROOT = "/Users/Daviid/velocidad";
const OUT = "/tmp/historico-tests";
const SRC_DIR = `${PROJECT_ROOT}/src/lib/historico`;
const BASE = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive";

const ROMA_FILES = [
  { mes: "2026-01", path: `${BASE}/LOG Enero.xlsx` },
  { mes: "2026-02", path: `${BASE}/Log Febrero.xlsx` },
  { mes: "2026-03", path: `${BASE}/LOG Marzo.xlsx` },
  { mes: "2026-04", path: `${BASE}/Log Abril.xlsx` },
  { mes: "2026-05", path: `${BASE}/Log Roma 29-05-2026 .xlsx` },
];
const ACTAS_FILE = `${BASE}/Actas al 28 de Mayo.xlsx`;
const SCHIAPP_FILE = `${BASE}/SCHIAPPCASSE 28 de Mayo.xlsx`;
const KAR_FILE = `${BASE}/KAR-LOGISTICS 28 de Mayo.xlsx`;

function compilar() {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const tsconfig = {
    compilerOptions: {
      target: "es2022", module: "nodenext", moduleResolution: "nodenext",
      strict: true, esModuleInterop: true, skipLibCheck: true,
      outDir: OUT, rootDir: `${PROJECT_ROOT}/src`,
      declaration: false, sourceMap: false, allowImportingTsExtensions: false,
      types: ["node"], typeRoots: [`${PROJECT_ROOT}/node_modules/@types`],
    },
    include: [`${SRC_DIR}/**/*.ts`],
  };
  const cfgPath = "/tmp/historico-tests-tsconfig-diag-ffac.json";
  writeFileSync(cfgPath, JSON.stringify(tsconfig));
  console.log("Compilando TS → JS...");
  execSync(`npx tsc -p ${cfgPath}`, { stdio: "inherit", cwd: PROJECT_ROOT });
}

compilar();

process.env.NODE_PATH = `${PROJECT_ROOT}/node_modules`;
const { Module } = await import("node:module");
Module._initPaths();

const XLSX = (await import("xlsx")).default;
const { parseRomaMensualBuffer } = await import(`${OUT}/lib/historico/parser-roma-mensual.js`);
const { parseActasBuffer } = await import(`${OUT}/lib/historico/parser-actas.js`);
const { crearHistoricoVacio, aplicarCortes: aplicarCortesRoma } = await import(`${OUT}/lib/historico/consolidador.js`);
const { crearHistoricoActasVacio, aplicarCorteActas } = await import(`${OUT}/lib/historico/consolidador-actas.js`);
const { cruzarRomaActas } = await import(`${OUT}/lib/historico/cruce-roma-actas.js`);
const fs = await import("node:fs/promises");

// Helpers (idénticos al diag fInscripcion)
function toDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "number") { if (v === 0) return null; const d = new Date(Math.round((v - 25569) * 86400 * 1000)); return Number.isFinite(d.getTime()) ? d : null; }
  const s = String(v).trim();
  if (!s || s === "0" || s === "00-00-0000") return null;
  const low = s.toLowerCase();
  if (low === "sin salida" || low === "en proceso" || low === "por confirmar") return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}
function nz(v) { return v == null || v === "" || v === 0 || v === "0" ? null : v; }
function vinKey(v) { if (!v) return null; const s = String(v).trim().toUpperCase(); return s.length >= 11 ? s : null; }
function rowsOf(ws) { return XLSX.utils.sheet_to_json(ws, { defval: null, raw: true }); }
function esSinSalida(v) { return v != null && String(v).trim().toUpperCase() === "SIN SALIDA"; }
function cargarRomiaUno(file, bodega) {
  const wb = XLSX.readFile(file, { cellDates: true });
  const accs = new Map();
  const ensure = (vin) => { let a = accs.get(vin); if (!a) { a = { vin, bodega, fCompraMarca: null, fIngresoBodega: null, fSolicitudBodega: null, fPlanificacionFisica: null, fSalidaFisica: null, fLlegadaPatio: null, tieneSinSalida: false, estadoBodega: null, patio: null, puntoEntrega: null, cumplimientoDespacho: null }; accs.set(vin, a); } return a; };
  const hAlm = wb.SheetNames.find((n) => /^almacenamiento\s*$/i.test(n));
  const hDist = wb.SheetNames.find((n) => /^distribuci[oó]n\s*$/i.test(n));
  const hEnt = wb.SheetNames.find((n) => /^entradas\s*$/i.test(n));
  const hSal = wb.SheetNames.find((n) => /^salidas\s*$/i.test(n));
  if (hAlm) for (const r of rowsOf(wb.Sheets[hAlm])) { const vin = vinKey(r["VIN"]); if (!vin) continue; const a = ensure(vin); a.fIngresoBodega = a.fIngresoBodega ?? toDate(r["1° dia Almacenaje en bodega"]); a.estadoBodega = a.estadoBodega ?? nz(r["Disponible en bodega"]) ?? nz(r["Estado Kar"]) ?? nz(r["Estado Kar "]); }
  if (hDist) for (const r of rowsOf(wb.Sheets[hDist])) { const vin = vinKey(r["VIN"]); if (!vin) continue; const a = ensure(vin); a.fIngresoBodega = a.fIngresoBodega ?? toDate(r["1° dia Almacenaje en bodega"] ?? r["1° dia Almacenaje"]); a.fSolicitudBodega = a.fSolicitudBodega ?? toDate(r["Fecha de solicitud"] ?? r["Fecha  Solicitud"] ?? r["Fecha Solicitud"]); a.fPlanificacionFisica = a.fPlanificacionFisica ?? toDate(r["Fecha teorica STLI"]); const desp = r["Fecha despacho a sucursal"]; if (esSinSalida(desp)) a.tieneSinSalida = true; else a.fSalidaFisica = a.fSalidaFisica ?? toDate(desp); a.cumplimientoDespacho = a.cumplimientoDespacho ?? nz(r["Cumplimiento despacho"]) ?? nz(r["Cumplimiento fecha limite"]); }
  if (hEnt) for (const r of rowsOf(wb.Sheets[hEnt])) { const vin = vinKey(r["VIN"]); if (!vin) continue; const a = ensure(vin); a.fLlegadaPatio = a.fLlegadaPatio ?? toDate(r["Fecha Ent"] ?? r["Fecha Entrada"]); a.estadoBodega = a.estadoBodega ?? nz(r["Estado"]) ?? nz(r["Estado Gp Simplificado"]); a.patio = a.patio ?? nz(r["Patio"]) ?? nz(r["Zona"]); a.puntoEntrega = a.puntoEntrega ?? nz(r["Punto de Entrega"]) ?? nz(r["Destino"]); }
  if (hSal) for (const r of rowsOf(wb.Sheets[hSal])) { const vin = vinKey(r["VIN"]); if (!vin) continue; const a = ensure(vin); const fSal = toDate(r["Fecha Sal"] ?? r["Fecha Salida"]); if (fSal && (!a.fSalidaFisica || fSal > a.fSalidaFisica)) a.fSalidaFisica = fSal; }
  return accs;
}
function construirSnapshotRomia(schiapp, kar) {
  const porVin = new Map();
  const allVins = new Set([...schiapp.keys(), ...kar.keys()]);
  for (const vin of allVins) { const k = kar.get(vin); const s = schiapp.get(vin); if (k && s) { const merged = { ...k }; for (const key of Object.keys(s)) if (merged[key] == null && s[key] != null) merged[key] = s[key]; if (s.tieneSinSalida) merged.tieneSinSalida = true; merged.bodega = `${k.bodega}+${s.bodega}`; porVin.set(vin, merged); } else if (k) porVin.set(vin, k); else if (s) porVin.set(vin, s); }
  return { porVin, meta: { fechaCarga: new Date() } };
}

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════════");
console.log("  DIAGNÓSTICO — CONFLICTO_FFACTURA (auditoría semántica)");
console.log("══════════════════════════════════════════════════════════════════════════════════");
const t0 = Date.now();

// ── Pipeline
console.log("");
console.log("  Reconstruyendo pipeline ROMA + Actas + ROMIA...");
const cortesRoma = [];
for (const f of ROMA_FILES) {
  const buf = await fs.readFile(f.path);
  cortesRoma.push(parseRomaMensualBuffer(new Uint8Array(buf), path.basename(f.path), buf.byteLength));
}
const { historicoFinal: historicoRoma } = aplicarCortesRoma(crearHistoricoVacio(), cortesRoma);
const bufActas = await fs.readFile(ACTAS_FILE);
const corteActas = parseActasBuffer(new Uint8Array(bufActas), path.basename(ACTAS_FILE), bufActas.byteLength);
const historicoActas = aplicarCorteActas(crearHistoricoActasVacio(), corteActas).historico;
const schiapp = cargarRomiaUno(SCHIAPP_FILE, "SCHIAPP");
const kar = cargarRomiaUno(KAR_FILE, "KAR");
const romiaSnapshot = construirSnapshotRomia(schiapp, kar);
const cruce = cruzarRomaActas({ historicoRoma, historicoActas, romiaSnapshot });
console.log(`  Pipeline lista en ${Date.now() - t0} ms · ${cruce.filas.length} filas`);

// ── Análisis de CONFLICTO_FFACTURA
const MS_DIA = 86_400_000;
const conflictos = [];
for (const f of cruce.filas) {
  const c = f.conflictos.find((x) => x.kind === "CONFLICTO_FFACTURA");
  if (!c) continue;
  const r = f.ventaId !== null ? historicoRoma.entradas.get(f.ventaId) : null;
  const a = historicoActas.entradas.get(f.vin);
  const fR = r?.row.fFactura ?? null;
  const fA = a?.row.fFactura ?? null;
  if (!fR || !fA) continue;
  const deltaDias = (fA.getTime() - fR.getTime()) / MS_DIA;
  conflictos.push({ fila: f, fR, fA, deltaDias, absDelta: Math.abs(deltaDias) });
}

console.log("");
console.log(`  Total CONFLICTO_FFACTURA analizados: ${conflictos.length}`);

const bins = { iguales_0: 0, hasta_1d: 0, hasta_2d: 0, hasta_7d: 0, hasta_30d: 0, mas_30d: 0 };
let actasDespues = 0, actasAntes = 0;
const todasAbs = [];
for (const x of conflictos) {
  const a = x.absDelta; todasAbs.push(a);
  if (a === 0) bins.iguales_0++;
  else if (a <= 1) bins.hasta_1d++;
  else if (a <= 2) bins.hasta_2d++;
  else if (a <= 7) bins.hasta_7d++;
  else if (a <= 30) bins.hasta_30d++;
  else bins.mas_30d++;
  if (x.deltaDias > 0) actasDespues++; else if (x.deltaDias < 0) actasAntes++;
}
todasAbs.sort((a, b) => a - b);
const median = todasAbs.length === 0 ? null : todasAbs[Math.floor(todasAbs.length / 2)];
const p90 = todasAbs.length === 0 ? null : todasAbs[Math.floor(todasAbs.length * 0.9)];
const p99 = todasAbs.length === 0 ? null : todasAbs[Math.floor(todasAbs.length * 0.99)];

const T = conflictos.length;
const pct = (n) => T > 0 ? ((n / T) * 100).toFixed(2) : "0.00";
const bar = (n) => "█".repeat(Math.round((n / Math.max(T, 1)) * 40));

console.log("");
console.log("  Distribución del delta |fFactura_Actas − fFactura_ROMA|:");
console.log(`    = 0 día (mismo día exacto):    ${String(bins.iguales_0).padStart(5)}  (${pct(bins.iguales_0).padStart(5)}%)  ${bar(bins.iguales_0)}`);
console.log(`    ≤ 1 día:                       ${String(bins.hasta_1d).padStart(5)}  (${pct(bins.hasta_1d).padStart(5)}%)  ${bar(bins.hasta_1d)}`);
console.log(`    ≤ 2 días:                      ${String(bins.hasta_2d).padStart(5)}  (${pct(bins.hasta_2d).padStart(5)}%)  ${bar(bins.hasta_2d)}`);
console.log(`    ≤ 7 días:                      ${String(bins.hasta_7d).padStart(5)}  (${pct(bins.hasta_7d).padStart(5)}%)  ${bar(bins.hasta_7d)}`);
console.log(`    ≤ 30 días:                     ${String(bins.hasta_30d).padStart(5)}  (${pct(bins.hasta_30d).padStart(5)}%)  ${bar(bins.hasta_30d)}`);
console.log(`    > 30 días (divergencia real):  ${String(bins.mas_30d).padStart(5)}  (${pct(bins.mas_30d).padStart(5)}%)  ${bar(bins.mas_30d)}`);
console.log("");
console.log(`  Dirección del delta:`);
console.log(`    Actas después de ROMA:      ${actasDespues}  (${pct(actasDespues)}%)`);
console.log(`    Actas antes  de ROMA:       ${actasAntes}  (${pct(actasAntes)}%)`);
console.log("");
console.log(`  Estadísticos del delta absoluto: mediana=${median}  p90=${p90}  p99=${p99}  max=${todasAbs[todasAbs.length - 1] ?? "—"}`);

// Cruzamiento con otros conflictos materiales
let soloFFac = 0, otrosTambien = 0;
for (const x of conflictos) {
  const otros = x.fila.conflictos.filter((c) => c.kind !== "CONFLICTO_FFACTURA" && c.esMaterial).length;
  if (otros === 0) soloFFac++; else otrosTambien++;
}
console.log("");
console.log(`  Filas con CONFLICTO_FFACTURA como ÚNICO conflicto material: ${soloFFac}  (${T > 0 ? ((soloFFac/T)*100).toFixed(2) : 0}%)`);
console.log(`  Filas con OTRO conflicto material además de fFactura:        ${otrosTambien}  (${T > 0 ? ((otrosTambien/T)*100).toFixed(2) : 0}%)`);

// Mostrar TODOS los ejemplos (solo 26 → caben todos)
console.log("");
console.log("  Todos los casos (ordenados por |delta| asc):");
console.log(`    ${"VentaID".padStart(8)} ${"VIN".padEnd(18)} ${"sucursal".padEnd(28)} ${"ROMA".padEnd(11)} ${"Actas".padEnd(11)} ${"delta".padStart(7)} ${"ent".padStart(4)}`);
for (const x of [...conflictos].sort((a, b) => a.absDelta - b.absDelta)) {
  const f = x.fila;
  const fmt = (d) => d.toISOString().slice(0, 10);
  console.log(
    `    ${String(f.ventaId ?? "—").padStart(8)} ${(f.vin ?? "").padEnd(18)} ${(f.sucursal ?? "(s/s)").padEnd(28).slice(0, 28)} ${fmt(x.fR).padEnd(11)} ${fmt(x.fA).padEnd(11)} ${String(x.deltaDias).padStart(7)} ${(f.entregado ? "Si" : "No").padStart(4)}`,
  );
}

// Recálculo (replicando lógica del cruce)
function recalc(esExcluibleFFac) {
  const out = { correcto: 0, huerfano: 0, inconsistente: 0, no_evaluable: 0 };
  for (const f of cruce.filas) {
    if (!f.entregado) { out.no_evaluable++; continue; }
    const cm = f.conflictos.filter((c) => {
      if (!c.esMaterial) return false;
      if (c.kind === "CONFLICTO_FFACTURA" && esExcluibleFFac(f)) return false;
      return true;
    }).length;
    const aut = (f.autorizacionEntrega ?? "").trim();
    const sol = (f.solEntrega ?? "").trim();
    let esHuerfano = false;
    if (!f.fInscripcion) esHuerfano = true;
    else if (!f.fEntregaReal && aut !== "Si" && sol !== "Si") esHuerfano = true;
    if (cm > 0) { out.inconsistente++; continue; }
    if (esHuerfano) { out.huerfano++; continue; }
    if (f.nivelDocumental === "completo" && f.fEntregaReal) { out.correcto++; continue; }
    out.inconsistente++;
  }
  return out;
}
const deltaPorVin = new Map();
for (const x of conflictos) deltaPorVin.set(x.fila.vin, Math.abs(x.deltaDias));

const H = {
  H0_actual:       recalc(() => false),
  H1_le_1dia:      recalc((f) => (deltaPorVin.get(f.vin) ?? Infinity) <= 1),
  H3_le_7dias:     recalc((f) => (deltaPorVin.get(f.vin) ?? Infinity) <= 7),
  H_le_30dias:     recalc((f) => (deltaPorVin.get(f.vin) ?? Infinity) <= 30),
  H4_excluir_todo: recalc(() => true),
};

console.log("");
console.log("  Recálculo del ejeCalidadCierre bajo hipótesis (solo fFactura, fInscripcion intacto):");
console.log("");
console.log(`    ${"Hipótesis".padEnd(22)} ${"correcto".padStart(10)} ${"huerfano".padStart(10)} ${"inconsistente".padStart(14)} ${"no_evaluable".padStart(12)}`);
for (const [k, v] of Object.entries(H)) {
  console.log(`    ${k.padEnd(22)} ${String(v.correcto).padStart(10)} ${String(v.huerfano).padStart(10)} ${String(v.inconsistente).padStart(14)} ${String(v.no_evaluable).padStart(12)}`);
}

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════════");
console.log(`  Tiempo total: ${Date.now() - t0} ms`);
console.log("══════════════════════════════════════════════════════════════════════════════════");
console.log("");
console.log("  Lectura:");
console.log(`  · Universo total: 26 casos (vs 3.422 de fInscripcion — orden de magnitud menor).`);
console.log(`  · Mediana del delta: ${median ?? "—"}d.`);
console.log(`  · % dentro de 7 días: ${T > 0 ? (((bins.iguales_0 + bins.hasta_1d + bins.hasta_2d + bins.hasta_7d) / T) * 100).toFixed(1) : 0}%`);
console.log(`  · % > 30 días: ${pct(bins.mas_30d)}%`);
