/**
 * Validación · Score Gerencial fuente única.
 *
 * Demuestra que el número que mostrará /score-gerencial (query del API:
 * findFirst orderBy fecha DESC) == el último punto de /tendencias (findMany
 * orderBy fecha ASC, último) para el mismo scope. Mismo registro → mismo score.
 *
 * Read-only. Usa SQL crudo (no depende de la columna nueva scoreComponentes,
 * que aún no existe en prod hasta aplicar la migración).
 *
 *   railway run --service Postgres sh -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" npx tsx scripts/validate-score-fuente-unica.ts'
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function scopeCheck(label: string, whereSql: string) {
  // API: último por fecha DESC.
  const api = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "fecha","scoreGerencial" FROM "DailyCapitalSnapshot"
      WHERE ${whereSql} ORDER BY "fecha" DESC LIMIT 1`,
  );
  // Tendencias: serie ASC, último elemento.
  const serie = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "fecha","scoreGerencial" FROM "DailyCapitalSnapshot"
      WHERE ${whereSql} ORDER BY "fecha" ASC`,
  );
  const a = api[0];
  const ult = serie[serie.length - 1];
  const sa = a?.scoreGerencial ?? null;
  const st = ult?.scoreGerencial ?? null;
  const ok = sa === st;
  console.log(
    `  ${label.padEnd(14)} · /score-gerencial(API)=${String(sa).padStart(4)} · /tendencias(último)=${String(st).padStart(4)} · ${ok ? "COINCIDE ✓" : "DIFIERE ✗"} (serie ${serie.length} pts)`,
  );
  return ok;
}

async function main() {
  console.log("Validación fuente única · score /score-gerencial == último /tendencias:");
  const okTotal = await scopeCheck("TOTAL", `"scopeTipo"='TOTAL'`);
  // KIA: descubrir la marca canónica almacenada (MARCA rows ILIKE kia).
  const kia = await prisma.$queryRawUnsafe<any[]>(
    `SELECT DISTINCT "marca" FROM "DailyCapitalSnapshot"
      WHERE "scopeTipo"='MARCA' AND "marca" ILIKE '%kia%' LIMIT 1`,
  );
  let okKia = true;
  if (kia[0]?.marca) {
    const m = String(kia[0].marca).replace(/'/g, "''");
    okKia = await scopeCheck(`MARCA ${kia[0].marca}`, `"scopeTipo"='MARCA' AND "marca"='${m}'`);
  } else {
    console.log("  MARCA KIA       · sin filas MARCA para KIA (snapshot por marca aún no generado)");
  }
  console.log(okTotal && okKia ? "\nRESULTADO: fuente única OK ✓" : "\nRESULTADO: revisar ✗");
}
main().finally(() => prisma.$disconnect());
