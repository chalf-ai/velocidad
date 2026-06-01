#!/usr/bin/env node
/**
 * Muestra aleatoria de 20 casos clasificados como "Comercial demoró inicio"
 * bajo la regla aprobada:  fDocListo = fPatenteRecibida ?? fInscripcion
 *
 * Para cada caso enriquece con comentario de ROMA (último mes donde aparece).
 *
 * Seed fijo para reproducibilidad. Solo lectura.
 */
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

// ── Cargar CSV ───────────────────────────────────────────────────────────────
const CSV = path.join("diag", "output", "historico-consolidado.csv");
const raw = fs.readFileSync(CSV, "utf-8");
const lines = raw.split("\n").filter((l) => l.length > 0);
const header = lines[0].split(",");
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
const rows = lines.slice(1).map((l) => {
  const arr = parseCSVLine(l);
  const o = {};
  header.forEach((h, i) => { o[h] = arr[i] ?? ""; });
  return o;
});

function toD(s) { return s ? new Date(s) : null; }
function days(a, b) { return (a && b) ? Math.round((b.getTime() - a.getTime()) / 86400000) : null; }

// ── Aplicar regla nueva: fDocListo = fPatenteRecibida ?? fInscripcion ────────
const casos = rows.map((r) => ({
  ...r,
  fSolicitud: toD(r.fSolicitud),
  fSalidaFisica: toD(r.fSalidaFisica),
  fETAPromesa: toD(r.fETASucursalPromesa),
  fFactura: toD(r.fFactura),
  fSolicitudInscripcion: toD(r.fSolicitudInscripcion),
  fInscripcion: toD(r.fInscripcion),
  fPatenteRecibida: toD(r.fPatenteRecibida),
  fPatenteEnviada: toD(r.fPatenteEnviada),
  fEntregaReal: toD(r.fEntregaReal),
  entregado: r.entregado === "true",
  tieneSinSalida: r.tieneSinSalida === "true",
  enActas: r.enActas === "true",
}));

function clasificar(c) {
  const fFisicoListo = c.fSalidaFisica ?? c.fETAPromesa;
  const fDocListo = c.fPatenteRecibida ?? c.fInscripcion;
  const fListo = (fFisicoListo && fDocListo)
    ? (fFisicoListo > fDocListo ? fFisicoListo : fDocListo)
    : null;
  const delta = days(fDocListo, fFisicoListo);
  const espera = fListo && c.fEntregaReal ? days(fListo, c.fEntregaReal) : null;
  const aut = String(c.autorizacionEntrega ?? "").trim();
  const sol = String(c.solEntrega ?? "").trim();

  if (c.estado_ROMA === "Anulada") return "Anulada";
  if (c.entregado) {
    if (espera != null && espera > 14) return "Cliente demoró retiro";
    if (delta == null) return "Sin información suficiente";
    if (delta >= 3) return "Logística llegó última";
    if (delta <= -3) return "Control de Negocio llegó último";
    return "Empate real";
  }
  if (c.tieneSinSalida) return "Logística llegó última";
  if (!fDocListo) return "Control de Negocio llegó último";
  if (fFisicoListo && fDocListo) {
    if (aut !== "Si" || sol !== "Si") return "Comercial demoró inicio";
    return "Cliente demoró retiro";
  }
  if (!fFisicoListo) return "Logística llegó última";
  return "Sin información suficiente";
}

for (const c of casos) c._nuevaClass = clasificar(c);

const comercial = casos.filter((c) => c._nuevaClass === "Comercial demoró inicio");
console.log(`Universo "Comercial demoró inicio": ${comercial.length}`);

// ── Seed determinístico (Mulberry32) ──────────────────────────────────────────
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260529); // seed fijo basado en fecha de hoy

// Shuffle determinístico
const shuffled = [...comercial];
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}
const muestra = shuffled.slice(0, 20);

// ── Enriquecer con comentario de ROMA (buscar en archivos originales) ────────
const BASE = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive";
const ROMA_FILES = [
  { mes: "2026-05", path: `${BASE}/Log Roma 29-05-2026 .xlsx` },
  { mes: "2026-04", path: `${BASE}/Log Abril.xlsx` },
  { mes: "2026-03", path: `${BASE}/LOG Marzo.xlsx` },
  { mes: "2026-02", path: `${BASE}/Log Febrero.xlsx` },
  { mes: "2026-01", path: `${BASE}/LOG Enero.xlsx` },
];

// Cargar comentarios por VentaID (último archivo que lo trae)
const comentariosPorVenta = new Map();
const pasoPorVenta = new Map();
for (const f of ROMA_FILES) {
  const wb = XLSX.readFile(f.path, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["ROMA"], { defval: null, raw: true });
  for (const r of rows) {
    const vid = r["VentaID"] != null ? Number(r["VentaID"]) : null;
    if (vid == null) continue;
    if (!comentariosPorVenta.has(vid)) {
      comentariosPorVenta.set(vid, { mes: f.mes, comentario: r["Comentario"], paso: r["PasoActual"], estado: r["Estado"] });
    }
  }
}

// ── Imprimir muestra detallada ───────────────────────────────────────────────
const fmt = (d) => d ? d.toISOString().slice(0, 10) : "—";

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════════════════");
console.log(`  MUESTRA ALEATORIA · ${muestra.length} casos de "Comercial demoró inicio" (seed 20260529)`);
console.log("══════════════════════════════════════════════════════════════════════════════════════════");

let i = 0;
for (const c of muestra) {
  i++;
  const ext = comentariosPorVenta.get(Number(c.ventaId)) ?? {};
  const fFisicoListo = c.fSalidaFisica ?? c.fETAPromesa;
  const fDocListo = c.fPatenteRecibida ?? c.fInscripcion;
  const docFuente = c.fPatenteRecibida ? "patente_recibida" : c.fInscripcion ? "inscripcion" : "—";
  const diasDesdeListo = fFisicoListo && fDocListo
    ? days((fFisicoListo > fDocListo ? fFisicoListo : fDocListo), new Date(2026, 4, 29))
    : null;

  console.log("");
  console.log(`──────────────────────────────────────────────────────────────────────────────────────────`);
  console.log(`  ${String(i).padStart(2)}/20  VentaID ${c.ventaId}  ·  VIN ${c.vin}`);
  console.log(`──────────────────────────────────────────────────────────────────────────────────────────`);
  console.log(`  Marca/Modelo : ${c.marca ?? "—"} ${c.modelo ?? ""}`);
  console.log(`  Sucursal     : ${c.sucursal ?? "—"}`);
  console.log(`  Estado ROMA  : ${c.estado_ROMA ?? "—"}    PasoActual: ${c.pasoActual_ROMA ?? "—"}`);
  console.log(``);
  console.log(`  Línea Comercial (ROMA):`);
  console.log(`    fSolicitud           : ${fmt(c.fSolicitud)}`);
  console.log(`    Estado ROMA viva     : ${ext.estado ?? "—"}   (último mes presente: ${ext.mes ?? "—"})`);
  console.log(``);
  console.log(`  Línea Física (KAR/SCHIAPP):`);
  console.log(`    fSalidaFisica        : ${fmt(c.fSalidaFisica)}`);
  console.log(`    fETAPromesa          : ${fmt(c.fETAPromesa)}`);
  console.log(`    tieneSinSalida       : ${c.tieneSinSalida}`);
  console.log(``);
  console.log(`  Línea Documental (Actas):`);
  console.log(`    fFactura             : ${fmt(c.fFactura)}`);
  console.log(`    fSolicitudInscripcion: ${fmt(c.fSolicitudInscripcion)}`);
  console.log(`    fInscripcion         : ${fmt(c.fInscripcion)}`);
  console.log(`    fPatenteRecibida     : ${fmt(c.fPatenteRecibida)}`);
  console.log(`    fPatenteEnviada      : ${fmt(c.fPatenteEnviada)}`);
  console.log(`    fDocListo (regla)    : ${fmt(fDocListo)}  ← desde "${docFuente}"`);
  console.log(``);
  console.log(`  Señales operacionales clave:`);
  console.log(`    sol_entrega          : ${c.solEntrega ?? "—"}`);
  console.log(`    autorizacion_entrega : ${c.autorizacionEntrega ?? "—"}`);
  console.log(`    entregado            : ${c.entregado}`);
  console.log(`    fEntregaReal         : ${fmt(c.fEntregaReal)}`);
  console.log(``);
  console.log(`  Comentario ROMA (último mes):`);
  console.log(`    ${(ext.comentario ?? "(sin comentario)").toString().slice(0, 140)}`);
  if (diasDesdeListo != null) {
    console.log(``);
    console.log(`  Días desde "listo para entrega" hasta corte (29-05-2026): ${diasDesdeListo}`);
  }
}

// ── Resumen agregado del bucket completo ─────────────────────────────────────
console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════════════════");
console.log(`  PERFIL AGREGADO del bucket completo (${comercial.length} casos)`);
console.log("══════════════════════════════════════════════════════════════════════════════════════════");

const conSol = comercial.filter((c) => c.solEntrega === "Si").length;
const sinSol = comercial.filter((c) => c.solEntrega !== "Si").length;
const conAut = comercial.filter((c) => c.autorizacionEntrega === "Si").length;
const sinAut = comercial.filter((c) => c.autorizacionEntrega !== "Si").length;
const ambasSi = comercial.filter((c) => c.solEntrega === "Si" && c.autorizacionEntrega === "Si").length;
const solSiAutNo = comercial.filter((c) => c.solEntrega === "Si" && c.autorizacionEntrega !== "Si").length;
const solNoAutSi = comercial.filter((c) => c.solEntrega !== "Si" && c.autorizacionEntrega === "Si").length;
const ambasNo = comercial.filter((c) => c.solEntrega !== "Si" && c.autorizacionEntrega !== "Si").length;

console.log("");
console.log("  Distribución sol_entrega:");
console.log(`    Si:           ${conSol}  (${(conSol / comercial.length * 100).toFixed(1)}%)`);
console.log(`    No / vacío:   ${sinSol}  (${(sinSol / comercial.length * 100).toFixed(1)}%)`);
console.log("");
console.log("  Distribución autorizacion_entrega:");
console.log(`    Si:           ${conAut}  (${(conAut / comercial.length * 100).toFixed(1)}%)`);
console.log(`    No / vacío:   ${sinAut}  (${(sinAut / comercial.length * 100).toFixed(1)}%)`);
console.log("");
console.log("  Matriz combinada (sol_entrega × autorizacion_entrega):");
console.log(`    Si × Si:     ${ambasSi}  ← contradicción, no deberían estar acá`);
console.log(`    Si × No:     ${solSiAutNo}`);
console.log(`    No × Si:     ${solNoAutSi}`);
console.log(`    No × No:     ${ambasNo}`);

// Por Estado ROMA
const porEstadoROMA = new Map();
for (const c of comercial) {
  porEstadoROMA.set(c.estado_ROMA, (porEstadoROMA.get(c.estado_ROMA) ?? 0) + 1);
}
console.log("");
console.log("  Distribución por Estado ROMA:");
for (const [k, v] of [...porEstadoROMA.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${(k || "(vacío)").padEnd(20)} ${String(v).padStart(4)} (${(v / comercial.length * 100).toFixed(1)}%)`);
}

// Por PasoActual
const porPaso = new Map();
for (const c of comercial) {
  porPaso.set(c.pasoActual_ROMA, (porPaso.get(c.pasoActual_ROMA) ?? 0) + 1);
}
console.log("");
console.log("  Distribución por PasoActual ROMA:");
for (const [k, v] of [...porPaso.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${(k || "(vacío)").padEnd(45)} ${String(v).padStart(4)} (${(v / comercial.length * 100).toFixed(1)}%)`);
}

// Por antigüedad desde solicitud
const hoy = new Date(2026, 4, 29);
const porAntiguedad = { "≤30d": 0, "31-60d": 0, "61-90d": 0, "91-120d": 0, ">120d": 0, "sin fecha": 0 };
for (const c of comercial) {
  if (!c.fSolicitud) { porAntiguedad["sin fecha"]++; continue; }
  const d = days(c.fSolicitud, hoy);
  if (d <= 30) porAntiguedad["≤30d"]++;
  else if (d <= 60) porAntiguedad["31-60d"]++;
  else if (d <= 90) porAntiguedad["61-90d"]++;
  else if (d <= 120) porAntiguedad["91-120d"]++;
  else porAntiguedad[">120d"]++;
}
console.log("");
console.log("  Antigüedad desde FechaSolicitud (al 29-05-2026):");
for (const [k, v] of Object.entries(porAntiguedad)) {
  console.log(`    ${k.padEnd(15)} ${String(v).padStart(4)} (${(v / comercial.length * 100).toFixed(1)}%)`);
}

// Por marca
const porMarca = new Map();
for (const c of comercial) porMarca.set(c.marca, (porMarca.get(c.marca) ?? 0) + 1);
console.log("");
console.log("  Top marcas:");
for (const [m, n] of [...porMarca.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`    ${(m || "(sin marca)").padEnd(15)} ${String(n).padStart(4)}`);
}

// Por sucursal top
const porSuc = new Map();
for (const c of comercial) porSuc.set(c.sucursal, (porSuc.get(c.sucursal) ?? 0) + 1);
console.log("");
console.log("  Top 10 sucursales:");
for (const [s, n] of [...porSuc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`    ${(s || "(sin sucursal)").padEnd(35)} ${String(n).padStart(4)}`);
}

// Fuente del fDocListo
const fuenteDoc = { recibida: 0, inscripcion: 0, ninguno: 0 };
for (const c of comercial) {
  if (c.fPatenteRecibida) fuenteDoc.recibida++;
  else if (c.fInscripcion) fuenteDoc.inscripcion++;
  else fuenteDoc.ninguno++;
}
console.log("");
console.log("  Fuente del fDocListo en este bucket:");
console.log(`    fPatenteRecibida: ${fuenteDoc.recibida}  (${(fuenteDoc.recibida / comercial.length * 100).toFixed(1)}%)`);
console.log(`    fInscripcion:     ${fuenteDoc.inscripcion}  (${(fuenteDoc.inscripcion / comercial.length * 100).toFixed(1)}%)`);
console.log(`    (ninguno):        ${fuenteDoc.ninguno}`);
