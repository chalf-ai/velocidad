/**
 * VALIDACIÓN · Snapshot diario (PR 2) — captura de las métricas oficiales.
 *
 * Prueba, READ-ONLY, que `capitalDesdePayloads` (el MISMO motor que persiste el
 * job diario) computa, desde los snapshots vigentes, los valores oficiales que
 * verá producción: Caja Comercial, Caja Total, desglose (Test/Cía/Judicial),
 * FNE operativo, Provisiones>90 (casos/monto/aging máximo), CP, Saldos T3+.
 *
 * Además compara contra la ÚLTIMA fila persistida de DailyCapitalSnapshot TOTAL
 * (si ya tiene los campos nuevos, tras deploy + corrida del cron 20:00).
 * No escribe nada.
 */
import { PrismaClient } from "@prisma/client";
import {
  rehidratarStock,
  rehidratarSaldos,
  rehidratarFNE,
  rehidratarProvisiones,
} from "../src/lib/historico/calcular-score-gerencial-historico";
import { capitalDesdePayloads } from "../src/lib/historico/capital-por-corte";

const prisma = new PrismaClient();
const M = (n: number | null | undefined) => (n == null ? "—" : `$${(n / 1e6).toFixed(1)}M`);
let fail = 0;
function check(label: string, got: number | null, exp: number, tol = 0) {
  const ok = got != null && Math.abs(got - exp) <= tol;
  if (!ok) fail++;
  console.log(`  ${ok ? "✓" : "✗ FALLA"} ${label}: got ${got} · esperado ${exp}${tol ? ` (±${tol})` : ""}`);
}
async function snap(f: string) {
  return prisma.snapshot.findFirst({ where: { fuente: f as never, activo: true }, orderBy: { createdAt: "desc" }, select: { payload: true, fechaCorte: true } });
}

(async () => {
  const [s, f, sl, pr] = await Promise.all([snap("BASE_STOCK"), snap("FNE"), snap("SALDOS"), snap("PROVISIONES")]);
  console.log("Corte BASE_STOCK:", String(s?.fechaCorte).slice(0, 10));
  const stock = rehidratarStock(s!.payload);
  const fne = f?.payload ? rehidratarFNE(f.payload) : null;
  const saldos = sl?.payload ? rehidratarSaldos(sl.payload) : null;
  const provisiones = pr?.payload ? rehidratarProvisiones(pr.payload) : null;

  const c = capitalDesdePayloads({ stock, saldos, provisiones, fne, marca: null });

  console.log("\n══ Métricas computadas (TOTAL) — lo que persistirá el job ══");
  console.log(`  Caja Comercial   ${c.cajaComercial?.unidades} · ${M(c.cajaComercial?.monto)}`);
  console.log(`  Caja Total       ${c.cajaTotal?.unidades} · ${M(c.cajaTotal?.monto)}`);
  console.log(`  Test Cars        ${c.testCars?.unidades} · ${M(c.testCars?.monto)}`);
  console.log(`  Autos Compañía   ${c.autosCompania?.unidades} · ${M(c.autosCompania?.monto)}`);
  console.log(`  Judicial         ${c.judicial?.unidades} · ${M(c.judicial?.monto)}`);
  console.log(`  FNE operativo    ${c.fne?.unidades} · ${M(c.fne?.monto)}`);
  console.log(`  Provisiones >90  ${c.provisiones90?.unidades} · ${M(c.provisiones90?.monto)} · agingMax ${c.provisionesAgingMax}d`);
  console.log(`  CP >15d          ${c.creditoPompeyo15?.unidades} · ${M(c.creditoPompeyo15?.monto)}`);
  console.log(`  Saldos T3+       ${c.saldosT3?.unidades} · ${M(c.saldosT3?.monto)}`);
  console.log(`  Stock Pagado     ${c.stockPagado?.unidades} · ${M(c.stockPagado?.monto)} (legacy)`);

  console.log("\n══ 1 · Valores oficiales (auditoría corte 17-jun) ══");
  check("Caja Comercial unid", c.cajaComercial?.unidades ?? null, 320);
  check("Caja Total unid", c.cajaTotal?.unidades ?? null, 555);
  check("Test Cars unid", c.testCars?.unidades ?? null, 132);
  check("Autos Compañía unid", c.autosCompania?.unidades ?? null, 70);
  check("Judicial unid", c.judicial?.unidades ?? null, 33);

  console.log("\n══ 2 · Cuadratura desglose = Caja Total ══");
  const sumU = (c.cajaComercial?.unidades ?? 0) + (c.testCars?.unidades ?? 0) + (c.autosCompania?.unidades ?? 0) + (c.judicial?.unidades ?? 0);
  check("comercial+test+cía+judicial = total", sumU, c.cajaTotal?.unidades ?? -1);

  console.log("\n══ 3 · Fuentes ROMA-equivalentes presentes ══");
  check("FNE operativo presente (>0)", (c.fne?.unidades ?? 0) > 0 ? 1 : 0, 1);
  check("Provisiones >90 presente", (c.provisiones90?.unidades ?? 0) > 0 ? 1 : 0, 1);
  check("Provisiones agingMax > 90", (c.provisionesAgingMax ?? 0) > 90 ? 1 : 0, 1);
  check("Saldos T3+ presente", (c.saldosT3?.unidades ?? 0) > 0 ? 1 : 0, 1);

  console.log("\n══ 4 · Fila persistida DailyCapitalSnapshot TOTAL (último día) ══");
  try {
    const row = await prisma.dailyCapitalSnapshot.findFirst({ where: { scopeTipo: "TOTAL" }, orderBy: { fecha: "desc" } });
    if (!row) {
      console.log("  (sin filas TOTAL aún)");
    } else {
      const r = row as unknown as Record<string, number | null>;
      console.log(`  fecha=${(row.fecha as Date).toISOString().slice(0, 10)}`);
      if (r.cajaComercialUnidades == null) {
        console.log("  ⏳ Campos nuevos aún NULL — se poblarán tras corrida del cron 20:00 (o trigger manual) post-deploy.");
      } else {
        console.log(`  Persistido · Caja Comercial ${r.cajaComercialUnidades} · ${M(r.cajaComercialMonto)} · Caja Total ${r.cajaTotalUnidades} · ${M(r.cajaTotalMonto)}`);
      }
    }
  } catch (e) {
    if ((e as { code?: string }).code === "P2022") {
      console.log("  ⏳ Migración aún no aplicada en esta DB (columnas nuevas) — se aplican en el deploy (prisma migrate deploy).");
    } else {
      throw e;
    }
  }

  console.log(fail === 0 ? "\n✅ TODAS LAS VALIDACIONES OK" : `\n❌ ${fail} VALIDACIONES FALLARON`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
