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
| **🚩 Hallazgo crítico** | **$34,8B son provisiones legacy 2018-2019 sin marca** (`origen` 0/NULL). Inflan el ">90 d" de $27B → $62B. **Excluir con `origen > 0`** |

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

## 4. Fórmulas exactas

```
Saldo Pendiente por Facturar = monto − COALESCE(monto_factura, 0)
Vigente                      = Saldo Pendiente por Facturar > 0
fecha_generacion             = COALESCE( MIN(seguimiento 'Se ha generado...'), VT_Provisiones.fecha )

KPI 1 · Total provisiones vigentes
  = SUM(saldo)  WHERE estado <> 4  AND origen > 0  AND saldo > 0

KPI 2 · Provisiones > 90 días
  = SUM(saldo)  WHERE estado <> 4  AND origen > 0  AND saldo > 0
                AND fecha_generacion <= CURDATE() - INTERVAL 90 DAY
```

Notas:
- `estado <> 4` excluye **ANULADAS**.
- `origen > 0` excluye el **bucket legacy 2018-2019** (ver §6). Es la única exclusión
  "de criterio"; el resto es mecánico.
- Boundary `<= hoy-90` = aging ≥ 90 d (ajustable a `> 90` si la pantalla usa estricto).

## 5. Estados (semántica comprobada por seguimientos)

| estado | significado | trato |
|---|---|---|
| 1 | Generada / pendiente de factura | vigente |
| 2 | En proceso (notificada/confirmada contabilidad, factura parcial) | vigente |
| 3 | Facturada / confirmada | vigente si saldo>0 |
| **4** | **ANULADA** ("Se ha Anulado Registro") | **EXCLUIR** |
| 6 | Borde (1 fila) | vigente si saldo>0 |

## 6. Números actuales (al 2026-06-19) y el bucket legacy

**Crudo** (estado≠4, saldo>0, sin más filtros):
- Total vigentes: **4.792 provisiones · $66.627.142.418**
- >90 días: **4.579 provisiones · $62.006.993.674**

**🚩 Bucket legacy a excluir** (`origen` ∈ {0, NULL}):
- 1.685 provisiones · **$34.791.792.602** · fechas **2018-01 → 2019-12** · 100% >90 días.
- Son saldos de apertura migrados al implementar ROMA (2018-19), sin marca, nunca cerrados. **No son cuentas por cobrar reales.**

**Limpio y recomendado** (estado≠4, `origen>0`, saldo>0):
- **Total vigentes: ≈ 3.107 provisiones · $31.835.349.816**
- **>90 días: ≈ 2.894 provisiones · $27.215.201.072**

Desglose por marca (>90 d, limpio, top): Nissan $7.608M · Kia $4.755M · MG $3.804M ·
Peugeot $3.563M · Usados $2.171M · Dfsk $1.804M · Subaru $1.414M · Opel $909M ·
Geely $778M · Citroën $131M · F&I $258M …
Desglose por área (vigente): Venta (area 1) $25.703M · Post Venta (area 2) $578M ·
(el resto cae en el legacy sin concepto/área).

> ⚠️ Esto es **muchísimo mayor** que el "104 / $370,5M" que usa hoy Velocidad. Ese
> número viejo era un corte curado y angosto (solo Área=Venta + conceptos puntuales +
> períodos recientes, exportado a mano). La pantalla "Gestión de Provisiones de Ingreso"
> es el **libro completo** de provisiones por facturar. Son dos métricas distintas.

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
WHERE p.estado <> 4            -- excluye ANULADA
  AND p.origen > 0;           -- excluye legacy 2018-2019 sin marca  (quitar para "crudo")

-- KPI 1 — Total vigentes
SELECT SUM(p.monto - COALESCE(p.monto_factura,0)) AS total_vigente
FROM roma.VT_Provisiones p
WHERE p.estado <> 4 AND p.origen > 0
  AND (p.monto - COALESCE(p.monto_factura,0)) > 0;

-- KPI 2 — >90 días desde fecha de generación
SELECT SUM(p.monto - COALESCE(p.monto_factura,0)) AS total_mayor_90
FROM roma.VT_Provisiones p
WHERE p.estado <> 4 AND p.origen > 0
  AND (p.monto - COALESCE(p.monto_factura,0)) > 0
  AND p.fecha <= (CURDATE() - INTERVAL 90 DAY);
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
5. **Decisión de producto pendiente:** definir si la métrica de Velocidad pasa a ser
   este libro completo ($27B >90 limpio) o se mantiene el corte angosto actual
   ($370,5M Área=Venta). Son conceptos distintos — **no mezclarlos en el mismo KPI sin avisar.**

## 10. Lo único a confirmar contra ROMA (export de pantalla)

La fórmula y el mapeo están cerrados. Lo que **solo se valida con el export real** de
"Gestión de Provisiones de Ingreso" es el **universo/grand-total**:

1. ¿La pantalla **incluye o excluye** el bucket legacy 2018-2019 (`origen` 0/NULL, $34,8B)?
   → recomiendo excluir (`origen>0`); confirmar que la suma exportable lo refleja.
2. ¿La pantalla tiene **filtro de período** por defecto (mes actual) o muestra todo el libro?
3. ¿`estado = 6` y otros estados raros se muestran? (impacto: 1 fila, despreciable.)

Exportar la pantalla a Excel, sumar la columna "Saldo Pendiente por Facturar", y comparar
contra `total_vigente` de §8. Si cuadra → activar `PROVISIONES_ENABLED=1`.

---

### Referencias de tablas (roma)
`VT_Provisiones` (10.241) · `VT_ProvisionesConcepto` (11, AreaNegocioID) ·
`VT_ProvisionesOrigen` (16, marca + GerenciaID) · `VT_ProvisionesTipo` (43, por-facturar-a) ·
`VT_ProvisionesMotivo` (49) · `VT_ProvisionesFacturas` (3.475, detalle factura) ·
`SIS_Seguimientos` (7,58M, Menu 73 = provisiones) · `SIS_SeguimientosTipos` (92).
