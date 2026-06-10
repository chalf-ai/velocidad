-- AlertaLog.canal: canal elegido al asignar ("WHATSAPP" | "EMAIL").
-- 100% aditiva · nullable · registros previos quedan como "pendiente de canal".
ALTER TABLE "AlertaLog" ADD COLUMN "canal" TEXT;
