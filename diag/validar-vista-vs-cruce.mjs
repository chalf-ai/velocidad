#!/usr/bin/env node
/**
 * VALIDACIÓN — Vista Histórica /velocidad-operacional vs cruce.
 *
 * Replica el pipeline real (5 ROMA + Actas + SCHIAPP/KAR), llama directamente
 * a los selectores `agregadosEje1/2/3` y `fingerprintGlobal` (los mismos que
 * usa la página), y los imprime para validación visual contra la UI.
 *
 * Lo que se demuestra:
 *  - Los selectores producen los mismos números que `validar-cruce-vs-csv.mjs`.
 *  - La página, si carga los mismos archivos, debe mostrar EXACTAMENTE estos
 *    valores en sus KPIs.
 *  - Caso VR3KAHPY3VS000844 fingerprint listo para comparar.
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
  const cfgPath = "/tmp/historico-tests-tsconfig-vista.json";
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
const {
  agregadosEje1,
  agregadosEje2,
  agregadosEje3,
  fingerprintGlobal,
  filtrarFilas,
  extraerOpciones,
  FILTROS_VACIOS,
} = await import(`${OUT}/lib/historico/vista-derivados.js`);
const fs = await import("node:fs/promises");

// ── Helpers ROMIA inline (idénticos al validar-cruce)
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
  const ensure = (vin) => {
    let a = accs.get(vin);
    if (!a) {
      a = { vin, bodega, fCompraMarca: null, fIngresoBodega: null, fSolicitudBodega: null, fPlanificacionFisica: null, fSalidaFisica: null, fLlegadaPatio: null, tieneSinSalida: false, estadoBodega: null, patio: null, puntoEntrega: null, cumplimientoDespacho: null };
      accs.set(vin, a);
    }
    return a;
  };
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
console.log("  VALIDACIÓN — Vista Histórica vs cruce (mismos selectores que la UI)");
console.log("══════════════════════════════════════════════════════════════════════════════════");
const t0 = Date.now();

// Pipeline
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

// Fingerprint global (= "Modo validación" en la UI)
const fp = fingerprintGlobal(cruce);
console.log("");
console.log("  Fingerprint global (sin filtros — debe igualar la UI con Modo validación ON):");
console.log(`    totalFilas:       ${fp.totalFilas}`);
console.log(`    ventaIdsUnicos:   ${fp.ventaIdsUnicos}`);
console.log(`    vinsUnicos:       ${fp.vinsUnicos}`);
console.log(`    cuello:`);
for (const c of fp.cuello) console.log(`      ${c.cuello.padEnd(28)} ${c.cantidad}`);
console.log(`    calidadCierre:`);
for (const [k, v] of Object.entries(fp.calidadCierre)) console.log(`      ${k.padEnd(15)} ${v}`);
console.log(`    velocidadBucket:`);
for (const [k, v] of Object.entries(fp.velocidadBucket)) console.log(`      ${k.padEnd(15)} ${v}`);
console.log(`    cumplimientoBanda:`);
for (const [k, v] of Object.entries(fp.cumplimientoBanda)) console.log(`      ${k.padEnd(15)} ${v}`);

// Agregados eje 1
console.log("");
console.log("  Eje 1 — Velocidad (universo total):");
const e1 = agregadosEje1(cruce.filas);
console.log(`    Total casos: ${e1.totalCasos}`);
console.log(`    Días totales: prom=${e1.diasTotales.promedio} · mediana=${e1.diasTotales.mediana} · p90=${e1.diasTotales.p90} · n=${e1.diasTotales.nConDatos}`);

// Agregados eje 2
console.log("");
console.log("  Eje 2 — Cumplimiento (universo total):");
const e2 = agregadosEje2(cruce.filas);
console.log(`    Universo: ${e2.global.universo}`);
console.log(`    Entregados: ${e2.global.entregados} · No: ${e2.global.noEntregados}`);
console.log(`    Sin patente recibida (entregados): ${e2.global.entregadosSinPatenteRecibida}`);
console.log(`    Sin autorización: ${e2.global.entregadosSinAutorizacion} · Sin solicitud: ${e2.global.entregadosSinSolicitudEntrega}`);
console.log(`    Top 3 sucursales:`);
for (const s of e2.porSucursal.slice(0, 3)) {
  console.log(`      ${s.sucursal.padEnd(35)} u=${String(s.universo).padStart(5)} ent=${String(s.entregados).padStart(5)} sinPat=${String(s.entregadosSinPatenteRecibida).padStart(4)}`);
}

// Agregados eje 3
console.log("");
console.log("  Eje 3 — Calidad de Cierre (universo total):");
const e3 = agregadosEje3(cruce.filas);
console.log(`    correcto:      ${e3.distribucion.correcto}`);
console.log(`    huerfano:      ${e3.distribucion.huerfano}`);
console.log(`    inconsistente: ${e3.distribucion.inconsistente}`);
console.log(`    no_evaluable:  ${e3.distribucion.no_evaluable}`);
console.log(`    Huérfanos por tipo:`);
for (const [k, v] of Object.entries(e3.huerfanosPorTipo)) console.log(`      ${k.padEnd(10)} ${v}`);
console.log(`    Inconsistentes por conflicto material:`);
for (const [k, v] of Object.entries(e3.inconsistentesPorConflicto)) if (v > 0) console.log(`      ${k.padEnd(45)} ${v}`);

// Smoke filtros
console.log("");
console.log("  Smoke test filtros: marca=PEUGEOT");
const fPeugeot = filtrarFilas(cruce, { ...FILTROS_VACIOS, marca: "PEUGEOT" });
console.log(`    Filas filtradas: ${fPeugeot.length}`);
const e1Peu = agregadosEje1(fPeugeot);
console.log(`    Cuello top 3: ${e1Peu.distribucionCuello.slice(0, 3).map((d) => `${d.cuello}=${d.cantidad}`).join(" · ")}`);

// Caso VR3KAHPY3VS000844
console.log("");
console.log("  Caso VR3KAHPY3VS000844 (verificable en Modo validación de la UI):");
const foco = cruce.byVin.get("VR3KAHPY3VS000844")?.[0];
if (!foco) {
  console.log("    ❌ VIN no encontrado.");
  process.exit(1);
}
console.log(`    ventaId: ${foco.ventaId}`);
console.log(`    cuelloPrincipal: ${foco.cuelloPrincipal}`);
console.log(`    fListoParaEntrega: ${foco.fListoParaEntrega?.toISOString().slice(0, 10)}`);
console.log(`    diasLogistica/CtrlNeg: ${foco.diasLogistica}/${foco.diasControlNegocio}`);
console.log(`    ejeCalidadCierre: ${foco.ejeCalidadCierre ?? "no_evaluable"}`);

const op = extraerOpciones(cruce);
console.log("");
console.log(`  Opciones de filtros: ${op.marcas.length} marcas · ${op.sucursales.length} sucursales · ${op.vendedores.length} vendedores`);

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════════");
console.log(`  Tiempo total: ${Date.now() - t0} ms`);
console.log("  Estos números son los que la UI debe mostrar al cargar los mismos archivos.");
console.log("══════════════════════════════════════════════════════════════════════════════════");
