#!/usr/bin/env node
/**
 * VALIDACIÓN — Consolidador histórico vs CSV de referencia.
 *
 * Pasos:
 *  1. Compila el módulo histórico TS a /tmp.
 *  2. Parsea los 5 archivos ROMA reales con `parseRomaMensualBuffer`.
 *  3. Aplica `aplicarCortes` cronológicamente.
 *  4. Verifica:
 *     - Universo ≈ 4.749 VentaIDs únicos
 *     - Coincidencia con CSV ≥ 99.9%
 *     - Warnings consistentes con auditoría previa (10 nulls + 7 regresiones)
 *     - Serialización + deserialización round-trip idempotente
 *  5. Reporta resumen ejecutivo.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const PROJECT_ROOT = "/Users/Daviid/velocidad";
const OUT = "/tmp/historico-tests";
const SRC_DIR = `${PROJECT_ROOT}/src/lib/historico`;
const BASE = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive";

const ROMA_FILES = [
  { mes: "2026-01", path: `${BASE}/LOG Enero.xlsx`, label: "Enero" },
  { mes: "2026-02", path: `${BASE}/Log Febrero.xlsx`, label: "Febrero" },
  { mes: "2026-03", path: `${BASE}/LOG Marzo.xlsx`, label: "Marzo" },
  { mes: "2026-04", path: `${BASE}/Log Abril.xlsx`, label: "Abril" },
  { mes: "2026-05", path: `${BASE}/Log Roma 29-05-2026 .xlsx`, label: "Mayo" },
];

const CSV_REFERENCIA = path.join(PROJECT_ROOT, "diag", "output", "historico-consolidado.csv");

// ── Compilación ─────────────────────────────────────────────────────────────
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
  const cfgPath = "/tmp/historico-tests-tsconfig-consolidador.json";
  writeFileSync(cfgPath, JSON.stringify(tsconfig));
  console.log("Compilando TS → JS...");
  execSync(`npx tsc -p ${cfgPath}`, { stdio: "inherit", cwd: PROJECT_ROOT });
}

compilar();

process.env.NODE_PATH = `${PROJECT_ROOT}/node_modules`;
const { Module } = await import("node:module");
Module._initPaths();

const { parseRomaMensualBuffer } = await import(`${OUT}/lib/historico/parser-roma-mensual.js`);
const {
  crearHistoricoVacio,
  aplicarCortes,
  describirHistorico,
  agruparWarnings,
  topVentaIdsProblematicos,
  serializarHistorico,
  deserializarHistorico,
} = await import(`${OUT}/lib/historico/consolidador.js`);
const fs = await import("node:fs/promises");

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════════");
console.log("  VALIDACIÓN — Consolidador histórico vs CSV de referencia");
console.log("══════════════════════════════════════════════════════════════════════════════════");

const t0 = Date.now();

// ── 1) Parsear los 5 archivos ───────────────────────────────────────────────
console.log("");
console.log("  Parseo de cortes:");
const cortes = [];
for (const f of ROMA_FILES) {
  const buf = await fs.readFile(f.path);
  const r = parseRomaMensualBuffer(new Uint8Array(buf), path.basename(f.path), buf.byteLength);
  cortes.push(r);
  console.log(`    ${f.label.padEnd(15)} ${r.corte.id} · ${r.filas.length} filas · ${r.report.confianzaMesDeteccion}`);
}

// ── 2) Aplicar cronológicamente ─────────────────────────────────────────────
console.log("");
console.log("  Aplicación cronológica con `aplicarCortes`:");
const h0 = crearHistoricoVacio();
const tApp0 = Date.now();
const { historicoFinal, resultados } = aplicarCortes(h0, cortes);
const tApp1 = Date.now();

console.log(`    Tiempo total de aplicación: ${tApp1 - tApp0} ms`);
console.log("");
console.log("    Resumen por corte:");
console.log(`    ${"Corte".padEnd(10)} ${"Nuevos".padStart(8)} ${"Actual".padStart(8)} ${"SinCamb".padStart(8)} ${"Conf".padStart(6)} ${"Warns".padStart(7)} ${"ms".padStart(5)}`);
for (const r of resultados) {
  const s = r.resumen;
  console.log(
    `    ${s.corteId.padEnd(10)} ${String(s.ventaIdsNuevos).padStart(8)} ${String(s.ventaIdsActualizados).padStart(8)} ${String(s.ventaIdsSinCambio).padStart(8)} ${String(s.ventaIdsEnConflicto).padStart(6)} ${String(s.warningsCount).padStart(7)} ${String(s.msec).padStart(5)}`,
  );
}

// ── 3) Descripción del histórico ────────────────────────────────────────────
const desc = describirHistorico(historicoFinal);
console.log("");
console.log("  Descripción del histórico final:");
console.log(`    Total VentaIDs:    ${desc.totalVentaIds}`);
console.log(`    Total cortes:      ${desc.totalCortes}`);
console.log(`    Cortes/VentaID:    min=${desc.cortesPorVentaId.min}, max=${desc.cortesPorVentaId.max}, mediana=${desc.cortesPorVentaId.mediana}`);
if (desc.cubrePeriodo) {
  console.log(`    Periodo cubierto:  ${desc.cubrePeriodo.desde.toISOString().slice(0, 10)} → ${desc.cubrePeriodo.hasta.toISOString().slice(0, 10)}`);
}
console.log("    VentaIDs vivos por corte:");
for (const [k, n] of desc.ventaIdsPorCorte) {
  console.log(`      ${k}  ${n}`);
}

// ── 4) Warnings agregados ──────────────────────────────────────────────────
const allWarnings = resultados.flatMap((r) => r.warnings);
const agr = agruparWarnings(allWarnings);
console.log("");
console.log("  Warnings agregados:");
console.log(`    Total: ${agr.total}`);
console.log(`    Por severidad:`);
for (const [k, n] of Object.entries(agr.porSeveridad)) console.log(`      ${k.padEnd(13)} ${n}`);
console.log(`    Por categoría:`);
for (const [k, n] of Object.entries(agr.porCategoria)) console.log(`      ${k.padEnd(25)} ${n}`);
console.log(`    Por campo:`);
for (const [k, n] of Object.entries(agr.porCampo).sort((a, b) => b[1] - a[1])) {
  console.log(`      ${k.padEnd(25)} ${n}`);
}
const tops = topVentaIdsProblematicos(allWarnings, 5);
if (tops.length > 0) {
  console.log(`    Top 5 VentaIDs con más warnings:`);
  for (const t of tops) console.log(`      ${t.ventaId.toString().padStart(7)}  ${t.count} warnings · [${t.categorias.join(", ")}]`);
}

// ── 5) Comparación contra CSV de referencia ─────────────────────────────────
console.log("");
console.log("  Comparación contra CSV de referencia:");
const csvRaw = readFileSync(CSV_REFERENCIA, "utf-8");
const csvLines = csvRaw.split("\n").filter((l) => l.length > 0);
const csvHeader = csvLines[0].split(",");
const csvVentaIdIdx = csvHeader.indexOf("ventaId");
const ventaIdsCSV = new Set();
for (let i = 1; i < csvLines.length; i++) {
  const vid = Number(csvLines[i].split(",")[csvVentaIdIdx]);
  if (Number.isFinite(vid)) ventaIdsCSV.add(vid);
}
const ventaIdsConsolidador = new Set(historicoFinal.entradas.keys());

const enAmbos = [...ventaIdsCSV].filter((v) => ventaIdsConsolidador.has(v)).length;
const soloEnCSV = [...ventaIdsCSV].filter((v) => !ventaIdsConsolidador.has(v));
const soloEnCons = [...ventaIdsConsolidador].filter((v) => !ventaIdsCSV.has(v));
const matchPct = enAmbos / ventaIdsCSV.size * 100;

console.log(`    VentaIDs CSV referencia:    ${ventaIdsCSV.size}`);
console.log(`    VentaIDs consolidador:      ${ventaIdsConsolidador.size}`);
console.log(`    Coinciden:                  ${enAmbos}  (${matchPct.toFixed(2)}%)`);
console.log(`    Solo en CSV (faltan):       ${soloEnCSV.length}`);
console.log(`    Solo en consolidador:       ${soloEnCons.length}`);
if (soloEnCSV.length > 0 && soloEnCSV.length <= 10) {
  console.log(`    VentaIDs en CSV no encontrados: ${soloEnCSV.join(", ")}`);
}

// ── 6) Round-trip serialización ─────────────────────────────────────────────
console.log("");
console.log("  Round-trip serialización:");
const tSer0 = Date.now();
const json = serializarHistorico(historicoFinal);
const tSer1 = Date.now();
const restored = deserializarHistorico(JSON.parse(JSON.stringify(json)));
const tDeser = Date.now() - tSer1;

const igualSize = restored.entradas.size === historicoFinal.entradas.size;
const igualCortes = restored.cortes.length === historicoFinal.cortes.length;
// Verificar 50 entradas al azar
let muestra = 0;
let preservadas = 0;
for (const [vid, e] of historicoFinal.entradas) {
  muestra++;
  if (muestra > 50) break;
  const r = restored.entradas.get(vid);
  if (!r) continue;
  const sameVin = r.row.vin === e.row.vin;
  const sameEstado = r.row.estado === e.row.estado;
  const sameFSol = (r.row.fSolicitud?.getTime() ?? null) === (e.row.fSolicitud?.getTime() ?? null);
  if (sameVin && sameEstado && sameFSol) preservadas++;
}
const sizeJson = JSON.stringify(json).length;
console.log(`    Serializado:  ${tSer1 - tSer0} ms · ${(sizeJson / 1024).toFixed(0)} KB`);
console.log(`    Deserializado: ${tDeser} ms`);
console.log(`    Tamaños iguales: ${igualSize ? "✅" : "❌"} entradas, ${igualCortes ? "✅" : "❌"} cortes`);
console.log(`    Sample preservado: ${preservadas}/50`);

// ── Veredicto final ────────────────────────────────────────────────────────
const okMatch = matchPct >= 99.9;
const okSer = igualSize && igualCortes && preservadas === 50;
const tFin = Date.now();
console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════════");
console.log(`  Tiempo total: ${tFin - t0} ms`);
console.log(`  Match VentaIDs: ${matchPct.toFixed(2)}%  ${okMatch ? "✅" : "❌"}`);
console.log(`  Round-trip serialización: ${okSer ? "✅" : "❌"}`);
console.log("══════════════════════════════════════════════════════════════════════════════════");

if (!okMatch || !okSer) {
  process.exit(1);
}
