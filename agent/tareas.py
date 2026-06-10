"""
F2 · Poller de tareas asignadas → WhatsApp.

Flujo:
  TareaOperacional → AlertaLog(TAREA_ASIGNADA, enviado=false)  [creadas por Next.js]
  → este poller detecta pendientes → send_text → waMsgId + enviado=true.

Reglas (aprobadas):
  · Master switch TAREAS_WHATSAPP_ENABLED (default off).
  · DRY-RUN obligatorio primero: loguea qué enviaría — NO llama Meta,
    NO marca enviada.
  · Allowlist por email del asignado (TAREAS_WHATSAPP_PILOTO, CSV).
  · UN intento automático por alerta: si falla se guarda errorMsg y la
    alerta sale de la cola → fallback manual desde /notificaciones
    (copiar mensaje + marcar enviada). Sin reintentos en esta versión.
  · Solo alertas creadas DESPUÉS de la fecha de activación (TAREAS_DESDE,
    o el arranque del proceso si no está seteada) — el backlog histórico
    nunca se dispara solo.
  · No toca briefings ni seguimiento (jobs separados en cron.py).

Nota: AlertaLog NO tiene campo enviadaAt — no se modificó el schema
(regla 9). El timestamp del envío queda en los logs de Railway y la
trazabilidad en waMsgId.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from .config import settings
from . import database as db
from .whatsapp import send_text

logger = logging.getLogger(__name__)

# Fecha de activación por defecto: arranque del proceso. Si TAREAS_DESDE
# está seteada (ISO 8601), manda ella — sobrevive reinicios del servicio.
_DESDE_ARRANQUE = datetime.now(timezone.utc)

# Cap de envíos por ciclo — protege de backlogs y de la API de Meta.
MAX_POR_CICLO = 10


def fecha_desde() -> datetime:
    if settings.tareas_desde:
        d = datetime.fromisoformat(settings.tareas_desde)
        # Sin timezone explícita se asume UTC (asyncpg exige aware).
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    return _DESDE_ARRANQUE


def allowlist() -> list[str]:
    """Emails del piloto, normalizados. Vacía = el poller no procesa nada."""
    return [
        e.strip().lower()
        for e in settings.tareas_whatsapp_piloto.split(",")
        if e.strip()
    ]


async def procesar_tareas_asignadas() -> dict:
    """
    Un ciclo del poller. Retorna resumen (para logs y /debug/tareas/ciclo).
    Seguro de llamar siempre: cada guard corta sin tocar nada.
    """
    if not settings.tareas_whatsapp_enabled:
        return {"estado": "deshabilitado"}

    emails = allowlist()
    if not emails:
        logger.warning("Tareas F2: flag activo pero allowlist vacía — no se procesa nada")
        return {"estado": "allowlist_vacia"}

    pendientes = await db.get_tareas_pendientes_whatsapp(
        emails, fecha_desde(), limit=MAX_POR_CICLO
    )
    resumen: dict = {
        "estado": "ok",
        "dry_run": settings.tareas_dry_run,
        "pendientes": len(pendientes),
        "enviadas": 0,
        "errores": 0,
        "detalle": [],
    }

    for alerta in pendientes:
        if settings.tareas_dry_run:
            # DRY-RUN: solo log. NO llama Meta, NO marca enviada — la alerta
            # sigue pendiente y visible en /notificaciones para copia manual.
            logger.info(
                "DRY-RUN · ENVIARÍA tarea → %s (%s) · alerta=%s · %d chars",
                alerta["name"], alerta["telefono"], alerta["id"], len(alerta["mensaje"]),
            )
            resumen["detalle"].append(
                {"alerta": alerta["id"], "para": alerta["email"], "accion": "dry_run"}
            )
            continue

        try:
            resp = await send_text(alerta["telefono"], alerta["mensaje"])
            wa_msg_id = resp.get("messages", [{}])[0].get("id")
            await db.mark_alerta_sent(alerta["id"], wa_msg_id=wa_msg_id)
            resumen["enviadas"] += 1
            resumen["detalle"].append(
                {"alerta": alerta["id"], "para": alerta["email"], "accion": "enviada", "waMsgId": wa_msg_id}
            )
            logger.info(
                "Tarea enviada → %s (%s) · alerta=%s · waMsgId=%s",
                alerta["name"], alerta["telefono"], alerta["id"], wa_msg_id,
            )
        except Exception as e:
            # Un intento por alerta: errorMsg la saca de la cola para siempre.
            # Queda con badge Error en /notificaciones → copia manual.
            resumen["errores"] += 1
            err = f"{type(e).__name__}: {e}"[:500]
            logger.exception(
                "Error enviando tarea → %s · alerta=%s", alerta["telefono"], alerta["id"]
            )
            try:
                await db.mark_alerta_sent(alerta["id"], error_msg=err)
                resumen["detalle"].append(
                    {"alerta": alerta["id"], "para": alerta["email"], "accion": "error", "error": err}
                )
            except Exception:
                logger.exception("No se pudo registrar errorMsg en alerta=%s", alerta["id"])

    if pendientes:
        logger.info(
            "Ciclo tareas F2: %d pendientes · %d enviadas · %d errores · dry_run=%s",
            resumen["pendientes"], resumen["enviadas"], resumen["errores"], resumen["dry_run"],
        )
    return resumen


async def estado_tareas() -> dict:
    """Payload de /debug/tareas: flags + conteos de cola + últimas 10 alertas."""
    pool = await db.get_pool()
    counts = await pool.fetch(
        """
        SELECT canal, enviado,
               COUNT(*)          AS total,
               COUNT("errorMsg") AS con_error
        FROM "AlertaLog"
        WHERE tipo = 'TAREA_ASIGNADA'
        GROUP BY canal, enviado
        ORDER BY canal NULLS FIRST, enviado
        """
    )
    ultimas = await pool.fetch(
        """
        SELECT a.id, a.canal, a.enviado,
               a."errorMsg" IS NOT NULL AS con_error,
               a."waMsgId", a."createdAt", u.email
        FROM "AlertaLog" a
        JOIN "User" u ON u.id = a."userId"
        WHERE a.tipo = 'TAREA_ASIGNADA'
        ORDER BY a."createdAt" DESC
        LIMIT 10
        """
    )
    return {
        "flags": {
            "enabled": settings.tareas_whatsapp_enabled,
            "dry_run": settings.tareas_dry_run,
            "poll_seconds": settings.tareas_poll_seconds,
            "allowlist": allowlist(),
            "desde": fecha_desde().isoformat(),
        },
        "cola": [dict(r) for r in counts],
        "ultimas": [dict(r) for r in ultimas],
    }
