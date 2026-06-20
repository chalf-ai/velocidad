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
| **Saldo Pendiente por Facturar** | `monto + (EstadoAjusteID=2 ? MontoAjuste : 0) − COALESCE(monto_factura,0)` — **CORREGIDO** contra export real (§11): aplica el ajuste aprobado, NO es `monto−factura`. Cuadra al peso (2832/2832). |
| **Fecha de antigüedad (>90 d)** | `VT_Provisiones.fecha` = la fecha del seguimiento *"Se ha generado una nueva provisión"* (validado: coincide en 7.626/7.633 = 99,9%; única fuente para 2.608 sin evento) |
| **Estado a excluir** | `estado = 4` = **ANULADA** (comprobado: comentarios "Se ha Anulado Registro") |
| **🚩 Hallazgo crítico** | **$34,8B son provisiones legacy 2018-2019 sin marca** (`origen` 0/NULL). **Excluir con `origen > 0`** |
| **Regla de producto** | Capital de Trabajo usa **"Provisiones vigentes generadas desde jun-2024"** (`fecha >= '2024-06-01'`). Corte de calidad histórica, **adicional** al aging >90. |
| **KPIs oficiales (2026-06-20, CUADRADOS al peso vs export §11)** | Vigentes **290 · $5.121,7M** · >90 días **90 · $547,9M** |
| **Cuadre** | ✅ La fórmula corregida reproduce el export ROMA **exacto en las 5 métricas**. **Autorizado** para implementación. |

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
saldo_pendiente_por_facturar = monto
                               + (CASE WHEN EstadoAjusteID = 2 THEN COALESCE(MontoAjuste,0) ELSE 0 END)
                               − COALESCE(monto_factura, 0)
   -- ⚠ CORREGIDO 2026-06-20 contra export real: NO es monto−factura. La pantalla
   --   aplica el AJUSTE APROBADO (EstadoAjusteID=2) de la provisión. Valida al peso
   --   (2832/2832 filas del export). Provisiones ajustadas-y-aprobadas quedan saldo 0.
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

> **NOTA (2026-06-20):** los KPIs de abajo están **CORREGIDOS** con la fórmula real de
> saldo (`monto + ajuste_aprobado − factura`, §4) y **cuadran al peso contra el export
> ROMA** (§11). Las cifras previas de esta sección (837/$5.510,8M; 624/$890,7M) usaban
> `monto−factura` y quedaron **obsoletas** (sobre-contaban provisiones ya cerradas por ajuste).

### 6.1 · KPIs oficiales (cuadrados vs export, al 2026-06-20)
- **Total provisiones vigentes (saldo>0, desde jun-2024): 290 · $5.121.714.234**
  (suma de columna `saldo` incl. negativos = $5.076.055.956)
- **Provisiones >90 días: 90 · $547.858.850**

### 6.0 · Por qué cambió respecto a la versión `monto−factura`
La fórmula vieja contaba como "pendiente" toda provisión con `factura < provisión`, pero
la pantalla **cierra el saldo a 0 al aprobar el ajuste** (la provisión se ajusta al monto
realmente facturado). Eso bajó vigentes de 837→290 y >90 de $890,7M→$547,9M. El universo
(estado≠4, origen>0, fecha≥2024-06) no cambió; sí la fórmula del saldo.

> Recalculado desde el **export real** (ground truth) con la fórmula corregida. Universo
> vigente = saldo>0, desde jun-2024 = **290 · $5.121,7M**.

### 6.3 · Desglose por marca (entregable 3) — vigente / >90

| Marca | Vig n | Vigente | >90 |
|---|--:|--:|--:|
| MG | 27 | $1.373,9M | $42,9M |
| Geely | 37 | $1.014,2M | $142,3M |
| Peugeot | 38 | $591,2M | $58,4M |
| Subaru | 19 | $362,1M | $0 |
| Dfsk | 11 | $354,1M | $0 |
| Citroën | 33 | $343,9M | $87,6M |
| Kia | 24 | $313,2M | $37,5M |
| Usados | 18 | $289,7M | $106,1M |
| Opel | 32 | $159,9M | $38,9M |
| Landking | 21 | $126,3M | $19,1M |
| Leapmotor | 12 | $93,2M | $0 |
| Dongfeng | 4 | $45,0M | $0 |
| Nissan | 9 | $35,4M | $14,9M |
| Suzuki | 3 | $12,0M | $0 |
| GWM | 2 | $7,9M | $0 |

### 6.4 · Desglose por área negocio (entregable 4)

| Área | Vig n | Vigente | >90 |
|---|--:|--:|--:|
| 1 · Venta | 282 | $5.081,0M | $539,4M |
| 2 · Post Venta (Incentivo Post Ventas) | 8 | $40,7M | $8,5M |

### 6.5 · Desglose por concepto (entregable 5) — vigente / >90

| Concepto | Vig n | Vigente | >90 |
|---|--:|--:|--:|
| Bono Marca | 88 | $2.006,0M | $130,6M |
| Bono Financiera | 53 | $1.697,0M | $32,0M |
| Incentivo Ventas | 65 | $943,1M | $229,4M |
| Bono Flotas | 22 | $262,9M | $89,3M |
| Publicidad Coperada | 30 | $60,2M | $10,0M |
| Comisión Seguros | 12 | $55,5M | $0,1M |
| Incentivo Post Ventas | 8 | $40,7M | $8,5M |
| Bonos Usados | 6 | $31,3M | $31,3M |
| Otros Bonos | 6 | $25,1M | $16,7M |

### 6.6 · Top 15 provisiones >90 por saldo (entregable 6)

| ID | Marca | Concepto | Generada | Saldo |
|--:|---|---|---|--:|
| 9868 | Geely | Incentivo Ventas | 2026-03-10 | $66.000.000 |
| 9673 | Geely | Incentivo Ventas | 2026-02-06 | $37.319.769 |
| 9626 | Usados | Incentivo Ventas | 2026-01-13 | $25.763.519 |
| 9808 | Citroën | Bono Flotas | 2026-03-09 | $23.682.047 |
| 9340 | Usados | Incentivo Ventas | 2025-11-13 | $23.502.118 |
| 8973 | MG | Bono Marca | 2025-09-05 | $18.762.605 |
| 8438 | Usados | Incentivo Ventas | 2025-04-09 | $16.900.000 |
| 9400 | Geely | Bono Flotas | 2025-12-09 | $15.405.807 |
| 9775 | Peugeot | Bono Flotas | 2026-03-05 | $14.462.135 |
| 9407 | Peugeot | Bono Marca | 2025-12-09 | $14.194.780 |
| 9178 | Kia | Incentivo Ventas | 2025-10-10 | $13.620.280 |
| 9259 | Citroën | Bono Flotas | 2025-11-07 | $12.469.948 |
| 9396 | Opel | Bono Marca | 2025-12-09 | $12.184.875 |
| 9405 | Citroën | Bono Marca | 2025-12-09 | $11.083.771 |
| 9321 | Kia | Incentivo Ventas | 2025-11-10 | $10.567.000 |

El >90 ($547,9M) es **cola larga**: 90 provisiones, promedio ~$6,1M; las top 15 ≈ $316M (58%).

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
  (p.monto + CASE WHEN p.EstadoAjusteID=2 THEN COALESCE(p.MontoAjuste,0) ELSE 0 END
   - COALESCE(p.monto_factura,0))           AS saldo_pendiente_por_facturar,  -- ⚠ §4 corregida
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

-- saldo (reutilizar la expresión corregida; alias `sld`):
--   sld = p.monto + (CASE WHEN p.EstadoAjusteID=2 THEN COALESCE(p.MontoAjuste,0) ELSE 0 END)
--               - COALESCE(p.monto_factura,0)

-- KPI 1 — Total vigentes (oficial, desde jun-2024) → 290 · $5.121.714.234
SELECT SUM(p.monto + CASE WHEN p.EstadoAjusteID=2 THEN COALESCE(p.MontoAjuste,0) ELSE 0 END
           - COALESCE(p.monto_factura,0)) AS total_vigente
FROM roma.VT_Provisiones p
WHERE p.estado <> 4 AND p.origen > 0 AND p.fecha >= '2024-06-01'
  AND (p.monto + CASE WHEN p.EstadoAjusteID=2 THEN COALESCE(p.MontoAjuste,0) ELSE 0 END
       - COALESCE(p.monto_factura,0)) > 0;

-- KPI 2 — >90 días (corte de calidad + aging operativo, DOS filtros) → 90 · $547.858.850
SELECT SUM(p.monto + CASE WHEN p.EstadoAjusteID=2 THEN COALESCE(p.MontoAjuste,0) ELSE 0 END
           - COALESCE(p.monto_factura,0)) AS total_mayor_90
FROM roma.VT_Provisiones p
WHERE p.estado <> 4 AND p.origen > 0
  AND p.fecha >= '2024-06-01'                      -- calidad histórica (fijo)
  AND p.fecha <= (CURDATE() - INTERVAL 90 DAY)     -- aging operativo (móvil)
  AND (p.monto + CASE WHEN p.EstadoAjusteID=2 THEN COALESCE(p.MontoAjuste,0) ELSE 0 END
       - COALESCE(p.monto_factura,0)) > 0;
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
5. **Definición de producto (DECIDIDA y CUADRADA):** el KPI de Capital de Trabajo usa
   **"Provisiones vigentes generadas desde jun-2024"** con la fórmula de saldo corregida
   (§4). KPIs oficiales: **vigentes 290 · $5.121,7M · >90 días 90 · $547,9M** (cuadrados al
   peso vs export, §11). **No** usar saldos legacy pre-2024. **No** mezclar con el corte
   antiguo 104/$370,5M Área=Venta. **AUTORIZADO** para implementar.

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

## 11. Cuadre contra export ROMA — ✅ CUADRA EXACTO (2026-06-20)

Export usado: `Registros-Provisiones-20-06-2026_129.xlsx` (hoja ROMA, 2.832 filas, columna
`saldo` propia de la pantalla). El export venía con Estados {Facturado 2143, Confirmado 684,
Pendiente 5} — **sin anuladas** — y rango fechaCreacion 2024-04→2026-06 (1 sola fila previa
a jun-2024, saldo 0): la pantalla **ya filtra a ~jun-2024 en adelante y excluye anuladas.**

### Resultado del cuadre (DB con fórmula corregida vs export)

| Métrica | Query DB corregido | Export real | Match |
|---|--:|--:|:--:|
| Vigentes (saldo>0) | **290** | 290 | ✅ |
| Σ columna `saldo` | **$5.076.055.956** | $5.076.055.956 | ✅ al peso |
| Σ saldo>0 (vigente) | **$5.121.714.234** | $5.121.714.234 | ✅ al peso |
| >90 días (n) | **90** | 90 | ✅ |
| >90 días (monto) | **$547.858.850** | $547.858.850 | ✅ al peso |

### Qué estaba mal (y el ajuste demostrado contra pantalla)
La causa NO era un filtro de universo: era la **fórmula del saldo**. La pantalla no usa
`monto − factura`; usa **`monto + ajuste_aprobado − factura`**, donde `ajuste_aprobado =
MontoAjuste` solo si `EstadoAjusteID = 2` (ajuste aprobado), 0 si `EstadoAjusteID = 1`
(pendiente). Demostrado:
- Fórmula `montoProvision + MontoAjusteProvision − montoFactura` matchea **2832/2832** filas
  del export, suma exacta $5.076.055.956.
- `MontoAjusteProvision` (export) = `MontoAjuste` cuando `EstadoAjusteID=2`; = 0 cuando =1
  (32 filas de diferencia, todas EstadoAjusteID=1). Confirmado fila a fila en la DB.
- La fórmula vieja `monto−factura` sobre-contaba 547 provisiones ya cerradas por ajuste
  (ej. ID 8097: MP 475.000, MF 112.395, MontoAjuste −362.605 aprobado → saldo 0, no 362.605).

### Filtros invisibles resueltos por el export
- **Saldos negativos:** la pantalla SÍ los muestra (30 filas, ≈−$45,7M) y los netea en la
  columna → por eso Σ columna ($5.076,1M) < Σ saldo>0 ($5.121,7M). "Vigente" = saldo>0.
- **Anuladas:** excluidas (no aparecen en el export). ✓
- **Saldo $0:** se muestran (2.512 filas) pero suman $0 → la pantalla tiene ~2.832 filas,
  de las cuales solo **290 son vigentes** (saldo>0).
- **Universo:** las ~97 filas extra que incluye el query DB (estado<>4/origen>0/fecha) vs
  el export son todas saldo=0 → no afectan ningún KPI (la Σ cuadra al peso igual).

### DECISIÓN FINAL
> ✅ **"Query oficial CUADRA (al peso, 5/5 métricas) con la fórmula de saldo corregida
> (`monto + ajuste_aprobado − factura`). AUTORIZADO para implementación de Camino A."**
>
> KPIs oficiales (2026-06-20): **Vigentes 290 · $5.121.714.234** · **>90 días 90 · $547.858.850**.
> Única corrección vs versión previa: la fórmula del saldo (el universo y los filtros
> estado/origen/fecha ya estaban bien). Las cifras 837/$5.510,8M quedaron obsoletas.

### Referencias de tablas (roma)
`VT_Provisiones` (10.241) · `VT_ProvisionesConcepto` (11, AreaNegocioID) ·
`VT_ProvisionesOrigen` (16, marca + GerenciaID) · `VT_ProvisionesTipo` (43, por-facturar-a) ·
`VT_ProvisionesMotivo` (49) · `VT_ProvisionesFacturas` (3.475, detalle factura) ·
`SIS_Seguimientos` (7,58M, Menu 73 = provisiones) · `SIS_SeguimientosTipos` (92).
