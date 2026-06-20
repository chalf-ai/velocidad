> ✅ **RESUELTO (2026-06-19).** Ya no hace falta preguntar a ROMA por el SQL: la
> fuente oficial es la pantalla **Gestión de Provisiones de Ingreso** (`VT_Provisiones`,
> módulo `MenuSecundarioID=73`), columna **Saldo Pendiente por Facturar** = `monto −
> COALESCE(monto_factura,0)`, antigüedad por `fecha` (= seguimiento "Se ha generado una
> nueva provisión"). Ver el diagnóstico definitivo y validado en
> **[roma-provisiones-de-ingreso-fuente-oficial.md](./roma-provisiones-de-ingreso-fuente-oficial.md)**.
> Lo único que queda es confirmar el grand-total contra el export de la pantalla
> (tratamiento del bucket legacy 2018-2019). Este documento se conserva como historial
> del reverse-engineering.

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

**FÓRMULA DE SALDO — CRACKEADA (fit fila a fila contra los 104):**
> **saldo = `monto − monto_factura`** — el **`monto_rebaja` NO se resta NUNCA.**

Evidencia: de los 104, **102 tienen `saldo = monto − monto_factura` EXACTO**; solo
**2 difieren (ids 9772, 9442), ambos `ProvisionAjustada=2`**, y su diferencia suma
**$163.700.638 = exactamente el gap** — son **DRIFT** (provisiones ajustadas entre
el snapshot 16-jun y ROMA vivo 19-jun; en vivo su saldo actual es la verdad). La
hipótesis previa del "rebaja parcial" era un artefacto de ese drift: `SUM(monto −
monto_factura)` sobre los 104 = $370,5M una vez excluido el drift.

**Lo único que QUEDA: el SCOPE del universo del reporte (qué filas, no la fórmula).**
Con la definición ya correcta (`AreaNegocioID=1 ∧ estado IN(2,3) ∧ (monto−monto_factura)≠0
∧ DATEDIFF(corte,fecha)>90 ∧ FechaPeriodo en ventana`), ROMA devuelve **~835–1.067
filas**, no 104. Las ~731–963 de más son provisiones Venta de **saldo chico** que
el reporte EXCLUYE y que **no** se distinguen por `tipo`/`motivo` (50 combinaciones
dispersas), `estado_conta` (todas =2), ni por afinar la ventana. → El reporte
"Provisiones de Ingreso" tiene un **scope adicional NO presente en las columnas de
`VT_Provisiones`** (probable JOIN a otra tabla — venta/ingreso — o un flag de
configuración del reporte).

### (b2) Caza del discriminador del universo (timebox) — descartados con evidencia
Objetivo: hallar el join/filtro que reduce las ~835–1.075 provisiones Venta (saldo≠0,
aging>90, estado IN(2,3), período) a las **104** oficiales. **Probado y DESCARTADO:**

| Hipótesis | Resultado |
|---|---|
| Concepto (qué conceptos son "ingreso") | ❌ los 104 están repartidos en TODOS los conceptos (Bono Marca 34/265, Incentivo 22/255, Bono Financiera 14/182, …). `Activo=1` en todos. |
| `tipo` / `motivo` | ❌ 50 combinaciones dispersas |
| `estado_conta = 2` | ❌ se cumple en ~todo (1067) |
| `sol_factura`, `notificar_conta`, `monto_sol_factura`, `gerencia` | ❌ idénticos en en104 vs extra |
| Ventana `FechaPeriodo` (afinar) | ❌ no aísla (835–1.075) |
| Vigencia por rebaja: `monto−monto_factura−monto_rebaja ≠ 0` | ❌ da **1.939** (dirección contraria) |
| Vigencia por DETALLE de facturas (`VT_RebajaProvisionDetalleFactura`, `monto − SUM(detalle) ≠ 0`) | ❌ da **1.307** (dirección contraria) |

**Patrón observado (la pista que queda):** la proporción `en104 / total` por
período **sube monótonamente hacia lo reciente** y es **0 en los períodos viejos**:
2024-06→10 = 0; 2025-10 = 6/46; 2025-11 = 15/53; 2026-01 = 18/55; **2026-02 = 30/56**.
Dentro de cada período reciente ~la mitad son extra. Dos filas casi idénticas
(9640 en104 vs 9839 extra, ambas casi 100% facturadas, mismo concepto/gerencia)
difieren solo en `estado` (2 vs 3) y `FechaAjuste` reciente — ambas
`ProvisionAjustada=2` (drift-prone). → El universo parece definido por un criterio
de **"provisión aún pendiente/abierta"** que correlaciona con recencia pero **NO**
está en `estado`, `estado_conta`, el header de factura, ni el detalle de facturas.
Tablas adicionales presentes: `VT_RebajaProvisionDetalleFactura` (ProvisionID, Monto,
FechaFactura, EstadoID) — probada, no es el filtro por sí sola.

**Pregunta NETA final para el equipo ROMA (ya mínima):**
> Confirmada la métrica (saldo = monto − monto_factura, estado IN(2,3), aging desde
> `fecha` >90, área Venta = AreaNegocioID 1): el reporte "Provisiones de Ingreso"
> devuelve **104** filas, pero `VT_Provisiones` con esos filtros devuelve **~1.075**.
> Las ~971 de más son provisiones Venta de saldo chico, repartidas en los mismos
> conceptos/gerencias, que el reporte EXCLUYE; la selección sube hacia los períodos
> recientes y es 0 en los viejos. **¿Qué join/filtro adicional aplica el reporte
> para limitar el universo?** Específicamente: ¿hay una tabla de estado/repositorio
> (¿`RepositorioID` del detalle?), un flag de "provisión vigente/cerrada", o un
> filtro de generación que excluye las provisiones Venta con saldo residual? No
> reproducible desde `VT_Provisiones` + `VT_RebajaProvisionDetalleFactura` solas.

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
