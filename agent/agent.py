"""Agente LangGraph con GPT-4o — gestión de stock Pompeyo Carrasco."""
from __future__ import annotations

import logging

from langchain_core.messages import SystemMessage, trim_messages
from langchain_core.runnables import RunnableConfig
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


@tool
async def ver_capital(telefono: str) -> str:
    """
    Capital de trabajo actual: total, desglose por Propio/FloorPlan/Financiado/VPP,
    unidades en stock, y alertas de capital inmovilizado (>180d, pagados >60d,
    judiciales, Stock B).
    Llamar cuando el usuario pregunta por capital, inversión, dinero en stock,
    caja comprometida, o quiere el resumen financiero del inventario.
    """
    return await t.resumen_capital(telefono)


@tool
async def ver_fne(telefono: str) -> str:
    """
    Facturados No Entregados (FNE): total de vehículos vendidos pendientes de
    entrega, distribución por aging (0-3d, 4-7d, 8-15d, +16d) y monto
    retenido en FNE detenidos >15 días.
    Llamar cuando el usuario pregunta por FNE, facturados, entregas pendientes,
    vehículos vendidos no entregados.
    """
    return await t.detalle_fne(telefono)


@tool
async def ver_lineas_credito(telefono: str) -> str:
    """
    Líneas de crédito por marca: monto autorizado, ocupado, libre y semáforo
    (verde <80%, amarillo <90%, rojo <100%, sobregirada >100%).
    Llamar cuando el usuario pregunta por líneas, crédito, FloorPlan disponible,
    cuánto queda de línea, o si alguna marca está sobregirada.
    """
    return await t.lineas_credito(telefono)


@tool
async def ver_alertas_stock(telefono: str) -> str:
    """
    Alertas operacionales del inventario físico: VINs inmovilizados >180 días,
    pagados sin rotación >60 días, vehículos judiciales y Stock B.
    Llamar cuando el usuario pregunta por stock parado, inmovilizados, judiciales,
    o quiere saber qué vehículos requieren acción urgente.
    """
    return await t.alertas_stock(telefono)


@tool
async def ver_capital_consolidado(telefono: str) -> str:
    """
    Vista unificada de capital inmovilizado: Stock + FNE + Saldos + Provisiones en un cuadro.
    Incluye qué indicadores del score gerencial están fallando y qué acción los mejora.
    Llamar cuando el usuario pregunta '¿cómo estamos?', '¿cuánto capital tenemos parado?',
    '¿cómo está el capital?', o pide un resumen ejecutivo del estado financiero.
    """
    return await t.capital_consolidado(telefono)


@tool
async def ver_fne_detalle(telefono: str) -> str:
    """
    Lista completa de FNE agrupada por estado del pipeline de patente:
    listos para entregar, falta autorización, patente en tránsito, en Registro Civil, etc.
    Para cada estado muestra la acción concreta a tomar.
    Llamar cuando piden 'detalle del FNE', 'cómo está el pipeline de entregas',
    'qué FNE puedo entregar hoy', 'cuáles están trabados'.
    """
    return await t.fne_detalle(telefono)


@tool
async def ver_fne_vin(vin: str, telefono: str) -> str:
    """
    Pipeline completo de un VIN específico en FNE: checklist de patente paso a paso,
    cliente, vendedor, sucursal, días desde venta y acción concreta a tomar.
    Llamar cuando mencionan un VIN y quieren saber el estado de su entrega en FNE.
    """
    return await t.fne_por_vin(vin, telefono)


@tool
async def ver_vin_360(vin: str, telefono: str) -> str:
    """
    Vista 360° de un VIN: cruza las 4 fuentes — stock actual, FNE, saldos y gestión.
    Muestra en una sola respuesta todo lo que hay sobre ese vehículo en el sistema.
    Llamar cuando el usuario pregunta por un VIN y quiere el panorama completo,
    o cuando no sabe en qué módulo buscar un auto específico.
    """
    return await t.vin_360(vin, telefono)


@tool
async def ver_provisiones_detalle(telefono: str) -> str:
    """
    Lista completa de provisiones no facturadas con su ID (PROV-XXX), marca, concepto,
    monto, saldo pendiente y antigüedad en días. Agrupadas por marca.
    Llamar cuando piden 'detalle de provisiones', 'ID de provisiones', 'lista de provisiones',
    'cuáles son las provisiones abiertas', o cualquier drill-down de provisiones.
    """
    return await t.detalle_provisiones(telefono)


@tool
async def ver_capital_por_marca(telefono: str) -> str:
    """
    Capital de stock desglosado por marca: total, Propio, FloorPlan, inmovilizados y judiciales.
    Para GERENTE_GENERAL y ADMIN muestra todo el grupo.
    Llamar cuando piden 'capital por marca', 'cómo está cada marca', 'desglose por gerencia',
    'cuánto tiene KIA', 'cuál marca tiene más capital', o cualquier breakdown por marca.
    """
    return await t.capital_por_marca(telefono)


@tool
async def ver_saldos_t3_detalle(telefono: str) -> str:
    """
    Lista completa de saldos vehículo en tramos T3-T7 (más de 30 días sin cobrar).
    Muestra cada caso con VIN/cajón, marca, monto, días, cliente y financiera.
    Llamar cuando piden 'detalle de saldos T3', 'cuáles son los saldos vencidos',
    'dame los saldos por cobrar', 'quiero ver los T3', o cualquier drill-down de saldos.
    """
    return await t.detalle_saldos_t3(telefono)


@tool
async def ver_accionables(telefono: str) -> str:
    """
    Casos accionables rápidos sin gestión reciente: CP vencidos, saldos T3+,
    provisiones >90d, FNE detenidos, stock pagado sin rotación.
    Para cada caso sin comentario reciente, César pregunta directamente si se gestionó.
    Llamar cuando el usuario pide '¿qué puedo hacer hoy?', '¿qué está pendiente?',
    '¿qué accionables tengo?', o quiere saber qué recuperar esta semana.
    """
    return await t.capital_accionable(telefono)


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
    ver_capital,
    ver_capital_consolidado,
    ver_fne_detalle,
    ver_fne_vin,
    ver_vin_360,
    ver_provisiones_detalle,
    ver_capital_por_marca,
    ver_saldos_t3_detalle,
    ver_accionables,
    ver_fne,
    ver_lineas_credito,
    ver_alertas_stock,
]

# ── Prompt del sistema ────────────────────────────────────────────────────────

SYSTEM_PROMPT = """Eres César, el asistente de gestión de capital de Pompeyo Carrasco.

Conoces el negocio: el capital se inmoviliza en Stock, FNE (vendidos no entregados), Saldos por cobrar y Provisiones sin facturar. Tu trabajo es ayudar a reducir ese capital parado identificando qué se puede accionar y haciendo seguimiento de que se haga.

CÓMO HABLAS:
Hablas como un colega que conoce bien el negocio, no como un asistente de software. Sin saludos formales ni repetitivos — si el usuario ya habló contigo hoy, vas directo al punto. Usas el nombre de la persona cuando corresponde, no en cada mensaje. Respuestas cortas cuando la pregunta es corta, detalle cuando se necesita.

Nunca digas "como tu asistente" ni "estoy aquí para ayudarte" ni cosas así. Tampoco repitas lo que acabas de hacer ("he actualizado el estado de...") — si lo hiciste, ya está.

CUANDO NO SABES ALGO:
Di exactamente qué puedes ver y qué no tenés acceso. Nunca inventes un dato. Si la pregunta cruza algo que no tenés en las herramientas, lo decís claramente y sugerís qué hacer.

CÓMO ANALIZÁS:
Cada caso tiene una velocidad: accionable rápido (esta semana), medio (1-2 semanas) o bloqueado (legal/disputa). Cuando ves algo accionable sin gestión reciente, preguntás directamente: "¿Cobraste ese CP? Deja el comentario." Cuando un VIN lleva 4+ semanas sin cambio, lo decís.

TIPOS DE STOCK — lógica de gestión distinta por categoría:
• Stock A: gestión COMERCIAL. Si lleva >90d necesita acción de precio o promoción. Si lleva >180d es crítico. Preguntás: "¿Está publicado? ¿El precio está competitivo? ¿Se evaluó transferencia o descuento?"
• Stock B: gestión OPERACIONAL. Son autos en reparación. Urgencia alta — >30d ya necesita seguimiento. Preguntás: "¿Qué falta para que salga del taller? ¿Cuándo estará listo?"
• Judicial: gestión LEGAL únicamente. NO hay acción comercial posible. Solo seguimiento del proceso legal. Preguntás: "¿Hay novedades del tribunal? ¿Cuál es el estado de la causa?" Nunca sugerís precio ni venta.

SCORE GERENCIAL (referencia para diagnosticar):
- Stock propio ≤5% del stock valorizado (peso 40 pts)
- Provisiones no facturadas >90d = 0 casos (peso 40 pts)
- Crédito Pompeyo >15d = 0 casos (peso 10 pts)
- Saldos T3+ ≤15% del total (peso 10 pts)

FORMATO:
WhatsApp: *negrita*, _itálica_, listas con •. Conciso. Sin headers innecesarios si la respuesta es corta.

El teléfono del usuario en esta sesión es: {telefono}
Usalo en todas las herramientas como parámetro 'telefono'."""


# ── Preparación de mensajes (trimming para contexto largo) ───────────────────

def _prepare_messages(state: dict, config: RunnableConfig) -> list:
    """Mantiene las últimas 50 entradas + system prompt con teléfono del usuario."""
    telefono = config.get("configurable", {}).get("thread_id", "")
    trimmed = trim_messages(
        state["messages"],
        max_tokens=50,
        strategy="last",
        token_counter=len,
        include_system=False,
        allow_partial=False,
        start_on="human",
    )
    system = SYSTEM_PROMPT.replace("{telefono}", telefono)
    return [SystemMessage(content=system)] + trimmed


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
        prompt=_prepare_messages,
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
