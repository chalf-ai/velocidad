/**
 * AUDITORÍA SLA · tiempos calculables y aging por etapa.
 * ROMA: fechas dd-mm-yyyy (string). Logistica Hoja2: Date objects.
 * Solo lee. Reporta promedio / p95 / máx / negativos / abiertos.
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const DIR = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";
const read = (f, sheet) => {
  const wb = XLSX.read(readFileSync(DIR + f), { type: "buffer", cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet ?? wb.SheetNames[0]], { defval: null, raw: true });
};
const up = (s) => (s ?? "").toString().toUpperCase().trim();
const HOY = new Date("2026-05-23");

// dd-mm-yyyy → Date | null
function pDMY(s) {
  const t = String(s ?? "").trim();
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(t);
  if (!m) return null;
  const [, d, mo, y] = m;
  if (d === "00" || mo === "00" || y === "0000") return null;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  return isNaN(dt) ? null : dt;
}
const asDate = (v) => (v instanceof Date && !isNaN(v) ? v : null);
const days = (a, b) => (a && b ? Math.round((b - a) / 86400000) : null);

function stats(label, arr) {
  const xs = arr.filter((x) => x != null);
  if (xs.length === 0) { console.log(`  ${label.padEnd(42)} (sin datos)`); return; }
  const neg = xs.filter((x) => x < 0).length;
  const pos = xs.filter((x) => x >= 0).sort((a, b) => a - b);
  const sum = pos.reduce((a, b) => a + b, 0);
  const prom = pos.length ? (sum / pos.length).toFixed(1) : "—";
  const p = (q) => (pos.length ? pos[Math.min(pos.length - 1, Math.floor(q * pos.length))] : "—");
  console.log(`  ${label.padEnd(42)} n=${String(xs.length).padStart(4)} prom ${String(prom).padStart(5)}d  p50 ${String(p(0.5)).padStart(3)}  p95 ${String(p(0.95)).padStart(3)}  máx ${String(pos[pos.length-1] ?? "—").padStart(4)}  neg:${neg}`);
}

// ── ROMA SLA ─────────────────────────────────────────────────────────────────
const roma = read("Diciembre-Mayo ROMA.xlsx", "ROMA");
const R = (r, c) => pDMY(r[c]);
console.log(`══ ROMA · intervalos (días) ══`);
stats("solicitud → respuesta logística", roma.map((r) => days(R(r,"FechaSolicitud"), R(r,"fecha_RespuestaGestionLogistica"))));
stats("solicitud → llegada sucursal (S)", roma.map((r) => days(R(r,"FechaSolicitud"), R(r,"FechaETASucursal"))));
stats("respuesta logística → llegada suc.", roma.map((r) => days(R(r,"fecha_RespuestaGestionLogistica"), R(r,"FechaETASucursal"))));
stats("llegada sucursal → inscripción (M)", roma.map((r) => days(R(r,"FechaETASucursal"), R(r,"FechaEnprocesoIns"))));
stats("factura → entrega comprometida (J)", roma.map((r) => days(R(r,"FechaFactura"), R(r,"FechaEstimadaEntrega"))));
stats("solicitud → factura", roma.map((r) => days(R(r,"FechaSolicitud"), R(r,"FechaFactura"))));
stats("solicitud → entrega comprometida", roma.map((r) => days(R(r,"FechaSolicitud"), R(r,"FechaEstimadaEntrega"))));

// ── ROMA aging abierto (Estado=Pendiente, etapas sin completar) ──────────────
const pend = roma.filter((r) => up(r["Estado"]) === "PENDIENTE");
const sinLlegada = pend.filter((r) => !R(r, "FechaETASucursal"));
const sinResp = pend.filter((r) => !R(r, "fecha_RespuestaGestionLogistica"));
const sinFactura = pend.filter((r) => !R(r, "FechaFactura"));
const sinInscr = pend.filter((r) => !R(r, "FechaEnprocesoIns"));
console.log(`\n══ ROMA · universo Pendiente (${pend.length}) — etapas abiertas ══`);
console.log(`  Sin respuesta logística:   ${sinResp.length}`);
console.log(`  Sin llegada a sucursal:    ${sinLlegada.length}`);
console.log(`  Sin factura:               ${sinFactura.length}`);
console.log(`  Sin inscripción:           ${sinInscr.length}`);
stats("aging: solicitud → HOY (Pendiente)", pend.map((r) => days(R(r,"FechaSolicitud"), HOY)));
stats("aging: sin-llegada → HOY", sinLlegada.map((r) => days(R(r,"FechaSolicitud"), HOY)));

// ── Logistica Hoja2 SLA ──────────────────────────────────────────────────────
const logi = read("Logistica.xlsx", "Hoja2");
const L = (r, c) => asDate(r[c]);
console.log(`\n══ Logistica Hoja2 · intervalos (días) ══`);
stats("ingreso APC → solicitud STLI", logi.map((r) => days(L(r,"Fecha Ingreso APC"), L(r,"Fecha de solicitud a STLI"))));
stats("solicitud STLI → planificación", logi.map((r) => days(L(r,"Fecha de solicitud a STLI"), L(r,"Fecha Planificacion STLI"))));
stats("solicitud STLI → despacho", logi.map((r) => days(L(r,"Fecha de solicitud a STLI"), L(r,"Fecha despacho a sucursal"))));
stats("planificación → despacho", logi.map((r) => days(L(r,"Fecha Planificacion STLI"), L(r,"Fecha despacho a sucursal"))));
stats("ingreso APC → despacho (total)", logi.map((r) => days(L(r,"Fecha Ingreso APC"), L(r,"Fecha despacho a sucursal"))));

// Cumplimiento despacho por marca
console.log(`\n── Cumplimiento despacho por marca ──`);
const cmp = new Map();
for (const r of logi) {
  const k = up(r["Marca"]) || "(s/m)";
  const e = cmp.get(k) ?? { ok: 0, no: 0 };
  if (up(r["Cumplimiento despacho"]) === "CUMPLIDO") e.ok++; else e.no++;
  cmp.set(k, e);
}
for (const [k, e] of [...cmp.entries()].sort((a,b)=>(b[1].ok+b[1].no)-(a[1].ok+a[1].no)).slice(0,12)) {
  const tot = e.ok + e.no;
  console.log(`  ${k.padEnd(14)} ${String(tot).padStart(4)}  no-cumplido ${String(e.no).padStart(3)} (${Math.round(e.no/tot*100)}%)`);
}
console.log("");
