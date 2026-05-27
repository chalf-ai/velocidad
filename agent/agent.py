"""Agente LangGraph con Claude — gestión de stock Pompeyo Carrasco."""
from __future__ import annotations

from langchain_anthropic import ChatAnthropic
from langchain_core.tools import tool
from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import create_react_agent

from .config import settings
from . import tools as t

# ── Definición de tools para LangGraph ───────────────────────────────────────

@tool
async def get_briefing(telefono: str) -> str:
    """
    Muestra el briefing diario del usuario: todos sus casos activos,
    alertas de fecha compromiso vencida y casos sin movimiento.
    Usar al inicio de la conversación o cuando el usuario pide el resumen del día.
    """
    return await t.briefing_diario(telefono)


@tool
async def get_detalle_vin(vin: str, telefono: str) -> str:
    """
    Muestra la ficha completa de un VIN: estado, prioridad, responsable,
    comentario, próxima acción e historial reciente.
    """
    return await t.detalle_vin(vin, telefono)


@tool
async def update_estado(vin: str, nuevo_estado: str, telefono: str) -> str:
    """
    Cambia el estado de gestión de un VIN.
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
    """
    Guarda un comentario o nota de contexto en el historial del VIN.
    También actualiza el campo 'comentario' del caso.
    """
    return await t.agregar_comentario(vin, texto, telefono)


@tool
async def guardar_proxima_accion(vin: str, accion: str, telefono: str) -> str:
    """Define la próxima acción concreta que se debe ejecutar para este VIN."""
    return await t.set_proxima_accion(vin, accion, telefono)


@tool
async def ver_alarmas(telefono: str) -> str:
    """
    Muestra los casos urgentes: fechas compromiso vencidas,
    prioridad CRÍTICA y VINs sin movimiento por 7+ días.
    """
    return await t.get_alarmas(telefono)


LANGCHAIN_TOOLS = [
    get_briefing,
    get_detalle_vin,
    update_estado,
    update_prioridad,
    reasignar,
    guardar_comentario,
    guardar_proxima_accion,
    ver_alarmas,
]

# ── Prompt del sistema ────────────────────────────────────────────────────────

SYSTEM_PROMPT = """Eres el asistente de gestión de stock de *Pompeyo Carrasco*.
Ayudas a los ejecutivos de cuenta a gestionar sus casos de vehículos día a día por WhatsApp.

*Qué puedes hacer:*
• Mostrar el briefing diario con los casos pendientes
• Ver el detalle completo de cualquier VIN
• Actualizar estados (ABIERTO, EN_CURSO, ESPERANDO, RESUELTO, CANCELADO)
• Cambiar prioridades (BAJA, MEDIA, ALTA, CRITICA)
• Guardar comentarios y próximas acciones
• Reasignar responsables
• Mostrar alarmas: vencimientos, prioridades críticas y sin movimiento

*Instrucciones:*
- Siempre responde en español, de forma concisa y directa.
- Usa formato WhatsApp: *negrita* para títulos, _itálica_ para notas, listas con •
- Cuando el usuario mencione un VIN (cadena de 17 caracteres o similar), úsalo directamente.
- Para modificar datos, usa las herramientas disponibles — nunca inventes valores.
- Si el usuario dice "mis casos", "el briefing" o "qué tengo hoy", llama a get_briefing.
- El parámetro 'telefono' siempre es el número del usuario actual que está escribiendo."""


# ── Instancia del agente ──────────────────────────────────────────────────────

_agent = None
_checkpointer = MemorySaver()


def get_agent():
    global _agent
    if _agent is None:
        model = ChatAnthropic(
            model="claude-sonnet-4-6",
            api_key=settings.anthropic_api_key,
            max_tokens=1024,
        )
        _agent = create_react_agent(
            model=model,
            tools=LANGCHAIN_TOOLS,
            checkpointer=_checkpointer,
            state_modifier=SYSTEM_PROMPT,
        )
    return _agent


async def chat(telefono: str, mensaje: str) -> str:
    """Procesa un mensaje entrante y retorna la respuesta del agente."""
    agent = get_agent()
    config = {"configurable": {"thread_id": telefono}}
    result = await agent.ainvoke(
        {"messages": [{"role": "user", "content": mensaje}]},
        config=config,
    )
    return result["messages"][-1].content
