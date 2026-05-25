/**
 * VALIDACIÓN · integración logística al caso operacional.
 * Replica la lógica de src/lib/logistica/modelo.ts sobre los archivos reales y
 * responde los 9 entregables. Solo lee.
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const DIR = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";
const read = (f, sheet) => {
  const wb = XLSX.read(readFileSync(DIR + f), { type: "buffer", cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet ?? wb.SheetNames[0]], { defval: null, raw: true });
};
const up = (s) => (s ?? "").toString().toUpperCase().trim();
const limpiarVIN = (raw) => raw == null ? "" :
  String(raw).replace(/\s+/g, "").replace(/[-_./]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const HOY = new Date("2026-05-23");
const pDMY = (s) => { const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(s ?? "").trim()); if (!m) return null; const [, d, mo, y] = m; if (d === "00" || mo === "00" || y === "0000") return null; const dt = new Date(+y, +mo - 1, +d); return isNaN(dt) ? null : dt; };
const asDate = (v) => (v instanceof Date && !isNaN(v) ? v : null);
const days = (a, b) => (a && b ? Math.round((b - a) / 86400000) : null);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

const SLA = { resp: { o: 2, a: 12 }, apc: { o: 5, a: 20 }, desp: { o: 5, a: 12 }, tran: { o: 3, a: 6 }, fac: { o: 12, a: 26 }, sol: { o: 12, a: 22 } };

// ── construir operaciones por VIN ───────────────────────────────────────────
const roma = read("Diciembre-Mayo ROMA.xlsx", "ROMA");
const stli = read("Logistica.xlsx", "Hoja2");
const stockVins = new Set(read("Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx", "Base_Stock").map((r) => limpiarVIN(r["Numero VIN"])).filter(Boolean));
const fneVins = new Set(read("Autos no entregados.xlsx").map((r) => limpiarVIN(r["Vin"])).filter(Boolean));

const romaByVin = new Map();
for (const r of roma) { const k = limpiarVIN(r["Vin"]); if (!k) continue; const f = pDMY(r["FechaSolicitud"]); const prev = romaByVin.get(k); if (!prev || (f?.getTime() ?? -1) > (prev._f?.getTime() ?? -1)) romaByVin.set(k, { ...r, _f: f }); }
const stliByVin = new Map();
for (const s of stli) { const k = limpiarVIN(s["VIN"]); if (!k) continue; if (!stliByVin.has(k)) stliByVin.set(k, s); }

const ops = [];
for (const vin of new Set([...romaByVin.keys(), ...stliByVin.keys()])) {
  const r = romaByVin.get(vin) ?? null, s = stliByVin.get(vin) ?? null;
  ops.push({
    vin,
    marca: r?.["Marca"] ?? s?.["Marca"] ?? null,
    sucursalDestino: s?.["Sucursal Destino"] ?? r?.["Sucursal"] ?? null,
    tipoSolicitud: s?.["Tipo solicitud"] ?? null,
    fSolicitud: r ? pDMY(r["FechaSolicitud"]) : null,
    fRespuesta: r ? pDMY(r["fecha_RespuestaGestionLogistica"]) : null,
    fIngresoApc: s ? asDate(s["Fecha Ingreso APC"]) : null,
    fSolicitudBodega: s ? asDate(s["Fecha de solicitud a STLI"]) : null,
    fPlanificacion: s ? asDate(s["Fecha Planificacion STLI"]) : null,
    fDespacho: s ? asDate(s["Fecha despacho a sucursal"]) : null,
    fLlegada: r ? pDMY(r["FechaETASucursal"]) : null,
    fFactura: r ? pDMY(r["FechaFactura"]) : null,
    fInscripcion: r ? pDMY(r["FechaEnprocesoIns"]) : null,
    fEntregaComprometida: r ? pDMY(r["FechaEstimadaEntrega"]) : null,
    estadoArchivo: r?.["Estado"] ?? null,
    pasoActual: r?.["PasoActual"] ?? null,
    cumplimiento: s?.["Cumplimiento despacho"] ?? null,
    enStock: stockVins.has(vin),
    enFNE: fneVins.has(vin),
  });
}

// ── lógica (réplica modelo.ts) ──────────────────────────────────────────────
function estadoLog(o) {
  if (up(o.estadoArchivo) === "ANULADA") return "anulada";
  if (up(o.estadoArchivo) === "REALIZADA" || up(o.pasoActual) === "FINALIZADA") return "entregada";
  if (o.fLlegada) return o.fInscripcion ? "en_sucursal_sin_entregar" : "esperando_inscripcion";
  if (o.fDespacho) return "en_transito";
  if (o.fSolicitudBodega) return "esperando_despacho";
  if (o.fIngresoApc) return "en_preparacion_apc";
  if (o.fSolicitud && !o.fRespuesta) return "esperando_respuesta_logistica";
  if (up(o.pasoActual).includes("JEFE SUCURSAL")) return "esperando_jefe_sucursal";
  return "desconocido";
}
function refEtapa(o, e) {
  switch (e) { case "en_sucursal_sin_entregar": case "esperando_inscripcion": return o.fLlegada;
    case "en_transito": return o.fDespacho; case "esperando_despacho": return o.fSolicitudBodega;
    case "en_preparacion_apc": return o.fIngresoApc; case "esperando_respuesta_logistica": case "esperando_jefe_sucursal": return o.fSolicitud; default: return null; }
}
function bloqueos(o) {
  const e = estadoLog(o); const b = [];
  if (e === "entregada" || e === "anulada") return b;
  if (o.fIngresoApc && !o.fSolicitudBodega && (days(o.fIngresoApc, HOY) ?? 0) > SLA.apc.o) b.push("auto_listo_no_solicitado");
  if (o.fSolicitud && !o.fRespuesta && (days(o.fSolicitud, HOY) ?? 0) > SLA.resp.o) b.push("sin_respuesta_logistica");
  if (up(o.cumplimiento) === "NO CUMPLIDO") b.push("despacho_incumplido");
  if (o.fDespacho && !o.fLlegada && (days(o.fDespacho, HOY) ?? 0) > SLA.tran.a) b.push("transito_prolongado");
  if (o.fLlegada) b.push("llegado_no_entregado");
  if ((o.fFactura || o.fLlegada) && !o.fInscripcion) b.push("inscripcion_pendiente");
  if (o.fEntregaComprometida && o.fEntregaComprometida.getTime() < HOY.getTime()) b.push("eta_vencida");
  if (up(o.pasoActual).includes("JEFE SUCURSAL")) b.push("jefe_sucursal_no_responde");
  if (up(o.estadoArchivo) === "PENDIENTE" && (days(o.fSolicitud, HOY) ?? 0) > 30) b.push("pendiente_estancado");
  return b;
}
function ultimoMov(o) {
  const fs = [o.fSolicitud, o.fRespuesta, o.fIngresoApc, o.fSolicitudBodega, o.fPlanificacion, o.fDespacho, o.fLlegada, o.fFactura, o.fInscripcion].filter(Boolean);
  return fs.length ? new Date(Math.max(...fs.map((d) => d.getTime()))) : null;
}
function higiene(o) {
  const e = estadoLog(o);
  if (e === "entregada" || e === "anulada") return "cerrado";
  const sm = days(ultimoMov(o), HOY);
  if (sm == null) return "estancado";
  if (sm > 90) return "abandonado"; if (sm > 30) return "estancado"; return "activo";
}
function score(o) {
  const e = estadoLog(o);
  const aging = (e === "entregada" || e === "anulada") ? null : days(refEtapa(o, e), HOY);
  const b = bloqueos(o);
  const pAging = clamp01((aging ?? 0) / 30) * 35;
  const pBloq = clamp01(b.length / 3) * 30;
  const tr = [[o.fSolicitud, o.fRespuesta, SLA.resp.a], [o.fSolicitudBodega, o.fDespacho, SLA.desp.a], [o.fDespacho, o.fLlegada, SLA.tran.a], [o.fFactura, o.fEntregaComprometida, SLA.fac.a]];
  let inc = 0, med = 0; for (const [a, c, al] of tr) { const d = days(a, c); if (d == null) continue; med++; if (d > al) inc++; }
  const pSla = (med ? inc / med : 0) * 20;
  const pCump = (up(o.cumplimiento) === "NO CUMPLIDO" ? 1 : 0) * 15;
  return Math.round(Math.max(0, 100 - pAging - pBloq - pSla - pCump));
}

const BLOQUEO_OWNER = { auto_listo_no_solicitado: "Bodega/vendedor", sin_respuesta_logistica: "Logística", despacho_incumplido: "Bodega (STLI)", transito_prolongado: "Logística/transporte", llegado_no_entregado: "Sucursal", inscripcion_pendiente: "Inscripción/CdN", eta_vencida: "Vendedor", jefe_sucursal_no_responde: "Jefe sucursal", pendiente_estancado: "Vendedor/sucursal" };

// ── REPORTE ─────────────────────────────────────────────────────────────────
const live = ops.filter((o) => o.enFNE || o.enStock);
console.log(`\n══ UNIVERSO ══`);
console.log(`  Operaciones logísticas (VINs únicos): ${ops.length}`);
console.log(`  Vivas (en FNE o stock actual): ${live.length}  (FNE ${ops.filter(o=>o.enFNE).length} · stock ${ops.filter(o=>o.enStock).length})`);

// Cobertura del universo VIVO (cuántos VIN vivos reciben/no reciben logística).
const opVins = new Set(ops.map((o) => o.vin));
const fneConLog = [...fneVins].filter((v) => opVins.has(v)).length;
const stockConLog = [...stockVins].filter((v) => opVins.has(v)).length;
console.log(`\n══ 1 & 6 · COBERTURA universo vivo ══`);
console.log(`  FNE: ${fneVins.size} VIN · con logística ${fneConLog} (${Math.round(fneConLog/fneVins.size*100)}%) · sin cruce ${fneVins.size - fneConLog}`);
console.log(`  Stock: ${stockVins.size} VIN · con logística ${stockConLog} (${Math.round(stockConLog/stockVins.size*100)}%) · sin cruce ${stockVins.size - stockConLog}`);

console.log(`\n══ 4 · BLOQUEOS detectados (todos / vivos) ══`);
const bCount = new Map(), bLive = new Map();
for (const o of ops) for (const b of bloqueos(o)) bCount.set(b, (bCount.get(b) ?? 0) + 1);
for (const o of live) for (const b of bloqueos(o)) bLive.set(b, (bLive.get(b) ?? 0) + 1);
for (const [b, n] of [...bCount.entries()].sort((a, c) => c[1] - a[1]))
  console.log(`  ${b.padEnd(26)} ${String(n).padStart(5)}  vivos:${bLive.get(b) ?? 0}  owner:${BLOQUEO_OWNER[b]}`);

console.log(`\n══ 7 · HIGIENE operacional (basura histórica) ══`);
const hCount = new Map(); for (const o of ops) hCount.set(higiene(o), (hCount.get(higiene(o)) ?? 0) + 1);
for (const [h, n] of [...hCount.entries()].sort((a, c) => c[1] - a[1])) console.log(`  ${h.padEnd(12)} ${String(n).padStart(5)}`);
const pend = ops.filter((o) => up(o.estadoArchivo) === "PENDIENTE");
console.log(`  → De ${pend.length} "Pendiente": abandonado ${pend.filter(o=>higiene(o)==="abandonado").length} · estancado ${pend.filter(o=>higiene(o)==="estancado").length} · activo ${pend.filter(o=>higiene(o)==="activo").length}`);

console.log(`\n══ 3 · SLA por tramo (días: prom/p50/p95/máx · %incumpl) ══`);
function slaStats(label, arr, alerta) {
  const xs = arr.filter((x) => x != null && x >= 0).sort((a, b) => a - b);
  if (!xs.length) { console.log(`  ${label.padEnd(26)} (sin datos)`); return; }
  const prom = (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1);
  const p = (q) => xs[Math.min(xs.length - 1, Math.floor(q * xs.length))];
  const inc = Math.round(xs.filter((x) => x > alerta).length / xs.length * 100);
  console.log(`  ${label.padEnd(26)} ${String(prom).padStart(5)} / ${String(p(.5)).padStart(3)} / ${String(p(.95)).padStart(3)} / ${String(xs[xs.length-1]).padStart(4)}   ${inc}%`);
}
slaStats("APC→solicitud bodega", ops.map(o => days(o.fIngresoApc, o.fSolicitudBodega)), SLA.apc.a);
slaStats("solicitud→despacho", ops.map(o => days(o.fSolicitudBodega, o.fDespacho)), SLA.desp.a);
slaStats("despacho→llegada", ops.map(o => days(o.fDespacho, o.fLlegada)), SLA.tran.a);
slaStats("factura→entrega", ops.map(o => days(o.fFactura, o.fEntregaComprometida)), SLA.fac.a);
slaStats("solicitud→entrega", ops.map(o => days(o.fSolicitud, o.fEntregaComprometida)), SLA.sol.a);

const criticosAll = live.map(o => ({ o, sc: score(o), b: bloqueos(o), e: estadoLog(o), h: higiene(o) })).filter(x => x.b.length > 0);
console.log(`\n══ 2 · COLA "Bloqueo logístico" (vivos con ≥1 bloqueo) ══`);
console.log(`  ${criticosAll.length} VIN vivos entran a la cola de Centro de Acción`);
console.log(`  ETA vencida: ${live.filter(o=>bloqueos(o).includes("eta_vencida")).length} · despacho incumplido: ${live.filter(o=>bloqueos(o).includes("despacho_incumplido")).length} · estancado/abandonado: ${live.filter(o=>["estancado","abandonado"].includes(higiene(o))).length}`);
console.log(`\n══ 6 · VIN CRÍTICOS por logística (vivos, peor score) ══`);
const criticos = criticosAll.sort((a, c) => a.sc - c.sc).slice(0, 12);
for (const x of criticos)
  console.log(`  ${x.o.vin}  sc:${String(x.sc).padStart(3)}  ${x.o.enFNE ? "FNE" : "stk"}  ${x.e.padEnd(26)} [${x.b.join(",")}]`);

console.log(`\n══ 8 · OWNERSHIP logístico (responsable del bloqueo dominante, vivos) ══`);
const PRIO = ["eta_vencida","llegado_no_entregado","despacho_incumplido","auto_listo_no_solicitado","sin_respuesta_logistica","transito_prolongado","inscripcion_pendiente","jefe_sucursal_no_responde","pendiente_estancado"];
const own = new Map();
for (const o of live) { const b = bloqueos(o); if (!b.length) continue; const dom = PRIO.find(p => b.includes(p)) ?? b[0]; own.set(BLOQUEO_OWNER[dom], (own.get(BLOQUEO_OWNER[dom]) ?? 0) + 1); }
for (const [k, n] of [...own.entries()].sort((a, c) => c[1] - a[1])) console.log(`  ${k.padEnd(22)} ${n}`);

console.log("");
