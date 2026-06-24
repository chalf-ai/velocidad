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
from apscheduler.triggers.interval import IntervalTrigger

from .config import settings
from . import database as db
from . import tools as t
from .tareas import procesar_tareas_asignadas
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


# ── Snapshot diario de capital (Tendencias persistentes) ─────────────────────

async def generar_snapshot_diario() -> dict:
    """
    Dispara la foto diaria del estado vigente llamando al endpoint Next.js.
    El cálculo vive en TypeScript (mismos selectores que la app).

    Camino A: antes de postear, consulta EN VIVO al gateway ROMA Amazon (ROMA se
    consulta DENTRO de Amazon; el agente solo orquesta por HTTP) FNE y Provisiones
    de Ingreso, y los manda como payload parcial {roma:{fne, provisiones}}. Cada
    fuente es independiente: si una falla, se postea la otra; si ambas fallan,
    postea SIN override → el endpoint usa la fuente validada (snapshot activo).
    NUNCA inventa datos. Provisiones está detrás de PROVISIONES_ENABLED (default OFF).
    """
    import httpx
    from .roma_gateway import (
        consultar_fne_gateway,
        consultar_provisiones_gateway,
        consultar_provisiones_detalle_gateway,
    )

    # 1. ROMA en vivo desde el gateway Amazon. Cada fuente es INDEPENDIENTE: si una
    #    falla, se postea la otra; si ambas faltan, body=None → fuente validada.
    roma_payload: dict = {}
    gateway_fne = None
    gateway_prov = None

    # 1a. FNE operativo.
    try:
        fne = await consultar_fne_gateway()
        roma_payload["fne"] = fne
        gateway_fne = fne["unidades"]
        logger.info("FNE gateway ROMA en vivo: %s VIN", fne["unidades"])
    except Exception:
        logger.exception(
            "Gateway ROMA (FNE) no disponible — sin override FNE (fuente validada)"
        )

    # 1b. Provisiones de Ingreso >90d. Gate independiente (PROVISIONES_ENABLED);
    #     OFF por defecto → Provisiones siguen saliendo de la fuente validada.
    if settings.provisiones_enabled:
        try:
            prov = await consultar_provisiones_gateway()
            roma_payload["provisiones"] = {
                "casos": prov["mas90_unidades"],
                "monto": prov["mas90_monto"],
                "agingMax": prov["aging_max"],
            }
            gateway_prov = prov["mas90_unidades"]
            logger.info(
                "Provisiones gateway ROMA en vivo: >90d %s/$%s · vigentes %s/$%s",
                prov["mas90_unidades"], int(prov["mas90_monto"]),
                prov["vigentes_unidades"], int(prov["vigentes_monto"]),
            )
        except Exception:
            logger.exception(
                "Gateway ROMA (Provisiones) no disponible — sin override (fuente validada)"
            )
    else:
        logger.info("Provisiones gateway deshabilitado (PROVISIONES_ENABLED=0)")

    # 1c. Provisiones DETALLE en vivo (lista completa) → reemplaza la fuente
    #     PROVISIONES (Excel) por ROMA, para que el detalle /provisiones se
    #     actualice solo. Gate independiente (PROVISIONES_DETALLE_ENABLED). Se
    #     postea ANTES del snapshot diario para que el Score lea ya la fuente
    #     fresca. Falla / sin filas → el endpoint conserva el Excel vigente.
    if settings.provisiones_detalle_enabled:
        try:
            filas = await consultar_provisiones_detalle_gateway()
            url_prov = f"{settings.app_base_url.rstrip('/')}/api/snapshots/provisiones-roma"
            async with httpx.AsyncClient(timeout=120) as client:
                rp = await client.post(
                    url_prov,
                    headers={"Authorization": f"Bearer {settings.daily_snapshot_token}"},
                    json={"rows": filas},
                )
            logger.info(
                "Provisiones DETALLE ROMA → %s filas, HTTP %s: %s",
                len(filas), rp.status_code, rp.text[:200],
            )
        except Exception:
            logger.exception(
                "Provisiones detalle ROMA no disponible — se conserva el Excel vigente"
            )
    else:
        logger.info("Provisiones detalle deshabilitado (PROVISIONES_DETALLE_ENABLED=0)")

    # 2. POST a Velocidad. body=None → endpoint usa snapshots activos (fallback).
    url = f"{settings.app_base_url.rstrip('/')}/api/snapshots/daily"
    body = {"roma": roma_payload} if roma_payload else None
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {settings.daily_snapshot_token}"},
                json=body,
            )
        if resp.status_code == 200:
            data = resp.json()
            logger.info(
                "Snapshot diario OK — fecha=%s scopes=%s marcas=%s romaEnVivo=%s",
                data.get("fecha"),
                data.get("scopes"),
                len(data.get("marcas", [])),
                data.get("romaEnVivo"),
            )
            return {
                "ok": True,
                "gateway_fne_unidades": gateway_fne,
                "gateway_prov_unidades": gateway_prov,
                "romaEnVivo": data.get("romaEnVivo"),
                "fecha": data.get("fecha"),
                "scopes": data.get("scopes"),
            }
        logger.error(
            "Snapshot diario falló — HTTP %s: %s", resp.status_code, resp.text[:300]
        )
        return {
            "ok": False,
            "status": resp.status_code,
            "gateway_fne_unidades": gateway_fne,
            "gateway_prov_unidades": gateway_prov,
        }
    except Exception as e:  # noqa: BLE001
        logger.exception("Snapshot diario: error llamando a %s", url)
        return {
            "ok": False,
            "error": str(e),
            "gateway_fne_unidades": gateway_fne,
            "gateway_prov_unidades": gateway_prov,
        }


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

    # Job 3 — F2: poller de tareas asignadas → WhatsApp. Solo se registra si
    # el master switch está activo (cambiar la env var en Railway = restart,
    # así que registrar condicional es equivalente y más limpio). La función
    # además se auto-guarda con los flags — doble seguro.
    if settings.tareas_whatsapp_enabled:
        scheduler.add_job(
            procesar_tareas_asignadas,
            trigger=IntervalTrigger(seconds=settings.tareas_poll_seconds),
            id="tareas_asignadas",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        logger.info(
            "Poller tareas F2 ACTIVO — cada %ds · dry_run=%s",
            settings.tareas_poll_seconds,
            settings.tareas_dry_run,
        )
    else:
        logger.info("Poller tareas F2 deshabilitado (TAREAS_WHATSAPP_ENABLED=0)")

    # Job 4 — snapshot diario de capital (todos los días, hora Chile).
    # Requiere DAILY_SNAPSHOT_TOKEN configurado (mismo valor que el servicio
    # web). Sin token, el endpoint rechazaría la llamada — no se registra.
    if settings.daily_snapshot_token:
        hora_snap, min_snap = settings.snapshot_hora.split(":")
        scheduler.add_job(
            generar_snapshot_diario,
            trigger=CronTrigger(
                hour=int(hora_snap),
                minute=int(min_snap),
                timezone=TZ,
            ),
            id="snapshot_diario_capital",
            replace_existing=True,
            misfire_grace_time=3600,
        )
        logger.info("Snapshot diario ACTIVO — %s (todos los días, Santiago)", settings.snapshot_hora)
    else:
        logger.info("Snapshot diario deshabilitado (DAILY_SNAPSHOT_TOKEN vacío)")

    logger.info(
        "Scheduler listo — briefing %s · seguimiento %s (L-V, Santiago)",
        settings.briefing_hora,
        settings.seguimiento_hora,
    )
    return scheduler
