/**
 * VERIFICACIÓN · corrección de doble dimensión del capital puente.
 *
 * Read-only. Replica getMarcaOperacional (owner) y getMarcaOriginadora
 * (originador) y el nuevo filtro inclusivo (owner U originador) para confirmar,
 * sobre datos reales, que:
 *   - ANTES (owner-only): filtrar KIA → puente KIA = 0  (el bug)
 *   - DESPUÉS (owner U originador): filtrar KIA → puente KIA = su monto real
 *   - USADOS sigue viendo TODO el puente
 *   - el total macro NO cambia (sin doble conteo)
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const DIR = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";
const wb = XLSX.read(readFileSync(DIR + "Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx"), { type: "buffer", cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets["Base_Stock"], { defval: null, raw: true }).map((r) => {
  const o = {}; for (const [k, v] of Object.entries(r)) o[k.trim()] = v; return o;
});

const up = (s) => (s ?? "").toString().toUpperCase().trim();
const num = (v) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.-]/g, "")) || 0);
const fmtM = (n) => "$" + (n / 1e6).toFixed(1) + "M";

const SUC_NO_INF = ["LOGISTICA POMPEYO","SEMINUEVOS","AUTOSHOPPING","TEST CARS","VN CON PATENTE","CPD"];
const MARCAS_INF = [["KIA","KIA MOTORS"],["MG","MG"],["PEUGEOT","PEUGEOT"],["GEELY","GEELY"],["DFSK","DFSK"],["SUBARU","SUBARU"],["NISSAN","NISSAN"],["CITROEN","CITROEN"],["CITROËN","CITROEN"],["OPEL","OPEL"],["LANDKING","LANDKING"],["NAMMI","NAMMI"],["LEAP MOTOR","LEAPMOTOR"],["LEAPMOTOR","LEAPMOTOR"]];
const GRUPO = new Set(["KIA MOTORS","MG","GEELY","PEUGEOT","OPEL","CITROEN","DFSK","NISSAN","SUBARU","SUZUKI","GREAT WALL","LEAPMOTOR","LANDKING","NAMMI"]);
function inferSuc(suc){ const u=up(suc); if(!u||SUC_NO_INF.some(n=>u.includes(n)))return null; for(const[n,c]of MARCAS_INF)if(u.includes(n))return c; return null; }
function normMarca(raw){ const c=up(raw); if(!c)return "SIN MARCA ORIGEN"; if(c.includes("USADO")||c.includes("VU EN"))return "USADOS"; for(const[n,cc]of MARCAS_INF)if(c.includes(n))return cc; if(GRUPO.has(c))return c; return "OTRAS MARCAS"; }

function esVPP(r){ const ab=up(r["Stock A/B"]),d=up(r["Estado Dealer"]); if(ab==="JUDICIAL"||ab==="B")return false; if(["TEST CAR","TRASPASO A 3RO","PRE-INSCRITO"].includes(d))return false; if((r["Estado AutoPro"]??"")==="Proceso Retoma")return true; if((r["Status Stock"]??"")==="Aprobada"&&r["Folio Retoma"])return true; return false; }
function esUsado(r){ if(up(r["Unidad Negocio"])==="USADOS")return true; if(up(r["Condicion Vehiculo"]).includes("USADO"))return true; const mp=up(r["Marca Pompeyo"]); return mp==="USADOS"||mp==="VU EN NUEVOS"||mp==="VU EN USADOS"; }
// marcaOriginadora del parser: VPP/CPD/PROCESO → sucursal; resto → marcaPompeyo
function marcaOriginadora(r){ if(esVPP(r))return inferSuc(r["Sucursal"]); return r["Marca Pompeyo"]; }
// getMarcaOperacional (owner): usado → USADOS, sino originadora normalizada
function owner(r){ if(esUsado(r))return "USADOS"; return normMarca(marcaOriginadora(r)); }
// getMarcaOriginadora (financiero): siempre marcaOriginadora normalizada
function originador(r){ return normMarca(marcaOriginadora(r)); }

const vpp = rows.filter(esVPP);
const cap = (rs) => rs.reduce((s, r) => s + num(r["Costo Neto"]), 0);
const macroPuente = cap(vpp);

const marcas = ["KIA MOTORS","PEUGEOT","GEELY","MG","SUBARU","NISSAN","USADOS"];
console.log("\n════ PUENTE por marca: filtro OWNER-only (ANTES) vs OWNER∪ORIGINADOR (DESPUÉS) ════\n");
console.log("  marca".padEnd(16) + "owner-only".padStart(16) + "owner∪originador".padStart(20));
for (const m of marcas) {
  const ownerOnly = vpp.filter((r) => owner(r) === m);
  const incl = vpp.filter((r) => owner(r) === m || originador(r) === m);
  console.log(
    "  " + m.padEnd(14) +
    `${ownerOnly.length}u·${fmtM(cap(ownerOnly))}`.padStart(16) +
    `${incl.length}u·${fmtM(cap(incl))}`.padStart(20),
  );
}

console.log("\n════ CUADRATURA ════");
console.log(`  Macro puente total ........... ${vpp.length}u · ${fmtM(macroPuente)}`);
// USADOS inclusivo debe seguir capturando TODO el puente
const usadosIncl = vpp.filter((r) => owner(r) === "USADOS" || originador(r) === "USADOS");
console.log(`  Filtro USADOS (inclusivo) .... ${usadosIncl.length}u · ${fmtM(cap(usadosIncl))}  ${usadosIncl.length === vpp.length ? "✓ ve todo" : "✗"}`);
// Suma de puente por originador (cada VIN una vez) == macro (sin doble conteo)
const porOrig = new Map();
for (const r of vpp) { const o = originador(r); porOrig.set(o, (porOrig.get(o) ?? 0) + num(r["Costo Neto"])); }
const sumaOrig = [...porOrig.values()].reduce((a, b) => a + b, 0);
console.log(`  Σ puente por originador ...... ${fmtM(sumaOrig)}  ${Math.abs(sumaOrig - macroPuente) < 1 ? "✓ == macro (sin doble conteo)" : "✗ difiere"}`);
console.log(`  Σ unidades por originador .... ${vpp.length} (cada VIN una vez)`);
