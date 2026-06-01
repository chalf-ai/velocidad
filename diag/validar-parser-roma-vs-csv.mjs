#!/usr/bin/env node
/**
 * VALIDACIÓN — Parser ROMA vs CSV de referencia.
 *
 * Pasos:
 *  1. Compila el parser TS a /tmp (vía el mismo flujo que run-merge-tests).
 *  2. Llama parseRomaMensualBuffer sobre los 5 archivos ROMA reales (Ene-May).
 *  3. Verifica que cada uno detecte su mes esperado.
 *  4. Consolida con consolidarRomaSerie en orden cronológico.
 *  5. Carga el CSV de auditoría (4.750 VentaIDs) y compara universos.
 *  6. Reporta:
 *      - Detección de mes por archivo
 *      - Filas procesadas/descartadas
 *      - Cobertura del CSV de referencia
 *      - Warnings emitidos durante el merge
 *      - Tiempo total
 *
 * Falla con exit !=0 si la coincidencia es < 99.9%.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";

const PROJECT_ROOT = "/Users/Daviid/velocidad";
const OUT = "/tmp/historico-tests";
const SRC_DIR = `${PROJECT_ROOT}/src/lib/historico`;
const BASE = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive";

const ROMA_FILES = [
  { mes_esperado: "2026-01", path: `${BASE}/LOG Enero.xlsx`, label: "Enero" },
  { mes_esperado: "2026-02", path: `${BASE}/Log Febrero.xlsx`, label: "Febrero" },
  { mes_esperado: "2026-03", path: `${BASE}/LOG Marzo.xlsx`, label: "Marzo" },
  { mes_esperado: "2026-04", path: `${BASE}/Log Abril.xlsx`, label: "Abril" },
  { mes_esperado: "2026-05", path: `${BASE}/Log Roma 29-05-2026 .xlsx`, label: "Mayo" },
];

const CSV_REFERENCIA = path.join(PROJECT_ROOT, "diag", "output", "historico-consolidado.csv");

// ── Compilación inline ──────────────────────────────────────────────────────
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
  const cfgPath = "/tmp/historico-tests-tsconfig-validar.json";
  writeFileSync(cfgPath, JSON.stringify(tsconfig));
  console.log("Compilando TS → JS...");
  execSync(`npx tsc -p ${cfgPath}`, { stdio: "inherit", cwd: PROJECT_ROOT });
}

compilar();

// ── Import del código compilado (requiere NODE_PATH para xlsx) ──────────────
process.env.NODE_PATH = `${PROJECT_ROOT}/node_modules`;
// Recargar el module resolution con el NODE_PATH
const { Module } = await import("node:module");
Module._initPaths();

const { parseRomaMensualBuffer, distribuirDescartes } = await import(
  `${OUT}/lib/historico/parser-roma-mensual.js`
);
const { mergeRomaRows, consolidarRomaSerie } = await import(
  `${OUT}/lib/historico/merge-policy.js`
);
const XLSX = (await import("xlsx")).default;
const fs = await import("node:fs/promises");

// ── 1) Parsear cada archivo ROMA real ───────────────────────────────────────
console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════════");
console.log("  VALIDACIÓN — Parser ROMA vs CSV de referencia");
console.log("══════════════════════════════════════════════════════════════════════════════════");

const t0 = Date.now();
const resultados = [];
let allOk = true;

for (const f of ROMA_FILES) {
  const buf = await fs.readFile(f.path);
  const tInicio = Date.now();
  const result = parseRomaMensualBuffer(new Uint8Array(buf), path.basename(f.path), buf.byteLength);
  const tFin = Date.now();
  const dist = distribuirDescartes(result.report.descartes);
  const okMes = result.corte.id === f.mes_esperado;
  if (!okMes) allOk = false;
  resultados.push({ ...f, result, dist, msec: tFin - tInicio });
}

console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────────");
console.log("  Detección de mes por archivo");
console.log("──────────────────────────────────────────────────────────────────────────────────");
console.log("  Archivo            Esperado  Detectado  Conf      Filas  Desc.   ms");
console.log("  " + "─".repeat(78));
for (const r of resultados) {
  const ok = r.result.corte.id === r.mes_esperado ? "✅" : "❌";
  console.log(
    `  ${r.label.padEnd(15)} ${r.mes_esperado.padEnd(9)} ${(r.result.corte.id ?? "—").padEnd(10)} ${r.result.report.confianzaMesDeteccion.padEnd(9)} ${String(r.result.filas.length).padStart(5)} ${String(r.result.report.filasDescartadas).padStart(5)}  ${String(r.msec).padStart(4)} ${ok}`,
  );
}

// ── 2) Detalle de descartes ─────────────────────────────────────────────────
console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────────");
console.log("  Detalle de descartes por archivo");
console.log("──────────────────────────────────────────────────────────────────────────────────");
const TIPOS = ["sin_ventaId", "sin_vin", "vin_invalido", "ventaId_no_numerico", "duplicado_interno_ventaId", "fecha_solicitud_invalida"];
console.log("  Archivo         " + TIPOS.map((t) => t.padStart(10).slice(0, 10)).join(" "));
for (const r of resultados) {
  const row = TIPOS.map((t) => String(r.dist[t] ?? 0).padStart(10).slice(-10));
  console.log(`  ${r.label.padEnd(15)} ${row.join(" ")}`);
}

// ── 3) Consolidar con consolidarRomaSerie ────────────────────────────────────
console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────────");
console.log("  Consolidación cronológica con consolidarRomaSerie");
console.log("──────────────────────────────────────────────────────────────────────────────────");

// Construir el universo: por cada VentaID, la cadena de cortes donde aparece
const cortesPorVenta = new Map();
const ctxPorMes = new Map(); // mes → {corteId, corteFecha}
for (const r of resultados) {
  ctxPorMes.set(r.result.corte.id, {
    corteId: r.result.corte.id,
    corteFecha: r.result.corte.fecha,
  });
  for (const fila of r.result.filas) {
    if (!cortesPorVenta.has(fila.ventaId)) cortesPorVenta.set(fila.ventaId, []);
    cortesPorVenta.get(fila.ventaId).push({
      row: fila,
      ctx: ctxPorMes.get(r.result.corte.id),
    });
  }
}

// Ordenar y consolidar
let allWarnings = [];
const consolidado = new Map();
for (const [ventaId, serie] of cortesPorVenta) {
  serie.sort((a, b) => a.ctx.corteFecha - b.ctx.corteFecha);
  const { merged, warnings } = consolidarRomaSerie(serie);
  consolidado.set(ventaId, merged);
  allWarnings.push(...warnings);
}

console.log(`  Universo consolidado: ${consolidado.size} VentaIDs únicos`);
console.log(`  Warnings emitidos:    ${allWarnings.length}`);
// Agrupar warnings por kind
const wKind = new Map();
for (const w of allWarnings) wKind.set(w.kind, (wKind.get(w.kind) ?? 0) + 1);
for (const [k, n] of [...wKind.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`     ${k.padEnd(35)} ${n}`);
}

// ── 4) Comparar contra CSV de referencia ─────────────────────────────────────
console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────────");
console.log("  Comparación contra CSV de referencia (4.750 VentaIDs únicos)");
console.log("──────────────────────────────────────────────────────────────────────────────────");
const csvRaw = readFileSync(CSV_REFERENCIA, "utf-8");
const csvLines = csvRaw.split("\n").filter((l) => l.length > 0);
const csvHeader = csvLines[0].split(",");
const csvVentaIdIdx = csvHeader.indexOf("ventaId");
const ventaIdsCSV = new Set();
for (let i = 1; i < csvLines.length; i++) {
  const cols = csvLines[i].split(",");
  const vid = Number(cols[csvVentaIdIdx]);
  if (Number.isFinite(vid)) ventaIdsCSV.add(vid);
}

const ventaIdsParser = new Set(consolidado.keys());
const enAmbos = [...ventaIdsCSV].filter((v) => ventaIdsParser.has(v)).length;
const soloEnCSV = [...ventaIdsCSV].filter((v) => !ventaIdsParser.has(v));
const soloEnParser = [...ventaIdsParser].filter((v) => !ventaIdsCSV.has(v));

console.log(`  VentaIDs en CSV referencia: ${ventaIdsCSV.size}`);
console.log(`  VentaIDs en Parser:         ${ventaIdsParser.size}`);
console.log(`  Coinciden (en ambos):       ${enAmbos}`);
console.log(`  Solo en CSV (no en parser): ${soloEnCSV.length}  ${soloEnCSV.length > 0 ? "⚠" : ""}`);
console.log(`  Solo en parser (no en CSV): ${soloEnParser.length}  ${soloEnParser.length > 0 ? "⚠" : ""}`);

const matchPct = enAmbos / ventaIdsCSV.size * 100;
console.log(`  Coincidencia:                ${matchPct.toFixed(2)}%`);

if (soloEnCSV.length > 0 && soloEnCSV.length <= 20) {
  console.log(`  VentaIDs solo en CSV (primeros 20): ${soloEnCSV.slice(0, 20).join(", ")}`);
}
if (soloEnParser.length > 0 && soloEnParser.length <= 20) {
  console.log(`  VentaIDs solo en parser (primeros 20): ${soloEnParser.slice(0, 20).join(", ")}`);
}

// ── 5) Validación cruzada de campos ─────────────────────────────────────────
console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────────");
console.log("  Validación cruzada de campos (50 casos aleatorios)");
console.log("──────────────────────────────────────────────────────────────────────────────────");
// Tomar 50 VentaIDs que estén en ambos y comparar marca + sucursal + fSolicitud
const csvRowsByVid = new Map();
const csvSucIdx = csvHeader.indexOf("sucursal");
const csvMarcaIdx = csvHeader.indexOf("marca");
const csvFSolIdx = csvHeader.indexOf("fSolicitud");
function parseCSVLine(line) {
  const out = []; let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ""; }
      else if (c === '"') inQ = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
for (let i = 1; i < csvLines.length; i++) {
  const cols = parseCSVLine(csvLines[i]);
  const vid = Number(cols[csvVentaIdIdx]);
  if (!Number.isFinite(vid)) continue;
  csvRowsByVid.set(vid, {
    sucursal: cols[csvSucIdx],
    marca: cols[csvMarcaIdx],
    fSolicitud: cols[csvFSolIdx],
  });
}

const comunes = [...ventaIdsCSV].filter((v) => ventaIdsParser.has(v));
const sample = [];
// Sampling determinístico
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260529);
const shuffled = [...comunes];
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}
for (const v of shuffled.slice(0, 50)) sample.push(v);

let okMarca = 0, okSuc = 0, okFSol = 0;
const fallosDetalle = [];
for (const vid of sample) {
  const p = consolidado.get(vid);
  const c = csvRowsByVid.get(vid);
  const pFSol = p.fSolicitud ? p.fSolicitud.toISOString().slice(0, 10) : "";
  if (p.marca === c.marca || (!p.marca && !c.marca)) okMarca++;
  else if (fallosDetalle.length < 5) fallosDetalle.push({ vid, campo: "marca", parser: p.marca, csv: c.marca });
  if (p.sucursal === c.sucursal || (!p.sucursal && !c.sucursal)) okSuc++;
  if (pFSol === c.fSolicitud) okFSol++;
}
console.log(`  Coincidencia marca:       ${okMarca}/${sample.length}  (${(okMarca/sample.length*100).toFixed(1)}%)`);
console.log(`  Coincidencia sucursal:    ${okSuc}/${sample.length}  (${(okSuc/sample.length*100).toFixed(1)}%)`);
console.log(`  Coincidencia fSolicitud:  ${okFSol}/${sample.length}  (${(okFSol/sample.length*100).toFixed(1)}%)`);
if (fallosDetalle.length > 0) {
  console.log(`  Fallos (primeros 5):`);
  for (const f of fallosDetalle) console.log(`     ${f.vid}: ${f.campo} parser=${f.parser} vs csv=${f.csv}`);
}

const tFin = Date.now();
console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════════");
console.log(`  Tiempo total: ${tFin - t0} ms`);
console.log(`  Detección mes: ${allOk ? "✅ todos correctos" : "❌ alguno falló"}`);
console.log(`  Match VentaIDs: ${matchPct.toFixed(2)}%  ${matchPct >= 99.9 ? "✅" : "❌"}`);
console.log("══════════════════════════════════════════════════════════════════════════════════");

if (!allOk || matchPct < 99.9) {
  process.exit(1);
}
