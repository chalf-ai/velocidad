"""Cliente para WhatsApp Cloud API (Meta Graph API)."""
from __future__ import annotations

import re

import httpx

from .config import settings


def _graph_url() -> str:
    """Base de la Graph API con la versión configurable (default v23.0)."""
    return f"https://graph.facebook.com/{settings.graph_api_version}"


# WhatsApp rechaza parámetros de plantilla con saltos de línea, tabs o >4
# espacios seguidos. Saneamos cada variable a una sola línea compacta.
def sanitize_param(value: str | None, max_len: int = 240) -> str:
    s = (value or "").replace("\n", " ").replace("\t", " ")
    s = re.sub(r"\s{2,}", " ", s).strip()
    return s[:max_len] if len(s) > max_len else s


async def send_text(to: str, text: str) -> dict:
    """
    Envía un mensaje de texto libre al número 'to' (formato +56912345678).

    OJO: Meta SOLO entrega texto libre dentro de la ventana de servicio de 24h
    (el usuario escribió al número en las últimas 24h). Para notificaciones
    proactivas fuera de esa ventana usar send_template. Se mantiene para las
    respuestas del agente a mensajes entrantes (webhook.py), que sí están en
    ventana.
    """
    url = f"{_graph_url()}/{settings.whatsapp_phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {settings.whatsapp_access_token}",
        "Content-Type": "application/json",
    }
    body = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": "text",
        "text": {"body": text, "preview_url": False},
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, json=body, headers=headers)
        resp.raise_for_status()
        return resp.json()


def build_template_payload(
    to: str,
    template_name: str,
    lang: str,
    body_params: list[str],
) -> dict:
    """Arma el payload de un mensaje de plantilla (sin enviarlo)."""
    return {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": lang},
            "components": [
                {
                    "type": "body",
                    "parameters": [
                        {"type": "text", "text": sanitize_param(p)} for p in body_params
                    ],
                }
            ],
        },
    }


async def send_template(
    to: str,
    template_name: str,
    lang: str,
    body_params: list[str],
) -> tuple[dict, dict]:
    """
    Envía un mensaje de PLANTILLA aprobada (entrega proactiva, sin ventana 24h).

    Devuelve (payload_enviado, respuesta_meta). Lanza httpx.HTTPStatusError si
    Meta rechaza la petición (4xx/5xx) — el caller registra el error.
    """
    url = f"{_graph_url()}/{settings.whatsapp_phone_number_id}/messages"
    headers = {
        "Authorization": f"Bearer {settings.whatsapp_access_token}",
        "Content-Type": "application/json",
    }
    payload = build_template_payload(to, template_name, lang, body_params)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        return payload, resp.json()


def extract_messages(payload: dict) -> list[dict]:
    """Extrae los mensajes entrantes de un webhook de WhatsApp."""
    messages = []
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            for msg in value.get("messages", []):
                phone = msg.get("from")
                msg_type = msg.get("type")
                text = ""
                if msg_type == "text":
                    text = msg.get("text", {}).get("body", "")
                elif msg_type == "interactive":
                    # Respuesta a botones/listas
                    interactive = msg.get("interactive", {})
                    if interactive.get("type") == "button_reply":
                        text = interactive["button_reply"].get("title", "")
                    elif interactive.get("type") == "list_reply":
                        text = interactive["list_reply"].get("title", "")

                if phone and text:
                    messages.append(
                        {
                            "from": phone,
                            "id": msg.get("id"),
                            "text": text,
                            "timestamp": msg.get("timestamp"),
                        }
                    )
    return messages


def extract_statuses(payload: dict) -> list[dict]:
    """
    Extrae los STATUS de mensajes salientes de un webhook de WhatsApp.

    En la Cloud API los status llegan en el MISMO field `messages`, dentro de
    `value.statuses[]` — no requieren suscripción adicional. Cada status trae
    id (=waMsgId), status (sent|delivered|read|failed), timestamp, recipient_id
    y, si falló, errors[].{code,title,message}.
    """
    out: list[dict] = []
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            for st in value.get("statuses", []):
                errors = st.get("errors") or []
                err = errors[0] if errors else {}
                out.append(
                    {
                        "wa_msg_id": st.get("id"),
                        "status": st.get("status"),  # sent | delivered | read | failed
                        "timestamp": st.get("timestamp"),
                        "recipient_id": st.get("recipient_id"),
                        "error_code": err.get("code"),
                        "error_title": err.get("title"),
                        "error_message": err.get("message") or (err.get("error_data") or {}).get("details"),
                        "raw": st,
                    }
                )
    return out
