-- CreateEnum
CREATE TYPE "ScopeSnapshotDiario" AS ENUM ('TOTAL', 'MARCA');

-- CreateTable
CREATE TABLE "DailyCapitalSnapshot" (
    "id" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "scopeTipo" "ScopeSnapshotDiario" NOT NULL,
    "marca" TEXT NOT NULL DEFAULT '',
    "scoreGerencial" INTEGER,
    "scoreCapital" INTEGER,
    "scoreCumplimientoOperacional" INTEGER,
    "scoreVelocidad" INTEGER,
    "stockPagadoUnidades" INTEGER,
    "stockPagadoMonto" DOUBLE PRECISION,
    "saldosUnidades" INTEGER,
    "saldosMonto" DOUBLE PRECISION,
    "bonosUnidades" INTEGER,
    "bonosMonto" DOUBLE PRECISION,
    "provisionesUnidades" INTEGER,
    "provisionesMonto" DOUBLE PRECISION,
    "capitalTrabajoTotal" DOUBLE PRECISION,
    "cobertura" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyCapitalSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyCapitalSnapshot_scopeTipo_marca_fecha_idx" ON "DailyCapitalSnapshot"("scopeTipo", "marca", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCapitalSnapshot_fecha_scopeTipo_marca_key" ON "DailyCapitalSnapshot"("fecha", "scopeTipo", "marca");

