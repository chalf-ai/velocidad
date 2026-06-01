#!/usr/bin/env node
/**
 * VALIDACIÓN — Cruce ROMA × Actas × ROMIA vs historico-consolidado.csv.
 *
 * Pasos:
 *  1. Compila histórico TS a /tmp.
 *  2. Parsea 5 cortes ROMA → HistoricoRoma.
 *  3. Parsea 1 corte Actas → HistoricoActas.
 *  4. Construye un snapshot ROMIA mínimo desde SCHIAPP+KAR (lectura directa
 *     de las hojas Distribución/Entradas/Salidas/Almacenamiento) — replica
 *     la lógica de diag/consolidar-historico.mjs sin tocar el store ni el
 *     parser productivo.
 *  5. Ejecuta cruzarRomaActas.
 *  6. Cruza campo por campo contra historico-consolidado.csv:
 *     - VentaID, VIN, marca, sucursal, gerencia, fSolicitud, fFactura,
 *       fInscripcion, fPatenteRecibida, fListoParaEntrega, fEntregaReal,
 *       entregado, cuelloPrincipal.
 *  7. Verifica caso VR3KAHPY3VS000844 contra valores cableados del CSV.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
const CSV_REFERENCIA = path.join(PROJECT_ROOT, "diag", "output", "historico-consolidado.csv");

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
  const cfgPath = "/tmp/historico-tests-tsconfig-cruce.json";
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

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════════");
console.log("  VALIDACIÓN — Cruce ROMA × Actas × ROMIA vs CSV de referencia");
console.log("══════════════════════════════════════════════════════════════════════════════════");

const t0 = Date.now();

// ── Helpers de parsing inline (solo para construir snapshot ROMIA, no toca store)
function toDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "number") {
    if (v === 0) return null;
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return Number.isFinite(d.getTime()) ? d : null;
  }
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
function vinKey(v) {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  return s.length >= 11 ? s : null;
}
function rowsOf(ws) { return XLSX.utils.sheet_to_json(ws, { defval: null, raw: true }); }
function esSinSalida(v) { return v != null && String(v).trim().toUpperCase() === "SIN SALIDA"; }

function cargarRomiaUno(file, bodega) {
  const wb = XLSX.readFile(file, { cellDates: true });
  const accs = new Map();
  const ensure = (vin) => {
    let a = accs.get(vin);
    if (!a) {
      a = {
        vin, bodega,
        fCompraMarca: null,
        fIngresoBodega: null,
        fSolicitudBodega: null,
        fPlanificacionFisica: null,
        fSalidaFisica: null,
        fLlegadaPatio: null,
        tieneSinSalida: false,
        estadoBodega: null,
        patio: null,
        puntoEntrega: null,
        cumplimientoDespacho: null,
      };
      accs.set(vin, a);
    }
    return a;
  };
  const hAlm = wb.SheetNames.find((n) => /^almacenamiento\s*$/i.test(n));
  const hDist = wb.SheetNames.find((n) => /^distribuci[oó]n\s*$/i.test(n));
  const hEnt = wb.SheetNames.find((n) => /^entradas\s*$/i.test(n));
  const hSal = wb.SheetNames.find((n) => /^salidas\s*$/i.test(n));

  if (hAlm) for (const r of rowsOf(wb.Sheets[hAlm])) {
    const vin = vinKey(r["VIN"]); if (!vin) continue;
    const a = ensure(vin);
    a.fIngresoBodega = a.fIngresoBodega ?? toDate(r["1° dia Almacenaje en bodega"]);
    a.estadoBodega = a.estadoBodega ?? nz(r["Disponible en bodega"]) ?? nz(r["Estado Kar"]) ?? nz(r["Estado Kar "]);
    a.fCompraMarca = a.fCompraMarca ?? toDate(r["Fecha compra marca"] ?? r["Fecha Compra marca"]);
  }
  if (hDist) for (const r of rowsOf(wb.Sheets[hDist])) {
    const vin = vinKey(r["VIN"]); if (!vin) continue;
    const a = ensure(vin);
    a.fCompraMarca = a.fCompraMarca ?? toDate(r["Fecha compra marca"] ?? r["Fecha Compra Marca"]);
    a.fIngresoBodega = a.fIngresoBodega ?? toDate(r["1° dia Almacenaje en bodega"] ?? r["1° dia Almacenaje"]);
    const fSol = toDate(r["Fecha de solicitud"]) ?? toDate(r["Fecha  Solicitud"]) ?? toDate(r["Fecha Solicitud"]);
    a.fSolicitudBodega = a.fSolicitudBodega ?? fSol;
    a.fPlanificacionFisica = a.fPlanificacionFisica ?? toDate(r["Fecha teorica STLI"]);
    const desp = r["Fecha despacho a sucursal"];
    if (esSinSalida(desp)) a.tieneSinSalida = true;
    else a.fSalidaFisica = a.fSalidaFisica ?? toDate(desp);
    a.cumplimientoDespacho = a.cumplimientoDespacho ?? nz(r["Cumplimiento despacho"]) ?? nz(r["Cumplimiento fecha limite"]);
  }
  if (hEnt) for (const r of rowsOf(wb.Sheets[hEnt])) {
    const vin = vinKey(r["VIN"]); if (!vin) continue;
    const a = ensure(vin);
    a.fLlegadaPatio = a.fLlegadaPatio ?? toDate(r["Fecha Ent"] ?? r["Fecha Entrada"]);
    a.estadoBodega = a.estadoBodega ?? nz(r["Estado"]) ?? nz(r["Estado Gp Simplificado"]);
    a.patio = a.patio ?? nz(r["Patio"]) ?? nz(r["Zona"]);
    a.puntoEntrega = a.puntoEntrega ?? nz(r["Punto de Entrega"]) ?? nz(r["Destino"]);
  }
  if (hSal) for (const r of rowsOf(wb.Sheets[hSal])) {
    const vin = vinKey(r["VIN"]); if (!vin) continue;
    const a = ensure(vin);
    const fSal = toDate(r["Fecha Sal"] ?? r["Fecha Salida"]);
    if (fSal && (!a.fSalidaFisica || fSal > a.fSalidaFisica)) a.fSalidaFisica = fSal;
  }
  return accs;
}

function construirSnapshotRomia(schiapp, kar) {
  const porVin = new Map();
  const allVins = new Set([...schiapp.keys(), ...kar.keys()]);
  for (const vin of allVins) {
    const k = kar.get(vin);
    const s = schiapp.get(vin);
    if (k && s) {
      const merged = { ...k };
      for (const key of Object.keys(s)) {
        if (merged[key] == null && s[key] != null) merged[key] = s[key];
      }
      if (s.tieneSinSalida) merged.tieneSinSalida = true;
      merged.bodega = `${k.bodega}+${s.bodega}`;
      porVin.set(vin, merged);
    } else if (k) porVin.set(vin, k);
    else if (s) porVin.set(vin, s);
  }
  return { porVin, meta: { archivoSchiapp: path.basename(SCHIAPP_FILE), archivoKar: path.basename(KAR_FILE), fechaCarga: new Date() } };
}

// ── 1) Parseo ROMA + aplicación
console.log("");
console.log("  Parseo + consolidación ROMA:");
const cortesRoma = [];
for (const f of ROMA_FILES) {
  const buf = await fs.readFile(f.path);
  const corte = parseRomaMensualBuffer(new Uint8Array(buf), path.basename(f.path), buf.byteLength);
  cortesRoma.push(corte);
  console.log(`    ${f.mes}  ${corte.corte.id} · ${corte.filas.length} filas`);
}
const h0Roma = crearHistoricoVacio();
const tRoma0 = Date.now();
const { historicoFinal: historicoRoma } = aplicarCortesRoma(h0Roma, cortesRoma);
console.log(`    Consolidación: ${Date.now() - tRoma0} ms · ${historicoRoma.entradas.size} VentaIDs únicos`);

// ── 2) Parseo Actas + aplicación
console.log("");
console.log("  Parseo + consolidación Actas:");
const bufActas = await fs.readFile(ACTAS_FILE);
const corteActas = parseActasBuffer(new Uint8Array(bufActas), path.basename(ACTAS_FILE), bufActas.byteLength);
console.log(`    Actas: ${corteActas.filas.length} filas`);
const h0Actas = crearHistoricoActasVacio();
const tActas0 = Date.now();
const rActas = aplicarCorteActas(h0Actas, corteActas);
const historicoActas = rActas.historico;
console.log(`    Consolidación: ${Date.now() - tActas0} ms · ${historicoActas.entradas.size} VINs`);

// ── 3) Construir snapshot ROMIA
console.log("");
console.log("  Snapshot ROMIA (SCHIAPP+KAR):");
const schiapp = cargarRomiaUno(SCHIAPP_FILE, "SCHIAPP");
const kar = cargarRomiaUno(KAR_FILE, "KAR");
console.log(`    SCHIAPP: ${schiapp.size} VINs · KAR: ${kar.size} VINs`);
const romiaSnapshot = construirSnapshotRomia(schiapp, kar);
console.log(`    Total ROMIA: ${romiaSnapshot.porVin.size} VINs`);

// ── 4) Ejecutar cruce
console.log("");
console.log("  Ejecutando cruce ROMA × Actas × ROMIA:");
const tCruce0 = Date.now();
const cruce = cruzarRomaActas({ historicoRoma, historicoActas, romiaSnapshot });
const tCruce1 = Date.now();
console.log(`    Tiempo: ${tCruce1 - tCruce0} ms · ${cruce.filas.length} filas consolidadas`);

// ── 5) Reporte global
const rep = cruce.reporte;
console.log("");
console.log("  Reporte global del cruce:");
console.log(`    Filas:                   ${rep.totales.filas}`);
console.log(`    VentaIDs únicos:         ${rep.totales.ventaIds}`);
console.log(`    VINs únicos:             ${rep.totales.vinsUnicos}`);
console.log(`    enActas:                 ${rep.totales.enActas}`);
console.log(`    enRomia:                 ${rep.totales.enRomia}`);
console.log(`    Entregados:              ${rep.totales.entregados}`);
console.log(`    Huérfanos actas-sin-roma: ${rep.totales.huerfanosActasSinRoma}`);
console.log(`    Huérfanos roma-sin-actas: ${rep.totales.huerfanosRomaSinActas}`);
console.log(`    VINs con multi-VentaID:  ${rep.totales.vinsConMultiplesVentaId}`);

console.log("");
console.log("  Distribución cuelloPrincipal:");
for (const d of rep.distribucionCuello) {
  console.log(`    ${d.cuello.padEnd(28)} ${String(d.cantidad).padStart(5)}  (${d.pct.toFixed(2)}%)`);
}

console.log("");
console.log("  Distribución ejeVelocidad:");
for (const [k, n] of Object.entries(rep.distribucionVelocidad)) {
  console.log(`    ${k.padEnd(12)} ${String(n).padStart(5)}`);
}

console.log("");
console.log("  Distribución ejeCumplimiento (banda):");
for (const [k, n] of Object.entries(rep.distribucionCumplimiento)) {
  console.log(`    ${k.padEnd(15)} ${String(n).padStart(5)}`);
}

console.log("");
console.log("  Distribución ejeCalidadCierre (sobre entregados):");
for (const [k, n] of Object.entries(rep.distribucionCalidadCierre)) {
  console.log(`    ${k.padEnd(15)} ${String(n).padStart(5)}`);
}

console.log("");
console.log(`  Conflictos materiales: ${rep.conflictosMateriales.total}`);
for (const [k, n] of Object.entries(rep.conflictosMateriales.porTipo)) {
  if (n > 0) console.log(`    ${k.padEnd(45)} ${String(n).padStart(5)}`);
}

// ── 6) Cruce campo por campo contra el CSV
console.log("");
console.log("  Match contra historico-consolidado.csv:");
const csvRaw = readFileSync(CSV_REFERENCIA, "utf-8");
const csvLines = csvRaw.split("\n").filter((l) => l.length > 0);
const header = csvLines[0].split(",");
const idx = (col) => header.indexOf(col);
const iVid = idx("ventaId");
const iVin = idx("vin");
const iMarca = idx("marca");
const iSucursal = idx("sucursal");
const iGerencia = idx("gerencia");
const iFSol = idx("fSolicitud");
const iFFac = idx("fFactura");
const iFIns = idx("fInscripcion");
const iFPat = idx("fPatenteRecibida");
const iFListo = idx("fListoParaEntrega");
const iFEnt = idx("fEntregaReal");
const iEntregado = idx("entregado");
const iCuello = idx("cuelloPrincipal");

const csvByVid = new Map();
for (let i = 1; i < csvLines.length; i++) {
  const cells = csvLines[i].split(",");
  const vid = Number(cells[iVid]);
  if (Number.isFinite(vid)) {
    csvByVid.set(vid, {
      vin: cells[iVin] ?? "",
      marca: cells[iMarca] ?? "",
      sucursal: cells[iSucursal] ?? "",
      gerencia: cells[iGerencia] ?? "",
      fSolicitud: cells[iFSol] || null,
      fFactura: cells[iFFac] || null,
      fInscripcion: cells[iFIns] || null,
      fPatenteRecibida: cells[iFPat] || null,
      fListoParaEntrega: cells[iFListo] || null,
      fEntregaReal: cells[iFEnt] || null,
      entregado: cells[iEntregado] === "true",
      cuelloPrincipal: cells[iCuello] || null,
    });
  }
}

function dayStr(d) {
  if (!d) return null;
  if (typeof d === "string") return d;
  // El CSV de referencia se construyó con `d.toISOString().slice(0, 10)` (UTC).
  // Para alinear comparaciones, usamos la misma convención aquí.
  return d.toISOString().slice(0, 10);
}

const stats = {
  ventaIds_en_ambos: 0,
  vid_en_csv_solo: 0,
  vid_en_cruce_solo: 0,
  vinOk: 0, vinMis: 0,
  marcaOk: 0, marcaMis: 0,
  sucursalOk: 0, sucursalMis: 0,
  gerenciaOk: 0, gerenciaMis: 0,
  fSolOk: 0, fSolMis: 0,
  fFacOk: 0, fFacMis: 0,
  fInsOk: 0, fInsMis: 0,
  fPatOk: 0, fPatMis: 0,
  fListoOk: 0, fListoMis: 0,
  fEntOk: 0, fEntMis: 0,
  entregadoOk: 0, entregadoMis: 0,
  cuelloOk: 0, cuelloMis: 0,
};

const cuelloDiff = new Map();

const ejemplosListoMis = [];

const cruceByVid = cruce.byVentaId;

for (const [vid, csv] of csvByVid) {
  const fila = cruceByVid.get(vid);
  if (!fila) {
    stats.vid_en_csv_solo++;
    continue;
  }
  stats.ventaIds_en_ambos++;

  if (fila.vin === csv.vin) stats.vinOk++; else stats.vinMis++;
  if ((fila.marca ?? "") === csv.marca) stats.marcaOk++; else stats.marcaMis++;
  if ((fila.sucursal ?? "") === csv.sucursal) stats.sucursalOk++; else stats.sucursalMis++;
  if ((fila.gerencia ?? "") === csv.gerencia) stats.gerenciaOk++; else stats.gerenciaMis++;

  const cmpDay = (a, b) => (a == null && b == null) || a === b;

  if (cmpDay(dayStr(fila.fSolicitud), csv.fSolicitud)) stats.fSolOk++; else stats.fSolMis++;
  if (cmpDay(dayStr(fila.fFactura), csv.fFactura)) stats.fFacOk++; else stats.fFacMis++;
  if (cmpDay(dayStr(fila.fInscripcion), csv.fInscripcion)) stats.fInsOk++; else stats.fInsMis++;
  if (cmpDay(dayStr(fila.fPatenteRecibida), csv.fPatenteRecibida)) stats.fPatOk++; else stats.fPatMis++;
  if (cmpDay(dayStr(fila.fListoParaEntrega), csv.fListoParaEntrega)) {
    stats.fListoOk++;
  } else {
    stats.fListoMis++;
    if (ejemplosListoMis.length < 5) {
      ejemplosListoMis.push({ vid, esp: csv.fListoParaEntrega, got: dayStr(fila.fListoParaEntrega) });
    }
  }
  if (cmpDay(dayStr(fila.fEntregaReal), csv.fEntregaReal)) stats.fEntOk++; else stats.fEntMis++;
  if (fila.entregado === csv.entregado) stats.entregadoOk++; else stats.entregadoMis++;

  if (fila.cuelloPrincipal === csv.cuelloPrincipal) {
    stats.cuelloOk++;
  } else {
    stats.cuelloMis++;
    const k = `${csv.cuelloPrincipal} → ${fila.cuelloPrincipal}`;
    cuelloDiff.set(k, (cuelloDiff.get(k) ?? 0) + 1);
  }
}

for (const vid of cruceByVid.keys()) {
  if (!csvByVid.has(vid)) stats.vid_en_cruce_solo++;
}

const total = stats.ventaIds_en_ambos;
console.log(`    VentaIDs en CSV:       ${csvByVid.size}`);
console.log(`    VentaIDs en cruce:     ${cruceByVid.size}`);
console.log(`    VentaIDs en ambos:     ${total}`);
console.log(`    Solo en CSV:           ${stats.vid_en_csv_solo}`);
console.log(`    Solo en cruce:         ${stats.vid_en_cruce_solo}`);

function row(field, ok, mis) {
  const pct = total > 0 ? ((ok / total) * 100).toFixed(2) : "0";
  const ok99 = ok / total >= 0.99;
  const tick = ok99 ? "✅" : "❌";
  return `    ${field.padEnd(28)} ${String(ok).padStart(5)}/${total}  (${pct}%)  ${tick} mismatches=${mis}`;
}
console.log("");
console.log("  Match por campo (granularidad día):");
console.log(row("VIN", stats.vinOk, stats.vinMis));
console.log(row("marca", stats.marcaOk, stats.marcaMis));
console.log(row("sucursal", stats.sucursalOk, stats.sucursalMis));
console.log(row("gerencia", stats.gerenciaOk, stats.gerenciaMis));
console.log(row("fSolicitud", stats.fSolOk, stats.fSolMis));
console.log(row("fFactura", stats.fFacOk, stats.fFacMis));
console.log(row("fInscripcion", stats.fInsOk, stats.fInsMis));
console.log(row("fPatenteRecibida", stats.fPatOk, stats.fPatMis));
console.log(row("fListoParaEntrega", stats.fListoOk, stats.fListoMis));
console.log(row("fEntregaReal", stats.fEntOk, stats.fEntMis));
console.log(row("entregado", stats.entregadoOk, stats.entregadoMis));
console.log(row("cuelloPrincipal", stats.cuelloOk, stats.cuelloMis));

if (cuelloDiff.size > 0) {
  console.log("");
  console.log("  Top cambios de cuelloPrincipal:");
  const top = [...cuelloDiff.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [k, n] of top) console.log(`    ${k.padEnd(50)} ${String(n).padStart(4)}`);
}

if (ejemplosListoMis.length > 0) {
  console.log("");
  console.log("  Ejemplos fListoParaEntrega mismatches:");
  for (const e of ejemplosListoMis) console.log(`    VentaID ${e.vid}  CSV=${e.esp}  cruce=${e.got}`);
}

// Debug rápido: fEntregaReal mismatches por categoría
console.log("");
console.log("  Análisis fEntregaReal mismatches:");
let mE1 = 0, mE2 = 0, mE3 = 0;
const ejF = [];
for (const [vid, csv] of csvByVid) {
  const fila = cruceByVid.get(vid);
  if (!fila) continue;
  const got = dayStr(fila.fEntregaReal);
  if (csv.fEntregaReal === got) continue;
  if (csv.fEntregaReal && !got) mE1++;
  else if (!csv.fEntregaReal && got) mE2++;
  else mE3++;
  if (ejF.length < 5) ejF.push({ vid, csv: csv.fEntregaReal, got, csvEnt: csv.entregado, cruceEnt: fila.entregado, fuenteEntrega: fila.fuenteEntrega });
}
console.log(`    csv tiene fecha, cruce null:           ${mE1}`);
console.log(`    csv null, cruce tiene fecha:           ${mE2}`);
console.log(`    ambos con fecha pero distintas:        ${mE3}`);
for (const e of ejF) console.log(`      VentaID ${e.vid}  csv=${e.csv}/${e.csvEnt}  cruce=${e.got}/${e.cruceEnt} fuente=${e.fuenteEntrega}`);

// ── 7) Caso VR3KAHPY3VS000844
console.log("");
console.log("  Caso VR3KAHPY3VS000844 (no-regresión):");
const VIN_FOCO = "VR3KAHPY3VS000844";
const focoFilas = cruce.byVin.get(VIN_FOCO) ?? [];
if (focoFilas.length === 0) {
  console.log("    ❌ VIN no encontrado en el cruce.");
  process.exit(1);
}
const foco = focoFilas[0];
const csvFoco = csvByVid.get(213357);

const checks = [
  ["ventaId", foco.ventaId, 213357],
  ["marca", foco.marca, csvFoco?.marca],
  ["sucursal", foco.sucursal, csvFoco?.sucursal],
  ["bodegaFisica", foco.bodegaFisica, "KAR"],
  ["tieneSinSalida", foco.tieneSinSalida, true],
  ["entregado", foco.entregado, false],
  ["fSolicitud", dayStr(foco.fSolicitud), "2026-04-27"],
  ["fFactura", dayStr(foco.fFactura), "2026-04-27"],
  ["fInscripcion", dayStr(foco.fInscripcion), "2026-04-27"],
  ["fPatenteRecibida", dayStr(foco.fPatenteRecibida), "2026-05-05"],
  ["fETASucursalPromesa", dayStr(foco.fETASucursalPromesa), "2026-05-29"],
  ["fListoParaEntrega", dayStr(foco.fListoParaEntrega), "2026-05-29"],
  ["diasLogistica", foco.diasLogistica, 32],
  ["diasControlNegocio", foco.diasControlNegocio, 8],
  ["cuelloPrincipal", foco.cuelloPrincipal, "Logística"],
];
let focoOk = 0;
for (const [k, got, esp] of checks) {
  const ok = (got == null && esp == null) || got === esp;
  console.log(`    ${ok ? "✅" : "❌"} ${k.padEnd(22)} got=${String(got).padEnd(20)} esp=${String(esp)}`);
  if (ok) focoOk++;
}

// ── Veredicto.
// Distinguimos campos "no-regresión" (identidad + fechas inmutables) de campos
// "diseño nuevo" donde sabemos que el cruce mejora reglas y diverge del CSV viejo.
const matchKeyFields = [
  stats.vinOk / total,
  stats.fSolOk / total,
  stats.fFacOk / total,
  stats.fInsOk / total,
  stats.fPatOk / total,
  stats.entregadoOk / total,
];
const allKeyOk = matchKeyFields.every((p) => p >= 0.99);
const cuelloPct = stats.cuelloOk / total;
const fListoPct = stats.fListoOk / total;
const fEntPct = stats.fEntOk / total;
const focoAllOk = focoOk === checks.length;

const tFin = Date.now();
console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════════");
console.log(`  Tiempo total: ${tFin - t0} ms`);
console.log("  No-regresión (≥99% esperado):");
console.log(`    Identidad + fechas inmutables:   ${allKeyOk ? "✅" : "❌"}`);
console.log(`    Caso VR3KAHPY3VS000844:          ${focoAllOk ? "✅" : "❌"}  (${focoOk}/${checks.length})`);
console.log("  Campos con diseño nuevo (divergencia esperada):");
console.log(`    fListoParaEntrega:               ${(fListoPct * 100).toFixed(2)}%  (nueva regla fDocListoDerivado)`);
console.log(`    fEntregaReal:                    ${(fEntPct * 100).toFixed(2)}%  (dedup por primer VIN)`);
console.log(`    cuelloPrincipal:                 ${(cuelloPct * 100).toFixed(2)}%  (knock-on de fListoParaEntrega)`);
console.log("══════════════════════════════════════════════════════════════════════════════════");
if (!allKeyOk || !focoAllOk) process.exit(1);
