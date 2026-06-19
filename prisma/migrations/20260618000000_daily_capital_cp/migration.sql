-- Fase 4 unificación Capital de Trabajo: Tendencias adopta las 4 métricas
-- oficiales (fuente única capital-trabajo.ts). Se agrega Crédito Pompeyo >15d.
-- Aditivo y seguro: solo agrega columnas nullable.
--
-- Las columnas `saldos*` y `provisiones*` cambian de SIGNIFICADO (ahora T3+ y
-- >90d respectivamente); `bonos*` queda deprecado (deja de poblarse). Las
-- filas previas (definición antigua, no recalculables: la tabla guarda números
-- derivados, no payloads por día) deben regenerarse con el job diario.
ALTER TABLE "DailyCapitalSnapshot"
  ADD COLUMN "cpUnidades" INTEGER,
  ADD COLUMN "cpMonto" DOUBLE PRECISION;
