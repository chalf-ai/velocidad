/**
 * AUDITORÍA · Capital puente KIA — clasificación correcta antes de tocar UI.
 * Read-only. Clasifica cada VU/BU KIA en: enriquecido_fne / base_stock_valido /
 * conciliacion_real, y cuenta la disponibilidad de cada señal base.
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";
const DIR = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";

const wbS = XLSX.read(readFileSync(DIR + "Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx"), { type: "buffer", cellDates: true });
const stock = XLSX.utils.sheet_to_json(wbS.Sheets["Base_Stock"], { defval: null, raw: true }).map((r) => { const o = {}; for (const [k, v] of Object.entries(r)) o[k.trim()] = v; return o; });
const wbF = XLSX.read(readFileSync(DIR + "Autos no entregados.xlsx"), { type: "buffer", cellDates: true });
const fne = XLSX.utils.sheet_to_json(wbF.Sheets["ROMA"], { defval: null, raw: true });

const up = (s) => (s ?? "").toString().toUpperCase().trim();
const normPat = (p) => up(p).replace(/[^A-Z0-9]/g, "");
const num = (v) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.-]/g, "")) || 0);
const fmtM = (n) => "$" + (n / 1e6).toFixed(1) + "M";
const SUC_NO_INF = ["LOGISTICA POMPEYO", "SEMINUEVOS", "AUTOSHOPPING", "TEST CARS", "VN CON PATENTE", "CPD"];
const MARCAS_INF = [["KIA", "KIA MOTORS"], ["MG", "MG"], ["PEUGEOT", "PEUGEOT"], ["GEELY", "GEELY"], ["DFSK", "DFSK"], ["SUBARU", "SUBARU"], ["NISSAN", "NISSAN"], ["CITROEN", "CITROEN"], ["CITROËN", "CITROEN"], ["OPEL", "OPEL"], ["LANDKING", "LANDKING"], ["NAMMI", "NAMMI"], ["LEAP MOTOR", "LEAPMOTOR"], ["LEAPMOTOR", "LEAPMOTOR"]];
function inferSuc(suc) { const u = up(suc); if (!u || SUC_NO_INF.some((n) => u.includes(n))) return null; for (const [n, c] of MARCAS_INF) if (u.includes(n)) return c; return null; }
function esVPP(r) {
  const ab = up(r["Stock A/B"]), d = up(r["Estado Dealer"]);
  if (ab === "JUDICIAL" || ab === "B") return false;
  if (["TEST CAR", "TRASPASO A 3RO", "PRE-INSCRITO"].includes(d)) return false;
  if ((r["Estado AutoPro"] ?? "") === "Proceso Retoma") return true;
  if ((r["Status Stock"] ?? "") === "Aprobada" && r["Folio Retoma"]) return true;
  return false;
}

// índice FNE
const fnePorPat = new Map(), fnePorFolio = new Map();
for (const f of fne) {
  const p = normPat(f["PatenteVpp"]); if (p && !fnePorPat.has(p)) fnePorPat.set(p, f);
  if (f["ID"] != null) { const k = String(f["ID"]); if (!fnePorFolio.has(k)) fnePorFolio.set(k, f); }
}

const vpp = stock.filter(esVPP);
const kia = vpp.filter((v) => inferSuc(v["Sucursal"]) === "KIA MOTORS");

function clasificar(v) {
  const pat = normPat(v["Placa Patente"]);
  const fnePat = pat ? fnePorPat.get(pat) : null;
  const folio = (v["Folio Venta"] && fnePorFolio.get(String(v["Folio Venta"]))) || (v["Folio Retoma"] && fnePorFolio.get(String(v["Folio Retoma"]))) || null;
  const conFne = !!(fnePat || folio);
  const tipoBU = /NUEVO|USADO/.test(up(v["Marca Pompeyo"]));
  const baseSuf = !!v["Fecha Retoma"] || !!v["Folio Retoma"] || !!v["Placa Patente"] || tipoBU;
  if (conFne) return "enriquecido_fne";
  if (baseSuf) return "base_stock_valido";
  return "conciliacion_real";
}

function reporte(titulo, set) {
  const cap = set.reduce((s, v) => s + num(v["Costo Neto"]), 0);
  const c = { enriquecido_fne: 0, base_stock_valido: 0, conciliacion_real: 0 };
  let conPat = 0, conFolioCruce = 0, conFechaRetoma = 0, conFolioRetoma = 0, conPatente = 0, conTipoBU = 0;
  for (const v of set) {
    c[clasificar(v)]++;
    const pat = normPat(v["Placa Patente"]);
    if (pat && fnePorPat.get(pat)) conPat++;
    if ((v["Folio Venta"] && fnePorFolio.get(String(v["Folio Venta"]))) || (v["Folio Retoma"] && fnePorFolio.get(String(v["Folio Retoma"])))) conFolioCruce++;
    if (v["Fecha Retoma"]) conFechaRetoma++;
    if (v["Folio Retoma"]) conFolioRetoma++;
    if (v["Placa Patente"]) conPatente++;
    if (/NUEVO|USADO/.test(up(v["Marca Pompeyo"]))) conTipoBU++;
  }
  console.log(`\n════ ${titulo} ════`);
  console.log(`  Total ......................... ${set.length} u · ${fmtM(cap)}`);
  console.log(`  enriquecido_fne (cruce real) .. ${c.enriquecido_fne}`);
  console.log(`  base_stock_valido (sin FNE) ... ${c.base_stock_valido}`);
  console.log(`  conciliacion_real ............. ${c.conciliacion_real}`);
  console.log(`  ── señales base ──`);
  console.log(`  cruce PatenteVpp .............. ${conPat}`);
  console.log(`  cruce folio ................... ${conFolioCruce}`);
  console.log(`  con Fecha Retoma .............. ${conFechaRetoma}`);
  console.log(`  con Folio Retoma .............. ${conFolioRetoma}`);
  console.log(`  con Patente ................... ${conPatente}`);
  console.log(`  con Tipo BU (Marca Pompeyo) ... ${conTipoBU}`);
}

reporte("CAPITAL PUENTE KIA (originador)", kia);
reporte("CAPITAL PUENTE TOTAL", vpp);
