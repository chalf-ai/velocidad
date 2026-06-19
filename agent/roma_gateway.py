"""
Cliente del gateway ROMA (Amazon) — consulta FNE operativo EN VIVO.

Camino A (aprobado 2026-06): ROMA se consulta DENTRO de Amazon, a través del
gateway `mcp-roma-server` (el MISMO que usa el MCP `roma-db`). El agente en
Railway solo llama por HTTP — NO se conecta a ROMA MySQL ni reconstruye ROMA.

Protocolo: MCP Streamable HTTP (SDK oficial `mcp`). Se invoca la tool
`query_roma_db` con el SQL de FNE y se parsea el resultado.

Regla de falla (estricta): si el gateway no está configurado, no responde, o la
respuesta no es parseable/positiva → se LEVANTA excepción. El caller NO inventa
FNE: cae a la fuente validada (snapshot activo). Nunca se imprime el API key.
"""
from __future__ import annotations

import json
import logging

from .config import settings

logger = logging.getLogger(__name__)

# FNE operativo (Reporte Actas) — validado EXACTO contra ROMA vivo.
# Acta Entrega = NO (EstadoActaEntregaID IN (0,1)) ∧ FechaFactura >= 2026-01-01.
FNE_SQL = (
    "SELECT COUNT(DISTINCT Vin) AS unidades, SUM(ValorFactura) AS monto "
    "FROM VT_Ventas "
    "WHERE EstadoActaEntregaID IN (0,1) AND FechaFactura >= '2026-01-01'"
)


async def consultar_fne_gateway() -> dict:
    """
    Devuelve {'unidades': int, 'monto': float} de FNE desde ROMA vía el gateway.
    Levanta excepción ante CUALQUIER problema (no configurado, error de red,
    respuesta vacía/no parseable/no positiva). NUNCA inventa datos.
    """
    url = settings.roma_gateway_url
    key = settings.roma_gateway_api_key
    if not url or not key:
        raise RuntimeError("Gateway ROMA no configurado (ROMA_GATEWAY_URL / ROMA_GATEWAY_API_KEY)")

    # Import perezoso: solo se exige el SDK si el gateway está configurado.
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    async with streamablehttp_client(url, headers={"X-API-Key": key}) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            res = await session.call_tool("query_roma_db", {"query": FNE_SQL})

    if getattr(res, "isError", False) or not res.content:
        raise RuntimeError("Gateway ROMA: respuesta de error o vacía")

    texto = getattr(res.content[0], "text", None)
    if not texto:
        raise RuntimeError("Gateway ROMA: sin contenido de texto")

    data = json.loads(texto)
    if not data.get("success") or not data.get("rows"):
        raise RuntimeError(f"Gateway ROMA: query sin filas ({str(data)[:120]})")

    row = data["rows"][0]
    unidades = int(row["unidades"])
    monto = float(row["monto"])
    if unidades <= 0 or monto <= 0:
        raise RuntimeError("Gateway ROMA: FNE no positivo — descartado")

    return {"unidades": unidades, "monto": monto}
