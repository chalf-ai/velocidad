/**
 * VALIDACIÓN Stock Propio — regla oficial (Control de Gestión, correo 2026-06).
 *
 * Stock Propio = Existencia Nuevos + VN CON PATENTE + TEST CARS, manteniendo el
 * filtro financiero (Tipo Stock = Propio/FinPropio). El resto NO cuenta.
 *
 * Corre las funciones de producción sobre el Excel y muestra ANTES (regla
 * financiera vieja, replicada acá como referencia) vs DESPUÉS (lo que devuelve
 * hoy `calcularScoreGerencial`, ya corregido). Verifica los objetivos del PR:
 *   KIA 59→49 · OPEL 17→15 · GEELY 37→33.
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
const OFICIALES = new Set(["EXISTENCIA NUEVOS", "VN CON PATENTE", "TEST CARS"]);
const norm = (s: string | null | undefined) => (s ?? "—").trim().toUpperCase();
const fmt = (n: number) => n.toLocaleString("es-CL");
const fmtM = (n: number) => `$${(n / 1_000_000).toFixed(1)}M`;

// Réplica EXACTA de la regla VIEJA (numerador financiero sin condición), para
// tener el "antes" sin depender del código ya corregido.
const tipoPropio = (vu: VehiculoUnificado) =>
  vu.tipoStock === "Propio" || vu.tipoStock === "FinPropio";
const aplicaInline = (vu: VehiculoUnificado, esUsados: boolean) =>
  vu.enStockActivo && !(esUsados && (vu.esStockB || vu.esJudicial));

const buf = readFileSync(RUTA);
const wb = XLSX.read(buf, { type: "buffer", cellDates: true, cellStyles: false, dense: false });
const { vehiculos } = parseBaseStock(wb.Sheets["Base_Stock"], new Set());
console.log(`Base_Stock parseado: ${fmt(vehiculos.length)} filas — ${RUTA.split("/").pop()}\n`);

const MARCAS = [...MARCAS_GRUPO, MARCA_USADOS];
interface Fila {
  marca: string;
  antes: number;       // regla vieja (financiera, cualquier condición)
  despues: number;     // calcularScoreGerencial corregido
  oficialIndep: number; // verificación independiente (financiera ∩ condición oficial)
  fuga: Map<string, number>;
  okConsistente: boolean;
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
  const oficialIndep = antesVUs.filter((vu) => OFICIALES.has(norm(vu.condicionDeStock))).length;

  // DESPUÉS = lo que devuelve hoy el código de producción.
  const sg = calcularScoreGerencial({ marca, vus, saldos: [], provisiones: [] });
  const despues = sg.drill.stockPropio.length;

  if (antesVUs.length === 0) continue;

  const fuga = new Map<string, number>();
  for (const vu of antesVUs) {
    const c = norm(vu.condicionDeStock);
    if (!OFICIALES.has(c)) fuga.set(c, (fuga.get(c) ?? 0) + 1);
  }

  filas.push({
    marca,
    antes: antesVUs.length,
    despues,
    oficialIndep,
    fuga,
    okConsistente: despues === oficialIndep,
  });
}

filas.sort((a, b) => b.antes - b.despues - (a.antes - a.despues));

console.log("STOCK PROPIO · ANTES (regla vieja) → DESPUÉS (regla oficial, código corregido)");
console.log("".padEnd(92, "─"));
console.log(
  "Marca".padEnd(14) + "Antes".padStart(7) + "Después".padStart(9) + "  ✔".padStart(4) +
    "   Categorías retiradas (no son Stock Propio oficial)",
);
console.log("".padEnd(92, "─"));
let tAntes = 0, tDespues = 0, todoOk = true;
for (const f of filas) {
  tAntes += f.antes;
  tDespues += f.despues;
  todoOk = todoOk && f.okConsistente;
  const fuga = f.fuga.size === 0 ? "(sin cambio)" :
    [...f.fuga.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(" · ");
  console.log(
    f.marca.padEnd(14) + String(f.antes).padStart(7) + String(f.despues).padStart(9) +
      (f.okConsistente ? "  ok" : "  ✗!").padStart(4) + "   " + fuga,
  );
}
console.log("".padEnd(92, "─"));
console.log("TOTAL".padEnd(14) + String(tAntes).padStart(7) + String(tDespues).padStart(9) +
  `   (libera ${tAntes - tDespues} u)`);

// Verificación de objetivos del PR
const targets: Record<string, [number, number]> = {
  "KIA MOTORS": [59, 49],
  "OPEL": [17, 15],
  "GEELY": [37, 33],
};
console.log("\nObjetivos del PR:");
let okTargets = true;
for (const [m, [a, d]] of Object.entries(targets)) {
  const f = filas.find((x) => x.marca === m);
  const ok = f && f.antes === a && f.despues === d;
  okTargets = okTargets && !!ok;
  console.log(`  ${m.padEnd(12)} ${a}→${d}  ${ok ? "✅" : `❌ (obtenido ${f?.antes}→${f?.despues})`}`);
}
console.log(
  `\n${todoOk && okTargets ? "✅ VALIDACIÓN OK" : "❌ REVISAR"} · ` +
    `después == oficial-independiente en todas las marcas: ${todoOk}`,
);
process.exit(todoOk && okTargets ? 0 : 1);
