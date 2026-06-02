# César — Agente de Gestión de Capital Inmovilizado

César es el asistente de gestión de capital de trabajo de Pompeyo Carrasco.
Vive en WhatsApp. Su misión es una sola: **reducir el capital inmovilizado** identificando qué está parado, cuánto cuesta tenerlo parado, y qué acción concreta lo libera.

---

## Misión

El capital de trabajo se inmoviliza en cuatro conceptos:

| Concepto | Fuente de datos | Cuándo duele |
|---|---|---|
| **Stock** | BASE_STOCK | Propio >60d, FloorPlan acumulando interés |
| **FNE** | FNE | Vendido no entregado >7d |
| **Saldos** | SALDOS | Cobros pendientes en T3+ (>30d) |
| **Provisiones** | PROVISIONES | Incentivos sin facturar >90d |

César consolida los cuatro en una sola vista y clasifica cada peso parado como **accionable rápido**, **accionable medio**, o **bloqueado**. No reporta — gestiona.

---

## Score Gerencial (0–100)

Cuatro indicadores con pesos fijos. El score sube cuando se recupera capital.

| Indicador | Peso | Meta | Fuente del umbral |
|---|---|---|---|
| Stock propio ≤5% del valorizado | 40 | ≤5% | `indicadores.py → SCORE_GERENCIAL["stock_propio"]` |
| Provisiones no facturadas >90d = 0 | 40 | 0 casos | `indicadores.py → SCORE_GERENCIAL["provisiones_90d"]` |
| Crédito Pompeyo >15d = 0 | 10 | 0 casos | `indicadores.py → SCORE_GERENCIAL["cp_15d"]` |
| Saldos vehículo T3+ ≤15% | 10 | ≤15% | `indicadores.py → SCORE_GERENCIAL["saldos_t3"]` |

**Para cambiar un umbral:** editar `agent/indicadores.py`, sección `SCORE_GERENCIAL`. El scoring es lineal entre `meta` y `max`.

---

## Personalidad y comportamiento

César es directo, sin rodeos, orientado a acción. No reporta datos — diagnostica y presiona el cierre.

**Lo que hace:**
- Abre cada conversación con el estado del capital: cuánto hay parado y dónde
- Clasifica qué es accionable hoy, esta semana, o está bloqueado
- Cuando un caso accionable lleva días sin comentario, pregunta directamente: *"¿Cobraste ese CP? Deja el comentario."*
- Cuando un gerente comenta un VIN, notifica al responsable por WhatsApp
- Recuerda el contexto de la conversación y hace seguimiento entre sesiones

**Lo que NO hace:**
- No inventa datos. Si no tiene acceso a algo, dice exactamente qué puede ver y qué no.
- No reporta sin diagnosticar. Un número sin acción no sirve.
- No ignora casos crónicos. Si algo lleva 4+ semanas igual, lo dice explícitamente.

---

## Arquitectura

```
WhatsApp (usuario)
      ↓
  webhook.py          ← FastAPI, recibe y despacha mensajes
      ↓
  agent.py (César)    ← LangGraph ReAct + GPT-4o
      ↓
  ┌──────────────────────────────────────────────────┐
  │  Tools de dominio (tools.py)                     │
  │                                                  │
  │  ver_capital_consolidado()   ← cuadro completo   │
  │  ver_accionables()           ← clasificados      │
  │  get_detalle_vin()           ← con contexto      │
  │                               temporal           │
  │  guardar_comentario()        ← + hook escalada   │
  │  [ver_fne, ver_saldos,                           │
  │   ver_provisiones, ...]                          │
  └──────────────────────────────────────────────────┘
      ↓
  database.py         ← asyncpg directo sobre PostgreSQL
      ↓
  PostgreSQL (Railway)
  ├── Snapshot (BASE_STOCK, FNE, SALDOS, PROVISIONES)
  ├── GestionVIN + HistorialGestion
  └── User, AlertaLog, AlertaConfig

  Checkpointer LangGraph (PostgreSQL) ← historial de conversación por usuario
  Store LangGraph (PostgreSQL)        ← memoria persistente: alertas, preferencias
```

---

## Flujo de un mensaje

```
1. Usuario escribe por WhatsApp
2. webhook.py recibe, llama agent.chat(telefono, mensaje)
3. César carga:
   a. Historial de conversación (checkpointer, últimos 50 mensajes)
   b. Memoria del usuario (store: alertas personalizadas, preferencias)
   c. Perfil del usuario (rol, marcas asignadas)
4. GPT-4o decide qué tool(s) llamar
5. Tool consulta database.py → PostgreSQL
6. César formula respuesta con diagnóstico + acción concreta
7. send_text() → WhatsApp
```

---

## Memoria por usuario

César tiene dos capas de memoria:

### Corto plazo — historial de conversación
- Guardado por el checkpointer de LangGraph en PostgreSQL
- `thread_id` = teléfono del usuario
- Ventana: últimos 50 mensajes
- Se pierde al truncar → no apto para instrucciones permanentes

### Largo plazo — Store de LangGraph
Persiste entre sesiones. Tres namespaces por usuario:

| Namespace | Qué guarda | Ejemplo |
|---|---|---|
| `users/{tel}/alertas` | Reglas de notificación declaradas por el usuario | "avísame si KIA supera 180d" |
| `users/{tel}/contexto` | Conocimiento acumulado | "el VIN ABC tiene problema legal con cliente Pérez" |
| `users/{tel}/preferencias` | Cómo recibir la info | "primero FNE, no mostrar judiciales" |

El usuario enseña a César diciendo:
- *"Recuerda que..."* → César guarda en contexto
- *"Avísame cuando..."* → César guarda en alertas, se evalúa en cada snapshot
- *"Siempre muéstrame..."* → César guarda en preferencias

---

## Hook de escalada

Cuando un usuario con rol GERENTE, GERENTE_GENERAL o DIRECTOR deja un comentario en un VIN:

```
1. agregar_comentario() detecta rol del usuario desde su email
2. Si rol ≥ GERENTE → busca responsableEmail en GestionVIN
3. Busca teléfono del responsable en tabla User
4. Envía WhatsApp inmediato:
   "🔔 [Nombre] (Gerente) comentó en VIN *XYZ456*:
    _'[comentario]'_
    Responde o actualiza el caso."
5. Registra en AlertaLog tipo COMENTARIO_GERENCIA
```

---

## Contexto temporal de un VIN

Cada vez que César consulta un VIN incluye automáticamente:

```python
{
  "semanas_en_gestion": 6,          # semanas desde GestionVIN.createdAt
  "snapshots_sin_cambio": 4,        # snapshots BASE_STOCK desde último update
  "es_cronico": True,               # snapshotsSinCambio >= INACTIVIDAD["snapshots_sin_cambio_cronico"]
  "ultimo_comentario_gerencia": {
    "texto": "debe resolverse esta semana",
    "usuario": "Carlos García",
    "rol": "GERENTE",
    "hace_dias": 14
  }
}
```

**Fórmula de snapshots sin cambio:**
```sql
SELECT COUNT(*) FROM "Snapshot"
WHERE fuente = 'BASE_STOCK'
  AND "createdAt" > (SELECT "updatedAt" FROM "GestionVIN" WHERE vin = $1)
```
No requiere campo nuevo en la DB — se calcula en tiempo real.

---

## Seguimiento proactivo

César pregunta activamente cuando un caso accionable no tiene gestión reciente.
Los textos de las preguntas están en `indicadores.py → SEGUIMIENTO_PROACTIVO`.

**Regla:** si un caso tiene `velocidad = "rapido"` y su VIN no tiene comentario en los últimos `INACTIVIDAD["dias_seguimiento_sin_comentario"]` días → César incluye la pregunta en el briefing o en la respuesta cuando se menciona el VIN.

**Ejemplo:**
```
VIN ABC123 · CP >15d · $4.2M · sin comentario hace 4 días
César: "¿Cobraste ese CP? Deja el comentario."
```

---

## Briefing diario (08:00 Chile, L-V)

Estructura del briefing de César (en orden):

```
1. Score gerencial actual (0-100) y variación vs semana anterior
2. Capital parado por concepto ($M totales)
3. Accionables rápidos sin gestión → lista con pregunta de seguimiento
4. Casos crónicos (4+ snapshots sin cambio)
5. Alertas personalizadas del usuario (si tiene alguna disparada)
6. Últimos comentarios de gerencia sin respuesta
```

---

## Cómo modificar indicadores

**Cambiar un umbral del score gerencial:**
```python
# agent/indicadores.py → SCORE_GERENCIAL
"stock_propio": {
    "meta": 5.0,   # cambiar a 3.0 para ser más exigente
    "max": 20.0,   # cambiar a 15.0 para penalizar antes
}
```

**Agregar un nuevo tipo de accionable:**
```python
# agent/indicadores.py → ACCIONABILIDAD
"mi_nuevo_caso": {
    "concepto": "saldos",
    "velocidad": "rapido",          # rapido | medio | bloqueado
    "criterio": "...",
    "accion": "Qué hacer concretamente",
    "horizonte": "hoy",
    "bloqueo": None,
}

# agent/indicadores.py → SEGUIMIENTO_PROACTIVO
"mi_nuevo_caso": "Texto que César pregunta cuando no hay comentario en {dias}d.",
```

**Cambiar tramos de aging:**
```python
# agent/indicadores.py → AGING
"fne": {
    "verde":    (0, 3),   # cambiar el 3 a 5 para dar más tiempo
    ...
}
```

---

## Variables de entorno

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | PostgreSQL compartida con la app Next.js |
| `OPENAI_API_KEY` | GPT-4o |
| `WHATSAPP_ACCESS_TOKEN` | Meta Graph API |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número Business |
| `WHATSAPP_VERIFY_TOKEN` | Token de verificación del webhook |
| `BRIEFING_HORA` | Hora del briefing diario (default: `08:00`) |
| `AGENT_PORT` | Puerto del servidor (default: `8000`) |

---

## Deploy

Railway. Dockerfile en `agent/Dockerfile`. Health check en `/health`.

```bash
# Local
cd agent
pip install -r requirements.txt
uvicorn agent.webhook:app --reload --port 8000

# Ver logs en Railway
railway logs --tail
```
