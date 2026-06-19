# Job Amazon · Snapshot diario con ROMA en vivo (PR 2)

Entregable de PR 2. Hace que **Provisiones >90d Venta** y **FNE operativo** del
snapshot diario salgan de **ROMA en vivo**, no de los Excel cargados.

## Por qué Amazon y no Railway
ROMA vive en Amazon/VPC y **no es alcanzable desde Railway** (donde corren el
web y el agente). Por eso la consulta a ROMA debe originarse en Amazon. Este job
solo consulta ROMA y **postea el resultado** a Velocidad; el resto del cálculo
(Caja Comercial/Total, desglose, CP, Saldos — carry-forward de los snapshots
activos) vive en Velocidad.

## Flujo

```
20:00 Chile (EventBridge / crontab Amazon)
  → snapshot_roma_job.py
      consulta ROMA: Provisiones>90 Venta {casos, monto, agingMax}
                     FNE operativo        {unidades, monto}
      POST {VELOCIDAD_URL}/api/snapshots/daily
           Authorization: Bearer <DAILY_SNAPSHOT_TOKEN>
           body: { "roma": { "provisiones": {...}, "fne": {...} } }
  → Velocidad: generarDailyCapitalSnapshot({ roma })
      · override Provisiones/FNE (scope TOTAL) con los datos ROMA
      · Caja Comercial/Total/desglose/CP/Saldos: carry-forward (snapshots activos)
      · upsert DailyCapitalSnapshot  (idempotente, 1 fila por [fecha, scope])
```

Si el body NO trae `roma`, el endpoint usa los snapshots activos (Excel
validado, equivalente a ROMA). Forward-compatible: este job es un **upgrade
drop-in**.

## ⚠️ Una sola fuente de disparo
El **agente César (Railway)** ya tiene un job 20:00 (`snapshot_diario_capital`)
que postea **sin body** (snapshots activos). Cuando este job Amazon esté activo,
**deshabilitar el del agente** para no disparar dos veces el mismo día:
poner `DAILY_SNAPSHOT_TOKEN=""` en el servicio `velocidad-agent` (Railway).
Ambos hacen upsert (la última corrida gana), pero conviene una sola fuente para
que Provisiones/FNE sean ROMA-vivo.

## Variables de entorno
```
ROMA_DB_HOST, ROMA_DB_PORT (3306), ROMA_DB_USER, ROMA_DB_PASSWORD, ROMA_DB_NAME
VELOCIDAD_URL          # https://velocidadoperacional.pompeyo.cl
DAILY_SNAPSHOT_TOKEN   # MISMO valor que el servicio web de Velocidad
```

## Deploy (ejemplo crontab Amazon)
```bash
pip install pymysql httpx
# 20:00 America/Santiago — ajustar TZ del host o usar UTC equivalente
0 20 * * *  cd /opt/velocidad-jobs && /usr/bin/python3 snapshot_roma_job.py >> /var/log/snapshot_roma.log 2>&1
```
(o EventBridge Scheduler con timezone `America/Santiago` → ECS/Lambda).

## Queries ROMA (validadas en las auditorías)
- **FNE**: `VT_Ventas` con `EstadoActaEntregaID IN (0,1)` ∧ `FechaFactura >= '2026-01-01'`
  (reproducción exacta: 514 VIN / $8.412,7M).
- **Provisiones Venta**: `VT_Provisiones ⋈ VT_ProvisionesConcepto` con
  `AreaNegocioID=1` ∧ `estado IN (1,2,3)`, saldo = `GREATEST(0, monto −
  monto_factura − monto_rebaja)`, filtro `>90d` por `DATEDIFF`.
  **CONFIRMAR con el equipo ROMA el campo de fecha de creación** (`fecha_creacion`
  en el SQL) — las provisiones de ROMA no historizan el aging (ver Doc A de la
  auditoría). Hasta confirmarlo, el job del agente cubre Provisiones con la
  fuente validada.

## Validación post-deploy
Tras una corrida, verificar en Velocidad (read-only):
```
railway run --service Postgres sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npx tsx scripts/validate-snapshot-diario.ts'
```
El campo `romaEnVivo: true` en la respuesta del POST confirma que se usó ROMA.
