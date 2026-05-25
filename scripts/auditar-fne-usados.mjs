/**
 * AUDITORÍA · ¿Qué campos permiten detectar FNE de USADOS?
 *
 * El archivo FNE no trae "marca". Para atribuir FNE a la unidad USADOS hay que
 * usar reglas operacionales. Este script mide el rendimiento de cada regla sobre
 * el archivo real, sin inventar. Solo lee, no modifica.
 *
 * Reglas candidatas (las pedidas):
 *   1. sucursal seminuevos / usados / CPD / autoshopping / outlet
 *   2. unidad de negocio (si existe la columna)
 *   3/4. VIN cruzado contra Base_Stock con esUsadoOperacional
 *   5. vendedor / equipo de usados (si se distingue)
 *   6. tipo de vehículo vendido usado (si existe columna)
 *   7. folio / negocio asociado a usado (si existe marcador)
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const DIR = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";
const read = (f, sheet) => {
  const wb = XLSX.read(readFileSync(DIR + f), { type: "buffer", cellDates: true });
  const sh = sheet ?? wb.SheetNames[0];
  return { rows: XLSX.utils.sheet_to_json(wb.Sheets[sh], { defval: null, raw: true }), sheet: sh, sheets: wb.SheetNames };
};
const up = (s) => (s ?? "").toString().toUpperCase().trim();
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const fmt = (n) => "$" + Math.round(n).toLocaleString("es-CL");
const limpiarVIN = (raw) => {
  if (raw == null) return "";
  return String(raw)
    .replace(/\s+/g, "")
    .replace(/[-_./]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
};

// ── FNE ───────────────────────────────────────────────────────────────────
const { rows: fne, sheet, sheets } = read("Autos no entregados.xlsx");
const cols = fne[0] ? Object.keys(fne[0]) : [];
console.log(`\n══ FNE: "${sheet}" de [${sheets.join(", ")}] · ${fne.length} filas ══`);
console.log(`\n── Columnas (${cols.length}) ──\n  ${cols.join("\n  ")}`);

// localizar columnas clave por nombre flexible
const find = (...needles) => cols.find((c) => needles.some((n) => up(c).includes(n)));
const colSuc = find("SUCURSAL");
const colVin = find("VIN");
const colVend = find("VENDEDOR");
const colVal = find("FACTURA") && cols.find((c) => up(c).includes("VALOR")) || find("VALORFACTURA", "VALOR FACTURA", "MONTO");
const colUnidad = find("UNIDAD", "NEGOCIO", "U.NEG");
const colTipo = find("TIPO VEH", "TIPOVEH", "CONDICION", "USADO", "NUEVO");
const colFolio = find("FOLIO", "NEGOCIO", "OPERACION");
console.log(`\n── Columnas detectadas ──`);
console.log(`  sucursal=${colSuc||"—"} · vin=${colVin||"—"} · vendedor=${colVend||"—"} · valor=${colVal||"—"}`);
console.log(`  unidadNegocio=${colUnidad||"NO EXISTE"} · tipoVehiculo=${colTipo||"NO EXISTE"} · folio/negocio=${colFolio||"—"}`);

const valor = (r) => num(colVal ? r[colVal] : 0);

// ── Base_Stock para cruce por VIN ──────────────────────────────────────────
const { rows: stock } = read("Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx", "Base_Stock");
function esUsadoStock(r) {
  if (up(r["Unidad Negocio"]) === "USADOS") return true;
  if (up(r["Condicion Vehiculo"]).includes("USADO")) return true;
  const mp = up(r["Marca Pompeyo"]);
  return mp === "USADOS" || mp === "VU EN NUEVOS" || mp === "VU EN USADOS";
}
const stockByVin = new Map(); // vinLimpio → {usado:boolean, marcaPompeyo, unidad}
for (const r of stock) {
  const k = limpiarVIN(r["Numero VIN"]);
  if (k && !stockByVin.has(k)) stockByVin.set(k, { usado: esUsadoStock(r), mp: up(r["Marca Pompeyo"]), un: up(r["Unidad Negocio"]) });
}

// ── REGLA 1 · sucursal usados ──────────────────────────────────────────────
const PAT_SUC = ["SEMINUEVO", "USADO", "CPD", "AUTOSHOPPING", "OUTLET"];
const esSucUsado = (r) => { const s = up(colSuc ? r[colSuc] : ""); return PAT_SUC.some((p) => s.includes(p)); };

// distribución de sucursales (para ver qué hay)
const sucDist = new Map();
for (const r of fne) { const s = (colSuc ? r[colSuc] : null) ?? "(vacío)"; sucDist.set(s, (sucDist.get(s) ?? 0) + 1); }
console.log(`\n── Sucursales FNE (top 30) ──`);
for (const [s, n] of [...sucDist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30))
  console.log(`  ${n.toString().padStart(4)}  ${esSucUsado({ [colSuc]: s }) ? "★USADO " : "       "}${s}`);

// ── REGLA 3/4 · VIN cruzado a stock usado ──────────────────────────────────
let vinMatch = 0, vinUsado = 0, vinNuevo = 0, vinNoMatch = 0;
for (const r of fne) {
  const k = limpiarVIN(colVin ? r[colVin] : "");
  const hit = stockByVin.get(k);
  if (!hit) { vinNoMatch++; continue; }
  vinMatch++;
  if (hit.usado) vinUsado++; else vinNuevo++;
}

// ── REGLA 5 · vendedor usados ──────────────────────────────────────────────
const vendUsadoPat = ["USADO", "SEMINUEVO"];
const esVendUsado = (r) => { const v = up(colVend ? r[colVend] : ""); return vendUsadoPat.some((p) => v.includes(p)); };
const conVendUsado = fne.filter(esVendUsado).length;

// ── DETECCIÓN COMBINADA + overlap ──────────────────────────────────────────
const det = fne.map((r) => {
  const k = limpiarVIN(colVin ? r[colVin] : "");
  const hit = stockByVin.get(k);
  return {
    r,
    porVin: !!(hit && hit.usado),
    porSuc: esSucUsado(r),
    porVend: esVendUsado(r),
  };
});
const porVinSet = det.filter((d) => d.porVin);
const porSucSet = det.filter((d) => d.porSuc);
const union = det.filter((d) => d.porVin || d.porSuc);
const inter = det.filter((d) => d.porVin && d.porSuc);
const soloVin = det.filter((d) => d.porVin && !d.porSuc);
const soloSuc = det.filter((d) => !d.porVin && d.porSuc);

console.log(`\n══ RENDIMIENTO DE CADA REGLA ══`);
console.log(`  Regla 1 (sucursal usados):       ${porSucSet.length} FNE · ${fmt(porSucSet.reduce((s, d) => s + valor(d.r), 0))}`);
console.log(`  Regla 2 (unidad negocio):        ${colUnidad ? "columna existe" : "NO HAY COLUMNA → no aplicable"}`);
console.log(`  Regla 3/4 (VIN → stock usado):   ${porVinSet.length} FNE · ${fmt(porVinSet.reduce((s, d) => s + valor(d.r), 0))}`);
console.log(`     (de ${fne.length} FNE: ${vinMatch} cruzan stock [${vinUsado} usado / ${vinNuevo} nuevo], ${vinNoMatch} sin match)`);
console.log(`  Regla 5 (vendedor usados):       ${conVendUsado} FNE`);
console.log(`  Regla 6 (tipo vehículo usado):   ${colTipo ? "columna existe" : "NO HAY COLUMNA → no aplicable"}`);
console.log(`  Regla 7 (folio/negocio usado):   ${colFolio ? `columna ${colFolio} (sin marcador usado evidente)` : "NO HAY COLUMNA"}`);

console.log(`\n══ OVERLAP (VIN vs sucursal) ══`);
console.log(`  Unión (VIN ∪ sucursal):          ${union.length} FNE · ${fmt(union.reduce((s, d) => s + valor(d.r), 0))}`);
console.log(`  Intersección (VIN ∩ sucursal):   ${inter.length}`);
console.log(`  Solo VIN (no sucursal usado):    ${soloVin.length}`);
console.log(`  Solo sucursal (VIN no usado/sin match): ${soloSuc.length}`);

// ── Detalle de la UNIÓN: monto, estado, aging, sucursal ─────────────────────
const colSolEnt = find("SOL_ENTREGA", "SOLENTREGA", "SOL ENTREGA");
const colAutoriz = find("AUTORIZACION", "AUTORIZA");
const colFechaFac = find("FECHA_FACTURA", "FECHAFACTURA", "FECHA FACTURA", "F.FACTURA");
const colPatRec = find("RECIBID");
const hoy = new Date("2026-05-23");
const dias = (d) => { const t = d instanceof Date ? d : new Date(d); return isNaN(t) ? null : Math.floor((hoy - t) / 86400000); };
console.log(`\n── Detalle UNIÓN FNE usados ──`);
console.log(`  Total: ${union.length} · monto ${fmt(union.reduce((s, d) => s + valor(d.r), 0))}`);
if (colFechaFac) {
  const ds = union.map((d) => dias(d.r[colFechaFac])).filter((x) => x != null);
  if (ds.length) {
    ds.sort((a, b) => a - b);
    const prom = Math.round(ds.reduce((a, b) => a + b, 0) / ds.length);
    console.log(`  Aging factura: prom ${prom}d · máx ${ds[ds.length - 1]}d · >30d: ${ds.filter((x) => x > 30).length} · >60d: ${ds.filter((x) => x > 60).length}`);
  }
}
const sucU = new Map();
for (const d of union) { const s = (colSuc ? d.r[colSuc] : null) ?? "(vacío)"; sucU.set(s, (sucU.get(s) ?? 0) + 1); }
console.log(`  Por sucursal:`);
for (const [s, n] of [...sucU.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15))
  console.log(`     ${n.toString().padStart(4)}  ${s}`);

// ── ESTADO DE ENTREGA (réplica de deriveEstadoEntrega) ──────────────────────
const isDate = (v) => v instanceof Date && !isNaN(v);
function estadoEntrega(r) {
  const recibida = isDate(r["fecha_patente_recibida"]);
  const sol = up(r["sol_entrega"]) === "SI";
  const aut = up(r["autorizacion_entrega"]) === "SI";
  if (recibida) {
    if (sol && aut) return "listo_para_entregar";
    if (sol && !aut) return "falta_solo_autorizacion";
    return "patente_en_sucursal";
  }
  if (isDate(r["fecha_patente_enviada"])) return "patente_en_transito";
  if (isDate(r["patentes_administracion"])) return "patente_en_admin";
  if (isDate(r["FechaInscripcion"])) return "inscrita_sin_admin";
  if (isDate(r["FechaSolicitudInscripcion"])) return "en_registro_civil";
  if (up(r["SolicitarInscripcion"]) === "SI") return "en_control_negocios";
  return "sin_solicitud_inscripcion";
}
const BLOQUEO = new Set(["falta_solo_autorizacion", "patente_en_sucursal"]);
const estMap = new Map();
let listos = 0, listosVal = 0, bloq = 0, bloqVal = 0;
for (const d of union) {
  const e = estadoEntrega(d.r);
  const cur = estMap.get(e) ?? { n: 0, val: 0 };
  cur.n++; cur.val += valor(d.r); estMap.set(e, cur);
  if (e === "listo_para_entregar") { listos++; listosVal += valor(d.r); }
  if (BLOQUEO.has(e)) { bloq++; bloqVal += valor(d.r); }
}
console.log(`\n══ PANEL FNE USADOS (lo que mostrará /usados) ══`);
console.log(`  Total: ${union.length} u · ${fmt(union.reduce((s, d) => s + valor(d.r), 0))}`);
console.log(`  Listos para entregar: ${listos} u · ${fmt(listosVal)}`);
console.log(`  Bloqueados (trámite interno): ${bloq} u · ${fmt(bloqVal)}`);
console.log(`  Por estado de entrega:`);
for (const [e, v] of [...estMap.entries()].sort((a, b) => b[1].n - a[1].n))
  console.log(`     ${e.padEnd(26)} ${v.n.toString().padStart(3)} u · ${fmt(v.val)}`);

// muestra de "solo VIN" para entender qué sucursales tienen (FNE usado en sucursal de marca)
if (soloVin.length) {
  console.log(`\n  Muestra "solo VIN" (FNE usado vendido en sucursal de marca, no en usados):`);
  const sm = new Map();
  for (const d of soloVin) { const s = (colSuc ? d.r[colSuc] : null) ?? "(vacío)"; sm.set(s, (sm.get(s) ?? 0) + 1); }
  for (const [s, n] of [...sm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10))
    console.log(`     ${n.toString().padStart(4)}  ${s}`);
}

console.log("");
