#!/bin/bash
# ============================================
# deploy.sh — Deploy manual de velocidad a AWS
# Uso: bash deploy.sh
# ============================================
set -e

REGION="sa-east-1"
ECR_REPO="145175805451.dkr.ecr.sa-east-1.amazonaws.com/velocidad"
ECS_CLUSTER="velocidad-ecs"
ECS_SERVICE="velocidad-svc"
DB_URL="postgresql://velocidad_admin:Y8lu5A0pNt2J8WlahVSVOCUaL7AKdMxD@velocidad-pg-cluster.cluster-ch868mw0uxec.sa-east-1.rds.amazonaws.com:5432/velocidad"

echo "🔐 Login ECR..."
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR_REPO

echo "🔨 Build imagen (amd64)..."
docker build --platform linux/amd64 \
  --build-arg DATABASE_URL="$DB_URL" \
  -t velocidad:latest \
  -t $ECR_REPO:latest \
  .

echo "📦 Push a ECR..."
docker push $ECR_REPO:latest

echo "🚀 Deploy en ECS..."
aws ecs update-service \
  --region $REGION \
  --cluster $ECS_CLUSTER \
  --service $ECS_SERVICE \
  --force-new-deployment \
  --query "service.{Name:serviceName,Status:status}" \
  --output table

echo ""
echo "✅ Deploy iniciado — tarda ~2 min"
echo "🌐 URL: http://velocidad.pompeyo.cl"
