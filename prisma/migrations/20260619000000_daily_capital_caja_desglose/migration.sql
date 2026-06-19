-- PR 2 · Snapshot diario automático: persistencia histórica EXPLÍCITA de las
-- métricas oficiales nuevas (Caja Comercial Gestionable, Caja Inmovilizada Total,
-- desglose Test Cars / Autos Compañía / Judicial, FNE operativo, aging máximo de
-- Provisiones). No se reconstruyen después — se guardan a diario.
--
-- Aditivo y seguro: solo columnas nullable. No toca columnas existentes ni filas
-- previas (la serie histórica `stockPagado*` y demás se conservan intactas).
ALTER TABLE "DailyCapitalSnapshot"
  ADD COLUMN "cajaComercialUnidades" INTEGER,
  ADD COLUMN "cajaComercialMonto" DOUBLE PRECISION,
  ADD COLUMN "cajaTotalUnidades" INTEGER,
  ADD COLUMN "cajaTotalMonto" DOUBLE PRECISION,
  ADD COLUMN "testCarUnidades" INTEGER,
  ADD COLUMN "testCarMonto" DOUBLE PRECISION,
  ADD COLUMN "autosCompaniaUnidades" INTEGER,
  ADD COLUMN "autosCompaniaMonto" DOUBLE PRECISION,
  ADD COLUMN "judicialUnidades" INTEGER,
  ADD COLUMN "judicialMonto" DOUBLE PRECISION,
  ADD COLUMN "fneUnidades" INTEGER,
  ADD COLUMN "fneMonto" DOUBLE PRECISION,
  ADD COLUMN "provisionesAgingMax" INTEGER;
