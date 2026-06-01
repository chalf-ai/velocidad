#!/usr/bin/env node
/**
 * Reporte ANTES vs DESPUÉS del filtro `entregado=false`.
 *
 * Duplica las reglas mínimas del parser+selector en JS puro para no depender
 * del bundler. Comparamos sobre el archivo real de OneDrive.
 */
import XLSX from "xlsx";

const FILE = process.argv[2] ?? "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Actas al 28 de Mayo.xlsx";
const HOY = new Date();

const wb = XLSX.readFile(FILE, { cellDates: true });
const ws = wb.Sheets["ROMA"];
if (!ws) {
  console.error("No existe hoja ROMA");
  process.exit(1);
}

function toStr(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}
function toNum(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function toDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t) : null;
  }
  return null;
}
function toSiNo(v) {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (s === "si" || s === "sí" || s === "yes" || s === "true" || s === "1") return true;
  if (s === "no" || s === "false" || s === "0") return false;
  return null;
}
function detectarEntregado(txt, fechaEntregada) {
  // Regla canónica: entrega_auto_txt === "Cargado"
  const norm = (txt ?? "").trim();
  if (norm === "Cargado") return true;
  if (fechaEntregada !== null) return true; // red de seguridad
  return false;
}

const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
const registros = [];
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const vin = toStr(r["Vin"]);
  if (!vin) continue;
  const fechaPatenteEntregada = toDate(r["fecha_patente_entregada"]);
  registros.push({
    vin,
    valorFactura: toNum(r["ValorFactura"]),
    fechaVenta: toDate(r["FechaVenta"]),
    fechaFactura: toDate(r["FechaFactura"]),
    autorizacionEntrega: toSiNo(r["autorizacion_entrega"]),
    solEntrega: toSiNo(r["sol_entrega"]),
    fechaPatenteRecibida: toDate(r["fecha_patente_recibida"]),
    fechaPatenteEnviada: toDate(r["fecha_patente_enviada"]),
    patentesAdministracion: toDate(r["patentes_administracion"]),
    fechaInscripcion: toDate(r["FechaInscripcion"]),
    fechaSolicitudInscripcion: toDate(r["FechaSolicitudInscripcion"]),
    solicitarInscripcion: toSiNo(r["SolicitarInscripcion"]),
    entregado: detectarEntregado(toStr(r["entrega_auto_txt"]), fechaPatenteEntregada),
    fechaPatenteEntregada,
  });
}

function deriveEstadoEntrega(fne) {
  const patenteEnSucursal = fne.fechaPatenteRecibida !== null;
  if (patenteEnSucursal) {
    if (fne.solEntrega === true && fne.autorizacionEntrega === true) return "listo_para_entregar";
    if (fne.solEntrega === true && fne.autorizacionEntrega !== true) return "falta_solo_autorizacion";
    return "patente_en_sucursal";
  }
  if (fne.fechaPatenteEnviada !== null) return "patente_en_transito";
  if (fne.patentesAdministracion !== null) return "patente_en_admin";
  if (fne.fechaInscripcion !== null) return "inscrita_sin_admin";
  if (fne.fechaSolicitudInscripcion !== null) return "en_registro_civil";
  if (fne.solicitarInscripcion === true) return "en_control_negocios";
  return "sin_solicitud_inscripcion";
}

function fechaReferenciaEstado(fne, estado) {
  switch (estado) {
    case "listo_para_entregar":
    case "falta_solo_autorizacion":
    case "patente_en_sucursal":
      return fne.fechaPatenteRecibida;
    case "patente_en_transito":
      return fne.fechaPatenteEnviada;
    case "patente_en_admin":
      return fne.patentesAdministracion;
    case "inscrita_sin_admin":
      return fne.fechaInscripcion;
    case "en_registro_civil":
      return fne.fechaSolicitudInscripcion;
    default:
      return fne.fechaVenta;
  }
}

function diasDesde(d) {
  if (!d) return null;
  return Math.floor((HOY.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function statsFNE(universo) {
  const porEstado = {};
  const porBucket = {};
  let valorTotal = 0;
  let maxAntiguedad = 0;
  let listoCount = 0;
  let listoValor = 0;
  let alertasCriticas = 0;
  for (const r of universo) {
    const estado = deriveEstadoEntrega(r);
    porEstado[estado] = (porEstado[estado] || 0) + 1;
    valorTotal += r.valorFactura;
    const dias = diasDesde(r.fechaFactura);
    const b = dias === null ? "sin_fecha" : dias <= 3 ? "0-3" : dias <= 7 ? "4-7" : dias <= 15 ? "8-15" : dias <= 30 ? "16-30" : dias <= 60 ? "31-60" : "61+";
    porBucket[b] = (porBucket[b] || 0) + 1;
    const diasEnEstado = diasDesde(fechaReferenciaEstado(r, estado));
    if (diasEnEstado !== null && diasEnEstado > maxAntiguedad) maxAntiguedad = diasEnEstado;
    if (estado === "listo_para_entregar") {
      listoCount++;
      listoValor += r.valorFactura;
    }
    // bloqueo artificial = falta_solo_autorizacion + patente_en_sucursal (alertas críticas)
    if (estado === "falta_solo_autorizacion" || estado === "patente_en_sucursal") alertasCriticas++;
  }
  return { total: universo.length, valorTotal, maxAntiguedad, listoCount, listoValor, alertasCriticas, porEstado, porBucket };
}

const historico = registros;
const operativo = registros.filter((r) => !r.entregado);

const sH = statsFNE(historico);
const sO = statsFNE(operativo);

const fmt = (n) => n.toLocaleString("es-CL");
const fmtMM = (n) => `$ ${(n / 1_000_000).toLocaleString("es-CL", { maximumFractionDigits: 1 })} MM`;
const dlt = (a, b) => {
  const d = b - a;
  if (d === 0) return "·";
  return d > 0 ? `+${fmt(d)}` : fmt(d);
};

console.log("════════════════════════════════════════════════════════════════════════════");
console.log("  REPORTE FNE — Filtro entregado=false");
console.log("  Archivo:", FILE.split("/").pop());
console.log("════════════════════════════════════════════════════════════════════════════");
console.log("");
console.log("                              ANTES (histórico)    DESPUÉS (operativo)    Δ");
console.log("────────────────────────────────────────────────────────────────────────────");
console.log(`  Total registros            ${fmt(sH.total).padStart(8)}              ${fmt(sO.total).padStart(8)}        ${dlt(sH.total, sO.total).padStart(8)}`);
console.log(`  Excluidos (entregado=true)                          ${fmt(sH.total - sO.total).padStart(8)}`);
console.log(`  Monto en pipeline          ${fmtMM(sH.valorTotal).padStart(12)}     ${fmtMM(sO.valorTotal).padStart(12)}     ${fmtMM(sO.valorTotal - sH.valorTotal).padStart(10)}`);
console.log(`  Listos para entregar       ${fmt(sH.listoCount).padStart(8)}              ${fmt(sO.listoCount).padStart(8)}        ${dlt(sH.listoCount, sO.listoCount).padStart(8)}`);
console.log(`  Valor "listos"             ${fmtMM(sH.listoValor).padStart(12)}     ${fmtMM(sO.listoValor).padStart(12)}     ${fmtMM(sO.listoValor - sH.listoValor).padStart(10)}`);
console.log(`  Antigüedad máxima (días)   ${String(sH.maxAntiguedad).padStart(8)}              ${String(sO.maxAntiguedad).padStart(8)}        ${dlt(sH.maxAntiguedad, sO.maxAntiguedad).padStart(8)}`);
console.log(`  Alertas críticas           ${fmt(sH.alertasCriticas).padStart(8)}              ${fmt(sO.alertasCriticas).padStart(8)}        ${dlt(sH.alertasCriticas, sO.alertasCriticas).padStart(8)}`);
console.log("");
console.log("  Por estado del pipeline:");
const estados = ["listo_para_entregar","falta_solo_autorizacion","patente_en_sucursal","patente_en_transito","patente_en_admin","inscrita_sin_admin","en_registro_civil","en_control_negocios","sin_solicitud_inscripcion"];
for (const e of estados) {
  const a = sH.porEstado[e] || 0;
  const b = sO.porEstado[e] || 0;
  console.log(`    ${e.padEnd(32)} ${String(a).padStart(5)}        ${String(b).padStart(5)}      ${dlt(a, b).padStart(8)}`);
}
console.log("");
console.log("  Por bucket de aging (días desde FechaFactura):");
const buckets = ["0-3","4-7","8-15","16-30","31-60","61+","sin_fecha"];
for (const b of buckets) {
  const a = sH.porBucket[b] || 0;
  const c = sO.porBucket[b] || 0;
  console.log(`    ${b.padEnd(32)} ${String(a).padStart(5)}        ${String(c).padStart(5)}      ${dlt(a, c).padStart(8)}`);
}
console.log("");
console.log("════════════════════════════════════════════════════════════════════════════");
console.log(`  Detección entregado: ${sH.total - sO.total} de ${sH.total} (${((sH.total - sO.total) / sH.total * 100).toFixed(1)}%)`);
console.log("════════════════════════════════════════════════════════════════════════════");
