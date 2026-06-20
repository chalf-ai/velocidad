# Diagnóstico técnico definitivo — "Gestión de Provisiones de Ingreso" (ROMA)

**Fecha:** 2026-06-19 · **Autor:** Velocidad Operacional · **Estado:** RESUELTO (validado contra pantalla)

> Reemplaza el enfoque previo de "adivinar el filtro del universo 104". La fuente
> oficial es la pantalla **Gestión de Provisiones de Ingreso** y su columna
> **Saldo Pendiente por Facturar**. Todo lo de abajo está demostrado con queries
> de solo lectura contra la DB `roma` (vía MCP `roma-db`) y **validado exacto**
> contra los 3 ejemplos reales que entregó el usuario (IDs 10295/10300/10309).

---

## 0. Resumen ejecutivo

| Pieza | Resultado |
|---|---|
| **Módulo / pantalla** | Provisiones = `MenuSecundarioID = 73` (confirmado vía `SIS_Seguimientos`) |
| **Tabla base** | `roma.VT_Provisiones` (10.241 filas, 1 fila = 1 provisión) |
| **Saldo Pendiente por Facturar** | `monto − COALESCE(monto_factura, 0)` — **rebaja NO se resta**. Validado a peso contra 10295=$0 / 10300=$2.500.000 / 10309=$30 |
| **Fecha de antigüedad (>90 d)** | `VT_Provisiones.fecha` = la fecha del seguimiento *"Se ha generado una nueva provisión"* (validado: coincide en 7.626/7.633 = 99,9%; única fuente para 2.608 sin evento) |
| **Estado a excluir** | `estado = 4` = **ANULADA** (comprobado: comentarios "Se ha Anulado Registro") |
| **🚩 Hallazgo crítico** | **$34,8B son provisiones legacy 2018-2019 sin marca** (`origen` 0/NULL). **Excluir con `origen > 0`** |
| **Regla de producto** | Capital de Trabajo usa **"Provisiones vigentes generadas desde jun-2024"** (`fecha >= '2024-06-01'`). Corte de calidad histórica, **adicional** al aging >90. |
| **KPIs oficiales (2026-06-19)** | Vigentes **837 · $5.510,8M** · >90 días **624 · $890,7M** |

No hay acceso al código PHP de ROMA (`~/Desktop/Roma` contiene solo documentos/PPTs,
0 archivos `.php`). Toda la fuente se demostró **desde la base de datos**, que es
suficiente para reproducir el listado y los KPIs.

---

## 1. Fuente de datos oficial del listado

- **Tabla:** `roma.VT_Provisiones` — una fila por provisión (`ID` = ID de provisión de la pantalla).
- **Módulo:** las provisiones son `MenuSecundarioID = 73` en el log de eventos `roma.SIS_Seguimientos`.
- **NO** hay vista/SP intermedio necesario: el listado se arma con `VT_Provisiones` + lookups.

## 2. Fuente de datos oficial de los seguimientos (fecha de generación)

- **Tabla:** `roma.SIS_Seguimientos` (7,58M filas) — log genérico de todo el sistema.
- **Cómo liga a una provisión:** `MenuSecundarioID = 73` **AND** `ReferenciaID = VT_Provisiones.ID`.
- **El evento de generación:** `Comentario = 'Se ha generado una nueva provisión'`
  (`TipoID = 76` = "Comentario", genérico; el texto va en `Comentario`).
- **Fecha de generación** = `MIN(SIS_Seguimientos.FechaCreacion)` de ese evento para la provisión.

**Validación (10.241 provisiones):** `VT_Provisiones.fecha` == fecha del evento de
generación en **7.626** casos (mismo día), difiere por día en **7** (0,09%, provisiones
editadas), y **2.608** provisiones viejas NO tienen el evento (para ésas `fecha` es la
única fuente). → **`fecha_generacion = COALESCE(evento_generación, VT_Provisiones.fecha)`**,
y en la práctica **`VT_Provisiones.fecha` es el proxy validado** (idéntico en 99,9%,
y la única fuente para el 25% sin evento).

## 3. Mapeo de campos — de dónde sale cada columna de la pantalla

| Columna pantalla | Origen exacto |
|---|---|
| ID provisión | `VT_Provisiones.ID` |
| Concepto provisión / glosa | `VT_Provisiones.provision` → `VT_ProvisionesConcepto.ID` → `.Concepto` |
| Mes provisión | `VT_Provisiones.periodo` ("MM-YYYY") · `FechaPeriodo` (date) |
| **Marca** | `VT_Provisiones.origen` → `VT_ProvisionesOrigen.ID` → `.Origen` (Peugeot, Suzuki, Nissan, Kia…) |
| Por facturar a | `VT_Provisiones.tipo` → `VT_ProvisionesTipo.ID` → `.Tipo` (HDI, Inchcape Automotriz, Peugeot…) |
| Motivo | `VT_Provisiones.motivo` → `VT_ProvisionesMotivo.id` → `.motivo` |
| Área negocio | `VT_ProvisionesConcepto.AreaNegocioID` (1 = Venta, 2 = Post Venta) |
| Estado | `VT_Provisiones.estado` (1,2,3 vigentes · 4 anulada · 6 borde) |
| **Provisión neto** | `VT_Provisiones.monto` |
| **Facturado neto** | `COALESCE(VT_Provisiones.monto_factura, 0)` (detalle en `VT_ProvisionesFacturas`) |
| **Saldo Pendiente por Facturar** | `monto − COALESCE(monto_factura, 0)` |
| Última fecha factura | `VT_Provisiones.ultima_fecha_factura` |
| Usuario que ingresó | `VT_Provisiones.usuario` |
| Seguimiento "Se ha generado…" | `SIS_Seguimientos` (Menu 73 · `ReferenciaID = ID` · `Comentario = 'Se ha generado una nueva provisión'`) |

## 4. Fórmulas exactas — DEFINICIÓN OFICIAL (Capital de Trabajo)

```
saldo_pendiente_por_facturar = monto − COALESCE(monto_factura, 0)
fecha_generacion             = VT_Provisiones.fecha   (proxy validado vs SIS_Seguimientos)

UNIVERSO OFICIAL (Velocity / Capital de Trabajo):
  estado <> 4                          -- no anuladas
  AND origen > 0                       -- no legacy 2018-2019 sin marca
  AND saldo_pendiente_por_facturar > 0 -- vigente
  AND fecha_generacion >= '2024-06-01' -- CORTE DE CALIDAD HISTÓRICA

KPI 1 · Total provisiones vigentes
  = SUM(saldo)  [universo oficial]

KPI 2 · Provisiones > 90 días
  = SUM(saldo)  [universo oficial]  AND fecha_generacion <= CURDATE() - INTERVAL 90 DAY
```

**Son DOS filtros distintos, no se reemplazan:**
1. **Corte de calidad histórica** — `fecha_generacion >= '2024-06-01'`. Antes de jun-2024
   ROMA no estaba cuadrado; esos saldos no son comparables ni gestionables. Fijo.
2. **Aging operativo** — `fecha_generacion <= hoy − 90 días`. Móvil.

→ Una provisión de **jul-2024 SÍ puede ser >90**. Una de **2019 NO entra**, aunque tenga saldo.

Notas:
- `estado <> 4` excluye **ANULADAS**. `origen > 0` excluye el bucket legacy 2018-2019 (§6).
- Boundary `<= hoy-90` = aging ≥ 90 d (ajustable a `> 90` si la pantalla usa estricto).

## 5. Estados (semántica comprobada por seguimientos)

| estado | significado | trato |
|---|---|---|
| 1 | Generada / pendiente de factura | vigente |
| 2 | En proceso (notificada/confirmada contabilidad, factura parcial) | vigente |
| 3 | Facturada / confirmada | vigente si saldo>0 |
| **4** | **ANULADA** ("Se ha Anulado Registro") | **EXCLUIR** |
| 6 | Borde (1 fila) | vigente si saldo>0 |

## 6. KPIs recalculados (al 2026-06-19) — universo OFICIAL desde jun-2024

### 6.0 · Comparación de cortes (entregable 7)

| Corte | Vigentes (n · monto) | >90 días (n · monto) |
|---|---|---|
| **Crudo** (estado≠4, saldo>0) | 4.792 · $66.627,1M | 4.579 · $62.007,0M |
| **Limpio** (+ origen>0) | 3.107 · $31.835,3M | 2.894 · $27.215,2M |
| **OFICIAL** (+ fecha ≥ 2024-06-01) | **837 · $5.510,8M** | **624 · $890,7M** |

El corte de calidad histórica (jun-2024) saca **$26.324,5M** de aging estancado pre-2024
(saldos no gestionables). El "104 / $370,5M Área=Venta" viejo es **otra métrica** — corte
angosto curado a mano — **no mezclar.**

### 6.1 · KPIs oficiales
- **Total provisiones vigentes (desde jun-2024): 837 · $5.510.846.697**
- **Provisiones >90 días (dentro de ese universo): 624 · $890.697.953**

### 6.3 · Desglose por marca (entregable 3) — vigente / >90

| Marca | Vig n | Vigente | >90 |
|---|--:|--:|--:|
| MG | 120 | $1.560,9M | $185,1M |
| Geely | 65 | $1.019,5M | $147,6M |
| Peugeot | 114 | $624,2M | $91,4M |
| Subaru | 59 | $386,3M | $23,9M |
| Citroën | 96 | $360,8M | $104,6M |
| Dfsk | 44 | $359,1M | $5,0M |
| Usados | 30 | $325,3M | $141,8M |
| Kia | 62 | $324,5M | $48,1M |
| Opel | 80 | $172,1M | $51,1M |
| Landking | 31 | $127,3M | $20,2M |
| Leapmotor | 13 | $93,3M | $0 |
| Nissan | 114 | $92,7M | $71,9M |
| Dongfeng | 4 | $45,0M | $0 |
| Suzuki | 3 | $12,0M | $0 |
| GWM | 2 | $7,9M | $0 |

### 6.4 · Desglose por área negocio (entregable 4)

| Área | Vig n | Vigente | >90 |
|---|--:|--:|--:|
| 1 · Venta | 805 | $5.435,3M | $847,4M |
| 2 · Post Venta | 32 | $75,5M | $43,3M |

### 6.5 · Desglose por concepto (entregable 5) — vigente / >90

| Concepto | Vig n | Vigente | >90 |
|---|--:|--:|--:|
| Bono Marca | 244 | $2.053,9M | $178,1M |
| Bono Financiera | 167 | $1.742,8M | $77,4M |
| Incentivo Ventas | 161 | $1.105,7M | $347,2M |
| Bono Flotas | 54 | $271,1M | $97,5M |
| Publicidad Coperada | 77 | $92,0M | $41,4M |
| Incentivo Post Ventas | 32 | $75,5M | $43,3M |
| Comisión Seguros | 75 | $74,5M | $18,9M |
| Otros Bonos | 17 | $53,9M | $45,5M |
| Bonos Usados | 8 | $35,7M | $35,7M |
| Bonos Usados Incentivos | 2 | $5,7M | $5,7M |

### 6.6 · Top 20 provisiones >90 por saldo (entregable 6)

| ID | Marca | Concepto | Generada | Días | Saldo |
|--:|---|---|---|--:|--:|
| 9868 | Geely | Incentivo Ventas | 2026-03-10 | 101 | $66.000.000 |
| 9673 | Geely | Incentivo Ventas | 2026-02-06 | 133 | $37.319.769 |
| 9134 | MG | Incentivo Ventas | 2025-10-08 | 254 | $32.127.794 |
| 9626 | Usados | Incentivo Ventas | 2026-01-13 | 157 | $25.763.519 |
| 9016 | MG | Otros Bonos | 2025-09-08 | 284 | $24.242.773 |
| 9808 | Citroën | Bono Flotas | 2026-03-09 | 102 | $23.682.047 |
| 9340 | Usados | Incentivo Ventas | 2025-11-13 | 218 | $23.502.118 |
| 8973 | MG | Bono Marca | 2025-09-05 | 287 | $18.762.605 |
| 8438 | Usados | Incentivo Ventas | 2025-04-09 | 436 | $16.900.000 |
| 8043 | Usados | Incentivo Ventas | 2025-01-10 | 525 | $16.250.000 |
| 9400 | Geely | Bono Flotas | 2025-12-09 | 192 | $15.405.807 |
| 9775 | Peugeot | Bono Flotas | 2026-03-05 | 106 | $14.462.135 |
| 9407 | Peugeot | Bono Marca | 2025-12-09 | 192 | $14.194.780 |
| 9178 | Kia | Incentivo Ventas | 2025-10-10 | 252 | $13.620.280 |
| 9259 | Citroën | Bono Flotas | 2025-11-07 | 224 | $12.469.948 |
| 9396 | Opel | Bono Marca | 2025-12-09 | 192 | $12.184.875 |
| 9405 | Citroën | Bono Marca | 2025-12-09 | 192 | $11.083.771 |
| 9321 | Kia | Incentivo Ventas | 2025-11-10 | 221 | $10.567.000 |
| 7066 | MG | Bono Marca | 2024-06-10 | 739 | $10.178.301 |
| 9554 | Citroën | Bono Financiera | 2026-01-08 | 162 | $9.831.946 |

El >90 ($890,7M) es **cola larga**: 624 provisiones, promedio ~$1,4M; el top 20 ≈ $408M (46%).

## 7. Validación contra pantalla real (los 3 ejemplos del usuario)

| ID | monto (prov. neto) | monto_factura (fact. neto) | **saldo = monto − fact** | pantalla | estado | origen→marca |
|---|---|---|---|---|---|---|
| 10295 | 542.963 | 542.963 | **$0** | $0 ✓ | 2 | Peugeot |
| 10300 | 2.500.000 | NULL→0 | **$2.500.000** | $2.500.000 ✓ | 1 | Peugeot |
| 10309 | 2.461.255 | 2.461.225 | **$30** | $30 ✓ | 2 | Suzuki |

Seguimiento de generación (ejemplo 10300): `SIS_Seguimientos` Menu 73, Referencia 10300,
`Comentario='Se ha generado una nueva provisión'`, `FechaCreacion='2026-06-12 11:11:08'`
= **idéntico** a `VT_Provisiones.fecha` y al texto de la ficha ("el 2026-06-12 11:11:08").

## 8. Query oficial del listado (parametrizada, solo lectura)

```sql
SELECT
  p.ID                                      AS id_provision,
  p.provision                               AS concepto_id,
  c.Concepto                                AS concepto,
  c.AreaNegocioID                           AS area_negocio,     -- 1=Venta, 2=Post Venta
  p.periodo                                 AS mes_provision,
  p.FechaPeriodo                            AS fecha_periodo,
  o.Origen                                  AS marca,            -- p.origen
  t.Tipo                                    AS por_facturar_a,   -- p.tipo
  m.motivo                                  AS motivo,
  p.estado                                  AS estado,
  p.monto                                   AS provision_neto,
  COALESCE(p.monto_factura,0)               AS facturado_neto,
  (p.monto - COALESCE(p.monto_factura,0))   AS saldo_pendiente_por_facturar,
  p.ultima_fecha_factura                    AS ultima_fecha_factura,
  p.usuario                                 AS usuario_ingreso,
  p.fecha                                   AS fecha_generacion  -- == seguimiento "Se ha generado..."
FROM roma.VT_Provisiones p
LEFT JOIN roma.VT_ProvisionesConcepto c ON c.ID = p.provision
LEFT JOIN roma.VT_ProvisionesOrigen   o ON o.ID = p.origen
LEFT JOIN roma.VT_ProvisionesTipo     t ON t.ID = p.tipo
LEFT JOIN roma.VT_ProvisionesMotivo   m ON m.id = p.motivo
WHERE p.estado <> 4                  -- excluye ANULADA
  AND p.origen > 0                   -- excluye legacy 2018-2019 sin marca
  AND p.fecha >= '2024-06-01';       -- CORTE DE CALIDAD: solo desde jun-2024

-- KPI 1 — Total vigentes (oficial, desde jun-2024)
SELECT SUM(p.monto - COALESCE(p.monto_factura,0)) AS total_vigente
FROM roma.VT_Provisiones p
WHERE p.estado <> 4 AND p.origen > 0
  AND (p.monto - COALESCE(p.monto_factura,0)) > 0
  AND p.fecha >= '2024-06-01';

-- KPI 2 — >90 días (oficial: corte de calidad + aging operativo, son DOS filtros)
SELECT SUM(p.monto - COALESCE(p.monto_factura,0)) AS total_mayor_90
FROM roma.VT_Provisiones p
WHERE p.estado <> 4 AND p.origen > 0
  AND (p.monto - COALESCE(p.monto_factura,0)) > 0
  AND p.fecha >= '2024-06-01'                      -- calidad histórica (fijo)
  AND p.fecha <= (CURDATE() - INTERVAL 90 DAY);    -- aging operativo (móvil)
```

Variante de **máxima fidelidad** al seguimiento (para el <0,1% editado): reemplazar
`p.fecha` en el filtro >90 por
`COALESCE((SELECT MIN(s.FechaCreacion) FROM roma.SIS_Seguimientos s WHERE s.MenuSecundarioID=73 AND s.ReferenciaID=p.ID AND s.Comentario='Se ha generado una nueva provisión'), p.fecha)`.

## 9. Plan de implementación en Velocity / Capital de Trabajo

Reusar la infraestructura **Camino A** ya operativa (agente Railway → gateway ROMA
Amazon → POST autenticado → `DailyCapitalSnapshot`), igual que FNE:

1. **Gateway (Amazon):** agregar `consultar_provisiones_gateway()` en `agent/roma_gateway.py`
   con las queries KPI 1 y KPI 2 de arriba (devuelve `{vigentes_unidades, vigentes_monto, mas90_unidades, mas90_monto, aging_max}` + desglose por marca/área).
2. **Cron:** en `agent/cron.py` `generar_snapshot_diario`, incluir el bloque en el
   payload: `{roma: {fne, provisiones}}`. Si el gateway falla → fallback a fuente
   validada (sin inventar), igual que hoy.
3. **Endpoint Velocity:** `src/app/api/snapshots/daily/route.ts` ya acepta
   `{roma:{provisiones?}}`. Mapear a las columnas `provisionesUnidades/Monto/AgingMax`
   del `DailyCapitalSnapshot` (override de scope TOTAL).
4. **Flag:** poner `PROVISIONES_ENABLED=1` en el job recién cuando el total **cuadre
   contra el export de la pantalla** (ver §10).
5. **Definición de producto (DECIDIDA):** el KPI de Capital de Trabajo usa
   **"Provisiones vigentes generadas desde jun-2024"** (universo oficial §4):
   vigentes $5.510,8M · >90 días $890,7M. **No** usar saldos legacy pre-2024.
   **No** mezclar con el corte antiguo 104/$370,5M Área=Venta.

## 10. Lo único a confirmar contra ROMA (export de pantalla)

La fórmula y el mapeo están cerrados. Lo que **solo se valida con el export real** de
"Gestión de Provisiones de Ingreso" es el **universo/grand-total**:

1. ¿La pantalla **incluye o excluye** el bucket legacy 2018-2019 (`origen` 0/NULL, $34,8B)?
   → recomiendo excluir (`origen>0`); confirmar que la suma exportable lo refleja.
2. ¿La pantalla tiene **filtro de período** por defecto (mes actual) o muestra todo el libro?
3. ¿`estado = 6` y otros estados raros se muestran? (impacto: 1 fila, despreciable.)

Exportar la pantalla a Excel **filtrada desde jun-2024**, sumar la columna "Saldo Pendiente
por Facturar", y comparar contra el `total_vigente` oficial de §6.1 ($5.510,8M).
**No activar `PROVISIONES_ENABLED=1` hasta que cuadre contra ese export filtrado desde jun-2024.**

---

### Referencias de tablas (roma)
`VT_Provisiones` (10.241) · `VT_ProvisionesConcepto` (11, AreaNegocioID) ·
`VT_ProvisionesOrigen` (16, marca + GerenciaID) · `VT_ProvisionesTipo` (43, por-facturar-a) ·
`VT_ProvisionesMotivo` (49) · `VT_ProvisionesFacturas` (3.475, detalle factura) ·
`SIS_Seguimientos` (7,58M, Menu 73 = provisiones) · `SIS_SeguimientosTipos` (92).
