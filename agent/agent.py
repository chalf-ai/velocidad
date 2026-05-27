"""Agente LangGraph con GPT-4o — gestión de stock Pompeyo Carrasco."""
from __future__ import annotations

import logging

from langchain_core.messages import SystemMessage, trim_messages
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from .config import settings
from . import tools as t

logger = logging.getLogger(__name__)

# ── Tools LangGraph ───────────────────────────────────────────────────────────

@tool
async def get_briefing(telefono: str) -> str:
    """
    Muestra el briefing diario del usuario: casos activos, alertas de
    fecha compromiso vencida y VINs sin movimiento.
    Llamar al inicio de la conversación o cuando el usuario pide el resumen del día.
    """
    return await t.briefing_diario(telefono)


@tool
async def get_detalle_vin(vin: str, telefono: str) -> str:
    """Ficha completa de un VIN: estado, prioridad, responsable, comentario e historial."""
    return await t.detalle_vin(vin, telefono)


@tool
async def update_estado(vin: str, nuevo_estado: str, telefono: str) -> str:
    """
    Cambia el estadoGestion de un VIN.
    Estados válidos: ABIERTO, EN_CURSO, ESPERANDO, RESUELTO, CANCELADO.
    """
    return await t.actualizar_estado(vin, nuevo_estado, telefono)


@tool
async def update_prioridad(vin: str, nueva_prioridad: str, telefono: str) -> str:
    """
    Cambia la prioridad de un VIN.
    Prioridades válidas: BAJA, MEDIA, ALTA, CRITICA.
    """
    return await t.cambiar_prioridad(vin, nueva_prioridad, telefono)


@tool
async def reasignar(vin: str, nuevo_responsable: str, telefono: str) -> str:
    """Cambia el responsable de un caso VIN."""
    return await t.reasignar_caso(vin, nuevo_responsable, telefono)


@tool
async def guardar_comentario(vin: str, texto: str, telefono: str) -> str:
    """Guarda un comentario en el historial del VIN y actualiza el campo comentario."""
    return await t.agregar_comentario(vin, texto, telefono)


@tool
async def guardar_proxima_accion(vin: str, accion: str, telefono: str) -> str:
    """Define la próxima acción concreta para un VIN."""
    return await t.set_proxima_accion(vin, accion, telefono)


@tool
async def ver_alarmas(telefono: str) -> str:
    """Casos urgentes: fechas compromiso vencidas, prioridad CRÍTICA y sin movimiento +7 días."""
    return await t.get_alarmas(telefono)


@tool
async def analisis_capital(telefono: str) -> str:
    """
    Analiza la tendencia del capital de trabajo comparando los últimos snapshots
    históricos. Muestra si el stock, el capital invertido y los casos FNE están
    mejorando o empeorando en el tiempo. Ideal para responder '¿cómo vamos?',
    '¿estamos mejorando?', '¿cómo está el capital esta semana vs la anterior?'.
    """
    return await t.analisis_capital(telefono)


LANGCHAIN_TOOLS = [
    get_briefing,
    get_detalle_vin,
    update_estado,
    update_prioridad,
    reasignar,
    guardar_comentario,
    guardar_proxima_accion,
    ver_alarmas,
    analisis_capital,
]

# ── Prompt del sistema ────────────────────────────────────────────────────────

SYSTEM_PROMPT = """Eres el asistente de gestión de stock de *Pompeyo Carrasco*.
Ayudas a los ejecutivos de cuenta a gestionar sus casos de vehículos día a día por WhatsApp.

*Qué puedes hacer:*
• Briefing diario con casos pendientes y alertas
• Detalle completo de cualquier VIN
• Actualizar estados, prioridades, responsables y comentarios
• Mostrar alarmas urgentes
• Analizar tendencia del capital de trabajo en el tiempo (mejora/empeora)

*Instrucciones:*
- Siempre responde en español, de forma concisa y directa.
- Usa formato WhatsApp: *negrita* para títulos, _itálica_ para notas, listas con •
- Recuerdas el historial de esta conversación: úsalo para dar respuestas contextuales.
- Cuando el usuario mencione un VIN (17 caracteres aprox.), úsalo directamente.
- Para modificar datos, usa las herramientas disponibles — nunca inventes valores.
- Si el usuario pregunta cómo van los KPIs, el capital o la tendencia, usa analisis_capital.
- El parámetro 'telefono' siempre es el número del usuario actual que está escribiendo."""


# ── Preparación de mensajes (trimming para contexto largo) ───────────────────

def _prepare_messages(state: dict) -> list:
    """Mantiene las últimas 50 entradas + system prompt. Evita contexto infinito."""
    trimmed = trim_messages(
        state["messages"],
        max_tokens=50,
        strategy="last",
        token_counter=len,
        include_system=False,
        allow_partial=False,
        start_on="human",
    )
    return [SystemMessage(content=SYSTEM_PROMPT)] + trimmed


# ── Inicialización async del agente con checkpointer PostgreSQL ───────────────

_agent = None


async def get_agent():
    global _agent
    if _agent is not None:
        return _agent

    from psycopg_pool import AsyncConnectionPool
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

    pool = AsyncConnectionPool(
        conninfo=settings.database_url,
        max_size=5,
        kwargs={"autocommit": True, "prepare_threshold": 0},
        open=False,
    )
    await pool.open()

    checkpointer = AsyncPostgresSaver(pool)
    await checkpointer.setup()
    logger.info("Checkpointer PostgreSQL inicializado")

    model = ChatOpenAI(
        model="gpt-4o",
        api_key=settings.openai_api_key,
    )

    _agent = create_react_agent(
        model=model,
        tools=LANGCHAIN_TOOLS,
        checkpointer=checkpointer,
        state_modifier=_prepare_messages,
    )
    return _agent


async def chat(telefono: str, mensaje: str) -> str:
    """Procesa un mensaje y retorna la respuesta del agente."""
    agent = await get_agent()
    config = {"configurable": {"thread_id": telefono}}
    result = await agent.ainvoke(
        {"messages": [{"role": "user", "content": mensaje}]},
        config=config,
    )
    return result["messages"][-1].content
