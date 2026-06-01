#!/usr/bin/env node
/**
 * REDEFINIR "documentación lista" sin depender de fPatenteRecibida.
 *
 * Información operacional validada:
 *   - fecha_patente_recibida es OPCIONAL (algunos locales la cargan, otros no).
 *   - La señal obligatoria es "acta de entrega cargada" (entrega_auto_txt = "Cargado")
 *     que implica todo el proceso documental completo.
 *
 * Candidatos a "fDocListo" alternativos:
 *   1) fPatenteEnviada       — administración envía patente a sucursal
 *   2) fPatenteAdmin         — patente vuelve a administración Pompeyo desde RC
 *   3) fInscripcion          — inscripción en Registro Civil completada
 *   4) Consolidada (COALESCE) — primera fecha que exista entre las 4
 *
 * Análisis ofrecido:
 *   A) Cobertura individual de cada fecha en TODO el universo
 *   B) Cobertura individual en los 863 "Sin info" actuales
 *   C) Cuántos casos se salvan con cada fallback
 *   D) Aplicar regla nueva al universo completo y comparar distribución
 *   E) Impacto en delta físico vs documental: ¿cambia la mediana?
 *
 * Sólo lectura sobre CSV. Sin código.
 */
import fs from "node:fs";
import path from "node:path";

const CSV = path.join("diag", "output", "historico-consolidado.csv");
const raw = fs.readFileSync(CSV, "utf-8");
const lines = raw.split("\n").filter((l) => l.length > 0);
const header = lines[0].split(",");

function parseCSVLine(line) {
  const out = [];
  let cur = "", inQ = false;
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
function pct(arr, p) { return arr[Math.floor(arr.length * p)]; }

// Enriquecer todos los casos
const casos = rows.map((r) => ({
  ...r,
  fSolicitud: toD(r.fSolicitud),
  fSalidaFisica: toD(r.fSalidaFisica),
  fETAPromesa: toD(r.fETASucursalPromesa),
  fFactura: toD(r.fFactura),
  fSolicitudInscripcion: toD(r.fSolicitudInscripcion),
  fInscripcion: toD(r.fInscripcion),
  fPatenteAdmin: toD(r.fPatenteAdmin),
  fPatenteEnviada: toD(r.fPatenteEnviada),
  fPatenteRecibida: toD(r.fPatenteRecibida),
  fEntregaReal: toD(r.fEntregaReal),
  entregado: r.entregado === "true",
  tieneSinSalida: r.tieneSinSalida === "true",
  enActas: r.enActas === "true",
}));

const N = casos.length;
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  REDEFINICIÓN DEL CIERRE DOCUMENTAL");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log(`  Total casos en CSV: ${N}`);
console.log("");

// ─────────────────────────────────────────────────────────────────────────────
// A) Cobertura individual de cada fecha documental
// ─────────────────────────────────────────────────────────────────────────────

const candidatos = [
  { key: "fPatenteRecibida", label: "patente recibida en sucursal" },
  { key: "fPatenteEnviada",  label: "patente enviada admin → sucursal" },
  { key: "fPatenteAdmin",    label: "patente vuelve a administración" },
  { key: "fInscripcion",     label: "inscripción RC completada" },
  { key: "fSolicitudInscripcion", label: "solicitud de inscripción" },
];

console.log("──────────────────────────────────────────────────────────────────────────────");
console.log("  A) Cobertura individual de cada candidato (TODO el universo)");
console.log("──────────────────────────────────────────────────────────────────────────────");
for (const c of candidatos) {
  const n = casos.filter((x) => x[c.key]).length;
  const p = (n / N * 100).toFixed(1);
  const bar = "█".repeat(Math.round(n / N * 40));
  console.log(`    ${c.key.padEnd(24)} ${String(n).padStart(5)}/${N}  ${p.padStart(5)}%  ${bar}  (${c.label})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// B) Cobertura individual en los 863 "Sin info" actuales
// ─────────────────────────────────────────────────────────────────────────────

// Reaplica la regla nueva para identificar los 863
function fListoRegla(c, fDocListoFn) {
  const fFisicoListo = c.fSalidaFisica ?? c.fETAPromesa;
  const fDocListo = fDocListoFn(c);
  if (fFisicoListo && fDocListo) return fFisicoListo > fDocListo ? fFisicoListo : fDocListo;
  return null;
}
function clasificarConFn(c, fDocListoFn) {
  const fFisicoListo = c.fSalidaFisica ?? c.fETAPromesa;
  const fDocListo = fDocListoFn(c);
  const fListo = fListoRegla(c, fDocListoFn);
  const delta = days(fDocListo, fFisicoListo);
  const espera = fListo && c.fEntregaReal ? days(fListo, c.fEntregaReal) : null;
  const aut = String(c.autorizacionEntrega ?? "").trim();
  const sol = String(c.solEntrega ?? "").trim();
  const UMBRAL_EMPATE = 2, UMBRAL_RETIRO = 14;

  // Anuladas tienen su propia categoría (no caen a "Sin info" por anulación)
  if (c.estado_ROMA === "Anulada") return "Anulada";

  if (c.entregado) {
    if (espera != null && espera > UMBRAL_RETIRO) return "Cliente demoró retiro";
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

const fnSolo = (key) => (c) => c[key];
const fnCoalesce = (keys) => (c) => {
  for (const k of keys) if (c[k]) return c[k];
  return null;
};

// 1. Estado base: regla actual sólo con fPatenteRecibida
const base = casos.map((c) => clasificarConFn(c, fnSolo("fPatenteRecibida")));
const baseSinInfo = casos.filter((_, i) => base[i] === "Sin información suficiente");

console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────");
console.log("  B) Cobertura en los casos 'Sin información suficiente' (base actual)");
console.log("──────────────────────────────────────────────────────────────────────────────");
console.log(`     Universo de análisis: ${baseSinInfo.length} casos sin clasificar`);
console.log("");
console.log(`     Cobertura de cada candidato dentro de los ${baseSinInfo.length}:`);
for (const c of candidatos) {
  const n = baseSinInfo.filter((x) => x[c.key]).length;
  const p = (n / baseSinInfo.length * 100).toFixed(1);
  const bar = "█".repeat(Math.round(n / baseSinInfo.length * 40));
  console.log(`       ${c.key.padEnd(24)} ${String(n).padStart(4)}/${baseSinInfo.length}  ${p.padStart(5)}%  ${bar}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// C) Cuántos casos se salvan con cada fallback (sobre los 863)
// ─────────────────────────────────────────────────────────────────────────────

const fallbacks = [
  { label: "Solo fPatenteRecibida (regla actual)",          fn: fnSolo("fPatenteRecibida") },
  { label: "fPatenteRecibida ?? fPatenteEnviada",            fn: fnCoalesce(["fPatenteRecibida", "fPatenteEnviada"]) },
  { label: "fPatenteRecibida ?? fPatenteAdmin",              fn: fnCoalesce(["fPatenteRecibida", "fPatenteAdmin"]) },
  { label: "fPatenteRecibida ?? fInscripcion",               fn: fnCoalesce(["fPatenteRecibida", "fInscripcion"]) },
  { label: "Recibida ?? Enviada ?? Admin ?? Inscripcion",    fn: fnCoalesce(["fPatenteRecibida", "fPatenteEnviada", "fPatenteAdmin", "fInscripcion"]) },
  { label: "Recibida ?? Enviada ?? Admin ?? Inscripcion ?? SolInscripcion", fn: fnCoalesce(["fPatenteRecibida", "fPatenteEnviada", "fPatenteAdmin", "fInscripcion", "fSolicitudInscripcion"]) },
];

console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────");
console.log("  C) Cuántos de los 863 se rescatarían con cada fallback");
console.log("──────────────────────────────────────────────────────────────────────────────");
for (const fb of fallbacks) {
  const rescatados = baseSinInfo.filter((c) => fb.fn(c)).length;
  const p = (rescatados / baseSinInfo.length * 100).toFixed(1);
  console.log(`    ${fb.label.padEnd(60)} ${String(rescatados).padStart(4)} (${p.padStart(5)}%)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// D) Aplicar regla nueva (COALESCE 4) sobre TODO el universo
// ─────────────────────────────────────────────────────────────────────────────

const fnNueva = fnCoalesce(["fPatenteRecibida", "fPatenteEnviada", "fPatenteAdmin", "fInscripcion"]);
const nueva = casos.map((c) => clasificarConFn(c, fnNueva));

const distBase = new Map();
for (const cat of base) distBase.set(cat, (distBase.get(cat) ?? 0) + 1);
const distNueva = new Map();
for (const cat of nueva) distNueva.set(cat, (distNueva.get(cat) ?? 0) + 1);

console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────");
console.log("  D) Distribución global ANTES vs DESPUÉS (regla COALESCE con 4 candidatos)");
console.log("──────────────────────────────────────────────────────────────────────────────");
console.log("");
console.log("    ANTES (sólo fPatenteRecibida):");
for (const [k, v] of [...distBase.entries()].sort((a, b) => b[1] - a[1])) {
  const p = (v / N * 100).toFixed(1);
  const bar = "█".repeat(Math.round(v / N * 30));
  console.log(`       ${k.padEnd(32)} ${String(v).padStart(5)} (${p.padStart(5)}%)  ${bar}`);
}
console.log("");
console.log("    DESPUÉS (COALESCE Recibida ?? Enviada ?? Admin ?? Inscripcion):");
for (const [k, v] of [...distNueva.entries()].sort((a, b) => b[1] - a[1])) {
  const p = (v / N * 100).toFixed(1);
  const bar = "█".repeat(Math.round(v / N * 30));
  console.log(`       ${k.padEnd(32)} ${String(v).padStart(5)} (${p.padStart(5)}%)  ${bar}`);
}

// Delta por categoría
console.log("");
console.log("    DELTA por categoría:");
const cats = new Set([...distBase.keys(), ...distNueva.keys()]);
for (const k of cats) {
  const b = distBase.get(k) ?? 0;
  const n = distNueva.get(k) ?? 0;
  const d = n - b;
  const sign = d > 0 ? "+" : (d < 0 ? "" : " ");
  console.log(`       ${k.padEnd(32)} ${String(b).padStart(5)} → ${String(n).padStart(5)}   ${sign}${d}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// E) Impacto en delta físico vs documental — ¿la mediana cambia?
// ─────────────────────────────────────────────────────────────────────────────

console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────");
console.log("  E) Impacto en el delta físico − documental");
console.log("──────────────────────────────────────────────────────────────────────────────");

function deltasCon(fn) {
  const arr = [];
  for (const c of casos) {
    const fFis = c.fSalidaFisica ?? c.fETAPromesa;
    const fDoc = fn(c);
    if (fFis && fDoc) arr.push(days(fDoc, fFis));
  }
  arr.sort((a, b) => a - b);
  return arr;
}
const deltasA = deltasCon(fnSolo("fPatenteRecibida"));
const deltasN = deltasCon(fnNueva);

console.log(`    ANTES (sólo fPatenteRecibida)         n=${deltasA.length}  min=${deltasA[0]}  p25=${pct(deltasA,0.25)}  mediana=${pct(deltasA,0.5)}  p75=${pct(deltasA,0.75)}  p90=${pct(deltasA,0.9)}  max=${deltasA[deltasA.length-1]}`);
console.log(`    DESPUÉS (COALESCE 4 candidatos)       n=${deltasN.length}  min=${deltasN[0]}  p25=${pct(deltasN,0.25)}  mediana=${pct(deltasN,0.5)}  p75=${pct(deltasN,0.75)}  p90=${pct(deltasN,0.9)}  max=${deltasN[deltasN.length-1]}`);

// Histograma comparativo (buckets)
console.log("");
const buckets = [
  { label: "≤ -15 doc MUCHO después", test: (d) => d <= -15 },
  { label: "-14 a -8",                 test: (d) => d >= -14 && d <= -8 },
  { label: "-7 a -3",                  test: (d) => d >= -7 && d <= -3 },
  { label: "-2 a -1",                  test: (d) => d >= -2 && d <= -1 },
  { label: " 0 empate",                test: (d) => d === 0 },
  { label: "+1 a +2",                  test: (d) => d >= 1 && d <= 2 },
  { label: "+3 a +7",                  test: (d) => d >= 3 && d <= 7 },
  { label: "+8 a +14",                 test: (d) => d >= 8 && d <= 14 },
  { label: "≥ +15 fis MUCHO después",  test: (d) => d >= 15 },
];
console.log("    Histograma comparativo (% del total):");
console.log(`      ${"Bucket".padEnd(28)} ${"Antes".padStart(8)}  ${"Después".padStart(8)}`);
for (const b of buckets) {
  const a = deltasA.filter(b.test).length;
  const n = deltasN.filter(b.test).length;
  const ap = (a / deltasA.length * 100).toFixed(1);
  const np = (n / deltasN.length * 100).toFixed(1);
  console.log(`      ${b.label.padEnd(28)} ${String(a).padStart(5)} ${ap.padStart(5)}%  ${String(n).padStart(5)} ${np.padStart(5)}%`);
}

// ─────────────────────────────────────────────────────────────────────────────
// F) Validar contra entrega real
//    Si la nueva fDocListo es buena proxy de "documentación lista",
//    debe estar siempre ≤ fEntregaReal (no se puede entregar antes que esté lista)
// ─────────────────────────────────────────────────────────────────────────────

console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────");
console.log("  F) Validación: ¿fDocListo es siempre ≤ fEntregaReal?");
console.log("──────────────────────────────────────────────────────────────────────────────");
function violationsCon(fn) {
  let n = 0, viol = 0;
  for (const c of casos) {
    if (!c.entregado || !c.fEntregaReal) continue;
    const fDoc = fn(c);
    if (!fDoc) continue;
    n++;
    if (fDoc > c.fEntregaReal) viol++;
  }
  return { n, viol, pct: n > 0 ? (viol / n * 100).toFixed(2) : "0" };
}
for (const fb of fallbacks) {
  const v = violationsCon(fb.fn);
  console.log(`    ${fb.label.padEnd(60)} ${v.viol}/${v.n} (${v.pct}%) anomalías (fDoc > fEntrega)`);
}
console.log("");
console.log("    Una proxy buena no debería tener anomalías > 1%.");

// ─────────────────────────────────────────────────────────────────────────────
// G) Subconjunto: entregados que aún caen en "Sin información"
// ─────────────────────────────────────────────────────────────────────────────

const sinInfoNueva = casos.filter((_, i) => nueva[i] === "Sin información suficiente");
console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────");
console.log("  G) Casos que SIGUEN siendo 'Sin información suficiente' con la regla nueva");
console.log("──────────────────────────────────────────────────────────────────────────────");
console.log(`    Cantidad: ${sinInfoNueva.length}`);
const entregadosResiduo = sinInfoNueva.filter((c) => c.entregado).length;
const noEntregadosResiduo = sinInfoNueva.filter((c) => !c.entregado).length;
console.log(`    Entregados: ${entregadosResiduo}    No entregados: ${noEntregadosResiduo}`);
if (sinInfoNueva.length > 0 && sinInfoNueva.length <= 30) {
  console.log("");
  console.log("    Ejemplos (todos):");
  for (const c of sinInfoNueva.slice(0, 20)) {
    console.log(`      ${c.ventaId} · ${c.marca?.padEnd(10) ?? ""} · entregado=${c.entregado} · estado=${c.estado_ROMA}`);
    console.log(`        fSal=${c.fSalidaFisica?.toISOString().slice(0,10) ?? "—"}  fETA=${c.fETAPromesa?.toISOString().slice(0,10) ?? "—"}  fPatRec=${c.fPatenteRecibida?.toISOString().slice(0,10) ?? "—"}  fPatEnv=${c.fPatenteEnviada?.toISOString().slice(0,10) ?? "—"}  fInsc=${c.fInscripcion?.toISOString().slice(0,10) ?? "—"}`);
  }
}

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  RESUMEN");
console.log("══════════════════════════════════════════════════════════════════════════════");
const baseSI = distBase.get("Sin información suficiente") ?? 0;
const nuevaSI = distNueva.get("Sin información suficiente") ?? 0;
const rescate = baseSI - nuevaSI;
console.log(`  'Sin información' baja de ${baseSI} → ${nuevaSI}  (rescatados: ${rescate}, ${(rescate/baseSI*100).toFixed(1)}% del bucket)`);
console.log(`  Mediana del delta: ANTES ${pct(deltasA,0.5)}d  DESPUÉS ${pct(deltasN,0.5)}d`);
console.log("");
