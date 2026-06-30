# Runbook turnkey — Ejecución Etapa 0 (César en AWS)

> **Lo ejecuta quien tenga permisos** ECR/ECS/IAM-PassRole/logs (el mismo que creó el secret OpenAI).
> Modo **inerte**: cero envíos, cero escrituras, sin tocar Railway/Meta. Detalle conceptual en
> `plan-cesar-aws-opcion-b.md`; límites en `checklist-etapa-0-cesar-aws.md`.

## Prerequisitos

- [x] **Secret OpenAI creado:** `arn:aws:secretsmanager:sa-east-1:145175805451:secret:cesar-agent/openai-pxo9UU`
      (verificar que el sufijo aleatorio de 6 chars `-pxo9UU` coincide exactamente con el creado).
- [ ] **Exec role lee el secret OpenAI:** `pompeyo-dev-role-ecs-task-exec` con `secretsmanager:GetSecretValue`
      sobre ese ARN (ya lee `velocidad/db-Xpuuon`). **Sin esto el contenedor NO arranca.**
- [ ] **Permisos del operador:** `ecr:Create/Push`, `ecs:RegisterTaskDefinition/CreateService/ExecuteCommand/DescribeTasks`,
      `iam:PassRole` sobre `pompeyo-dev-role-ecs-task-exec` y `pompeyo-dev-role-ecs-task`, `logs:CreateLogGroup`.
- [ ] **(ECS Exec)** task role `pompeyo-dev-role-ecs-task` con SSM (`ssmmessages:*`). Si no, validar por
      CloudWatch + query agregada (ver Paso 5, fallback).

## Valores fijos (ya descubiertos, read-only)

| | |
|---|---|
| region / account | `sa-east-1` / `145175805451` |
| cluster | `velocidad-ecs` |
| red (clon de `velocidad-svc`) | FARGATE · subnets `subnet-035632b3f39a8fc8f`,`subnet-0351508ea727b4355` · SG `sg-06c6f53961f1b95d4` · `assignPublicIp=ENABLED` |
| roles | exec `pompeyo-dev-role-ecs-task-exec` · task `pompeyo-dev-role-ecs-task` |
| ECR (nuevo) | `velocidad-cesar-agent` |
| log group | `/ecs/velocidad-cesar-agent` |
| secret DB | `velocidad/db-Xpuuon` (key `DATABASE_URL`) |
| secret OpenAI | `cesar-agent/openai-pxo9UU` |

## Paso 1 — Build + push de la imagen

```bash
git clone https://github.com/chalf-ai/velocidad && cd velocidad
aws ecr create-repository --repository-name velocidad-cesar-agent --region sa-east-1
aws ecr get-login-password --region sa-east-1 \
  | docker login --username AWS --password-stdin 145175805451.dkr.ecr.sa-east-1.amazonaws.com
# ⚠️ Fargate = linux/amd64. Si se buildea en Mac ARM, --platform linux/amd64 es OBLIGATORIO.
docker build --platform linux/amd64 -f agent/Dockerfile -t velocidad-cesar-agent:etapa0 agent/
docker tag velocidad-cesar-agent:etapa0 \
  145175805451.dkr.ecr.sa-east-1.amazonaws.com/velocidad-cesar-agent:etapa0
docker push 145175805451.dkr.ecr.sa-east-1.amazonaws.com/velocidad-cesar-agent:etapa0
```
> Contexto de build = `agent/` (el Dockerfile asume `agent/` como root: `COPY . ./agent/`).

## Paso 2 — Log group

```bash
aws logs create-log-group --log-group-name /ecs/velocidad-cesar-agent --region sa-east-1
```

## Paso 3 — Task definition (inerte) → `cesar-agent-etapa0.taskdef.json`

```json
{
  "family": "velocidad-cesar-agent",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::145175805451:role/pompeyo-dev-role-ecs-task-exec",
  "taskRoleArn": "arn:aws:iam::145175805451:role/pompeyo-dev-role-ecs-task",
  "containerDefinitions": [
    {
      "name": "cesar-agent",
      "image": "145175805451.dkr.ecr.sa-east-1.amazonaws.com/velocidad-cesar-agent:etapa0",
      "essential": true,
      "portMappings": [{ "containerPort": 8000, "protocol": "tcp" }],
      "environment": [
        { "name": "APP_BASE_URL",            "value": "https://velocidad.pompeyo.cl" },
        { "name": "APP_PUBLIC_URL",          "value": "https://velocidad.pompeyo.cl" },
        { "name": "TAREAS_WHATSAPP_ENABLED", "value": "0" },
        { "name": "TAREAS_DRY_RUN",          "value": "true" },
        { "name": "PROVISIONES_ENABLED",     "value": "0" },
        { "name": "DAILY_SNAPSHOT_TOKEN",    "value": "" },
        { "name": "TAREAS_DESDE",            "value": "2026-06-10T23:50:09+00:00" },
        { "name": "TAREAS_POLL_SECONDS",     "value": "60" },
        { "name": "WHATSAPP_TEMPLATE_NAME",  "value": "nueva_gestion" },
        { "name": "WHATSAPP_TEMPLATE_LANG",  "value": "es_CL" },
        { "name": "AGENT_PORT",              "value": "8000" }
      ],
      "secrets": [
        { "name": "DATABASE_URL",   "valueFrom": "arn:aws:secretsmanager:sa-east-1:145175805451:secret:velocidad/db-Xpuuon:DATABASE_URL::" },
        { "name": "OPENAI_API_KEY", "valueFrom": "arn:aws:secretsmanager:sa-east-1:145175805451:secret:cesar-agent/openai-pxo9UU" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group":         "/ecs/velocidad-cesar-agent",
          "awslogs-region":        "sa-east-1",
          "awslogs-stream-prefix": "cesar"
        }
      }
    }
  ]
}
```

**Notas de seguridad inerte:**
- **Sin `WHATSAPP_ACCESS_TOKEN`** → ningún job puede llamar a Meta (cero envíos garantizado, aun si
  briefing 09:00 / seguimiento 15:00 caen en la ventana).
- `DAILY_SNAPSHOT_TOKEN` vacío → job snapshot **deshabilitado** (sin escrituras de snapshot).
- `PROVISIONES_ENABLED=0`, `TAREAS_WHATSAPP_ENABLED=0`, `TAREAS_DRY_RUN=true`.
- **Formato del secret OpenAI:** si lo crearon como **JSON con clave** (p.ej. `{"OPENAI_API_KEY":"…"}`),
  el `valueFrom` debe terminar en `:OPENAI_API_KEY::`. Si es **string plano**, el ARN directo (como arriba).

```bash
aws ecs register-task-definition --cli-input-json file://cesar-agent-etapa0.taskdef.json --region sa-east-1
```

## Paso 4 — Servicio (inerte, sin load balancer)

```bash
aws ecs create-service --cluster velocidad-ecs --service-name velocidad-cesar-agent \
  --task-definition velocidad-cesar-agent --desired-count 1 --launch-type FARGATE \
  --enable-execute-command \
  --network-configuration 'awsvpcConfiguration={subnets=[subnet-035632b3f39a8fc8f,subnet-0351508ea727b4355],securityGroups=[sg-06c6f53961f1b95d4],assignPublicIp=ENABLED}' \
  --region sa-east-1
aws ecs wait services-stable --cluster velocidad-ecs --services velocidad-cesar-agent --region sa-east-1
```

## Paso 5 — Validaciones (1–8)

```bash
# 1. Servicio estable
aws ecs describe-services --cluster velocidad-ecs --services velocidad-cesar-agent \
  --query 'services[0].{running:runningCount,rollout:deployments[0].rolloutState}' --output table --region sa-east-1

# 2/3/4. Arranque: conexión DB (asyncpg pool), scheduler start, sin errores
aws logs tail /ecs/velocidad-cesar-agent --since 10m --region sa-east-1 \
  | grep -iE "asyncpg|pool|scheduler|startup|Application startup|Uvicorn running|error|exception"

# 5. /health + conteo pendientes (ECS Exec)
TASK=$(aws ecs list-tasks --cluster velocidad-ecs --service-name velocidad-cesar-agent \
  --query 'taskArns[0]' --output text --region sa-east-1)
aws ecs execute-command --cluster velocidad-ecs --task "$TASK" --container cesar-agent \
  --interactive --command "curl -s localhost:8000/health" --region sa-east-1
aws ecs execute-command --cluster velocidad-ecs --task "$TASK" --container cesar-agent \
  --interactive --command "curl -s localhost:8000/debug/tareas" --region sa-east-1
#   → leer SOLO el bloque de conteos agrupados (canal/enviado/waStatus→count). NO la lista "últimas 10" (PII).
```

- **6. No-envío:** en logs, poller con `enabled=0` = no-op; sin token, ninguna llamada a Meta. Confirmar
  ausencia de `enviada`/`waMsgId`.
- **7. No-escritura:** `enviado`/`waStatus` de las alertas no cambian (dry-run no marca).
- **8. Railway intacto:** este runbook no lo toca.
- **Fallback si ECS Exec no está disponible** (task role sin SSM): validar arranque/DB por CloudWatch
  (Paso 5.2) y el conteo con query agregada directa **sin PII** (el operador ya tiene acceso a la DB):
  `SELECT canal, enviado, "waStatus", count(*) FROM "AlertaLog" WHERE tipo='TAREA_ASIGNADA' GROUP BY 1,2,3;`

## Criterio de éxito → autorizar Etapa 1

`/health` OK · conecta a la **DB prod AWS** · scheduler arranca limpio · **conteo de pendientes**
obtenido (sanitizado) · **cero** envíos · **cero** escrituras · **Railway intacto**.

## Rollback

```bash
aws ecs update-service --cluster velocidad-ecs --service velocidad-cesar-agent --desired-count 0 --region sa-east-1
# o eliminar por completo:
# aws ecs delete-service --cluster velocidad-ecs --service velocidad-cesar-agent --force --region sa-east-1
```
Railway intacto · sin datos tocados · no se avanza a Etapa 1 sin aprobación explícita.
