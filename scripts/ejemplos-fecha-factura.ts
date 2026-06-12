/**
 * Ejemplos reales ANTES/DESPUÉS — corrección fecha venta → fecha factura.
 * Toma los payloads vigentes y muestra, para VINs reales:
 *   · 1 VIN FNE (detector Base_Stock): aging antes (venta) vs después (factura real vía FNE oficial).
 *   · 1 VIN con Crédito Pompeyo: aging antes (fechaVenta del saldo) vs después (factura FNE).
 *   · 1 VIN de Saldos: días desde factura antes (fallback venta) vs después (factura FNE).
 *
 * USO: npx tsx scripts/ejemplos-fecha-factura.ts
 */

import { prisma } from "../src/lib/prisma";
import {
  rehidratarFNE,
  rehidratarSaldos,
  rehidratarStock,
} from "../src/lib/historico/calcular-score-gerencial-historico";
import { esFNE, mapaFechaFacturaPorVin } from "../src/lib/selectors/fne";
import { resolverVinsSaldos } from "../src/lib/selectors/saldos";
import { limpiarVIN } from "../src/lib/parser/venta-apc";
import type { Fuente } from "@prisma/client";

const HOY = new Date();
const dias = (d: Date | null | undefined) =>
  d ? Math.floor((HOY.getTime() - d.getTime()) / 86_400_000) : null;
const f = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");

async function pv(fuente: Fuente) {
  const s = await prisma.snapshot.findFirst({
    where: { fuente, activo: true },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  return s?.payload ?? null;
}

async function main() {
  const stock = rehidratarStock(await pv("BASE_STOCK"));
  const saldos = rehidratarSaldos(await pv("SALDOS"));
  const fne = rehidratarFNE(await pv("FNE"));
  if (!stock || !saldos || !fne) {
    throw new Error("Faltan payloads vigentes (BASE_STOCK / SALDOS / FNE)");
  }
  const facturas = mapaFechaFacturaPorVin(fne);
  resolverVinsSaldos(saldos.registros, stock.vehiculos, stock.vinsExtra ?? null, fne);

  const fnePorVin = new Map(fne.registros.map((r) => [limpiarVIN(r.vin), r]));

  // ── 1 · VIN FNE (detector legacy Base_Stock) ───────────────────────
  const candidatoFNE = stock.vehiculos.find((v) => {
    if (!esFNE(v) || !v.fechaVenta) return false;
    const ff = facturas.get(limpiarVIN(v.vin));
    return ff != null && f(ff) !== f(v.fechaVenta);
  });
  console.log("══ 1 · VIN FNE (detector Base_Stock) ══");
  if (candidatoFNE) {
    const vin = limpiarVIN(candidatoFNE.vin);
    const ff = facturas.get(vin)!;
    console.log(`  VIN: ${vin} · ${candidatoFNE.marcaPompeyo} ${candidatoFNE.modelo ?? ""}`);
    console.log(`  ANTES   · base fechaVenta   ${f(candidatoFNE.fechaVenta)} → aging ${dias(candidatoFNE.fechaVenta)}d`);
    console.log(`  DESPUÉS · base fechaFactura ${f(ff)} → aging ${dias(ff)}d`);
    console.log(`  Diferencia: ${dias(candidatoFNE.fechaVenta)! - dias(ff)!}d`);
  } else {
    console.log("  (sin candidato con factura ≠ venta)");
  }

  // ── 2 · VIN con Crédito Pompeyo ────────────────────────────────────
  const cp = saldos.registros.find((s) => {
    if (s.subTipo !== "credito_pompeyo" || s.cPompeyoCLP <= 0 || !s.fechaVenta) return false;
    const vin = s.vinResuelto ? limpiarVIN(s.vinResuelto) : null;
    if (!vin) return false;
    const reg = fnePorVin.get(vin);
    return reg?.fechaFactura != null && f(reg.fechaFactura) !== f(s.fechaVenta);
  });
  console.log("\n══ 2 · VIN con Crédito Pompeyo ══");
  if (cp) {
    const vin = limpiarVIN(cp.vinResuelto!);
    const reg = fnePorVin.get(vin)!;
    console.log(`  VIN: ${vin} · ${cp.marca ?? "—"} · CP $${(cp.cPompeyoCLP / 1e6).toFixed(1)}M`);
    console.log(`  ANTES   · base fechaVenta   ${f(cp.fechaVenta)} → aging ${dias(cp.fechaVenta)}d`);
    console.log(`  DESPUÉS · base fechaFactura ${f(reg.fechaFactura)} → aging ${dias(reg.fechaFactura)}d`);
    console.log(`  Diferencia: ${dias(cp.fechaVenta)! - dias(reg.fechaFactura)!}d`);
  } else {
    console.log("  (sin candidato CP con VIN resuelto y factura ≠ venta)");
  }

  // ── 3 · VIN de Saldos (vehículo) ───────────────────────────────────
  const sv = saldos.registros.find((s) => {
    if (s.categoria !== "vehiculo" || !s.fechaVenta) return false;
    if (s.subTipo === "credito_pompeyo") return false;
    const vin = s.vinResuelto ? limpiarVIN(s.vinResuelto) : null;
    if (!vin) return false;
    const reg = fnePorVin.get(vin);
    return reg?.fechaFactura != null && f(reg.fechaFactura) !== f(s.fechaVenta);
  });
  console.log("\n══ 3 · VIN de Saldos (vehículo) ══");
  if (sv) {
    const vin = limpiarVIN(sv.vinResuelto!);
    const reg = fnePorVin.get(vin)!;
    console.log(`  VIN: ${vin} · ${sv.marca ?? "—"} · saldo $${((sv.saldoXDocumentar || 0) / 1e6).toFixed(1)}M (${sv.subTipo})`);
    console.log(`  ANTES   · base fechaVenta   ${f(sv.fechaVenta)} → aging ${dias(sv.fechaVenta)}d`);
    console.log(`  DESPUÉS · base fechaFactura ${f(reg.fechaFactura)} → aging ${dias(reg.fechaFactura)}d`);
    console.log(`  Diferencia: ${dias(sv.fechaVenta)! - dias(reg.fechaFactura)!}d`);
  } else {
    console.log("  (sin candidato de saldos con factura ≠ venta)");
  }

  // ── Estadística global del impacto ─────────────────────────────────
  let conFactura = 0;
  let soloVenta = 0;
  let sumaDiff = 0;
  for (const s of saldos.registros) {
    if (s.categoria !== "vehiculo" || !s.fechaVenta) continue;
    const vin = s.vinResuelto ? limpiarVIN(s.vinResuelto) : null;
    const reg = vin ? fnePorVin.get(vin) : null;
    if (reg?.fechaFactura) {
      conFactura++;
      sumaDiff += dias(s.fechaVenta)! - dias(reg.fechaFactura)!;
    } else {
      soloVenta++;
    }
  }
  console.log("\n══ Impacto global (saldos vehículo con fechaVenta) ══");
  console.log(`  Con factura real disponible (vía VIN→FNE): ${conFactura}`);
  console.log(`  Solo venta (fallback marcado):             ${soloVenta}`);
  if (conFactura > 0) {
    console.log(`  Sesgo promedio venta vs factura:           ${(sumaDiff / conFactura).toFixed(1)}d`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
