#!/usr/bin/env node
/**
 * Valida el cambio semántico:
 *   - solicitud_vendedor: ROMA gana, ROMIA fallback con confianza media
 *   - solicitud_bodega:   KAR/SCHIAPP gana (sin cambio)
 *
 * Mide ANTES vs DESPUÉS para el VIN VR3KAHPY3VS000844 y un agregado sobre el
 * universo FNE operativo (cuántos VINs cambian la fecha de solicitud).
 */
import XLSX from "xlsx";

const BASE = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive";
const F_ACTAS = `${BASE}/Actas al 28 de Mayo.xlsx`;
const F_SCHIAPP = `${BASE}/SCHIAPPCASSE 28 de Mayo.xlsx`;
const F_KAR = `${BASE}/KAR-LOGISTICS 28 de Mayo.xlsx`;
const F_ROMA = "/Users/Daviid/Downloads/tmp-export-3-29-05-2026_229 (5).xlsx";
const VIN_FOCO = "VR3KAHPY3VS000844";

function norm(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s.toUpperCase();
}
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
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) {
    const dt = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return Number.isFinite(dt.getTime()) ? dt : null;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}
function fmt(d) { return d ? d.toISOString().slice(0, 10) : "—"; }

// 1) Universo FNE operativo
const wbActas = XLSX.readFile(F_ACTAS, { cellDates: true });
const rowsActas = XLSX.utils.sheet_to_json(wbActas.Sheets["ROMA"], { defval: null, raw: true });
const fneOperativos = new Set();
for (const r of rowsActas) {
  if (!r["Vin"]) continue;
  const t = String(r["entrega_auto_txt"] ?? "").trim();
  if (t !== "Cargado") fneOperativos.add(norm(r["Vin"]));
}

// 2) Indexar KAR + SCHIAPP — solo lo necesario (fSolicitudVendedor por VIN)
function loadRomiaSolicitud(file, sheetVinCol, distSheet, distSolCols) {
  const wb = XLSX.readFile(file, { cellDates: true });
  const out = new Map();
  // Solicitud Venta (más preciso)
  const wsSV = wb.Sheets["Solicitud Venta"];
  if (wsSV) {
    for (const r of XLSX.utils.sheet_to_json(wsSV, { defval: null, raw: true })) {
      const v = norm(r["Vin"]); if (!v) continue;
      const f = toDate(r["FechaSolicitud"]);
      if (f) out.set(v, f);
    }
  }
  // Distribución (proxy: fSol coincide con solicitudBodega)
  const wsD = wb.Sheets[distSheet];
  if (wsD) {
    for (const r of XLSX.utils.sheet_to_json(wsD, { defval: null, raw: true })) {
      const v = norm(r["VIN"]); if (!v) continue;
      if (out.has(v)) continue;
      let f = null;
      for (const c of distSolCols) {
        f = toDate(r[c]);
        if (f) break;
      }
      if (f) out.set(v, f);
    }
  }
  return out;
}
const romiaSolSchiapp = loadRomiaSolicitud(F_SCHIAPP, "Vin", "Distribución", ["Fecha de solicitud"]);
const romiaSolKar = loadRomiaSolicitud(F_KAR, "Vin", "Distribucion", ["Fecha  Solicitud", "Fecha Solicitud"]);

// 3) ROMA legacy
const wbRoma = XLSX.readFile(F_ROMA, { cellDates: true });
const romaSol = new Map();
for (const r of XLSX.utils.sheet_to_json(wbRoma.Sheets["ROMA"], { defval: null, raw: true })) {
  const v = norm(r["Vin"]); if (!v) continue;
  const f = toDate(r["FechaSolicitud"]);
  if (f && !romaSol.has(v)) romaSol.set(v, f);
}

console.log("════════════════════════════════════════════════════════════════════════════════");
console.log("  AJUSTE SEMÁNTICO — solicitud_vendedor (ROMA prioridad)");
console.log("════════════════════════════════════════════════════════════════════════════════");
console.log("");

// 4) Caso VIN específico
console.log(`  VIN ${VIN_FOCO}:`);
const romaV = romaSol.get(VIN_FOCO);
const karV = romiaSolKar.get(VIN_FOCO);
const schiappV = romiaSolSchiapp.get(VIN_FOCO);
console.log(`    ROMA   FechaSolicitud         → ${fmt(romaV)}`);
console.log(`    KAR    Fecha Solicitud (dist) → ${fmt(karV)}`);
console.log(`    SCHIAPP Fecha solicitud (dist)→ ${fmt(schiappV)}`);
console.log("");

// Lógica antes (ROMIA gana)
const antes = karV ?? schiappV ?? romaV;
const antesFuente = karV ? "KAR (alta)" : schiappV ? "SCHIAPP (alta)" : romaV ? "ROMA (alta)" : "—";
// Lógica después (ROMA gana, ROMIA fallback con media)
const despues = romaV ?? karV ?? schiappV;
const despuesFuente = romaV ? "ROMA (alta)" : karV ? "KAR (media · proxy)" : schiappV ? "SCHIAPP (media · proxy)" : "—";

console.log(`    Solicitud del vendedor ANTES   → ${fmt(antes)}  (${antesFuente})`);
console.log(`    Solicitud del vendedor DESPUÉS → ${fmt(despues)}  (${despuesFuente})`);
if (antes && despues) {
  const dias = Math.round((antes.getTime() - despues.getTime()) / 86400000);
  if (Math.abs(dias) > 0) {
    console.log(`    Gap revelado: ${Math.abs(dias)} días entre solicitud comercial y registro logístico`);
  }
}
console.log("");

// 5) Impacto agregado en el universo
let totalConSolicitud = 0;
let conRomaOnly = 0;
let conRomiaOnly = 0;
let conAmbas = 0;
let cambianDespues = 0;
let sumDiasGap = 0;

for (const vin of fneOperativos) {
  const r = romaSol.get(vin);
  const ro = romiaSolKar.get(vin) ?? romiaSolSchiapp.get(vin);
  if (r && ro) {
    conAmbas++;
    totalConSolicitud++;
    const dias = Math.round((ro.getTime() - r.getTime()) / 86400000);
    if (dias !== 0) {
      cambianDespues++;
      sumDiasGap += dias;
    }
  } else if (r) {
    conRomaOnly++;
    totalConSolicitud++;
  } else if (ro) {
    conRomiaOnly++;
    totalConSolicitud++;
  }
}

console.log("  IMPACTO sobre FNE operativo (854 VINs):");
console.log(`    Tienen solicitud (al menos 1 fuente): ${totalConSolicitud}`);
console.log(`    Solo ROMA (sin cambio antes/después): ${conRomaOnly}`);
console.log(`    Solo ROMIA (sin cambio, baja a media): ${conRomiaOnly}`);
console.log(`    Ambas fuentes (acá puede cambiar):    ${conAmbas}`);
console.log(`    VINs que CAMBIAN la fecha mostrada:   ${cambianDespues}`);
if (cambianDespues > 0) {
  console.log(`    Gap promedio revelado:                 ${Math.round(sumDiasGap / cambianDespues)} días`);
}
console.log("════════════════════════════════════════════════════════════════════════════════");
