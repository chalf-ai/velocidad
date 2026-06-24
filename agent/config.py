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
    tareas_whatsapp_enabled: bool = False  # master switch del poller (= WHATSAPP_ENABLED)
    tareas_dry_run: bool = True            # True = loguea qué enviaría; NO llama Meta, NO marca enviada (= WHATSAPP_DRY_RUN)
    tareas_whatsapp_piloto: str = ""       # allowlist CSV de emails del ASIGNADO (vacía = no procesa nada)
    tareas_poll_seconds: int = 60          # cadencia del poller
    tareas_desde: str = ""                 # ISO datetime · solo alertas creadas después; vacío = arranque del proceso

    # F2 · Envío real vía Meta WhatsApp Cloud API (plantilla + estados de entrega).
    # El envío proactivo FUERA de la ventana de 24h exige una plantilla aprobada.
    # El comportamiento ENABLED/DRY_RUN lo dan los dos flags de arriba (reusados,
    # no se crea un set nuevo): enabled=0 → no envía; enabled=1+dry_run=1 → simula;
    # enabled=1+dry_run=0 → envía real con la plantilla.
    graph_api_version: str = "v23.0"                                 # versión de la Graph API
    whatsapp_business_account_id: str = ""                           # WABA ID (gestión/auditoría; el envío usa phone_number_id)
    whatsapp_template_name: str = "tarea_asignada"                   # nombre EXACTO de la plantilla aprobada en Meta
    whatsapp_template_lang: str = "es_CL"                            # idioma aprobado (fallback "es")
    app_public_url: str = "https://velocidadoperacional.pompeyo.cl"  # base para reconstruir el link ABSOLUTO del caso

    # Snapshot diario de capital (Tendencias persistentes)
    # El job NO calcula nada ni lee Excel: llama al endpoint Next.js, que toma
    # la foto del estado vigente con los selectores TS del sistema.
    app_base_url: str = "http://localhost:3000"  # URL del servicio web Next.js
    daily_snapshot_token: str = ""               # Bearer de /api/snapshots/daily; vacío = job deshabilitado
    snapshot_hora: str = "20:00"                 # HH:MM, hora Chile — todos los días

    # Gateway ROMA Amazon (Camino A) — el agente consulta FNE en vivo vía el
    # MISMO gateway que usa el MCP `roma-db` (ROMA se consulta DENTRO de Amazon).
    # Vacío → no se llama al gateway; el snapshot usa la fuente validada (sin
    # override FNE). El api key NUNCA se imprime en logs.
    roma_gateway_url: str = ""                    # /mcp/ del gateway (con slash final; evita el 307)
    roma_gateway_api_key: str = ""               # X-API-Key del gateway (mismo del MCP roma-db)

    # Provisiones de Ingreso EN VIVO desde ROMA (Camino A) — gate independiente
    # del de FNE. Default OFF: el código queda en su sitio pero el cron NO llama
    # al gateway de provisiones hasta poner PROVISIONES_ENABLED=1. Con OFF, las
    # Provisiones del snapshot siguen saliendo de la fuente validada (fallback).
    # Fórmula y cuadre: docs/roma-provisiones-de-ingreso-fuente-oficial.md.
    provisiones_enabled: bool = False
    # Provisiones DETALLE en vivo: trae la LISTA COMPLETA de provisiones desde ROMA
    # y la postea a /api/snapshots/provisiones-roma, que reemplaza la fuente
    # PROVISIONES (Excel) por ROMA → el detalle /provisiones se actualiza solo.
    # OFF por defecto. Requiere además PROVISIONES_ROMA_ENABLED=1 en el web.
    provisiones_detalle_enabled: bool = False

    model_config = {"env_file": ".env", "extra": "ignore"}

    @property
    def asyncpg_url(self) -> str:
        # asyncpg no acepta 'postgres://', solo 'postgresql://'
        return self.database_url.replace("postgres://", "postgresql://", 1)


settings = Settings()
