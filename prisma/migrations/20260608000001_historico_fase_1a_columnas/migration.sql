-- Migration: Fase 1a/1b · columnas del motor histórico de snapshots.
--
-- Generada con `prisma migrate diff` comparando el schema de main contra
-- el schema actual. Sólo aditiva (ADD COLUMN con DEFAULT + CREATE INDEX) —
-- segura para aplicar en producción sin downtime.
--
-- Columnas agregadas a SnapshotHistoricoArchivo:
--   · esCierreMensual    — true si el archivo califica como cierre (prio >= 70)
--   · fuenteFechaCorte   — origen de la fecha de corte: excel | filename | fallback | manual
--   · prioridadCierre    — 0-100, define qué archivo gana los KPIs por (fuente, período)
--
-- Columna agregada a OperationalSnapshot:
--   · scoreComponentes   — JSONB con desglose de drivers, indicadores y warnings 1b-A/B/C
--
-- Índice nuevo:
--   · SnapshotHistoricoArchivo (fuente, snapshotPeriod, prioridadCierre)
--     para resolver rápido el "archivo ganador" por período.

-- AlterTable
ALTER TABLE "SnapshotHistoricoArchivo" ADD COLUMN     "esCierreMensual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fuenteFechaCorte" TEXT NOT NULL DEFAULT 'excel',
ADD COLUMN     "prioridadCierre" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OperationalSnapshot" ADD COLUMN     "scoreComponentes" JSONB;

-- CreateIndex
CREATE INDEX "SnapshotHistoricoArchivo_fuente_snapshotPeriod_prioridadCie_idx" ON "SnapshotHistoricoArchivo"("fuente", "snapshotPeriod", "prioridadCierre");
