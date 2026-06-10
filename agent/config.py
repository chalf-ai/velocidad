from __future__ import annotations
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Compartida con Next.js
    database_url: str

    # OpenAI
    openai_api_key: str

    # WhatsApp Cloud API (Meta)
    whatsapp_access_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_verify_token: str = "pompeyo_velocidad_2025"

    # Agente
    briefing_hora: str = "09:00"    # HH:MM, hora Chile — briefing matutino (todos)
    seguimiento_hora: str = "15:00" # HH:MM, hora Chile — seguimiento tarde (GERENTE + JEFE_MARCA)
    agent_port: int = 8000

    # F2 · Poller de tareas asignadas → WhatsApp (agent/tareas.py)
    # Primer deploy SIEMPRE con enabled=0 + dry_run=1. Activación real solo
    # con OK explícito y allowlist del piloto.
    tareas_whatsapp_enabled: bool = False  # master switch del poller
    tareas_dry_run: bool = True            # True = loguea qué enviaría; NO llama Meta, NO marca enviada
    tareas_whatsapp_piloto: str = ""       # allowlist CSV de emails del ASIGNADO (vacía = no procesa nada)
    tareas_poll_seconds: int = 60          # cadencia del poller
    tareas_desde: str = ""                 # ISO datetime · solo alertas creadas después; vacío = arranque del proceso

    model_config = {"env_file": ".env", "extra": "ignore"}

    @property
    def asyncpg_url(self) -> str:
        # asyncpg no acepta 'postgres://', solo 'postgresql://'
        return self.database_url.replace("postgres://", "postgresql://", 1)


settings = Settings()
