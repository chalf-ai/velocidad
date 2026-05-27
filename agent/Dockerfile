FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia los archivos del agente dentro del paquete /app/agent/
# (Railway usa agent/ como root dir, así que "." son los archivos de agent/)
RUN mkdir -p agent
COPY . ./agent/

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

EXPOSE 8000

CMD ["uvicorn", "agent.webhook:app", "--host", "0.0.0.0", "--port", "8000"]
