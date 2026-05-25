import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const buf = readFileSync("/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Autos no entregados.xlsx");
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets["ROMA"], { defval: null, raw: true });

const has = (v) => v !== null && v !== undefined && v !== "";
const isSi = (v) => v === "Si" || v === "si" || v === "SI";

let listo = 0;
let faltaAut = 0;
let patSucursal = 0;
let patTransito = 0;
let patAdmin = 0;
let inscritaSinAdmin = 0; // fechaInscripcion ≠ null pero patentes_administracion = null
let enRegistroCivil = 0; // FechaSolicitudInscripcion ≠ null pero FechaInscripcion = null
let enControlNegocios = 0; // SolicitarInscripcion=Si pero FechaSolicitudInscripcion = null
let sinSolicitud = 0; // SolicitarInscripcion ≠ Si

for (const r of rows) {
  const patRec = has(r.fecha_patente_recibida);
  const patEnv = has(r.fecha_patente_enviada);
  const patAdm = has(r.patentes_administracion);
  const fInscr = has(r.FechaInscripcion);
  const fSolInscr = has(r.FechaSolicitudInscripcion);
  const solInscrSi = isSi(r.SolicitarInscripcion);

  if (patRec) {
    if (isSi(r.sol_entrega) && isSi(r.autorizacion_entrega)) listo++;
    else if (isSi(r.sol_entrega) && !isSi(r.autorizacion_entrega)) faltaAut++;
    else patSucursal++;
  } else if (patEnv) {
    patTransito++;
  } else if (patAdm) {
    patAdmin++;
  } else if (fInscr) {
    inscritaSinAdmin++;
  } else if (fSolInscr) {
    enRegistroCivil++;
  } else if (solInscrSi) {
    enControlNegocios++;
  } else {
    sinSolicitud++;
  }
}

const buckets = {
  listo,
  faltaAut,
  patSucursal,
  patTransito,
  patAdmin,
  inscritaSinAdmin,
  enRegistroCivil,
  enControlNegocios,
  sinSolicitud,
};
const total = Object.values(buckets).reduce((a, b) => a + b, 0);

console.log("Buckets:");
for (const [k, v] of Object.entries(buckets)) {
  console.log(`  ${k.padEnd(20)} ${String(v).padStart(4)} ${(v / rows.length * 100).toFixed(1)}%`);
}
console.log(`  ${"".padEnd(20)} ----`);
console.log(`  ${"total".padEnd(20)} ${String(total).padStart(4)}  (esperado ${rows.length})`);
console.log(`  ${"cuadra?".padEnd(20)} ${total === rows.length ? "✓" : "✗"}`);

// también ver distribución cruda de SolicitarInscripcion y los campos
let solInscrSiTotal = 0, solInscrNoTotal = 0, solInscrNull = 0;
let fSolInscrCount = 0, fInscrCount = 0;
for (const r of rows) {
  if (r.SolicitarInscripcion === "Si") solInscrSiTotal++;
  else if (r.SolicitarInscripcion === "No") solInscrNoTotal++;
  else solInscrNull++;
  if (has(r.FechaSolicitudInscripcion)) fSolInscrCount++;
  if (has(r.FechaInscripcion)) fInscrCount++;
}
console.log("\nSeñales crudas:");
console.log(`  SolicitarInscripcion=Si  : ${solInscrSiTotal}`);
console.log(`  SolicitarInscripcion=No  : ${solInscrNoTotal}`);
console.log(`  SolicitarInscripcion=null: ${solInscrNull}`);
console.log(`  Con FechaSolicitudInscripcion: ${fSolInscrCount}`);
console.log(`  Con FechaInscripcion         : ${fInscrCount}`);
