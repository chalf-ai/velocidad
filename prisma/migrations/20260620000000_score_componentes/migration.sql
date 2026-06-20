-- Score Gerencial · fuente única persistida.
-- Descomposición canónica del Score (estado + 4 indicadores) por fila de
-- DailyCapitalSnapshot. Nullable y additive: no toca filas existentes.
ALTER TABLE "DailyCapitalSnapshot" ADD COLUMN "scoreComponentes" JSONB;
