#!/usr/bin/env tsx
/**
 * CLI · backfill de archivos históricos desde disco al motor histórico.
 *
 * Lee archivos .xlsx desde el filesystem, los parsea como si vinieran del
 * navegador, los persiste vía persistirHistorico (forward-fix activo →
 * payload queda guardado) y dispara consolidarPeriodo. Todo sin pasar por
 * la UI ni levantar dev server.
 *
 * Uso:
 *   npx tsx scripts/historico-backfill.ts <archivo.xlsx> [<archivo2.xlsx> ...]
 *
 * Detecta automáticamente la fuente por el nombre del archivo:
 *   "Informe Stock"           → BASE_STOCK
 *   "Reportes Saldos"         → SALDOS
 *   "Autos no Entregados"     → FNE
 *   "Provisiones"             → PROVISIONES
 *
 * NO toca producción salvo que DATABASE_URL apunte allá explícitamente.
 */

import { config as dotenvConfig } from "dotenv";
import path from "node:path";
import { promises as fs } from "node:fs";

dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

type FuenteDetectada = "BASE_STOCK" | "SALDOS" | "FNE" | "PROVISIONES" | null;

function detectarFuente(nombre: string): FuenteDetectada {
  const n = nombre.toLowerCase();
  if (n.includes("stock") && n.includes("linea")) return "BASE_STOCK";
  if (n.startsWith("reportes saldos") || n.startsWith("saldos")) return "SALDOS";
  if (n.includes("no entregad")) return "FNE";
  if (n.includes("provision")) return "PROVISIONES";
  return null;
}

/** Polyfill File-like para que los parsers (que esperan browser File) corran en Node. */
function fileLike(filePath: string, name: string, size: number): File {
  const f = {
    name,
    size,
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    lastModified: Date.now(),
    arrayBuffer: async (): Promise<ArrayBuffer> => {
      const buf = await fs.readFile(filePath);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    },
  };
  return f as unknown as File;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Uso: npx tsx scripts/historico-backfill.ts <archivo1.xlsx> [<archivo2.xlsx> ...]",
    );
    process.exit(1);
  }

  // Dynamic imports para que dotenv corra antes de prisma init.
  const { parseExcelFile } = await import("../src/lib/parser");
  const { parseSaldosFile } = await import("../src/lib/parser/saldos");
  const { parseFNEFile } = await import("../src/lib/parser/autos-no-entregados");
  const { parseProvisionesFile } = await import("../src/lib/parser/provisiones");
  const { persistirHistorico } = await import("../src/lib/historico/persistir");
  const { consolidarPeriodo } = await import("../src/lib/historico/consolidar-periodo");
  const { prisma } = await import("../src/lib/prisma");

  const admin = await prisma.user.findFirst({ where: { rol: "ADMIN" } });
  if (!admin) {
    console.error("[fatal] No hay user ADMIN en la DB local");
    process.exit(1);
  }
  console.log(`[backfill] userId=${admin.id} (${admin.email})`);
  console.log(
    `[backfill] DATABASE_URL=${(process.env.DATABASE_URL ?? "default").replace(/:[^:@]*@/, ":***@")}`,
  );

  let okCount = 0;
  let failCount = 0;
  const periodosTocados = new Set<string>();

  for (const filePath of args) {
    const abs = path.resolve(filePath);
    const base = path.basename(abs);
    console.log(`\n─── ${base} ─────────────────────────────────────────`);

    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      console.error(`[fail] no se pudo abrir: ${abs}`);
      failCount++;
      continue;
    }

    const fuente = detectarFuente(base);
    if (!fuente) {
      console.error(`[skip] fuente no reconocida por nombre: ${base}`);
      failCount++;
      continue;
    }
    console.log(`  fuente detectada: ${fuente} · tamaño=${stat.size}`);

    const f = fileLike(abs, base, stat.size);

    let parsed: unknown;
    let fechaCorte: Date | null = null;
    const t0 = Date.now();
    try {
      if (fuente === "BASE_STOCK") {
        const p = await parseExcelFile(f);
        parsed = p;
        fechaCorte = p.report.fechaCorteExcel ?? null;
        console.log(`  parsed · ${Date.now() - t0} ms · vehiculos=${p.vehiculos.length} · lineas=${p.lineas.length}`);
      } else if (fuente === "SALDOS") {
        const p = await parseSaldosFile(f);
        parsed = p;
        console.log(`  parsed · ${Date.now() - t0} ms · registros=${p.registros.length}`);
      } else if (fuente === "FNE") {
        const p = await parseFNEFile(f);
        parsed = p;
        console.log(`  parsed · ${Date.now() - t0} ms · registros=${p.registros.length}`);
      } else if (fuente === "PROVISIONES") {
        const p = await parseProvisionesFile(f);
        parsed = p;
        console.log(`  parsed · ${Date.now() - t0} ms · registros=${p.registros.length}`);
      }
    } catch (e) {
      console.error(`[fail] parser: ${e instanceof Error ? e.message : String(e)}`);
      failCount++;
      continue;
    }

    // Serializar payload — replica de serializeStockPayload (inline para
    // no depender de "use client").
    let payload: unknown = parsed;
    if (fuente === "BASE_STOCK") {
      const pe = parsed as { vinsExtra: unknown };
      payload = {
        ...(parsed as object),
        vinsExtra:
          pe.vinsExtra instanceof Map ? [...pe.vinsExtra.entries()] : pe.vinsExtra,
      };
    }

    try {
      const res = await persistirHistorico({
        fuente,
        payload,
        nombreArchivo: base,
        tamano: stat.size,
        fechaCorteArchivo: fechaCorte,
        userId: admin.id,
      });
      console.log(
        `  persistirHistorico · period=${res.snapshotPeriod} · creado=${res.archivoCreado} · actualizado=${res.snapshotActualizado}`,
      );
      for (const w of res.warnings) console.log(`    ⚠ ${w}`);

      if (res.snapshotPeriod) {
        periodosTocados.add(res.snapshotPeriod);
        const c = await consolidarPeriodo(res.snapshotPeriod);
        console.log(
          `  consolidarPeriodo · ok=${c.ok} · llenados=${c.kpisLlenados.length} · null=${c.kpisNull.length}` +
            (c.correctionCreada ? " · correction" : ""),
        );
        for (const w of c.warnings) console.log(`    ⚠ ${w}`);
        if (c.error) console.log(`    ❌ ${c.error}`);
      }
      okCount++;
    } catch (e) {
      console.error(`[fail] persistencia: ${e instanceof Error ? e.message : String(e)}`);
      failCount++;
    }
  }

  console.log(`\n─── resumen ────────────────────────────────────────────`);
  console.log(`  ok: ${okCount}, fail: ${failCount}`);
  console.log(`  períodos tocados: ${[...periodosTocados].sort().join(", ")}`);

  await prisma.$disconnect();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(2);
});
