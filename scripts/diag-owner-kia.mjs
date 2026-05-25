// Diagnóstico INDICATIVO del owner operacional (replica simplificada de
// obtenerOwnerOperacional en src/lib/selectors/marca-contexto.ts sobre el
// Base_Stock crudo). Sirve para validar que KIA deja de contaminarse con
// usados / otras marcas / renting / seminuevos.
//
// NO es el pipeline exacto de la app (no deriva naturaleza CPD ni canonicaliza
// marcas igual), pero usa los mismos campos y el mismo ORDEN de decisión.

import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const PATH =
  "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx";

const wb = XLSX.read(readFileSync(PATH), { type: "buffer", cellDates: true });
const ws = wb.Sheets["Base_Stock"];
const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });

const up = (v) => (v == null ? "" : String(v)).toUpperCase().trim();

// inferirMarcaOriginadoraDesdeSucursal (copiado de normalize.ts)
const MARCAS_INFERIBLES = [
  { needles: ["KIA"], canon: "KIA MOTORS" },
  { needles: ["MG"], canon: "MG" },
  { needles: ["PEUGEOT"], canon: "PEUGEOT" },
  { needles: ["GEELY"], canon: "GEELY" },
  { needles: ["DFSK"], canon: "DFSK" },
  { needles: ["SUBARU"], canon: "SUBARU" },
  { needles: ["NISSAN"], canon: "NISSAN" },
  { needles: ["CITROEN", "CITROËN"], canon: "CITROEN" },
  { needles: ["OPEL"], canon: "OPEL" },
  { needles: ["LANDKING"], canon: "LANDKING" },
  { needles: ["NAMMI"], canon: "NAMMI" },
  { needles: ["LEAP MOTOR", "LEAPMOTOR"], canon: "LEAPMOTOR" },
];
const SUC_NO_INFERIBLE = ["LOGISTICA POMPEYO", "SEMINUEVOS", "AUTOSHOPPING", "TEST CARS", "VN CON PATENTE", "CPD"];
function inferSuc(suc) {
  const u = up(suc);
  if (!u) return null;
  if (SUC_NO_INFERIBLE.some((n) => u.includes(n))) return null;
  for (const { needles, canon } of MARCAS_INFERIBLES) if (needles.some((n) => u.includes(n))) return canon;
  return null;
}

function canonMarcaPompeyo(m) {
  const u = up(m);
  if (u.includes("KIA")) return "KIA MOTORS";
  return u;
}

function owner(r) {
  const cond = up(r["Condicion de Stock"]);
  const tipo = up(r["Tipo de Stock"]);
  const suc = up(r["Sucursal"]);
  const estadoAutoPro = up(r["Estado AutoPro"]);
  const statusStock = up(r["Status Stock"]);
  const estadoDealer = up(r["Estado Dealer"]);
  const folio = r["Folio Retoma"];
  const tieneFolio = folio != null && String(folio).trim() !== "" && String(folio).trim() !== "0";
  const esVPP = estadoAutoPro === "PROCESO RETOMA" || (statusStock === "APROBADA" && tieneFolio);

  // 1) VPP / puente
  if (esVPP) {
    const inf = inferSuc(suc);
    return inf ?? "USADOS";
  }
  // 2) destinos propios (condición o sucursal)
  if (cond.includes("RENTING") || suc.includes("RENTING")) return "RENTING";
  if (cond.includes("COMPANY") || suc.includes("COMPANY") || tipo.includes("COMPAÑ") || tipo.includes("COMPAN")) return "COMPANY CAR";
  if (estadoDealer === "TEST CAR" || cond.includes("TEST CAR") || suc.includes("TEST CAR")) return "TEST CARS";
  // 3) usados
  if (tipo.includes("USADO") || cond.includes("USADO") || cond.startsWith("VU") || suc.includes("SEMINUEVO") || suc.includes("AUTOSHOPPING"))
    return "USADOS";
  // 4) VN marca
  const mp = canonMarcaPompeyo(r["Marca Pompeyo"] ?? r["Marca"]);
  return mp || "SIN OWNER";
}

let total = 0;
const ownerDist = new Map();
const kiaSuc = new Map();
let kiaUnid = 0;
let kiaCapital = 0;
// "Contaminación evitada": autos físicos KIA que NO son owner KIA
let kiaFisicoNoKia = 0;
const kiaFisicoNoKiaPorOwner = new Map();

for (const r of rows) {
  const vin = r["Numero VIN"];
  if (!vin) continue;
  total++;
  const o = owner(r);
  ownerDist.set(o, (ownerDist.get(o) ?? 0) + 1);
  const fisicoKia = up(r["Marca Pompeyo"] ?? r["Marca"]).includes("KIA");
  const costo = Number(r["Costo Neto"]) || 0;
  if (o === "KIA MOTORS") {
    kiaUnid++;
    kiaCapital += costo;
    const s = r["Sucursal"] ?? "(sin sucursal)";
    kiaSuc.set(s, (kiaSuc.get(s) ?? 0) + 1);
  }
  if (fisicoKia && o !== "KIA MOTORS") {
    kiaFisicoNoKia++;
    kiaFisicoNoKiaPorOwner.set(o, (kiaFisicoNoKiaPorOwner.get(o) ?? 0) + 1);
  }
}

console.log(`\n══ Base_Stock: ${total} vehículos con VIN ══`);

console.log(`\n── Distribución por OWNER OPERACIONAL ──`);
for (const [o, n] of [...ownerDist.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(o).padEnd(22)} ${String(n).padStart(5)}`);

console.log(`\n── KIA owner operacional ──`);
console.log(`  Unidades: ${kiaUnid}`);
console.log(`  Capital (costo neto): $${Math.round(kiaCapital).toLocaleString("es-CL")}`);

console.log(`\n── Sucursales que quedan en KIA owner ──`);
for (const [s, n] of [...kiaSuc.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(s).padEnd(34)} ${String(n).padStart(5)}`);

console.log(`\n── Contaminación EVITADA: autos físicos KIA que NO entran a KIA owner ──`);
console.log(`  Total: ${kiaFisicoNoKia} autos físicos KIA reasignados a su owner real`);
for (const [o, n] of [...kiaFisicoNoKiaPorOwner.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`  → ${String(o).padEnd(22)} ${String(n).padStart(5)}`);
