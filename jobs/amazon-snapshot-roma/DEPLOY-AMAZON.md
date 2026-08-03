# Deploy en Amazon (Camino B) — turnkey

Objetivo: dejar **operativo** el snapshot diario con disparo DENTRO de Amazon
(donde ya hay acceso a ROMA), reusando la misma red/credenciales que el gateway
`mcp-roma-server` (ELB `sa-east-1`).

```
ROMA (MySQL, VPC sa-east-1)
  ↑ MySQL 3306 (interno VPC — mismas creds que usa el gateway)
Job snapshot (Lambda/cron en Amazon)   ← se despliega esto
  ↓ HTTPS (vía NAT)
POST https://velocidadoperacional.pompeyo.cl/api/snapshots/daily  (Bearer)
  ↓
Velocidad (Railway) persiste — romaEnVivo: true
```

Estado: **FNE en vivo validado** (513 VIN/$8,4B; hoy 511/$8,36B). El job postea
solo `{ "roma": { "fne": {...} } }`; Provisiones queda en fuente validada hasta
confirmar su SQL (`PROVISIONES_ENABLED=1` después).

---

## Opción B1 — AWS Lambda (recomendada, serverless)

**1. Build & push de la imagen a ECR** (desde `jobs/amazon-snapshot-roma/`):
```bash
AWS_REGION=sa-east-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO=$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/snapshot-roma
aws ecr create-repository --repository-name snapshot-roma --region $AWS_REGION || true
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com
docker build -t snapshot-roma .
docker tag snapshot-roma:latest $REPO:latest
docker push $REPO:latest
```

**2. Crear la Lambda** (Package type = Image), en la **MISMA VPC/subnets/SG que
alcanza ROMA** (las que usa el gateway). Timeout 120s, memoria 256MB.
- **VPC:** subnets privadas con ruta a **NAT Gateway** (la Lambda debe salir a
  internet para el POST a Velocidad además de alcanzar ROMA por 3306).
- **Security Group:** egress a ROMA:3306 y a internet 443.
- **Rol de ejecución:** `AWSLambdaBasicExecutionRole` + `AWSLambdaVPCAccessExecutionRole`.

**3. Variables de entorno de la Lambda** (las de ROMA = las mismas del gateway;
idealmente desde Secrets Manager):
```
ROMA_DB_HOST, ROMA_DB_PORT=3306, ROMA_DB_USER, ROMA_DB_PASSWORD, ROMA_DB_NAME=roma
VELOCIDAD_URL=https://velocidadoperacional.pompeyo.cl
DAILY_SNAPSHOT_TOKEN=<mismo valor que el servicio web de Velocidad>
# PROVISIONES_ENABLED=0  (dejar 0 hasta confirmar SQL del reporte)
```

**4. EventBridge Scheduler — 20:00 hora Chile, todos los días:**
```bash
aws scheduler create-schedule --name snapshot-roma-2000 --region sa-east-1 \
  --schedule-expression "cron(0 20 * * ? *)" \
  --schedule-expression-timezone "America/Santiago" \
  --flexible-time-window '{"Mode":"OFF"}' \
  --target '{"Arn":"<LAMBDA_ARN>","RoleArn":"<SCHEDULER_ROLE_ARN>"}'
```
(El rol del Scheduler necesita `lambda:InvokeFunction` sobre la Lambda.)

**5. Probar manualmente:**
```bash
aws lambda invoke --function-name snapshot-roma --region sa-east-1 /dev/stdout
# esperar {"ok": true, "result": { ..., "romaEnVivo": true }}
```

---

## Opción B2 — cron en el host del gateway (si `mcp-roma-server` corre en EC2/ECS)
Si el gateway corre en un host administrable, agregar ahí un cron (ya tiene red a ROMA):
```bash
pip install -r requirements.txt
# /etc/cron.d/snapshot-roma  (host en TZ America/Santiago, o ajustar a UTC 23:00/00:00)
0 20 * * *  appuser  cd /opt/snapshot-roma && \
  ROMA_DB_HOST=... ROMA_DB_USER=... ROMA_DB_PASSWORD=... ROMA_DB_NAME=roma \
  VELOCIDAD_URL=https://velocidadoperacional.pompeyo.cl DAILY_SNAPSHOT_TOKEN=... \
  python3 snapshot_roma_job.py >> /var/log/snapshot_roma.log 2>&1
```

---

## Cutover · evitar doble disparo (OBLIGATORIO)
Hoy el snapshot lo dispara el **cron del agente César (Railway)** sin body
(snapshots Excel validados). Al activar Amazon:
1. Confirmar 1 corrida OK de la Lambda (`romaEnVivo: true`).
2. En Railway, servicio **`velocidad-agent`**: setear `DAILY_SNAPSHOT_TOKEN=""`
   (el job `snapshot_diario_capital` deja de registrarse → Amazon = único disparo).

## Validación post-deploy (desde Velocidad, read-only)
```bash
cd /Users/Daviid/velocidad
railway run --service Postgres sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npx tsx scripts/validate-snapshot-diario.ts'
```
Confirmar en la fila del día: `FNE` = valor ROMA vivo del POST; `Provisiones` =
fuente validada; Caja/Stock/CP/Saldos sin cambios. La respuesta del POST trae
`romaEnVivo: true`.

## Cuando ROMA confirme el SQL de Provisiones
1. Completar `PROV_SQL` en `snapshot_roma_job.py` con la definición confirmada
   (ver `docs/roma-pregunta-provisiones-de-ingreso.md`).
2. Setear `PROVISIONES_ENABLED=1` en la Lambda. Provisiones pasa también a ROMA vivo.
