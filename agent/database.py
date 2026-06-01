"""Capa de acceso a datos — asyncpg directo sobre el mismo PostgreSQL de Velocidad."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import asyncpg

from .config import settings

logger = logging.getLogger(__name__)

_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(settings.asyncpg_url, min_size=2, max_size=10)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


# ── Usuarios ──────────────────────────────────────────────────────────────────

async def get_user_by_phone(telefono: str) -> Optional[dict]:
    """Busca por teléfono normalizando el formato (con o sin +)."""
    pool = await get_pool()
    numero = telefono.lstrip("+").strip()
    logger.info("get_user_by_phone: raw=%r normalizado=%r", telefono, numero)
    row = await pool.fetchrow(
        """
        SELECT id, email, name, "marcas", rol
        FROM "User"
        WHERE TRIM(REPLACE(telefono, '+', '')) = $1
          AND activo = true
        """,
        numero,
    )
    logger.info("get_user_by_phone: resultado=%s", dict(row) if row else "NOT FOUND")
    return dict(row) if row else None


async def get_capital_breakdown(marcas: Optional[list[str]] = None) -> dict:
    """Capital desglosado por tipo desde el snapshot BASE_STOCK activo."""
    pool = await get_pool()
    marca_filter = "AND elem->>'marcaPompeyo' = ANY($1::text[])" if marcas else ""
    params = [marcas] if marcas else []

    def _safe_sum(condition: str) -> str:
        return (
            f"ROUND(COALESCE(SUM(CASE WHEN {condition} "
            f"AND (elem->'costoNeto') IS NOT NULL "
            f"AND (elem->>'costoNeto') NOT IN ('null','0','') "
            f"THEN (elem->>'costoNeto')::numeric ELSE 0 END), 0) / 1000000, 1)::float"
        )

    row = await pool.fetchrow(
        f"""
        SELECT
            COUNT(*)::int AS total_unidades,
            {_safe_sum("elem->>'tipoStock' IN ('Propio','FinPropio')")} AS capital_propio_mm,
            {_safe_sum("elem->>'tipoStock' = 'FloorPlan'")} AS capital_floorplan_mm,
            {_safe_sum("elem->>'tipoStock' = 'Financiado'")} AS capital_financiado_mm,
            {_safe_sum("(elem->>'esVPPComprometido') = 'true'")} AS capital_vpp_mm,
            {_safe_sum("(elem->>'diasStock') IS NOT NULL AND (elem->>'diasStock') != 'null' AND (elem->>'diasStock')::int >= 180")} AS capital_mas_180_mm,
            COUNT(CASE WHEN (elem->>'diasStock') IS NOT NULL AND (elem->>'diasStock') != 'null'
                        AND (elem->>'diasStock')::int >= 180 THEN 1 END)::int AS unidades_mas_180,
            COUNT(CASE WHEN (elem->>'pagado') = 'true'
                        AND (elem->>'diasStock') IS NOT NULL AND (elem->>'diasStock') != 'null'
                        AND (elem->>'diasStock')::int >= 60 THEN 1 END)::int AS pagados_sin_rotacion,
            COUNT(CASE WHEN (elem->>'esJudicial') = 'true' THEN 1 END)::int AS unidades_judicial,
            COUNT(CASE WHEN (elem->>'esStockB') = 'true' THEN 1 END)::int AS unidades_stock_b,
            COUNT(CASE WHEN (elem->>'esVPPComprometido') = 'true' THEN 1 END)::int AS unidades_vpp
        FROM "Snapshot",
             jsonb_array_elements(payload->'vehiculos') AS elem
        WHERE fuente = 'BASE_STOCK' AND activo = true
          {marca_filter}
        """,
        *params,
    )
    return dict(row) if row else {}


async def get_alertas_stock(marcas: Optional[list[str]] = None) -> list[dict]:
    """VINs con alertas operacionales: >180d, pagados >60d, judicial, StockB."""
    pool = await get_pool()
    marca_filter = "AND elem->>'marcaPompeyo' = ANY($1::text[])" if marcas else ""
    params = [marcas] if marcas else []

    rows = await pool.fetch(
        f"""
        SELECT
            elem->>'vin'            AS vin,
            elem->>'marcaPompeyo'   AS marca,
            elem->>'modelo'         AS modelo,
            CASE WHEN (elem->>'diasStock') IS NOT NULL AND (elem->>'diasStock') != 'null'
                 THEN (elem->>'diasStock')::int ELSE 0 END AS dias_stock,
            elem->>'tipoStock'      AS tipo_stock,
            CASE WHEN (elem->'costoNeto') IS NOT NULL AND (elem->>'costoNeto') NOT IN ('null','0','')
                 THEN ROUND((elem->>'costoNeto')::numeric / 1000000, 1)::float ELSE 0 END AS costo_mm,
            (elem->>'esJudicial') = 'true'         AS judicial,
            (elem->>'esStockB') = 'true'           AS stock_b,
            (elem->>'esVPPComprometido') = 'true'  AS vpp,
            (elem->>'pagado') = 'true'             AS pagado
        FROM "Snapshot",
             jsonb_array_elements(payload->'vehiculos') AS elem
        WHERE fuente = 'BASE_STOCK' AND activo = true
          {marca_filter}
          AND (
            ((elem->>'diasStock') IS NOT NULL AND (elem->>'diasStock') != 'null' AND (elem->>'diasStock')::int >= 180)
            OR ((elem->>'pagado') = 'true' AND (elem->>'diasStock') IS NOT NULL AND (elem->>'diasStock') != 'null' AND (elem->>'diasStock')::int >= 60)
            OR (elem->>'esJudicial') = 'true'
            OR (elem->>'esStockB') = 'true'
          )
        ORDER BY dias_stock DESC
        LIMIT 100
        """,
        *params,
    )
    return [dict(r) for r in rows]


async def get_fne_resumen() -> dict:
    """Resumen FNE: total, detenidos >15d, aging buckets."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT
            COUNT(*)::int AS total_fne,
            COUNT(CASE WHEN (elem->>'agingBucket') = '0-3'  THEN 1 END)::int AS bucket_0_3,
            COUNT(CASE WHEN (elem->>'agingBucket') = '4-7'  THEN 1 END)::int AS bucket_4_7,
            COUNT(CASE WHEN (elem->>'agingBucket') = '8-15' THEN 1 END)::int AS bucket_8_15,
            COUNT(CASE WHEN (elem->>'agingBucket') = '16+'  THEN 1 END)::int AS bucket_16_mas,
            COUNT(CASE WHEN (elem->>'diasDesdeVenta') IS NOT NULL
                        AND (elem->>'diasDesdeVenta') != 'null'
                        AND (elem->>'diasDesdeVenta')::int > 15 THEN 1 END)::int AS detenidos_mas_15,
            ROUND(COALESCE(SUM(
                CASE WHEN (elem->>'diasDesdeVenta') IS NOT NULL
                          AND (elem->>'diasDesdeVenta') != 'null'
                          AND (elem->>'diasDesdeVenta')::int > 15
                          AND (elem->>'valorFactura') IS NOT NULL
                          AND (elem->>'valorFactura') NOT IN ('null','0','')
                THEN (elem->>'valorFactura')::numeric ELSE 0 END
            ), 0) / 1000000, 1)::float AS capital_detenido_mm
        FROM "Snapshot",
             jsonb_array_elements(payload->'registros') AS elem
        WHERE fuente = 'FNE' AND activo = true
        """,
    )
    return dict(row) if row else {}


async def get_lineas_credito_resumen(marcas: Optional[list[str]] = None) -> list[dict]:
    """Líneas de crédito por marca desde el snapshot BASE_STOCK activo."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT
            elem->>'marca' AS marca,
            CASE WHEN (elem->>'autorizado') IS NOT NULL AND (elem->>'autorizado') NOT IN ('null','0','')
                 THEN ROUND((elem->>'autorizado')::numeric / 1000000, 1)::float ELSE 0 END AS autorizado_mm,
            CASE WHEN (elem->>'ocupado') IS NOT NULL AND (elem->>'ocupado') NOT IN ('null','0','')
                 THEN ROUND((elem->>'ocupado')::numeric / 1000000, 1)::float ELSE 0 END AS ocupado_mm,
            CASE WHEN (elem->>'libre') IS NOT NULL AND (elem->>'libre') NOT IN ('null','0','')
                 THEN ROUND((elem->>'libre')::numeric / 1000000, 1)::float ELSE 0 END AS libre_mm,
            CASE WHEN (elem->>'porcentajeOcupacion') IS NOT NULL AND (elem->>'porcentajeOcupacion') != 'null'
                 THEN ROUND((elem->>'porcentajeOcupacion')::numeric, 1)::float ELSE 0 END AS pct_ocupacion,
            COALESCE(elem->>'semaforo', 'desconocido') AS semaforo
        FROM "Snapshot",
             jsonb_array_elements(payload->'lineas') AS elem
        WHERE fuente = 'BASE_STOCK' AND activo = true
          AND (elem->>'autorizado') IS NOT NULL
          AND (elem->>'autorizado') NOT IN ('null','0','')
        ORDER BY pct_ocupacion DESC
        """,
    )
    result = [dict(r) for r in rows]
    if marcas:
        result = [r for r in result if r.get("marca") in marcas]
    return result


async def get_all_stock_vins() -> list[dict]:
    """Todos los VINs del snapshot BASE_STOCK activo (sin filtro de marca — para ADMIN)."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT
            elem->>'vin'          AS vin,
            elem->>'marcaPompeyo' AS marca,
            elem->>'modelo'       AS modelo
        FROM "Snapshot",
             jsonb_array_elements(payload->'vehiculos') AS elem
        WHERE fuente = 'BASE_STOCK'
          AND activo  = true
          AND elem->>'vin' IS NOT NULL
          AND elem->>'vin' <> ''
        """,
    )
    return [dict(r) for r in rows]


async def get_all_active_users_with_phone() -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        'SELECT id, email, name, telefono, "marcas" FROM "User" WHERE telefono IS NOT NULL AND activo = true',
    )
    return [dict(r) for r in rows]


# ── Stock desde Snapshot ──────────────────────────────────────────────────────

async def get_vins_for_marcas(marcas: list[str]) -> list[dict]:
    """Retorna [{vin, marcaPompeyo, modelo}] del snapshot BASE_STOCK activo."""
    if not marcas:
        return []
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT
            elem->>'vin'          AS vin,
            elem->>'marcaPompeyo' AS marca,
            elem->>'modelo'       AS modelo
        FROM "Snapshot",
             jsonb_array_elements(payload->'vehiculos') AS elem
        WHERE fuente = 'BASE_STOCK'
          AND activo  = true
          AND elem->>'marcaPompeyo' = ANY($1::text[])
          AND elem->>'vin' IS NOT NULL
          AND elem->>'vin' <> ''
        """,
        marcas,
    )
    return [dict(r) for r in rows]


# ── GestionVIN ────────────────────────────────────────────────────────────────

async def get_gestiones_for_vins(vins: list[str]) -> list[dict]:
    if not vins:
        return []
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT id, vin, comentario, "proximaAccion", responsable, "responsableEmail",
               ownership, "fechaCompromiso", "estadoGestion", "prioridadManual",
               "createdAt", "updatedAt"
        FROM "GestionVIN"
        WHERE vin = ANY($1::text[])
        """,
        vins,
    )
    return [dict(r) for r in rows]


async def get_gestion_by_vin(vin: str) -> Optional[dict]:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT id, vin, comentario, "proximaAccion", responsable, "responsableEmail",
               ownership, "fechaCompromiso", "estadoGestion", "prioridadManual",
               "createdAt", "updatedAt"
        FROM "GestionVIN"
        WHERE vin = $1
        """,
        vin,
    )
    return dict(row) if row else None


CAMPOS_VALIDOS = {
    "comentario", "proximaAccion", "responsable", "responsableEmail",
    "ownership", "estadoGestion", "prioridadManual",
}
CAMPO_QUOTED = {c: f'"{c}"' for c in CAMPOS_VALIDOS}


async def upsert_gestion_field(
    vin: str,
    campo: str,
    valor: Any,
    usuario: str,
    user_email: str,
) -> bool:
    if campo not in CAMPOS_VALIDOS:
        return False

    pool = await get_pool()
    async with pool.acquire() as conn:
        # Obtener o crear la gestión
        gestion = await conn.fetchrow('SELECT id, $1 FROM "GestionVIN" WHERE vin = $2', campo, vin)
        if gestion is None:
            gestion_id = await conn.fetchval(
                """
                INSERT INTO "GestionVIN" (id, vin, "estadoGestion", "createdAt", "updatedAt")
                VALUES (gen_random_uuid()::text, $1, 'ABIERTO', NOW(), NOW())
                ON CONFLICT (vin) DO UPDATE SET "updatedAt" = NOW()
                RETURNING id
                """,
                vin,
            )
            valor_anterior = None
        else:
            gestion_id = gestion["id"]
            valor_anterior = str(gestion[campo]) if gestion[campo] is not None else None

        # Actualizar el campo
        await conn.execute(
            f'UPDATE "GestionVIN" SET {CAMPO_QUOTED[campo]} = $1, "updatedAt" = NOW() WHERE vin = $2',
            valor,
            vin,
        )

        # Registrar historial
        await conn.execute(
            """
            INSERT INTO "HistorialGestion"
              (id, "gestionId", campo, "valorAnterior", "valorNuevo", usuario, "userEmail", "createdAt")
            VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, NOW())
            """,
            gestion_id,
            campo,
            valor_anterior,
            str(valor) if valor is not None else None,
            usuario,
            user_email,
        )

        # Purgar historial > 50 entradas
        await conn.execute(
            """
            DELETE FROM "HistorialGestion"
            WHERE "gestionId" = $1
              AND id NOT IN (
                SELECT id FROM "HistorialGestion"
                WHERE "gestionId" = $1
                ORDER BY "createdAt" DESC
                LIMIT 50
              )
            """,
            gestion_id,
        )

    return True


async def add_comentario_historial(
    vin: str,
    texto: str,
    usuario: str,
    user_email: str,
) -> bool:
    pool = await get_pool()
    gestion_id = await pool.fetchval('SELECT id FROM "GestionVIN" WHERE vin = $1', vin)
    if gestion_id is None:
        return False
    await pool.execute(
        """
        INSERT INTO "HistorialGestion"
          (id, "gestionId", campo, "valorNuevo", usuario, "userEmail", "createdAt")
        VALUES (gen_random_uuid()::text, $1, 'comentario_agente', $2, $3, $4, NOW())
        """,
        gestion_id,
        texto,
        usuario,
        user_email,
    )
    return True


async def get_historial_vin(vin: str, limit: int = 5) -> list[dict]:
    pool = await get_pool()
    gestion_id = await pool.fetchval('SELECT id FROM "GestionVIN" WHERE vin = $1', vin)
    if gestion_id is None:
        return []
    rows = await pool.fetch(
        """
        SELECT campo, "valorAnterior", "valorNuevo", usuario, "createdAt"
        FROM "HistorialGestion"
        WHERE "gestionId" = $1
        ORDER BY "createdAt" DESC
        LIMIT $2
        """,
        gestion_id,
        limit,
    )
    return [dict(r) for r in rows]


# ── AlertaLog ─────────────────────────────────────────────────────────────────

async def create_alerta_log(
    user_id: str,
    tipo: str,
    mensaje: str,
    vin: Optional[str] = None,
) -> str:
    pool = await get_pool()
    alerta_id = await pool.fetchval(
        """
        INSERT INTO "AlertaLog"
          (id, "userId", tipo, vin, mensaje, enviado, "createdAt")
        VALUES (gen_random_uuid()::text, $1, $2::\"AlertaTipo\", $3, $4, false, NOW())
        RETURNING id
        """,
        user_id,
        tipo,
        vin,
        mensaje,
    )
    return alerta_id


async def get_snapshots_historicos(limit: int = 5) -> list[dict]:
    """Últimos N snapshots de BASE_STOCK con metadata (id, fecha, registros)."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT id, "fechaCorte", registros, "createdAt"
        FROM "Snapshot"
        WHERE fuente = 'BASE_STOCK'
        ORDER BY "createdAt" DESC
        LIMIT $1
        """,
        limit,
    )
    return [dict(r) for r in rows]


async def get_kpis_snapshot(snapshot_id: str, marcas: Optional[list[str]] = None) -> dict:
    """
    Extrae KPIs de un snapshot: total VINs, FloorPlan, Propio/Financiado,
    capital total (costoNeto en millones) y días promedio en stock.
    marcas=None → todos (para ADMIN).
    """
    pool = await get_pool()

    marca_filter = "AND elem->>'marcaPompeyo' = ANY($2::text[])" if marcas else ""
    params = [snapshot_id] + ([marcas] if marcas else [])

    row = await pool.fetchrow(
        f"""
        SELECT
            COUNT(*)::int                                                   AS total,
            COUNT(*) FILTER (WHERE elem->>'tipoStock' = 'FloorPlan')::int   AS floor_plan,
            COUNT(*) FILTER (WHERE elem->>'tipoStock' IN ('Propio','Financiado','FinPropio'))::int AS propio_fin,
            ROUND(COALESCE(SUM(
                CASE WHEN (elem->'costoNeto') IS NOT NULL
                          AND (elem->'costoNeto')::text NOT IN ('null','0','')
                THEN (elem->>'costoNeto')::numeric ELSE 0 END
            ), 0) / 1000000, 1)::float                                     AS capital_mm
        FROM "Snapshot",
             jsonb_array_elements(payload->'vehiculos') AS elem
        WHERE id = $1
          {marca_filter}
        """,
        *params,
    )
    return dict(row) if row else {"total": 0, "floor_plan": 0, "propio_fin": 0, "capital_mm": 0.0}


async def get_fne_count_snapshot(snapshot_id_fne: str, marcas: Optional[list[str]] = None) -> int:
    """Cuenta registros FNE (facturados no entregados) de un snapshot FNE."""
    pool = await get_pool()
    marca_filter = "AND elem->>'marcaPompeyo' = ANY($2::text[])" if marcas else ""
    params = [snapshot_id_fne] + ([marcas] if marcas else [])
    count = await pool.fetchval(
        f"""
        SELECT COUNT(*)::int
        FROM "Snapshot",
             jsonb_array_elements(payload->'registros') AS elem
        WHERE id = $1
          {marca_filter}
        """,
        *params,
    )
    return count or 0


async def mark_alerta_sent(
    alerta_id: str,
    wa_msg_id: Optional[str] = None,
    error_msg: Optional[str] = None,
) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        UPDATE "AlertaLog"
        SET enviado = $2, "waMsgId" = $3, "errorMsg" = $4
        WHERE id = $1
        """,
        alerta_id,
        error_msg is None,
        wa_msg_id,
        error_msg,
    )
