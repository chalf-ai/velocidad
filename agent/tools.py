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


async def analisis_capital(telefono: str) -> str:
    """Tendencia del capital de trabajo comparando los últimos snapshots históricos."""
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No encontré tu usuario en el sistema."

    es_admin = user.get("rol") == "ADMIN"
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


async def resumen_capital(telefono: str) -> str:
    """Capital de trabajo desglosado por tipo, con alertas de inmovilizados."""
    user = await db.get_user_by_phone(telefono)
    if not user:
        return "No pude identificarte."

    es_admin = user.get("rol") == "ADMIN"
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

    es_admin = user.get("rol") == "ADMIN"
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

    es_admin = user.get("rol") == "ADMIN"
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
