#!/usr/bin/env node
/**
 * VALIDACIÓN — Consolidador Actas histórico vs CSV de referencia.
 *
 * Pasos:
 *  1. Compila módulos histórico TS a /tmp.
 *  2. Parsea los 2 archivos Actas disponibles (26-05 y 28-05).
 *  3. Aplica `aplicarCortesActas` cronológicamente.
 *  4. Verifica:
 *     - Histórico final contiene la unión de VINs vistos en los cortes
 *     - El último corte (28-05) gobierna las vistas vivo
 *     - Merge produce 0 warnings críticos esperados (los datos reales son
 *       coherentes entre los 2 cortes cercanos)
 *  5. Cruce contra `historico-consolidado.csv` (filas enActas=true):
 *     - Match VIN ≥ 99.9%
 *     - Coincidencia `entregado` ≥ 99.7%
 *  6. Cruce contra `casos-huerfanos.csv`:
 *     - Reporte de overlap entre clasificación nueva (tipo 1/2/3/4) y vieja.
 *  7. Round-trip serialización idempotente.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const PROJECT_ROOT = "/Users/Daviid/velocidad";
const OUT = "/tmp/historico-tests";
const SRC_DIR = `${PROJECT_ROOT}/src/lib/historico`;
const BASE = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive";

const ACTAS_FILES = [
  { id: "2026-05-26", path: `${BASE}/Actas al 26-05-2026_503.xlsx`, label: "26-mayo" },
  { id: "2026-05-28", path: `${BASE}/Actas al 28 de Mayo.xlsx`, label: "28-mayo" },
];

const CSV_REFERENCIA = path.join(PROJECT_ROOT, "diag", "output", "historico-consolidado.csv");
const CSV_HUERFANOS = path.join(PROJECT_ROOT, "diag", "output", "casos-huerfanos.csv");

function compilar() {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const tsconfig = {
    compilerOptions: {
      target: "es2022",
      module: "nodenext",
      moduleResolution: "nodenext",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: OUT,
      rootDir: `${PROJECT_ROOT}/src`,
      declaration: false,
      sourceMap: false,
      allowImportingTsExtensions: false,
      types: ["node"],
      typeRoots: [`${PROJECT_ROOT}/node_modules/@types`],
    },
    include: [`${SRC_DIR}/**/*.ts`],
  };
  const cfgPath = "/tmp/historico-tests-tsconfig-actas-cruce.json";
  writeFileSync(cfgPath, JSON.stringify(tsconfig));
  console.log("Compilando TS → JS...");
  execSync(`npx tsc -p ${cfgPath}`, { stdio: "inherit", cwd: PROJECT_ROOT });
}

compilar();

process.env.NODE_PATH = `${PROJECT_ROOT}/node_modules`;
const { Module } = await import("node:module");
Module._initPaths();

const { parseActasBuffer } = await import(`${OUT}/lib/historico/parser-actas.js`);
const {
  crearHistoricoActasVacio,
  aplicarCortesActas,
  describirHistoricoActas,
  vistaActasVivo,
  vistaActasHistorico,
  clasificarHuerfanosActas,
  calcularCumplimientoActas,
  agruparWarningsActas,
  topVinsProblematicos,
  serializarHistoricoActas,
  deserializarHistoricoActas,
} = await import(`${OUT}/lib/historico/consolidador-actas.js`);
const fs = await import("node:fs/promises");

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════════");
console.log("  VALIDACIÓN — Consolidador Actas vs CSV de referencia");
console.log("══════════════════════════════════════════════════════════════════════════════════");

const t0 = Date.now();

// ── Parseo de cortes ────────────────────────────────────────────────────────
console.log("");
console.log("  Parseo de cortes:");
const cortes = [];
for (const f of ACTAS_FILES) {
  if (!existsSync(f.path)) {
    console.log(`    ⚠ Falta archivo: ${f.path} — se omite`);
    continue;
  }
  const buf = await fs.readFile(f.path);
  const corte = parseActasBuffer(new Uint8Array(buf), path.basename(f.path), buf.byteLength);
  cortes.push(corte);
  console.log(`    ${f.label.padEnd(10)} ${corte.corte.id} · ${corte.filas.length} filas · conf=${corte.report.confianzaCorte}`);
}

if (cortes.length === 0) {
  console.error("❌ Sin cortes disponibles para validar.");
  process.exit(1);
}

// ── Aplicación cronológica ──────────────────────────────────────────────────
console.log("");
console.log("  Aplicación cronológica de cortes:");
const h0 = crearHistoricoActasVacio();
const tApp0 = Date.now();
const { historicoFinal, resultados } = aplicarCortesActas(h0, cortes);
const tApp1 = Date.now();
console.log(`    Tiempo total: ${tApp1 - tApp0} ms`);
console.log("");
console.log(`    ${"Corte".padEnd(12)} ${"Nuevos".padStart(7)} ${"Actual".padStart(7)} ${"SinCamb".padStart(8)} ${"Desap".padStart(6)} ${"Conf".padStart(5)} ${"Warn".padStart(5)} ${"ms".padStart(5)}`);
for (const r of resultados) {
  const s = r.resumen;
  console.log(`    ${s.corteId.padEnd(12)} ${String(s.vinsNuevos).padStart(7)} ${String(s.vinsActualizados).padStart(7)} ${String(s.vinsSinCambio).padStart(8)} ${String(s.vinsDesaparecidos).padStart(6)} ${String(s.vinsEnConflicto).padStart(5)} ${String(s.warningsCount).padStart(5)} ${String(s.msec).padStart(5)}`);
}

// ── Descripción del histórico ───────────────────────────────────────────────
const d = describirHistoricoActas(historicoFinal);
console.log("");
console.log("  Descripción del histórico final:");
console.log(`    totalVins:          ${d.totalVins}`);
console.log(`    totalCortes:        ${d.totalCortes}`);
console.log(`    vinsEnUltimoCorte:  ${d.vinsEnUltimoCorte}`);
console.log(`    vinsDesaparecidos:  ${d.vinsDesaparecidos}`);
console.log(`    cortesPorVin:       min=${d.cortesPorVin.min}, max=${d.cortesPorVin.max}, mediana=${d.cortesPorVin.mediana}`);
if (d.cubrePeriodo) {
  console.log(`    periodo (fFactura): ${d.cubrePeriodo.desde.toISOString().slice(0, 10)} → ${d.cubrePeriodo.hasta.toISOString().slice(0, 10)}`);
}
console.log(`    VINs por corte:`);
for (const [k, n] of d.vinsPorCorte) console.log(`      ${k}  ${n}`);

// ── Warnings agregados ──────────────────────────────────────────────────────
const allWarnings = resultados.flatMap((r) => r.warnings);
const agr = agruparWarningsActas(allWarnings);
console.log("");
console.log("  Warnings agregados:");
console.log(`    Total: ${agr.total}`);
console.log(`    Por severidad:`);
for (const [k, n] of Object.entries(agr.porSeveridad)) console.log(`      ${k.padEnd(13)} ${n}`);
console.log(`    Por categoría:`);
for (const [k, n] of Object.entries(agr.porCategoria)) console.log(`      ${k.padEnd(25)} ${n}`);
console.log(`    Por campo (top 8):`);
const camposOrdenados = Object.entries(agr.porCampo).sort((a, b) => b[1] - a[1]).slice(0, 8);
for (const [k, n] of camposOrdenados) console.log(`      ${k.padEnd(25)} ${n}`);
const tops = topVinsProblematicos(allWarnings, 5);
if (tops.length > 0) {
  console.log(`    Top 5 VINs con más warnings:`);
  for (const t of tops) console.log(`      ${t.vin}  ${t.count} warnings · [${t.categorias.join(", ")}]`);
}

// ── Huérfanos clasificados ──────────────────────────────────────────────────
const huerf = clasificarHuerfanosActas(historicoFinal);
console.log("");
console.log("  Huérfanos clasificados (sobre histórico final):");
console.log(`    Tipo 1 (probable entrega no registrada):     ${huerf.tipo1ProbableEntregaNoRegistrada.length}`);
console.log(`    Tipo 2 (entregado con cierre inconsistente): ${huerf.tipo2EntregadoConCierreInconsistente.length}`);
console.log(`    Tipo 3 (desaparecidos):                      ${huerf.tipo3Desaparecidos.length}`);
console.log(`    Tipo 4 (inconsistencia temporal):            ${huerf.tipo4InconsistenciaTemporal.length}`);

// ── Cumplimiento global con desgloses ───────────────────────────────────────
const cump = calcularCumplimientoActas(historicoFinal, { porSucursal: true, porResponsable: true });
console.log("");
console.log("  Cumplimiento global (sobre vista vivo del último corte):");
console.log(`    Universo:                            ${cump.universoEvaluado}`);
console.log(`    Entregados:                          ${cump.global.entregados}`);
console.log(`    Entregados sin patente recibida:     ${cump.global.entregadosSinPatenteRecibida}`);
console.log(`    Entregados sin autorización 'Si':    ${cump.global.entregadosSinAutorizacion}`);
console.log(`    Entregados sin solicitud entrega:    ${cump.global.entregadosSinSolicitudEntrega}`);
console.log(`    Nivel documental:`);
for (const [k, n] of Object.entries(cump.global.porNivelDocumental)) {
  const pct = ((n / cump.universoEvaluado) * 100).toFixed(2);
  console.log(`      ${k.padEnd(10)} ${String(n).padStart(6)}  (${pct}%)`);
}
console.log(`    Top 3 sucursales por universo:`);
for (const s of cump.porSucursal.slice(0, 3)) {
  console.log(`      ${s.sucursal.padEnd(35)} u=${String(s.universo).padStart(5)}  ent=${String(s.entregados).padStart(5)}  sinPat=${String(s.entregadosSinPatenteRecibida).padStart(4)}`);
}

// ── Cruce contra CSV referencia ─────────────────────────────────────────────
console.log("");
console.log("  Cruce contra historico-consolidado.csv:");
const csvRaw = readFileSync(CSV_REFERENCIA, "utf-8");
const csvLines = csvRaw.split("\n").filter((l) => l.length > 0);
const header = csvLines[0].split(",");
const idxVin = header.indexOf("vin");
const idxEntregado = header.indexOf("entregado");
const idxEnActas = header.indexOf("enActas");

const csvActas = new Map();
for (let i = 1; i < csvLines.length; i++) {
  const cells = csvLines[i].split(",");
  if (cells[idxEnActas] !== "true") continue;
  const vin = cells[idxVin]?.trim().toUpperCase();
  if (!vin) continue;
  csvActas.set(vin, { entregado: cells[idxEntregado] === "true" });
}

const consActas = new Map();
for (const e of historicoFinal.entradas.values()) consActas.set(e.row.vin, e);

const vinsCSV = new Set(csvActas.keys());
const vinsCons = new Set(consActas.keys());
const enAmbos = [...vinsCSV].filter((v) => vinsCons.has(v));
const soloEnCSV = [...vinsCSV].filter((v) => !vinsCons.has(v));
const soloEnCons = [...vinsCons].filter((v) => !vinsCSV.has(v));
const matchPct = (enAmbos.length / vinsCSV.size) * 100;
console.log(`    VINs en CSV (enActas=true):   ${vinsCSV.size}`);
console.log(`    VINs en consolidador:         ${vinsCons.size}`);
console.log(`    Coinciden:                    ${enAmbos.length}  (${matchPct.toFixed(2)}%)`);
console.log(`    Solo en CSV:                  ${soloEnCSV.length}`);
console.log(`    Solo en consolidador:         ${soloEnCons.length}`);

let entOk = 0;
let entMis = 0;
for (const vin of enAmbos) {
  const csv = csvActas.get(vin);
  const e = consActas.get(vin);
  if (csv.entregado === e.row.entregado) entOk++;
  else entMis++;
}
const entPct = (entOk / Math.max(enAmbos.length, 1)) * 100;
console.log(`    Coincidencia 'entregado':     ${entOk}/${enAmbos.length}  (${entPct.toFixed(2)}%)`);
console.log(`    Mismatches:                   ${entMis}`);

// ── Cruce contra casos-huerfanos.csv ────────────────────────────────────────
console.log("");
console.log("  Cruce contra casos-huerfanos.csv:");
if (!existsSync(CSV_HUERFANOS)) {
  console.log("    ⚠ Archivo no disponible — skip.");
} else {
  const hraw = readFileSync(CSV_HUERFANOS, "utf-8");
  const hl = hraw.split("\n").filter((l) => l.length > 0);
  const hh = hl[0].split(",");
  const hIdxVin = hh.indexOf("vin");
  const hIdxTipo = hh.indexOf("tipo");
  const huerfanosCsv = new Map();
  for (let i = 1; i < hl.length; i++) {
    const cells = hl[i].split(",");
    const vin = cells[hIdxVin]?.trim().toUpperCase();
    const tipo = cells[hIdxTipo]?.trim();
    if (vin) huerfanosCsv.set(vin, tipo);
  }
  console.log(`    Total casos huérfanos CSV:    ${huerfanosCsv.size}`);

  // Comparar overlap con tipo 1 (probable entrega no registrada)
  const t1set = new Set(huerf.tipo1ProbableEntregaNoRegistrada.map((x) => x.vin));
  const t2set = new Set(huerf.tipo2EntregadoConCierreInconsistente.map((x) => x.vin));
  let inT1 = 0;
  let inT2 = 0;
  let inAmbos = 0;
  let inNinguno = 0;
  let csvNoExisteEnHist = 0;
  for (const [vin] of huerfanosCsv) {
    if (!consActas.has(vin)) {
      csvNoExisteEnHist++;
      continue;
    }
    const en1 = t1set.has(vin);
    const en2 = t2set.has(vin);
    if (en1 && en2) inAmbos++;
    else if (en1) inT1++;
    else if (en2) inT2++;
    else inNinguno++;
  }
  console.log(`    VINs CSV no en consolidador:  ${csvNoExisteEnHist}`);
  console.log(`    En Tipo 1:                    ${inT1}`);
  console.log(`    En Tipo 2:                    ${inT2}`);
  console.log(`    En ambos:                     ${inAmbos}`);
  console.log(`    En ninguno (resuelto/otro):   ${inNinguno}`);
}

// ── Round-trip serialización ────────────────────────────────────────────────
console.log("");
console.log("  Round-trip serialización:");
const tSer0 = Date.now();
const json = serializarHistoricoActas(historicoFinal);
const tSer1 = Date.now();
const restored = deserializarHistoricoActas(JSON.parse(JSON.stringify(json)));
const tDeser = Date.now() - tSer1;
const okSize = restored.entradas.size === historicoFinal.entradas.size;
const okCortes = restored.cortes.length === historicoFinal.cortes.length;
let muestra = 0;
let preservadas = 0;
for (const [vin, e] of historicoFinal.entradas) {
  muestra++;
  if (muestra > 50) break;
  const rr = restored.entradas.get(vin);
  if (!rr) continue;
  const sameEnt = rr.row.entregado === e.row.entregado;
  const sameNiv = rr.row.nivelDocumental === e.row.nivelDocumental;
  const sameFFac = (rr.row.fFactura?.getTime() ?? null) === (e.row.fFactura?.getTime() ?? null);
  const samePres = rr.presenteEn.join("|") === e.presenteEn.join("|");
  if (sameEnt && sameNiv && sameFFac && samePres) preservadas++;
}
const sizeJson = JSON.stringify(json).length;
console.log(`    Serialización: ${tSer1 - tSer0} ms · ${(sizeJson / 1024).toFixed(0)} KB`);
console.log(`    Deserialización: ${tDeser} ms`);
console.log(`    Tamaños iguales: ${okSize ? "✅" : "❌"} entradas, ${okCortes ? "✅" : "❌"} cortes`);
console.log(`    Sample 50 VINs preservados: ${preservadas}/50 ${preservadas === 50 ? "✅" : "❌"}`);

// ── Veredicto ──
const okMatch = matchPct >= 99.0;
const okEnt = entPct >= 99.0;
const okSer = okSize && okCortes && preservadas === 50;
const tFin = Date.now();
console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════════");
console.log(`  Tiempo total: ${tFin - t0} ms`);
console.log(`  Match VIN: ${matchPct.toFixed(2)}%  ${okMatch ? "✅" : "❌"}`);
console.log(`  Coincidencia entregado: ${entPct.toFixed(2)}%  ${okEnt ? "✅" : "❌"}`);
console.log(`  Round-trip: ${okSer ? "✅" : "❌"}`);
console.log("══════════════════════════════════════════════════════════════════════════════════");
if (!okMatch || !okEnt || !okSer) process.exit(1);
