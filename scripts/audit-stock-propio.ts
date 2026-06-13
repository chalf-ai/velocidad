/**
 * VALIDACIÓN Stock Propio — regla oficial (Control de Gestión, correo 2026-06).
 *
 * Criterio SEPARADO por unidad, manteniendo el filtro financiero (Tipo Stock =
 * Propio/FinPropio) y excluyendo Stock B / Judicial en TODAS las marcas:
 *   · NUEVOS → Existencia Nuevos + VN CON PATENTE + TEST CARS
 *   · USADOS → Existencia Usados
 *
 * Corre las funciones de producción sobre el Excel y muestra ANTES (regla
 * financiera vieja) vs DESPUÉS (lo que devuelve hoy `calcularScoreGerencial`).
 * Verifica: KIA 59→49 · OPEL 17→15 · GEELY 37→33 · USADOS > 0 (Existencia
 * Usados) · Stock B/Judicial excluidos pero contados aparte.
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
  MARCAS_GRUPO,
  MARCA_USADOS,
} from "../src/lib/selectors/owner-operacional";

const RUTA = process.argv[2];
const COND_NUEVOS = new Set(["EXISTENCIA NUEVOS", "VN CON PATENTE", "TEST CARS"]);
const COND_USADOS = new Set(["EXISTENCIA USADOS"]);
const norm = (s: string | null | undefined) => (s ?? "—").trim().toUpperCase();
const fmt = (n: number) => n.toLocaleString("es-CL");

const tipoPropio = (vu: VehiculoUnificado) =>
  vu.tipoStock === "Propio" || vu.tipoStock === "FinPropio";
// Réplica de la regla VIEJA (numerador financiero, sin condición) para el "antes".
const aplicaInline = (vu: VehiculoUnificado, esUsados: boolean) =>
  vu.enStockActivo && !(esUsados && (vu.esStockB || vu.esJudicial));
// Réplica de la regla NUEVA (oficial marca-aware · SOLO condición + financiero,
// sin heurístico esStockB). Stock B/Judicial NO se descuentan del numerador.
const esPropioOficialRef = (vu: VehiculoUnificado, esUsados: boolean) =>
  tipoPropio(vu) &&
  (esUsados ? COND_USADOS : COND_NUEVOS).has(norm(vu.condicionDeStock));

const buf = readFileSync(RUTA);
const wb = XLSX.read(buf, { type: "buffer", cellDates: true, cellStyles: false, dense: false });
const { vehiculos } = parseBaseStock(wb.Sheets["Base_Stock"], new Set());
console.log(`Base_Stock parseado: ${fmt(vehiculos.length)} filas — ${RUTA.split("/").pop()}\n`);

const MARCAS = [...MARCAS_GRUPO, MARCA_USADOS];
interface Fila {
  marca: string;
  antes: number;
  despues: number;
  oficialIndep: number;
  stockB: number;
  judicial: number;
  okConsistente: boolean;
  retiradas: Map<string, number>;
}
const filas: Fila[] = [];

for (const marca of MARCAS) {
  const filtrados = filtrarPorMarcaOwnerUOriginador(vehiculos, marca);
  if (filtrados.length === 0) continue;
  const esUsados = marca === MARCA_USADOS;

  const map = buildVehiculosUnificados({
    data: { vehiculos: filtrados, lineas: [], vinsExtra: null } as never,
    fne: null,
    saldos: null,
  });
  const vus = Array.from(map.values());

  const antesVUs = vus.filter((vu) => aplicaInline(vu, esUsados) && tipoPropio(vu));
  const oficialIndep = antesVUs.filter((vu) => esPropioOficialRef(vu, esUsados)).length;

  const sg = calcularScoreGerencial({ marca, vus, saldos: [], provisiones: [] });
  const despues = sg.drill.stockPropio.length;
  if (antesVUs.length === 0 && sg.drill.stockB.length === 0 && sg.drill.judicial.length === 0) continue;

  const retiradas = new Map<string, number>();
  for (const vu of antesVUs) {
    if (!esPropioOficialRef(vu, esUsados)) {
      const c = norm(vu.condicionDeStock);
      retiradas.set(c, (retiradas.get(c) ?? 0) + 1);
    }
  }

  filas.push({
    marca,
    antes: antesVUs.length,
    despues,
    oficialIndep,
    stockB: sg.drill.stockB.length,
    judicial: sg.drill.judicial.length,
    okConsistente: despues === oficialIndep,
    retiradas,
  });
}

filas.sort((a, b) => b.antes - b.despues - (a.antes - a.despues));

console.log("STOCK PROPIO · ANTES (regla vieja) → DESPUÉS (regla oficial marca-aware)");
console.log("".padEnd(98, "─"));
console.log(
  "Marca".padEnd(13) + "Antes".padStart(6) + "Después".padStart(8) + "  ✔".padStart(4) +
    "  StkB".padStart(6) + "  Jud".padStart(5) + "   Categorías retiradas del numerador",
);
console.log("".padEnd(98, "─"));
let tAntes = 0, tDespues = 0, todoOk = true;
for (const f of filas) {
  tAntes += f.antes; tDespues += f.despues; todoOk = todoOk && f.okConsistente;
  const ret = f.retiradas.size === 0 ? "(sin cambio)" :
    [...f.retiradas.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(" · ");
  console.log(
    f.marca.padEnd(13) + String(f.antes).padStart(6) + String(f.despues).padStart(8) +
      (f.okConsistente ? "  ok" : "  ✗!").padStart(4) +
      String(f.stockB).padStart(6) + String(f.judicial).padStart(5) + "   " + ret,
  );
}
console.log("".padEnd(98, "─"));
console.log("TOTAL".padEnd(13) + String(tAntes).padStart(6) + String(tDespues).padStart(8) +
  `   (libera ${tAntes - tDespues} u del numerador)`);

// Objetivos del PR
const targets: Record<string, [number, number]> = {
  "KIA MOTORS": [59, 49], "OPEL": [17, 15], "GEELY": [37, 33],
};
console.log("\nObjetivos del PR:");
let okTargets = true;
for (const [m, [a, d]] of Object.entries(targets)) {
  const f = filas.find((x) => x.marca === m);
  const ok = f && f.antes === a && f.despues === d;
  okTargets = okTargets && !!ok;
  console.log(`  ${m.padEnd(12)} ${a}→${d}  ${ok ? "✅" : `❌ (obtenido ${f?.antes}→${f?.despues})`}`);
}
const usados = filas.find((x) => x.marca === MARCA_USADOS);
const usadosOk = !!usados && usados.despues > 0;
console.log(`  USADOS > 0   obtenido ${usados?.despues} (Existencia Usados Propio/FinPropio)  ${usadosOk ? "✅" : "❌"}`);

const totalStockB = filas.reduce((s, f) => s + f.stockB, 0);
const totalJud = filas.reduce((s, f) => s + f.judicial, 0);
console.log(`\nExcluidos del score, visibles en auditoría: Stock B = ${totalStockB} u · Judicial = ${totalJud} u`);

console.log(
  `\n${todoOk && okTargets && usadosOk ? "✅ VALIDACIÓN OK" : "❌ REVISAR"} · ` +
    `después == oficial-independiente en todas las marcas: ${todoOk}`,
);
process.exit(todoOk && okTargets && usadosOk ? 0 : 1);
