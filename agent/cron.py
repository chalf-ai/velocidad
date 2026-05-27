"""Cron de briefings diarios — APScheduler con timezone Chile."""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from .config import settings
from . import database as db
from . import tools as t
from .whatsapp import send_text

logger = logging.getLogger(__name__)
TZ = "America/Santiago"


async def enviar_briefings() -> None:
    """Envía el briefing diario a todos los usuarios activos con teléfono registrado."""
    usuarios = await db.get_all_active_users_with_phone()
    logger.info("Enviando briefings a %d usuarios", len(usuarios))

    for user in usuarios:
        telefono = user["telefono"]
        try:
            mensaje = await t.briefing_diario(telefono)
            alerta_id = await db.create_alerta_log(
                user_id=user["id"],
                tipo="BRIEFING_DIARIO",
                mensaje=mensaje,
            )
            resp = await send_text(telefono, mensaje)
            wa_msg_id = resp.get("messages", [{}])[0].get("id")
            await db.mark_alerta_sent(alerta_id, wa_msg_id=wa_msg_id)
            logger.info("Briefing enviado a %s (%s)", user["name"], telefono)
        except Exception:
            logger.exception("Error enviando briefing a %s", telefono)


def build_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(timezone=TZ)

    hora, minuto = settings.briefing_hora.split(":")
    scheduler.add_job(
        enviar_briefings,
        trigger=CronTrigger(
            hour=int(hora),
            minute=int(minuto),
            day_of_week="mon-fri",
            timezone=TZ,
        ),
        id="briefing_diario",
        replace_existing=True,
        misfire_grace_time=600,
    )
    return scheduler
