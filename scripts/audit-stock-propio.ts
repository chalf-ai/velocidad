/**
 * CIERRE AUDITORÍA Stock Propio — universo completo (todas las marcas).
 *
 * Regla final (decisión de negocio 2026-06):
 *   Stock Propio = Tipo Stock Propio/FinPropio  ∧  condición oficial:
 *      · NUEVOS → Existencia Nuevos · VN CON PATENTE · TEST CARS
 *      · USADOS → Existencia Usados
 *   Stock B (columna oficial Stock A/B) → SÍ cuenta (stock pagado · capital).
 *   Judicial (columna oficial Stock A/B) → NO cuenta (segregado en auditoría).
 *
 * Entrega:
 *   PARTE 1 · Stock Propio por TODAS las marcas — Oficial (def. independiente
 *             desde Base_Stock) vs Sistema Antes/Después (código de producción).
 *             Cierre = Oficial == Sistema, marca por marca y en Σ.
 *   PARTE 2 · Conciliación Stock B / Judicial desde fuente oficial (Stock A/B),
 *             universo ÚNICO por VIN, vs hoja DETALLE STOCK B Y JUDICIAL.
 *
 * USO: npx tsx scripts/audit-stock-propio.ts "<ruta xlsx>"
 */
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { parseBaseStock } from "../src/lib/parser/base-stock";
import { buildVehiculosUnificados } from "../src/lib/selectors/vehiculo-unificado";
import type { VehiculoUnificado } from "../src/lib/selectors/vehiculo-unificado";
import { calcularScoreGerencial } from "../src/lib/selectors/score-gerencial";
import {
  filtrarPorMarcaOwnerUOriginador,
  getMarcaOperacional,
  MARCAS_GRUPO,
  MARCA_USADOS,
} from "../src/lib/selectors/owner-operacional";
import { limpiarVIN } from "../src/lib/parser/venta-apc";
import { causaStockNoDisponible, CAUSAS_STOCK_NO_DISPONIBLE } from "../src/lib/selectors/stock-no-disponible";

const RUTA = process.argv[2];
const COND_NUEVOS = new Set(["EXISTENCIA NUEVOS", "VN CON PATENTE", "TEST CARS"]);
const COND_USADOS = new Set(["EXISTENCIA USADOS"]);
const normC = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const propio = (vu: VehiculoUnificado) => vu.tipoStock === "Propio" || vu.tipoStock === "FinPropio";
// Regla FINAL independiente (replica la definición de negocio sin pasar por el
// código de producción): propio ∧ condición marca-aware ∧ NO Judicial (Stock B sí).
const esPropioFinal = (vu: VehiculoUnificado, esUsados: boolean) =>
  vu.stockAB !== "Judicial" &&
  propio(vu) &&
  (esUsados ? COND_USADOS : COND_NUEVOS).has(normC(vu.condicionDeStock));
const aplicaInlineVieja = (vu: VehiculoUnificado, esUsados: boolean) =>
  vu.enStockActivo && !(esUsados && (vu.esStockB || vu.esJudicial));
const fmt = (n: number) => n.toLocaleString("es-CL");

const buf = readFileSync(RUTA);
const wb = XLSX.read(buf, { type: "buffer", cellDates: true, cellStyles: false, dense: false });
const { vehiculos } = parseBaseStock(wb.Sheets["Base_Stock"], new Set());
console.log(`Base_Stock: ${fmt(vehiculos.length)} filas — ${RUTA.split("/").pop()}\n`);

// ── PARTE 1 · Stock Propio por marca ────────────────────────────────────────
const MARCAS = [...MARCAS_GRUPO, MARCA_USADOS];
interface Fila { marca: string; oficial: number; antes: number; sistema: number; stockB: number; jud: number; ok: boolean; }
const filas: Fila[] = [];
for (const marca of MARCAS) {
  const filtrados = filtrarPorMarcaOwnerUOriginador(vehiculos, marca);
  if (filtrados.length === 0) continue;
  const esUsados = marca === MARCA_USADOS;
  const vus = Array.from(
    buildVehiculosUnificados({ data: { vehiculos: filtrados, lineas: [], vinsExtra: null } as never, fne: null, saldos: null }).values(),
  );
  const oficial = vus.filter((vu) => vu.enStockActivo && esPropioFinal(vu, esUsados)).length; // independiente
  const antes = vus.filter((vu) => aplicaInlineVieja(vu, esUsados) && propio(vu)).length;       // regla vieja
  const drill = calcularScoreGerencial({ marca, vus, saldos: [], provisiones: [] }).drill.stockPropio;
  const sistema = drill.length;                                                                  // producción
  const stockB = drill.filter((vu) => vu.stockAB === "B").length;                                // incluidos
  const jud = vus.filter((vu) => vu.enStockActivo && propio(vu) && vu.stockAB === "Judicial" &&
    (esUsados ? COND_USADOS : COND_NUEVOS).has(normC(vu.condicionDeStock))).length;              // judicial sacado
  if (oficial === 0 && antes === 0 && sistema === 0) continue;
  filas.push({ marca, oficial, antes, sistema, stockB, jud, ok: oficial === sistema });
}
filas.sort((a, b) => b.sistema - a.sistema);

console.log("PARTE 1 · STOCK PROPIO — TODAS LAS MARCAS (Stock B cuenta · Judicial fuera)");
console.log("".padEnd(86, "─"));
console.log("Marca".padEnd(13) + "Oficial".padStart(8) + "Antes".padStart(7) + "Sistema".padStart(8) + " ✔ ".padStart(4) + "  de los cuales StockB / Judicial fuera");
console.log("".padEnd(86, "─"));
let tOf = 0, tAntes = 0, tSis = 0, todoOk = true;
for (const f of filas) {
  tOf += f.oficial; tAntes += f.antes; tSis += f.sistema; todoOk = todoOk && f.ok;
  console.log(
    f.marca.padEnd(13) + String(f.oficial).padStart(8) + String(f.antes).padStart(7) + String(f.sistema).padStart(8) +
      (f.ok ? " ok" : " ✗!").padStart(4) + `   Stock B ${f.stockB} · Judicial fuera ${f.jud}`,
  );
}
console.log("".padEnd(86, "─"));
console.log("TOTAL Σ".padEnd(13) + String(tOf).padStart(8) + String(tAntes).padStart(7) + String(tSis).padStart(8) + (todoOk ? " ok" : " ✗!").padStart(4));
console.log(`\n  Cierre Stock Propio: Σ Oficial=${tOf} == Σ Sistema=${tSis}  →  ${tOf === tSis && todoOk ? "CUADRA (marca por marca) ✅" : "REVISAR ❌"}`);

// ── PARTE 2 · Conciliación Stock B/Judicial (universo único, fuente oficial) ──
const vistos = new Set<string>();
let totFilasB = 0, totFilasJ = 0, vinInval = 0, dup = 0;
const porMarca = new Map<string, { b: number; j: number }>();
const grupo = new Set<string>([...MARCAS_GRUPO, MARCA_USADOS]);
const fueraGrupo: { vin: string; marca: string; modelo: string | null; cond: string | null; ab: string }[] = [];
for (const v of vehiculos) {
  if (v.stockAB === "B") totFilasB++;
  if (v.stockAB === "Judicial") totFilasJ++;
  if (v.stockAB !== "B" && v.stockAB !== "Judicial") continue;
  const k = limpiarVIN(v.vin);
  if (!k || k.length !== 17) { vinInval++; continue; }
  if (vistos.has(k)) { dup++; continue; }
  vistos.add(k);
  const m = getMarcaOperacional(v);
  const acc = porMarca.get(m) ?? { b: 0, j: 0 };
  if (v.stockAB === "B") acc.b++; else acc.j++;
  porMarca.set(m, acc);
  if (!grupo.has(m)) fueraGrupo.push({ vin: k, marca: m, modelo: v.modelo, cond: v.condicionDeStock, ab: v.stockAB });
}
let uB = 0, uJ = 0;
for (const { b, j } of porMarca.values()) { uB += b; uJ += j; }
console.log("\n\nPARTE 2 · CONCILIACIÓN STOCK B / JUDICIAL (fuente oficial: columna Stock A/B)");
console.log("".padEnd(64, "─"));
console.log(`Base_Stock filas · stockAB=B: ${totFilasB}  ·  stockAB=Judicial: ${totFilasJ}`);
console.log(`Hoja DETALLE STOCK B Y JUDICIAL (filtro Stock B) = 351  →  ${totFilasB === 351 ? "CUADRA EXACTO ✅" : "DIFIERE ❌"}`);
console.log(`Único por VIN · Stock B=${uB} Judicial=${uJ} total=${uB + uJ}  (VIN inválido descartado=${vinInval}, duplicados=${dup})`);
console.log("\nPartición única por marca operacional (suma = único):");
for (const [m, { b, j }] of [...porMarca.entries()].sort((a, c) => c[1].b + c[1].j - (a[1].b + a[1].j))) {
  console.log(`  ${m.padEnd(20)} Stock B ${String(b).padStart(3)} · Judicial ${String(j).padStart(2)}${grupo.has(m) ? "" : "   ← fuera del grupo del score"}`);
}
console.log(`\nFuera del grupo del score: ${fueraGrupo.length} VIN · VIN inválido: ${vinInval}`);
fueraGrupo.forEach((r) => console.log(`  ${r.vin} · ${r.marca} · ${r.modelo ?? "—"} · ${r.cond ?? "—"} · Stock A/B=${r.ab}`));

// ── PARTE 3 · STOCK NO DISPONIBLE · desglose por causa (Estado Dealer) ──────
const unidadesB = vehiculos.filter((v) => v.stockAB === "B");
const judiciales = vehiculos.filter((v) => v.stockAB === "Judicial");
const porCausa = new Map<string, typeof vehiculos>();
for (const v of unidadesB) {
  const c = causaStockNoDisponible(v.estadoDealer);
  if (!porCausa.has(c)) porCausa.set(c, []);
  porCausa.get(c)!.push(v);
}
const sumC = (vs: typeof vehiculos) => vs.reduce((s, v) => s + (v.costoNeto ?? 0), 0);
console.log("\n\nPARTE 3 · STOCK NO DISPONIBLE (stockAB=B) · desglose por causa (Estado Dealer)");
console.log("".padEnd(72, "─"));
let sumU = 0;
for (const c of CAUSAS_STOCK_NO_DISPONIBLE) {
  const vs = porCausa.get(c) ?? [];
  if (vs.length === 0) continue;
  sumU += vs.length;
  console.log(`  ${c.padEnd(22)} ${String(vs.length).padStart(4)} u · ${(((vs.length / unidadesB.length) * 100).toFixed(1) + "%").padStart(6)} · costo ${(sumC(vs) / 1e6).toFixed(0)}M`);
}
console.log("".padEnd(72, "─"));
console.log(`  Σ Stock No Disponible = ${sumU} (esperado 351 · stockAB=B)  →  ${sumU === unidadesB.length && unidadesB.length === 351 ? "CUADRA ✅" : "REVISAR ❌"}`);
console.log(`  Stock B real (Estado Dealer = STOCK B) = ${porCausa.get("Stock B real")?.length ?? 0}`);
console.log(`  Judicial (stockAB=Judicial, sección aparte) = ${judiciales.length}`);
const otros = porCausa.get("Otros") ?? [];
if (otros.length > 0) {
  console.log(`\n  ⚠ "Otros" (Estado Dealer no mapeado) = ${otros.length}:`);
  [...new Set(otros.map((v) => v.estadoDealer ?? "—"))].forEach((e) => console.log(`     · ${e}`));
}
