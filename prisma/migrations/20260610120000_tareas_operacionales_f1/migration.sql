-- CreateEnum
CREATE TYPE "EstadoTarea" AS ENUM ('PENDIENTE', 'EN_CURSO', 'COMPLETADA', 'CANCELADA');

-- AlterEnum
ALTER TYPE "AlertaTipo" ADD VALUE 'TAREA_ASIGNADA';

-- AlterTable
ALTER TABLE "AlertaLog" ADD COLUMN     "tareaId" TEXT;

-- CreateTable
CREATE TABLE "TareaOperacional" (
    "id" TEXT NOT NULL,
    "claveCaso" TEXT NOT NULL,
    "tipoCaso" TEXT NOT NULL DEFAULT 'vin',
    "mensaje" TEXT NOT NULL,
    "motivo" TEXT,
    "vin" TEXT,
    "patente" TEXT,
    "marca" TEXT,
    "modelo" TEXT,
    "asignadoId" TEXT NOT NULL,
    "creadorId" TEXT NOT NULL,
    "estado" "EstadoTarea" NOT NULL DEFAULT 'PENDIENTE',
    "fechaCompromiso" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TareaOperacional_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TareaOperacional_asignadoId_estado_idx" ON "TareaOperacional"("asignadoId", "estado");

-- CreateIndex
CREATE INDEX "TareaOperacional_claveCaso_idx" ON "TareaOperacional"("claveCaso");

-- CreateIndex
CREATE INDEX "AlertaLog_tipo_enviado_idx" ON "AlertaLog"("tipo", "enviado");

-- AddForeignKey
ALTER TABLE "AlertaLog" ADD CONSTRAINT "AlertaLog_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "TareaOperacional"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TareaOperacional" ADD CONSTRAINT "TareaOperacional_asignadoId_fkey" FOREIGN KEY ("asignadoId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TareaOperacional" ADD CONSTRAINT "TareaOperacional_creadorId_fkey" FOREIGN KEY ("creadorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

