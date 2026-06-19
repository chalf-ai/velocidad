# Pregunta formal · Equipo ROMA — Reporte "Provisiones de Ingreso"

**Para:** Equipo ROMA
**De:** Velocidad Operacional (Pompeyo Carrasco)
**Fecha:** 2026-06-19
**Asunto:** SQL exacto del reporte "Provisiones de Ingreso" para reproducir
"Provisiones >90 días" en vivo desde ROMA.

## Contexto
Estamos moviendo la captura del snapshot diario a **Amazon-first**: el Job Amazon
consulta ROMA en vivo y alimenta Velocidad. **FNE** ya quedó reproducido EXACTO
desde ROMA (`VT_Ventas`, Reporte Actas). Falta **Provisiones >90 días**.

La métrica oficial de Velocidad (exportada hoy del reporte ROMA "Provisiones de
Ingreso → Estado al día de hoy → Área = Venta") es:

> **104 casos · $370,5M · aging máximo 553 días**

No logramos reproducir ese universo con consultas directas a `VT_Provisiones`.
**No queremos inventar una fórmula** — necesitamos el SQL real del reporte.

## Lo que necesitamos que aclaren (SQL exacto)
1. **Tabla base** (¿`VT_Provisiones`? ¿una vista? ¿otra tabla/staging?).
2. **Joins** exactos (esperamos `VT_ProvisionesConcepto` por `provision = Concepto.ID`; confirmar).
3. **Campo de fecha para AGING** (¿`fecha`? ¿`FechaPeriodo`? ¿`timestamp`? ¿`ultima_fecha_factura`?) y **fecha de referencia** ("hoy" vs corte vs max(fecha)).
4. **Campo de fecha para PERÍODO** y la **ventana** exacta (¿`FechaPeriodo`? ¿`periodo` varchar "MM-YYYY"? ¿24 meses móviles? ¿desde cuándo?).
5. **Definición de SALDO** (¿`monto − monto_factura − monto_rebaja`? ¿incluye `monto_nota_credito`, `monto_diferencia`, `MontoAjuste`?).
6. **Tratamiento de REBAJAS** (`monto_rebaja`) y de **saldos negativos** (¿se incluyen? ¿se clampa a 0?).
7. **Estados incluidos/excluidos** (confirmar `estado IN (1,2,3)`, `estado=4` excluido; ¿`estado_conta`? ¿`EstadoAjusteID`?).
8. **Filtro de concepto Venta** (confirmar `AreaNegocioID = 1`).
9. **Regla exacta de ">90 días"** (¿`DATEDIFF(referencia, fecha_aging) > 90`? ¿`>=`?).

## Evidencia — por qué las consultas directas NO reproducen el universo
Corrimos contra ROMA en vivo (2026-06-19, conexión directa) sobre
`VT_Provisiones ⋈ VT_ProvisionesConcepto` con `AreaNegocioID=1 ∧ estado IN(1,2,3)`:

| Intento | Filtros | Casos | Monto | aging máx |
|---|---|---|---|---|
| 1 | saldo≠0 ∧ aging(`fecha`)>90, sin ventana | 4.831 | $1.023,7M | 2.025 d |
| 2 | + `FechaPeriodo` ∈ [2024-06, 2026-06] | 1.940 | **−$9.537M** | 799 d |
| 3 | + `GREATEST(0,saldo)` ∧ saldo>0 | 386 | $574,9M | 718 d |
| **Oficial Velocidad** | reporte "Provisiones de Ingreso" | **104** | **$370,5M** | **553 d** |

Diferencias clave a explicar:
- **Aging máx 553d (oficial) vs 718–2.025d (directo):** la referencia/campo de
  fecha de aging es distinta a `fecha`.
- **Saldo:** sin clamp da negativo (−$9,5B); con clamp da $574,9M; el oficial es
  $370,5M. El tratamiento de rebajas/negativos difiere.
- **Conteo 104 vs 386–4.831:** la ventana de período y/o el universo base del
  reporte es más acotado que `VT_Provisiones` directo.

**Pregunta central:** ¿por qué el reporte oficial entrega 104 / $370,5M / 553d
mientras la consulta directa a `VT_Provisiones` no lo reproduce? ¿Qué filtra el
reporte que nosotros no estamos viendo?

## Reverse-engineering (2026-06-19, ROMA vivo + los 104 IDs oficiales)
Tomamos los **104 IDs exactos** de Velocidad (corte 16-jun, $370.474.338, aging
97–553) y los cruzamos contra ROMA. Resultado — **la mayor parte de la definición
quedó confirmada VIN/ID a ID**:

| Ítem | Definición confirmada |
|---|---|
| Tabla base | `VT_Provisiones` (Velocidad `id` = `VT_Provisiones.ID`) |
| Join | `VT_ProvisionesConcepto ON p.provision = c.ID` (para el área) |
| Concepto Venta | `c.AreaNegocioID = 1` |
| **Estados** | **`p.estado IN (2,3)`** — NO incluye `1` (los 104 = 76 en estado 2 + 28 en estado 3). La auditoría previa usaba `IN(1,2,3)` → sobre-contaba. |
| Campo aging | **`p.fecha`** (= `fechaCreacion` de Velocidad, confirmado por fila) |
| Regla >90 | `DATEDIFF(corte, p.fecha) > 90`; corte ≈ fecha del snapshot (da 554 vs 553 oficial, off-by-1 por timestamp) |
| Saldo vigente | `≠ 0` (incluye negativos — 13 de los 104 son negativos; NO es `>0`) |
| Período | `FechaPeriodo` dentro de ventana (~`>= 2024-06-01`; los 104 caen en FechaPeriodo 2024-11 → 2026-02) |

**Lo único que NO cierra: la fórmula EXACTA de saldo (y por ende el count).**
- `monto − monto_factura` (sobre los 104) = **$534,2M**.
- `monto − monto_factura − monto_rebaja` = **$303,7M**.
- Oficial Velocidad = **$370,5M** — queda EN MEDIO.
- `monto_nota_credito` = 0, `monto_diferencia` = 0, `MontoAjuste` = −$26,8M (no cuadran el gap).
- El gap a explicar (534,2 − 370,5 = **$163,7M**) es **~71% del `monto_rebaja`** (230,5M), y el split por estado muestra que el rebaja vive casi todo en estado 2 pero se aplica **parcial por fila** → el reporte aplica el rebaja de forma **CONDICIONAL a nivel de fila** (no por estado, no como columna limpia).
- Una query directa con la ventana de período da SUM(monto−monto_factura)=**$371,2M** (¡dentro de ±$500k del monto!) pero **count 1075** (el resto neto ~0) → sin la fórmula de saldo correcta no se aísla el universo de 104.

**Pregunta NETA que queda para el equipo ROMA (mucho más acotada):**
> En el reporte "Provisiones de Ingreso", ¿cuál es la **fórmula exacta del campo
> "saldo"**? Específicamente: ¿bajo qué condición por fila se resta `monto_rebaja`
> (parcial/total/según qué flag o estado de la rebaja)? Con eso, la query ROMA
> reproduce los 104 / $370,5M / 553d.

## Qué desbloquea esto
Con el SQL confirmado, activamos `PROVISIONES_ENABLED=1` en el Job Amazon
(`jobs/amazon-snapshot-roma/`) y Provisiones >90d pasa también a **ROMA vivo**.
Mientras tanto, Provisiones queda con la **fuente validada actual** (el Excel
"Provisiones de Ingreso", que ES este mismo reporte exportado a mano) — trazable,
aunque no en vivo.

## Referencias
- FNE reproducido exacto: `VT_Ventas` · `EstadoActaEntregaID IN (0,1)` ∧ `FechaFactura >= '2026-01-01'` → 514 reg / 513 VIN / $8.393,6M.
- Esquema `VT_Provisiones` (42 columnas) revisado: `monto`, `monto_factura`,
  `monto_rebaja`, `monto_nota_credito`, `monto_diferencia`, `MontoAjuste` (int);
  `fecha`, `timestamp`, `FechaPeriodo`, `ultima_fecha_factura` (fechas);
  `estado`, `estado_conta`, `EstadoAjusteID` (estados); `provision` → Concepto.
