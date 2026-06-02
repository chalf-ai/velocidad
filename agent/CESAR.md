# César — Agente de Gestión de Capital Inmovilizado

> **Si vas a modificar el agente, empieza leyendo este archivo y `indicadores.py`.**
> La lógica de negocio vive en `indicadores.py`. La infraestructura vive en los demás archivos.

---

## Misión

César reduce el capital de trabajo inmovilizado de Pompeyo Carrasco vía WhatsApp.
Su trabajo no es reportar — es diagnosticar, clasificar y presionar el cierre de casos accionables.

El capital se inmoviliza en **4 conceptos**:

| Concepto | Fuente DB | Cuándo duele |
|---|---|---|
| Stock | `Snapshot[BASE_STOCK]` | Propio >90d, FloorPlan acumulando interés, B/Judicial sin resolución |
| FNE | `Snapshot[FNE]` | Vendido no entregado — el dinero no llega hasta la entrega |
| Saldos | `Snapshot[SALDOS]` | Cobros pendientes en T3+ (>30d) |
| Provisiones | `Snapshot[PROVISIONES]` | Incentivos de marca sin facturar >90d |

---

## Mapa de archivos

```
agent/
├── CESAR.md          ← estás aquí — documentación y contexto para próximas sesiones
├── indicadores.py    ← FUENTE DE VERDAD del negocio: umbrales, KPIs, lógica de gestión
├── agent.py          ← LangGraph + GPT-4o: system prompt, tools registradas, checkpointer
├── tools.py          ← 21 tools de negocio que usan database.py
├── database.py       ← queries asyncpg sobre PostgreSQL (mismo DB que Next.js)
├── webhook.py        ← FastAPI: recibe WhatsApp, despacha mensajes, endpoints de debug
├── cron.py           ← APScheduler: briefing 09:00 + seguimiento 15:00 (L-V)
├── config.py         ← Pydantic Settings: env vars
├── whatsapp.py       ← cliente Meta Graph API v20.0
└── mcp_server.py     ← expone tools como MCP server (para Claude Desktop)
```

---

## Las 21 tools de César

### Resumen y diagnóstico
| Tool | Cuándo la usa César |
|---|---|
| `get_briefing` | Al iniciar la conversación o pedir resumen del día |
| `ver_capital_consolidado` | "¿cómo estamos?", resumen financiero, capital total |
| `ver_capital_por_marca` | Desglose ejecutivo por marca (GERENTE_GENERAL ve todo) |
| `analisis_capital` | Tendencia histórica — mejora/empeora vs semanas anteriores |
| `ver_capital` | Capital de stock desglosado Propio/FP/Financiado |
| `ver_accionables` | Casos sin gestión reciente + preguntas de seguimiento |
| `ver_alarmas` | Casos urgentes: vencidos, críticos, sin movimiento |
| `ver_alertas_stock` | Inmovilizados >180d, pagados >60d, judiciales, Stock B |
| `ver_lineas_credito` | Líneas por marca con semáforo de ocupación |

### FNE — Facturados No Entregados
| Tool | Cuándo la usa César |
|---|---|
| `ver_fne` | Resumen FNE con aging buckets |
| `ver_fne_detalle` | Lista completa agrupada por estado del pipeline de patente |
| `ver_fne_vin` | Pipeline checklist de un VIN específico en FNE |

### Saldos y Provisiones
| Tool | Cuándo la usa César |
|---|---|
| `ver_saldos_t3_detalle` | Lista completa de saldos T3-T7 por tramo |
| `ver_provisiones_detalle` | Todas las provisiones con ID (PROV-XXX), marca, aging |

### Gestión de VINs
| Tool | Cuándo la usa César |
|---|---|
| `get_detalle_vin` | Ficha VIN: estado, prioridad, historial, contexto temporal |
| `ver_vin_360` | Vista cruzada de un VIN en stock + FNE + saldos + gestión |
| `update_estado` | Cambiar estadoGestion (ABIERTO/EN_CURSO/ESPERANDO/RESUELTO/CANCELADO) |
| `update_prioridad` | Cambiar prioridad (BAJA/MEDIA/ALTA/CRITICA) |
| `reasignar` | Cambiar responsable del caso |
| `guardar_comentario` | Agregar comentario + auditoría en HistorialGestion |
| `guardar_proxima_accion` | Definir próxima acción concreta |

---

## Lógica de negocio clave (todo en `indicadores.py`)

### Score Gerencial (0–100)
Cuatro indicadores con pesos fijos. El score mejora cuando se recupera capital.

| Indicador | Peso | Meta | Modificar en |
|---|---|---|---|
| Stock propio ≤5% del valorizado | 40 | ≤5% | `SCORE_GERENCIAL["stock_propio"]` |
| Provisiones no facturadas >90d = 0 | 40 | 0 casos | `SCORE_GERENCIAL["provisiones_90d"]` |
| Crédito Pompeyo >15d = 0 | 10 | 0 casos | `SCORE_GERENCIAL["cp_15d"]` |
| Saldos vehículo T3+ ≤15% | 10 | ≤15% | `SCORE_GERENCIAL["saldos_t3"]` |

### Tipos de stock — tres flujos distintos

| Tipo | Gestión | Umbral alerta | Umbral crítico |
|---|---|---|---|
| Stock A | Comercial: precio, promoción, transferencia | 90d | 180d |
| Stock B | Operacional: reparación, taller, plazo de salida | 30d | 60d |
| Judicial | Legal: solo seguimiento, NO acciones comerciales | 30d | 90d |

Los umbrales están en `LOGICA_STOCK_AB`. Las acciones y preguntas de seguimiento también.

### Accionabilidad
Cada peso parado tiene velocidad: `rapido` (esta semana) / `medio` (1-2 semanas) / `bloqueado`.
Ver `ACCIONABILIDAD` en `indicadores.py` para todas las reglas.

### Seguimiento proactivo
Cuando un caso accionable lleva N días sin comentario, César pregunta directamente.
Los textos están en `SEGUIMIENTO_PROACTIVO`. Modificar ahí para cambiar el tono o el contenido.

---

## Contexto temporal de un VIN

Cada VIN consultado incluye automáticamente:
- `semanas_en_gestion` — desde `GestionVIN.createdAt`
- `snapshots_sin_cambio` — snapshots BASE_STOCK desde último update (calculado en SQL, sin campo nuevo)
- `es_cronico` — True si ≥4 snapshots sin cambio
- `ultimo_comentario_gerencia` — último comentario de GERENTE/DIRECTOR/GERENTE_GENERAL con días de antigüedad

---

## Crons diarios (L-V, hora Chile)

| Hora | Job | Destinatarios | Contenido |
|---|---|---|---|
| 08:00 | `briefing_diario` | Todos los usuarios con teléfono | GERENTE_GENERAL → vista global del grupo; GERENTE/JEFE_MARCA → mini-resumen por marca |
| 15:00 | `seguimiento_tarde` | GERENTE_GENERAL, GERENTE y JEFE_MARCA | Accionables de caja rápida: FNE listo para entregar, CP vencidos, provisiones >90d |

Cambiar horarios: variables `BRIEFING_HORA` y `SEGUIMIENTO_HORA` en Railway.
El seguimiento **no envía** si no hay accionables pendientes.

---

## Roles y visibilidad

| Rol | Ve marcas | Acceso |
|---|---|---|
| ADMIN | Todas | Todo |
| DIRECTOR | Todas | Solo lectura |
| GERENTE_GENERAL | Todas | Gestión + usuarios |
| GERENTE | Solo sus marcas | KPIs de sus marcas |
| JEFE_MARCA | Solo sus marcas | Operacional |

`ROLES_VISION_GLOBAL = {"ADMIN", "DIRECTOR", "GERENTE_GENERAL"}` en `tools.py`.

---

## Hook de escalada (pendiente de activar)

Cuando GERENTE/DIRECTOR/GERENTE_GENERAL comenta un VIN → notificar al responsable por WhatsApp.
El código está comentado en `tools.py → agregar_comentario()`.
Para activar: descomentar el bloque `# HOOK DE ESCALADA` y agregar `get_user_by_email` en `database.py`.

---

## Fuentes de datos — estructura JSONB

Todos los datos viven en `Snapshot.payload` como JSONB según la fuente:

| Fuente | Array | Campos clave |
|---|---|---|
| `BASE_STOCK` | `payload->'vehiculos'` | vin, marcaPompeyo, tipoStock, stockAB, diasStock, costoNeto, esJudicial, esStockB, pagado |
| `FNE` | `payload->'registros'` | vin, valorFactura, diasDesdeVenta, agingBucket, estadoEntrega signals, pipeline patente |
| `SALDOS` | `payload->'registros'` | categoria, subTipo, statusDPS, saldoXDocumentar, diasArchivo, vinResuelto |
| `PROVISIONES` | `payload->'registros'` | claveGestion (ID), estado, agingDias, montoProvision, saldo, origen (marca) |
| `BASE_STOCK` | `payload->'lineas'` | marca, autorizado, ocupado, libre, semaforo |

---

## Pendientes para próximas sesiones

- [ ] `buscar_stock(marca, modelo, dias)` — búsqueda de VINs por criterio
- [ ] `ver_sin_proxima_accion()` — VINs activos sin próxima acción definida
- [ ] `buscar_saldo(cajon_o_vin)` — buscar saldo por cajón o VIN específico
- [ ] LangGraph Store — memoria persistente por usuario (alertas, preferencias, contexto)
- [ ] Hook de escalada activado — notificación push cuando gerencia comenta un VIN
- [ ] Snapshot diff cron — detectar cambios entre reportes y notificar proactivamente
- [ ] `ver_provisiones_facturadas()` — referencia histórica de las ya facturadas

---

## Variables de entorno (Railway)

| Variable | Default | Descripción |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL compartida con Next.js |
| `OPENAI_API_KEY` | — | GPT-4o |
| `WHATSAPP_ACCESS_TOKEN` | — | Meta Graph API |
| `WHATSAPP_PHONE_NUMBER_ID` | — | ID del número Business |
| `WHATSAPP_VERIFY_TOKEN` | — | Token verificación webhook |
| `BRIEFING_HORA` | `09:00` | Hora briefing matutino |
| `SEGUIMIENTO_HORA` | `15:00` | Hora seguimiento tarde |

---

## Cómo agregar una tool nueva

1. Agregar query en `database.py`
2. Agregar función en `tools.py` (usa `ROLES_VISION_GLOBAL` para filtro de marcas)
3. Registrar en `agent.py` con `@tool` y descripción clara de cuándo usarla
4. Agregar a `LANGCHAIN_TOOLS`
5. Si tiene umbrales o lógica de negocio → definir en `indicadores.py` primero

## Cómo modificar un indicador

Solo tocar `indicadores.py`. Ningún otro archivo.
