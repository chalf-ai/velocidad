/**
 * Validación de cuadratura — DailyCapitalSnapshot por marca.
 * Recalcula los componentes por marca con LAS MISMAS funciones del módulo
 * (marcaDeSaldo / marcaDeProvision / capitalDesdePayloads) y compara contra
 * las filas persistidas del día. Verifica: KIA, MG y Σ marcas = TOTAL.
 *
 * USO: npx tsx scripts/validar-cuadratura-marca.ts
 */

import { prisma } from "../src/lib/prisma";
import {
  rehidratarFNE,
  rehidratarProvisiones,
  rehidratarSaldos,
  rehidratarStock,
} from "../src/lib/historico/calcular-score-gerencial-historico";
import {
  construirMapasVinMarca,
  marcaDeProvision,
  marcaDeSaldo,
} from "../src/lib/historico/capital-por-corte";
import { cruzarSaldosConStock } from "../src/lib/selectors/saldos";
import { fechaHoySantiago } from "../src/lib/snapshots/daily-capital";
import type { Fuente } from "@prisma/client";

const fM = (n: number) => `$${(n / 1e6).toFixed(1)}M`;

async function payloadVigente(fuente: Fuente) {
  const s = await prisma.snapshot.findFirst({
    where: { fuente, activo: true },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  return s?.payload ?? null;
}

async function main() {
  const [stockP, saldosP, provP, fneP] = await Promise.all([
    payloadVigente("BASE_STOCK"),
    payloadVigente("SALDOS"),
    payloadVigente("PROVISIONES"),
    payloadVigente("FNE"),
  ]);
  const stock = stockP ? rehidratarStock(stockP) : null;
  const saldos = saldosP ? rehidratarSaldos(saldosP) : null;
  const prov = provP ? rehidratarProvisiones(provP) : null;
  const fne = fneP ? rehidratarFNE(fneP) : null;
  // Mismo bridge cajón→VIN que usa el cálculo (resuelve s.vinResuelto).
  if (saldos) {
    cruzarSaldosConStock(saldos.registros, stock?.vehiculos ?? [], stock?.vinsExtra ?? null, fne);
  }
  const mapas = construirMapasVinMarca(stock, fne);

  // Recalcular por marca con las funciones del módulo (ground truth)
  type Acc = { saldos: number; saldosU: number; bonos: number; bonosU: number; prov: number; provU: number };
  const porMarca = new Map<string, Acc>();
  const get = (m: string) => {
    const r = porMarca.get(m) ?? { saldos: 0, saldosU: 0, bonos: 0, bonosU: 0, prov: 0, provU: 0 };
    porMarca.set(m, r);
    return r;
  };
  for (const s of saldos?.registros ?? []) {
    if (s.categoria !== "vehiculo" && s.categoria !== "bono_comision") continue;
    const r = get(marcaDeSaldo(s, mapas));
    if (s.categoria === "vehiculo") { r.saldos += s.saldoXDocumentar; r.saldosU++; }
    else { r.bonos += s.saldoXDocumentar; r.bonosU++; }
  }
  for (const p of prov?.registros ?? []) {
    if (p.area !== "ventas" || (p.saldo || 0) <= 0) continue;
    const r = get(marcaDeProvision(p));
    r.prov += p.saldo || 0;
    r.provU++;
  }

  // Filas persistidas de hoy
  const { fecha } = fechaHoySantiago();
  const filas = await prisma.dailyCapitalSnapshot.findMany({ where: { fecha } });
  const total = filas.find((f) => f.scopeTipo === "TOTAL");
  const marcas = filas.filter((f) => f.scopeTipo === "MARCA");

  console.log(`Filas de hoy: ${filas.length} (1 TOTAL + ${marcas.length} marcas)\n`);

  // 1) Σ marcas vs TOTAL, por componente
  const suma = marcas.reduce(
    (a, f) => ({
      saldos: a.saldos + (f.saldosMonto ?? 0),
      bonos: a.bonos + (f.bonosMonto ?? 0),
      prov: a.prov + (f.provisionesMonto ?? 0),
      stock: a.stock + (f.stockPagadoMonto ?? 0),
    }),
    { saldos: 0, bonos: 0, prov: 0, stock: 0 },
  );
  console.log("══ Σ MARCAS vs TOTAL ══");
  const chk = (n: string, s: number, t: number | null) => {
    const diff = s - (t ?? 0);
    console.log(
      `  ${n.padEnd(12)} Σ marcas ${fM(s).padStart(10)} · TOTAL ${fM(t ?? 0).padStart(10)} · diff ${fM(diff)} ${Math.abs(diff) < 1 ? "✓ CUADRA" : "✗ NO CUADRA"}`,
    );
  };
  chk("Saldos", suma.saldos, total?.saldosMonto ?? 0);
  chk("Bonos", suma.bonos, total?.bonosMonto ?? 0);
  chk("Provisiones", suma.prov, total?.provisionesMonto ?? 0);
  chk("Stock Pagado", suma.stock, total?.stockPagadoMonto ?? 0);

  // 2) KIA y MG: DB vs recálculo con funciones del módulo
  console.log("\n══ KIA / MG · DB vs recálculo módulo ══");
  for (const m of ["KIA MOTORS", "MG"]) {
    const db = marcas.find((f) => f.marca === m);
    const rc = porMarca.get(m) ?? { saldos: 0, saldosU: 0, bonos: 0, bonosU: 0, prov: 0, provU: 0 };
    const ok =
      Math.abs((db?.saldosMonto ?? 0) - rc.saldos) < 1 &&
      Math.abs((db?.bonosMonto ?? 0) - rc.bonos) < 1 &&
      Math.abs((db?.provisionesMonto ?? 0) - rc.prov) < 1;
    console.log(`  ${m}: ${ok ? "✓ DB = recálculo" : "✗ DIFIEREN"}`);
    console.log(`    saldos  DB ${fM(db?.saldosMonto ?? 0)} (${db?.saldosUnidades}u) · módulo ${fM(rc.saldos)} (${rc.saldosU}u)`);
    console.log(`    bonos   DB ${fM(db?.bonosMonto ?? 0)} (${db?.bonosUnidades}u) · módulo ${fM(rc.bonos)} (${rc.bonosU}u)`);
    console.log(`    prov    DB ${fM(db?.provisionesMonto ?? 0)} (${db?.provisionesUnidades}u) · módulo ${fM(rc.prov)} (${rc.provU}u)`);
  }

  // 3) No atribuibles documentados
  const sinOrigen = porMarca.get("SIN MARCA ORIGEN");
  console.log("\n══ Realmente NO atribuibles (bucket SIN MARCA ORIGEN) ══");
  console.log(
    sinOrigen
      ? `  saldos ${fM(sinOrigen.saldos)} (${sinOrigen.saldosU}u) · bonos ${fM(sinOrigen.bonos)} (${sinOrigen.bonosU}u) · prov ${fM(sinOrigen.prov)} (${sinOrigen.provU}u)`
      : "  (ninguno)",
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
