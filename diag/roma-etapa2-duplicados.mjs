#!/usr/bin/env node
/**
 * ETAPA 2 — Análisis de duplicados entre archivos consecutivos.
 *
 * Para cada par (A,B), (B,D), (D,C), (C,E) y el acumulado A→E:
 *  - VINs que se repiten
 *  - VINs que aparecen por primera vez
 *  - VINs que desaparecen
 *  - VentaIDs que se repiten
 *  - VentaIDs que cambian de estado entre archivos
 *  - VentaIDs que permanecen iguales
 *
 * Más: distribución de Estado para los que se repiten — clave para
 * descubrir si ROMA arrastra solo "Pendientes" o también cerrados.
 */
import XLSX from "xlsx";

const ARCHIVOS = [
  { alias: "A", mes: "Enero", path: "/Users/Daviid/Downloads/LOG Enero.xlsx" },
  { alias: "B", mes: "Febrero", path: "/Users/Daviid/Downloads/tmp-export-3-29-05-2026_334 (8).xlsx" },
  { alias: "D", mes: "Marzo", path: "/Users/Daviid/Downloads/tmp-export-3-29-05-2026_335 (10).xlsx" },
  { alias: "C", mes: "Abril", path: "/Users/Daviid/Downloads/tmp-export-3-29-05-2026_335 (23).xlsx" },
  { alias: "E", mes: "Mayo", path: "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Log Roma 29-05-2026 .xlsx" },
];

function load(path) {
  const wb = XLSX.readFile(path, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["ROMA"], { defval: null, raw: true });
  const byVenta = new Map();
  const byVin = new Map();
  for (const r of rows) {
    const venta = r["VentaID"] != null ? Number(r["VentaID"]) : null;
    const vin = r["Vin"] ? String(r["Vin"]).trim().toUpperCase() : null;
    const item = { venta, vin, estado: r["Estado"], paso: r["PasoActual"], comentario: r["Comentario"], raw: r };
    if (venta) byVenta.set(venta, item);
    if (vin) byVin.set(vin, item);
  }
  return { byVenta, byVin, total: rows.length };
}

const data = new Map();
for (const a of ARCHIVOS) data.set(a.alias, { ...a, ...load(a.path) });

// ── Pares consecutivos ──
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  ETAPA 2 — DUPLICADOS ENTRE ARCHIVOS CONSECUTIVOS");
console.log("══════════════════════════════════════════════════════════════════════════════");

const orden = ["A", "B", "D", "C", "E"];
for (let i = 0; i < orden.length - 1; i++) {
  const a = data.get(orden[i]);
  const b = data.get(orden[i + 1]);

  console.log(`\n── ${a.mes} (${a.alias}) → ${b.mes} (${b.alias}) ──`);

  // VIN
  const aVins = new Set(a.byVin.keys());
  const bVins = new Set(b.byVin.keys());
  const interV = new Set([...aVins].filter((v) => bVins.has(v)));
  const soloA = new Set([...aVins].filter((v) => !bVins.has(v)));
  const soloB = new Set([...bVins].filter((v) => !aVins.has(v)));
  console.log(`  VIN  · ${a.mes} tiene ${aVins.size}, ${b.mes} tiene ${bVins.size}`);
  console.log(`        comunes:           ${interV.size}  (${(interV.size / aVins.size * 100).toFixed(1)}% de ${a.mes})`);
  console.log(`        solo ${a.mes}:        ${soloA.size}  (desaparecieron de ${b.mes})`);
  console.log(`        nuevos en ${b.mes}:   ${soloB.size}  (no estaban en ${a.mes})`);

  // VentaID
  const aV = new Set(a.byVenta.keys());
  const bV = new Set(b.byVenta.keys());
  const interVT = new Set([...aV].filter((x) => bV.has(x)));
  console.log(`  VentaID comunes:        ${interVT.size}  (${(interVT.size / aV.size * 100).toFixed(1)}% de ${a.mes})`);

  // De los comunes, ¿cuántos cambian de estado vs permanecen?
  let mismoEstado = 0;
  let cambiaEstado = 0;
  let mismoPaso = 0;
  let cambiaPaso = 0;
  let detallesCambios = [];
  for (const vid of interVT) {
    const ra = a.byVenta.get(vid);
    const rb = b.byVenta.get(vid);
    if (ra.estado === rb.estado) mismoEstado++;
    else {
      cambiaEstado++;
      detallesCambios.push(`    ${vid}: ${ra.estado} → ${rb.estado}`);
    }
    if (ra.paso === rb.paso) mismoPaso++;
    else cambiaPaso++;
  }
  console.log(`        de los comunes:`);
  console.log(`           mismo Estado:    ${mismoEstado}  (${(mismoEstado / interVT.size * 100).toFixed(1)}%)`);
  console.log(`           cambia Estado:   ${cambiaEstado}  (${(cambiaEstado / interVT.size * 100).toFixed(1)}%)`);
  console.log(`           mismo PasoActual: ${mismoPaso}`);
  console.log(`           cambia PasoActual: ${cambiaPaso}`);

  // Distribución de Estado entre los comunes (en versión a)
  const estComA = new Map();
  for (const vid of interVT) {
    const e = a.byVenta.get(vid).estado;
    estComA.set(e, (estComA.get(e) ?? 0) + 1);
  }
  console.log(`        Estado en ${a.mes} de los que pasan a ${b.mes}:`);
  for (const [e, n] of estComA) console.log(`           ${e.padEnd(12)} ${n}`);

  // Distribución de Estado entre los QUE DESAPARECEN (solo en a, no en b)
  const estDesap = new Map();
  for (const vin of soloA) {
    const it = a.byVin.get(vin);
    estDesap.set(it.estado, (estDesap.get(it.estado) ?? 0) + 1);
  }
  console.log(`        Estado en ${a.mes} de los que DESAPARECEN en ${b.mes}:`);
  for (const [e, n] of estDesap) console.log(`           ${e.padEnd(12)} ${n}`);
}

// ── Acumulado enero → mayo ──
console.log("\n══════════════════════════════════════════════════════════════════════════════");
console.log("  ACUMULADO ENERO → MAYO (A ∪ B ∪ D ∪ C ∪ E por VentaID)");
console.log("══════════════════════════════════════════════════════════════════════════════");
const allVentas = new Map();  // ventaId → set de archivos en los que aparece
const ventaPaths = new Map(); // ventaId → array [archivo: item]
for (const o of orden) {
  const d = data.get(o);
  for (const [v, it] of d.byVenta) {
    if (!allVentas.has(v)) allVentas.set(v, new Set());
    allVentas.get(v).add(o);
    if (!ventaPaths.has(v)) ventaPaths.set(v, []);
    ventaPaths.get(v).push({ archivo: o, ...it });
  }
}
const totalVentas = allVentas.size;
const hist = new Map();
for (const archivosSet of allVentas.values()) {
  const k = archivosSet.size;
  hist.set(k, (hist.get(k) ?? 0) + 1);
}
console.log(`  Total VentaIDs únicos acumulados: ${totalVentas}`);
console.log(`  Distribución (cuántos archivos consecutivos cubren cada VentaID):`);
for (const k of [...hist.keys()].sort((a, b) => a - b)) {
  console.log(`    aparece en ${k} archivo${k > 1 ? "s" : ""}: ${hist.get(k)} VentaIDs`);
}

// VentaIDs que cambian de estado a través de la cadena (ej. Pendiente → Realizada)
let pendienteToFinal = 0;
let staysPendiente = 0;
let staysRealizada = 0;
let anulados = 0;
for (const [v, path] of ventaPaths) {
  if (path.length < 2) continue;
  const estados = path.map((p) => p.estado);
  const primerEstado = estados[0];
  const ultimoEstado = estados[estados.length - 1];
  if (primerEstado === "Pendiente" && (ultimoEstado === "Realizada" || ultimoEstado === "Anulada")) {
    pendienteToFinal++;
  }
  if (estados.every((e) => e === "Pendiente")) staysPendiente++;
  if (estados.every((e) => e === "Realizada")) staysRealizada++;
  if (ultimoEstado === "Anulada") anulados++;
}
console.log(`\n  De los VentaIDs que aparecen en ≥2 archivos:`);
console.log(`    Pendiente → Realizada/Anulada (caso completó ciclo): ${pendienteToFinal}`);
console.log(`    Siempre Pendiente (caso colgado):                     ${staysPendiente}`);
console.log(`    Siempre Realizada (cerrado, sigue apareciendo):       ${staysRealizada}`);
console.log(`    Terminan en Anulada:                                  ${anulados}`);
