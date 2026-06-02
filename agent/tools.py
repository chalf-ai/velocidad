"""
Herramientas del agente — lógica compartida entre LangGraph y el MCP server.
Cada función retorna un string legible (formato WhatsApp).
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from typing import Optional

from . import database as db
from .indicadores import (
    SCORE_GERENCIAL,
    ACCIONABILIDAD,
    SEGUIMIENTO_PROACTIVO,
    INACTIVIDAD,
    LOGICA_STOCK_AB,
)

# Roles con visión global (ven todas las marcas sin filtro)
ROLES_VISION_GLOBAL = {"ADMIN", "DIRECTOR", "GERENTE_GENERAL"}

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

    if user.get("rol") in ROLES_VISION_GLOBAL:
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


async def analisis_capital(telefono: str) -> str:
    """Tendencia del capital de trabajo comparando los últimos snapshots históricos."""
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No encontré tu usuario en el sistema."

    es_admin = user.get("rol") in ROLES_VISION_GLOBAL
    marcas = None if es_admin else (user.get("marcas") or [])
    nombre = user.get("name", "Usuario")

    snapshots = await db.get_snapshots_historicos(limit=5)
    if not snapshots:
        return "No hay snapshots históricos disponibles para analizar."

    if len(snapshots) < 2:
        return "Se necesitan al menos 2 cargues de stock para analizar tendencias. Sube más datos históricos."

    # Obtener KPIs de cada snapshot
    kpis_list = []
    for snap in snapshots:
        kpis = await db.get_kpis_snapshot(snap["id"], marcas)
        kpis["fecha"] = snap.get("fechaCorte") or snap.get("createdAt")
        kpis["snapshot_id"] = snap["id"]
        kpis_list.append(kpis)

    # Ordenar de más antiguo a más reciente para mostrar evolución
    kpis_list.sort(key=lambda x: x["fecha"])

    ultimo = kpis_list[-1]
    penultimo = kpis_list[-2]

    def delta(nuevo, viejo) -> str:
        if viejo == 0:
            return ""
        diff = nuevo - viejo
        if diff > 0:
            return f" (+{diff:.1f} ⬆️)"
        elif diff < 0:
            return f" ({diff:.1f} ⬇️)"
        return " (=)"

    def tendencia_capital(nuevo, viejo) -> str:
        if viejo == 0:
            return ""
        diff = nuevo - viejo
        # Para capital: bajar es bueno (menos capital inmovilizado)
        if diff < -1:
            return " ✅"
        elif diff > 1:
            return " ⚠️"
        return " ➡️"

    scope = "Grupo completo" if es_admin else f"Marcas: {', '.join(marcas or [])}"
    today_str = date.today().strftime("%d/%m/%Y")

    lines = [f"*Análisis de Capital de Trabajo* 📈\n"]
    lines.append(f"_{scope} · Generado {today_str}_\n")

    # Tabla de evolución
    lines.append("*Evolución histórica:*")
    for k in kpis_list:
        fecha_str = k["fecha"].strftime("%d/%m") if hasattr(k["fecha"], "strftime") else str(k["fecha"])[:10]
        lines.append(
            f"• {fecha_str}: {k['total']} VINs · FloorPlan: {k['floor_plan']} · "
            f"Capital: ${k['capital_mm']:.1f}M"
        )

    # Comparación última semana
    lines.append("\n*Última variación:*")
    d_total = ultimo["total"] - penultimo["total"]
    d_fp = ultimo["floor_plan"] - penultimo["floor_plan"]
    d_cap = ultimo["capital_mm"] - penultimo["capital_mm"]

    stock_icon = "✅" if d_total < 0 else ("⚠️" if d_total > 3 else "➡️")
    fp_icon = "✅" if d_fp < 0 else ("⚠️" if d_fp > 2 else "➡️")
    cap_icon = "✅" if d_cap < -0.5 else ("⚠️" if d_cap > 0.5 else "➡️")

    def fmt_diff(v): return f"+{v}" if v > 0 else str(v)

    lines.append(f"• Stock total: {ultimo['total']} VINs ({fmt_diff(d_total)}) {stock_icon}")
    lines.append(f"• FloorPlan: {ultimo['floor_plan']} ({fmt_diff(d_fp)}) {fp_icon}")
    lines.append(f"• Capital invertido: ${ultimo['capital_mm']:.1f}M ({fmt_diff(round(d_cap,1))}M) {cap_icon}")

    # Diagnóstico
    señales_positivas = sum([d_total < 0, d_fp < 0, d_cap < 0])
    señales_negativas = sum([d_total > 3, d_fp > 2, d_cap > 0.5])

    lines.append("\n*Diagnóstico:*")
    if señales_positivas >= 2:
        lines.append("✅ _Capital mejorando: stock reduciéndose y/o menos FloorPlan._")
    elif señales_negativas >= 2:
        lines.append("⚠️ _Capital bajo presión: stock creciendo y mayor exposición._")
    else:
        lines.append("➡️ _Capital estable sin variaciones significativas._")

    lines.append("\n_Para detallar una marca específica o un VIN, escríbeme._")
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
    """Ficha completa de un VIN con contexto temporal: estado, historial y si se viene arrastrando."""
    vin = vin.upper().strip()
    gestion, historial, temporal, stock = await asyncio.gather(
        db.get_gestion_by_vin(vin),
        db.get_historial_vin(vin, limit=6),
        db.get_contexto_temporal_vin(vin),
        db.get_vin_en_stock(vin),
    )

    if not gestion and not stock:
        return f"No encontré el VIN *{vin}* en el sistema."

    if not gestion:
        return f"No hay gestión registrada para el VIN *{vin}*. ¿Lo creamos?"

    prioridad = gestion.get("prioridadManual")
    estado = gestion.get("estadoGestion", "ABIERTO")
    emoji = PRIORIDAD_EMOJI.get(prioridad, "⚪")

    # Tipo de stock y lógica de gestión correspondiente
    stock_ab = (stock.get("stockAB") or "A") if stock else None
    logica = LOGICA_STOCK_AB.get(stock_ab) if stock_ab else None

    lines = [f"*{vin}* {emoji}  {ESTADO_LABEL.get(estado, estado)}"]
    if stock:
        tipo_label = logica["nombre"] if logica else stock_ab
        dias_stock = stock.get("dias_stock")
        costo = stock.get("costo_mm", 0)
        lines.append(
            f"{stock.get('marca','')} {stock.get('modelo','')}  "
            f"*{tipo_label}*  ${costo:.2f}M  {f'{dias_stock}d' if dias_stock else ''}"
        )
        # Alerta de antigüedad según tipo
        if logica and dias_stock:
            if dias_stock >= logica["umbral_critico_dias"]:
                lines.append(f"🔴 _{logica['escalada']}_")
            elif dias_stock >= logica["umbral_alerta_dias"]:
                accion_sugerida = logica["acciones"][0]
                lines.append(f"⚠️ _{accion_sugerida}_")
    if prioridad:
        lines.append(f"Prioridad: *{prioridad}*")
    if gestion.get("responsable"):
        lines.append(f"Responsable: {gestion['responsable']}")
    if gestion.get("fechaCompromiso"):
        lines.append(f"Compromiso: {_fecha_str(gestion['fechaCompromiso'])}")

    # Contexto temporal — lo más importante para entender si es un caso arrastrado
    snaps = temporal.get("snapshots_sin_cambio", 0)
    dias_total = temporal.get("dias_en_gestion", 0)
    if temporal.get("es_cronico"):
        lines.append(f"\n⏳ *Caso crónico* — {snaps} informes consecutivos sin cambio ({dias_total}d en gestión)")
    elif snaps > 1:
        lines.append(f"\n_En gestión hace {dias_total}d · {snaps} informes sin cambio de estado_")

    # Último comentario de gerencia sin respuesta posterior
    uc = temporal.get("ultimo_comentario_gerencia")
    if uc and uc["hace_dias"] > 3:
        lines.append(f"\n🔔 *{uc['usuario']}* ({uc['rol']}) hace {uc['hace_dias']}d:")
        lines.append(f'_"{uc["texto"]}"_')

    if gestion.get("comentario"):
        lines.append(f"\n📝 _{gestion['comentario']}_")
    if gestion.get("proximaAccion"):
        lines.append(f"▶️ {gestion['proximaAccion']}")

    if historial:
        lines.append("\n*Historial:*")
        for h in historial:
            ts = _fecha_str(h.get("createdAt"))
            usuario = h.get("usuario", "?")
            campo = h.get("campo", "")
            nuevo = h.get("valorNuevo", "") or ""
            lines.append(f"• {ts} {usuario} · {campo}: {nuevo[:60]}")

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

    # HOOK DE ESCALADA — pendiente de activar
    # Cuando un usuario con rol GERENTE/GERENTE_GENERAL/DIRECTOR/ADMIN deja un comentario,
    # se debe notificar por WhatsApp al responsable del VIN (responsableEmail en GestionVIN).
    # Implementar cuando se habiliten las notificaciones push entre usuarios.
    #
    # rol = user.get("rol", "")
    # if rol in ("GERENTE", "GERENTE_GENERAL", "DIRECTOR", "ADMIN"):
    #     gestion = await db.get_gestion_by_vin(vin)
    #     responsable_email = gestion and gestion.get("responsableEmail")
    #     if responsable_email:
    #         responsable = await db.get_user_by_email(responsable_email)
    #         if responsable and responsable.get("telefono"):
    #             msg = (
    #                 f"🔔 *{user['name']}* ({rol}) comentó en VIN *{vin}*:\n"
    #                 f'_"{texto}"_\n'
    #                 f"Actualiza el caso cuando puedas."
    #             )
    #             await send_text(responsable["telefono"], msg)

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


async def resumen_capital(telefono: str) -> str:
    """Capital de trabajo desglosado por tipo, con alertas de inmovilizados."""
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No pude identificarte."

    es_admin = user.get("rol") in ROLES_VISION_GLOBAL
    marcas = None if es_admin else (user.get("marcas") or [])

    kpis = await db.get_capital_breakdown(marcas)
    if not kpis or not kpis.get("total_unidades"):
        return "No hay datos de stock disponibles."

    propio = kpis.get("capital_propio_mm") or 0
    floorplan = kpis.get("capital_floorplan_mm") or 0
    financiado = kpis.get("capital_financiado_mm") or 0
    total = propio + floorplan + financiado

    scope = "Grupo completo" if es_admin else f"Marcas: {', '.join(marcas or [])}"
    lines = [f"*Capital de Trabajo* 💰\n_{scope}_\n"]
    lines.append(f"*Total: ${total:.1f}M* ({kpis.get('total_unidades', 0)} unidades)\n")
    lines.append("*Origen:*")
    lines.append(f"• Propio / FinPropio: ${propio:.1f}M")
    lines.append(f"• FloorPlan: ${floorplan:.1f}M")
    lines.append(f"• Financiado: ${financiado:.1f}M")
    vpp = kpis.get("capital_vpp_mm") or 0
    if vpp:
        lines.append(f"• VPP comprometido: ${vpp:.1f}M ({kpis.get('unidades_vpp', 0)} VINs)")

    alertas = []
    if kpis.get("unidades_mas_180", 0) > 0:
        alertas.append(
            f"🔴 {kpis['unidades_mas_180']} VINs >180d en stock — "
            f"${kpis.get('capital_mas_180_mm', 0):.1f}M inmovilizados"
        )
    if kpis.get("pagados_sin_rotacion", 0) > 0:
        alertas.append(f"⏱ {kpis['pagados_sin_rotacion']} pagados sin rotación >60d")
    if kpis.get("unidades_judicial", 0) > 0:
        alertas.append(f"⚖️ {kpis['unidades_judicial']} judiciales")
    if kpis.get("unidades_stock_b", 0) > 0:
        alertas.append(f"📦 {kpis['unidades_stock_b']} Stock B")

    if alertas:
        lines.append("\n*⚠️ Alertas de capital:*")
        lines.extend(alertas)

    return "\n".join(lines)


async def detalle_fne(telefono: str) -> str:
    """Estado de Facturados No Entregados: total, aging, detenidos >15d."""
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No pude identificarte."

    fne = await db.get_fne_resumen()
    if not fne or not fne.get("total_fne"):
        return "No hay datos FNE disponibles o no hay FNE activos."

    lines = ["*Facturados No Entregados (FNE)* 🚗\n"]
    lines.append(f"*Total: {fne['total_fne']} unidades*\n")
    lines.append("*Por antigüedad:*")
    lines.append(f"• 0-3 días:  {fne.get('bucket_0_3', 0)} ✅")
    lines.append(f"• 4-7 días:  {fne.get('bucket_4_7', 0)}")
    lines.append(f"• 8-15 días: {fne.get('bucket_8_15', 0)}")
    detenidos = fne.get("bucket_16_mas", 0)
    lines.append(f"• +16 días:  {detenidos} {'⚠️' if detenidos else ''}")

    if fne.get("detenidos_mas_15", 0) > 0:
        lines.append(
            f"\n⚠️ *{fne['detenidos_mas_15']} VINs detenidos >15d* — "
            f"${fne.get('capital_detenido_mm', 0):.1f}M retenidos"
        )
        lines.append("_Acción: acelerar entrega o cobrar diferencia._")

    return "\n".join(lines)


async def lineas_credito(telefono: str) -> str:
    """Estado de líneas de crédito por marca."""
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No pude identificarte."

    es_admin = user.get("rol") in ROLES_VISION_GLOBAL
    marcas = None if es_admin else (user.get("marcas") or [])

    lineas = await db.get_lineas_credito_resumen(marcas)
    if not lineas:
        return "No hay datos de líneas de crédito disponibles."

    SEMAFORO = {"verde": "🟢", "amarillo": "🟡", "rojo": "🔴", "sobregirada": "🔴🔴"}

    lines = ["*Líneas de Crédito* 💳\n"]
    for l in lineas:
        emoji = SEMAFORO.get(l.get("semaforo", ""), "⚪")
        sufijo = " ⚠️ SOBREGIRADA" if l.get("semaforo") == "sobregirada" else ""
        lines.append(
            f"{emoji} *{l['marca']}*: ${l.get('ocupado_mm', 0):.1f}M / "
            f"${l.get('autorizado_mm', 0):.1f}M "
            f"({l.get('pct_ocupacion', 0):.0f}%){sufijo}"
        )

    criticas = [l for l in lineas if l.get("semaforo") in ("sobregirada", "rojo")]
    if criticas:
        lines.append(f"\n🔴 *{len(criticas)} línea(s) en zona roja* — requieren atención")

    return "\n".join(lines)


async def alertas_stock(telefono: str) -> str:
    """Alertas de stock: inmovilizados >180d, pagados sin rotación, judiciales, Stock B."""
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No pude identificarte."

    es_admin = user.get("rol") in ROLES_VISION_GLOBAL
    marcas = None if es_admin else (user.get("marcas") or [])

    alertas = await db.get_alertas_stock(marcas)
    if not alertas:
        return "✅ Sin alertas de stock activas."

    mas_180 = [a for a in alertas if (a.get("dias_stock") or 0) >= 180]
    pagados_60 = [
        a for a in alertas
        if a.get("pagado") and 60 <= (a.get("dias_stock") or 0) < 180
    ]
    judicial = [a for a in alertas if a.get("judicial")]
    stock_b_list = [a for a in alertas if a.get("stock_b")]

    lines = ["*⚠️ Alertas Operacionales de Stock*\n"]

    if mas_180:
        lines.append(f"*🔴 Inmovilizados >180d — {len(mas_180)} VINs:*")
        for a in mas_180[:10]:
            lines.append(f"• {a['vin']} {a.get('modelo', '')} ({a.get('marca', '')}) — {a.get('dias_stock', 0)}d / ${a.get('costo_mm', 0):.1f}M")
        if len(mas_180) > 10:
            lines.append(f"  _...y {len(mas_180) - 10} más_")

    if pagados_60:
        lines.append(f"\n*⏱ Pagados sin rotación >60d — {len(pagados_60)} VINs:*")
        for a in pagados_60[:8]:
            lines.append(f"• {a['vin']} {a.get('modelo', '')} — {a.get('dias_stock', 0)}d")
        if len(pagados_60) > 8:
            lines.append(f"  _...y {len(pagados_60) - 8} más_")

    if judicial:
        lines.append(f"\n*⚖️ Judiciales — {len(judicial)} VINs:*")
        for a in judicial[:5]:
            lines.append(f"• {a['vin']} {a.get('modelo', '')} ({a.get('marca', '')})")

    if stock_b_list:
        lines.append(f"\n*📦 Stock B — {len(stock_b_list)} VINs:*")
        for a in stock_b_list[:5]:
            lines.append(f"• {a['vin']} {a.get('modelo', '')} ({a.get('marca', '')})")

    return "\n".join(lines)


# ── Capital consolidado — los 4 conceptos en una vista ───────────────────────

async def capital_consolidado(telefono: str) -> str:
    """
    Cuadro unificado de capital inmovilizado: Stock + FNE + Saldos + Provisiones.
    Incluye score gerencial actual y variación vs snapshot anterior.
    """
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No pude identificarte."

    es_admin = user.get("rol") in ("ADMIN", "DIRECTOR", "GERENTE_GENERAL")
    marcas = None if es_admin else (user.get("marcas") or [])

    # Carga paralela de los 4 conceptos
    stock, fne, saldos, provisiones = await asyncio.gather(
        db.get_capital_breakdown(marcas),
        db.get_fne_resumen(),
        db.get_saldos_resumen(marcas),
        db.get_provisiones_resumen(marcas),
    )

    # Totales
    stock_mm = (
        (stock.get("capital_propio_mm") or 0)
        + (stock.get("capital_floorplan_mm") or 0)
        + (stock.get("capital_financiado_mm") or 0)
    )
    fne_mm = (fne.get("capital_detenido_mm") or 0)  # solo detenidos >15d como capital "real"
    saldos_mm = (saldos.get("saldo_vehiculo_mm") or 0) + (saldos.get("saldo_bono_mm") or 0)
    prov_mm = (provisiones.get("saldo_pendiente_mm") or 0)
    total_mm = stock_mm + fne_mm + saldos_mm + prov_mm

    lines = ["*Capital de trabajo*\n"]
    lines.append(f"{'Grupo completo' if es_admin else ', '.join(marcas or [])}\n")

    lines.append(f"*Total: ${total_mm:.1f}M*\n")
    lines.append("*Por concepto:*")
    lines.append(f"• Stock          ${stock_mm:.1f}M  ({stock.get('total_unidades', 0)} VINs)")
    lines.append(f"• FNE detenidos  ${fne_mm:.1f}M  ({fne.get('detenidos_mas_15', 0)} VINs >15d)")
    lines.append(f"• Saldos         ${saldos_mm:.1f}M  ({saldos.get('total_vehiculo', 0) + saldos.get('total_bono', 0)} docs)")
    lines.append(f"• Provisiones    ${prov_mm:.1f}M  ({provisiones.get('abiertas', 0)} abiertas)")

    # Score gerencial — alertas por indicador
    alertas_score = []
    cfg = SCORE_GERENCIAL

    # I1: stock propio
    sp_mm = stock.get("capital_propio_mm") or 0
    if stock_mm > 0:
        pct_propio = (sp_mm / stock_mm) * 100
        if pct_propio > cfg["stock_propio"]["meta"]:
            alertas_score.append(
                f"Stock propio {pct_propio:.1f}% (meta ≤{cfg['stock_propio']['meta']}%) — "
                f"${sp_mm:.1f}M · {cfg['stock_propio']['accion']}"
            )

    # I2: provisiones >90d
    prov_criticas = provisiones.get("criticas_90d_count") or 0
    if prov_criticas > cfg["provisiones_90d"]["meta"]:
        alertas_score.append(
            f"{prov_criticas} provisiones >90d — "
            f"${provisiones.get('criticas_90d_mm', 0):.1f}M · {cfg['provisiones_90d']['accion']}"
        )

    # I3: CP >15d
    cp_count = saldos.get("cp_vencido_count") or 0
    if cp_count > cfg["cp_15d"]["meta"]:
        alertas_score.append(
            f"{cp_count} CP vencidos >15d — "
            f"${saldos.get('cp_vencido_mm', 0):.1f}M · {cfg['cp_15d']['accion']}"
        )

    # I4: saldos T3+
    t3_mm = saldos.get("vehiculo_t3_mm") or 0
    saldos_veh_mm = saldos.get("saldo_vehiculo_mm") or 0
    if saldos_veh_mm > 0:
        pct_t3 = (t3_mm / saldos_veh_mm) * 100
        if pct_t3 > cfg["saldos_t3"]["meta"]:
            alertas_score.append(
                f"Saldos T3+ {pct_t3:.1f}% del total (meta ≤{cfg['saldos_t3']['meta']}%) — "
                f"${t3_mm:.1f}M · {cfg['saldos_t3']['accion']}"
            )

    if alertas_score:
        lines.append("\n*Para mejorar el score:*")
        for a in alertas_score:
            lines.append(f"⚠️ {a}")

    return "\n".join(lines)


# ── Accionables — casos rápidos sin gestión reciente ─────────────────────────

async def capital_accionable(telefono: str) -> str:
    """
    Casos accionables rápidos sin comentario reciente.
    César usa esto para preguntar '¿lo gestionaste?' sobre cada caso.
    """
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No pude identificarte."

    es_admin = user.get("rol") in ("ADMIN", "DIRECTOR", "GERENTE_GENERAL")
    marcas = None if es_admin else (user.get("marcas") or [])

    # Carga paralela de los accionables por concepto
    fne_data, saldos_data, provisiones_data, stock_data = await asyncio.gather(
        db.get_fne_resumen(),
        db.get_saldos_accionables(marcas),
        db.get_provisiones_accionables(marcas),
        db.get_alertas_stock(marcas),
    )

    dias_limite = INACTIVIDAD["dias_seguimiento_sin_comentario"]
    lines = ["*Accionables rápidos*\n"]
    hay_algo = False

    # FNE detenidos >15d
    fne_detenidos = fne_data.get("detenidos_mas_15", 0)
    if fne_detenidos:
        hay_algo = True
        cap = fne_data.get("capital_detenido_mm", 0)
        tmpl = SEGUIMIENTO_PROACTIVO.get("fne_sin_solicitud", "")
        lines.append(f"*FNE detenidos >15d — {fne_detenidos} VINs · ${cap:.1f}M*")
        lines.append(f"_Acción: {ACCIONABILIDAD['fne_listo_entregar']['accion']}_\n")

    # Saldos: CP vencido
    cp_casos = [s for s in saldos_data if s.get("sub_tipo") == "credito_pompeyo"]
    if cp_casos:
        hay_algo = True
        total_cp = sum(s.get("saldo_mm", 0) for s in cp_casos)
        lines.append(f"*CP >15d — {len(cp_casos)} casos · ${total_cp:.1f}M*")
        for c in cp_casos[:5]:
            pregunta = SEGUIMIENTO_PROACTIVO["cp_vencido"].format(
                vin=c.get("vin_o_cajon", "?"),
                dias=c.get("dias", 0),
                monto_mm=c.get("saldo_mm", 0),
            )
            lines.append(f"• {pregunta}")
        if len(cp_casos) > 5:
            lines.append(f"  _...y {len(cp_casos) - 5} más_")
        lines.append("")

    # Saldos: T3+
    t3_casos = [s for s in saldos_data if s.get("sub_tipo") != "credito_pompeyo"]
    if t3_casos:
        hay_algo = True
        total_t3 = sum(s.get("saldo_mm", 0) for s in t3_casos)
        lines.append(f"*Saldos T3+ — {len(t3_casos)} casos · ${total_t3:.1f}M*")
        for c in t3_casos[:5]:
            lines.append(
                f"• {c.get('vin_o_cajon','?')} {c.get('marca','')} "
                f"· {c.get('tramo','')} · ${c.get('saldo_mm',0):.1f}M"
            )
        lines.append("")

    # Provisiones >90d
    if provisiones_data:
        hay_algo = True
        total_prov = sum(p.get("monto_mm", 0) for p in provisiones_data)
        lines.append(f"*Provisiones >90d — {len(provisiones_data)} casos · ${total_prov:.1f}M*")
        for p in provisiones_data[:5]:
            pregunta = SEGUIMIENTO_PROACTIVO["provision_90d_plus"].format(
                concepto=p.get("concepto", "?"),
                marca=p.get("marca", "?"),
                dias=p.get("dias", 0),
                monto_mm=p.get("monto_mm", 0),
            )
            lines.append(f"• {pregunta}")
        if len(provisiones_data) > 5:
            lines.append(f"  _...y {len(provisiones_data) - 5} más_")
        lines.append("")

    # Stock pagado sin rotación (accionable rápido)
    pagados = [a for a in stock_data if a.get("pagado") and (a.get("dias_stock") or 0) >= 60]
    if pagados:
        hay_algo = True
        total_pag = sum(a.get("costo_mm", 0) for a in pagados)
        lines.append(f"*Stock pagado >60d — {len(pagados)} VINs · ${total_pag:.1f}M*")
        for a in pagados[:5]:
            pregunta = SEGUIMIENTO_PROACTIVO["stock_pagado_sin_rotacion"].format(
                vin=a.get("vin", "?"),
                dias=a.get("dias_stock", 0),
                monto_mm=a.get("costo_mm", 0),
            )
            lines.append(f"• {pregunta}")
        lines.append("")

    if not hay_algo:
        return "Sin accionables rápidos pendientes. Todo gestionado."

    return "\n".join(lines)


# ── FNE detalle y pipeline ────────────────────────────────────────────────────

ESTADO_ENTREGA_LABEL = {
    "listo_entregar":      "✅ Listo para entregar",
    "falta_autorizacion":  "🟡 Falta autorización",
    "patente_en_sucursal": "📋 Patente en sucursal",
    "patente_en_transito": "🚚 Patente en tránsito",
    "patente_en_admin":    "🏢 Patente en admin",
    "en_registro_civil":   "⚖️  En Registro Civil",
    "en_control_negocios": "📝 En Control de Negocios",
    "sin_solicitud":       "⚠️ Sin solicitud inscripción",
}

ESTADO_ENTREGA_ACCION = {
    "listo_entregar":      "Llamar al cliente hoy para coordinar entrega",
    "falta_autorizacion":  "Gestionar autorización con administración",
    "patente_en_sucursal": "Solicitar entrega a sucursal",
    "patente_en_transito": "Confirmar recepción con sucursal",
    "patente_en_admin":    "Enviar patente a sucursal hoy",
    "en_registro_civil":   "Hacer seguimiento con Control de Negocios",
    "en_control_negocios": "Verificar que CdN envió a Registro Civil",
    "sin_solicitud":       "Solicitar inscripción inmediatamente",
}


async def fne_detalle(telefono: str) -> str:
    """Lista completa de FNE con estado de pipeline por auto."""
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No pude identificarte."

    datos = await db.get_fne_detalle()
    if not datos:
        return "No hay FNE activos."

    total_mm = sum(d.get("valor_mm") or 0 for d in datos)
    lines = [f"*FNE — {len(datos)} autos · ${total_mm:.1f}M*\n"]

    # Agrupar por estado de entrega (prioridad: más listo primero)
    orden = ["listo_entregar", "falta_autorizacion", "patente_en_sucursal",
             "patente_en_transito", "patente_en_admin", "en_registro_civil",
             "en_control_negocios", "sin_solicitud"]

    por_estado: dict[str, list] = {}
    for d in datos:
        por_estado.setdefault(d.get("estado_entrega", "sin_solicitud"), []).append(d)

    for estado in orden:
        casos = por_estado.get(estado, [])
        if not casos:
            continue
        mm = sum(c.get("valor_mm") or 0 for c in casos)
        label = ESTADO_ENTREGA_LABEL.get(estado, estado)
        accion = ESTADO_ENTREGA_ACCION.get(estado, "")
        lines.append(f"*{label} — {len(casos)} · ${mm:.1f}M*")
        lines.append(f"_Acción: {accion}_")
        for c in casos[:6]:
            dias = f"{c.get('dias',0)}d" if c.get("dias") else "?"
            cliente = f" · {c['cliente']}" if c.get("cliente") else ""
            lines.append(f"  • {c.get('vin','?')}  {c.get('sucursal','')}  {dias}{cliente}")
        if len(casos) > 6:
            lines.append(f"  _...y {len(casos)-6} más_")
        lines.append("")

    return "\n".join(lines)


async def fne_por_vin(vin: str, telefono: str) -> str:
    """Pipeline completo de un VIN específico en FNE."""
    vin = vin.upper().strip()
    fne = await db.get_fne_por_vin(vin)
    if not fne:
        return f"El VIN *{vin}* no aparece en FNE activo."

    estado = fne.get("estado_entrega") or "sin_solicitud"
    label = ESTADO_ENTREGA_LABEL.get(estado, estado)
    accion = ESTADO_ENTREGA_ACCION.get(estado, "")

    lines = [f"*FNE: {vin}*  {label}\n"]
    lines.append(f"💰 ${fne.get('valor_mm',0):.2f}M  ·  {fne.get('dias','?')}d  ·  {fne.get('aging','')} ")
    if fne.get("cliente"):
        lines.append(f"Cliente: {fne['cliente']}")
    if fne.get("vendedor"):
        lines.append(f"Vendedor: {fne['vendedor']}")
    if fne.get("sucursal"):
        lines.append(f"Sucursal: {fne['sucursal']}")

    lines.append("\n*Pipeline patente:*")
    checks = [
        ("Solicitud inscripción", fne.get("solicito_inscripcion")),
        ("En Registro Civil",     fne.get("fecha_solicitud_inscripcion")),
        ("Patente en admin",      fne.get("patente_en_admin")),
        ("Patente enviada",       fne.get("patente_enviada")),
        ("Patente recibida",      fne.get("patente_recibida")),
        ("Sol. entrega",          fne.get("tiene_sol_entrega")),
        ("Autorización entrega",  fne.get("tiene_autorizacion")),
    ]
    for nombre, valor in checks:
        icono = "✅" if valor else "⬜"
        lines.append(f"  {icono} {nombre}")

    lines.append(f"\n▶️ *{accion}*")
    return "\n".join(lines)


# ── Vista 360° de un VIN ──────────────────────────────────────────────────────

async def vin_360(vin: str, telefono: str) -> str:
    """
    Vista completa de un VIN cruzando las 4 fuentes:
    stock actual, FNE, saldos y gestión.
    """
    vin = vin.upper().strip()

    stock, fne, saldos, gestion, historial = await asyncio.gather(
        db.get_vin_en_stock(vin),
        db.get_fne_por_vin(vin),
        db.get_vin_en_saldos(vin),
        db.get_gestion_by_vin(vin),
        db.get_historial_vin(vin, limit=4),
    )

    if not stock and not fne and not saldos and not gestion:
        return f"No encontré el VIN *{vin}* en ninguna fuente de datos."

    lines = [f"*{vin} — Vista 360°*\n"]

    # Stock
    if stock:
        lines.append("*📦 En stock:*")
        lines.append(
            f"  {stock.get('marca','')} {stock.get('modelo','')}  "
            f"${stock.get('costo_mm',0):.2f}M  "
            f"{stock.get('tipo_stock','')}  "
            f"{stock.get('dias_stock','?')}d"
        )
        alertas = []
        if stock.get("judicial"):   alertas.append("⚖️ Judicial")
        if stock.get("stock_b"):    alertas.append("📦 Stock B")
        if stock.get("vpp"):        alertas.append("🔄 VPP")
        if stock.get("pagado"):     alertas.append("💳 Pagado")
        if alertas:
            lines.append(f"  {' · '.join(alertas)}")
    else:
        lines.append("_No está en stock activo_")

    # FNE
    if fne:
        estado = ESTADO_ENTREGA_LABEL.get(fne.get("estado_entrega",""), "")
        lines.append(f"\n*🚗 En FNE:*  {estado}")
        lines.append(
            f"  ${fne.get('valor_mm',0):.2f}M  ·  {fne.get('dias','?')}d  ·  "
            f"{fne.get('cliente') or 'sin cliente'}"
        )
        accion = ESTADO_ENTREGA_ACCION.get(fne.get("estado_entrega",""), "")
        if accion:
            lines.append(f"  ▶️ {accion}")

    # Saldos
    if saldos:
        total_s = sum(s.get("saldo_mm") or 0 for s in saldos)
        lines.append(f"\n*💰 Saldos ({len(saldos)} · ${total_s:.2f}M):*")
        for s in saldos:
            lines.append(
                f"  {s.get('sub_tipo','')}  {s.get('tramo','')}  "
                f"${s.get('saldo_mm',0):.2f}M  {s.get('dias',0)}d  "
                f"{s.get('financiera') or ''}"
            )

    # Gestión
    if gestion:
        prioridad = gestion.get("prioridadManual")
        estado_g = gestion.get("estadoGestion","")
        emoji = PRIORIDAD_EMOJI.get(prioridad, "⚪")
        lines.append(f"\n*🗂 Gestión:*  {emoji} {ESTADO_LABEL.get(estado_g, estado_g)}")
        if gestion.get("responsable"):
            lines.append(f"  Responsable: {gestion['responsable']}")
        if gestion.get("comentario"):
            lines.append(f"  📝 _{gestion['comentario']}_")
        if gestion.get("proximaAccion"):
            lines.append(f"  ▶️ {gestion['proximaAccion']}")
        if historial:
            lines.append(f"  _Último movimiento: {_fecha_str(historial[0].get('createdAt'))}_")

    return "\n".join(lines)


# ── Detalle provisiones ───────────────────────────────────────────────────────

async def detalle_provisiones(telefono: str) -> str:
    """Lista completa de provisiones no facturadas con ID, marca, concepto, monto y aging."""
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No pude identificarte."

    es_admin = user.get("rol") in ROLES_VISION_GLOBAL
    marcas = None if es_admin else (user.get("marcas") or [])

    datos = await db.get_provisiones_detalle(marcas, solo_abiertas=True)
    if not datos:
        return "Sin provisiones abiertas."

    total_mm = sum(d.get("saldo_mm") or 0 for d in datos)
    lines = [f"*Provisiones abiertas — {len(datos)} · ${total_mm:.1f}M*\n"]

    # Agrupar por marca
    por_marca: dict[str, list] = {}
    for d in datos:
        por_marca.setdefault(d.get("marca") or "Sin marca", []).append(d)

    for marca, items in sorted(por_marca.items(), key=lambda x: -sum(i.get("saldo_mm", 0) for i in x[1])):
        mm = sum(i.get("saldo_mm") or 0 for i in items)
        lines.append(f"*{marca}* — {len(items)} · ${mm:.1f}M")
        for p in items:
            critico = " 🔴" if (p.get("dias") or 0) > 90 else ""
            ajuste = f" ⚠️ {p['estado_ajuste']}" if p.get("estado_ajuste") else ""
            lines.append(
                f"  `{p.get('id_provision','?')}` "
                f"{p.get('concepto','?')}  "
                f"${p.get('saldo_mm',0):.2f}M  "
                f"{p.get('dias',0)}d{critico}{ajuste}"
            )

    return "\n".join(lines)


# ── Capital por marca — drill-down ejecutivo ──────────────────────────────────

async def capital_por_marca(telefono: str) -> str:
    """Capital de stock desglosado por marca. Para GERENTE_GENERAL ve todo el grupo."""
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No pude identificarte."

    es_admin = user.get("rol") in ROLES_VISION_GLOBAL
    marcas = None if es_admin else (user.get("marcas") or [])

    datos = await db.get_capital_por_marca(marcas)
    if not datos:
        return "No hay datos de stock disponibles."

    total_mm = sum(d.get("capital_mm") or 0 for d in datos)
    total_vins = sum(d.get("unidades") or 0 for d in datos)

    lines = [f"*Capital por marca* — ${total_mm:.1f}M · {total_vins} VINs\n"]

    for d in datos:
        propio = d.get("propio_mm") or 0
        fp = d.get("floorplan_mm") or 0
        inmov = d.get("inmovilizados") or 0
        jud = d.get("judiciales") or 0
        alertas = []
        if inmov:
            alertas.append(f"{inmov} >180d")
        if jud:
            alertas.append(f"{jud} jud.")
        sufijo = f"  ⚠️ {', '.join(alertas)}" if alertas else ""
        lines.append(
            f"• *{d['marca']}*  ${d.get('capital_mm',0):.1f}M  "
            f"({d.get('unidades',0)} VINs)  "
            f"Propio ${propio:.1f}M · FP ${fp:.1f}M{sufijo}"
        )

    return "\n".join(lines)


# ── Detalle saldos T3+ ────────────────────────────────────────────────────────

async def detalle_saldos_t3(telefono: str) -> str:
    """Lista completa de saldos vehículo en tramos T3-T7 (>30 días)."""
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No pude identificarte."

    es_admin = user.get("rol") in ROLES_VISION_GLOBAL
    marcas = None if es_admin else (user.get("marcas") or [])

    datos = await db.get_saldos_t3_detalle(marcas)
    if not datos:
        return "Sin saldos T3+ activos."

    total_mm = sum(d.get("saldo_mm") or 0 for d in datos)
    lines = [f"*Saldos T3+ ({len(datos)} casos · ${total_mm:.1f}M)*\n"]

    # Agrupar por tramo para darle estructura
    por_tramo: dict[str, list] = {}
    for d in datos:
        por_tramo.setdefault(d.get("tramo", "?"), []).append(d)

    for tramo in ["T3", "T4", "T5", "T6", "T7"]:
        casos = por_tramo.get(tramo, [])
        if not casos:
            continue
        mm = sum(c.get("saldo_mm") or 0 for c in casos)
        lines.append(f"*{tramo} ({len(casos)} · ${mm:.1f}M):*")
        for c in casos[:8]:
            cliente = f" · {c['cliente']}" if c.get("cliente") else ""
            fin = f" · {c['financiera']}" if c.get("financiera") else ""
            dias = c.get("dias", 0)
            lines.append(
                f"  • {c.get('vin_o_cajon','?')}  {c.get('marca','')}  "
                f"${c.get('saldo_mm',0):.2f}M  {dias}d{cliente}{fin}"
            )
        if len(casos) > 8:
            lines.append(f"  _...y {len(casos)-8} más_")

    return "\n".join(lines)
