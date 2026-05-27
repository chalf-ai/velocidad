"""
Herramientas del agente — lógica compartida entre LangGraph y el MCP server.
Cada función retorna un string legible (formato WhatsApp).
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

from . import database as db

# ── Helpers ───────────────────────────────────────────────────────────────────

ESTADOS_ACTIVOS = {"ABIERTO", "EN_CURSO", "ESPERANDO"}
ESTADO_LABEL = {
    "ABIERTO": "Abierto",
    "EN_CURSO": "En curso",
    "ESPERANDO": "Esperando",
    "RESUELTO": "Resuelto",
    "CANCELADO": "Cancelado",
}
PRIORIDAD_EMOJI = {
    "CRITICA": "🔴",
    "ALTA": "🟠",
    "MEDIA": "🟡",
    "BAJA": "⚪",
    None: "⚪",
}
ESTADOS_VALIDOS = {"ABIERTO", "EN_CURSO", "ESPERANDO", "RESUELTO", "CANCELADO"}
PRIORIDADES_VALIDAS = {"BAJA", "MEDIA", "ALTA", "CRITICA"}


def _dias_sin_movimiento(g: dict) -> int:
    updated = g.get("updatedAt")
    if updated is None:
        return 0
    if isinstance(updated, datetime):
        delta = datetime.now(timezone.utc) - updated.replace(tzinfo=timezone.utc)
    else:
        delta = datetime.now(timezone.utc) - datetime.fromisoformat(str(updated)).replace(tzinfo=timezone.utc)
    return delta.days


def _fecha_str(dt: Optional[datetime]) -> str:
    if dt is None:
        return "—"
    if isinstance(dt, datetime):
        return dt.strftime("%d/%m/%Y")
    return str(dt)[:10]


# ── Herramientas ──────────────────────────────────────────────────────────────

async def briefing_diario(telefono: str) -> str:
    """Briefing diario: casos activos del usuario identificado por su teléfono WhatsApp."""
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No encontré tu usuario en el sistema. Pide al administrador que registre tu número."

    if user.get("rol") == "ADMIN":
        return await _briefing_ejecutivo(user)

    marcas = user.get("marcas") or []
    if not marcas:
        return f"Hola {user['name']}! Tu usuario no tiene marcas asignadas. Pide al admin que las configure."

    stock_vins = await db.get_vins_for_marcas(marcas)
    if not stock_vins:
        return f"Hola {user['name']}! No hay stock activo para tus marcas ({', '.join(marcas)})."

    vins = [v["vin"] for v in stock_vins]
    vin_info = {v["vin"]: v for v in stock_vins}
    gestiones = await db.get_gestiones_for_vins(vins)
    activas = [g for g in gestiones if g["estadoGestion"] in ESTADOS_ACTIVOS]

    today = date.today()
    hoy_str = today.strftime("%A %d de %B").capitalize()

    if not activas:
        return (
            f"*Briefing {hoy_str}* 📋\n\n"
            f"Hola {user['name']}! No tienes casos activos. ✅\n"
            f"Marcas: {', '.join(marcas)}"
        )

    vencidos, criticos, sin_movimiento = [], [], []
    for g in activas:
        fc = g.get("fechaCompromiso")
        if fc:
            fc_date = fc.date() if isinstance(fc, datetime) else datetime.fromisoformat(str(fc)).date()
            if fc_date <= today:
                vencidos.append(g)
        if g.get("prioridadManual") == "CRITICA":
            criticos.append(g)
        if _dias_sin_movimiento(g) >= 5:
            sin_movimiento.append(g)

    por_estado: dict[str, list] = {}
    for g in activas:
        por_estado.setdefault(g["estadoGestion"], []).append(g)

    lines = [f"*Briefing {hoy_str}* 📋\n"]
    lines.append(f"Hola *{user['name']}*! Tienes *{len(activas)} casos activos*.")
    lines.append(f"Marcas: {', '.join(marcas)}\n")
    lines.append("📊 " + " | ".join(f"{ESTADO_LABEL[e]}: {len(c)}" for e, c in sorted(por_estado.items())))

    if vencidos or criticos or sin_movimiento:
        lines.append("\n*⚠️ Requieren atención inmediata:*")
        mostrados: set[str] = set()
        for g in vencidos:
            if g["vin"] not in mostrados:
                modelo = vin_info.get(g["vin"], {}).get("modelo", "")
                lines.append(f"• {g['vin']} {modelo} — fecha compromiso vencida")
                mostrados.add(g["vin"])
        for g in criticos:
            if g["vin"] not in mostrados:
                modelo = vin_info.get(g["vin"], {}).get("modelo", "")
                lines.append(f"• 🔴 {g['vin']} {modelo} — prioridad CRÍTICA")
                mostrados.add(g["vin"])
        for g in sin_movimiento:
            if g["vin"] not in mostrados:
                modelo = vin_info.get(g["vin"], {}).get("modelo", "")
                dias = _dias_sin_movimiento(g)
                lines.append(f"• {g['vin']} {modelo} — sin movimiento {dias} días")
                mostrados.add(g["vin"])

    lines.append("\n_Escribe un VIN para ver el detalle, o 'ayuda' para ver qué puedo hacer._")
    return "\n".join(lines)


async def _briefing_ejecutivo(user: dict) -> str:
    """Resumen ejecutivo para perfil ADMIN — visión global por marca."""
    today = date.today()
    hoy_str = today.strftime("%A %d de %B").capitalize()

    stock_vins = await db.get_all_stock_vins()
    if not stock_vins:
        return f"*Resumen Ejecutivo {hoy_str}*\n\nNo hay stock activo en el sistema."

    vins = [v["vin"] for v in stock_vins]
    vin_marca = {v["vin"]: v.get("marca", "SIN MARCA") for v in stock_vins}

    gestiones = await db.get_gestiones_for_vins(vins)
    activas = [g for g in gestiones if g["estadoGestion"] in ESTADOS_ACTIVOS]

    total_vencidos = sum(
        1 for g in activas
        if g.get("fechaCompromiso") and (
            (g["fechaCompromiso"].date() if isinstance(g["fechaCompromiso"], datetime)
             else datetime.fromisoformat(str(g["fechaCompromiso"])).date()) <= today
        )
    )
    total_criticos = sum(1 for g in activas if g.get("prioridadManual") == "CRITICA")
    total_sin_mov = sum(1 for g in activas if _dias_sin_movimiento(g) >= 7)

    # Agrupar por marca
    por_marca: dict[str, dict] = {}
    for g in activas:
        marca = vin_marca.get(g["vin"], "SIN MARCA")
        if marca not in por_marca:
            por_marca[marca] = {"total": 0, "criticos": 0, "vencidos": 0}
        por_marca[marca]["total"] += 1
        if g.get("prioridadManual") == "CRITICA":
            por_marca[marca]["criticos"] += 1
        fc = g.get("fechaCompromiso")
        if fc:
            fc_date = fc.date() if isinstance(fc, datetime) else datetime.fromisoformat(str(fc)).date()
            if fc_date <= today:
                por_marca[marca]["vencidos"] += 1

    lines = [f"*Resumen Ejecutivo — {hoy_str}* 📊\n"]
    lines.append(f"Hola *{user['name']}*. Visión global del grupo.\n")
    lines.append(f"*Total casos activos: {len(activas)}*")

    if total_vencidos or total_criticos or total_sin_mov:
        alertas = []
        if total_criticos:   alertas.append(f"🔴 {total_criticos} críticos")
        if total_vencidos:   alertas.append(f"⚠️ {total_vencidos} vencidos")
        if total_sin_mov:    alertas.append(f"⏱ {total_sin_mov} sin movimiento +7d")
        lines.append("Alertas: " + " · ".join(alertas))

    lines.append("\n*Por marca:*")
    for marca, datos in sorted(por_marca.items(), key=lambda x: -x[1]["total"]):
        sufijo = []
        if datos["criticos"]: sufijo.append(f"🔴 {datos['criticos']} críticos")
        if datos["vencidos"]:  sufijo.append(f"⚠️ {datos['vencidos']} vencidos")
        detalle = f" ({', '.join(sufijo)})" if sufijo else ""
        lines.append(f"• *{marca}*: {datos['total']} casos{detalle}")

    lines.append("\n_Para detalle de una marca o VIN específico, escríbeme._")
    return "\n".join(lines)


async def detalle_vin(vin: str, telefono: str) -> str:
    """Ficha completa de un VIN: estado de gestión, comentarios e historial reciente."""
    user = await db.get_user_by_phone(telefono)
    nombre = user["name"] if user else "Usuario"

    vin = vin.upper().strip()
    gestion = await db.get_gestion_by_vin(vin)
    historial = await db.get_historial_vin(vin, limit=4)

    if not gestion:
        return f"No hay gestión registrada para el VIN *{vin}*. ¿Quieres que la cree?"

    prioridad = gestion.get("prioridadManual")
    estado = gestion.get("estadoGestion", "ABIERTO")
    emoji = PRIORIDAD_EMOJI.get(prioridad, "⚪")

    lines = [f"*VIN: {vin}* {emoji}"]
    lines.append(f"Estado: *{ESTADO_LABEL.get(estado, estado)}*")
    if prioridad:
        lines.append(f"Prioridad: {prioridad}")
    if gestion.get("responsable"):
        lines.append(f"Responsable: {gestion['responsable']}")
    if gestion.get("fechaCompromiso"):
        lines.append(f"Compromiso: {_fecha_str(gestion['fechaCompromiso'])}")
    if gestion.get("comentario"):
        lines.append(f"\n📝 _{gestion['comentario']}_")
    if gestion.get("proximaAccion"):
        lines.append(f"▶️ Próxima acción: {gestion['proximaAccion']}")

    if historial:
        lines.append("\n*Últimos cambios:*")
        for h in historial:
            ts = _fecha_str(h.get("createdAt"))
            usuario = h.get("usuario", "?")
            campo = h.get("campo", "")
            nuevo = h.get("valorNuevo", "")
            lines.append(f"• {ts} [{usuario}] {campo}: {nuevo}")

    dias = _dias_sin_movimiento(gestion)
    if dias > 0:
        lines.append(f"\n_Sin movimiento: {dias} días_")

    return "\n".join(lines)


async def actualizar_estado(vin: str, nuevo_estado: str, telefono: str) -> str:
    """Cambia el estadoGestion de un VIN."""
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No pude identificarte. Verifica que tu número esté registrado."

    nuevo_estado = nuevo_estado.upper().strip()
    if nuevo_estado not in ESTADOS_VALIDOS:
        return f"Estado inválido. Usa uno de: {', '.join(sorted(ESTADOS_VALIDOS))}"

    vin = vin.upper().strip()
    ok = await db.upsert_gestion_field(vin, "estadoGestion", nuevo_estado, user["name"], user["email"])
    if not ok:
        return f"No pude actualizar el VIN {vin}."
    return f"✅ VIN *{vin}* → estado *{ESTADO_LABEL.get(nuevo_estado, nuevo_estado)}*"


async def cambiar_prioridad(vin: str, nueva_prioridad: str, telefono: str) -> str:
    """Cambia la prioridad manual de un VIN."""
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No pude identificarte."

    nueva_prioridad = nueva_prioridad.upper().strip()
    if nueva_prioridad not in PRIORIDADES_VALIDAS:
        return f"Prioridad inválida. Usa: {', '.join(sorted(PRIORIDADES_VALIDAS))}"

    vin = vin.upper().strip()
    ok = await db.upsert_gestion_field(vin, "prioridadManual", nueva_prioridad, user["name"], user["email"])
    if not ok:
        return f"No pude actualizar el VIN {vin}."
    emoji = PRIORIDAD_EMOJI.get(nueva_prioridad, "")
    return f"{emoji} VIN *{vin}* → prioridad *{nueva_prioridad}*"


async def reasignar_caso(vin: str, nuevo_responsable: str, telefono: str) -> str:
    """Cambia el responsable de un caso."""
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No pude identificarte."

    vin = vin.upper().strip()
    ok = await db.upsert_gestion_field(vin, "responsable", nuevo_responsable, user["name"], user["email"])
    if not ok:
        return f"No pude reasignar el VIN {vin}."
    return f"✅ VIN *{vin}* asignado a *{nuevo_responsable}*"


async def agregar_comentario(vin: str, texto: str, telefono: str) -> str:
    """Agrega un comentario al historial del VIN y actualiza el campo comentario."""
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No pude identificarte."

    vin = vin.upper().strip()
    await db.upsert_gestion_field(vin, "comentario", texto, user["name"], user["email"])
    await db.add_comentario_historial(vin, texto, user["name"], user["email"])
    return f"✅ Comentario guardado en VIN *{vin}*"


async def set_proxima_accion(vin: str, accion: str, telefono: str) -> str:
    """Define la próxima acción concreta para un VIN."""
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No pude identificarte."

    vin = vin.upper().strip()
    ok = await db.upsert_gestion_field(vin, "proximaAccion", accion, user["name"], user["email"])
    if not ok:
        return f"No pude actualizar el VIN {vin}."
    return f"✅ Próxima acción guardada para VIN *{vin}*: _{accion}_"


async def get_alarmas(telefono: str) -> str:
    """Casos críticos o vencidos que necesitan acción urgente."""
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No pude identificarte."

    marcas = user.get("marcas") or []
    stock_vins = await db.get_vins_for_marcas(marcas)
    vins = [v["vin"] for v in stock_vins]
    gestiones = await db.get_gestiones_for_vins(vins)
    activas = [g for g in gestiones if g["estadoGestion"] in ESTADOS_ACTIVOS]

    today = date.today()
    alarmas = []
    for g in activas:
        motivos = []
        fc = g.get("fechaCompromiso")
        if fc:
            fc_date = fc.date() if isinstance(fc, datetime) else datetime.fromisoformat(str(fc)).date()
            if fc_date <= today:
                diff = (today - fc_date).days
                motivos.append(f"vencida hace {diff}d" if diff > 0 else "vence hoy")
        if g.get("prioridadManual") == "CRITICA":
            motivos.append("prioridad CRÍTICA")
        dias = _dias_sin_movimiento(g)
        if dias >= 7:
            motivos.append(f"sin movimiento {dias}d")
        if motivos:
            alarmas.append((g["vin"], g.get("prioridadManual"), ", ".join(motivos)))

    if not alarmas:
        return "✅ Sin alarmas activas. Todo bajo control."

    lines = [f"*⚠️ Alarmas — {user['name']}* ({len(alarmas)} casos)\n"]
    for vin, prioridad, motivo in alarmas:
        emoji = PRIORIDAD_EMOJI.get(prioridad, "⚪")
        lines.append(f"{emoji} *{vin}* — {motivo}")

    return "\n".join(lines)
