/**
 * AUDITORÍA Capital de Trabajo · Score Gerencial vs Tendencias.
 *
 * Carga el MISMO snapshot que ve Score (BASE_STOCK/FNE/SALDOS/PROVISIONES activos
 * en la DB) y computa las 4 métricas con la definición de CADA módulo, sobre el
 * MISMO corte (aísla "definición" de "fecha"). Usa la lógica REAL de producción.
 *
 * USO: npx tsx scripts/audit-captrabajo-unificacion.ts
 */
import { PrismaClient } from "@prisma/client";
import { deserializeStockPayload, reviveDates } from "../src/lib/snapshot-client";
import { buildVehiculosUnificados, type VehiculoUnificado } from "../src/lib/selectors/vehiculo-unificado";
import { calcularCapitalPagado } from "../src/lib/selectors/capital-pagado";
import { diasMaxCreditoPompeyo } from "../src/lib/gestion/caso";
import { limpiarVIN } from "../src/lib/parser/venta-apc";
import type { ParsedFNE, ParsedSaldos, ParsedProvisiones } from "../src/lib/types";

const prisma = new PrismaClient();
const fmt = (n: number) => Math.round(n).toLocaleString("es-CL");
const M = (n: number) => `$${(n / 1e6).toFixed(1)}M`;

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
  console.log("── Snapshots activos (lo que ve Score):");
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

  // ════════ 1 · STOCK: "Stock Propio" (Score) vs "Stock Pagado" (Tendencias) ════
  const COND_NUEVOS = new Set(["EXISTENCIA NUEVOS", "VN CON PATENTE", "TEST CARS"]);
  const normC = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
  // Score (def "Todas las marcas": esUsados=false → COND_NUEVOS)
  const propio = vus.filter(
    (vu) =>
      vu.enStockActivo &&
      vu.stockAB !== "Judicial" &&
      (vu.tipoStock === "Propio" || vu.tipoStock === "FinPropio") &&
      COND_NUEVOS.has(normC(vu.condicionDeStock)),
  );
  const propioVins = new Set(propio.map((v) => limpiarVIN(v.vinLimpio)));
  const propioMonto = propio.reduce((s, v) => s + (v.costoNeto ?? 0), 0);

  // Tendencias (def): calcularCapitalPagado = uniqByVin(vehiculos).filter(pagado)
  const pagStats = calcularCapitalPagado(data.vehiculos);
  const seen = new Set<string>();
  const pagadoVehs = data.vehiculos.filter((v) => {
    if (seen.has(v.vin)) return false;
    seen.add(v.vin);
    return v.pagado;
  });
  const pagadoVins = new Set(pagadoVehs.map((v) => limpiarVIN(v.vin)));

  // OFICIAL elegido por negocio (2026-06): pagado + activo + NO Judicial.
  const oficial = vus.filter((vu) => vu.esPagado && vu.enStockActivo && vu.stockAB !== "Judicial");
  const oficialMonto = oficial.reduce((s, v) => s + (v.costoNeto ?? 0), 0);

  console.log("\n══════════ 1 · STOCK ══════════");
  console.log(`  Score 'Stock Propio'   : ${propio.length} VIN · ${M(propioMonto)} (activo+Propio/FinPropio+condición, sin Judicial)`);
  console.log(`  Tend. 'Stock Pagado'   : ${pagStats.totalUnidades} VIN · ${M(pagStats.capitalTotal)} (Pagado?=pagado, cualquier estado)`);
  console.log(`  >> OFICIAL Stock Pagado: ${oficial.length} VIN · ${M(oficialMonto)} (pagado + activo + sin Judicial)`);
  const enAmbos = [...propioVins].filter((v) => pagadoVins.has(v));
  const propioNoPagado = propio.filter((v) => !pagadoVins.has(limpiarVIN(v.vinLimpio)));
  const pagadoNoPropio = pagadoVehs.filter((v) => !propioVins.has(limpiarVIN(v.vin)));
  console.log(`  ∩ en ambos             : ${enAmbos.length} VIN`);
  console.log(`  Propio pero NO Pagado  : ${propioNoPagado.length} VIN · ${M(propioNoPagado.reduce((s, v) => s + (v.costoNeto ?? 0), 0))}`);
  console.log(`  Pagado pero NO Propio  : ${pagadoNoPropio.length} VIN · ${M(pagadoNoPropio.reduce((s, v) => s + (v.costoNeto ?? 0), 0))}`);

  console.log("\n  ── Muestra · Propio pero NO Pagado (por qué Score>Tendencias):");
  for (const v of propioNoPagado.slice(0, 8))
    console.log(`    ${v.vinLimpio} · ${v.marca ?? "—"} · tipo=${v.tipoStock} · cond=${v.condicionDeStock ?? "—"} · pagado=NO`);
  console.log("  ── Muestra · Pagado pero NO Propio (por qué Tendencias tiene otros):");
  const vehByVin = new Map(vus.map((v) => [limpiarVIN(v.vinLimpio), v]));
  for (const v of pagadoNoPropio.slice(0, 8)) {
    const vu = vehByVin.get(limpiarVIN(v.vin));
    const motivo = !vu ? "no está en VU activo" : !vu.enStockActivo ? "no enStockActivo (FNE/entregado)" : vu.stockAB === "Judicial" ? "Judicial" : (vu.tipoStock !== "Propio" && vu.tipoStock !== "FinPropio") ? `tipoStock=${vu.tipoStock}` : !COND_NUEVOS.has(normC(vu.condicionDeStock)) ? `cond=${vu.condicionDeStock}` : "?";
    console.log(`    ${v.vin} · ${v.marca ?? "—"} · ${motivo}`);
  }

  // ════════ 2 · PROVISIONES ════════
  console.log("\n══════════ 2 · PROVISIONES ══════════");
  if (provisiones) {
    const regs = provisiones.registros;
    const score90 = regs.filter((p) => (p.saldo ?? 0) !== 0 && (p.agingDias ?? 0) > 90);
    const tendVentas = regs.filter((p) => p.area === "ventas" && (p.saldo || 0) > 0);
    console.log(`  Score 'Prov >90d'      : ${score90.length} · ${M(score90.reduce((s, p) => s + Math.abs(p.saldo ?? 0), 0))} (saldo≠0 & aging>90, TODAS las áreas)`);
    console.log(`  Tend. 'Provisiones'    : ${tendVentas.length} · ${M(tendVentas.reduce((s, p) => s + (p.saldo || 0), 0))} (area=ventas & saldo>0, SIN aging)`);
  } else console.log("  (sin PROVISIONES activo)");

  // ════════ 3 · CRÉDITO POMPEYO ════════
  console.log("\n══════════ 3 · CRÉDITO POMPEYO ══════════");
  const cp15 = vus.filter((vu) => {
    if (vu.creditoPompeyo <= 0) return false;
    const d = diasMaxCreditoPompeyo(vu);
    return d != null && d > 15;
  });
  console.log(`  Score 'CP >15d'        : ${cp15.length} · ${M(cp15.reduce((s, v) => s + v.creditoPompeyo, 0))} (CP>0 & >15d desde factura)`);
  console.log(`  Tend.                  : NO existe componente Crédito Pompeyo (usa 'Bonos y Comisiones')`);

  // ════════ 4 · SALDOS ════════
  console.log("\n══════════ 4 · SALDOS VEHÍCULO ══════════");
  if (saldos) {
    const T3 = new Set(["T3", "T4", "T5", "T6", "T7"]);
    const veh = saldos.registros.filter((r) => r.categoria === "vehiculo");
    const t3 = veh.filter((r) => T3.has(r.statusDPS));
    console.log(`  Score 'Saldos T3+'     : ${t3.length} · ${M(t3.reduce((s, r) => s + (r.saldoXDocumentar ?? 0), 0))} (statusDPS T3-T7)`);
    console.log(`  Tend. 'Saldos'         : ${veh.length} · ${M(veh.reduce((s, r) => s + (r.saldoXDocumentar ?? 0), 0))} (TODOS los saldos vehículo, sin T3)`);
  } else console.log("  (sin SALDOS activo)");

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
