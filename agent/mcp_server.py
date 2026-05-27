"""
MCP Server de Velocidad — expone las mismas herramientas del agente para
Claude Desktop u otros clientes MCP.

Ejecutar standalone:
    cd agent && python mcp_server.py

O como módulo:
    python -m agent.mcp_server
"""
from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from . import tools as t

mcp = FastMCP(
    "velocidad-tools",
    instructions=(
        "Herramientas de gestión de stock Pompeyo Carrasco. "
        "El parámetro 'telefono' identifica al usuario (formato +56912345678)."
    ),
)


@mcp.tool()
async def get_briefing(telefono: str) -> str:
    """Briefing diario del usuario: casos activos, vencimientos y alarmas."""
    return await t.briefing_diario(telefono)


@mcp.tool()
async def get_detalle_vin(vin: str, telefono: str) -> str:
    """Ficha completa de un VIN: estado, prioridad, comentarios e historial."""
    return await t.detalle_vin(vin, telefono)


@mcp.tool()
async def actualizar_estado(vin: str, nuevo_estado: str, telefono: str) -> str:
    """Cambia el estadoGestion. Válidos: ABIERTO EN_CURSO ESPERANDO RESUELTO CANCELADO."""
    return await t.actualizar_estado(vin, nuevo_estado, telefono)


@mcp.tool()
async def cambiar_prioridad(vin: str, nueva_prioridad: str, telefono: str) -> str:
    """Cambia la prioridad. Válidas: BAJA MEDIA ALTA CRITICA."""
    return await t.cambiar_prioridad(vin, nueva_prioridad, telefono)


@mcp.tool()
async def reasignar_caso(vin: str, nuevo_responsable: str, telefono: str) -> str:
    """Reasigna el responsable de un caso VIN."""
    return await t.reasignar_caso(vin, nuevo_responsable, telefono)


@mcp.tool()
async def agregar_comentario(vin: str, texto: str, telefono: str) -> str:
    """Agrega un comentario al historial del VIN."""
    return await t.agregar_comentario(vin, texto, telefono)


@mcp.tool()
async def set_proxima_accion(vin: str, accion: str, telefono: str) -> str:
    """Define la próxima acción concreta para un VIN."""
    return await t.set_proxima_accion(vin, accion, telefono)


@mcp.tool()
async def get_alarmas(telefono: str) -> str:
    """Casos urgentes: fechas vencidas, prioridad CRÍTICA y sin movimiento 7+ días."""
    return await t.get_alarmas(telefono)


if __name__ == "__main__":
    mcp.run()
