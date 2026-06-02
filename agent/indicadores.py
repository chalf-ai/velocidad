"""
INDICADORES DE CAPITAL INMOVILIZADO — CÉSAR
============================================

Este archivo es la fuente única de verdad del negocio.
Para cambiar un umbral, una acción, un criterio de accionabilidad o
una pregunta de seguimiento: modifica acá. No toques tools.py ni database.py.

Estructura:
  SCORE_GERENCIAL       → los 4 KPIs oficiales con pesos y umbrales
  CAPITAL_POR_CONCEPTO  → taxonomía de capital parado: qué es, cuánto duele, qué hacer
  ACCIONABILIDAD        → reglas para clasificar fast/medio/bloqueado
  SEGUIMIENTO           → preguntas que César hace cuando algo accionable no tiene comentario
  AGING                 → definición de tramos de antigüedad por fuente
  SEMAFOROS             → umbrales de color por indicador
"""

from __future__ import annotations

# ─────────────────────────────────────────────────────────────────────────────
# SCORE GERENCIAL — 4 indicadores con pesos fijos (suman 100)
#
# Cambiar meta_* o max_* ajusta el scoring sin tocar lógica.
# ─────────────────────────────────────────────────────────────────────────────

SCORE_GERENCIAL: dict[str, dict] = {
    "stock_propio": {
        "id": "stock_propio",
        "nombre": "Stock propio",
        "peso": 40,
        "meta": 5.0,       # ≤5% del stock valorizado → puntos completos
        "max": 20.0,       # ≥20% → 0 puntos (penalización lineal entre meta y max)
        "unidad": "%",
        "descripcion": "Capital propio / FinPropio como % del stock total valorizado",
        "accion": "Reducir stock propio: vender, hacer descuento o pasar a Floor Plan",
        "fuente": "BASE_STOCK · tipoStock IN ('Propio','FinPropio')",
    },
    "provisiones_90d": {
        "id": "provisiones_90d",
        "nombre": "Provisiones >90 días",
        "peso": 40,
        "meta": 0,         # 0 provisiones no facturadas >90d → puntos completos
        "max": 10,         # ≥10 casos → 0 puntos
        "unidad": "casos",
        "descripcion": "Provisiones no facturadas con aging >90 días",
        "accion": "Facturar o reversar provisiones envejecidas (concepto por concepto)",
        "fuente": "PROVISIONES · estado='no_facturada' AND agingDias>90",
    },
    "cp_15d": {
        "id": "cp_15d",
        "nombre": "Crédito Pompeyo >15 días",
        "peso": 10,
        "meta": 0,         # 0 VINs con CP >15d → puntos completos
        "max": 5,          # ≥5 casos → 0 puntos
        "unidad": "casos",
        "descripcion": "VINs con Crédito Pompeyo vigente hace más de 15 días desde la factura",
        "accion": "Cobrar el CP al cliente o cerrar la gestión pendiente",
        "fuente": "SALDOS · subTipo='credito_pompeyo' AND diasArchivo>15",
    },
    "saldos_t3": {
        "id": "saldos_t3",
        "nombre": "Saldos vehículo T3+",
        "peso": 10,
        "meta": 15.0,      # ≤15% del saldo vehículo total → puntos completos
        "max": 40.0,       # ≥40% → 0 puntos
        "unidad": "%",
        "descripcion": "Saldos de vehículos en tramos T3-T7 (>30 días) sobre total saldo vehículo",
        "accion": "Cobrar saldos vehículo en tramos >30 días: gestión activa con financiera",
        "fuente": "SALDOS · categoria='vehiculo' AND statusDPS IN (T3,T4,T5,T6,T7)",
    },
}

# ─────────────────────────────────────────────────────────────────────────────
# CAPITAL POR CONCEPTO — los 4 componentes del capital de trabajo
#
# Cada concepto tiene:
#   fuente       → snapshot de donde viene el dato
#   descripcion  → qué representa este capital
#   por_que_duele → por qué inmovilizar capital acá es un problema
#   horizonte_ideal → cuánto tiempo debería estar acá
# ─────────────────────────────────────────────────────────────────────────────

CAPITAL_POR_CONCEPTO: dict[str, dict] = {
    "stock": {
        "nombre": "Stock",
        "fuente": "BASE_STOCK",
        "descripcion": "Vehículos en inventario físico (Propio, FloorPlan, Financiado)",
        "por_que_duele": "Capital inmovilizado en metal. FloorPlan tiene costo financiero diario. Propio es caja propia parada.",
        "horizonte_ideal_dias": 60,
        "subtipos": {
            "propio":     "Capital 100% de Pompeyo, el más caro de mantener",
            "floorplan":  "Crédito del fabricante, genera interés diario",
            "financiado": "Financiado por institución, depende del plazo pactado",
            "finpropio":  "Financiado pero con aval propio, riesgo mixto",
        },
    },
    "fne": {
        "nombre": "FNE — Facturados No Entregados",
        "fuente": "FNE",
        "descripcion": "Vehículos cuya venta está cerrada pero no se ha entregado al cliente",
        "por_que_duele": "El auto ya salió del inventario comercial pero sigue consumiendo espacio físico, el cliente puede arrepentirse y el capital no se libera hasta la entrega.",
        "horizonte_ideal_dias": 7,
        "subtipos": {
            "listo_entregar":  "Patente en sucursal + autorización = entregar hoy",
            "patente_transito": "Patente enviada, en camino a sucursal",
            "en_tramite":       "Inscripción en proceso en Registro Civil",
            "sin_solicitud":    "No se ha iniciado el trámite de inscripción",
        },
    },
    "saldos": {
        "nombre": "Saldos por documentar",
        "fuente": "SALDOS",
        "descripcion": "Montos de ventas realizadas pendientes de cobro o documentación (financieras, CP, leasing)",
        "por_que_duele": "Plata de ventas ya realizadas que no ha llegado a la cuenta. Después de T2 (>14d) empiezan a ser problemáticas.",
        "horizonte_ideal_dias": 14,
        "subtipos": {
            "financieras":      "Pago pendiente de institución financiera",
            "credito_pompeyo":  "Crédito interno Pompeyo al cliente, cobrar directamente",
            "leasing":          "Saldo de operación de leasing",
            "judicial":         "En proceso legal, horizonte incierto",
            "buy_back":         "Recompra comprometida pendiente",
            "acuerdo_comercial":"Acuerdo especial con marca/distribuidor",
        },
    },
    "provisiones": {
        "nombre": "Provisiones",
        "fuente": "PROVISIONES",
        "descripcion": "Incentivos, bonos y comisiones de marcas provisionados pero no facturados",
        "por_que_duele": "Plata comprometida por la marca que no se ha cobrado. Después de 90d es señal de problema en la gestión del cobro.",
        "horizonte_ideal_dias": 30,
        "subtipos": {
            "incentivo_ventas": "Bono por cumplimiento de objetivo de ventas",
            "bono_marca":       "Bono periódico de fabricante",
            "comision":         "Comisión acordada pendiente de facturación",
        },
    },
}

# ─────────────────────────────────────────────────────────────────────────────
# ACCIONABILIDAD — qué hace que algo sea rápido, medio o bloqueado
#
# Modificar estas reglas cambia cómo César clasifica cada caso.
# ─────────────────────────────────────────────────────────────────────────────

ACCIONABILIDAD: dict[str, dict] = {
    # ── FNE ──────────────────────────────────────────────────────────────────
    "fne_listo_entregar": {
        "concepto": "fne",
        "velocidad": "rapido",
        "criterio": "estadoEntrega='listo_para_entregar' (patente en sucursal + autorización)",
        "accion": "Llamar al cliente hoy para coordinar la entrega",
        "horizonte": "hoy",
        "bloqueo": None,
    },
    "fne_falta_autorizacion": {
        "concepto": "fne",
        "velocidad": "rapido",
        "criterio": "patente en sucursal, falta solo autorización de entrega",
        "accion": "Gestionar autorización con administración",
        "horizonte": "hoy",
        "bloqueo": None,
    },
    "fne_patente_transito": {
        "concepto": "fne",
        "velocidad": "medio",
        "criterio": "patente enviada por admin a sucursal, sin recibir",
        "accion": "Confirmar recepción con la sucursal",
        "horizonte": "2-3 días",
        "bloqueo": None,
    },
    "fne_en_registro_civil": {
        "concepto": "fne",
        "velocidad": "medio",
        "criterio": "solicitud enviada a Registro Civil",
        "accion": "Hacer seguimiento con Control de Negocios",
        "horizonte": "3-5 días",
        "bloqueo": None,
    },
    "fne_sin_solicitud": {
        "concepto": "fne",
        "velocidad": "rapido",
        "criterio": "no se ha iniciado el trámite de inscripción",
        "accion": "Solicitar inscripción inmediatamente a sucursal",
        "horizonte": "hoy",
        "bloqueo": None,
    },

    # ── SALDOS ───────────────────────────────────────────────────────────────
    "cp_vencido": {
        "concepto": "saldos",
        "velocidad": "rapido",
        "criterio": "Crédito Pompeyo con más de 15 días desde la factura",
        "accion": "Contactar al cliente para cobro directo",
        "horizonte": "esta semana",
        "bloqueo": None,
    },
    "saldo_financiera_t1_t2": {
        "concepto": "saldos",
        "velocidad": "medio",
        "criterio": "Saldo de financiera en T1 o T2 (<15 días)",
        "accion": "Verificar que la documentación esté completa para acelerar el pago",
        "horizonte": "esta semana",
        "bloqueo": None,
    },
    "saldo_t3_plus": {
        "concepto": "saldos",
        "velocidad": "medio",
        "criterio": "Saldo en tramo T3+ (>30 días)",
        "accion": "Gestión activa con la financiera: ¿qué falta? ¿hay disputa?",
        "horizonte": "esta semana",
        "bloqueo": None,
    },
    "saldo_judicial": {
        "concepto": "saldos",
        "velocidad": "bloqueado",
        "criterio": "Saldo en proceso judicial",
        "accion": "Seguimiento con el área legal — sin acción comercial directa",
        "horizonte": "indefinido",
        "bloqueo": "proceso_legal",
    },

    # ── PROVISIONES ──────────────────────────────────────────────────────────
    "provision_facturable": {
        "concepto": "provisiones",
        "velocidad": "rapido",
        "criterio": "Provisión no facturada <90 días, concepto confirmado por la marca",
        "accion": "Emitir factura o solicitar al área de finanzas",
        "horizonte": "esta semana",
        "bloqueo": None,
    },
    "provision_90d_plus": {
        "concepto": "provisiones",
        "velocidad": "rapido",
        "criterio": "Provisión no facturada con más de 90 días",
        "accion": "Facturar urgente o reversar si ya no procede",
        "horizonte": "esta semana",
        "bloqueo": None,
    },
    "provision_en_disputa": {
        "concepto": "provisiones",
        "velocidad": "bloqueado",
        "criterio": "estadoAjuste crítico o en negociación con la marca",
        "accion": "Escalar a gerencia para resolver con la marca",
        "horizonte": "indefinido",
        "bloqueo": "disputa_marca",
    },

    # ── STOCK ────────────────────────────────────────────────────────────────
    "stock_pagado_sin_rotacion": {
        "concepto": "stock",
        "velocidad": "rapido",
        "criterio": "VIN pagado con más de 60 días en stock",
        "accion": "Revisar precio, activar promoción o subasta interna",
        "horizonte": "esta semana",
        "bloqueo": None,
    },
    "stock_inmovilizado_180d": {
        "concepto": "stock",
        "velocidad": "medio",
        "criterio": "VIN con más de 180 días en stock",
        "accion": "Fijar precio de liquidación, proponer transferencia o subasta externa",
        "horizonte": "esta semana",
        "bloqueo": None,
    },
    "stock_judicial": {
        "concepto": "stock",
        "velocidad": "bloqueado",
        "criterio": "VIN con marca judicial",
        "accion": "Seguimiento con área legal — no se puede vender hasta resolución",
        "horizonte": "indefinido",
        "bloqueo": "proceso_legal",
    },
    "stock_vpp": {
        "concepto": "stock",
        "velocidad": "medio",
        "criterio": "VIN recibido como parte de pago (VPP) pendiente de activar",
        "accion": "Activar comercialmente: fotografías, precio, publicación",
        "horizonte": "3-5 días",
        "bloqueo": None,
    },
}

# ─────────────────────────────────────────────────────────────────────────────
# SEGUIMIENTO PROACTIVO — preguntas que César hace cuando un caso accionable
# no tiene gestión reciente (sin comentarios en GestionVIN)
#
# César usa estas preguntas para presionar el cierre de casos fáciles.
# ─────────────────────────────────────────────────────────────────────────────

SEGUIMIENTO_PROACTIVO: dict[str, str] = {
    # FNE
    "fne_listo_entregar":    "El {vin} está listo para entregar desde hace {dias}d. ¿Coordinaste la entrega con el cliente? Deja el comentario.",
    "fne_falta_autorizacion":"El {vin} tiene la patente en sucursal, falta la autorización. ¿La gestionaste? Deja el comentario.",
    "fne_sin_solicitud":     "El {vin} lleva {dias}d vendido y no se ha solicitado la inscripción. ¿Qué pasó? Deja el comentario.",

    # Saldos
    "cp_vencido":            "El CP del {vin} lleva {dias}d ({monto_mm}M). ¿Cobraste? Deja el comentario.",
    "saldo_t3_plus":         "El saldo del {vin} está en {tramo} hace {dias}d. ¿Qué falta para cobrar? Deja el comentario.",

    # Provisiones
    "provision_90d_plus":    "La provisión {concepto} de {marca} lleva {dias}d sin facturar ({monto_mm}M). ¿Procedemos a facturar o reversar? Deja el comentario.",

    # Stock
    "stock_pagado_sin_rotacion": "El {vin} lleva {dias}d pagado sin rotar ({monto_mm}M). ¿Qué acción tomamos esta semana? Deja el comentario.",
    "stock_inmovilizado_180d":   "El {vin} lleva {dias}d en stock ({monto_mm}M). ¿Descuento, subasta o transferencia? Deja el comentario.",
}

# ─────────────────────────────────────────────────────────────────────────────
# AGING — tramos de antigüedad por fuente
#
# Cambiar los umbrales acá ajusta cómo se calculan los buckets en tools.py
# ─────────────────────────────────────────────────────────────────────────────

AGING: dict[str, dict] = {
    "fne": {
        "verde":    (0, 3),    # 0-3 días: normal
        "amarillo": (4, 7),    # 4-7 días: atención
        "naranja":  (8, 15),   # 8-15 días: urgente
        "rojo":     (16, 30),  # 16-30 días: crítico
        "negro":    (31, 9999),# >30 días: bloqueado
    },
    "saldos": {
        # Tramos DPS oficiales del archivo SALDOS
        "T0": (0, 6),    # Por Vencer
        "T1": (7, 13),
        "T2": (14, 29),
        "T3": (30, 60),   # ← umbral del score gerencial
        "T4": (61, 90),
        "T5": (91, 120),
        "T6": (121, 364),
        "T7": (365, 9999),
    },
    "provisiones": {
        "reciente":  (0, 30),
        "normal":    (31, 60),
        "atención":  (61, 90),
        "critica":   (91, 180),  # ← umbral del score gerencial
        "bloqueada": (181, 9999),
    },
    "stock": {
        "normal":       (0, 60),
        "atención":     (61, 90),
        "preocupante":  (91, 180),
        "inmovilizado": (181, 9999),  # ← umbral de alerta crítica
    },
}

# ─────────────────────────────────────────────────────────────────────────────
# SEMÁFOROS — umbrales de color para cada indicador de línea de crédito
# ─────────────────────────────────────────────────────────────────────────────

SEMAFORO_LINEA_CREDITO: dict[str, tuple[float, float]] = {
    # (umbral_verde, umbral_amarillo) — sobre porcentaje de ocupación
    "verde":     (0.0,  80.0),
    "amarillo":  (80.0, 90.0),
    "rojo":      (90.0, 100.0),
    "sobregirada": (100.0, 9999.0),
}

# ─────────────────────────────────────────────────────────────────────────────
# UMBRALES DE INACTIVIDAD — cuándo César considera que un caso "se arrastra"
# ─────────────────────────────────────────────────────────────────────────────

INACTIVIDAD: dict[str, int] = {
    "dias_sin_movimiento_alerta":  5,   # días sin update en GestionVIN → aparece en briefing
    "dias_sin_movimiento_critico": 10,  # días sin update → alerta crítica
    "snapshots_sin_cambio_alerta": 2,   # snapshots consecutivos sin cambio de estado
    "snapshots_sin_cambio_cronico": 4,  # snapshots → caso crónico, escalar
    "dias_seguimiento_sin_comentario": 3,  # días accionable sin comentario → César pregunta
}
