# Job Amazon · Snapshot diario · FUENTE OFICIAL (ROMA en vivo)

Enfoque **Amazon-first** (PR 2). El snapshot diario se origina en **Amazon**,
donde existe acceso directo a ROMA, y alimenta el endpoint de Velocidad. Railway
**solo recibe y persiste** — no reconstruye ROMA.

```
ROMA vivo  →  Job Amazon  →  POST /api/snapshots/daily  →  Velocidad (Railway) persiste
```

> **Camino elegido: B (trigger dentro de Amazon).** Pasos de despliegue turnkey
> (Lambda + EventBridge sa-east-1, o cron en el host del gateway) en
> **[`DEPLOY-AMAZON.md`](DEPLOY-AMAZON.md)**. Ya existe infra Amazon conectada a
> ROMA (el gateway `mcp-roma-server`, ELB sa-east-1); este job reusa esa misma
> red/credenciales. `snapshot_roma_job.py` corre como CLI o como Lambda
> (`lambda_handler`).

## Evidencia de conectividad Amazon → ROMA (verificada en vivo 2026-06-19)
Conexión directa confirmada (`SELECT DATABASE(), NOW()` → `db=roma`,
`2026-06-19 09:57:56`). Queries corridas contra ROMA en producción:

| Fuente | Query ROMA | Resultado vivo | ¿Reproducible? |
|---|---|---|---|
| **FNE operativo** | `VT_Ventas` · `EstadoActaEntregaID IN (0,1)` ∧ `FechaFactura ≥ 2026-01-01` | **513 VIN · $8.393,6M** | ✅ **EXACTO** (vs auditoría 514 VIN/$8,4B) |
| Provisiones >90d | `VT_Provisiones ⋈ Concepto` · `AreaNegocioID=1` ∧ `estado IN(1,2,3)` | 4.831 / 1.940(−$9,5B) / 386·$574,9M | ❌ **no reproducible** (oficial = 104·$370,5M) |

**Conclusión técnica:** Amazon **sí puede operar** la captura — FNE sale exacto de
ROMA vivo y es la fuente oficial. **Provisiones >90d NO es reproducible** con query
directa: la referencia de aging (718d vs 553d), la ventana de período y el
tratamiento de saldo del reporte "Provisiones de Ingreso" son la **pregunta abierta
de la auditoría (Doc A)**. Hasta que el equipo ROMA confirme el SQL, Provisiones
NO se postea y el endpoint usa el snapshot activo (el Excel "Provisiones de Ingreso"
**es** ese reporte ROMA, exportado a mano — no es reconstrucción indirecta).

## Payload exacto a `/api/snapshots/daily`
```http
POST /api/snapshots/daily
Authorization: Bearer <DAILY_SNAPSHOT_TOKEN>
Content-Type: application/json

{ "roma": { "fne": { "unidades": 513, "monto": 8393628851 } } }
```
Cuando se confirme Provisiones (`PROVISIONES_ENABLED=1`):
```json
{ "roma": { "fne": { "unidades": 513, "monto": 8393628851 },
            "provisiones": { "casos": 104, "monto": 370500000, "agingMax": 553 } } }
```
El endpoint hace **override del scope TOTAL** con lo que venga en `roma`; lo no
provisto (Provisiones, Caja, desglose, CP, Saldos) lo calcula de los snapshots
activos. Respuesta incluye `"romaEnVivo": true`.

## Qué calcula cada lado (Railway solo recibe/persiste)
| Métrica | Fuente | Dónde se calcula |
|---|---|---|
| **FNE operativo** | **ROMA vivo** | Job Amazon (este script) |
| Provisiones >90d | snapshot activo (= reporte ROMA exportado) | Velocidad — *ROMA-vivo cuando se confirme el SQL* |
| Caja Comercial/Total + desglose | Stock activo (carga propia Velocidad, NO ROMA) | Velocidad |
| Crédito Pompeyo >15d / Saldos T3+ | Saldos/Salvin activos (NO ROMA) | Velocidad |

## Deploy SIN doble cron
1. Desplegar este job en Amazon, cron **20:00 America/Santiago** (EventBridge o crontab).
2. **Deshabilitar el cron del agente** (Railway): `DAILY_SNAPSHOT_TOKEN=""` en el
   servicio `velocidad-agent`. Así el job del agente (`snapshot_diario_capital`)
   no se registra y **Amazon queda como única fuente de disparo**.
3. Variables del job Amazon: `ROMA_DB_{HOST,PORT,USER,PASSWORD,NAME}`,
   `VELOCIDAD_URL` (https://velocidadoperacional.pompeyo.cl), `DAILY_SNAPSHOT_TOKEN`
   (mismo valor que el web).

```bash
pip install pymysql httpx
# crontab Amazon (TZ America/Santiago)
0 20 * * *  cd /opt/velocidad-jobs && python3 snapshot_roma_job.py >> /var/log/snapshot_roma.log 2>&1
```

## Validación post-deploy (read-only, desde Velocidad)
```
railway run --service Postgres sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npx tsx scripts/validate-snapshot-diario.ts'
```
`romaEnVivo: true` en la respuesta del POST confirma que se usó ROMA vivo.
