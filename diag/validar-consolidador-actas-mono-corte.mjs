#!/usr/bin/env node
/**
 * VALIDACIÓN — Consolidador Actas histórico con UN solo corte.
 *
 * Pasos:
 *  1. Compila histórico TS a /tmp.
 *  2. Parsea `Actas al 28 de Mayo.xlsx`.
 *  3. Aplica el corte a un histórico vacío.
 *  4. Verifica que:
 *     - entradas.size === filas parseadas (6.957)
 *     - todos los VINs tienen primerCorte === ultimoCorte === ultimoVisto
 *     - cumplimiento global coincide con el reporte del parser
 *     - clasificarHuerfanos coincide con huerfanosCandidatos del parser
 *     - round-trip de serialización es idempotente sobre 50 muestras
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const PROJECT_ROOT = "/Users/Daviid/velocidad";
const OUT = "/tmp/historico-tests";
const SRC_DIR = `${PROJECT_ROOT}/src/lib/historico`;
const BASE = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive";
const ACTAS_PATH = `${BASE}/Actas al 28 de Mayo.xlsx`;

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
  const cfgPath = "/tmp/historico-tests-tsconfig-actas-mono.json";
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
  aplicarCorteActas,
  describirHistoricoActas,
  vistaActasVivo,
  vistaActasHistorico,
  vinsDesaparecidos,
  clasificarHuerfanosActas,
  calcularCumplimientoActas,
  agruparWarningsActas,
  serializarHistoricoActas,
  deserializarHistoricoActas,
} = await import(`${OUT}/lib/historico/consolidador-actas.js`);
const fs = await import("node:fs/promises");

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════════");
console.log("  VALIDACIÓN — Consolidador Actas (mono-corte)");
console.log("══════════════════════════════════════════════════════════════════════════════════");

const t0 = Date.now();

// ── Parser
const buf = await fs.readFile(ACTAS_PATH);
const tParse0 = Date.now();
const corte = parseActasBuffer(new Uint8Array(buf), path.basename(ACTAS_PATH), buf.byteLength);
const tParse1 = Date.now();
console.log(`  Parser: ${tParse1 - tParse0} ms · ${corte.filas.length} filas`);

// ── Aplicar al consolidador
const h0 = crearHistoricoActasVacio();
const tApp0 = Date.now();
const r = aplicarCorteActas(h0, corte);
const tApp1 = Date.now();
console.log(`  Aplicación: ${tApp1 - tApp0} ms`);
console.log(`  Resumen aplicación: nuevos=${r.resumen.vinsNuevos}, actualizados=${r.resumen.vinsActualizados}, sinCambio=${r.resumen.vinsSinCambio}, desaparecidos=${r.resumen.vinsDesaparecidos}, warnings=${r.resumen.warningsCount}`);

// ── Verificaciones invariantes mono-corte
const okSize = r.historico.entradas.size === corte.filas.length;
const okDesap = r.resumen.vinsDesaparecidos === 0;

let okIgualCortes = true;
let okPresenteEn = true;
for (const e of r.historico.entradas.values()) {
  if (e.corteIdOrigen !== corte.corte.id || e.corteIdEvolutivo !== corte.corte.id || e.corteIdUltimoVisto !== corte.corte.id) {
    okIgualCortes = false;
  }
  if (e.presenteEn.length !== 1 || e.presenteEn[0] !== corte.corte.id) {
    okPresenteEn = false;
  }
}

console.log("");
console.log("  Invariantes mono-corte:");
console.log(`    entradas.size === parser.filas:      ${okSize ? "✅" : "❌"} (${r.historico.entradas.size} vs ${corte.filas.length})`);
console.log(`    Todos los VINs en un único corte:    ${okIgualCortes ? "✅" : "❌"}`);
console.log(`    presenteEn = [corteId]:              ${okPresenteEn ? "✅" : "❌"}`);
console.log(`    vinsDesaparecidos = 0:               ${okDesap ? "✅" : "❌"}`);

// ── Vistas vivo / histórico deben coincidir en mono-corte
const vivos = vistaActasVivo(r.historico);
const hist = vistaActasHistorico(r.historico);
const okVistas = vivos.length === hist.length;
console.log(`    vista vivo === vista histórico:      ${okVistas ? "✅" : "❌"} (${vivos.length} vs ${hist.length})`);

// ── Cumplimiento global coincide con reporte del parser
const cump = calcularCumplimientoActas(r.historico, { porSucursal: true, porResponsable: true });
const okCumpEnt = cump.global.entregados === corte.report.totalEntregados;
const okCumpNoEnt = cump.global.noEntregados === corte.report.totalNoEntregados;
const okCumpSinPat = cump.global.entregadosSinPatenteRecibida === corte.report.cumplimiento.entregadosSinPatenteRecibida;
const okCumpSinAut = cump.global.entregadosSinAutorizacion === corte.report.cumplimiento.entregadosSinAutorizacion;
const okCumpSinSol = cump.global.entregadosSinSolicitudEntrega === corte.report.cumplimiento.entregadosSinSolicitudEntrega;
const okNivCompl = cump.global.porNivelDocumental.completo === corte.report.cumplimiento.porNivelDocumental.completo;
const okNivParc = cump.global.porNivelDocumental.parcial === corte.report.cumplimiento.porNivelDocumental.parcial;
const okNivMin = cump.global.porNivelDocumental.minimo === corte.report.cumplimiento.porNivelDocumental.minimo;

console.log("");
console.log("  Cumplimiento global == reporte parser:");
console.log(`    entregados:                          ${okCumpEnt ? "✅" : "❌"} ${cump.global.entregados}`);
console.log(`    no entregados:                       ${okCumpNoEnt ? "✅" : "❌"} ${cump.global.noEntregados}`);
console.log(`    entregadosSinPatenteRecibida:        ${okCumpSinPat ? "✅" : "❌"} ${cump.global.entregadosSinPatenteRecibida}`);
console.log(`    entregadosSinAutorizacion:           ${okCumpSinAut ? "✅" : "❌"} ${cump.global.entregadosSinAutorizacion}`);
console.log(`    entregadosSinSolicitudEntrega:       ${okCumpSinSol ? "✅" : "❌"} ${cump.global.entregadosSinSolicitudEntrega}`);
console.log(`    nivelDocumental.completo:            ${okNivCompl ? "✅" : "❌"} ${cump.global.porNivelDocumental.completo}`);
console.log(`    nivelDocumental.parcial:             ${okNivParc ? "✅" : "❌"} ${cump.global.porNivelDocumental.parcial}`);
console.log(`    nivelDocumental.minimo:              ${okNivMin ? "✅" : "❌"} ${cump.global.porNivelDocumental.minimo}`);

// ── Ciclo (no comparable contra el parser; solo se reportan)
console.log("");
console.log("  Ciclo (medianas / p90 días):");
const m = cump.ciclo.medianasDias;
const p = cump.ciclo.p90Dias;
console.log(`    venta → factura:        mediana=${m.ventaAFactura}  p90=${p.ventaAFactura}`);
console.log(`    factura → inscripción:  mediana=${m.facturaAInscripcion}  p90=${p.facturaAInscripcion}`);
console.log(`    inscripción → patente:  mediana=${m.inscripcionAPatente}  p90=${p.inscripcionAPatente}`);
console.log(`    patente → entrega:      mediana=${m.patenteAEntrega}  p90=${p.patenteAEntrega}`);
console.log(`    venta → entrega:        mediana=${m.ventaAEntrega}  p90=${p.ventaAEntrega}`);

// ── Desglose
console.log("");
console.log(`  Top 5 sucursales por universo:`);
for (const s of cump.porSucursal.slice(0, 5)) {
  console.log(`    ${s.sucursal.padEnd(35)} u=${String(s.universo).padStart(5)}  ent=${String(s.entregados).padStart(5)}  sinPat=${String(s.entregadosSinPatenteRecibida).padStart(4)}  compl=${String(s.porNivelDocumental.completo).padStart(4)}`);
}
console.log(`  Top 5 responsables por universo:`);
for (const v of cump.porResponsable.slice(0, 5)) {
  console.log(`    ${v.responsable.padEnd(35)} u=${String(v.universo).padStart(5)}  ent=${String(v.entregados).padStart(5)}  sinPat=${String(v.entregadosSinPatenteRecibida).padStart(4)}`);
}

// ── Huérfanos: tipos 1 y 2 deben coincidir con candidates del parser
const huerf = clasificarHuerfanosActas(r.historico);
const okHuer1 = huerf.tipo1ProbableEntregaNoRegistrada.length === corte.report.huerfanosCandidatos.tipo1ProbableEntregaNoRegistrada;
const okHuer2 = huerf.tipo2EntregadoConCierreInconsistente.length === corte.report.huerfanosCandidatos.tipo2EntregadoConCierreInconsistente;
const okHuer3 = huerf.tipo3Desaparecidos.length === 0; // mono-corte
console.log("");
console.log("  Clasificación huérfanos:");
console.log(`    tipo 1 (vs parser):                  ${okHuer1 ? "✅" : "❌"} ${huerf.tipo1ProbableEntregaNoRegistrada.length} vs ${corte.report.huerfanosCandidatos.tipo1ProbableEntregaNoRegistrada}`);
console.log(`    tipo 2 (vs parser):                  ${okHuer2 ? "✅" : "❌"} ${huerf.tipo2EntregadoConCierreInconsistente.length} vs ${corte.report.huerfanosCandidatos.tipo2EntregadoConCierreInconsistente}`);
console.log(`    tipo 3 (mono-corte = 0):             ${okHuer3 ? "✅" : "❌"} ${huerf.tipo3Desaparecidos.length}`);
console.log(`    tipo 4 (inconsistencia temporal):    ${huerf.tipo4InconsistenciaTemporal.length} (informativo en mono-corte)`);

// ── Warnings (en mono-corte deberían ser cero o casi cero)
const agr = agruparWarningsActas(r.warnings);
console.log("");
console.log(`  Warnings totales: ${agr.total}`);
for (const [k, n] of Object.entries(agr.porSeveridad)) console.log(`    ${k.padEnd(13)} ${n}`);

// ── Desaparecidos (debe ser 0 en mono-corte)
const desap = vinsDesaparecidos(r.historico);
console.log(`  vinsDesaparecidos: ${desap.length} (esperado: 0)`);

// ── Descripción
const d = describirHistoricoActas(r.historico);
console.log("");
console.log("  Descripción:");
console.log(`    totalVins:           ${d.totalVins}`);
console.log(`    totalCortes:         ${d.totalCortes}`);
console.log(`    vinsEnUltimoCorte:   ${d.vinsEnUltimoCorte}`);
console.log(`    vinsDesaparecidos:   ${d.vinsDesaparecidos}`);
console.log(`    cortesPorVin:        min=${d.cortesPorVin.min}, max=${d.cortesPorVin.max}, mediana=${d.cortesPorVin.mediana}`);
if (d.cubrePeriodo) {
  console.log(`    periodo (fFactura):  ${d.cubrePeriodo.desde.toISOString().slice(0, 10)} → ${d.cubrePeriodo.hasta.toISOString().slice(0, 10)}`);
}

// ── Round-trip serialización
const tSer0 = Date.now();
const json = serializarHistoricoActas(r.historico);
const tSer1 = Date.now();
const restored = deserializarHistoricoActas(JSON.parse(JSON.stringify(json)));
const tDeser1 = Date.now();

const okSer = restored.entradas.size === r.historico.entradas.size && restored.cortes.length === r.historico.cortes.length;
let muestraOk = 0;
let muestraT = 0;
for (const [vin, e] of r.historico.entradas) {
  muestraT++;
  if (muestraT > 50) break;
  const rr = restored.entradas.get(vin);
  if (!rr) continue;
  const sameVin = rr.row.vin === e.row.vin;
  const sameEnt = rr.row.entregado === e.row.entregado;
  const sameFFac = (rr.row.fFactura?.getTime() ?? null) === (e.row.fFactura?.getTime() ?? null);
  const sameNiv = rr.row.nivelDocumental === e.row.nivelDocumental;
  if (sameVin && sameEnt && sameFFac && sameNiv) muestraOk++;
}
console.log("");
console.log("  Round-trip serialización:");
console.log(`    Serialización: ${tSer1 - tSer0} ms`);
console.log(`    Deserialización: ${tDeser1 - tSer1} ms`);
console.log(`    Tamaño JSON: ${(JSON.stringify(json).length / 1024).toFixed(0)} KB`);
console.log(`    Estructura preservada: ${okSer ? "✅" : "❌"}`);
console.log(`    Sample 50 VINs: ${muestraOk}/50 ${muestraOk === 50 ? "✅" : "❌"}`);

// ── Veredicto
const okGlobal =
  okSize && okIgualCortes && okPresenteEn && okDesap && okVistas &&
  okCumpEnt && okCumpNoEnt && okCumpSinPat && okCumpSinAut && okCumpSinSol &&
  okNivCompl && okNivParc && okNivMin &&
  okHuer1 && okHuer2 && okHuer3 &&
  okSer && muestraOk === 50;

const tFin = Date.now();
console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════════");
console.log(`  Tiempo total: ${tFin - t0} ms`);
console.log(`  Veredicto: ${okGlobal ? "✅ TODAS LAS INVARIANTES" : "❌ HAY FALLAS"}`);
console.log("══════════════════════════════════════════════════════════════════════════════════");
if (!okGlobal) process.exit(1);
