#!/usr/bin/env node
/**
 * REFINAMIENTO de la clasificación de cuello principal.
 *
 * Trabaja sobre diag/output/historico-consolidado.csv (no toca código de app).
 *
 * Análisis solicitado:
 *   1. Casos clasificados como "Mixto" (2577 = 54%).
 *   2. Distribución de la diferencia entre:
 *        fecha físico listo (fSalidaFisica / fETASucursalPromesa)
 *        fecha documental lista (fPatenteRecibida)
 *   3. Quién llega último para cada caso.
 *   4. Proponer 5 categorías:
 *        - Logística llegó última
 *        - Control de Negocio llegó último
 *        - Cliente demoró retiro
 *        - Comercial demoró inicio
 *        - Empate real
 *
 * No implementar — solo diagnóstico y propuesta.
 */
import fs from "node:fs";
import path from "node:path";

const CSV = path.join("diag", "output", "historico-consolidado.csv");
const raw = fs.readFileSync(CSV, "utf-8");
const lines = raw.split("\n").filter((l) => l.length > 0);
const header = lines[0].split(",");

function parseCSVLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
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
function days(a, b) {
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PASO 1 — Construir señales por caso
// ─────────────────────────────────────────────────────────────────────────────

const casos = rows.map((r) => {
  const fSolicitud = toD(r.fSolicitud);
  const fSalidaFisica = toD(r.fSalidaFisica);
  const fETAPromesa = toD(r.fETASucursalPromesa);
  const fFactura = toD(r.fFactura);
  const fPatenteRecibida = toD(r.fPatenteRecibida);
  const fEntregaReal = toD(r.fEntregaReal);
  const tieneSinSalida = r.tieneSinSalida === "true";
  const entregado = r.entregado === "true";

  // Fecha física real: salida (mejor señal) o ETA si no hay salida
  const fFisicoListo = fSalidaFisica ?? fETAPromesa;
  const fDocListo = fPatenteRecibida;
  // Listo para entregar: max de ambos
  let fListo = null;
  if (fFisicoListo && fDocListo) {
    fListo = fFisicoListo > fDocListo ? fFisicoListo : fDocListo;
  }
  // Delta físico vs documental:
  //   positivo: físico llegó DESPUÉS → Logística es el cuello
  //   negativo: documental llegó DESPUÉS → Control es el cuello
  //   0: empate
  const deltaFisicoMenosDoc = days(fDocListo, fFisicoListo);
  const diasEspera = fListo && fEntregaReal ? days(fListo, fEntregaReal) : null;

  return {
    ventaId: r.ventaId,
    vin: r.vin,
    marca: r.marca,
    sucursal: r.sucursal,
    cuelloActual: r.cuelloPrincipal,
    fSolicitud, fSalidaFisica, fETAPromesa, fFactura, fPatenteRecibida, fEntregaReal,
    fFisicoListo, fDocListo, fListo,
    deltaFisicoMenosDoc,
    diasEspera,
    tieneSinSalida,
    entregado,
    autorizacionEntrega: r.autorizacionEntrega,
    solEntrega: r.solEntrega,
    diasLogistica: n(r.diasLogistica),
    diasControlNegocio: n(r.diasControlNegocio),
    diasTotales: n(r.diasTotales),
  };
});

console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  DIAGNÓSTICO — Refinamiento del cuello principal");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("");
console.log("  Total casos cargados: " + casos.length);
console.log("");

// ─────────────────────────────────────────────────────────────────────────────
// PASO 2 — Distribución de delta (físico vs documental) para todos los casos
// ─────────────────────────────────────────────────────────────────────────────

const conAmbas = casos.filter((c) => c.deltaFisicoMenosDoc != null);
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  PASO 1 — Distribución de delta (físico − documental)");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log(`  Casos con AMBAS fechas (físico Y documental): ${conAmbas.length} de ${casos.length}`);
console.log(`  Casos sin alguna: ${casos.length - conAmbas.length} (no clasificables aún)`);
console.log("");

const deltas = conAmbas.map((c) => c.deltaFisicoMenosDoc);
deltas.sort((a, b) => a - b);
function pct(arr, p) { return arr[Math.floor(arr.length * p)]; }
const p10 = pct(deltas, 0.10);
const p25 = pct(deltas, 0.25);
const p50 = pct(deltas, 0.50);
const p75 = pct(deltas, 0.75);
const p90 = pct(deltas, 0.90);

console.log("  Estadísticas del delta (en días):");
console.log(`    min: ${deltas[0]}    p10: ${p10}    p25: ${p25}    mediana: ${p50}    p75: ${p75}    p90: ${p90}    max: ${deltas[deltas.length - 1]}`);
console.log("");

// Histograma por buckets
const buckets = [
  { label: "≤ -15 (doc llegó MUCHO después)",      test: (d) => d <= -15 },
  { label: "-14 a -8 (doc llegó después)",         test: (d) => d >= -14 && d <= -8 },
  { label: "-7 a -3 (doc llegó algo después)",     test: (d) => d >= -7 && d <= -3 },
  { label: "-2 a -1 (doc 1-2 días después)",       test: (d) => d >= -2 && d <= -1 },
  { label: "0 (empate exacto)",                    test: (d) => d === 0 },
  { label: "+1 a +2 (físico 1-2 días después)",    test: (d) => d >= 1 && d <= 2 },
  { label: "+3 a +7 (físico algo después)",        test: (d) => d >= 3 && d <= 7 },
  { label: "+8 a +14 (físico llegó después)",      test: (d) => d >= 8 && d <= 14 },
  { label: "≥ +15 (físico MUCHO después)",         test: (d) => d >= 15 },
];
console.log("  Histograma de delta:");
for (const b of buckets) {
  const n = deltas.filter(b.test).length;
  const pctv = (n / deltas.length * 100).toFixed(1);
  const bar = "█".repeat(Math.round(n / deltas.length * 40));
  console.log(`    ${b.label.padEnd(40)} ${String(n).padStart(5)} (${pctv.padStart(5)}%)  ${bar}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PASO 3 — Análisis específico de los casos "Mixto"
// ─────────────────────────────────────────────────────────────────────────────

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  PASO 2 — Análisis de los casos 'Mixto'");
console.log("══════════════════════════════════════════════════════════════════════════════");

const mixtos = casos.filter((c) => c.cuelloActual === "Mixto");
console.log(`  Total Mixto: ${mixtos.length} (${(mixtos.length / casos.length * 100).toFixed(1)}%)`);
console.log("");

// Distribución de delta DENTRO de Mixto
const deltasMixto = mixtos.map((c) => c.deltaFisicoMenosDoc).filter((d) => d != null).sort((a, b) => a - b);
console.log("  Delta físico−documental en los Mixto:");
console.log(`    min: ${deltasMixto[0]}    p25: ${pct(deltasMixto, 0.25)}    mediana: ${pct(deltasMixto, 0.50)}    p75: ${pct(deltasMixto, 0.75)}    max: ${deltasMixto[deltasMixto.length - 1]}`);
console.log("");

console.log("  Histograma Mixto:");
for (const b of buckets) {
  const n = deltasMixto.filter(b.test).length;
  const pctv = (n / deltasMixto.length * 100).toFixed(1);
  const bar = "█".repeat(Math.round(n / deltasMixto.length * 40));
  console.log(`    ${b.label.padEnd(40)} ${String(n).padStart(5)} (${pctv.padStart(5)}%)  ${bar}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PASO 4 — Estado de entrega de los Mixto
// ─────────────────────────────────────────────────────────────────────────────

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  PASO 3 — Mixto vs Entrega real");
console.log("══════════════════════════════════════════════════════════════════════════════");

const mixtosEntregados = mixtos.filter((c) => c.entregado);
const mixtosNoEntregados = mixtos.filter((c) => !c.entregado);
const mixtosConEspera = mixtosEntregados.filter((c) => c.diasEspera != null);
const esperasOrdenadas = mixtosConEspera.map((c) => c.diasEspera).sort((a, b) => a - b);
console.log(`  Mixtos entregados:     ${mixtosEntregados.length} (${(mixtosEntregados.length / mixtos.length * 100).toFixed(1)}%)`);
console.log(`  Mixtos NO entregados:  ${mixtosNoEntregados.length} (${(mixtosNoEntregados.length / mixtos.length * 100).toFixed(1)}%)`);
console.log("");
if (esperasOrdenadas.length > 0) {
  console.log(`  Días de espera (listo → entrega real) en Mixtos entregados:`);
  console.log(`    min: ${esperasOrdenadas[0]}  p25: ${pct(esperasOrdenadas,0.25)}  mediana: ${pct(esperasOrdenadas,0.5)}  p75: ${pct(esperasOrdenadas,0.75)}  p90: ${pct(esperasOrdenadas,0.9)}  max: ${esperasOrdenadas[esperasOrdenadas.length-1]}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PASO 5 — Propuesta de reclasificación
// ─────────────────────────────────────────────────────────────────────────────

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  PASO 4 — Propuesta de reclasificación");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("");
console.log("  REGLA NUEVA (basada en evidencia del delta):");
console.log("");
console.log("    Caso ENTREGADO:");
console.log("      paso 1: ¿hubo espera larga retiro?");
console.log("         diasEspera > 14d  →  'Cliente demoró retiro'");
console.log("      paso 2: comparar delta físico vs documental");
console.log("         delta ≥ +3      →  'Logística llegó última'");
console.log("         delta ≤ -3      →  'Control de Negocio llegó último'");
console.log("         -2 ≤ delta ≤ +2 →  'Empate real'");
console.log("");
console.log("    Caso NO ENTREGADO:");
console.log("      tieneSinSalida=true       →  'Logística llegó última'");
console.log("      sin patente recibida      →  'Control de Negocio llegó último'");
console.log("      ambos listos + no entregado:");
console.log("        autorización=No O sol_entrega=No  →  'Comercial demoró inicio'");
console.log("        ambos = Si                          →  'Cliente demoró retiro'");
console.log("      sin ninguna señal clara   →  'Sin información suficiente'");
console.log("");

// Aplicar regla nueva
const UMBRAL_EMPATE = 2;       // días
const UMBRAL_RETIRO = 14;      // días para considerar "cliente demoró retiro"
const UMBRAL_LOGISTICA = 3;
const UMBRAL_CONTROL = 3;

function clasificarNueva(c) {
  if (c.entregado) {
    if (c.diasEspera != null && c.diasEspera > UMBRAL_RETIRO) {
      return "Cliente demoró retiro";
    }
    if (c.deltaFisicoMenosDoc == null) return "Sin información suficiente";
    if (c.deltaFisicoMenosDoc >= UMBRAL_LOGISTICA) return "Logística llegó última";
    if (c.deltaFisicoMenosDoc <= -UMBRAL_CONTROL) return "Control de Negocio llegó último";
    return "Empate real";
  }
  // NO entregado
  if (c.tieneSinSalida) return "Logística llegó última";
  if (!c.fDocListo) return "Control de Negocio llegó último";
  if (c.fFisicoListo && c.fDocListo) {
    const aut = String(c.autorizacionEntrega ?? "").trim();
    const sol = String(c.solEntrega ?? "").trim();
    if (aut !== "Si" || sol !== "Si") return "Comercial demoró inicio";
    return "Cliente demoró retiro";
  }
  if (!c.fFisicoListo) return "Logística llegó última";
  return "Sin información suficiente";
}

const nuevo = casos.map((c) => ({ ...c, nuevoCuello: clasificarNueva(c) }));

const distNueva = new Map();
for (const c of nuevo) {
  distNueva.set(c.nuevoCuello, (distNueva.get(c.nuevoCuello) ?? 0) + 1);
}
const distVieja = new Map();
for (const c of casos) {
  distVieja.set(c.cuelloActual, (distVieja.get(c.cuelloActual) ?? 0) + 1);
}

console.log("  COMPARATIVA ANTES vs DESPUÉS:");
console.log("");
console.log("    Clasificación VIEJA:");
for (const [k, v] of [...distVieja.entries()].sort((a, b) => b[1] - a[1])) {
  const pctv = (v / casos.length * 100).toFixed(1);
  const bar = "█".repeat(Math.round(v / casos.length * 30));
  console.log(`      ${k.padEnd(30)} ${String(v).padStart(5)} (${pctv.padStart(5)}%)  ${bar}`);
}
console.log("");
console.log("    Clasificación NUEVA:");
for (const [k, v] of [...distNueva.entries()].sort((a, b) => b[1] - a[1])) {
  const pctv = (v / casos.length * 100).toFixed(1);
  const bar = "█".repeat(Math.round(v / casos.length * 30));
  console.log(`      ${k.padEnd(30)} ${String(v).padStart(5)} (${pctv.padStart(5)}%)  ${bar}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PASO 6 — Cómo se redistribuyen los Mixto viejos
// ─────────────────────────────────────────────────────────────────────────────

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  PASO 5 — Cómo se redistribuyen los 2.577 Mixtos viejos");
console.log("══════════════════════════════════════════════════════════════════════════════");
const mixtosRedist = new Map();
for (const c of nuevo) {
  if (c.cuelloActual !== "Mixto") continue;
  mixtosRedist.set(c.nuevoCuello, (mixtosRedist.get(c.nuevoCuello) ?? 0) + 1);
}
const totMixto = [...mixtosRedist.values()].reduce((a, b) => a + b, 0);
for (const [k, v] of [...mixtosRedist.entries()].sort((a, b) => b[1] - a[1])) {
  const pctv = (v / totMixto * 100).toFixed(1);
  console.log(`    ${k.padEnd(32)} ${String(v).padStart(5)} (${pctv.padStart(5)}%)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PASO 7 — Sensibilidad de umbrales (mostrar 3 escenarios)
// ─────────────────────────────────────────────────────────────────────────────

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  PASO 6 — Sensibilidad de umbrales (empate)");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  ¿Qué pasa si cambiamos el umbral de empate?");
for (const umbral of [1, 2, 3, 5, 7]) {
  let logistica = 0, control = 0, empate = 0;
  for (const c of conAmbas) {
    if (c.deltaFisicoMenosDoc >= umbral + 1) logistica++;
    else if (c.deltaFisicoMenosDoc <= -(umbral + 1)) control++;
    else empate++;
  }
  console.log(`    Empate=±${umbral}d  →  Logística=${logistica} (${(logistica/conAmbas.length*100).toFixed(1)}%), Control=${control} (${(control/conAmbas.length*100).toFixed(1)}%), Empate=${empate} (${(empate/conAmbas.length*100).toFixed(1)}%)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PASO 8 — Mostrar 5 ejemplos representativos por categoría
// ─────────────────────────────────────────────────────────────────────────────

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  PASO 7 — Ejemplos representativos por categoría nueva");
console.log("══════════════════════════════════════════════════════════════════════════════");

const porCateg = new Map();
for (const c of nuevo) {
  if (!porCateg.has(c.nuevoCuello)) porCateg.set(c.nuevoCuello, []);
  porCateg.get(c.nuevoCuello).push(c);
}

for (const [k, arr] of porCateg) {
  console.log("");
  console.log(`  ── ${k} (${arr.length} casos) ──`);
  for (const c of arr.slice(0, 3)) {
    const fSal = c.fSalidaFisica?.toISOString().slice(0,10) ?? "—";
    const fPat = c.fPatenteRecibida?.toISOString().slice(0,10) ?? "—";
    const fEnt = c.fEntregaReal?.toISOString().slice(0,10) ?? "—";
    const delta = c.deltaFisicoMenosDoc != null ? c.deltaFisicoMenosDoc : "—";
    const espera = c.diasEspera != null ? c.diasEspera : "—";
    console.log(`    ${c.ventaId.padStart(7)} ${c.marca?.padEnd(10) ?? ""} ${(c.sucursal ?? "").slice(0,25).padEnd(25)} salida=${fSal} patente=${fPat} entrega=${fEnt} delta=${delta} espera=${espera}`);
  }
}

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  FIN");
console.log("══════════════════════════════════════════════════════════════════════════════");
