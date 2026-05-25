/**
 * DIAGNÓSTICO · contradicciones del Caso Unificado (detalle).
 *   P1: FNE pero entregado (11)
 *   P2: Sucursal inconsistente stock vs FNE (119)
 * Solo lee. NO modifica nada.
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const DIR = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";
const read = (f, sheet) => {
  const wb = XLSX.read(readFileSync(DIR + f), { type: "buffer", cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet ?? wb.SheetNames[0]], { defval: null, raw: true });
};
const up = (s) => (s ?? "").toString().toUpperCase().trim();
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const fmt = (n) => "$" + Math.round(n).toLocaleString("es-CL");
const isDate = (v) => v instanceof Date && !isNaN(v);
const ymd = (v) => (isDate(v) ? v.toISOString().slice(0, 10) : "—");
const HOY = new Date("2026-05-23");
const dias = (a) => (isDate(a) ? Math.round((HOY - a) / 86400000) : null);
const limpiarVIN = (raw) => raw == null ? "" :
  String(raw).replace(/\s+/g, "").replace(/[-_./]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const cajK = (c) => up(c).replace(/\s+/g, "");
const tok = (s) => new Set(up(s).normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[\s\-_./]+/).filter((t) => t.length >= 3 && !["STOCK","OFICINA","BODEGA","POMPEYO","AUTOS"].includes(t)));
const distintas = (a, b) => { if (!a || !b) return false; const ta = tok(a), tb = tok(b); if (!ta.size || !tb.size) return false; for (const t of ta) if (tb.has(t)) return false; return true; };
const marcaTok = (s) => up(s).replace(/^OFICINA\s+/, "").split(/\s+/)[0] || "";

const GRUPO = new Set(["KIA","MG","GEELY","PEUGEOT","OPEL","CITROEN","DFSK","NISSAN","SUBARU","SUZUKI","GREAT WALL","DFM","LEAPMOTOR","LANDKING","NAMMI","KIA MOTORS"]);
const normMarca = (v) => { const c = up(v); if (!c) return "SIN MARCA"; if (["USADOS","VU EN NUEVOS","VU EN USADOS"].includes(c)) return "USADOS"; if (c==="KIA") return "KIA MOTORS"; return GRUPO.has(c) ? c : "OTRAS MARCAS"; };
const esUsadoStock = (r) => up(r["Unidad Negocio"]) === "USADOS" || up(r["Condicion Vehiculo"]).includes("USADO") || ["USADOS","VU EN NUEVOS","VU EN USADOS"].includes(up(r["Marca Pompeyo"]));
const marcaOp = (r) => esUsadoStock(r) ? "USADOS" : normMarca(r["Marca Pompeyo"] ?? r["Marca"]);

// ── fuentes + índices ────────────────────────────────────────────────────────
const stock = read("Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx", "Base_Stock");
const fne = read("Autos no entregados.xlsx");
const roma = read("Diciembre-Mayo ROMA.xlsx", "ROMA");
const saldos = read("Reportes Saldos 2.0 18-05-2026_.xlsx", "FUSION BD 3.0");

const stockByVin = new Map();
const cajonToVin = new Map();
for (const r of stock) { const k = limpiarVIN(r["Numero VIN"]); if (k && !stockByVin.has(k)) stockByVin.set(k, r); const c = cajK(r["Cajon"]); if (c && !cajonToVin.has(c)) cajonToVin.set(c, k); }
const fneByVin = new Map();
for (const r of fne) { const k = limpiarVIN(r["Vin"]); if (k && !fneByVin.has(k)) fneByVin.set(k, r); }
const romaByVin = new Map();
for (const r of roma) { const k = limpiarVIN(r["Vin"]); if (k && !romaByVin.has(k)) romaByVin.set(k, r); }

// saldos por VIN (bridge cajón→VIN)
const saldoByVin = new Map(); // vin → {saldo, credito}
for (const s of saldos) {
  const c = cajK(s["Cajon"]); const vin = cajonToVin.get(c);
  if (!vin) continue;
  const e = saldoByVin.get(vin) ?? { saldo: 0, credito: 0 };
  e.saldo += num(s["Saldo x Documentar"]);
  e.credito += num(s[" C.Pompeyo "] ?? s["C.Pompeyo"]);
  saldoByVin.set(vin, e);
}

const fneEstado = (r) => {
  const rec = isDate(r["fecha_patente_recibida"]); const sol = up(r["sol_entrega"]) === "SI"; const aut = up(r["autorizacion_entrega"]) === "SI";
  if (rec) { if (sol && aut) return "listo_para_entregar"; if (sol) return "falta_autorizacion"; return "patente_en_sucursal"; }
  if (isDate(r["fecha_patente_enviada"])) return "patente_en_transito";
  return "en_proceso_inscripcion";
};

// ════════════════════════════════════════════════════════════════════════════
// P1 · FNE PERO ENTREGADO
// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(78)}\n  P1 · FNE PERO ENTREGADO\n${"═".repeat(78)}`);
const p1 = [];
for (const [vin, fr] of fneByVin) {
  const rr = romaByVin.get(vin);
  if (up(rr?.["Estado"]) !== "REALIZADA") continue;
  const sr = stockByVin.get(vin);
  const est = fneEstado(fr);
  let clase;
  if (est === "listo_para_entregar") clase = "entrega real sin descarga FNE";
  else if (est === "en_proceso_inscripcion" || est === "patente_en_transito") clase = "logística mal cerrada";
  else clase = "FNE mal cerrado / revisión";
  const sal = saldoByVin.get(vin) ?? { saldo: 0, credito: 0 };
  p1.push({ vin, sr, fr, rr, est, clase, sal });
}
let p1Cap = 0;
for (const c of p1) {
  p1Cap += num(c.fr["ValorFactura"]);
  console.log(`\n  VIN ${c.vin}  [${c.clase}]`);
  console.log(`    marca op ${c.sr ? marcaOp(c.sr) : "(s/stock)"} · física ${normMarca(c.sr?.["Marca Pompeyo"] ?? c.sr?.["Marca"])} · ${c.sr?.["Modelo"] ?? c.fr["Vin"] ?? "—"}`);
  console.log(`    sucursal FNE: ${c.fr["Sucursal"] ?? "—"} · logística: ${c.rr?.["Sucursal"] ?? "—"} · cliente: ${c.fr["Nombre_Cliente"] ?? "—"}`);
  console.log(`    factura ${ymd(c.fr["FechaFactura"])} · entrega comprom. ${c.rr?.["FechaEstimadaEntrega"] ?? "—"} · estado FNE: ${c.est} · estado log: ${c.rr?.["Estado"]}/${c.rr?.["PasoActual"]}`);
  console.log(`    llegada sucursal (log): ${c.rr?.["FechaETASucursal"] ?? "—"}`);
  console.log(`    monto retenido ${fmt(num(c.fr["ValorFactura"]))} · saldo ${fmt(c.sal.saldo)} · C.Pompeyo ${fmt(c.sal.credito)}`);
  const accion = c.clase === "entrega real sin descarga FNE" ? "Descargar de FNE (entrega ya ocurrió)"
    : c.clase === "logística mal cerrada" ? "Revisar logística: ¿realmente entregado? corregir estado"
    : "Revisión manual: conciliar FNE vs entrega";
  console.log(`    → acción: ${accion}`);
}
console.log(`\n  TOTAL P1: ${p1.length} VIN · capital retenido ${fmt(p1Cap)}`);
const p1Clases = {}; for (const c of p1) p1Clases[c.clase] = (p1Clases[c.clase] ?? 0) + 1;
console.log(`  Clasificación: ${Object.entries(p1Clases).map(([k, v]) => `${k}=${v}`).join(" · ")}`);

// ════════════════════════════════════════════════════════════════════════════
// P2 · SUCURSAL INCONSISTENTE STOCK vs FNE
// ════════════════════════════════════════════════════════════════════════════
console.log(`\n\n${"═".repeat(78)}\n  P2 · SUCURSAL INCONSISTENTE STOCK vs FNE\n${"═".repeat(78)}`);
const NO_RETAIL = ["LOGISTICA","CPD","SEMINUEVO","BODEGA","AUTOSHOPPING","KAR","SCHIAPP","LONQUEN"];
function causa(sStock, sFne) {
  if (!up(sStock) || !up(sFne)) return "error de carga";
  if (NO_RETAIL.some((n) => up(sStock).includes(n))) return "stock en bodega/logística";
  const mS = marcaTok(sStock), mF = marcaTok(sFne);
  if (up(sFne).startsWith("OFICINA")) return "facturación desde oficina";
  if (mS && mF && mS === mF) return "traslado/intersucursal misma marca";
  if (mS && mF && mS !== mF) return "venta intersucursal (marca distinta)";
  return "pendiente validar";
}
const p2 = [];
for (const [vin, fr] of fneByVin) {
  const sr = stockByVin.get(vin); if (!sr) continue;
  if (!distintas(sr["Sucursal"], fr["Sucursal"])) continue;
  const rr = romaByVin.get(vin);
  p2.push({
    vin, sucStock: sr["Sucursal"], sucFne: fr["Sucursal"], sucLog: rr?.["Sucursal"] ?? null,
    marca: marcaOp(sr), modelo: sr["Modelo"], estado: fneEstado(fr),
    factura: fr["FechaFactura"], aging: dias(fr["FechaFactura"]), monto: num(fr["ValorFactura"]),
    causa: causa(sr["Sucursal"], fr["Sucursal"]),
  });
}
const p2Cap = p2.reduce((s, c) => s + c.monto, 0);
console.log(`  Total: ${p2.length} VIN · capital ${fmt(p2Cap)}`);

const grupo = (key, label) => {
  const m = new Map();
  for (const c of p2) { const k = c[key] ?? "—"; const e = m.get(k) ?? { n: 0, cap: 0 }; e.n++; e.cap += c.monto; m.set(k, e); }
  console.log(`\n── por ${label} ──`);
  for (const [k, e] of [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12))
    console.log(`  ${String(e.n).padStart(4)}  ${fmt(e.cap).padStart(16)}  ${k}`);
};
grupo("causa", "CAUSA probable");
grupo("marca", "marca operacional");
grupo("sucStock", "sucursal STOCK");
grupo("sucFne", "sucursal FNE");

// aging buckets
const ab = { "0-30": 0, "31-60": 0, "61-180": 0, "180+": 0, "sin": 0 };
for (const c of p2) { const a = c.aging; if (a == null) ab.sin++; else if (a <= 30) ab["0-30"]++; else if (a <= 60) ab["31-60"]++; else if (a <= 180) ab["61-180"]++; else ab["180+"]++; }
console.log(`\n── aging FNE ──\n  ${Object.entries(ab).map(([k, v]) => `${k}:${v}`).join(" · ")}`);

console.log(`\n── muestra (15 de mayor monto) ──`);
for (const c of [...p2].sort((a, b) => b.monto - a.monto).slice(0, 15))
  console.log(`  ${c.vin} ${c.marca.padEnd(11)} ${(c.modelo ?? "").slice(0,14).padEnd(14)} stock:${(c.sucStock ?? "—").padEnd(20)} fne:${(c.sucFne ?? "—").padEnd(20)} ${c.estado.padEnd(20)} ${String(c.aging ?? "—").padStart(4)}d ${fmt(c.monto).padStart(14)} [${c.causa}]`);
console.log("");
