// Diagnóstico PROFUNDO del owner operacional KIA vs la referencia del negocio
// "Marca Pompeyo C = KIA MOTORS" (~553). Indicativo (no es el pipeline exacto),
// pero usa los mismos campos y orden de decisión.

import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const PATH =
  "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx";
const wb = XLSX.read(readFileSync(PATH), { type: "buffer", cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets["Base_Stock"], { defval: null, raw: true });

const up = (v) => (v == null ? "" : String(v)).toUpperCase().trim();
const G = (r, ...names) => {
  for (const n of names) if (r[n] != null) return r[n];
  return null;
};
const headers = rows[0] ? Object.keys(rows[0]) : [];
const H_MPC = headers.find((h) => up(h).startsWith("MARCA POMPEYO C")) ?? "Marca Pompeyo C.";
console.log("Header Marca Pompeyo C detectado:", JSON.stringify(H_MPC));

const MARCAS_INFERIBLES = [
  { needles: ["KIA"], canon: "KIA MOTORS" }, { needles: ["MG"], canon: "MG" },
  { needles: ["PEUGEOT"], canon: "PEUGEOT" }, { needles: ["GEELY"], canon: "GEELY" },
  { needles: ["DFSK"], canon: "DFSK" }, { needles: ["SUBARU"], canon: "SUBARU" },
  { needles: ["NISSAN"], canon: "NISSAN" }, { needles: ["CITROEN", "CITROËN"], canon: "CITROEN" },
  { needles: ["OPEL"], canon: "OPEL" }, { needles: ["LANDKING"], canon: "LANDKING" },
  { needles: ["NAMMI"], canon: "NAMMI" }, { needles: ["LEAP MOTOR", "LEAPMOTOR"], canon: "LEAPMOTOR" },
];
const SUC_NO_INFERIBLE = ["LOGISTICA POMPEYO", "SEMINUEVOS", "AUTOSHOPPING", "TEST CARS", "VN CON PATENTE", "CPD"];
function inferSuc(suc) {
  const u = up(suc); if (!u) return null;
  if (SUC_NO_INFERIBLE.some((n) => u.includes(n))) return null;
  for (const { needles, canon } of MARCAS_INFERIBLES) if (needles.some((n) => u.includes(n))) return canon;
  return null;
}
const canonMP = (m) => (up(m).includes("KIA") ? "KIA MOTORS" : up(m));

function owner(r) {
  const cond = up(G(r, "Condicion de Stock"));
  const tipo = up(G(r, "Tipo de Stock"));
  const condV = up(G(r, "Condicion Vehiculo"));
  const suc = up(G(r, "Sucursal"));
  const auxTM = up(G(r, "AUX TM"));
  const estadoAutoPro = up(G(r, "Estado AutoPro"));
  const statusStock = up(G(r, "Status Stock"));
  const folio = G(r, "Folio Retoma");
  const tieneFolio = folio != null && String(folio).trim() !== "" && String(folio).trim() !== "0";
  const esVPP = estadoAutoPro === "PROCESO RETOMA" || (statusStock === "APROBADA" && tieneFolio);
  if (esVPP) return inferSuc(suc) ?? "USADOS";
  // destinos NO retail por CLASIFICACIÓN (no por sucursal)
  if (cond.includes("RENTING")) return "RENTING";
  if (cond.includes("COMPANY") || tipo.includes("COMPAÑ") || tipo.includes("COMPAN")) return "COMPANY CAR";
  if (auxTM === "VDR") return "VDR";
  if (cond.includes("TEST CAR") || condV.includes("TEST CAR EN USO")) return "TEST CARS";
  if (tipo.includes("USADO") || cond.includes("USADO") || cond.startsWith("VU") || suc.includes("SEMINUEVO") || suc.includes("AUTOSHOPPING")) return "USADOS";
  return canonMP(G(r, "Marca Pompeyo") ?? G(r, "Marca"));
}

const inc = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const tally = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);

let total = 0, refMPC = 0, ownerKia = 0;
const ownerKiaPorMPC = new Map(), ownerKiaPorDealer = new Map(), ownerKiaPorCondStock = new Map();
const mpcKiaPeroNoOwner = new Map(), ownerKiaPeroNoMpc = new Map();
const fisicoKiaExcl = new Map();
const kiaSuc = new Map();
const testKia = new Map(), resciliacionKia = new Map(), logisticaMPC = new Map();

for (const r of rows) {
  if (!G(r, "Numero VIN")) continue;
  total++;
  const o = owner(r);
  const mpc = up(G(r, H_MPC));
  const dealer = up(G(r, "Estado Dealer"));
  const condV = up(G(r, "Condicion Vehiculo"));
  const condStock = up(G(r, "Condicion de Stock"));
  const suc = up(G(r, "Sucursal"));
  const fisicoKia = up(G(r, "Marca Pompeyo") ?? G(r, "Marca")).includes("KIA") || mpc.includes("KIA");
  if (mpc === "KIA MOTORS") refMPC++;
  if (o === "KIA MOTORS") {
    ownerKia++;
    inc(ownerKiaPorMPC, mpc || "(vacío)");
    inc(ownerKiaPorDealer, dealer || "(vacío)");
    inc(ownerKiaPorCondStock, condStock || "(vacío)");
    inc(kiaSuc, G(r, "Sucursal") ?? "(sin sucursal)");
    if (suc.includes("LOGISTICA")) inc(logisticaMPC, mpc || "(vacío)");
  }
  if (mpc === "KIA MOTORS" && o !== "KIA MOTORS") inc(mpcKiaPeroNoOwner, `${o} | dealer=${dealer} | cond=${condStock}`);
  if (o === "KIA MOTORS" && mpc !== "KIA MOTORS") inc(ownerKiaPeroNoMpc, mpc || "(vacío)");
  if (fisicoKia && o !== "KIA MOTORS") inc(fisicoKiaExcl, o);
  // test/tescar entre físicos KIA
  if (fisicoKia && (dealer === "TEST CAR" || condV.includes("TEST CAR") || condStock.includes("TEST CAR")))
    inc(testKia, `${o} | dealer=${dealer} | condV=${condV} | condStock=${condStock}`);
  // resciliación entre físicos KIA
  if (fisicoKia && dealer.includes("RESCIL")) inc(resciliacionKia, `${o} | dealer=${dealer}`);
}

console.log(`\n══ Total Base_Stock con VIN: ${total} ══`);
console.log(`\nReferencia negocio · "Marca Pompeyo C = KIA MOTORS": ${refMPC}`);
console.log(`Owner operacional == KIA MOTORS (lógica actual):     ${ownerKia}`);

console.log(`\n── owner KIA · por Marca Pompeyo C ──`); for (const [k, n] of tally(ownerKiaPorMPC)) console.log(`  ${String(k).padEnd(24)} ${n}`);
console.log(`\n── owner KIA · por Estado Dealer ──`); for (const [k, n] of tally(ownerKiaPorDealer)) console.log(`  ${String(k).padEnd(28)} ${n}`);
console.log(`\n── owner KIA · por Condicion de Stock ──`); for (const [k, n] of tally(ownerKiaPorCondStock)) console.log(`  ${String(k).padEnd(28)} ${n}`);

console.log(`\n── Marca Pompeyo C = KIA pero owner != KIA (¿excluyo retail KIA?) ──`); for (const [k, n] of tally(mpcKiaPeroNoOwner)) console.log(`  [${n}] ${k}`);
console.log(`\n── owner KIA pero Marca Pompeyo C != KIA (¿incluyo de más?) ──`); for (const [k, n] of tally(ownerKiaPeroNoMpc)) console.log(`  ${String(k).padEnd(24)} ${n}`);

console.log(`\n── Físicos KIA EXCLUIDOS · a qué owner van ──`); for (const [k, n] of tally(fisicoKiaExcl)) console.log(`  ${String(k).padEnd(22)} ${n}`);
console.log(`\n── TEST/TESCAR entre físicos KIA ──`); for (const [k, n] of tally(testKia)) console.log(`  [${n}] ${k}`);
console.log(`\n── RESCILIACION entre físicos KIA ──`); for (const [k, n] of tally(resciliacionKia)) console.log(`  [${n}] ${k}`);
console.log(`\n── owner KIA en LOGISTICA · por Marca Pompeyo C ──`); for (const [k, n] of tally(logisticaMPC)) console.log(`  ${String(k).padEnd(24)} ${n}`);
console.log(`\n── Sucursales finales owner KIA ──`); for (const [k, n] of tally(kiaSuc)) console.log(`  ${String(k).padEnd(34)} ${n}`);
