import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const buf = readFileSync("/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Autos no entregados.xlsx");
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets["ROMA"], { defval: null, raw: true });

const has = (v) => v !== null && v !== undefined && v !== "";
const isSi = (v) => v === "Si" || v === "si" || v === "SI";
const hoy = new Date("2026-05-21");
const dias = (v) => {
  if (!has(v)) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (!Number.isFinite(d.getTime())) return null;
  return Math.floor((hoy - d) / 86400000);
};

function estado(r) {
  const patRec = has(r.fecha_patente_recibida);
  if (patRec) {
    if (isSi(r.sol_entrega) && isSi(r.autorizacion_entrega)) return "listo";
    if (isSi(r.sol_entrega)) return "faltaAut";
    return "patSucursal";
  }
  if (has(r.fecha_patente_enviada)) return "patTransito";
  if (has(r.patentes_administracion)) return "patAdmin";
  if (has(r.FechaInscripcion)) return "inscritaSinAdmin";
  if (has(r.FechaSolicitudInscripcion)) return "enRC";
  if (isSi(r.SolicitarInscripcion)) return "enCdN";
  return "sinSolicitud";
}

function refDate(r, e) {
  switch (e) {
    case "listo": case "faltaAut": case "patSucursal": return r.fecha_patente_recibida;
    case "patTransito": return r.fecha_patente_enviada;
    case "patAdmin": return r.patentes_administracion;
    case "inscritaSinAdmin": return r.FechaInscripcion;
    case "enRC": return r.FechaSolicitudInscripcion;
    case "enCdN": case "sinSolicitud": return r.FechaVenta;
  }
}

const buckets = {};
for (const r of rows) {
  const e = estado(r);
  if (!buckets[e]) buckets[e] = [];
  const d = dias(refDate(r, e));
  if (d !== null) buckets[e].push(d);
}

console.log("Antigüedad por estado (días desde la fecha de referencia):\n");
for (const e of ["listo","faltaAut","patSucursal","patTransito","patAdmin","inscritaSinAdmin","enRC","enCdN","sinSolicitud"]) {
  const ds = buckets[e] ?? [];
  if (ds.length === 0) { console.log(`  ${e.padEnd(20)} -- 0 con fecha`); continue; }
  const max = Math.max(...ds);
  const m3 = ds.filter(d => d > 3).length;
  const m7 = ds.filter(d => d > 7).length;
  const m15 = ds.filter(d => d > 15).length;
  const m30 = ds.filter(d => d > 30).length;
  const sev = m30 > 0 ? "🔴 critical" : m15 > 0 ? "🟠 danger" : m7 > 0 ? "🟡 warning" : "🟢 ok";
  console.log(`  ${e.padEnd(20)} n=${String(ds.length).padStart(3)}  máx=${String(max).padStart(4)}d  >3d=${String(m3).padStart(3)}  >7d=${String(m7).padStart(3)}  >15d=${String(m15).padStart(3)}  >30d=${String(m30).padStart(3)}  ${sev}`);
}
