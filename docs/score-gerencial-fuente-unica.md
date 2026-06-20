# Score Gerencial · fuente única (snapshot canónico)

**Decisión de producto (usuario 2026-06-20):** un solo Score Gerencial oficial.
`/score-gerencial` muestra el **último `DailyCapitalSnapshot.scoreGerencial`**;
`/tendencias` muestra la **serie del mismo campo**. Regla: el número de
`/score-gerencial` == el último punto de `/tendencias`, siempre.

## Causa raíz que se corrige
Misma fórmula (`calcularScoreGerencial`, 40/40/10/10) llamada **dos veces sobre
dos datasets**: `/score-gerencial` recalculaba EN VIVO desde el store del browser
(33); `/tendencias` leía el snapshot persistido (24). No había fuente única.

## Qué hace este cambio
1. **`DailyCapitalSnapshot.scoreComponentes Json?`** (nuevo): persiste la
   descomposición canónica `{ estado, indicadores[] }` junto al score, calculada
   al generar el snapshot. Así el score Y sus componentes son una sola foto.
2. **`daily-capital.ts`**: el score del snapshot usa, en TOTAL, el **override
   ROMA-vivo de Provisiones** (I2) con fallback al Excel. (No cambia el número:
   I2 satura en ≥10 casos; sí deja el card I2 consistente con la fuente oficial.)
3. **`GET /api/snapshots/daily/score?marca=`**: devuelve la última fila del scope
   (mismo `where`/`orderBy` que `/tendencias`).
4. **`/score-gerencial`**: el número principal y las 4 cards vienen del snapshot
   (vía el API). El **drill VIN sigue operacional** (store). Si aún no hay
   snapshot para el scope, cae al cálculo vivo con aviso.
5. **Fórmula intacta**: `calcularScoreGerencial` no cambia (solo se agregó un
   override OPCIONAL de input para I2). No hay segundo score ni rename.

## Evidencia de cuadre (read-only, prod, 2026-06-20)
`scripts/validate-score-fuente-unica.ts`:
```
TOTAL          · /score-gerencial(API)=24 · /tendencias(último)=24 · COINCIDE ✓
MARCA KIA MOTORS · /score-gerencial(API)=20 · /tendencias(último)=20 · COINCIDE ✓
```

## Impacto sobre el valor actual del score
- `/score-gerencial` TOTAL: **33 (vivo) → 24 (snapshot canónico)**. KIA: 20.
- El número baja porque deja de recalcular sobre datos del browser y pasa a la
  foto oficial — que es la verdad acordada. **Comunicar el ajuste** al gerente.

## Impacto histórico — PROPUESTA (no ejecutar backfill sin OK)
- **Para el NÚMERO (regla dura): NO requiere backfill.** Ambas pantallas ya leen
  el mismo campo `scoreGerencial`; el cuadre funciona hoy (validado).
- **`scoreComponentes` (cards canónicas):** las filas existentes lo tienen `null`
  hasta regenerarse. Tras el deploy, **cada snapshot nuevo lo puebla solo**; las
  pantallas caen al detalle vivo mientras tanto (con aviso). Opcional: un
  one-off que recomputa `scoreComponentes` de las ~3 filas diarias recientes
  desde sus payloads vigentes — bajo impacto, NO masivo.
- **Serie mensual (Mar/Abr/May/Jun):** hoy `/tendencias` muestra la serie DIARIA
  (DailyCapitalSnapshot, ~3 puntos). La vista mensual con cierres por período se
  reconstruye desde `SnapshotHistoricoArchivo` vía `calcularScoreGerencialHistorico`
  (misma fórmula) — entrega aparte, no en este PR.
- **Recomendación:** desplegar; regenerar el snapshot de hoy (1 fila) para poblar
  `scoreComponentes`; dejar que la serie crezca a diario. Sin backfill masivo.

## Riesgos
1. El número visible **cambia** (33→24 en TOTAL). Es el objetivo, pero hay que avisarlo.
2. Mientras una fila no tenga `scoreComponentes`, `/score-gerencial` muestra el
   detalle vivo con aviso (degradación elegante, no error).
3. La migración agrega una columna nullable (additive) — se aplica en deploy
   (`prisma migrate deploy`); no toca filas existentes.
4. El Hero del dashboard/centro-acción también consume scoreGerencial — fuera de
   este PR; se alinea en una iteración siguiente si se quiere todo desde el snapshot.
