import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const buf = readFileSync("/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Autos no entregados.xlsx");
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets["ROMA"], { defval: null, raw: true });

const has = (v) => v !== null && v !== undefined && v !== "";
const isSi = (v) => v === "Si" || v === "si" || v === "SI";
const fmt = (d) => d instanceof Date ? d.toISOString().slice(0, 10) : (typeof d === "string" ? d.slice(0, 10) : "—");
const hoy = new Date("2026-05-21");
const dias = (d) => d instanceof Date ? Math.floor((hoy - d) / 86400000) : "—";

const matched = [];
for (const r of rows) {
  const patRec = has(r.fecha_patente_recibida);
  const patEnv = has(r.fecha_patente_enviada);
  const patAdm = has(r.patentes_administracion);
  const fInscr = has(r.FechaInscripcion);
  if (!patRec && !patEnv && !patAdm && fInscr) matched.push(r);
}

console.log(`Total inscrita_sin_admin: ${matched.length}\n`);

// agrupar por sucursal
const porSuc = {};
for (const r of matched) {
  const k = r.Sucursal ?? "(sin)";
  if (!porSuc[k]) porSuc[k] = [];
  porSuc[k].push(r);
}

const ordenSuc = Object.keys(porSuc).sort((a, b) => porSuc[b].length - porSuc[a].length);
let valorTotal = 0;
for (const s of ordenSuc) {
  const vs = porSuc[s];
  const valor = vs.reduce((x, r) => x + (r.ValorFactura || 0), 0);
  valorTotal += valor;
  console.log(`${s} — ${vs.length} unidades, $${valor.toLocaleString("es-CL")}`);
  for (const r of vs) {
    const d = dias(r.FechaInscripcion);
    console.log(`  · ${r.Vin} · ${r.Nombre_Cliente?.slice(0, 32) ?? "—"} · inscrita ${fmt(r.FechaInscripcion)} (${d}d) · $${(r.ValorFactura ?? 0).toLocaleString("es-CL")}`);
  }
  console.log("");
}
console.log(`Valor total bucket: $${valorTotal.toLocaleString("es-CL")}`);
