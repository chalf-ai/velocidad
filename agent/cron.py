"""
Cron de alertas diarias — APScheduler con timezone Chile.

Dos jobs L-V:
  08:00  briefing_matutino   → todos los usuarios activos con teléfono
                               GERENTE_GENERAL: vista global del grupo
                               GERENTE / JEFE_MARCA: mini-resumen por marca
  15:00  seguimiento_tarde   → GERENTE_GENERAL, GERENTE y JEFE_MARCA
                               Accionables de caja rápida: FNE listo,
                               CP vencido, provisiones >90d

Para cambiar los horarios: BRIEFING_HORA y SEGUIMIENTO_HORA en .env
"""
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

# Roles que reciben el seguimiento de tarde (accionables de caja rápida)
ROLES_SEGUIMIENTO = {"GERENTE_GENERAL", "GERENTE", "JEFE_MARCA"}


# ── Briefing matutino (08:00) — todos los usuarios ────────────────────────────

async def enviar_briefings() -> None:
    """Briefing diario a todos los usuarios activos con teléfono registrado."""
    usuarios = await db.get_all_active_users_with_phone()
    logger.info("Briefing matutino: %d usuarios", len(usuarios))

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
            logger.info("Briefing enviado → %s (%s)", user["name"], telefono)
        except Exception:
            logger.exception("Error en briefing → %s", telefono)


# ── Seguimiento tarde (15:00) — GERENTE y JEFE_MARCA ─────────────────────────

async def enviar_seguimiento() -> None:
    """
    Alerta de tarde: casos accionables sin gestión reciente + recordatorios.
    Solo para GERENTE y JEFE_MARCA — los responsables operacionales directos.
    """
    usuarios = await db.get_all_active_users_with_phone()
    destinatarios = [u for u in usuarios if u.get("rol") in ROLES_SEGUIMIENTO]
    logger.info("Seguimiento tarde: %d destinatarios", len(destinatarios))

    for user in destinatarios:
        telefono = user["telefono"]
        try:
            # Accionables sin gestión reciente
            accionables = await t.capital_accionable(telefono)

            # Si no hay nada pendiente, no molestar
            if accionables.startswith("Sin accionables"):
                logger.info("Sin pendientes para %s — no se envía", user["name"])
                continue

            # Encabezado enfocado en accionables de caja rápida
            mensaje = f"*Caja rápida* 💰 — esto se puede cerrar hoy\n\n{accionables}"

            alerta_id = await db.create_alerta_log(
                user_id=user["id"],
                tipo="CASO_SIN_MOVIMIENTO",
                mensaje=mensaje,
            )
            resp = await send_text(telefono, mensaje)
            wa_msg_id = resp.get("messages", [{}])[0].get("id")
            await db.mark_alerta_sent(alerta_id, wa_msg_id=wa_msg_id)
            logger.info("Seguimiento enviado → %s (%s)", user["name"], telefono)
        except Exception:
            logger.exception("Error en seguimiento → %s", telefono)


# ── Scheduler ─────────────────────────────────────────────────────────────────

def build_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(timezone=TZ)

    # Job 1 — briefing matutino
    hora_b, min_b = settings.briefing_hora.split(":")
    scheduler.add_job(
        enviar_briefings,
        trigger=CronTrigger(
            hour=int(hora_b),
            minute=int(min_b),
            day_of_week="mon-fri",
            timezone=TZ,
        ),
        id="briefing_diario",
        replace_existing=True,
        misfire_grace_time=600,
    )

    # Job 2 — seguimiento de tarde
    hora_s, min_s = settings.seguimiento_hora.split(":")
    scheduler.add_job(
        enviar_seguimiento,
        trigger=CronTrigger(
            hour=int(hora_s),
            minute=int(min_s),
            day_of_week="mon-fri",
            timezone=TZ,
        ),
        id="seguimiento_tarde",
        replace_existing=True,
        misfire_grace_time=600,
    )

    logger.info(
        "Scheduler listo — briefing %s · seguimiento %s (L-V, Santiago)",
        settings.briefing_hora,
        settings.seguimiento_hora,
    )
    return scheduler
