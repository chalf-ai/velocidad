/**
 * VALIDACIÓN Fase 5 · capital-trabajo.ts (fuente única) vs Score Gerencial.
 *
 * Carga el MISMO snapshot activo que ve Score, ejecuta las 4 funciones de la
 * capa única y las compara contra los indicadores reales del Score. Sirve para:
 *   (a) confirmar que la capa compila/ejecuta con datos reales,
 *   (b) medir el % real de Stock Pagado sobre stock activo (decidir meta),
 *   (c) probar que I2/I3/I4 == capa (refactor no-op).
 *
 * USO: DATABASE_URL="postgresql://Daviid@localhost:5432/velocidad" npx tsx scripts/validate-captrabajo.ts
 */
import { PrismaClient } from "@prisma/client";
import { deserializeStockPayload, reviveDates } from "../src/lib/snapshot-client";
import { buildVehiculosUnificados, type VehiculoUnificado } from "../src/lib/selectors/vehiculo-unificado";
import { calcularScoreGerencial } from "../src/lib/selectors/score-gerencial";
import {
  stockPagado,
  stockActivoValorizado,
  provisiones90,
  creditoPompeyo15,
  saldosT3,
} from "../src/lib/selectors/capital-trabajo";
import type { ParsedFNE, ParsedSaldos, ParsedProvisiones } from "../src/lib/types";

const prisma = new PrismaClient();
const M = (n: number) => `$${(n / 1e6).toFixed(1)}M`;
const ok = (b: boolean) => (b ? "✓" : "✗ DISCREPA");

async function snap(fuente: string): Promise<unknown | null> {
  const s = await prisma.snapshot.findFirst({
    where: { fuente: fuente as never, activo: true },
    orderBy: { createdAt: "desc" },
    select: { payload: true, fechaCorte: true },
  });
  if (s) console.log(`  ${fuente}: corte ${String(s.fechaCorte).slice(0, 10)}`);
  return s?.payload ?? null;
}

async function main() {
  console.log("── Snapshots activos:");
  const [sp, fp, slp, pp] = await Promise.all([
    snap("BASE_STOCK"), snap("FNE"), snap("SALDOS"), snap("PROVISIONES"),
  ]);
  if (!sp) throw new Error("Sin BASE_STOCK activo");

  const data = deserializeStockPayload(sp);
  const fne = fp ? (reviveDates(fp) as ParsedFNE) : null;
  const saldos = slp ? (reviveDates(slp) as ParsedSaldos) : null;
  const provisiones = pp ? (reviveDates(pp) as ParsedProvisiones) : null;

  const vus: VehiculoUnificado[] = Array.from(
    buildVehiculosUnificados({ data, fne, saldos }).values(),
  );
  const saldosRegs = saldos?.registros ?? [];
  const provRegs = provisiones?.registros ?? [];

  // ═══════ CAPA ÚNICA (capital-trabajo.ts) ═══════
  const cPagado = stockPagado(vus);
  const cActivo = stockActivoValorizado(vus);
  const cProv = provisiones90(provRegs);
  const cCP = creditoPompeyo15(vus);
  const cSaldos = saldosT3(saldosRegs);
  const pctPagadoMonto = cActivo.monto > 0 ? (cPagado.monto / cActivo.monto) * 100 : 0;
  const pctPagadoUnid = cActivo.unidades > 0 ? (cPagado.unidades / cActivo.unidades) * 100 : 0;

  console.log("\n══════════ CAPA ÚNICA · 4 métricas oficiales ══════════");
  console.log(`  1 · Stock Pagado    : ${cPagado.unidades} VIN · ${M(cPagado.monto)}`);
  console.log(`      Stock activo tot : ${cActivo.unidades} VIN · ${M(cActivo.monto)}`);
  console.log(`      >> Pagado / activo: ${pctPagadoMonto.toFixed(1)}% monto · ${pctPagadoUnid.toFixed(1)}% unidades`);
  console.log(`  2 · Provisiones >90d: ${cProv.unidades} · ${M(cProv.monto)}`);
  console.log(`  3 · Crédito P. >15d : ${cCP.unidades} · ${M(cCP.monto)}`);
  console.log(`  4 · Saldos T3+      : ${cSaldos.unidades} · ${M(cSaldos.monto)}`);

  // ═══════ SCORE (todas las marcas) — comparar I2/I3/I4 == capa ═══════
  const sg = calcularScoreGerencial({
    marca: "Todas las marcas",
    vus,
    saldos: saldosRegs,
    provisiones: provRegs,
  });
  const byId = Object.fromEntries(sg.indicadores.map((i) => [i.id, i]));
  console.log("\n══════════ SCORE actual vs CAPA (mismo corte) ══════════");
  console.log(`  I1 stock_propio  (Score) : ${byId.stock_propio.casos} u · ${M(byId.stock_propio.monto)} · valor ${byId.stock_propio.valorTexto}`);
  console.log(`     stockPagado   (capa)   : ${cPagado.unidades} u · ${M(cPagado.monto)}  ← CAMBIA (def distinta)`);
  console.log(`  I2 provisiones_90d ${ok(byId.provisiones_90d.casos === cProv.unidades)} Score ${byId.provisiones_90d.casos} == capa ${cProv.unidades}`);
  console.log(`  I3 cp_15d          ${ok(byId.cp_15d.casos === cCP.unidades)} Score ${byId.cp_15d.casos} == capa ${cCP.unidades}`);
  console.log(`  I4 saldos_t3       ${ok(byId.saldos_t3.casos === cSaldos.unidades)} Score ${byId.saldos_t3.casos} == capa ${cSaldos.unidades}`);

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
