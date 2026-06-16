-- F2 · Estados reales de entrega de Meta WhatsApp Cloud API en AlertaLog.
-- Migración ADDITIVE (todas las columnas nullable) — segura, sin backfill.
-- `enviado` se mantiene por compatibilidad; la verdad de entrega vive en waStatus.

-- AlterTable
ALTER TABLE "AlertaLog" ADD COLUMN     "waStatus" TEXT,
ADD COLUMN     "waStatusAt" TIMESTAMP(3),
ADD COLUMN     "waErrorCode" INTEGER,
ADD COLUMN     "waErrorTitle" TEXT,
ADD COLUMN     "waRaw" JSONB;

-- CreateIndex (el webhook de status actualiza por waMsgId)
CREATE INDEX "AlertaLog_waMsgId_idx" ON "AlertaLog"("waMsgId");
