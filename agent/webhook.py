"""FastAPI — webhook de WhatsApp + health check + startup del cron."""
from __future__ import annotations

import logging
import secrets
from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, FastAPI, Request, Response
from fastapi.responses import PlainTextResponse

from .config import settings
from .cron import build_scheduler, generar_snapshot_diario
from . import database as db
from .agent import chat, get_agent
from .tareas import estado_tareas, procesar_tareas_asignadas
from .whatsapp import extract_messages, extract_statuses, send_text

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
logger = logging.getLogger(__name__)

# IDs de mensajes ya procesados (deduplicación en memoria; suficiente para 15 usuarios)
_processed: set[str] = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.get_pool()
    await get_agent()          # inicializa checkpointer PostgreSQL y crea tablas si no existen
    scheduler = build_scheduler()
    scheduler.start()
    logger.info("Agente y cron de briefings iniciados")
    yield
    scheduler.shutdown(wait=False)
    await db.close_pool()


app = FastAPI(title="Velocidad Agent", lifespan=lifespan)


# ── WhatsApp verification (GET) ───────────────────────────────────────────────

@app.get("/webhook")
async def verify_webhook(request: Request):
    params = request.query_params
    if (
        params.get("hub.mode") == "subscribe"
        and params.get("hub.verify_token") == settings.whatsapp_verify_token
    ):
        return PlainTextResponse(params.get("hub.challenge", ""))
    return Response(status_code=403)


# ── Mensajes entrantes (POST) ─────────────────────────────────────────────────

@app.post("/webhook")
async def receive_webhook(request: Request, background: BackgroundTasks):
    payload = await request.json()
    messages = extract_messages(payload)

    for msg in messages:
        msg_id = msg.get("id", "")
        if msg_id and msg_id in _processed:
            continue
        if msg_id:
            _processed.add(msg_id)
            if len(_processed) > 5000:
                _processed.clear()

        background.add_task(handle_message, msg["from"], msg["text"])

    # Status de mensajes SALIENTES (sent/delivered/read/failed). En la Cloud
    # API llegan en el MISMO webhook (value.statuses[]) — no requieren otra
    # suscripción. Persistimos el estado real de entrega por waMsgId.
    for st in extract_statuses(payload):
        if not st.get("wa_msg_id"):
            continue
        background.add_task(
            db.update_alerta_status,
            st["wa_msg_id"],
            st["status"],
            st.get("timestamp"),
            st.get("error_code"),
            st.get("error_title"),
            st.get("error_message"),
            st.get("raw"),
        )

    return {"status": "ok"}


async def handle_message(telefono: str, texto: str) -> None:
    try:
        user = await db.get_user_by_phone(telefono)

        # Log mensaje entrante
        if user:
            await db.create_alerta_log(
                user_id=user["id"],
                tipo="MENSAJE_ENTRANTE",
                mensaje=texto,
            )

        respuesta = await chat(telefono, texto)
        resp = await send_text(telefono, respuesta)

        # Log respuesta enviada
        if user:
            wa_msg_id = resp.get("messages", [{}])[0].get("id")
            alerta_id = await db.create_alerta_log(
                user_id=user["id"],
                tipo="BRIEFING_DIARIO",
                mensaje=respuesta,
            )
            await db.mark_alerta_sent(alerta_id, wa_msg_id=wa_msg_id)

    except Exception:
        logger.exception("Error procesando mensaje de %s", telefono)
        try:
            await send_text(telefono, "Hubo un error procesando tu mensaje. Intenta de nuevo.")
        except Exception:
            pass


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "velocidad-agent"}


@app.get("/debug/estado")
async def debug_estado():
    """Diagnóstico general: usuarios, snapshots activos."""
    pool = await db.get_pool()
    try:
        usuarios = await pool.fetch(
            'SELECT rol, COUNT(*) as total, COUNT(CASE WHEN telefono IS NOT NULL THEN 1 END) as con_tel '
            'FROM "User" WHERE activo=true GROUP BY rol ORDER BY rol'
        )
        snapshots = await pool.fetch(
            'SELECT fuente, activo, "fechaCorte", registros, "createdAt" '
            'FROM "Snapshot" ORDER BY "createdAt" DESC LIMIT 10'
        )
        return {
            "usuarios_por_rol": [dict(r) for r in usuarios],
            "snapshots_recientes": [dict(r) for r in snapshots],
        }
    except Exception as e:
        return {"error": str(e)}



@app.get("/debug/tareas")
async def debug_tareas():
    """F2 · Estado del poller de tareas: flags, cola por canal/estado, últimas 10."""
    try:
        return await estado_tareas()
    except Exception as e:
        return {"error": str(e)}


@app.get("/debug/tareas/ciclo")
async def debug_tareas_ciclo():
    """
    F2 · Ejecuta UN ciclo del poller a demanda (para validar dry-run sin
    esperar el intervalo). Respeta todos los flags: deshabilitado → no hace
    nada; dry_run → solo loguea, no llama Meta ni marca enviada.
    """
    try:
        return await procesar_tareas_asignadas()
    except Exception as e:
        return {"error": str(e)}


@app.get("/debug/snapshot/ciclo")
async def debug_snapshot_ciclo(request: Request):
    """
    Dispara generar_snapshot_diario() a demanda (Camino A): consulta FNE al
    gateway ROMA Amazon y postea a /api/snapshots/daily. Útil para validar el
    flujo o ejecutarlo manualmente sin esperar las 20:00. Si el gateway falla,
    cae a fuente validada (sin inventar FNE). No expone secretos.

    PROTEGIDO con Bearer: exige `Authorization: Bearer <DAILY_SNAPSHOT_TOKEN>`
    (el mismo token que el agente usa para postear a Velocidad). Sin token
    configurado o header inválido → 401. Ya no es público.
    """
    token = settings.daily_snapshot_token
    auth = request.headers.get("authorization", "")
    if not token or not secrets.compare_digest(auth, f"Bearer {token}"):
        return Response(status_code=401)
    try:
        return await generar_snapshot_diario()
    except Exception as e:
        return {"error": str(e)}


@app.get("/debug/user/{telefono}")
async def debug_user(telefono: str):
    """Diagnóstico: busca usuario por teléfono — muestra query raw y resultado."""
    pool = await db.get_pool()
    numero = telefono.lstrip("+").strip()
    try:
        # Query exacta que usa el agente
        row = await pool.fetchrow(
            "SELECT id, email, name, \"marcas\", rol, telefono FROM \"User\" "
            "WHERE TRIM(REPLACE(telefono, '+', '')) = $1 AND activo = true",
            numero,
        )
        # Query directa sin normalización (para comparar)
        row_exact = await pool.fetchrow(
            "SELECT id, telefono FROM \"User\" WHERE telefono = $1",
            "+" + numero,
        )
        return {
            "numero_buscado": numero,
            "found_normalizado": row is not None,
            "found_exacto": row_exact is not None,
            "usuario": dict(row) if row else None,
        }
    except Exception as e:
        return {"error": str(e)}


# ── Entrypoint ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("agent.webhook:app", host="0.0.0.0", port=settings.agent_port, reload=False)
