/**
 * VALIDACIÓN CRUZADA Fase 5 · Score Gerencial == Tendencias.
 *
 * Demuestra, con datos reales y el MISMO corte (snapshots activos), que las 4
 * métricas oficiales de Capital de Trabajo coinciden EXACTAMENTE entre:
 *   · SCORE:      calcularScoreGerencial(...)  — el motor real de /score-gerencial,
 *                 alimentado como lo hace la página (useDatosFiltrados + VUs).
 *   · TENDENCIAS: capitalDesdePayloads(...)    — el motor real de /tendencias.
 *
 * Compara unidades, monto, % (donde aplica) y aging máximo (prov / CP). Corre
 * para TOTAL y para cada marca, listando discrepancias si las hubiera.
 *
 * USO: DATABASE_URL="postgresql://Daviid@localhost:5432/velocidad" npx tsx scripts/validate-score-vs-tendencias.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  rehidratarFNE,
  rehidratarProvisiones,
  rehidratarSaldos,
  rehidratarStock,
} from "../src/lib/historico/calcular-score-gerencial-historico";
import {
  buildVehiculosUnificados,
  type VehiculoUnificado,
} from "../src/lib/selectors/vehiculo-unificado";
import { calcularScoreGerencial } from "../src/lib/selectors/score-gerencial";
import {
  capitalDesdePayloads,
  marcasConCapital,
} from "../src/lib/historico/capital-por-corte";
import {
  filtrarPorMarcaOperacional,
  filtrarPorMarcaOwnerUOriginador,
  normalizarMarcaOperacional,
} from "../src/lib/selectors/owner-operacional";
import { diasMaxCreditoPompeyo } from "../src/lib/gestion/caso";
import type { ParsedExcel, ParsedFNE, ParsedProvisiones, ParsedSaldos } from "../src/lib/types";

const prisma = new PrismaClient();
const M = (n: number) => `$${(n / 1e6).toFixed(1)}M`;

async function snap(fuente: string) {
  const s = await prisma.snapshot.findFirst({
    where: { fuente: fuente as never, activo: true },
    orderBy: { createdAt: "desc" },
    select: { payload: true, fechaCorte: true },
  });
  return s;
}

/** Lado SCORE: replica EXACTO el armado de /score-gerencial (useDatosFiltrados + VUs). */
function ladoScore(
  payloads: {
    stock: ParsedExcel | null;
    fne: ParsedFNE | null;
    saldos: ParsedSaldos | null;
    provisiones: ParsedProvisiones | null;
  },
  marca: string | null,
) {
  let { stock, fne, saldos, provisiones } = payloads;
  if (marca) {
    const objetivo = normalizarMarcaOperacional(marca);
    stock = stock
      ? {
          ...stock,
          vehiculos: filtrarPorMarcaOwnerUOriginador(stock.vehiculos, marca),
          vinsExtra: stock.vinsExtra
            ? new Map(
                [...stock.vinsExtra].filter(
                  ([, info]) => normalizarMarcaOperacional(info.marca) === objetivo,
                ),
              )
            : stock.vinsExtra,
        }
      : null;
    fne = fne ? { ...fne, registros: filtrarPorMarcaOperacional(fne.registros, marca) } : null;
    saldos = saldos
      ? { ...saldos, registros: filtrarPorMarcaOperacional(saldos.registros, marca) }
      : null;
    provisiones = provisiones
      ? { ...provisiones, registros: filtrarPorMarcaOperacional(provisiones.registros, marca) }
      : null;
  }
  const vus: VehiculoUnificado[] = stock
    ? Array.from(buildVehiculosUnificados({ data: stock, fne, saldos }).values())
    : [];
  const sg = calcularScoreGerencial({
    marca: marca ?? "Todas las marcas",
    vus,
    saldos: saldos?.registros ?? [],
    provisiones: provisiones?.registros ?? [],
  });
  const byId = Object.fromEntries(sg.indicadores.map((i) => [i.id, i]));
  const agingProv = sg.drill.provisiones90d.length
    ? Math.max(...sg.drill.provisiones90d.map((p) => p.agingDias ?? 0))
    : 0;
  const agingCP = sg.drill.cp15d.length
    ? Math.max(...sg.drill.cp15d.map((vu) => diasMaxCreditoPompeyo(vu) ?? 0))
    : 0;
  return {
    stockPagado: { u: byId.stock_propio.casos, m: byId.stock_propio.monto },
    provisiones90: { u: byId.provisiones_90d.casos, m: byId.provisiones_90d.monto, aging: agingProv },
    creditoPompeyo15: { u: byId.cp_15d.casos, m: byId.cp_15d.monto, aging: agingCP },
    saldosT3: { u: byId.saldos_t3.casos, m: byId.saldos_t3.monto },
  };
}

let fallos = 0;
function cmp(nombre: string, a: { u: number; m: number }, b: { u: number; m: number }) {
  const okU = a.u === b.u;
  const okM = Math.abs(a.m - b.m) < 1;
  const ok = okU && okM;
  if (!ok) fallos++;
  console.log(
    `  ${nombre.padEnd(22)} Score ${String(a.u).padStart(4)}u · ${M(a.m).padStart(9)}` +
      `  |  Tend ${String(b.u).padStart(4)}u · ${M(b.m).padStart(9)}  ${ok ? "OK" : "✗ DISCREPA"}`,
  );
}

async function main() {
  const [sp, fp, slp, pp] = await Promise.all([
    snap("BASE_STOCK"), snap("FNE"), snap("SALDOS"), snap("PROVISIONES"),
  ]);
  if (!sp) throw new Error("Sin BASE_STOCK activo");
  const corte = String(sp.fechaCorte).slice(0, 10);

  const payloads = {
    stock: sp.payload ? rehidratarStock(sp.payload) : null,
    fne: fp?.payload ? rehidratarFNE(fp.payload) : null,
    saldos: slp?.payload ? rehidratarSaldos(slp.payload) : null,
    provisiones: pp?.payload ? rehidratarProvisiones(pp.payload) : null,
  };

  console.log(`Corte (BASE_STOCK): ${corte}\n`);

  const marcas = marcasConCapital(payloads);
  const scopes: (string | null)[] = [null, ...marcas];

  for (const marca of scopes) {
    const score = ladoScore(payloads, marca);
    const tend = capitalDesdePayloads({
      stock: payloads.stock,
      saldos: payloads.saldos,
      provisiones: payloads.provisiones,
      fne: payloads.fne,
      marca,
    });
    const t = (c: { unidades: number; monto: number } | null) => ({
      u: c?.unidades ?? 0,
      m: c?.monto ?? 0,
    });
    console.log(`══ ${marca ?? "TOTAL (todas las marcas)"} ══`);
    cmp("Stock Pagado", score.stockPagado, t(tend.stockPagado));
    cmp("Provisiones >90d", score.provisiones90, t(tend.provisiones90));
    cmp("Crédito Pompeyo >15d", score.creditoPompeyo15, t(tend.creditoPompeyo15));
    cmp("Saldos Vehículo T3+", score.saldosT3, t(tend.saldosT3));
    if (marca === null) {
      console.log(
        `  aging máx · prov ${score.provisiones90.aging}d · CP ${score.creditoPompeyo15.aging}d`,
      );
    }
    console.log("");
  }

  console.log(
    fallos === 0
      ? `✅ TODO CUADRA · Score == Tendencias en ${scopes.length} scopes (TOTAL + ${marcas.length} marcas)`
      : `❌ ${fallos} discrepancia(s) — revisar arriba`,
  );
  await prisma.$disconnect();
  if (fallos > 0) process.exit(1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
