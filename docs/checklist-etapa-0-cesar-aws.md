# Checklist operativo — Etapa 0 (César en AWS)

> **NO EJECUTAR TODAVÍA.** Este checklist se ejecuta **solo con aprobación explícita de David**.
> Etapa 0 = levantar el agente en AWS en modo totalmente inerte y validar conectividad.
> Detalle completo del proyecto en `plan-cesar-aws-opcion-b.md`.

## Reglas de Etapa 0 (límites duros)

- ✅ Servicio AWS arriba (`velocidad-cesar-agent`, `desiredCount=1`).
- ✅ `TAREAS_WHATSAPP_ENABLED=0`
- ✅ `TAREAS_DRY_RUN=true`
- ✅ `DAILY_SNAPSHOT_TOKEN` **vacío** (job snapshot deshabilitado)
- ✅ `PROVISIONES_ENABLED=0`
- ✅ `WHATSAPP_ACCESS_TOKEN` **ausente** (sin token → ningún job programado puede llamar a Meta,
  ni siquiera briefing/seguimiento si caen en la ventana 09:00/15:00).
- ⛔ **Sin** webhook de Meta repuntado.
- ⛔ **Sin** detener Railway (sigue primario).
- ⛔ **Sin** ALB/DNS/cert público (validación por **ECS Exec**, no por endpoint público).
- ⛔ **Sin** enviar WhatsApp.
- ⛔ **Sin** marcar alertas (`enviado`/`waStatus` intactos).
- ⛔ **Sin** cambiar variables productivas (Railway / web app AWS).

## Prerequisito BLOQUEANTE (único condicionante de arranque)

- [ ] **`OPENAI_API_KEY` disponible como secret AWS.** Es campo **requerido sin default** en
      `agent/config.py` → **el contenedor no arranca sin él**. Es el **único bloqueante real** de
      Etapa 0. (Etapa 0 NO usa WhatsApp token; los demás secrets se agregan en etapas posteriores.)

## Setup de infra para levantar el servicio (one-time, no bloqueante per se)

- [ ] ECR `velocidad-cesar-agent` creado e imagen `agent/` pusheada (build sin secretos en capas).
- [ ] Descubrir subnets/SG de `velocidad-svc`:
      `aws ecs describe-services --cluster velocidad-ecs --services velocidad-svc --query 'services[0].networkConfiguration'`
- [ ] Task def `velocidad-cesar-agent` con: `DATABASE_URL`←`velocidad/db-Xpuuon`, `OPENAI_API_KEY`←secret,
      `APP_PUBLIC_URL`/`APP_BASE_URL=https://velocidad.pompeyo.cl`, flags de la tabla de arriba,
      `enableExecuteCommand=true`, logs → `/ecs/velocidad-cesar-agent`, **mismo SG** que `velocidad-svc`.

## Verificación documental OPCIONAL (no bloqueante)

- [ ] Confirmar host sanitizado de `velocidad/db-Xpuuon` (cierra el gap del diagnóstico) — usuario con
      permisos AWS. **No bloquea Etapa 0:** el agente reusa **el mismo secret que el web app prod**, así
      que apunta a la **misma DB** aunque no leamos el host literal. Es verificación de respaldo, no
      condición de arranque.

## Pasos de validación (read-only, cero efectos)

1. [ ] `aws ecs create-service --cluster velocidad-ecs --service-name velocidad-cesar-agent
       --task-definition velocidad-cesar-agent --desired-count 1 --enable-execute-command
       --network-configuration '...subnets+SG de velocidad-svc...'` (sin load balancer).
2. [ ] Esperar estabilidad: `aws ecs wait services-stable --cluster velocidad-ecs --services velocidad-cesar-agent`.
3. [ ] **Logs de arranque** (CloudWatch `/ecs/velocidad-cesar-agent`): confirmar que conectó a la
       **DB de AWS** (pool asyncpg OK) y que NO hay errores de migración/credenciales.
4. [ ] **`/health` por ECS Exec** (sin endpoint público):
       `aws ecs execute-command --cluster velocidad-ecs --task <id> --container <c> --interactive
       --command "curl -s localhost:8000/health"` → espera `200/ok`.
5. [ ] **Conteo de pendientes SANITIZADO** (solo agregados, **sin** la lista "últimas 10" que trae PII):
       por ECS Exec `curl -s localhost:8000/debug/tareas` y leer **solo** el bloque de conteos
       agrupados (`canal/enviado/waStatus → count`). Anotar cuántas `TAREA_ASIGNADA` pendientes hay
       en la DB de AWS (insumo para decidir el backlog en R3).
       - Alternativa 100% sin PII: query agregada directa
         `SELECT canal, enviado, "waStatus", count(*) FROM "AlertaLog" WHERE tipo='TAREA_ASIGNADA' GROUP BY 1,2,3;`
6. [ ] Confirmar en logs que el **poller NO procesó nada** (`enabled=0` → no-op) y que **no se llamó
       a Meta** (sin token). `enviado`/`waStatus` de las alertas siguen igual.
7. [ ] (Opcional) `GET /debug/tareas/ciclo` por ECS Exec: con `enabled=0`+`dry_run=1` debe devolver
       `0 enviadas` y no llamar a Meta. Si se prefiere cero riesgo, **omitir** este paso en Etapa 0.

## Criterio de éxito de Etapa 0

- `/health` responde OK desde dentro de la VPC.
- El agente AWS conecta a la **DB de prod AWS** (misma de `velocidad-svc`).
- Se obtiene el **conteo de alertas pendientes** (sanitizado) → dimensiona el backlog (R3).
- **Cero** WhatsApps, **cero** escrituras, **cero** cambios en Railway/Meta/variables productivas.

## Salida de Etapa 0

- Dejar el servicio en `desiredCount=0` (apagado) **o** mantenerlo inerte (`enabled=0`/`dry_run=1`)
  según decida David. Nada avanza a Etapa 1 sin nueva aprobación.

## Rollback de Etapa 0

- `aws ecs update-service --cluster velocidad-ecs --service velocidad-cesar-agent --desired-count 0`
  (o eliminar el service). Railway intacto. Sin datos tocados.
