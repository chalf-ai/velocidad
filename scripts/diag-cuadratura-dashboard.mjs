/**
 * Diag: ¿Por qué $18.86B + $30.50B ≠ $42.68B en el Dashboard?
 *
 * Reproduce la lógica EXACTA del sistema (kpis.ts).
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const wb = XLSX.read(readFileSync("/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx"), { type: "buffer", cellDates: true });
const rows = XLSX.utils.sheet_to_json(wb.Sheets["Base_Stock"], { defval: null, raw: true });

const n = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const s = (v) => (v == null || v === "" ? null : String(v).trim());

// Derivar naturaleza simplificada (copiamos de base-stock.ts)
function naturaleza(r) {
  // Heurística simplificada — el sistema real lo hace más fino
  const stockAB = s(r["Stock A/B"]);
  const tipoStock = s(r["Tipo Stock"]);
  const estadoDealer = s(r["Estado Dealer"]);
  const estadoAutoPro = s(r["Estado AutoPro"]);
  const statusStock = s(r["Status Stock"]);
  const folioRetoma = n(r["Folio Retoma"]);
  const marcaPompeyoC = s(r["Marca Pompeyo C."]);
  const porLlegar = s(r["Por llegar"]);
  const condicionVehiculo = s(r["Condicion Vehiculo"]);

  // VPP
  if (folioRetoma > 0) {
    if (tipoStock === "FloorPlan") return "retail"; // CPD + FloorPlan
    if (tipoStock === "Propio") return "atrapado"; // CPD + Propio
    return "puente";
  }
  // FNE
  if (estadoAutoPro === "Vendido" && (statusStock === "Vigente" || statusStock === "Aprobada")) {
    return "operativo";
  }
  // Proceso CPD/Venta
  if (marcaPompeyoC === "Proceso CPD") {
    if (tipoStock === "FloorPlan") return "retail";
    if (tipoStock === "Propio") return "atrapado";
    return "puente";
  }
  if (marcaPompeyoC === "Proceso de Venta") return "operativo";

  // Usado pagado inmóvil
  const condStock = s(r["Condicion de Stock"]);
  if (condStock && /USADO.*PAGADO/i.test(condStock)) return "atrapado";

  // Inmovilizado / Judicial / Stock B
  if (stockAB === "Judicial") return "judicial";
  if (stockAB === "B") return "atrapado";

  // Por llegar
  if (porLlegar === "Por Llegar" || porLlegar === "PreInscrito") return "transito";

  // Retail
  if (estadoDealer === "Disponible") return "retail";

  return "indefinido";
}

let capitalBruto = 0;
let capitalTotalUtilizado = 0;
let capitalPropio = 0;
let capitalFinanciero = 0;
let capitalFloorPlan = 0;
let unidadesPorTipoYNat = {};

for (const r of rows) {
  const c = n(r["Total Costo"]);
  const vin = s(r["Numero VIN"]);
  if (!vin) continue;
  capitalBruto += c;

  const tipo = s(r["Tipo Stock"]) ?? "?";
  const nat = naturaleza(r);
  const key = `${tipo} × ${nat}`;
  if (!unidadesPorTipoYNat[key]) unidadesPorTipoYNat[key] = { unidades: 0, capital: 0 };
  unidadesPorTipoYNat[key].unidades++;
  unidadesPorTipoYNat[key].capital += c;

  // Reproducir lógica EXACTA del sistema (kpis.ts:88-98)
  if (
    nat === "puente" ||
    nat === "operativo" ||
    nat === "atrapado" ||
    tipo === "Propio" ||
    tipo === "FinPropio" ||
    tipo === "Financiado"
  ) {
    capitalTotalUtilizado += c;
  }

  // Lógica de "capitalFloorPlan" (kpis.ts:111-113)
  if (tipo === "Propio" || tipo === "FinPropio") capitalPropio += c;
  else if (tipo === "Financiado") capitalFinanciero += c;
  else if (tipo === "FloorPlan") capitalFloorPlan += c;
}

console.log("════════════════════════════════════════════════════");
console.log("CUADRATURA DASHBOARD · $42.68B vs $18.86B + $30.50B");
console.log("════════════════════════════════════════════════════\n");

console.log(`Capital bruto                : $${capitalBruto.toLocaleString("es-CL")}`);
console.log(`Capital total utilizado      : $${capitalTotalUtilizado.toLocaleString("es-CL")}`);
console.log(`Capital Floor Plan (todo)    : $${capitalFloorPlan.toLocaleString("es-CL")}`);
console.log(`Capital Propio+FinPropio     : $${capitalPropio.toLocaleString("es-CL")}`);
console.log(`Capital Financiado           : $${capitalFinanciero.toLocaleString("es-CL")}`);
console.log();
console.log(`SUMA Utilizado + FloorPlan   : $${(capitalTotalUtilizado + capitalFloorPlan).toLocaleString("es-CL")}`);
console.log(`Capital bruto                : $${capitalBruto.toLocaleString("es-CL")}`);
console.log(`Δ (solapamiento o gap)       : $${(capitalTotalUtilizado + capitalFloorPlan - capitalBruto).toLocaleString("es-CL")}`);

// El solapamiento son los FloorPlan con naturaleza puente/operativo/atrapado
let solapamientoFloorPlanEnUtilizado = 0;
for (const [key, v] of Object.entries(unidadesPorTipoYNat)) {
  if (key.startsWith("FloorPlan ") && /puente|operativo|atrapado/.test(key)) {
    solapamientoFloorPlanEnUtilizado += v.capital;
  }
}
console.log(`\nDESGLOSE DEL SOLAPAMIENTO:`);
console.log(`Floor Plan con naturaleza op/puente/atrapado:`);
console.log(`  → entran en AMBOS KPIs (doble conteo en la suma)`);
console.log(`  → monto: $${solapamientoFloorPlanEnUtilizado.toLocaleString("es-CL")}`);

console.log(`\n────────────────────────────────────────────────────`);
console.log("DISTRIBUCIÓN POR (tipoStock × naturaleza)");
console.log("────────────────────────────────────────────────────\n");
const ordenado = Object.entries(unidadesPorTipoYNat).sort((a, b) => b[1].capital - a[1].capital);
for (const [key, v] of ordenado) {
  console.log(`  ${key.padEnd(30)} u=${String(v.unidades).padStart(4)}  $${v.capital.toLocaleString("es-CL").padStart(18)}`);
}
console.log(`  ────────`);
console.log(`  TOTAL                          u=${rows.length} (con VIN: ${ordenado.reduce((s,[,v])=>s+v.unidades,0)})  $${capitalBruto.toLocaleString("es-CL")}`);
