#!/usr/bin/env node
/**
 * AUDITORÍA — CASOS HUÉRFANOS (calidad de cierre operacional).
 *
 * Definición operacional aprobada:
 *   - Proceso aparentemente terminado o avanzado
 *   - Señales operacionales inconsistentes
 *   - Cierre administrativo incompleto
 *
 * Dos subtipos identificables desde los datos:
 *
 *   TIPO 1 · "Probable entrega no registrada"
 *     - entregado = false (Actas dice "No Cargado")
 *     - ambas líneas LISTAS (fSalidaFisica y fInscripcion)
 *     - sol_entrega/autorizacion_entrega vacíos o "No"
 *     - antigüedad desde fSolicitud > 60 días
 *     - Estado ROMA en cualquier estado (queda colgado o cerrado en ROMA)
 *
 *   TIPO 2 · "Entregado con cierre inconsistente"
 *     - entregado = true (acta cargada en Actas)
 *     - PERO al menos una de:
 *         · Estado ROMA = Pendiente (debería estar Realizada)
 *         · sol_entrega o autorizacion_entrega vacíos
 *         · falta fInscripcion (debería existir si hay entrega)
 *
 * Reportes:
 *   - Conteos por tipo
 *   - Ranking sucursal (Top 20)
 *   - Ranking marca
 *   - Ranking vendedor (responsable)
 *   - Impacto monetario (suma valorFactura)
 *   - Antigüedad de los huérfanos
 *   - Patrones temporales (mes de solicitud)
 *
 * Lectura sobre CSV + Actas para vendedor. Sin código de producción.
 */
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

// ── Cargar CSV consolidado ──────────────────────────────────────────────────
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

// ── Cargar Actas para vendedor ──────────────────────────────────────────────
const BASE = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive";
const wb = XLSX.readFile(`${BASE}/Actas al 28 de Mayo.xlsx`, { cellDates: true });
const actasRows = XLSX.utils.sheet_to_json(wb.Sheets["ROMA"], { defval: null, raw: true });
const vendedorPorVin = new Map();
const clientePorVin = new Map();
for (const r of actasRows) {
  const vin = r["Vin"] ? String(r["Vin"]).trim().toUpperCase() : null;
  if (!vin) continue;
  vendedorPorVin.set(vin, r["Nombre_Vendedor"] ?? null);
  clientePorVin.set(vin, r["Nombre_Cliente"] ?? null);
}

// ── Enriquecer ──────────────────────────────────────────────────────────────
const FECHA_CORTE = new Date(2026, 4, 29);
const casos = rows.map((r) => {
  const vin = r.vin;
  return {
    ...r,
    fSolicitud: toD(r.fSolicitud),
    fSalidaFisica: toD(r.fSalidaFisica),
    fETAPromesa: toD(r.fETASucursalPromesa),
    fFactura: toD(r.fFactura),
    fSolicitudInscripcion: toD(r.fSolicitudInscripcion),
    fInscripcion: toD(r.fInscripcion),
    fPatenteRecibida: toD(r.fPatenteRecibida),
    fEntregaReal: toD(r.fEntregaReal),
    entregado: r.entregado === "true",
    tieneSinSalida: r.tieneSinSalida === "true",
    valorFactura: Number(r.valorFactura ?? 0),
    vendedor: vendedorPorVin.get(vin) ?? null,
    cliente: clientePorVin.get(vin) ?? null,
  };
});

// ── Clasificar huérfanos ────────────────────────────────────────────────────
function clasificarHuerfano(c) {
  const fFisicoListo = c.fSalidaFisica ?? c.fETAPromesa;
  const fDocListo = c.fPatenteRecibida ?? c.fInscripcion;
  const sol = String(c.solEntrega ?? "").trim();
  const aut = String(c.autorizacionEntrega ?? "").trim();
  const ambosVaciosONo = (sol === "" || sol === "No") && (aut === "" || aut === "No");
  const diasDesdeSol = c.fSolicitud ? days(c.fSolicitud, FECHA_CORTE) : null;

  // TIPO 1 — No entregado pero parece estar terminado físicamente y documentalmente
  if (!c.entregado && fFisicoListo && fDocListo && ambosVaciosONo && diasDesdeSol != null && diasDesdeSol > 60) {
    return { huerfano: true, tipo: "T1 · probable entrega no registrada", diasDesdeSol };
  }
  // TIPO 2 — Entregado con cierre inconsistente
  if (c.entregado) {
    const inconsistencias = [];
    if (c.estado_ROMA === "Pendiente") inconsistencias.push("ROMA Pendiente pese a entrega");
    if (sol === "" || sol === "No") inconsistencias.push("sol_entrega no cargada");
    if (aut === "" || aut === "No") inconsistencias.push("autorizacion_entrega no cargada");
    if (!c.fInscripcion) inconsistencias.push("falta fInscripcion en Actas");
    // Considerar huérfano si tiene al menos 2 inconsistencias (alta señal)
    if (inconsistencias.length >= 2) {
      return { huerfano: true, tipo: "T2 · entregado con cierre inconsistente", motivos: inconsistencias, diasDesdeSol };
    }
  }
  return { huerfano: false };
}

for (const c of casos) {
  const h = clasificarHuerfano(c);
  c._huerfano = h.huerfano;
  c._tipo = h.tipo ?? null;
  c._motivos = h.motivos ?? null;
  c._diasDesdeSol = h.diasDesdeSol ?? null;
}

const huerfanos = casos.filter((c) => c._huerfano);
const T1 = huerfanos.filter((c) => c._tipo.startsWith("T1"));
const T2 = huerfanos.filter((c) => c._tipo.startsWith("T2"));

console.log("══════════════════════════════════════════════════════════════════════════════════════════");
console.log("  AUDITORÍA — Casos huérfanos");
console.log("══════════════════════════════════════════════════════════════════════════════════════════");
console.log(`  Universo total:        ${casos.length}`);
console.log(`  Casos huérfanos:       ${huerfanos.length}  (${(huerfanos.length / casos.length * 100).toFixed(1)}%)`);
console.log(`    Tipo 1 (no registrada): ${T1.length}  (${(T1.length / casos.length * 100).toFixed(1)}%)`);
console.log(`    Tipo 2 (cierre incons): ${T2.length}  (${(T2.length / casos.length * 100).toFixed(1)}%)`);
console.log("");

// ── Impacto monetario ───────────────────────────────────────────────────────
const sumVal = (arr) => arr.reduce((acc, c) => acc + (c.valorFactura || 0), 0);
const valT1 = sumVal(T1);
const valT2 = sumVal(T2);
const valTotal = sumVal(huerfanos);
const valUniverso = sumVal(casos);
function fmtCLP(n) { return "$ " + Math.round(n / 1_000_000).toLocaleString("es-CL") + " MM"; }

console.log("──────────────────────────────────────────────────────────────────────────────────────────");
console.log("  IMPACTO MONETARIO (valor factura)");
console.log("──────────────────────────────────────────────────────────────────────────────────────────");
console.log(`  Total huérfanos:      ${fmtCLP(valTotal).padStart(18)}   (${(valTotal / valUniverso * 100).toFixed(1)}% del universo)`);
console.log(`    Tipo 1:             ${fmtCLP(valT1).padStart(18)}   monto en ruta abierto sin registro`);
console.log(`    Tipo 2:             ${fmtCLP(valT2).padStart(18)}   entregados con datos incompletos`);

// ── Rankings ────────────────────────────────────────────────────────────────
function rankear(arr, keyFn, label) {
  const m = new Map();
  for (const c of arr) {
    const k = keyFn(c) || "(sin valor)";
    if (!m.has(k)) m.set(k, { n: 0, val: 0 });
    const x = m.get(k);
    x.n++;
    x.val += c.valorFactura || 0;
  }
  return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
}

function printRanking(rank, label, top) {
  console.log("");
  console.log("──────────────────────────────────────────────────────────────────────────────────────────");
  console.log(`  ${label} — TOP ${top}`);
  console.log("──────────────────────────────────────────────────────────────────────────────────────────");
  console.log(`  ${"Nombre".padEnd(45)} ${"Casos".padStart(6)} ${"Monto".padStart(14)}`);
  console.log("  " + "─".repeat(75));
  for (const [k, x] of rank.slice(0, top)) {
    console.log(`  ${(k || "(vacío)").slice(0, 45).padEnd(45)} ${String(x.n).padStart(6)} ${fmtCLP(x.val).padStart(14)}`);
  }
}

const rankSucursal = rankear(huerfanos, (c) => c.sucursal, "Sucursal");
const rankMarca = rankear(huerfanos, (c) => c.marca, "Marca");
const rankVendedor = rankear(huerfanos, (c) => c.vendedor, "Vendedor");
const rankGerencia = rankear(huerfanos, (c) => c.gerencia, "Gerencia");

printRanking(rankSucursal, "Ranking SUCURSAL (todos los huérfanos)", 20);
printRanking(rankMarca, "Ranking MARCA", 15);
printRanking(rankGerencia, "Ranking GERENCIA", 15);
printRanking(rankVendedor, "Ranking VENDEDOR / Responsable", 25);

// ── Concentración: % de sucursales que concentran el 80% ────────────────────
function concentracion(rank, label) {
  const total = rank.reduce((a, [_, x]) => a + x.n, 0);
  let acum = 0; let n80 = 0;
  for (const [_, x] of rank) {
    acum += x.n;
    n80++;
    if (acum / total >= 0.80) break;
  }
  console.log(`    ${label}: ${n80} de ${rank.length} concentran el 80% (${(n80 / rank.length * 100).toFixed(1)}%)`);
}
console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────────────────");
console.log("  CONCENTRACIÓN — ¿Cuántos pocos hacen el 80%?");
console.log("──────────────────────────────────────────────────────────────────────────────────────────");
concentracion(rankSucursal, "Sucursales");
concentracion(rankMarca, "Marcas");
concentracion(rankVendedor, "Vendedores");
concentracion(rankGerencia, "Gerencias");

// ── Patrón temporal ─────────────────────────────────────────────────────────
console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────────────────");
console.log("  PATRÓN TEMPORAL (mes de FechaSolicitud de los huérfanos)");
console.log("──────────────────────────────────────────────────────────────────────────────────────────");
function mesKey(d) { return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : "null"; }
const porMes = new Map();
for (const c of huerfanos) {
  const k = mesKey(c.fSolicitud);
  porMes.set(k, (porMes.get(k) ?? 0) + 1);
}
for (const [k, n] of [...porMes.entries()].sort()) {
  const pct = (n / huerfanos.length * 100).toFixed(1);
  const bar = "█".repeat(Math.round(n / huerfanos.length * 40));
  console.log(`    ${k}  ${String(n).padStart(4)} (${pct.padStart(5)}%)  ${bar}`);
}

// ── Antigüedad ──────────────────────────────────────────────────────────────
console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────────────────");
console.log("  ANTIGÜEDAD desde FechaSolicitud (al 29-05-2026)");
console.log("──────────────────────────────────────────────────────────────────────────────────────────");
const buckets = { "≤30d": 0, "31-60d": 0, "61-90d": 0, "91-120d": 0, "121-150d": 0, ">150d": 0, "sin fecha": 0 };
for (const c of huerfanos) {
  if (!c.fSolicitud) { buckets["sin fecha"]++; continue; }
  const d = c._diasDesdeSol;
  if (d <= 30) buckets["≤30d"]++;
  else if (d <= 60) buckets["31-60d"]++;
  else if (d <= 90) buckets["61-90d"]++;
  else if (d <= 120) buckets["91-120d"]++;
  else if (d <= 150) buckets["121-150d"]++;
  else buckets[">150d"]++;
}
for (const [k, v] of Object.entries(buckets)) {
  const pct = (v / huerfanos.length * 100).toFixed(1);
  const bar = "█".repeat(Math.round(v / huerfanos.length * 40));
  console.log(`    ${k.padEnd(12)} ${String(v).padStart(4)} (${pct.padStart(5)}%)  ${bar}`);
}

// ── Análisis por tipo (T2: distribución de inconsistencias) ─────────────────
console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────────────────");
console.log("  TIPO 2 — distribución de inconsistencias específicas");
console.log("──────────────────────────────────────────────────────────────────────────────────────────");
const motivos = new Map();
for (const c of T2) {
  for (const m of c._motivos) {
    motivos.set(m, (motivos.get(m) ?? 0) + 1);
  }
}
for (const [m, n] of [...motivos.entries()].sort((a, b) => b[1] - a[1])) {
  const pct = (n / T2.length * 100).toFixed(1);
  console.log(`    ${m.padEnd(40)} ${String(n).padStart(4)} (${pct}% de T2)`);
}

// ── Patrón sistemático: ¿alguna sucursal/marca con tasa anormal? ────────────
console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────────────────");
console.log("  TASA DE HUERFANDAD por sucursal (% de huérfanos sobre total de la sucursal)");
console.log("──────────────────────────────────────────────────────────────────────────────────────────");
const totalPorSuc = new Map();
for (const c of casos) totalPorSuc.set(c.sucursal, (totalPorSuc.get(c.sucursal) ?? 0) + 1);
const tasaSuc = [...totalPorSuc.entries()]
  .filter(([_, total]) => total >= 30)  // sucursales con al menos 30 casos
  .map(([s, total]) => {
    const h = rankSucursal.find(([k]) => k === s);
    const n = h ? h[1].n : 0;
    return { sucursal: s, total, huerfanos: n, tasa: n / total * 100 };
  })
  .sort((a, b) => b.tasa - a.tasa);
console.log(`  ${"Sucursal".padEnd(40)} ${"Total".padStart(7)} ${"Huérfanos".padStart(10)} ${"Tasa%".padStart(7)}`);
console.log("  " + "─".repeat(70));
for (const x of tasaSuc.slice(0, 20)) {
  console.log(`  ${x.sucursal.padEnd(40)} ${String(x.total).padStart(7)} ${String(x.huerfanos).padStart(10)} ${x.tasa.toFixed(1).padStart(6)}%`);
}

// ── Exportar CSV de huérfanos ───────────────────────────────────────────────
const outPath = path.join("diag", "output", "casos-huerfanos.csv");
const cols = ["ventaId","vin","marca","sucursal","gerencia","vendedor","cliente","valorFactura","estado_ROMA","pasoActual_ROMA","entregado","fSolicitud","fSalidaFisica","fInscripcion","fPatenteRecibida","fEntregaReal","solEntrega","autorizacionEntrega","tipo","motivos","diasDesdeSol"];
const out = [cols.join(",")];
for (const c of huerfanos) {
  out.push(cols.map((k) => {
    let v;
    if (k === "tipo") v = c._tipo;
    else if (k === "motivos") v = c._motivos ? c._motivos.join("|") : "";
    else if (k === "diasDesdeSol") v = c._diasDesdeSol;
    else v = c[k];
    if (v == null) return "";
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(","));
}
fs.writeFileSync(outPath, out.join("\n"));
console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────────────────");
console.log(`  CSV exportado: ${outPath}  (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
console.log("──────────────────────────────────────────────────────────────────────────────────────────");
