#!/usr/bin/env node
/**
 * VALIDACIÓN — Parser Actas histórico vs Actas al 28 de Mayo.xlsx y CSV de
 * referencia (historico-consolidado.csv que es el cruce ROMA+Actas).
 *
 * Pasos:
 *  1. Compila el módulo histórico TS a /tmp.
 *  2. Parsea "Actas al 28 de Mayo.xlsx" con `parseActasBuffer`.
 *  3. Verifica métricas operacionales esperadas (sección 10/11 de DECISION):
 *     - filas totales ~7.105
 *     - entregados ~6.251 (88%), no entregados ~854 (12%)
 *     - cobertura fPatenteRecibida ~67%, fInscripcion ~97%
 *  4. Cruza VIN contra historico-consolidado.csv (solo filas con enActas=true)
 *     y mide:
 *     - VINs en ambos vs VINs solo en uno
 *     - Coincidencia de entregado
 *     - Coincidencia de fEntregaReal a nivel YYYY-MM-DD
 *  5. Reporta distribución por nivelDocumental y métricas de cumplimiento.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const PROJECT_ROOT = "/Users/Daviid/velocidad";
const OUT = "/tmp/historico-tests";
const SRC_DIR = `${PROJECT_ROOT}/src/lib/historico`;
const BASE = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive";

const ACTAS_PATH = `${BASE}/Actas al 28 de Mayo.xlsx`;
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
  const cfgPath = "/tmp/historico-tests-tsconfig-actas.json";
  writeFileSync(cfgPath, JSON.stringify(tsconfig));
  console.log("Compilando TS → JS...");
  execSync(`npx tsc -p ${cfgPath}`, { stdio: "inherit", cwd: PROJECT_ROOT });
}

compilar();

process.env.NODE_PATH = `${PROJECT_ROOT}/node_modules`;
const { Module } = await import("node:module");
Module._initPaths();

const { parseActasBuffer, distribuirDescartesActas } = await import(`${OUT}/lib/historico/parser-actas.js`);
const fs = await import("node:fs/promises");

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════════");
console.log("  VALIDACIÓN — Parser Actas histórico vs archivo real");
console.log("══════════════════════════════════════════════════════════════════════════════════");

const t0 = Date.now();

// ── 1) Parsear Actas ────────────────────────────────────────────────────────
console.log("");
console.log("  Parseando: Actas al 28 de Mayo.xlsx");
const buf = await fs.readFile(ACTAS_PATH);
const tParse0 = Date.now();
const { corte, filas, report } = parseActasBuffer(
  new Uint8Array(buf),
  path.basename(ACTAS_PATH),
  buf.byteLength,
);
const tParse1 = Date.now();
console.log(`    Tiempo de parseo: ${tParse1 - tParse0} ms`);
console.log("");
console.log(`    Corte ID:           ${corte.id}`);
console.log(`    Corte fecha:        ${corte.fecha ? corte.fecha.toISOString().slice(0, 10) : "—"}`);
console.log(`    Método detección:   ${report.metodoDeteccionCorte}`);
console.log(`    Confianza:          ${report.confianzaCorte}`);
console.log(`    Detalle corte:`);
console.log(`      max fEntrega:     ${report.detalleCorte.maxFechaEntregaReal}`);
console.log(`      max fPatente:     ${report.detalleCorte.maxFechaPatenteRecibida}`);
console.log(`      max fFactura:     ${report.detalleCorte.maxFechaFactura}`);
console.log(`      estimado:         ${report.detalleCorte.corteEstimado}`);

// ── 2) Volumen y descartes ──────────────────────────────────────────────────
console.log("");
console.log("  Volumen:");
console.log(`    Filas totales:      ${report.filasTotales}`);
console.log(`    Procesadas:         ${report.filasProcesadas}`);
console.log(`    Descartadas:        ${report.filasDescartadas}`);
const dist = distribuirDescartesActas(report.descartes);
console.log(`    Distribución descartes:`);
for (const [k, n] of Object.entries(dist)) {
  if (n > 0) console.log(`      ${k.padEnd(25)} ${n}`);
}
if (report.duplicadosInternosVin.length > 0) {
  console.log(`    Duplicados internos VIN: ${report.duplicadosInternosVin.length}`);
}

// ── 3) Entregados ──────────────────────────────────────────────────────────
console.log("");
console.log("  Entregados:");
const pctEnt = ((report.totalEntregados / report.filasProcesadas) * 100).toFixed(2);
const pctNoEnt = ((report.totalNoEntregados / report.filasProcesadas) * 100).toFixed(2);
console.log(`    Total entregados:    ${report.totalEntregados}  (${pctEnt}%)`);
console.log(`    Total no entregados: ${report.totalNoEntregados}  (${pctNoEnt}%)`);
console.log(`    Por fuente:`);
console.log(`      txt='Cargado':            ${report.totalCargadoTxt}`);
console.log(`      red seguridad (patente):  ${report.totalRedSeguridad}`);
console.log(`    Entregados sin fEntregaReal: ${report.totalSinFechaEntregaReal}`);

// ── 4) Cobertura ───────────────────────────────────────────────────────────
console.log("");
console.log("  Cobertura de campos clave (% sobre filas procesadas):");
for (const [k, v] of Object.entries(report.cobertura)) {
  console.log(`    ${k.padEnd(25)} ${v}%`);
}

// ── 5) Cumplimiento operacional ────────────────────────────────────────────
console.log("");
console.log("  Cumplimiento operacional (NO son errores, son métricas):");
const c = report.cumplimiento;
console.log(`    Entregados sin fPatenteRecibida:        ${c.entregadosSinPatenteRecibida}`);
console.log(`    Entregados sin autorizacion_entrega=Si: ${c.entregadosSinAutorizacion}`);
console.log(`    Entregados sin sol_entrega=Si:          ${c.entregadosSinSolicitudEntrega}`);
console.log(`    Distribución por nivel documental:`);
for (const [k, n] of Object.entries(c.porNivelDocumental)) {
  const pct = ((n / report.filasProcesadas) * 100).toFixed(2);
  console.log(`      ${k.padEnd(10)} ${String(n).padStart(6)}  (${pct}%)`);
}

// ── 6) Huérfanos candidatos ────────────────────────────────────────────────
console.log("");
console.log("  Huérfanos candidatos (perfil rápido — clasificación final fuera del parser):");
console.log(`    Tipo 1 (probable entrega no registrada):       ${report.huerfanosCandidatos.tipo1ProbableEntregaNoRegistrada}`);
console.log(`    Tipo 2 (entregado con cierre inconsistente):   ${report.huerfanosCandidatos.tipo2EntregadoConCierreInconsistente}`);

// ── 7) Cruce contra CSV de referencia ──────────────────────────────────────
console.log("");
console.log("  Cruce contra CSV de referencia (historico-consolidado.csv):");
const csvRaw = readFileSync(CSV_REFERENCIA, "utf-8");
const csvLines = csvRaw.split("\n").filter((l) => l.length > 0);
const header = csvLines[0].split(",");
const idxVin = header.indexOf("vin");
const idxEntregado = header.indexOf("entregado");
const idxEnActas = header.indexOf("enActas");
const idxFEntrega = header.indexOf("fEntregaReal");

if (idxVin < 0 || idxEnActas < 0) {
  console.log("    ⚠ CSV no tiene columnas esperadas (vin, enActas). Skip.");
} else {
  const csvActas = new Map(); // vin → { entregado, fEntregaReal }
  for (let i = 1; i < csvLines.length; i++) {
    const cells = csvLines[i].split(",");
    const enActas = cells[idxEnActas] === "true";
    if (!enActas) continue;
    const vin = cells[idxVin]?.trim().toUpperCase();
    if (!vin) continue;
    csvActas.set(vin, {
      entregado: cells[idxEntregado] === "true",
      fEntregaReal: cells[idxFEntrega] || null,
    });
  }

  const consActas = new Map();
  for (const f of filas) consActas.set(f.vin, f);

  const vinsCSV = new Set(csvActas.keys());
  const vinsCons = new Set(consActas.keys());
  const enAmbos = [...vinsCSV].filter((v) => vinsCons.has(v));
  const soloEnCSV = [...vinsCSV].filter((v) => !vinsCons.has(v));
  const soloEnCons = [...vinsCons].filter((v) => !vinsCSV.has(v));

  const matchPct = (enAmbos.length / vinsCSV.size) * 100;
  console.log(`    VINs en Actas CSV (enActas=true): ${vinsCSV.size}`);
  console.log(`    VINs en consolidador Actas:       ${vinsCons.size}`);
  console.log(`    Coinciden:                        ${enAmbos.length}  (${matchPct.toFixed(2)}%)`);
  console.log(`    Solo en CSV (faltan en parser):   ${soloEnCSV.length}`);
  console.log(`    Solo en parser (no en CSV):       ${soloEnCons.length}`);

  // Cruce de entregado para los VINs comunes
  let entOk = 0;
  let entMismatch = 0;
  const ejemplosDif = [];
  for (const vin of enAmbos) {
    const csv = csvActas.get(vin);
    const cons = consActas.get(vin);
    if (csv.entregado === cons.entregado) entOk++;
    else {
      entMismatch++;
      if (ejemplosDif.length < 5) {
        ejemplosDif.push({ vin, csv: csv.entregado, parser: cons.entregado });
      }
    }
  }
  const entPct = (entOk / enAmbos.length) * 100;
  console.log(`    Coincidencia 'entregado':         ${entOk}/${enAmbos.length}  (${entPct.toFixed(2)}%)`);
  if (entMismatch > 0) {
    console.log(`    Mismatches en 'entregado':        ${entMismatch}`);
    for (const e of ejemplosDif) {
      console.log(`      ${e.vin}  CSV=${e.csv} parser=${e.parser}`);
    }
  }

  // ── Veredicto ──
  const okMatch = matchPct >= 99.0;
  const okEnt = entPct >= 99.0;
  const tFin = Date.now();
  console.log("");
  console.log("══════════════════════════════════════════════════════════════════════════════════");
  console.log(`  Tiempo total: ${tFin - t0} ms`);
  console.log(`  Match VIN (Actas∩CSV): ${matchPct.toFixed(2)}%  ${okMatch ? "✅" : "❌"}`);
  console.log(`  Coincidencia entregado: ${entPct.toFixed(2)}%  ${okEnt ? "✅" : "❌"}`);
  console.log("══════════════════════════════════════════════════════════════════════════════════");
  if (!okMatch || !okEnt) process.exit(1);
}
