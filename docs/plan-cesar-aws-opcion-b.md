# Plan — Mover César/F2 a AWS (Opción B)

> **Estado: PROPUESTA PARA REVISIÓN. No ejecutar infraestructura.** Documento técnico
> para cerrar el split de base de datos que impide que las tareas creadas en
> `velocidad.pompeyo.cl` (AWS) generen WhatsApp.

## Contexto / diagnóstico (confirmado read-only, 2026-06-30)

- **Web app prod** = `https://velocidad.pompeyo.cl` → **AWS ECS** (cluster `velocidad-ecs`,
  service `velocidad-svc`, task def `velocidad`). `DATABASE_URL` desde el secret AWS
  **`velocidad/db-Xpuuon`**.
- **Agente César** = **Railway** (`velocidad-agent`), lee `postgres.railway.internal:5432/railway`
  y tiene `APP_BASE_URL = https://velocidadoperacional.pompeyo.cl` (el sitio Railway).
- **Consecuencia:** las `AlertaLog(TAREA_ASIGNADA, enviado=false)` creadas por `/api/tareas`
  en el sitio AWS quedan en la DB de AWS; el poller de Railway lee otra DB → nunca las ve →
  no envía. (`agent/database.py` asume "el mismo PostgreSQL de Velocidad" — esa suposición es
  la que se rompió.)
- **Gap pendiente (verificación documental OPCIONAL, no bloqueante):** el host literal de
  `velocidad/db-Xpuuon` no se pudo leer (permisos AWS `rds:Describe*` y `secretsmanager:Get/Describe`
  denegados a `david-cabrini-dev`). **No bloquea Etapa 0:** el agente reusa el **mismo secret que el
  web app prod**, así que apunta a la **misma DB** aunque no leamos el host literal. La evidencia del
  split es fuerte y convergente; confirmar el host es verificación de respaldo, no condición de arranque.

> **Único prerequisito BLOQUEANTE de Etapa 0:** `OPENAI_API_KEY` disponible como secret AWS — campo
> requerido sin default en `agent/config.py`; sin él el contenedor no arranca.

## 0. Hecho que condiciona el diseño

El agente es **monolítico**: `Dockerfile` corre `uvicorn agent.webhook:app` (puerto 8000), y
`agent/webhook.py` levanta FastAPI (`/webhook`, `/health`, `/debug/*`) **y** arranca el
scheduler (APScheduler) con **todos** los jobs: poller de tareas (60s), briefing 09:00,
seguimiento 15:00, snapshot 20:00.

Implicaciones:
1. **No se puede mover solo "el poller"** sin bifurcar el código → Opción B = **relocalizar el
   agente completo** a AWS y **apagar el de Railway**.
2. Recibe el **webhook de estado de Meta** (delivered/read/failed) → Meta tiene **una sola
   callback URL** → hay que **re-apuntarla a AWS**. Durante la transición **solo un agente**
   puede estar activo (dos agentes = briefings duplicados + webhook ambiguo).
3. **Bonus:** con `APP_BASE_URL=https://velocidad.pompeyo.cl`, el job de snapshot 20:00 queda
   apuntando a AWS → arregla de paso el acople de `roma.ventas`/snapshots.

## 1. Empaquetado en AWS

- **Servicio ECS nuevo** `velocidad-cesar-agent` en el **mismo cluster** `velocidad-ecs`,
  **misma VPC/subnets/launch type** que `velocidad-svc` (Fargate presumido) → alcanza la DB
  **dentro de la VPC**, sin exponerla a internet.
- **Imagen:** build desde `agent/` (ya trae `Dockerfile`, `python:3.11-slim`, `EXPOSE 8000`,
  `CMD uvicorn agent.webhook:app`). Push a **ECR nuevo**
  `145175805451.dkr.ecr.sa-east-1.amazonaws.com/velocidad-cesar-agent`.
- **Task definition** propia `velocidad-cesar-agent` (Fargate **0.25 vCPU / 0.5–1 GB**),
  `containerPort 8000`, logs `awslogs` → grupo **`/ecs/velocidad-cesar-agent`**.
  Habilitar `enableExecuteCommand=true` (para validar por ECS Exec sin endpoint público).
- **Restart:** ECS normal (`desiredCount=1`). Health check del contenedor → **`/health`**.
- **Inbound (webhook) — solo desde Etapa 2:** ALB → target group (8000, health `/health`) →
  servicio; subdominio `cesar.velocidad.pompeyo.cl` (o regla de path en el ALB existente),
  ACM cert + DNS.
- **CI:** workflow análogo a "Deploy a AWS ECS" con build context `agent/` y service
  `velocidad-cesar-agent` (o primer deploy manual, CI después).

## 2. Variables (nombres EXACTOS de `agent/config.py`)

**Secrets (Secrets Manager → `secrets` en la task def, nunca en texto plano):**

| Var | Origen |
|---|---|
| `DATABASE_URL` | reusar `velocidad/db-Xpuuon` → `DATABASE_URL` (misma DB que el web) |
| `OPENAI_API_KEY` | **requerido** (LangChain conversacional) — copiar desde Railway |
| `WHATSAPP_ACCESS_TOKEN` | secret (Meta Cloud API) — **ausente en Etapa 0** |
| `WHATSAPP_VERIFY_TOKEN` | secret (handshake webhook con Meta) |
| `DAILY_SNAPSHOT_TOKEN` | secret — **vacío hasta Etapa 3** (job snapshot off) |
| `ROMA_GATEWAY_API_KEY` | secret — solo si se reactiva provisiones/snapshot |

**Config (env plano):**

| Var | Valor |
|---|---|
| `APP_PUBLIC_URL` | `https://velocidad.pompeyo.cl` (link absoluto del caso) |
| `APP_BASE_URL` | `https://velocidad.pompeyo.cl` (web Next.js / POST snapshot) |
| `WHATSAPP_PHONE_NUMBER_ID` | `796470350213609` |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | (el de Railway, si está) |
| `GRAPH_API_VERSION` | `v23.0` |
| `WHATSAPP_TEMPLATE_NAME` | **`nueva_gestion`** (¡el default del código es `tarea_asignada`!) |
| `WHATSAPP_TEMPLATE_LANG` | `es_CL` |
| `TAREAS_WHATSAPP_ENABLED` | **`0` al inicio** → `1` al activar |
| `TAREAS_DRY_RUN` | **`true` al inicio** → `false` al activar |
| `TAREAS_WHATSAPP_PILOTO` | **David+Jimmy al inicio** → `*` al final |
| `TAREAS_POLL_SECONDS` | `60` |
| `TAREAS_DESDE` | `2026-06-10T23:50:09+00:00` (conservado) — ⚠️ Riesgo R3 |
| `PROVISIONES_ENABLED` | `0` en validación |
| `ROMA_GATEWAY_URL` | `http://mcp-roma-server-1805523551.sa-east-1.elb.amazonaws.com/mcp/` |
| `BRIEFING_HORA` / `SEGUIMIENTO_HORA` / `SNAPSHOT_HORA` / `AGENT_PORT` | `09:00` / `15:00` / `20:00` / `8000` |

## 3. Red / seguridad

- **VPC:** mismas subnets privadas que `velocidad-svc` → DB alcanzable **sin abrirla a
  internet**. (Descubrir: `aws ecs describe-services … networkConfiguration`.)
- **Security groups:**
  - Tarea agente: reusar **el mismo SG de la tarea `velocidad-svc`** → la DB ya le permite 5432
    (cero cambios en el SG de la DB). Egress 443 (Meta, OpenAI, ROMA).
  - ALB SG (desde Etapa 2): inbound 443 público; endurecimiento opcional a rangos de webhooks
    de Meta. Tarea ← ALB: inbound 8000 solo desde el SG del ALB.
- **TLS:** ACM en el ALB; conexión a la DB con `sslmode=require` si la Aurora lo exige
  (verificar que `settings.asyncpg_url` respeta el SSL del `DATABASE_URL` Prisma — R5).
- **IAM mínimo:** rol de **ejecución** con `secretsmanager:GetSecretValue` **solo** sobre los
  ARNs de `velocidad/db-Xpuuon` + el secret nuevo del agente, más ECR/logs. Rol de **tarea**
  con permisos SSM para ECS Exec (validación); sin otras AWS APIs.
- **Meta (Etapa 2):** re-apuntar callback URL del webhook a `https://cesar.velocidad.pompeyo.cl/webhook`
  + `WHATSAPP_VERIFY_TOKEN`, re-suscribir. (Confirmar path exacto: `grep '@app' agent/webhook.py`.)

## 4. Validación por etapas (resumen — detalle de Etapa 0 en checklist aparte)

- **Etapa 0 — conectividad, cero efectos:** servicio arriba con envíos/escrituras OFF; validar
  `/health`, DB prod AWS y **conteo de pendientes sanitizado** por ECS Exec + CloudWatch. Railway
  sigue primario. **Sin ALB, sin Meta, sin enviar nada.** → ver `checklist-etapa-0-cesar-aws.md`.
- **Etapa 1 — render correcto, sin enviar:** `PILOTO`=David+Jimmy, `TEMPLATE=nueva_gestion`,
  agregar token; mantener `DRY_RUN=1`; `GET /debug/tareas/ciclo` confirma que *simularía* con las
  4 vars correctas y link a `velocidad.pompeyo.cl`.
- **Etapa 2 — cutover + prueba real única:** **detener Railway** (libera webhook, evita doble
  briefing) → repuntar webhook Meta a AWS (ALB) → `DRY_RUN=0` con `PILOTO` aún David+Jimmy →
  un ciclo → verificar `enviado`, `waStatus` accepted→delivered→read, `waStatusAt`, respuesta Meta.
- **Etapa 3 — apertura controlada:** decidir backlog (R3) → `PILOTO=*`; reactivar
  `DAILY_SNAPSHOT_TOKEN` + `PROVISIONES_ENABLED=1` si se quiere el snapshot 20:00 en AWS.

## 5. Rollback

- `desiredCount=0` del servicio `velocidad-cesar-agent` (apaga AWS) **o** `DRY_RUN=1`/`ENABLED=0`.
- **Re-encender Railway** (`desiredCount=1`) y re-apuntar webhook de Meta a Railway.
- **No se tocan datos históricos** — `AlertaLog`/`TareaOperacional` quedan como están; el
  rollback es solo de cómputo y flags.

## Riesgos

- **R1 · Mover el agente = mover todo** (briefings/seguimiento/snapshot/conversacional/webhook),
  no solo el poller.
- **R2 · Webhook single-homed:** Meta tiene una sola URL → durante el cutover solo un agente activo.
- **R3 · Blast del backlog (el más importante):** con `TAREAS_DESDE` conservado + `PILOTO=*`, el
  primer ciclo real dispara **todas** las alertas pendientes desde el 10-jun acumuladas en la DB
  de AWS. Mitigación: medir el conteo en dry-run (Etapa 0), validar con `PILOTO` restringido, y
  antes de `*` decidir entre (a) aceptar el backlog, (b) subir `TAREAS_DESDE` a "ahora", o
  (c) marcar las viejas como `enviado`.
- **R4 · Doble envío en cutover:** si Railway y AWS corren a la vez → briefings duplicados →
  detener Railway antes de habilitar envíos en AWS.
- **R5 · asyncpg vs URL Prisma/SSL:** el `DATABASE_URL` es formato Prisma (`?schema=…&sslmode=…`);
  confirmar que `settings.asyncpg_url` lo parsea y que la Aurora acepta el SSL.
- **R6 · `OPENAI_API_KEY` requerido:** sin él el contenedor no arranca (campo sin default).
- **R7 · Endurecer el ALB** a rangos de Meta (opcional).

## Entrega — infra a tocar (cuando se apruebe)

- ECR `velocidad-cesar-agent` · task def + service homónimos en `velocidad-ecs` · log group
  `/ecs/velocidad-cesar-agent` · (Etapa 2) ALB target group + listener/regla · ACM + DNS
  `cesar.velocidad.pompeyo.cl` · secret nuevo del agente · política IAM de ejecución scoped.
- **Sin cambio de código** en `agent/` (todo por env). Opcional: `ecs-task-def.json` + workflow CI.
- **Reconfig externa:** webhook de Meta (Etapa 2).

Comandos representativos (**NO EJECUTAR**): `aws ecr create-repository` · `docker build agent/ &&
push` · `aws ecs register-task-definition` · `aws ecs create-service --cluster velocidad-ecs …` ·
`aws logs create-log-group` · (Etapa 2) `aws elbv2 create-target-group/create-rule`.
