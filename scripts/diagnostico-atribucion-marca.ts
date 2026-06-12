/**
 * Diagnóstico de atribución por marca — DailyCapitalSnapshot.
 * Lee los Snapshot VIGENTES (activo: true), rehidrata con los helpers reales
 * del sistema y mide, por componente, cuántos registros son atribuibles por
 * cada vía de la jerarquía propuesta:
 *   P1 VIN → Stock vigente · P2 VIN → FNE vigente · P3 marca explícita en la
 *   fuente (incl. sucursal para fuentes sin marca, regla de la función madre)
 *   · P4 realmente no atribuible.
 *
 * USO: npx tsx scripts/diagnostico-atribucion-marca.ts   (con DATABASE_URL)
 */

import { prisma } from "../src/lib/prisma";
import {
  rehidratarFNE,
  rehidratarProvisiones,
  rehidratarSaldos,
  rehidratarStock,
} from "../src/lib/historico/calcular-score-gerencial-historico";
import {
  getMarcaOperacional,
  MARCA_SIN_ORIGEN,
  normalizarMarcaOperacional,
} from "../src/lib/selectors/owner-operacional";
import { limpiarVIN } from "../src/lib/parser/venta-apc";
import { cruzarSaldosConStock } from "../src/lib/selectors/saldos";
import type { Fuente } from "@prisma/client";

async function payloadVigente(fuente: Fuente): Promise<unknown | null> {
  const s = await prisma.snapshot.findFirst({
    where: { fuente, activo: true },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  return s?.payload ?? null;
}

interface Conteo {
  total: number;
  monto: number;
  conVIN: number;
  sinVIN: number;
  conMarcaExplicita: number;
  viaVINStock: number;
  viaVINFNE: number;
  viaMarcaExplicita: number;
  viaSucursal: number;
  noAtribuibles: number;
  montoNoAtribuible: number;
}

function nuevoConteo(): Conteo {
  return {
    total: 0, monto: 0, conVIN: 0, sinVIN: 0, conMarcaExplicita: 0,
    viaVINStock: 0, viaVINFNE: 0, viaMarcaExplicita: 0, viaSucursal: 0,
    noAtribuibles: 0, montoNoAtribuible: 0,
  };
}

function imprimir(nombre: string, c: Conteo) {
  console.log(`\n══ ${nombre} ══`);
  console.log(`  Registros totales:                 ${c.total}  ($${(c.monto / 1e6).toFixed(1)}M)`);
  console.log(`  Con VIN:                           ${c.conVIN}`);
  console.log(`  Sin VIN:                           ${c.sinVIN}`);
  console.log(`  Con marca explícita en la fuente:  ${c.conMarcaExplicita}`);
  console.log(`  Atribuibles vía VIN → Stock:       ${c.viaVINStock}`);
  console.log(`  Atribuibles vía VIN → FNE:         ${c.viaVINFNE}`);
  console.log(`  Atribuibles vía marca explícita:   ${c.viaMarcaExplicita}`);
  console.log(`  Atribuibles vía sucursal (regla):  ${c.viaSucursal}`);
  console.log(`  REALMENTE no atribuibles:          ${c.noAtribuibles}  ($${(c.montoNoAtribuible / 1e6).toFixed(1)}M)`);
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

  // Bridge cajón→VIN oficial del sistema (resuelve s.vinResuelto) — el mismo
  // que ejecuta el cálculo de capital. Sin esto, el payload crudo trae 0 VINs.
  if (saldos) {
    cruzarSaldosConStock(saldos.registros, stock?.vehiculos ?? [], stock?.vinsExtra ?? null, fne);
  }

  // VIN → marca operacional (Stock y FNE vigentes)
  const vinStock = new Map<string, string>();
  for (const v of stock?.vehiculos ?? []) {
    const vin = limpiarVIN(v.vin);
    if (vin) vinStock.set(vin, getMarcaOperacional(v));
  }
  const vinFNE = new Map<string, string>();
  for (const r of fne?.registros ?? []) {
    const vin = limpiarVIN(r.vin);
    if (vin && !vinFNE.has(vin)) vinFNE.set(vin, getMarcaOperacional(r));
  }
  console.log(`Stock vigente: ${stock?.vehiculos.length ?? 0} vehículos (${vinStock.size} VINs únicos)`);
  console.log(`FNE vigente:   ${fne?.registros.length ?? 0} registros (${vinFNE.size} VINs únicos)`);

  // ── Saldos vehículo / Bonos y Comisiones ───────────────────────────
  const cVeh = nuevoConteo();
  const cBon = nuevoConteo();
  for (const s of saldos?.registros ?? []) {
    if (s.categoria !== "vehiculo" && s.categoria !== "bono_comision") continue;
    const c = s.categoria === "vehiculo" ? cVeh : cBon;
    const monto = s.saldoXDocumentar || 0;
    c.total++;
    c.monto += monto;

    const vin = s.vinResuelto ? limpiarVIN(s.vinResuelto) : null;
    if (vin) c.conVIN++; else c.sinVIN++;

    const marcaExplicita = normalizarMarcaOperacional(s.marca);
    const tieneMarca = marcaExplicita !== MARCA_SIN_ORIGEN;
    if (tieneMarca) c.conMarcaExplicita++;

    // Jerarquía P1 → P4 (cada registro cuenta en UNA vía)
    if (vin && vinStock.has(vin)) c.viaVINStock++;
    else if (vin && vinFNE.has(vin)) c.viaVINFNE++;
    else if (tieneMarca) c.viaMarcaExplicita++;
    else if (getMarcaOperacional(s) !== MARCA_SIN_ORIGEN) c.viaSucursal++; // función madre (sucursal / empresa)
    else { c.noAtribuibles++; c.montoNoAtribuible += monto; }
  }

  // ── Provisiones (ventas, saldo > 0 — criterio del capital) ─────────
  const cProv = nuevoConteo();
  for (const p of prov?.registros ?? []) {
    if (p.area !== "ventas" || (p.saldo || 0) <= 0) continue;
    const monto = p.saldo || 0;
    cProv.total++;
    cProv.monto += monto;
    cProv.sinVIN++; // ProvisionRegistro no tiene VIN (claveGestion PROV-{ID})

    const marcaExplicita = normalizarMarcaOperacional(p.origen);
    const tieneMarca = marcaExplicita !== MARCA_SIN_ORIGEN;
    if (tieneMarca) { cProv.conMarcaExplicita++; cProv.viaMarcaExplicita++; }
    else { cProv.noAtribuibles++; cProv.montoNoAtribuible += monto; }
  }

  imprimir("SALDOS (vehículo)", cVeh);
  imprimir("BONOS Y COMISIONES", cBon);
  imprimir("PROVISIONES (ventas, saldo > 0)", cProv);

  // ── Desglose por marca con la jerarquía (para validar KIA / MG) ────
  const porMarca = new Map<string, { saldos: number; bonos: number; prov: number }>();
  const add = (marca: string, k: "saldos" | "bonos" | "prov", monto: number) => {
    const row = porMarca.get(marca) ?? { saldos: 0, bonos: 0, prov: 0 };
    row[k] += monto;
    porMarca.set(marca, row);
  };
  for (const s of saldos?.registros ?? []) {
    if (s.categoria !== "vehiculo" && s.categoria !== "bono_comision") continue;
    const vin = s.vinResuelto ? limpiarVIN(s.vinResuelto) : null;
    const marca =
      (vin && vinStock.get(vin)) ||
      (vin && vinFNE.get(vin)) ||
      (normalizarMarcaOperacional(s.marca) !== MARCA_SIN_ORIGEN
        ? normalizarMarcaOperacional(s.marca)
        : getMarcaOperacional(s));
    add(marca, s.categoria === "vehiculo" ? "saldos" : "bonos", s.saldoXDocumentar || 0);
  }
  for (const p of prov?.registros ?? []) {
    if (p.area !== "ventas" || (p.saldo || 0) <= 0) continue;
    add(normalizarMarcaOperacional(p.origen), "prov", p.saldo || 0);
  }
  console.log("\n══ MONTOS POR MARCA con la jerarquía propuesta ($M) ══");
  const filas = [...porMarca.entries()].sort((a, b) =>
    b[1].saldos + b[1].bonos + b[1].prov - (a[1].saldos + a[1].bonos + a[1].prov),
  );
  for (const [marca, r] of filas) {
    console.log(
      `  ${marca.padEnd(18)} saldos $${(r.saldos / 1e6).toFixed(1).padStart(10)}M · bonos $${(r.bonos / 1e6).toFixed(1).padStart(9)}M · prov $${(r.prov / 1e6).toFixed(1).padStart(9)}M`,
    );
  }
  const sum = filas.reduce(
    (a, [, r]) => ({ s: a.s + r.saldos, b: a.b + r.bonos, p: a.p + r.prov }),
    { s: 0, b: 0, p: 0 },
  );
  console.log(
    `  ${"Σ MARCAS".padEnd(18)} saldos $${(sum.s / 1e6).toFixed(1).padStart(10)}M · bonos $${(sum.b / 1e6).toFixed(1).padStart(9)}M · prov $${(sum.p / 1e6).toFixed(1).padStart(9)}M`,
  );
  console.log(
    `  ${"TOTAL fuente".padEnd(18)} saldos $${(cVeh.monto / 1e6).toFixed(1).padStart(10)}M · bonos $${(cBon.monto / 1e6).toFixed(1).padStart(9)}M · prov $${(cProv.monto / 1e6).toFixed(1).padStart(9)}M`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
