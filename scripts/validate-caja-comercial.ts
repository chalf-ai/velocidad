/**
 * VALIDACIÓN · Caja Comercial Gestionable (Score) ↔ Caja Inmovilizada Total
 * con desglose (Tendencias).
 *
 * Prueba, con las FUNCIONES REALES de producción y los snapshots vigentes, que:
 *   1. Cuadratura del desglose: comercial + test + cía + judicial + otros = total
 *      (VIN a VIN y en monto).
 *   2. Otros = 0 (todo VIN clasificado).
 *   3. Cuadratura Score ↔ Tendencias: el indicador #1 del Score
 *      (Caja Comercial Gestionable) == la línea "Comercial" del desglose.
 *   4. Contraste contra la métrica antigua (Stock Pagado) y los números de la
 *      auditoría aprobada (Total 555 · Comercial 320 · Test 132 · Cía 70 · Jud 33).
 *
 * Read-only. Correr contra prod con el DATABASE_URL inyectado (railway run).
 */
import { PrismaClient } from "@prisma/client";
import {
  rehidratarStock,
  rehidratarSaldos,
  rehidratarFNE,
  rehidratarProvisiones,
} from "../src/lib/historico/calcular-score-gerencial-historico";
import { buildVehiculosUnificados } from "../src/lib/selectors/vehiculo-unificado";
import {
  cajaComercialGestionable,
  cajaInmovilizadaTotal,
  desglosarCajaInmovilizada,
  stockPagado,
} from "../src/lib/selectors/capital-trabajo";
import { calcularScoreGerencial } from "../src/lib/selectors/score-gerencial";

const prisma = new PrismaClient();
const M = (n: number) => `$${(n / 1e6).toFixed(1)}M`;
let fail = 0;
function check(label: string, got: number, exp: number, tol = 0) {
  const ok = Math.abs(got - exp) <= tol;
  if (!ok) fail++;
  console.log(`  ${ok ? "✓" : "✗ FALLA"} ${label}: got ${got} · esperado ${exp}${tol ? ` (±${tol})` : ""}`);
}

async function snap(fuente: string) {
  return prisma.snapshot.findFirst({
    where: { fuente: fuente as never, activo: true },
    orderBy: { createdAt: "desc" },
    select: { payload: true, fechaCorte: true },
  });
}

(async () => {
  const [s, f, sl, pr] = await Promise.all([
    snap("BASE_STOCK"),
    snap("FNE"),
    snap("SALDOS"),
    snap("PROVISIONES"),
  ]);
  console.log("Corte BASE_STOCK:", String(s?.fechaCorte).slice(0, 10));
  const stock = rehidratarStock(s!.payload);
  const fne = f?.payload ? rehidratarFNE(f.payload) : null;
  const saldos = sl?.payload ? rehidratarSaldos(sl.payload) : null;
  const provisiones = pr?.payload ? rehidratarProvisiones(pr.payload) : null;

  const vus = Array.from(buildVehiculosUnificados({ data: stock, fne, saldos }).values());

  const total = cajaInmovilizadaTotal(vus);
  const desg = desglosarCajaInmovilizada(vus);
  const com = cajaComercialGestionable(vus);
  const pagadoViejo = stockPagado(vus);

  console.log("\n══ DESGLOSE Caja Inmovilizada (TOTAL Pompeyo) ══");
  for (const [k, v] of [
    ["Total", total],
    ["Comercial", desg.comercial],
    ["Test Cars", desg.testCars],
    ["Autos Compañía", desg.autosCompania],
    ["Judicial", desg.judicial],
    ["Otros", desg.otros],
  ] as const) {
    console.log(`  ${k.padEnd(16)} ${String(v.unidades).padStart(4)} · ${M(v.monto)}`);
  }

  console.log("\n══ 1 · Cuadratura del desglose (suma = total) ══");
  const sumU = desg.comercial.unidades + desg.testCars.unidades + desg.autosCompania.unidades + desg.judicial.unidades + desg.otros.unidades;
  const sumM = desg.comercial.monto + desg.testCars.monto + desg.autosCompania.monto + desg.judicial.monto + desg.otros.monto;
  check("suma unidades = total", sumU, total.unidades);
  check("suma monto = total", Math.round(sumM), Math.round(total.monto));

  console.log("\n══ 2 · Otros = 0 (todo clasificado) ══");
  check("otros unidades", desg.otros.unidades, 0);

  console.log("\n══ 3 · Cuadratura Score ↔ Tendencias (Comercial Gestionable) ══");
  const score = calcularScoreGerencial({
    marca: "Todas las marcas",
    vus,
    saldos: saldos?.registros ?? [],
    provisiones: provisiones?.registros ?? [],
  });
  const ind1 = score.indicadores.find((i) => i.id === "stock_propio")!;
  check("Score #1 casos = Comercial desglose unid", ind1.casos, desg.comercial.unidades);
  check("Score #1 monto = Comercial desglose monto", Math.round(ind1.monto), Math.round(desg.comercial.monto));
  check("cajaComercialGestionable = desglose.comercial", com.unidades, desg.comercial.unidades);

  console.log("\n══ 4 · Contraste vs métrica antigua + auditoría aprobada ══");
  console.log(`  Stock Pagado (antiguo)     ${String(pagadoViejo.unidades).padStart(4)} · ${M(pagadoViejo.monto)}`);
  console.log(`  Caja Comercial Gestionable ${String(com.unidades).padStart(4)} · ${M(com.monto)}`);
  console.log(`  Caja Inmovilizada Total    ${String(total.unidades).padStart(4)} · ${M(total.monto)}`);
  console.log("  (auditoría 17-jun: Total 555 · Comercial 320 · Test 132 · Cía 70 · Judicial 33)");

  console.log(fail === 0 ? "\n✅ TODAS LAS CUADRATURAS OK" : `\n❌ ${fail} VALIDACIONES FALLARON`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
