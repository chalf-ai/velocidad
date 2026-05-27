from __future__ import annotations
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Compartida con Next.js
    database_url: str

    # OpenAI
    openai_api_key: str

    # WhatsApp Cloud API (Meta)
    whatsapp_access_token: str
    whatsapp_phone_number_id: str
    whatsapp_verify_token: str = "pompeyo_velocidad_2025"

    # Agente
    briefing_hora: str = "08:00"   # HH:MM, hora Chile (America/Santiago)
    agent_port: int = 8000

    model_config = {"env_file": ".env", "extra": "ignore"}

    @property
    def asyncpg_url(self) -> str:
        # asyncpg no acepta 'postgres://', solo 'postgresql://'
        return self.database_url.replace("postgres://", "postgresql://", 1)


settings = Settings()
