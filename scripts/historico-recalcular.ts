#!/usr/bin/env tsx
/**
 * CLI · recalcula la consolidación 1b-A de un período histórico sin
 * volver a subir archivos. Útil para:
 *   · Reproceso después de cambiar umbrales en config.ts.
 *   · Verificación de KPIs sobre archivos ya guardados.
 *   · Backfill controlado de períodos anteriores.
 *
 * Uso:
 *   npx tsx scripts/historico-recalcular.ts 2026-05
 *   npx tsx scripts/historico-recalcular.ts 2026-03 2026-04 2026-05 2026-06
 *
 * NO toca producción salvo que DATABASE_URL apunte allá explícitamente.
 * Por defecto usa la del .env del proyecto (local).
 */

// Cargar variables de entorno desde .env.local ANTES de importar prisma.
// Los imports ESM se hoisten al top, así que prisma/* van con dynamic import
// dentro de main() para que dotenv corra primero.
import { config as dotenvConfig } from "dotenv";
import path from "node:path";

dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

function fmtNum(n: number): string {
  return n.toLocaleString("es-CL");
}

async function main() {
  // Dynamic imports para que dotenv (arriba) corra antes de inicializar prisma.
  const { consolidarPeriodo } = await import("../src/lib/historico/consolidar-periodo");
  const { prisma } = await import("../src/lib/prisma");

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Uso: npx tsx scripts/historico-recalcular.ts <YYYY-MM> [<YYYY-MM> ...]");
    process.exit(1);
  }

  // Validar formato períodos
  for (const p of args) {
    if (!/^\d{4}-\d{2}$/.test(p)) {
      console.error(`[error] Período inválido: ${p} (esperado YYYY-MM)`);
      process.exit(1);
    }
  }

  console.log(`[recalcular] períodos a procesar: ${args.join(", ")}`);
  console.log(
    `[recalcular] DATABASE_URL=${(process.env.DATABASE_URL ?? "default").replace(/:[^:@]*@/, ":***@")}`,
  );

  let okCount = 0;
  let failCount = 0;

  for (const periodo of args) {
    console.log(`\n─── ${periodo} ─────────────────────────────────────────`);
    const t0 = Date.now();
    const res = await consolidarPeriodo(periodo);
    const dur = Date.now() - t0;

    if (!res.ok) {
      console.error(`[fail] ${periodo}: ${res.error}`);
      failCount++;
      continue;
    }
    okCount++;

    console.log(`[ok] ${periodo} · ${dur} ms${res.correctionCreada ? " · correction creada" : ""}`);
    console.log(`  KPIs llenados (${res.kpisLlenados.length}):`);
    for (const k of res.kpisLlenados) console.log(`    · ${k}`);
    if (res.kpisNull.length > 0) {
      console.log(`  KPIs null (${res.kpisNull.length}):`);
      for (const k of res.kpisNull) console.log(`    · ${k}`);
    }
    if (res.warnings.length > 0) {
      console.log(`  warnings (${res.warnings.length}):`);
      for (const w of res.warnings) console.log(`    ⚠ ${w}`);
    }

    // Mostrar los KPIs reales que quedaron persistidos
    const snap = await prisma.operationalSnapshot.findFirst({
      where: { snapshotPeriod: periodo, snapshotType: "monthly" },
      select: {
        capitalTrabajoTotal: true,
        capitalTrabajoUtilizado: true,
        capitalTrabajoDisponible: true,
        fneBloqueadosCp: true,
        fneBloqueadosInscripcion: true,
        fneBloqueadosLogistica: true,
        fneBloqueadosComercial: true,
        alertasCriticas: true,
        alertasAltas: true,
        alertasMedias: true,
        sucursalesConBrechas: true,
        marcasConBrechas: true,
        completionPct: true,
      },
    });
    if (snap) {
      const ct = snap.capitalTrabajoTotal;
      const cu = snap.capitalTrabajoUtilizado;
      const cd = snap.capitalTrabajoDisponible;
      console.log(`  → snapshot:`);
      console.log(`    capital trabajo: total=${ct ?? "null"} util=${cu ?? "null"} disp=${cd ?? "null"}`);
      console.log(
        `    bloqueos FNE: cp=${snap.fneBloqueadosCp ?? "null"} insc=${snap.fneBloqueadosInscripcion ?? "null"}` +
          ` log=${snap.fneBloqueadosLogistica ?? "null"} com=${snap.fneBloqueadosComercial ?? "null"}`,
      );
      console.log(
        `    alertas: crit=${snap.alertasCriticas ?? "null"} alta=${snap.alertasAltas ?? "null"} med=${snap.alertasMedias ?? "null"}`,
      );
      console.log(
        `    brechas: sucursales=${snap.sucursalesConBrechas ?? "null"} marcas=${snap.marcasConBrechas ?? "null"}`,
      );
      console.log(`    completionPct=${snap.completionPct ?? "null"}%`);
    }
  }

  console.log(`\n─── resumen ────────────────────────────────────────────`);
  console.log(`  ok: ${okCount}, fail: ${failCount}`);
  void fmtNum; // silenciar warning si no se usa
  await prisma.$disconnect();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(2);
});
