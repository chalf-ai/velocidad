# Imagen contenedor para AWS Lambda (o ECS) — Job snapshot diario ROMA→Velocidad.
# Build & push a ECR, luego crear Lambda (Package type = Image) en sa-east-1,
# en la VPC que alcanza ROMA. Ver DEPLOY-AMAZON.md.
FROM public.ecr.aws/lambda/python:3.12

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY snapshot_roma_job.py ./

# Entrypoint Lambda: módulo.función
CMD ["snapshot_roma_job.lambda_handler"]
