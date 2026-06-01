"""Cliente para WhatsApp Cloud API (Meta Graph API v20)."""
from __future__ import annotations

import httpx

from .config import settings

GRAPH_URL = "https://graph.facebook.com/v20.0"


async def send_text(to: str, text: str) -> dict:
    """Envía un mensaje de texto simple al número 'to' (formato +56912345678)."""
    url = f"{GRAPH_URL}/{settings.whatsapp_phone_number_id}/messages"
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
