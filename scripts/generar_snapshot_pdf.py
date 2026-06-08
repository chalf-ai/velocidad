"""
Genera /Users/Daviid/velocidad/SISTEMA-SNAPSHOT.pdf

Documento de referencia: catálogo de módulos del Sistema de Velocidad
Operacional, reglas transversales, estado y pendientes. Sin screenshots
embebidos (placeholders explícitos para que el usuario los pegue después).
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak,
    Table, TableStyle, KeepTogether,
)
from datetime import date

OUT = "/Users/Daviid/velocidad/SISTEMA-SNAPSHOT.pdf"

# ─────────────────────────────────────────────────────────────────────────────
# Estilos
# ─────────────────────────────────────────────────────────────────────────────

BLUE_DEEP = colors.HexColor("#1d4ed8")
BLUE_SOFT = colors.HexColor("#eff6ff")
GREY_FG = colors.HexColor("#1f2937")
GREY_MUTED = colors.HexColor("#4b5563")
GREY_DIM = colors.HexColor("#9ca3af")
GREY_LINE = colors.HexColor("#e5e7eb")
RED = colors.HexColor("#dc2626")
GREEN = colors.HexColor("#16a34a")
AMBER = colors.HexColor("#d97706")

ss = getSampleStyleSheet()

H1 = ParagraphStyle(
    "H1", parent=ss["Heading1"],
    fontName="Helvetica-Bold", fontSize=22, leading=26,
    textColor=GREY_FG, spaceAfter=12, spaceBefore=0,
)
H2 = ParagraphStyle(
    "H2", parent=ss["Heading2"],
    fontName="Helvetica-Bold", fontSize=15, leading=19,
    textColor=BLUE_DEEP, spaceAfter=8, spaceBefore=18,
)
H3 = ParagraphStyle(
    "H3", parent=ss["Heading3"],
    fontName="Helvetica-Bold", fontSize=12, leading=16,
    textColor=GREY_FG, spaceAfter=4, spaceBefore=10,
)
BODY = ParagraphStyle(
    "Body", parent=ss["BodyText"],
    fontName="Helvetica", fontSize=10, leading=14,
    textColor=GREY_FG, spaceAfter=6,
)
SMALL = ParagraphStyle(
    "Small", parent=BODY,
    fontSize=9, leading=12, textColor=GREY_MUTED,
)
KICKER = ParagraphStyle(
    "Kicker", parent=BODY,
    fontSize=8, leading=10, textColor=BLUE_DEEP,
    fontName="Helvetica-Bold", spaceAfter=2,
)
COVER_TITLE = ParagraphStyle(
    "CoverTitle", parent=H1,
    fontSize=34, leading=40, textColor=GREY_FG, alignment=TA_LEFT,
    spaceBefore=0, spaceAfter=8,
)
COVER_SUB = ParagraphStyle(
    "CoverSub", parent=BODY,
    fontSize=14, leading=18, textColor=GREY_MUTED,
    spaceBefore=0, spaceAfter=24,
)
PLACEHOLDER = ParagraphStyle(
    "Ph", parent=SMALL, textColor=GREY_DIM,
    backColor=colors.HexColor("#f9fafb"),
    borderColor=GREY_LINE, borderWidth=1, borderPadding=10,
    spaceBefore=4, spaceAfter=10, alignment=TA_CENTER,
)
CODE = ParagraphStyle(
    "Code", parent=BODY,
    fontName="Courier", fontSize=9, leading=12,
    textColor=GREY_FG, backColor=colors.HexColor("#f3f4f6"),
    borderColor=GREY_LINE, borderWidth=1, borderPadding=8,
    spaceBefore=4, spaceAfter=8,
)

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def kpi_box(label, value, sub, color=BLUE_DEEP):
    """Pequeña caja KPI usada en hero."""
    t = Table(
        [[
            Paragraph(f'<font size="8" color="#ffffff"><b>{label.upper()}</b></font>', BODY),
        ], [
            Paragraph(f'<font size="20" color="#ffffff"><b>{value}</b></font>', BODY),
        ], [
            Paragraph(f'<font size="8" color="#ffffff">{sub}</font>', BODY),
        ]],
        colWidths=[3.8 * cm],
    )
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), color),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("ROUNDEDCORNERS", [6, 6, 6, 6]),
    ]))
    return t


def placeholder(label):
    return Paragraph(
        f'<i>[ {label} — pegar screenshot aquí ]</i>', PLACEHOLDER,
    )


def estado_badge(label, color):
    return f'<font color="{color.hexval()}"><b>● {label}</b></font>'


def modulo_card(numero, ruta, nombre, descripcion, uso, datos, gaps,
                 estado=("OK", GREEN)):
    """Card de un módulo. Tabla con header + cuerpo."""
    header = Table([[
        Paragraph(
            f'<font size="9" color="#9ca3af"><b>MÓDULO {numero:02d}</b></font>  '
            f'<font size="11" color="{GREY_FG.hexval()}"><b>{nombre}</b></font>',
            BODY,
        ),
        Paragraph(
            f'<font size="9" color="{color_for_estado(estado[1]).hexval()}">'
            f'<b>● {estado[0]}</b></font>'
            f'<br/><font size="8" color="#9ca3af"><i>{ruta}</i></font>',
            BODY,
        ),
    ]], colWidths=[12 * cm, 4.5 * cm])
    header.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BLUE_SOFT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, GREY_LINE),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
    ]))

    body_rows = [
        ["Descripción", descripcion],
        ["Uso típico", uso],
        ["Datos que consume", datos],
        ["Gaps / mejoras", gaps],
    ]
    body = Table(
        [[Paragraph(f"<b>{k}</b>", SMALL), Paragraph(v, SMALL)] for k, v in body_rows],
        colWidths=[3.5 * cm, 13 * cm],
    )
    body.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f9fafb")),
        ("LINEBELOW", (0, 0), (-1, -2), 0.25, GREY_LINE),
        ("BOX", (0, 0), (-1, -1), 0.5, GREY_LINE),
    ]))

    return KeepTogether([header, body, Spacer(1, 4),
                          placeholder(f"Pantalla {nombre}"),
                          Spacer(1, 14)])


def color_for_estado(c):
    return c


# ─────────────────────────────────────────────────────────────────────────────
# Contenido
# ─────────────────────────────────────────────────────────────────────────────

doc = SimpleDocTemplate(
    OUT, pagesize=A4,
    leftMargin=2 * cm, rightMargin=2 * cm,
    topMargin=2 * cm, bottomMargin=2 * cm,
    title="Sistema de Velocidad Operacional — Snapshot",
    author="Pompeyo Carrasco",
)

story = []

# ── PORTADA ──────────────────────────────────────────────────────────────────
story.append(Spacer(1, 4 * cm))
story.append(Paragraph(
    '<font color="#1d4ed8"><b>SISTEMA DE VELOCIDAD OPERACIONAL</b></font>',
    KICKER,
))
story.append(Paragraph("Snapshot funcional del software", COVER_TITLE))
story.append(Paragraph(
    f"Mapa de módulos, reglas transversales y pendientes. "
    f"Corte: {date.today().isoformat()}.",
    COVER_SUB,
))
story.append(Spacer(1, 1.5 * cm))

cover_kpis = Table([[
    kpi_box("Módulos", "21", "rutas vivas", BLUE_DEEP),
    "",
    kpi_box("Stores", "7", "estado global", GREEN),
    "",
    kpi_box("Reglas", "6", "transversales", AMBER),
    "",
    kpi_box("Pendientes", "5", "sin commit", RED),
]], colWidths=[3.8 * cm, 0.2 * cm, 3.8 * cm, 0.2 * cm,
                3.8 * cm, 0.2 * cm, 3.8 * cm])
cover_kpis.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
story.append(cover_kpis)

story.append(Spacer(1, 3 * cm))
story.append(Paragraph(
    "<i>Pompeyo Carrasco · Centro de control operacional para concesionario "
    "multi-marca (KIA, GEELY, CITROEN, DFSK, MG, PEUGEOT, DONGFENG, GWM, "
    "LANDKING, TESCAR, USADOS).</i>",
    SMALL,
))
story.append(PageBreak())

# ── 1. RESUMEN EJECUTIVO ─────────────────────────────────────────────────────
story.append(Paragraph("1 · Resumen ejecutivo", H2))
story.append(Paragraph(
    "El sistema centraliza la operación financiera y logística diaria de "
    "Pompeyo Carrasco sobre un Excel macro de stock y líneas + cruce "
    "histórico ROMA↔Actas↔ROMIA. Sus tres preguntas operacionales son:",
    BODY,
))
story.append(Paragraph(
    '<b>1.</b> ¿Dónde está atrapada la caja hoy? '
    '<b>2.</b> ¿Quién consume los días en cada proceso? '
    '<b>3.</b> ¿Quién debe actuar?',
    BODY,
))
story.append(Spacer(1, 6))
story.append(Paragraph(
    "El frontend (Next.js 15 + React 19 + Zustand + Tailwind v4) sirve "
    "vistas por familia: tesorería, comandos operacionales, vistas por "
    "marca, tiempos operacionales y módulos de ingesta. Toda gestión "
    "de un VIN converge en una única ficha (regla transversal "
    '<b>"VIN con V corta = gestión unificada"</b>).',
    BODY,
))

story.append(Paragraph("Estado general por familia", H3))
estados = [
    ["Familia", "Módulos", "Estado", "Riesgo"],
    ["Ingesta + datos", "/ingesta + /cargar", "OK", "Bajo"],
    ["Vistas macro", "Dashboard, Stock, Capital Trabajo", "OK", "Bajo"],
    ["Tesorería y caja", "Líneas, Saldos, Provisiones, FNE", "OK", "Bajo"],
    ["Comandos operacionales", "Centro de Acción, Alertas", "Pendiente commit", "Medio"],
    ["Tiempos operacionales", "/velocidad-operacional (REDISEÑO)", "Validación visual", "Alto"],
    ["Vistas por marca", "/kia, /tescar, /usados", "OK", "Bajo"],
]
t = Table(estados, colWidths=[3.5 * cm, 5.5 * cm, 3.8 * cm, 3.5 * cm])
t.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), BLUE_DEEP),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("FONTSIZE", (0, 0), (-1, -1), 9),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("LINEBELOW", (0, 0), (-1, -1), 0.25, GREY_LINE),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
]))
story.append(t)
story.append(PageBreak())

# ── 2. ARQUITECTURA ──────────────────────────────────────────────────────────
story.append(Paragraph("2 · Arquitectura en capas", H2))

story.append(Paragraph(
    "El sistema opera con un patrón claro de capas. Cada capa tiene "
    "responsabilidad única; los flujos son unidireccionales (parsers → "
    "stores → selectores → componentes).", BODY,
))

arq = [
    ["Capa", "Componentes", "Función"],
    ["Ingesta",
     "/ingesta, parsers de ROMA/Actas/SCHIAPP/KAR/TestCars/Excel-macro",
     "Detecta tipo de archivo, parsea y consolida."],
    ["Stores (Zustand)",
     "useExcelStore, useHistoricoStore, useGestionStore, useMarcaFilter, useSucursalFilter, useIngestaStore, useCasoModal",
     "Estado global por dominio. Persistencia selectiva en localStorage."],
    ["Selectores puros",
     "owner-operacional, usados-operacional, vista-derivados, logistica/modelo, gestion/caso",
     "Funciones puras sin React. Reusables headless."],
    ["Filtros globales",
     "MarcaFilterSelect + SucursalFilterSelect en Header",
     "Cascada marca → sucursal acotada → universo final."],
    ["Componentes UI",
     "PageHeader, EmptyState, Sidebar, AbrirCasoButton, FichaOperacionalVIN",
     "Patrón consistente entre módulos (surface, top-strip, KPIs, colas)."],
    ["Gestión transversal",
     "GestionInline (no-VIN), FichaOperacionalVIN (con VIN)",
     "Toda gestión de un VIN va al mismo lugar — regla transversal."],
]
t = Table(arq, colWidths=[3 * cm, 6 * cm, 7.5 * cm])
t.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), BLUE_DEEP),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("FONTSIZE", (0, 0), (-1, -1), 8.5),
    ("LEADING", (0, 0), (-1, -1), 11),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("LINEBELOW", (0, 0), (-1, -1), 0.25, GREY_LINE),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
]))
story.append(t)

story.append(Paragraph("Flujo de un archivo cargado", H3))
story.append(Paragraph(
    '<font face="Courier">Excel (drop)  →  detectar-fuente.ts  →  parser específico  '
    '→  store (useExcelStore o useHistoricoStore)  →  selectores (filtros + cruces)  '
    '→  página (memoized useMemo)  →  componente UI.</font>',
    CODE,
))

story.append(PageBreak())

# ── 3. CATÁLOGO DE MÓDULOS ───────────────────────────────────────────────────
story.append(Paragraph("3 · Catálogo de módulos", H2))
story.append(Paragraph(
    "Cada módulo está descrito con: descripción funcional, uso típico, "
    "datos que consume y gaps actuales. Los módulos están agrupados por "
    "familia operacional.", BODY,
))

# ── A. INGESTA Y DATOS ───────────────────────────────────────────────────────
story.append(Paragraph("A · Ingesta y datos", H3))

modulos_ingesta = [
    {
        "n": 1, "ruta": "/cargar",
        "nombre": "Carga inicial del Excel macro",
        "desc": "Drop del Excel principal de Stock + Líneas + FNE + Saldos + "
                "Provisiones + Bonos. Detecta hojas, ejecuta el parser "
                "consolidador y pobla useExcelStore.",
        "uso": "Primer paso del día. Cada vez que el equipo financiero "
               "publica el corte semanal, se carga acá.",
        "datos": "Excel xlsx con hojas Base_Stock, Lineas, FNE, Saldos, "
                  "Provisiones, Bonos, OtrosMV.",
        "gaps": "Sin gaps mayores. UI funciona estable.",
        "estado": ("OK", GREEN),
    },
    {
        "n": 2, "ruta": "/ingesta",
        "nombre": "Hub de ingesta multi-fuente",
        "desc": "Centro para cargar fuentes adicionales: ROMA mensuales "
                "(5 cortes), Actas histórico, ROMIA SCHIAPP, ROMIA KAR, "
                "Control TestCars, Logística. Detecta tipo automático.",
        "uso": "Carga del histórico operacional al inicio. Permite editar/"
               "reemplazar fuentes sin reiniciar el resto del sistema.",
        "datos": "Archivos Excel con headers detectables por columnas.",
        "gaps": "El estado del histórico es en memoria — no persiste entre "
                "sesiones. Si el usuario refresca, debe recargar.",
        "estado": ("OK", GREEN),
    },
]

for m in modulos_ingesta:
    story.append(modulo_card(
        m["n"], m["ruta"], m["nombre"], m["desc"], m["uso"], m["datos"],
        m["gaps"], m["estado"],
    ))

story.append(PageBreak())

# ── B. VISTAS MACRO ──────────────────────────────────────────────────────────
story.append(Paragraph("B · Vistas macro", H3))

modulos_macro = [
    {
        "n": 3, "ruta": "/dashboard",
        "nombre": "Dashboard ejecutivo",
        "desc": "Vista principal: Bloque A (financieras con % utilización y "
                "color de severidad, líneas de crédito) + Bloque B "
                "(movimiento, inmovilizado, puente, judicial) con cards "
                "drilleables.",
        "uso": "Lectura ejecutiva diaria del 'pulso' financiero.",
        "datos": "useExcelStore (data, fne, saldos, provisiones), "
                  "useGestionStore.",
        "gaps": "Visualmente sólido. Posible mejora: tendencias temporales.",
        "estado": ("OK", GREEN),
    },
    {
        "n": 4, "ruta": "/stock",
        "nombre": "Stock activo + drilldown por marca",
        "desc": "Vehículos en stock activo con filtros por naturaleza, "
                "agrupación por marca operacional, drill por VIN.",
        "uso": "Exploración del stock vivo para gestión diaria.",
        "datos": "useExcelStore.data.vehiculos filtrado por marca operacional.",
        "gaps": "Sin gaps relevantes.",
        "estado": ("OK", GREEN),
    },
    {
        "n": 5, "ruta": "/capital-trabajo",
        "nombre": "Capital de trabajo por marca",
        "desc": "Vista por marca con KPIs clickables y semántica financiera "
                "(stock, FNE, saldos, provisiones, líneas).",
        "uso": "Análisis financiero por unidad operacional.",
        "datos": "useExcelStore + selectores de owner-operacional.",
        "gaps": "Sin gaps.",
        "estado": ("OK", GREEN),
    },
    {
        "n": 6, "ruta": "/capital-pagado",
        "nombre": "Recuperación de caja",
        "desc": "Velocidad de recuperación de caja: CPD aparte, judicial "
                "separado, top marcas, secciones con drill.",
        "uso": "Ver qué tan rápido se está convirtiendo factura en cash.",
        "datos": "Saldos T3+ + cruces con stock + judicial.",
        "gaps": "Sin gaps.",
        "estado": ("OK", GREEN),
    },
]

for m in modulos_macro:
    story.append(modulo_card(
        m["n"], m["ruta"], m["nombre"], m["desc"], m["uso"], m["datos"],
        m["gaps"], m["estado"],
    ))

story.append(PageBreak())

# ── C. TESORERÍA Y CAJA ──────────────────────────────────────────────────────
story.append(Paragraph("C · Tesorería y caja atrapada", H3))

modulos_tesoreria = [
    {
        "n": 7, "ruta": "/lineas",
        "nombre": "Líneas de crédito (tesorería operacional)",
        "desc": "Tabla ejecutiva de financieras con barras de utilización, "
                "estado por financiera, líneas al límite. Reconciliación "
                "universo operacional vs financiero.",
        "uso": "Lectura diaria de cupo disponible por financiera.",
        "datos": "useExcelStore.lineas + maestro financiero oficial.",
        "gaps": "Sin gaps mayores.",
        "estado": ("OK", GREEN),
    },
    {
        "n": 8, "ruta": "/saldos",
        "nombre": "Saldos por documentar",
        "desc": "Saldos T0..T7 con foco en T3+ (materialidad CP), judicial "
                "separado, familias (vehículo / bono / repuesto), gestión "
                "VIN o cajón (no-VIN).",
        "uso": "Trabajo diario del equipo de cobranza.",
        "datos": "useExcelStore.saldos.registros.",
        "gaps": "Sin gaps. Bug T7 resuelto vía selector único.",
        "estado": ("OK", GREEN),
    },
    {
        "n": 9, "ruta": "/provisiones",
        "nombre": "Provisiones no facturadas",
        "desc": "Provisiones por estado (no facturada, facturada, anulada) "
                "con aging > 30 días.",
        "uso": "Limpieza periódica de provisiones envejecidas.",
        "datos": "useExcelStore.provisiones.registros.",
        "gaps": "Sin gaps.",
        "estado": ("OK", GREEN),
    },
    {
        "n": 10, "ruta": "/facturados-no-entregados",
        "nombre": "FNE — facturados no entregados",
        "desc": "VINs facturados sin entrega registrada. Filtro por entrega_"
                "auto_txt = 'Cargado'. Cruce con stock y logística.",
        "uso": "Listado de unidades con factura emitida pero sin entregar.",
        "datos": "useExcelStore.fne + cruzarFNEConStock.",
        "gaps": "Sin gaps.",
        "estado": ("OK", GREEN),
    },
    {
        "n": 11, "ruta": "/vencimientos",
        "nombre": "Vencimientos próximos",
        "desc": "Vista de vencimientos por aging.",
        "uso": "Anticipar pagos / cobros que están al borde.",
        "datos": "Cruces de saldos + provisiones + líneas.",
        "gaps": "Vista funcional. Posible mejora: alertas push.",
        "estado": ("OK", GREEN),
    },
]

for m in modulos_tesoreria:
    story.append(modulo_card(
        m["n"], m["ruta"], m["nombre"], m["desc"], m["uso"], m["datos"],
        m["gaps"], m["estado"],
    ))

story.append(PageBreak())

# ── D. COMANDOS OPERACIONALES ────────────────────────────────────────────────
story.append(Paragraph("D · Comandos operacionales", H3))

modulos_cmd = [
    {
        "n": 12, "ruta": "/centro-accion",
        "nombre": "Centro de Acción",
        "desc": "8 cards ejecutivas: caja atrapada hoy, máxima alerta, "
                "créditos Pompeyo, FNE >7d, saldos autos >30d, bonos >30d, "
                "provisiones no fact. >30d, seguimientos atrasados. "
                "Cada card abre cola gestionable inline.",
        "uso": "Mesa de trabajo operacional diaria del equipo.",
        "datos": "Universo operacional activo + gestión por VIN.",
        "gaps": "Cambios recientes sin commit (8 cards + Sidebar + caso.ts + "
                "FichaOperacionalVIN extendida con 'Días retenido').",
        "estado": ("Pendiente commit", AMBER),
    },
    {
        "n": 13, "ruta": "/alertas",
        "nombre": "Centro de tensión",
        "desc": "3 capas de alerta (solo capital en tensión). Anti-alarmismo: "
                "solo aparecen casos con materialidad real.",
        "uso": "Visión rápida de focos críticos del día.",
        "datos": "Selectores de tensión sobre saldos + FNE + judicial.",
        "gaps": "Sin gaps mayores.",
        "estado": ("OK", GREEN),
    },
]

for m in modulos_cmd:
    story.append(modulo_card(
        m["n"], m["ruta"], m["nombre"], m["desc"], m["uso"], m["datos"],
        m["gaps"], m["estado"],
    ))

# ── E. TIEMPOS OPERACIONALES (REDISEÑO) ──────────────────────────────────────
story.append(Paragraph("E · Tiempos operacionales (rediseño v3)", H3))

modulos_tiempos = [
    {
        "n": 14, "ruta": "/velocidad-operacional",
        "nombre": "Tiempos Operacionales",
        "desc": "Pantalla operacional por mes de factura. Filtro principal: "
                "MES DE FACTURA. 5 procesos (Control de Negocio, Logística, "
                "Comercial, Cliente, Cierre y Cumplimiento) × 2 vistas "
                "(Funnel del mes / Backlog abierto). Funnel chevron "
                "horizontal con responsable operativo y semáforo por tramo. "
                "Backlog acumulado con ranking por sucursal/responsable/"
                "cuello dominante. Regla 'usados + mayorista' aplicada "
                "automáticamente a CN y Logística.",
        "uso": "Diagnóstico de dónde se pierden días en el proceso "
               "operativo y quién consume tiempo. Mesa de gestión sobre "
               "casos atrasados.",
        "datos": "useHistoricoStore.cruce (ROMA↔Actas↔ROMIA) + filtros "
                  "globales en cascada + regla usados.",
        "gaps": "REDISEÑO completo sin commit. Pendiente validación visual "
                "con datos reales. Calibración de umbrales del semáforo "
                "(UMBRAL_TRAMO) requiere ver pantalla en vivo.",
        "estado": ("Validación visual pendiente", RED),
    },
]

for m in modulos_tiempos:
    story.append(modulo_card(
        m["n"], m["ruta"], m["nombre"], m["desc"], m["uso"], m["datos"],
        m["gaps"], m["estado"],
    ))

story.append(PageBreak())

# ── F. VISTAS POR MARCA ──────────────────────────────────────────────────────
story.append(Paragraph("F · Vistas por marca / unidad operacional", H3))

modulos_marca = [
    {
        "n": 15, "ruta": "/kia",
        "nombre": "KIA Operating View",
        "desc": "Vista dedicada KIA: stock retail, FNE por sucursal, saldos+"
                "provisiones por marca/sucursal, capital de trabajo destacado.",
        "uso": "Reunión semanal con gerente KIA.",
        "datos": "Filtrado por owner operacional KIA.",
        "gaps": "Plantilla replicable para otras marcas (CITROEN, GEELY, MG).",
        "estado": ("OK", GREEN),
    },
    {
        "n": 16, "ruta": "/usados",
        "nombre": "Módulo de Usados",
        "desc": "Stock comercializable (retail+CPD+mayorista+judicial+stockB), "
                "MOS, aging por categoría, panel FNE usados. Taxonomía "
                "redefinida con clasificador.",
        "uso": "Gestión específica del gerente de usados.",
        "datos": "esUsadoOperacional + usados-operacional selector.",
        "gaps": "Mayorista identificación robusta. Validación cruzada.",
        "estado": ("OK", GREEN),
    },
    {
        "n": 17, "ruta": "/tescar",
        "nombre": "Stock TESCAR (test cars)",
        "desc": "Stock de test cars con dashboard dedicado.",
        "uso": "Gestión del parque de test cars.",
        "datos": "Parser Control TestCars + orquestador.",
        "gaps": "Sin gaps.",
        "estado": ("OK", GREEN),
    },
    {
        "n": 18, "ruta": "/vu-en-fne",
        "nombre": "Usados pendientes de recuperación",
        "desc": "Casos puente: VUs en FNE con origen identificado.",
        "uso": "Caso puente entre operación de usados y caja.",
        "datos": "Cruce especializado VU + FNE.",
        "gaps": "Sin gaps.",
        "estado": ("OK", GREEN),
    },
]

for m in modulos_marca:
    story.append(modulo_card(
        m["n"], m["ruta"], m["nombre"], m["desc"], m["uso"], m["datos"],
        m["gaps"], m["estado"],
    ))

story.append(PageBreak())

# ── G. UTILIDADES ────────────────────────────────────────────────────────────
story.append(Paragraph("G · Utilidades y debug", H3))

modulos_util = [
    {
        "n": 19, "ruta": "/validacion",
        "nombre": "Validación financiera (sistema vs oficial)",
        "desc": "Maestro financiero oficial (marca→financiera validado). "
                "Capa de validación visible en /lineas y Dashboard.",
        "uso": "Auditoría diaria de coherencia.",
        "datos": "Maestro financiero + líneas.",
        "gaps": "Sin gaps.",
        "estado": ("OK", GREEN),
    },
    {
        "n": 20, "ruta": "/debug/resumen",
        "nombre": "Debug + resumen interno",
        "desc": "Pantalla de debug para diagnóstico de cuadratura.",
        "uso": "Solo desarrollo / soporte.",
        "datos": "Resumen interno del store.",
        "gaps": "No usar en producción ejecutiva.",
        "estado": ("OK", GREEN),
    },
    {
        "n": 21, "ruta": "/login",
        "nombre": "Autenticación",
        "desc": "Login con NextAuth.",
        "uso": "Punto de entrada de la app.",
        "datos": "/api/auth/[...nextauth] + /api/users.",
        "gaps": "Sin gaps relevantes.",
        "estado": ("OK", GREEN),
    },
]

for m in modulos_util:
    story.append(modulo_card(
        m["n"], m["ruta"], m["nombre"], m["desc"], m["uso"], m["datos"],
        m["gaps"], m["estado"],
    ))

story.append(PageBreak())

# ── 4. REGLAS TRANSVERSALES ──────────────────────────────────────────────────
story.append(Paragraph("4 · Reglas transversales del sistema", H2))
story.append(Paragraph(
    "Estas reglas se aplican a TODOS los módulos. Están grabadas en código "
    "(no son decisiones cosméticas).", BODY,
))

reglas = [
    {
        "n": "R1", "nombre": "VIN con V corta = gestión unificada",
        "texto": "Cuando hay un VIN, toda gestión (presión operacional, "
                  "capital, días retenido, owner, score, mesa de gestión) "
                  "va al MISMO lugar — la <b>FichaOperacionalVIN</b>. En "
                  "cualquier cola/tabla/lista el botón 'Abrir caso' abre "
                  "ese modal. El popover inline (GestionInline) solo "
                  "aplica a saldos / bonos / provisiones sin VIN.",
    },
    {
        "n": "R2", "nombre": "Filtros globales en cascada",
        "texto": "El Header tiene dos selectores: <b>marca</b> + "
                  "<b>sucursal</b>. La sucursal está acotada por la marca "
                  "(con GEELY activo, solo aparecen sucursales GEELY). El "
                  "universo final de cada módulo es: data ∩ marca ∩ sucursal. "
                  "Con ambos en null el sistema funciona como antes "
                  "(passthrough, macro intacto).",
    },
    {
        "n": "R3", "nombre": "Usados + Mayorista fuera de CN y Logística",
        "texto": "Usados son autos transferidos (no inscritos nuevos) y "
                  "físicamente ya en la sucursal. Mayorista es venta "
                  "mayorista de usados con su propio flujo de liquidación. "
                  "Ambos quedan FUERA de Control de Negocio (inscripción "
                  "nueva) y Logística (traslado retail). SÍ aplican en "
                  "Comercial, Cliente y Cierre y Cumplimiento.",
    },
    {
        "n": "R4", "nombre": "Marca operacional canónica",
        "texto": "<b>normalizarMarcaOperacional()</b> canoniza variantes "
                  "textuales → KIA MOTORS, GEELY, USADOS, OTRAS MARCAS, etc. "
                  "Es la fuente única de verdad para identificar el owner "
                  "operacional de cualquier registro (vehículo, FNE, saldo, "
                  "provisión, línea histórica).",
    },
    {
        "n": "R5", "nombre": "ETA vencida excluye FNE",
        "texto": "El bloqueo logístico 'transito_prolongado' (En tránsito "
                  "sin recepción) NO aplica si el auto ya está en FNE. "
                  "Si está facturado físicamente ya tiene que estar en la "
                  "sucursal — el bloqueo real ahí es otro "
                  "(llegado_no_entregado o inscripcion_pendiente).",
    },
    {
        "n": "R6", "nombre": "Anti-alarmismo: materialidad primero",
        "texto": "Los módulos de tensión y alerta NO listan todo lo posible. "
                  "Solo listan casos con materialidad financiera real "
                  "(capital en tensión). Evita ruido cognitivo del equipo.",
    },
]

for r in reglas:
    box = Table([[
        Paragraph(
            f'<font color="{BLUE_DEEP.hexval()}"><b>{r["n"]}</b></font>  '
            f'<b>{r["nombre"]}</b>',
            BODY,
        ),
    ], [
        Paragraph(r["texto"], BODY),
    ]], colWidths=[16 * cm])
    box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE_SOFT),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("BOX", (0, 0), (-1, -1), 0.5, GREY_LINE),
    ]))
    story.append(box)
    story.append(Spacer(1, 6))

story.append(PageBreak())

# ── 5. ESTADO Y PENDIENTES ───────────────────────────────────────────────────
story.append(Paragraph("5 · Estado de implementación y pendientes", H2))

story.append(Paragraph("Trabajo sin commit (a la espera de OK)", H3))
pendientes = [
    ["#", "Cambio", "Archivos", "Impacto"],
    ["1", "Filtro global sucursal + acotamiento por marca",
     "sucursal-filtro.ts (nuevo), marca-filtro.ts, SucursalFilterSelect.tsx (nuevo), Header.tsx",
     "Toggle global de sucursal activo en todos los módulos."],
    ["2", "Refinamiento bloqueo transito_prolongado",
     "centro-accion/page.tsx",
     "Excluye FNE del card 'En tránsito sin recepción' (R5)."],
    ["3", "Centro de Acción overhaul",
     "centro-accion/page.tsx, Sidebar.tsx, gestion/caso.ts, FichaOperacionalVIN.tsx, Button.tsx",
     "8 cards ejecutivas + 'Días retenido' + fix CP>7d + sidebar legible."],
    ["4", "Rediseño /velocidad-operacional v3",
     "vista-derivados.ts (+11 selectores), velocidad-operacional/page.tsx (reescritura), 7 componentes nuevos en components/historico/",
     "Filtro mes factura + funnel chevron + responsable operativo + backlog acumulado + cierre y cumplimiento."],
    ["5", "Regla usados+mayorista en velocidad operacional",
     "vista-derivados.ts, velocidad-operacional/page.tsx",
     "CN y Logística excluyen usados/mayorista automáticamente."],
]
t = Table(pendientes, colWidths=[0.8 * cm, 5.2 * cm, 6 * cm, 4.5 * cm])
t.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), BLUE_DEEP),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("FONTSIZE", (0, 0), (-1, -1), 8),
    ("LEADING", (0, 0), (-1, -1), 11),
    ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ("LINEBELOW", (0, 0), (-1, -1), 0.25, GREY_LINE),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
]))
story.append(t)

story.append(Paragraph("Verificación técnica del último corte", H3))
story.append(Paragraph(
    "Todos los cambios pendientes pasan los gates: "
    f'{estado_badge("npx tsc --noEmit", GREEN)} · '
    f'{estado_badge("npx eslint", GREEN)} · '
    f'{estado_badge("npx next build (33/33 OK)", GREEN)}.',
    BODY,
))

story.append(PageBreak())

# ── 6. GAPS Y MEJORAS ────────────────────────────────────────────────────────
story.append(Paragraph("6 · Gaps identificados y mejoras propuestas", H2))

gaps = [
    {
        "p": "Alta",
        "titulo": "Validación visual del rediseño /velocidad-operacional",
        "texto": "Después del fix de bg-[--color-X] → bg-[color:var(...)] y "
                  "regla usados, falta confirmar visualmente que el funnel "
                  "chevron y los 4 KPIs sólidos se ven bien en pantalla con "
                  "datos reales. Bloquea el commit del rediseño.",
    },
    {
        "p": "Alta",
        "titulo": "Calibración de umbrales del semáforo (UMBRAL_TRAMO)",
        "texto": "Los valores iniciales (cn_paten_patrec verde≤7, "
                  "amarillo≤15) son sensatos pero arbitrarios. Si todo el "
                  "funnel se ve rojo en producción, hay que subir los "
                  "umbrales según la realidad operacional.",
    },
    {
        "p": "Media",
        "titulo": "ProcesoSelector visual viejo",
        "texto": "El selector de proceso de /velocidad-operacional sigue "
                  "siendo el ProcesoSelector heredado. Estéticamente no "
                  "acompaña al funnel chevron + KPIs sólidos. Refactor a "
                  "tabs modernas pendiente.",
    },
    {
        "p": "Media",
        "titulo": "Persistencia del cruce histórico",
        "texto": "useHistoricoStore vive en memoria del navegador. Al "
                  "refrescar la página se pierde y hay que recargar los "
                  "Excel. Persistir en IndexedDB simplificaría la "
                  "experiencia del equipo.",
    },
    {
        "p": "Baja",
        "titulo": "Vistas dedicadas para otras marcas",
        "texto": "/kia es una plantilla replicable. Si se prioriza, se "
                  "puede generar /citroen, /geely, /mg como módulos "
                  "espejos.",
    },
    {
        "p": "Baja",
        "titulo": "Copilot / asistente IA",
        "texto": "El screenshot de inspiración (Creatio.ai) incluye un "
                  "copilot lateral. Fuera de scope técnico hoy — "
                  "requiere LLM integrado + RAG sobre los datos del "
                  "tenant.",
    },
]

for g in gaps:
    color_p = (RED if g["p"] == "Alta" else
               AMBER if g["p"] == "Media" else GREEN)
    pri = Paragraph(
        f'<font color="{color_p.hexval()}"><b>● {g["p"]}</b></font>',
        BODY,
    )
    box = Table([[pri,
                   Paragraph(f'<b>{g["titulo"]}</b>', BODY)],
                  ['',
                   Paragraph(g["texto"], BODY)]],
                 colWidths=[1.8 * cm, 14.5 * cm])
    box.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("BOX", (0, 0), (-1, -1), 0.5, GREY_LINE),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f9fafb")),
    ]))
    story.append(box)
    story.append(Spacer(1, 6))

story.append(PageBreak())

# ── 7. NOTA SOBRE SCREENSHOTS ────────────────────────────────────────────────
story.append(Paragraph("7 · Cómo completar este documento con capturas", H2))
story.append(Paragraph(
    "Los placeholders marcados <i>[ pegar screenshot aquí ]</i> son los "
    "puntos donde conviene insertar una captura real. Sugerencia:",
    BODY,
))
story.append(Paragraph(
    "<b>1.</b> Recorrer cada módulo de la barra lateral en orden.<br/>"
    "<b>2.</b> Capturar con marca = 'Todas' y sucursal = 'Todas' (vista "
    "macro).<br/>"
    "<b>3.</b> Para /velocidad-operacional capturar 4 estados: Funnel CN, "
    "Funnel Logística, Backlog Acumulado, Cierre y Cumplimiento.<br/>"
    "<b>4.</b> Insertar después de cada modulo_card en este PDF "
    "(herramienta tipo PDF editor o regenerar con las imágenes en disco).",
    BODY,
))

story.append(Paragraph("Cierre", H3))
story.append(Paragraph(
    "El sistema está sólido en sus capas inferiores (parsers, stores, "
    "selectores, reglas transversales) y en los módulos de tesorería + "
    "comandos operacionales. El frente activo de trabajo es "
    "<b>/velocidad-operacional</b>: el rediseño está implementado y "
    "compila, queda validar visualmente que el funnel chevron y la regla "
    "usados+mayorista entregan los números esperados antes de cerrar la "
    "tanda de commits.",
    BODY,
))

# ─────────────────────────────────────────────────────────────────────────────
# Build
# ─────────────────────────────────────────────────────────────────────────────

doc.build(story)
print(f"OK · escrito {OUT}")
