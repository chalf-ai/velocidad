"""
F2 · Poller de tareas asignadas → WhatsApp REAL (Meta Cloud API, plantilla).

Flujo:
  TareaOperacional → AlertaLog(TAREA_ASIGNADA, enviado=false)  [creadas por Next.js]
  → este poller detecta pendientes → send_template (plantilla aprobada)
  → waMsgId + waStatus='accepted' → webhook de status mueve a sent/delivered/read/failed.

Por qué plantilla y no texto libre: Meta SOLO entrega texto libre dentro de la
ventana de 24h. Las notificaciones de tareas son proactivas (el gerente no
escribió antes), así que requieren una plantilla 'utility' aprobada.

Reglas (aprobadas):
  · Master switch TAREAS_WHATSAPP_ENABLED (= WHATSAPP_ENABLED, default off).
  · DRY-RUN (TAREAS_DRY_RUN = WHATSAPP_DRY_RUN): loguea el payload de plantilla
    que enviaría — NO llama Meta, NO reclama, NO marca. Repetible.
  · Allowlist por email del asignado (TAREAS_WHATSAPP_PILOTO, CSV).
  · UN intento automático por alerta. Anti-duplicado: claim atómico (waStatus
    pasa NULL→'sending' en un UPDATE condicional) antes de enviar — protege
    contra ciclos solapados y contra múltiples réplicas del poller.
  · Solo alertas creadas DESPUÉS de TAREAS_DESDE (o el arranque del proceso).
  · No toca briefings ni seguimiento (jobs separados en cron.py).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from urllib.parse import quote

import httpx

from .config import settings
from . import database as db
from .whatsapp import build_template_payload, send_template

logger = logging.getLogger(__name__)

_DESDE_ARRANQUE = datetime.now(timezone.utc)

# Cap de envíos por ciclo — protege de backlogs y de la API de Meta.
MAX_POR_CICLO = 10


def fecha_desde() -> datetime:
    if settings.tareas_desde:
        d = datetime.fromisoformat(settings.tareas_desde)
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    return _DESDE_ARRANQUE


def allowlist() -> list[str]:
    """Emails del piloto, normalizados. Vacía = el poller no procesa nada."""
    return [
        e.strip().lower()
        for e in settings.tareas_whatsapp_piloto.split(",")
        if e.strip()
    ]


def _primer_nombre(nombre: str | None) -> str:
    limpio = (nombre or "").strip()
    return limpio.split()[0] if limpio else "Hola"


def _modulo_de_caso(tipo_caso: str | None, vin: str | None, clave: str | None) -> str:
    """Texto de {{2}} — módulo/tipo de caso."""
    if vin:
        return "Centro de Acción · VIN"
    c = (clave or "").upper()
    if c.startswith("PROV"):
        return "Provisiones"
    if c.startswith("SALDO"):
        return "Saldos"
    if c.startswith("BONO"):
        return "Bonos"
    return "Centro de Acción"


def _descripcion_breve(alerta: dict) -> str:
    """Texto de {{3}} — identificación corta del caso."""
    partes: list[str] = []
    marca_modelo = " ".join(p for p in [alerta.get("marca"), alerta.get("modelo")] if p)
    if marca_modelo:
        partes.append(marca_modelo)
    if alerta.get("vin"):
        partes.append(f"VIN {alerta['vin']}")
    if alerta.get("motivo"):
        partes.append(str(alerta["motivo"]))
    if not partes and alerta.get("claveCaso"):
        partes.append(str(alerta["claveCaso"]))
    return " · ".join(partes) or "Gestión pendiente"


def _link_absoluto(vin: str | None, clave: str | None) -> str:
    """
    Texto de {{4}} — link ABSOLUTO al caso. Replica la lógica de linkCaso()
    de Next.js (src/lib/notificaciones/render.ts) usando la base pública.
    """
    base = settings.app_public_url.rstrip("/")
    if vin:
        return f"{base}/centro-accion?vin={quote(vin)}"
    return f"{base}/centro-accion?clave={quote(clave or '')}"


def build_template_vars(alerta: dict) -> list[str]:
    """Las 4 variables posicionales de la plantilla `tarea_asignada`."""
    return [
        _primer_nombre(alerta.get("name")),                                        # {{1}}
        _modulo_de_caso(alerta.get("tipoCaso"), alerta.get("vin"), alerta.get("claveCaso")),  # {{2}}
        _descripcion_breve(alerta),                                                # {{3}}
        _link_absoluto(alerta.get("vin"), alerta.get("claveCaso")),                # {{4}}
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
        "template": settings.whatsapp_template_name,
        "pendientes": len(pendientes),
        "enviadas": 0,
        "errores": 0,
        "saltadas": 0,
        "detalle": [],
    }

    for alerta in pendientes:
        vars_ = build_template_vars(alerta)
        payload = build_template_payload(
            alerta["telefono"],
            settings.whatsapp_template_name,
            settings.whatsapp_template_lang,
            vars_,
        )

        if settings.tareas_dry_run:
            # DRY-RUN: solo log del payload de plantilla. NO reclama, NO marca,
            # NO llama Meta → repetible y sin efectos.
            logger.info(
                "DRY-RUN · ENVIARÍA plantilla '%s' → %s (%s) · alerta=%s · vars=%s",
                settings.whatsapp_template_name, alerta["name"], alerta["telefono"],
                alerta["id"], vars_,
            )
            resumen["detalle"].append(
                {"alerta": alerta["id"], "para": alerta["email"], "accion": "dry_run", "vars": vars_}
            )
            continue

        # ── Envío real ──
        # Anti-duplicado: reclamo atómico. Si otro worker ya la tomó, saltar.
        if not await db.claim_alerta(alerta["id"]):
            resumen["saltadas"] += 1
            resumen["detalle"].append(
                {"alerta": alerta["id"], "para": alerta["email"], "accion": "ya_reclamada"}
            )
            continue

        try:
            sent_payload, resp = await send_template(
                alerta["telefono"],
                settings.whatsapp_template_name,
                settings.whatsapp_template_lang,
                vars_,
            )
            wa_msg_id = resp.get("messages", [{}])[0].get("id")
            await db.mark_alerta_accepted(alerta["id"], wa_msg_id, sent_payload, resp)
            resumen["enviadas"] += 1
            resumen["detalle"].append(
                {"alerta": alerta["id"], "para": alerta["email"], "accion": "accepted", "waMsgId": wa_msg_id}
            )
            logger.info(
                "Tarea ACEPTADA por Meta → %s (%s) · alerta=%s · waMsgId=%s",
                alerta["name"], alerta["telefono"], alerta["id"], wa_msg_id,
            )
        except httpx.HTTPStatusError as e:
            # Meta rechazó (4xx/5xx): extraer error code/title/message.
            status_code = e.response.status_code
            try:
                err = (e.response.json() or {}).get("error", {}) or {}
            except Exception:
                err = {}
            await db.mark_alerta_send_failed(
                alerta["id"], status_code, err.get("code"), err.get("type") or err.get("error_title"),
                err.get("message"), {"http_status": status_code, "error": err},
            )
            resumen["errores"] += 1
            resumen["detalle"].append(
                {"alerta": alerta["id"], "para": alerta["email"], "accion": "rechazada",
                 "http": status_code, "code": err.get("code"), "message": err.get("message")}
            )
            logger.error(
                "Meta RECHAZÓ tarea → %s · alerta=%s · HTTP %s · code=%s · %s",
                alerta["telefono"], alerta["id"], status_code, err.get("code"), err.get("message"),
            )
        except Exception as e:
            await db.mark_alerta_send_failed(
                alerta["id"], None, None, type(e).__name__, str(e), None
            )
            resumen["errores"] += 1
            resumen["detalle"].append(
                {"alerta": alerta["id"], "para": alerta["email"], "accion": "error", "error": f"{type(e).__name__}: {e}"}
            )
            logger.exception("Error enviando tarea → %s · alerta=%s", alerta["telefono"], alerta["id"])

    if pendientes:
        logger.info(
            "Ciclo tareas F2: %d pendientes · %d enviadas · %d errores · %d saltadas · dry_run=%s",
            resumen["pendientes"], resumen["enviadas"], resumen["errores"],
            resumen["saltadas"], resumen["dry_run"],
        )
    return resumen


async def estado_tareas() -> dict:
    """Payload de /debug/tareas: flags + conteos de cola + últimas 10 alertas."""
    pool = await db.get_pool()
    counts = await pool.fetch(
        """
        SELECT canal, enviado, "waStatus",
               COUNT(*)          AS total,
               COUNT("errorMsg") AS con_error
        FROM "AlertaLog"
        WHERE tipo = 'TAREA_ASIGNADA'
        GROUP BY canal, enviado, "waStatus"
        ORDER BY canal NULLS FIRST, enviado
        """
    )
    ultimas = await pool.fetch(
        """
        SELECT a.id, a.canal, a.enviado, a."waStatus", a."waStatusAt",
               a."errorMsg" IS NOT NULL AS con_error,
               a."waMsgId", a."waErrorCode", a."waErrorTitle", a."createdAt", u.email
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
            "template": settings.whatsapp_template_name,
            "template_lang": settings.whatsapp_template_lang,
            "graph_api_version": settings.graph_api_version,
            "allowlist": allowlist(),
            "desde": fecha_desde().isoformat(),
        },
        "cola": [dict(r) for r in counts],
        "ultimas": [dict(r) for r in ultimas],
    }
