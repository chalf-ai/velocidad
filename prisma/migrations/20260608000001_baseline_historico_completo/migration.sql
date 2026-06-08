-- ─────────────────────────────────────────────────────────────────────
-- Baseline histórico Fase 1a + 1b · CREATE TABLE completo.
--
-- Contexto / por qué esta migration:
--   La iteración anterior de esta migration (`20260608000001_historico_fase_1a_columnas`)
--   solo contenía `ALTER TABLE ... ADD COLUMN` porque se generó con
--   `prisma migrate diff` comparando el schema de `main` contra el schema actual.
--   Eso asume que las tablas base (`OperationalSnapshot`, `SnapshotHistoricoArchivo`)
--   ya existen en producción.
--
--   Diagnóstico tras P2021 "OperationalSnapshot does not exist" en Railway:
--     · El repo nunca tuvo `prisma/migrations/` hasta este PR.
--     · `railway.toml` define `startCommand = "npm start"` (sin `prisma db push`
--        ni `migrate deploy`), por lo que Railway NUNCA aplicó schema changes.
--     · Las tablas Fase 1a se introdujeron en el commit `2bfda50` pero el `db push`
--       contra Railway NO se corrió → las tablas nunca se crearon en producción.
--     · `OperationalSnapshot` se usaba solo en flujos de upload (`persistir.ts`),
--       por eso pasó inadvertido hasta que `/tendencias` (PR #22) la consulta
--       directamente en el render del server component.
--
-- Esta migration reemplaza la anterior con CREATE TABLE completo, incluyendo
-- las columnas Fase 1b (`scoreComponentes`, `esCierreMensual`, `fuenteFechaCorte`,
-- `prioridadCierre`) y el índice de prioridad por (fuente, snapshotPeriod).
--
-- Generada con:
--   prisma migrate diff \
--     --from-schema-datamodel <schema en commit 3e5020c, pre Fase 1a> \
--     --to-schema-datamodel prisma/schema.prisma \
--     --script
--
-- Garantías:
--   · 100% aditiva — solo CREATE TABLE / CREATE INDEX / ADD FOREIGN KEY.
--   · Cero DROP, TRUNCATE, ALTER COLUMN.
--   · El tipo ENUM `Fuente` ya existe en producción (lo usa `Snapshot`); se
--     referencia, no se recrea.
--   · El FK a `User.id` usa `ON DELETE RESTRICT ON UPDATE CASCADE` (default
--     seguro de Prisma).
-- ─────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "SnapshotHistoricoArchivo" (
    "id" TEXT NOT NULL,
    "fuente" "Fuente" NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "snapshotPeriod" TEXT NOT NULL,
    "nombreOriginal" TEXT NOT NULL,
    "hashSha256" TEXT NOT NULL,
    "tamano" INTEGER NOT NULL,
    "fechaCorteDeclarada" TIMESTAMP(3),
    "fechaCorteDetectada" TIMESTAMP(3),
    "fuenteFechaCorte" TEXT NOT NULL DEFAULT 'excel',
    "esCierreMensual" BOOLEAN NOT NULL DEFAULT false,
    "prioridadCierre" INTEGER NOT NULL DEFAULT 0,
    "parseStatus" TEXT NOT NULL DEFAULT 'ok',
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "origenDeteccion" TEXT NOT NULL DEFAULT 'ingesta',
    "payload" JSONB,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SnapshotHistoricoArchivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalSnapshot" (
    "id" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "snapshotPeriod" TEXT NOT NULL,
    "snapshotType" TEXT NOT NULL DEFAULT 'monthly',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastRecalculatedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "sourceFiles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fuentesUsadas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fuentesEsperadas" TEXT[] DEFAULT ARRAY['BASE_STOCK', 'SALDOS', 'FNE', 'PROVISIONES']::TEXT[],
    "completionPct" INTEGER NOT NULL DEFAULT 0,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stockUnidades" INTEGER,
    "stockMontoTotal" DECIMAL(18,2),
    "stockPagadoMonto" DECIMAL(18,2),
    "stockFinanciadoMonto" DECIMAL(18,2),
    "lineaAutorizada" DECIMAL(18,2),
    "lineaUtilizada" DECIMAL(18,2),
    "lineaDisponible" DECIMAL(18,2),
    "lineaUtilizacionPct" DECIMAL(5,2),
    "capitalTrabajoTotal" DECIMAL(18,2),
    "capitalTrabajoUtilizado" DECIMAL(18,2),
    "capitalTrabajoDisponible" DECIMAL(18,2),
    "fneUnidades" INTEGER,
    "fneMonto" DECIMAL(18,2),
    "fneDiasPromedio" DECIMAL(8,2),
    "fneListosEntrega" INTEGER,
    "fneBloqueadosCp" INTEGER,
    "fneBloqueadosInscripcion" INTEGER,
    "fneBloqueadosLogistica" INTEGER,
    "fneBloqueadosComercial" INTEGER,
    "creditoPompeyoMonto" DECIMAL(18,2),
    "creditoPompeyoCasos" INTEGER,
    "saldosMontoTotal" DECIMAL(18,2),
    "saldosVehiculoMonto" DECIMAL(18,2),
    "saldosBonosMonto" DECIMAL(18,2),
    "saldosServiciosMonto" DECIMAL(18,2),
    "provisionesTotalMonto" DECIMAL(18,2),
    "provisionesNoFacturadasMonto" DECIMAL(18,2),
    "provisionesNoFacturadasUnidades" INTEGER,
    "aging0_30Unidades" INTEGER,
    "aging31_60Unidades" INTEGER,
    "aging61_90Unidades" INTEGER,
    "aging91_120Unidades" INTEGER,
    "aging121_180Unidades" INTEGER,
    "aging180MasUnidades" INTEGER,
    "aging0_30Monto" DECIMAL(18,2),
    "aging31_60Monto" DECIMAL(18,2),
    "aging61_90Monto" DECIMAL(18,2),
    "aging91_120Monto" DECIMAL(18,2),
    "aging121_180Monto" DECIMAL(18,2),
    "aging180MasMonto" DECIMAL(18,2),
    "scoreGerencial" INTEGER,
    "scoreOperacional" INTEGER,
    "scoreCumplimiento" INTEGER,
    "scoreVelocidad" INTEGER,
    "scoreCapital" INTEGER,
    "cumplimientoGlobalPct" DECIMAL(5,2),
    "cumplimientoComercialPct" DECIMAL(5,2),
    "cumplimientoControlNegocioPct" DECIMAL(5,2),
    "cumplimientoLogisticaPct" DECIMAL(5,2),
    "cumplimientoSucursalPct" DECIMAL(5,2),
    "alertasCriticas" INTEGER,
    "alertasAltas" INTEGER,
    "alertasMedias" INTEGER,
    "responsablesConAtrasos" INTEGER,
    "sucursalesConBrechas" INTEGER,
    "marcasConBrechas" INTEGER,
    "scoreComponentes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SnapshotHistoricoArchivo_snapshotPeriod_idx" ON "SnapshotHistoricoArchivo"("snapshotPeriod");

-- CreateIndex
CREATE INDEX "SnapshotHistoricoArchivo_snapshotDate_idx" ON "SnapshotHistoricoArchivo"("snapshotDate");

-- CreateIndex
CREATE INDEX "SnapshotHistoricoArchivo_hashSha256_idx" ON "SnapshotHistoricoArchivo"("hashSha256");

-- CreateIndex
CREATE INDEX "SnapshotHistoricoArchivo_fuente_snapshotPeriod_prioridadCie_idx" ON "SnapshotHistoricoArchivo"("fuente", "snapshotPeriod", "prioridadCierre");

-- CreateIndex
CREATE UNIQUE INDEX "SnapshotHistoricoArchivo_fuente_snapshotDate_hashSha256_key" ON "SnapshotHistoricoArchivo"("fuente", "snapshotDate", "hashSha256");

-- CreateIndex
CREATE INDEX "OperationalSnapshot_snapshotDate_idx" ON "OperationalSnapshot"("snapshotDate");

-- CreateIndex
CREATE INDEX "OperationalSnapshot_snapshotPeriod_idx" ON "OperationalSnapshot"("snapshotPeriod");

-- CreateIndex
CREATE INDEX "OperationalSnapshot_status_idx" ON "OperationalSnapshot"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OperationalSnapshot_snapshotPeriod_snapshotType_key" ON "OperationalSnapshot"("snapshotPeriod", "snapshotType");

-- AddForeignKey
ALTER TABLE "SnapshotHistoricoArchivo" ADD CONSTRAINT "SnapshotHistoricoArchivo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
