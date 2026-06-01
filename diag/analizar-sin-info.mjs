#!/usr/bin/env node
/**
 * ANÁLISIS de los 863 casos clasificados como "Sin información suficiente"
 * bajo la regla nueva propuesta.
 *
 * Objetivo: distinguir comportamiento normal vs problemas de calidad de datos.
 *
 * Grupos a separar:
 *   A) Casos abiertos normales (en proceso, no entregados aún)
 *   B) Datos faltantes reales (entregado pero falta fecha clave)
 *   C) Anomalías operacionales (contradicciones, fechas imposibles)
 *   D) Anulaciones / casos especiales
 *
 * Solo lectura sobre diag/output/historico-consolidado.csv.
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
function days(a, b) { return (a && b) ? Math.round((b.getTime() - a.getTime()) / 86400000) : null; }

// Replicar la regla nueva propuesta
function clasificarNueva(c) {
  const fFisicoListo = c.fSalidaFisica ?? c.fETAPromesa;
  const fDocListo = c.fPatenteRecibida;
  const fListo = (fFisicoListo && fDocListo)
    ? (fFisicoListo > fDocListo ? fFisicoListo : fDocListo)
    : null;
  const deltaFisicoMenosDoc = days(fDocListo, fFisicoListo);
  const diasEspera = fListo && c.fEntregaReal ? days(fListo, c.fEntregaReal) : null;
  const aut = String(c.autorizacionEntrega ?? "").trim();
  const sol = String(c.solEntrega ?? "").trim();
  const UMBRAL_EMPATE = 2;
  const UMBRAL_RETIRO = 14;

  if (c.entregado === "true") {
    if (diasEspera != null && diasEspera > UMBRAL_RETIRO) return { categ: "Cliente demoró retiro", deltaFisicoMenosDoc, diasEspera, fListo, fFisicoListo, fDocListo };
    if (deltaFisicoMenosDoc == null) return { categ: "Sin información suficiente", deltaFisicoMenosDoc, diasEspera, fListo, fFisicoListo, fDocListo };
    if (deltaFisicoMenosDoc >= 3) return { categ: "Logística llegó última", deltaFisicoMenosDoc, diasEspera, fListo, fFisicoListo, fDocListo };
    if (deltaFisicoMenosDoc <= -3) return { categ: "Control de Negocio llegó último", deltaFisicoMenosDoc, diasEspera, fListo, fFisicoListo, fDocListo };
    return { categ: "Empate real", deltaFisicoMenosDoc, diasEspera, fListo, fFisicoListo, fDocListo };
  }
  // NO entregado
  if (c.tieneSinSalida === "true") return { categ: "Logística llegó última", deltaFisicoMenosDoc, diasEspera, fListo, fFisicoListo, fDocListo };
  if (!fDocListo) return { categ: "Control de Negocio llegó último", deltaFisicoMenosDoc, diasEspera, fListo, fFisicoListo, fDocListo };
  if (fFisicoListo && fDocListo) {
    if (aut !== "Si" || sol !== "Si") return { categ: "Comercial demoró inicio", deltaFisicoMenosDoc, diasEspera, fListo, fFisicoListo, fDocListo };
    return { categ: "Cliente demoró retiro", deltaFisicoMenosDoc, diasEspera, fListo, fFisicoListo, fDocListo };
  }
  if (!fFisicoListo) return { categ: "Logística llegó última", deltaFisicoMenosDoc, diasEspera, fListo, fFisicoListo, fDocListo };
  return { categ: "Sin información suficiente", deltaFisicoMenosDoc, diasEspera, fListo, fFisicoListo, fDocListo };
}

// Enriquecer
const FECHA_CORTE = new Date(2026, 4, 29); // 29 de mayo, fecha del corte de Actas
const enriched = rows.map((r) => {
  const c = {
    ...r,
    fSolicitud: toD(r.fSolicitud),
    fSalidaFisica: toD(r.fSalidaFisica),
    fETAPromesa: toD(r.fETASucursalPromesa),
    fFactura: toD(r.fFactura),
    fSolicitudInscripcion: toD(r.fSolicitudInscripcion),
    fInscripcion: toD(r.fInscripcion),
    fPatenteRecibida: toD(r.fPatenteRecibida),
    fEntregaReal: toD(r.fEntregaReal),
  };
  const cl = clasificarNueva(c);
  return { ...c, ...cl };
});

// Filtrar los 863
const sinInfo = enriched.filter((c) => c.categ === "Sin información suficiente");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log(`  ANÁLISIS — ${sinInfo.length} casos 'Sin información suficiente'`);
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("");

// ── 1) Reconocer Grupo D primero (anulaciones)
console.log("──────────────────────────────────────────────────────────────────────────────");
console.log("  ESTADO ROMA en estos 863 casos:");
console.log("──────────────────────────────────────────────────────────────────────────────");
const porEstado = new Map();
for (const c of sinInfo) {
  porEstado.set(c.estado_ROMA, (porEstado.get(c.estado_ROMA) ?? 0) + 1);
}
for (const [k, v] of [...porEstado.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${(k || "(vacío)").padEnd(20)} ${String(v).padStart(4)} (${(v / sinInfo.length * 100).toFixed(1)}%)`);
}

// ── 2) Aplicar reglas de subgrupos
function clasificarSubgrupo(c) {
  // D — Anulaciones
  if (c.estado_ROMA === "Anulada") return { grupo: "D", razon: "Estado ROMA = Anulada" };

  const entregado = c.entregado === "true";
  const tieneSal = !!c.fSalidaFisica;
  const tieneETA = !!c.fETAPromesa;
  const tieneFact = !!c.fFactura;
  const tienePat = !!c.fPatenteRecibida;
  const tieneEntrega = !!c.fEntregaReal;
  const tieneSolicitud = !!c.fSolicitud;
  const tieneSinSalida = c.tieneSinSalida === "true";

  // C — Anomalías operacionales: detectar contradicciones
  // C1: entregado=true pero sin fEntregaReal en absoluto
  if (entregado && !tieneEntrega) {
    return { grupo: "C", razon: "Entregado pero sin fecha de entrega real" };
  }
  // C2: fechas imposibles (factura posterior a entrega)
  if (c.fFactura && c.fEntregaReal && c.fFactura > c.fEntregaReal) {
    return { grupo: "C", razon: `Factura (${c.fFactura.toISOString().slice(0,10)}) posterior a entrega (${c.fEntregaReal.toISOString().slice(0,10)})` };
  }
  // C3: entrega anterior a salida física
  if (c.fEntregaReal && c.fSalidaFisica && c.fEntregaReal < c.fSalidaFisica) {
    const d = days(c.fSalidaFisica, c.fEntregaReal);
    return { grupo: "C", razon: `Entrega (${c.fEntregaReal.toISOString().slice(0,10)}) anterior a salida física (${c.fSalidaFisica.toISOString().slice(0,10)}) por ${Math.abs(d)} d` };
  }
  // C4: estado=Realizada en ROMA pero sin entrega real ni patente
  if (c.estado_ROMA === "Realizada" && !tieneEntrega && !tienePat) {
    return { grupo: "C", razon: "ROMA dice Realizada pero sin patente ni entrega" };
  }
  // C5: entregado sin tener nunca señal logística (ni salida ni ETA)
  if (entregado && !tieneSal && !tieneETA) {
    return { grupo: "C", razon: "Entregado sin señal de salida física ni ETA" };
  }

  // B — Datos faltantes en casos cerrados
  if (entregado && tieneEntrega && !tienePat) {
    return { grupo: "B", razon: "Entregado pero falta fecha patente recibida en Actas" };
  }
  if (entregado && tieneEntrega && !c.fFactura) {
    return { grupo: "B", razon: "Entregado pero falta fecha factura" };
  }
  if (entregado && tieneEntrega && tienePat && !c.fSalidaFisica) {
    return { grupo: "B", razon: "Entregado + patente OK pero sin fecha salida física" };
  }

  // A — Abiertos normales
  if (!entregado) {
    const diasDesde = c.fSolicitud ? days(c.fSolicitud, FECHA_CORTE) : null;
    if (tieneSinSalida) return { grupo: "A", razon: `Auto físico en patio sin salida (SIN SALIDA), abierto ${diasDesde}d` };
    if (!tienePat && diasDesde != null && diasDesde < 60) {
      return { grupo: "A", razon: `No entregado, sin patente aún, abierto ${diasDesde}d (en proceso normal)` };
    }
    if (!tienePat && diasDesde != null && diasDesde >= 60) {
      return { grupo: "C", razon: `No entregado, sin patente, ${diasDesde}d sin avance (caso colgado)` };
    }
    if (tienePat && (!tieneSal && !tieneETA)) {
      return { grupo: "C", razon: "Patente recibida pero sin señal logística" };
    }
    return { grupo: "A", razon: "En proceso (no entregado, fechas parciales)" };
  }

  // Caso entregado completo pero clasificación nueva no lo capturó:
  // No debería caer acá, pero por seguridad:
  return { grupo: "B", razon: "Entregado con campo intermedio ambiguo" };
}

// Aplicar
for (const c of sinInfo) {
  const x = clasificarSubgrupo(c);
  c.grupo = x.grupo;
  c.razon = x.razon;
}

// ── 3) Distribución por grupo
console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────");
console.log("  DISTRIBUCIÓN POR GRUPO");
console.log("──────────────────────────────────────────────────────────────────────────────");
const porGrupo = new Map();
for (const c of sinInfo) porGrupo.set(c.grupo, (porGrupo.get(c.grupo) ?? 0) + 1);
const orden = ["A", "B", "C", "D"];
const etiquetas = {
  A: "Abiertos normales (en proceso)",
  B: "Datos faltantes en casos cerrados",
  C: "Anomalías operacionales",
  D: "Anulaciones / casos especiales",
};
for (const g of orden) {
  const n = porGrupo.get(g) ?? 0;
  const pctv = (n / sinInfo.length * 100).toFixed(1);
  const bar = "█".repeat(Math.round(n / sinInfo.length * 40));
  console.log(`    Grupo ${g}: ${etiquetas[g].padEnd(38)} ${String(n).padStart(4)} (${pctv.padStart(5)}%)  ${bar}`);
}

// ── 4) Subdistribución por razón dentro de cada grupo
console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────");
console.log("  DETALLE POR RAZÓN (cuántos casos por motivo dentro de cada grupo)");
console.log("──────────────────────────────────────────────────────────────────────────────");
for (const g of orden) {
  const arr = sinInfo.filter((c) => c.grupo === g);
  if (arr.length === 0) continue;
  const razones = new Map();
  for (const c of arr) {
    // Normalizar razones que contienen días variables
    const r = c.razon.replace(/\d+/g, "N");
    razones.set(r, (razones.get(r) ?? 0) + 1);
  }
  console.log(`\n  Grupo ${g} (${etiquetas[g]}, ${arr.length} casos):`);
  for (const [r, n] of [...razones.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)} · ${r}`);
  }
}

// ── 5) Cruzar con Actas: ¿están registrados en Actas o no?
console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────");
console.log("  COBERTURA EN ACTAS (¿el VIN aparece en Actas o no?)");
console.log("──────────────────────────────────────────────────────────────────────────────");
const enActasPorGrupo = new Map();
for (const g of orden) enActasPorGrupo.set(g, { si: 0, no: 0 });
for (const c of sinInfo) {
  const e = enActasPorGrupo.get(c.grupo);
  if (c.enActas === "true") e.si++; else e.no++;
}
for (const g of orden) {
  const e = enActasPorGrupo.get(g);
  const tot = e.si + e.no;
  if (tot === 0) continue;
  console.log(`    Grupo ${g}: enActas=Si ${e.si} (${(e.si/tot*100).toFixed(1)}%), enActas=No ${e.no} (${(e.no/tot*100).toFixed(1)}%)`);
}

// ── 6) Entregado vs no entregado por grupo
console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────");
console.log("  ENTREGADO vs NO ENTREGADO por grupo");
console.log("──────────────────────────────────────────────────────────────────────────────");
for (const g of orden) {
  const arr = sinInfo.filter((c) => c.grupo === g);
  if (arr.length === 0) continue;
  const ent = arr.filter((c) => c.entregado === "true").length;
  const no = arr.length - ent;
  console.log(`    Grupo ${g}: entregado=${ent} (${(ent/arr.length*100).toFixed(1)}%), no entregado=${no} (${(no/arr.length*100).toFixed(1)}%)`);
}

// ── 7) Ejemplos por grupo
console.log("");
console.log("──────────────────────────────────────────────────────────────────────────────");
console.log("  EJEMPLOS CONCRETOS POR GRUPO");
console.log("──────────────────────────────────────────────────────────────────────────────");
for (const g of orden) {
  const arr = sinInfo.filter((c) => c.grupo === g);
  if (arr.length === 0) continue;
  console.log(`\n  ── Grupo ${g} (${etiquetas[g]}) — ${arr.length} casos ──`);
  // Mostrar 5 ejemplos representativos (variar las razones)
  const porRazon = new Map();
  for (const c of arr) {
    const r = c.razon.replace(/\d+/g, "N");
    if (!porRazon.has(r)) porRazon.set(r, []);
    porRazon.get(r).push(c);
  }
  for (const [r, lista] of [...porRazon.entries()].slice(0, 5)) {
    const c = lista[0];
    const fmt = (d) => d ? d.toISOString().slice(0,10) : "—";
    console.log(`    Razón: ${r}`);
    console.log(`      ${c.ventaId} · ${c.marca?.padEnd(10) ?? ""} · ${c.sucursal?.slice(0,25).padEnd(25) ?? ""}`);
    console.log(`      Estado=${c.estado_ROMA}  entregado=${c.entregado}  enActas=${c.enActas}  tieneSinSalida=${c.tieneSinSalida}`);
    console.log(`      fSolicitud=${fmt(c.fSolicitud)}  fSalida=${fmt(c.fSalidaFisica)}  fETA=${fmt(c.fETAPromesa)}`);
    console.log(`      fFactura=${fmt(c.fFactura)}  fPatente=${fmt(c.fPatenteRecibida)}  fEntrega=${fmt(c.fEntregaReal)}`);
    console.log("");
  }
}

// ── 8) Resumen ejecutivo
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  RESUMEN EJECUTIVO");
console.log("══════════════════════════════════════════════════════════════════════════════");
const a = porGrupo.get("A") ?? 0;
const b = porGrupo.get("B") ?? 0;
const cg = porGrupo.get("C") ?? 0;
const d = porGrupo.get("D") ?? 0;
console.log(`  Total 'Sin información suficiente': ${sinInfo.length}`);
console.log("");
console.log(`  Comportamiento normal (no son errores):`);
console.log(`    Grupo A (abiertos normales):     ${a}  (${(a/sinInfo.length*100).toFixed(1)}%)`);
console.log(`    Grupo D (anulaciones):           ${d}  (${(d/sinInfo.length*100).toFixed(1)}%)`);
console.log(`    Subtotal NORMAL:                 ${a + d}  (${((a+d)/sinInfo.length*100).toFixed(1)}%)`);
console.log("");
console.log(`  Calidad de datos (requieren atención):`);
console.log(`    Grupo B (datos faltantes):       ${b}  (${(b/sinInfo.length*100).toFixed(1)}%)`);
console.log(`    Grupo C (anomalías):             ${cg}  (${(cg/sinInfo.length*100).toFixed(1)}%)`);
console.log(`    Subtotal CALIDAD:                ${b + cg}  (${((b+cg)/sinInfo.length*100).toFixed(1)}%)`);

// Salida CSV para los 863 con grupo asignado
const outPath = path.join("diag", "output", "sin-info-clasificados.csv");
const cols = ["ventaId","vin","marca","sucursal","estado_ROMA","entregado","tieneSinSalida","enActas","fSolicitud","fSalidaFisica","fPatenteRecibida","fEntregaReal","grupo","razon"];
const csvOut = [cols.join(",")];
for (const c of sinInfo) {
  csvOut.push(cols.map((k) => {
    const v = c[k];
    if (v == null) return "";
    const s = v instanceof Date ? v.toISOString().slice(0,10) : String(v);
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(","));
}
fs.writeFileSync(outPath, csvOut.join("\n"));
console.log("");
console.log(`  CSV detallado: ${outPath}  (${(fs.statSync(outPath).size/1024).toFixed(0)} KB)`);
