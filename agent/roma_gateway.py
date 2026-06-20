"""
Cliente del gateway ROMA (Amazon) — consulta FNE y Provisiones EN VIVO.

Camino A (aprobado 2026-06): ROMA se consulta DENTRO de Amazon, a través del
gateway `mcp-roma-server` (el MISMO que usa el MCP `roma-db`). El agente en
Railway solo llama por HTTP — NO se conecta a ROMA MySQL ni reconstruye ROMA.

Protocolo: MCP Streamable HTTP (SDK oficial `mcp`). Se invoca la tool
`query_roma_db` con el SQL y se parsea el resultado.

Regla de falla (estricta): si el gateway no está configurado, no responde, o la
respuesta no es parseable/positiva → se LEVANTA excepción. El caller NO inventa
datos: cae a la fuente validada (snapshot activo). Nunca se imprime el API key.
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

# Provisiones de Ingreso — fórmula y universo OFICIALES, cuadrados AL PESO contra
# el export real de la pantalla "Gestión de Provisiones de Ingreso"
# (Registros-Provisiones-20-06-2026_129.xlsx, 2832/2832 filas).
# Detalle: docs/roma-provisiones-de-ingreso-fuente-oficial.md (§4, §11).
#
#   saldo = monto + (EstadoAjusteID=2 ? MontoAjuste : 0) − COALESCE(monto_factura,0)
#   universo = estado<>4 (no anulada) ∧ origen>0 (no legacy) ∧ fecha>='2024-06-01'
#   vigente  = saldo>0          |   >90 = vigente ∧ fecha <= hoy−90
#
# Cuadre de referencia (2026-06-20): vigentes 290 · $5.121.714.234 ·
#   >90 90 · $547.858.850 · Σ columna neta $5.076.055.956 · aging_max 497.
PROVISIONES_SQL = (
    "SELECT "
    "SUM(CASE WHEN p.sld>0 AND p.fecha<=CURDATE()-INTERVAL 90 DAY THEN 1 ELSE 0 END) AS mas90_unidades, "
    "SUM(CASE WHEN p.sld>0 AND p.fecha<=CURDATE()-INTERVAL 90 DAY THEN p.sld ELSE 0 END) AS mas90_monto, "
    "MAX(CASE WHEN p.sld>0 AND p.fecha<=CURDATE()-INTERVAL 90 DAY THEN DATEDIFF(CURDATE(),p.fecha) ELSE NULL END) AS aging_max, "
    "SUM(CASE WHEN p.sld>0 THEN 1 ELSE 0 END) AS vigentes_unidades, "
    "SUM(CASE WHEN p.sld>0 THEN p.sld ELSE 0 END) AS vigentes_monto, "
    "SUM(p.sld) AS saldo_neto "
    "FROM (SELECT fecha, "
    "  (monto + CASE WHEN EstadoAjusteID=2 THEN COALESCE(MontoAjuste,0) ELSE 0 END - COALESCE(monto_factura,0)) AS sld "
    "  FROM VT_Provisiones "
    "  WHERE estado<>4 AND origen>0 AND fecha>='2024-06-01') p"
)


async def _query_gateway(sql: str) -> list[dict]:
    """
    Ejecuta `sql` contra ROMA vía el gateway Amazon y devuelve las filas.
    Levanta excepción ante CUALQUIER problema (no configurado, error de red,
    respuesta vacía/no parseable). NUNCA imprime el API key.
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
            res = await session.call_tool("query_roma_db", {"query": sql})

    if getattr(res, "isError", False) or not res.content:
        raise RuntimeError("Gateway ROMA: respuesta de error o vacía")

    texto = getattr(res.content[0], "text", None)
    if not texto:
        raise RuntimeError("Gateway ROMA: sin contenido de texto")

    data = json.loads(texto)
    if not data.get("success") or not data.get("rows"):
        raise RuntimeError(f"Gateway ROMA: query sin filas ({str(data)[:120]})")

    return data["rows"]


async def consultar_fne_gateway() -> dict:
    """
    Devuelve {'unidades': int, 'monto': float} de FNE desde ROMA vía el gateway.
    Levanta excepción ante CUALQUIER problema. NUNCA inventa datos.
    """
    row = (await _query_gateway(FNE_SQL))[0]
    unidades = int(row["unidades"])
    monto = float(row["monto"])
    if unidades <= 0 or monto <= 0:
        raise RuntimeError("Gateway ROMA: FNE no positivo — descartado")
    return {"unidades": unidades, "monto": monto}


async def consultar_provisiones_gateway() -> dict:
    """
    Devuelve los KPIs de Provisiones de Ingreso desde ROMA vía el gateway:
        {
          'mas90_unidades': int, 'mas90_monto': float,   # KPI operativo (>90 días)
          'aging_max': int | None,                       # antigüedad máx (días) de vigentes >90
          'vigentes_unidades': int, 'vigentes_monto': float,  # total vigente (saldo>0)
          'saldo_neto': float,                           # Σ columna saldo (incl. negativos)
        }
    Fórmula/universo: ver PROVISIONES_SQL (cuadrado al peso vs export ROMA).
    Levanta excepción ante CUALQUIER problema o agregado no positivo. NUNCA inventa datos.
    """
    row = (await _query_gateway(PROVISIONES_SQL))[0]

    def _i(v) -> int:
        return int(v) if v is not None else 0

    def _f(v) -> float:
        return float(v) if v is not None else 0.0

    res = {
        "mas90_unidades": _i(row["mas90_unidades"]),
        "mas90_monto": _f(row["mas90_monto"]),
        "aging_max": _i(row["aging_max"]) if row.get("aging_max") is not None else None,
        "vigentes_unidades": _i(row["vigentes_unidades"]),
        "vigentes_monto": _f(row["vigentes_monto"]),
        "saldo_neto": _f(row["saldo_neto"]),
    }
    # Sanidad: el universo vigente no puede venir vacío/negativo. Si así fuera,
    # algo está mal en ROMA → preferimos el fallback antes que persistir basura.
    if res["vigentes_unidades"] <= 0 or res["vigentes_monto"] <= 0:
        raise RuntimeError("Gateway ROMA: Provisiones vigentes no positivas — descartado")
    return res
