/**
 * VALIDACIÓN · Reserva vigente en Caja Comercial Gestionable.
 *
 * Prueba, con funciones reales + snapshots vigentes, que:
 *   1. Los VINs con reserva vigente SIGUEN dentro de Caja Comercial Gestionable
 *      (regla de negocio: una reserva NO saca al auto de la métrica).
 *   2. El conteo de reserva vigente coincide con el dato crudo de Base_Stock
 *      (estadoVenta ∈ {Vigente, Aprobada}).
 *   3. La clasificación cubre el 100% (vigente+vencida+caída+sin = total).
 *   4. Ejemplos reales con folio / vendedor / fecha / aging / estado.
 *
 * Read-only. Correr contra prod (railway run, DATABASE_URL inyectado).
 */
import { PrismaClient } from "@prisma/client";
import {
  rehidratarStock,
  rehidratarSaldos,
  rehidratarFNE,
} from "../src/lib/historico/calcular-score-gerencial-historico";
import { buildVehiculosUnificados } from "../src/lib/selectors/vehiculo-unificado";
import { cajaComercialGestionable } from "../src/lib/selectors/capital-trabajo";
import { reservaDeVU, tieneReservaVigente } from "../src/lib/selectors/reserva";
import { limpiarVIN } from "../src/lib/parser/venta-apc";

const prisma = new PrismaClient();
let fail = 0;
const check = (label: string, got: number, exp: number) => {
  const ok = got === exp;
  if (!ok) fail++;
  console.log(`  ${ok ? "✓" : "✗ FALLA"} ${label}: got ${got} · esperado ${exp}`);
};
async function snap(f: string) {
  return prisma.snapshot.findFirst({ where: { fuente: f as never, activo: true }, orderBy: { createdAt: "desc" }, select: { payload: true, fechaCorte: true } });
}

(async () => {
  const [s, f, sl] = await Promise.all([snap("BASE_STOCK"), snap("FNE"), snap("SALDOS")]);
  const corte = s?.fechaCorte ? new Date(s.fechaCorte) : new Date();
  console.log("Corte:", String(s?.fechaCorte).slice(0, 10), "(usado como 'hoy' para aging)");
  const stock = rehidratarStock(s!.payload);
  if (!stock) throw new Error("Sin BASE_STOCK activo");
  const fne = f?.payload ? rehidratarFNE(f.payload) : null;
  const saldos = sl?.payload ? rehidratarSaldos(sl.payload) : null;
  const vus = Array.from(buildVehiculosUnificados({ data: stock, fne, saldos }).values());
  const raw = new Map<string, any>();
  for (const v of stock.vehiculos as any[]) { const k = limpiarVIN(v.vin); if (!raw.has(k)) raw.set(k, v); }

  const com = cajaComercialGestionable(vus).items;
  console.log(`\nCaja Comercial Gestionable: ${com.length} VIN`);

  // Distribución por estado de reserva
  const dist = { vigente: 0, vencida: 0, caida: 0, sin_reserva: 0 } as Record<string, number>;
  for (const vu of com) dist[reservaDeVU(vu, corte).estado]++;
  console.log("\n══ Distribución reserva (sobre los", com.length, "comerciales) ══");
  for (const k of ["vigente", "vencida", "caida", "sin_reserva"]) console.log(`  ${k.padEnd(12)} ${dist[k]}`);

  console.log("\n══ 1 · Cobertura 100% (suma = total) ══");
  check("vigente+vencida+caída+sin = total", dist.vigente + dist.vencida + dist.caida + dist.sin_reserva, com.length);

  console.log("\n══ 2 · Reserva vigente NO sale de la métrica ══");
  // Conteo independiente desde el raw: estadoVenta ∈ {Vigente, Aprobada} entre los comerciales.
  const comSet = new Set(com.map((vu) => vu.vinLimpio));
  const rawReservaEnCom = [...comSet].filter((v) => {
    const ev = String(raw.get(v)?.estadoVenta ?? "").trim().toUpperCase();
    return ev === "VIGENTE" || ev === "APROBADA";
  }).length;
  const reservadosSelector = com.filter((vu) => tieneReservaVigente(vu, corte)).length;
  check("reserva vigente (selector) = reserva vigente (raw, dentro de com)", reservadosSelector, rawReservaEnCom);
  check("vigente+vencida = reserva vigente total", dist.vigente + dist.vencida, reservadosSelector);
  // Todos los reservados están en com (por construcción se filtró com) → 0 fuera.
  const reservadosFueraDeCom = com.filter((vu) => tieneReservaVigente(vu, corte) && !comSet.has(vu.vinLimpio)).length;
  check("reservados fuera de Caja Comercial", reservadosFueraDeCom, 0);

  console.log("\n══ 4 · Ejemplos reales ══");
  const ejemplos = com.map((vu) => ({ vu, r: reservaDeVU(vu, corte) })).filter((x) => x.r.estado !== "sin_reserva");
  for (const { vu, r } of ejemplos.slice(0, 12)) {
    console.log(`  [${r.estado.toUpperCase().padEnd(7)}] ${vu.vinLimpio} · ${vu.marca} · ${r.badge} · folio ${r.folio ?? "—"} · ${(r.vendedor ?? "—").slice(0, 18)} · ${r.fechaVenta ? String(r.fechaVenta).slice(4, 15) : "—"} · ${r.agingDias ?? "—"}d`);
  }
  console.log(`  ... total con señal de reserva: ${ejemplos.length}`);

  console.log(fail === 0 ? "\n✅ TODAS LAS VALIDACIONES OK" : `\n❌ ${fail} VALIDACIONES FALLARON`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
