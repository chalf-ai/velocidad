# INFORME EJECUTIVO — Auditoría logística y diseño ROMIA

**Fecha:** 2026-05-28
**Archivos auditados:**
- `SCHIAPPCASSE 28 de Mayo.xlsx` (10 hojas, 1.78 MB)
- `KAR-LOGISTICS 28 de Mayo.xlsx` (9 hojas, 1.80 MB)
**Contexto cruzado:**
- `Actas al 28 de Mayo.xlsx` (7.105 filas hoja ROMA)
- Base Stock (Informe Stock y Lineas 25 Mayo)
- Universo FNE operativo derivado: 854 VINs

---

## 1. RESUMEN EJECUTIVO

Las dos bodegas (Schiappcasse y KAR-Logistics) operan con **estructuras de planillas casi idénticas** pero divididas por marcas:

| Bodega | Marcas | VINs únicos | Tamaño operativo |
|---|---|---|---|
| **SCHIAPPACASSE** | KIA, MG, DFSK, LANDKING, SUBARU, NAMMI, DONGFENG | 9.319 | Más reciente (1.78 MB) |
| **KAR-LOGISTICS** | PEUGEOT, CITROEN, GEELY, OPEL, LEAPMOTOR, SUZUKI, NISSAN, GREAT WALL | 9.734 | Levemente más grande (1.80 MB) |

**Hallazgos críticos:**

1. **VIN es llave maestra universal** — 100% cobertura en todas las hojas core. Sin VIN no hay análisis. Cajón = sufijo del VIN (no es llave independiente).

2. **El "flujo" actual NO es lineal**. Las hojas "Compra Marca" y "Almacenamiento" reflejan STOCK VIVO HOY, no eventos pasados. "ENTRADAS" y "SALIDAS" son LOGS de eventos. Esto explica por qué VINs aparecen en `SALIDAS` sin haber pasado por `Compra Marca` (ya salieron del stock).

3. **76 VINs aparecen en ambas bodegas** — overlap operacional real (traslados entre patios). La separación marca-bodega no es estanca.

4. **Cobertura FNE en logística = 94.7%** (806/851 FNE). Solo 45 VINs FNE no aparecen en ninguna planilla logística. Hay base sólida para construir un módulo unificado.

5. **6.160 entregados (de 6.251) aparecen en logística** = el archivo logístico es la fuente operativa más completa para reconstruir tiempos históricos.

6. **Cuello de botella detectado en KAR:** solo **7% de las Solicitudes de Venta** están en Distribución (vs 52% en Schiapp). KAR tiene 97 solicitudes activas sin avanzar a despacho — *brecha operacional grande*.

7. **"0" se usa como null sentinel** en muchas columnas de fecha — anti-patrón que necesita normalización antes de cualquier cálculo de tiempos.

---

## 2. AUDITORÍA DE HOJAS

### 2.1 SCHIAPPACASSE — 10 hojas

| Hoja | Filas datos | Cols | Propósito operacional | Tipo | VIN llave |
|---|---|---|---|---|---|
| **Compra Marca** | 106 | 14 | Vehículos comprometidos por la marca, pendientes de llegar al patio | Stock vivo (snapshot) | ✅ 100% |
| **Almacenamiento** | 502 | 22 | Vehículos físicamente en patio Schiapp | Stock vivo (snapshot) | ✅ 100% |
| **Distribución** | 2.664 | 32 | Planilla activa de movimientos solicitados — la **hoja central** de gestión | Operativo activo | ✅ 100% |
| **Listado laminado** | 30 | 8 | Pendientes de laminar (cobertura 30%) | Auxiliar | Parcial |
| **ENTRADAS** | 698 | 20 | Recepciones físicas recientes en patio (con campos Bloqueado, Existencia en planilla) | Log eventos | ✅ 85.8% |
| **SALIDAS** | 8.622 | 18 | Log histórico de despachos (incluye 27 VINs duplicados → mismo VIN salió varias veces) | Log eventos | ✅ 100% |
| **Solicitud Venta** | 48 | 22 | Solicitudes activas de venta pendientes (ID `VentaID`) | Operativo activo | ✅ 100% |
| **Solicitud Vitrina** | 33 (10 con datos) | 20 | Solicitudes activas de vitrina | Operativo activo | ✅ parcial |
| **AUX** | 172 | 8 | Auxiliar listado de marcas / bodegas / tipo solicitud | Maestra interna | ❌ no aplica |
| **DIRECCIONES** | 22 | 3 | Directorio de sucursales con dirección y comuna | Maestra interna | ❌ no aplica |

### 2.2 KAR-LOGISTICS — 9 hojas (estructura casi-espejo de Schiapp)

| Hoja | Filas datos | Cols | Notas |
|---|---|---|---|
| **Compras Marca** | 263 | 20 | Incluye "Fecha estimada STELLANTIS" (multimarca futura), "Detalle daños" |
| **Almacenamiento** | 373 | 17 | Tiene `Estado Kar` (PROCESADO ALMACENAJE/STOCK DISPONIBLE/STOCK-DAÑOS/NO DISPONIBLE) |
| **Distribucion** | 2.941 | 32 | Espejo de Schiapp con `Fecha limite` + `Cumplimiento fecha limite` (CUMPLIDO/NO CUMPLIDO/NA) |
| **ENTRADAS** | 478 | 14 | Simplificado vs Schiapp; tiene `Estado Gp Simplificado` |
| **SALIDAS** | 8.989 | 14 | Solo 2 VINs duplicados (menos repetición que Schiapp) |
| **Solicitud Venta** | 166 (104 con VIN) | 22 | Tiene `FechaAdjunto` adicional |
| **Solicitud Vitrina** | 23 | 18 | Cobertura ínfima dado el rango A1:R4050 (hoja sobre-dimensionada) |
| **AUX** | 11 | 23 | Catálogo de estados, marcas y bodegas |
| **CODIGO DESPACHO** | 7 | 6 | Códigos despacho Stellantis (`CLDN012XX`) por punto de entrega |

### 2.3 Problemas de calidad detectados

| Problema | Hojas afectadas | Severidad |
|---|---|---|
| **"0" como null** en Fecha Factura / Fecha Inscripcion / Sucursal Venta | Compra Marca + Almacenamiento (ambos archivos) | 🔴 Alta — bloquea cálculo de tiempos |
| **Tipos string en columnas que deberían ser date** | Fecha Factura, Fecha Inscripcion | 🔴 Alta — incompatible con aritmética |
| **Columnas vacías** (cov=0%): Fecha estimada INCHCAPE, Fecha de Inspeccion, fecha_recepcion, FechaETASucursal | 4 hojas distintas | 🟡 Media — campos placeholders |
| **Headers en fila 2** en algunas hojas con título mergeado en fila 1 | Posible (heurística no triggereó) | 🟢 Baja |
| **27 VINs duplicados en SALIDAS Schiapp** (mismo VIN sale 2 veces) | SALIDAS | 🟢 OK — legítimo (devolución + re-despacho) |
| **76 VINs en ambas bodegas** | Cross-archivo | 🟡 Media — traslados patios sin trazabilidad clara |
| **"PATIO - DAÑOS SIN OT"** (3 VINs Schiapp) — autos dañados sin OT abierta | Almacenamiento | 🟡 Media — riesgo de stock estancado |
| **47 de 48 Solicitudes Venta Schiapp en `Respuesta Logistica [Instalación de acc]`** | Solicitud Venta | 🟢 OK — único PasoActual |
| **Existencia en planilla = NO EXISTE** en 106/166 Solicitudes Venta KAR | Solicitud Venta KAR | 🔴 Alta — desfase entre solicitud y stock |
| **Dest.Vta ROMA = "0"** en 98.6% Distribución Schiapp (2.638 de 2.664) | Distribución | 🟡 Media — solo 26 tienen destino ROMA específico |

---

## 3. FLUJO OPERACIONAL RECONSTRUIDO

### 3.1 Realidad operacional (NO lo que la estructura sugiere)

```
                     ┌─────────────────────────────────────────────┐
                     │  COMPROMISO COMERCIAL (no hay hoja dedicada)│
                     │  (origen externo: contratos con marcas)     │
                     └────────────────────┬────────────────────────┘
                                          │
                                          ▼
            ┌─────────────────────────────────────────────────┐
            │ HOJA: Compra Marca / Compras Marca              │
            │ Evento: vehículo prometido por la marca, fecha  │
            │ estimada de llegada al patio                    │
            │ Estado: PRE-RECEPCIÓN                           │
            └───────────────────────┬─────────────────────────┘
                                    │  Fecha llegada
                                    ▼
            ┌─────────────────────────────────────────────────┐
            │ HOJA: ENTRADAS                                  │
            │ Evento: recepción física en patio               │
            │ Campos: Fecha Ent, Estado, Zona/Calle/Posicion  │
            │ Estado: RECIBIDO / EN PROCESO PDI               │
            └───────────────────────┬─────────────────────────┘
                                    │  Inspección + PDI cerrado
                                    ▼
            ┌─────────────────────────────────────────────────┐
            │ HOJA: Almacenamiento                            │
            │ Evento: vehículo apto para distribuir           │
            │ Campos: 1° dia Almacenaje, Dias de Stock        │
            │ Estado: PATIO - ALMACENADO (479/502 Schiapp)    │
            └───────────────────────┬─────────────────────────┘
                                    │  Venta o vitrina pide vehículo
                                    ▼
            ┌─────────────────────────────────────────────────┐
            │ HOJA: Solicitud Venta / Solicitud Vitrina       │
            │ Evento: ROMA solicita asignación                │
            │ Campos: FechaSolicitud, FechaEstimadaEntrega,   │
            │         Sucursal Destino, varTieneLamina        │
            │ Estado: SOLICITADO / EN PREPARACIÓN ACC.        │
            └───────────────────────┬─────────────────────────┘
                                    │  Logística confirma + asigna
                                    ▼
            ┌─────────────────────────────────────────────────┐
            │ HOJA: Distribución / Distribucion               │
            │ Evento: planilla maestra de movimientos         │
            │ Campos: Fecha despacho a sucursal, Tipo solic., │
            │         Fecha teorica STLI, N° Traslados,       │
            │         Cumplimiento despacho                   │
            │ Estado: DESPACHADO / EN TRANSITO                │
            └───────────────────────┬─────────────────────────┘
                                    │  Camión sale del patio
                                    ▼
            ┌─────────────────────────────────────────────────┐
            │ HOJA: SALIDAS                                   │
            │ Evento: log físico de salida                    │
            │ Campos: Fecha Sal, Transportista, Placa Camion, │
            │         Conductor, Albaran/Ref Carga, Destino   │
            │ Estado: SALIDO DE BODEGA                        │
            └───────────────────────┬─────────────────────────┘
                                    │  ⚠ NO HAY HOJA que confirme
                                    │     llegada a sucursal
                                    ▼
            ┌─────────────────────────────────────────────────┐
            │ HOJA: Actas (Actas al 28 de Mayo.xlsx) ROMA     │
            │ Evento: cruce con flujo FNE/entrega final       │
            │ Campos: fecha_patente_recibida (= en sucursal), │
            │         entrega_auto_txt = "Cargado"            │
            └─────────────────────────────────────────────────┘
```

### 3.2 Etapas reales con dato/fecha disponible

| # | Etapa | Hoja origen | Campo fecha | ¿Disponible? |
|---|---|---|---|---|
| 1 | Compra acordada con marca | Compra Marca | `Compra Marca` / `Fecha Compra Marca` | ✅ 96-100% |
| 2 | Fecha estimada llegada | Compra Marca KAR | `1° Fecha estimada STELLANTIS` | ⚠ solo KAR, 44% cobertura |
| 3 | Recepción física en patio | ENTRADAS | `Fecha Ent` (Schiapp) / `Fecha Entrada` (KAR) | ✅ 86-97% |
| 4 | Almacenado disponible | Almacenamiento | `1° dia Almacenaje en bodega` | ✅ 99-100% |
| 5 | Solicitud de venta creada | Solicitud Venta | `FechaSolicitud` | ✅ 63-100% |
| 6 | Estimación entrega ROMA | Solicitud Venta | `FechaEstimadaEntrega` | ✅ 63-100% |
| 7 | Fecha despacho a sucursal | Distribución | `Fecha despacho a sucursal` | ✅ 100% |
| 8 | Fecha teórica STLI | Distribución | `Fecha teorica STLI` | ✅ 98% |
| 9 | Salida física | SALIDAS | `Fecha Sal` / `Fecha Salida` | ✅ 100% |
| 10 | **Recepción en sucursal** | ❌ **FALTA** (debe inferirse de FNE `fecha_patente_recibida`) | — | 🔴 GAP |
| 11 | Facturación | Distribución / Actas | `Fecha Factura` / `FechaFactura` | ⚠ "0" como null |
| 12 | Inscripción | Distribución / Actas | `Fecha Inscripcion` / `FechaInscripcion` | ⚠ "0" como null |
| 13 | Entrega final al cliente | Actas | `entrega_auto_txt = "Cargado"` + `fecha_patente_entregada` | ✅ binario |

### 3.3 Estados operacionales calculables hoy

Mutuamente excluyentes (ordenados de "más adelante" a "más atrás"):

1. **ENTREGADO** — Actas: `entrega_auto_txt === "Cargado"` (univ. 6.251)
2. **LISTO_PARA_ENTREGA** — FNE: patente recibida + sol_entrega=Si + autorización=Si (univ. 125)
3. **EN_SUCURSAL_PENDIENTE_TRÁMITE** — FNE: `fecha_patente_recibida != null` y NO listo (univ. 175)
4. **EN_TRÁNSITO_A_SUCURSAL** — SALIDAS con fecha reciente sin patente recibida en FNE
5. **DESPACHADO** — Distribución con `Fecha despacho a sucursal` poblada
6. **SOLICITADO_LISTO_PARA_DESPACHO** — Solicitud Venta + PasoActual válido + sin Fecha despacho
7. **EN_PREPARACIÓN_ACCESORIOS** — Solicitud Venta + PasoActual = `Respuesta Logistica [Instalación de acc]` + `Laminas según Modelo = TINTE`
8. **ALMACENADO_LIBRE** — Almacenamiento + `Disponible en bodega = PATIO - ALMACENADO` SIN solicitud activa
9. **ALMACENADO_BLOQUEADO** — Almacenamiento + `PATIO - DAÑOS SIN OT` / `RECEPCION SIN REVISAR`
10. **RECIBIDO_EN_PROCESO_PDI** — ENTRADAS + `PDI CERRADO - PDT CONTROL CALIDAD` / `PROCESO`
11. **PRE_RECEPCIÓN** — Compra Marca + NO en Almacenamiento todavía
12. **NO_TRACEABLE** — VIN en ninguna fuente conocida

---

## 4. PROBLEMAS DETECTADOS

### 4.1 De información

| Problema | Impacto operacional |
|---|---|
| **No hay hoja de "Recepción en sucursal"** (etapa 10) | Crítico — el ciclo logístico se corta al salir del patio. La sucursal confirma la recepción solo cuando pide la patente en FNE. Días sucursal-FNE quedan invisibles. |
| **"Fecha Factura" / "Fecha Inscripcion" como string con "0"** | Bloquea cálculo automático de SLA. Hay que normalizar. |
| **45 VINs FNE sin track logístico** | 5.3% del universo FNE no aparece en logística — investigar fuente (autos sin pasar por bodega: VPP, traspasos directos). |
| **Solicitud Vitrina sub-utilizada** | Solo 10-23 filas con datos vs hojas pre-dimensionadas a 3000+ filas. Riesgo: muchas solicitudes informales por fuera. |
| **76 VINs en ambas bodegas sin trazabilidad cruzada** | Traslados Schiapp↔KAR sin marca explícita de evento. |
| **`Dest.Vta ROMA = "0"` en 98.6%** | El campo destino ROMA está vacío por defecto — solo poblado en excepciones. |

### 4.2 De proceso

| Problema | Síntoma |
|---|---|
| **Cuello de botella KAR Solicitud Venta** | 7% en Distribución vs 52% Schiapp = 97 solicitudes activas sin moverse |
| **`Existencia en planilla = NO EXISTE`** en 106/166 KAR Solicitud Venta | Solicita un VIN que no figura en su planilla de stock |
| **`Cumplimiento despacho = NO CUMPLIDO`** en 820/2.664 Distribución Schiapp (31%) | Casi 1/3 de los despachos llegaron tarde |
| **412 VINs con `2° Traslado`** + 3 con 3°, 1 con 4° (KAR) | Movimientos repetidos — reasignaciones, devoluciones |

### 4.3 De integridad

| Problema | Detalle |
|---|---|
| Columna `Sucursal Vitrina` con 1 solo valor distinto | Campo muerto en producción |
| `Fecha de Inspeccion` 100% vacía (Almacenamiento Schiapp) | Inspección no se registra ahí |
| Inconsistencia case-sensitive: `Tipo solicitud` mezcla "VENTA"/"VITRINA"/"USADOS"/"TRASPASO"/"TEST CAR"/"DONANTE" + variantes | OK pero requiere taxonomía cerrada |
| `Estado Kar` con espacio final (`"Estado Kar "`) | Riesgo error al referenciar columna |

---

## 5. KPIs DISPONIBLES — calculables HOY

### 5.1 Productividad

| KPI | Fuente | Calculable |
|---|---|---|
| Vehículos comprados acumulado | Compra Marca + Compras Marca | ✅ 369 vehículos activos en pre-recepción |
| Vehículos en patio (stock vivo) | Almacenamiento | ✅ 875 (502 SCH + 373 KAR) |
| Entradas del mes | ENTRADAS | ✅ con `Fecha Ent` |
| Salidas del mes | SALIDAS | ✅ con `Fecha Sal` |
| Despachos activos | Distribución | ✅ 5.605 (2.664+2.941) |
| Traslados repetidos | Distribución (N° Traslados) | ✅ ~412 con ≥2 traslados |

### 5.2 Tiempos (etapas)

| KPI | Cálculo | Disponible |
|---|---|---|
| Pre-recepción → almacenado | `1° dia Almacenaje` − `Fecha Compra marca` (= `Dias preentrega`) | ✅ ya calculado |
| Almacenado → solicitud | `FechaSolicitud` − `1° dia Almacenaje` | ✅ con normalización fecha |
| Solicitud → despacho | `Fecha despacho a sucursal` − `FechaSolicitud` | ✅ |
| Despacho → salida física | `Fecha Sal` − `Fecha despacho a sucursal` | ✅ |
| Salida → recepción sucursal | **❌ no hay dato directo** (usar FNE `fecha_patente_recibida`) | 🟡 inferible |
| Recepción → entrega cliente | FNE: `fecha_patente_entregada` − `fecha_patente_recibida` | ✅ vía Actas |
| Ciclo total: compra → entrega | `fecha_patente_entregada` − `Fecha Compra marca` | ✅ end-to-end |

### 5.3 Cuellos de botella

| KPI | Cálculo |
|---|---|
| Stock detenido en patio >30d | Almacenamiento `Dias de Stock > 30` |
| Solicitudes sin avanzar | Solicitud Venta sin VIN en Distribución |
| Despachos no cumplidos | Distribución `Cumplimiento despacho = NO CUMPLIDO` |
| Daños sin OT | Almacenamiento `PATIO - DAÑOS SIN OT` |
| Recepción sin revisar (PDI pendiente) | ENTRADAS `PATIO - RECEPCION SIN REVISAR` + `PDI CERRADO - PDT CONTROL CALIDAD` |

### 5.4 Velocity

| KPI | Cálculo |
|---|---|
| Días promedio por etapa | promedio de cada Δ fecha |
| Tiempo ciclo total | `entrega_final − compra_marca` |
| Velocidad por marca | agrupado por `Marca` |
| Velocidad por sucursal destino | `Sucursal Destino` / `Sucursal Venta` |
| Velocidad por bodega | Schiapp vs KAR |
| Velocidad por transportista | `Transportista Sal` / `Transportista` (SALIDAS) |

---

## 6. KPIs FALTANTES — gaps que cerrar

| KPI deseado | Por qué falta | Cómo cerrarlo |
|---|---|---|
| **Recepción física en sucursal confirmada** | No existe hoja específica | Inferir desde Actas `fecha_patente_recibida` o crear hoja "Recepción Sucursal" |
| **Tiempo en cada estado actual del FNE** | Cada estado tiene fecha referencia pero el delta requiere snapshot anterior | Capturar snapshots periódicos |
| **Tasa de devolución bodega** | No se marca explícitamente | Detectar VINs con `2° Traslado` cuyo segundo destino = bodega de origen |
| **Bloqueo financiero (Crédito Pompeyo)** | No es campo de logística | Cruzar con Saldos `subTipo=credito_pompeyo` |
| **Cumplimiento ETA cliente final** | `FechaEstimadaEntrega` vs entrega real | Cruzar Solicitud Venta `FechaEstimadaEntrega` vs Actas `fecha_patente_entregada` |
| **Throughput por operador logístico** | No hay campo "operador" — solo transportista en SALIDAS | Definir taxonomía operador |
| **Costo logístico por etapa** | Datos de costo no están en logística | Integrar con líneas de crédito + tarifario transportista |
| **Tiempo "ocioso" entre eventos** | Implícito en deltas, pero hace falta consolidarlo | Calcular y exponer como % del ciclo |

---

## 7. DISEÑO FUTURO RECOMENDADO — ROMIA conceptual

### 7.1 Principio rector

> **Una sola línea de tiempo por VIN, con eventos atómicos timestamped y estado actual derivado de la última señal.**

NO replicar la estructura Excel. Eliminar:
- Snapshot mezclado con log
- Columnas auxiliares por traslado (2°, 3°, 4° → tabla de eventos)
- Estado implícito en cobertura de campos

### 7.2 Entidades núcleo

```
┌───────────────────────────────────────────────────────────┐
│ VEHICULO                                                  │
│   vin                  string  (PK)                       │
│   marca                string                             │
│   modelo               string                             │
│   version              string                             │
│   color                string                             │
│   cajon                string  (sufijo VIN, derivado)     │
│   anio                 int                                │
│   valorCompraMarca     decimal                            │
│   fechaCompraMarca     date                               │
│   estadoActual         enum    (derivado)                 │
│   bodegaActual         enum    (derivado del último evento)│
│   sucursalDestino      string  (de solicitud vigente)     │
└─────────────────────┬─────────────────────────────────────┘
                      │ 1:N
                      ▼
┌───────────────────────────────────────────────────────────┐
│ EVENTO_LOGISTICO   (event-sourcing)                       │
│   id                   uuid    (PK)                       │
│   vin                  string  (FK → VEHICULO)            │
│   fechaEvento          datetime                           │
│   tipo                 enum    (ver § 7.4)                │
│   bodegaOrigen         enum    (Schiapp/KAR/Sucursal)     │
│   bodegaDestino        enum                               │
│   actor                string  (sistema/operador/ROMA)    │
│   referencia           string  (Albaran, VentaID, etc)    │
│   payload              jsonb   (campos específicos del    │
│                                 evento: transportista,    │
│                                 placa, observación, etc)  │
│   solicitudId          uuid    (FK opc → SOLICITUD)       │
└───────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────┐
│ SOLICITUD                                                 │
│   id                   uuid    (PK)                       │
│   vin                  string  (FK)                       │
│   tipo                 enum    (VENTA, VITRINA, TRASPASO, │
│                                 TEST_CAR, USADOS,         │
│                                 DONANTE, FLOTA)           │
│   sucursalDestino      string                             │
│   gerencia             string                             │
│   fechaCreacion        datetime                           │
│   fechaEstimadaEntrega date                               │
│   fechaCierre          date                               │
│   estado               enum    (ABIERTA, EN_PROCESO,      │
│                                 CUMPLIDA, CANCELADA)      │
│   accesoriosRequeridos boolean                            │
│   laminasRequeridas    enum                               │
│   ventaIdLegado        string  (compat con sistema viejo) │
└───────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────┐
│ BODEGA                                                    │
│   id                   string  (PK: 'schiapp'/'kar'/...)  │
│   nombre               string                             │
│   tipo                 enum    (logistica_externa/        │
│                                 sucursal/almacen_marca)   │
│   marcasOperadas       string[] (KIA, MG, ... )           │
│   direccion            string                             │
│   comuna               string                             │
└───────────────────────────────────────────────────────────┘
```

### 7.3 Estados consolidados (única fuente de verdad)

```ts
type EstadoLogistico =
  | "PRE_RECEPCION"            // compra acordada, no llega aún
  | "RECIBIDO_EN_PDI"          // llegó, inspección en proceso
  | "ALMACENADO_LIBRE"         // disponible para asignar
  | "ALMACENADO_BLOQUEADO"     // daños / sin OT / sin revisar
  | "SOLICITADO_PENDIENTE_ACC" // solicitud activa, preparando accesorios/láminas
  | "SOLICITADO_LISTO"         // solicitud lista para despacho
  | "EN_TRANSITO_A_SUCURSAL"   // despachado, sin confirmación de llegada
  | "EN_SUCURSAL_PENDIENTE_TRAMITE" // FNE patente recibida sin sol_entrega/autorización
  | "LISTO_PARA_ENTREGA"       // FNE listo
  | "ENTREGADO";               // acta cargada
```

Estado se calcula con la cadena de eventos. Snapshot derivado, no almacenado.

### 7.4 Catálogo de eventos atómicos

```ts
type TipoEvento =
  | "COMPRA_ACORDADA"          // Compra Marca → fila nueva
  | "RECEPCION_FISICA"         // ENTRADAS
  | "INSPECCION_PDI_COMPLETA"  // PDI cerrado
  | "ALMACENADO_LIBERADO"      // 1° dia Almacenaje
  | "DAÑO_REGISTRADO"          // estado=PATIO - DAÑOS SIN OT
  | "DAÑO_RESUELTO"
  | "SOLICITUD_CREADA"         // Solicitud Venta/Vitrina
  | "SOLICITUD_RESPUESTA_LOGISTICA"
  | "LAMINADO_INICIADO"
  | "LAMINADO_COMPLETO"
  | "ACCESORIOS_INSTALADOS"
  | "DESPACHO_PROGRAMADO"      // Distribución `Fecha despacho a sucursal`
  | "SALIDA_FISICA"            // SALIDAS `Fecha Sal`
  | "TRANSITO_INTER_BODEGA"    // Schiapp ↔ KAR
  | "RECEPCION_EN_SUCURSAL"    // ⚠ nuevo: cerrar el gap
  | "FACTURADO"                // Fecha Factura
  | "INSCRIPCION_SOLICITADA"
  | "INSCRIPCION_COMPLETA"     // Fecha Inscripcion
  | "PATENTE_EN_ADMIN"
  | "PATENTE_EN_TRANSITO"
  | "PATENTE_EN_SUCURSAL"      // fecha_patente_recibida
  | "AUTORIZACION_ENTREGA"
  | "SOL_ENTREGA"
  | "ENTREGADO_CLIENTE";       // entrega_auto_txt = Cargado
```

### 7.5 Vista timeline por VIN

```
VIN: LVZBN2193SAA05054
────────────────────────────────────────────────────────────
 [─]  COMPRA_ACORDADA            2026-04-29   marca=DFSK
 ↓ 29d
 [─]  RECEPCION_FISICA           2026-05-28   bodega=schiapp
 ↓ 0d
 [─]  ALMACENADO_LIBERADO        2026-05-28   estado=PATIO-ALMACENADO
 ↓ pendiente
 [○]  SOLICITUD_CREADA           —
 [○]  DESPACHO_PROGRAMADO        —
 [○]  ENTREGADO_CLIENTE          —
────────────────────────────────────────────────────────────
Estado actual: ALMACENADO_LIBRE
Días en estado: 0
Próxima acción esperada: asignar a sucursal
```

---

## 8. INTEGRACIÓN CON ROMIA y módulos existentes

### 8.1 Capital de Trabajo

- **Stock financiado:** `EstadoLogistico ∈ {PRE_RECEPCION, RECIBIDO_EN_PDI, ALMACENADO_LIBRE, ALMACENADO_BLOQUEADO}` ⇒ capital en bodega.
- **Aging por etapa:** sumar `días en estado` × `valorCompraMarca` ⇒ K detenido.
- **Costo financiero:** integrar tarifa financiera (líneas KIA, MG, etc) × días.
- **Bodega bloqueada:** capital en `ALMACENADO_BLOQUEADO` (daños sin OT) = alerta crítica.

### 8.2 Facturados No Entregados (FNE)

- Hoy el FNE solo ve los datos del Excel Actas. Con ROMIA, cada FNE tiene además:
  - Última fecha logística conocida (`fechaSalidaFisica`)
  - Bodega de origen y trayecto completo
  - Si tuvo 2°/3° traslado (anti-patrón → cliente pidió cambio)
- **Listos para entrega** ahora valida: `FNE.listo === true && evento RECEPCION_EN_SUCURSAL existe`. Cierra el gap actual (no sabemos si el auto realmente llegó).

### 8.3 Velocity Operating System

- KPI maestro: **tiempo total ciclo (compra → entrega)** por marca, sucursal, bodega.
- Cuello de botella visible en cada etapa: `días promedio en estado X` ranking descendente.
- Capital detenido = velocidad inversa: `K bodega / vehículos entregados último mes`.
- Comparativa transportista: SALIDAS por `Transportista Sal` → días promedio salida→recepción.

---

## 9. QUICK WINS (sin construir ROMIA todavía)

Implementables sobre el código actual de Velocidad sin reestructuración:

| # | Quick win | Esfuerzo | Impacto |
|---|---|---|---|
| **QW1** | Parser unificado SCHIAPP + KAR a un único tipo `OperacionLogistica` (mismas columnas, source: 'schiapp'/'kar') | 1-2 días | Alto — base de todo lo siguiente |
| **QW2** | Cruce VIN logística → FNE actual: mostrar en `/facturados-no-entregados` la **última señal logística** por VIN (despacho, salida, traslado) | 2-3 días | Alto — destraba caso "auto sin track" |
| **QW3** | Alerta "FNE listo para entregar pero auto sin RECEPCION_EN_SUCURSAL confirmada" (cruce Distribución/Salidas con FNE) | 1 día | Medio — solo 125 unidades |
| **QW4** | Panel `Almacenamiento_Bloqueado`: 3-4 alertas por bodega (DAÑOS SIN OT, RECEPCION SIN REVISAR, NO DISPONIBLE) | 1 día | Medio — auditoría operacional |
| **QW5** | Tab "Cuello KAR Solicitudes Venta" — 97 solicitudes sin avanzar a Distribución | 1 día | Alto — gestión inmediata |
| **QW6** | KPI "Cumplimiento despacho %" — promedio Schiapp/KAR + breakdown por marca | 1 día | Alto — visibilidad operativa |
| **QW7** | Detección VINs en ambas bodegas → tab "Traslados inter-bodega" | 0.5 día | Bajo — 76 unidades, edge case |
| **QW8** | Normalizar "0" → null en Fecha Factura / Fecha Inscripcion al parsear | 0.5 día | Alto — desbloquea cálculos |

**Total QW = ~7-10 días** de trabajo para lograr visibilidad logística sin construir el modelo ROMIA completo.

---

## 10. ROADMAP DE IMPLEMENTACIÓN

### Fase 0 — Auditoría continua (semana 1)
- Confirmar regla de detección de cada estado con operaciones
- Validar 45 FNE sin track logístico — investigar si son VPP/traspaso/directo
- Validar 76 VINs en ambas bodegas
- Confirmar que `Existencia en planilla = NO EXISTE` en solicitudes KAR es un bug o un feature (transferencias)

### Fase 1 — Quick wins (semana 1-3)
Implementar QW1, QW2, QW3, QW4, QW5, QW6, QW8 sobre el código actual.
- Parser unificado en `src/lib/parser/romia-logistica.ts`
- Selector cruzado en `src/lib/selectors/romia-snapshot.ts`
- Tab "Logística" agregado a `/facturados-no-entregados`

### Fase 2 — Modelo eventos (semana 4-6)
- Schema `EventoLogistico` en Prisma
- Conversor "snapshot logístico Excel" → "stream de eventos atómicos"
- Vista timeline por VIN en `FichaOperacionalVIN`

### Fase 3 — Estado consolidado (semana 7-9)
- Función `deriveEstadoLogistico(vin, eventos)` → enum único
- Reemplazar todos los KPIs derivados de cobertura por estado consolidado
- Migrar FNE a depender de RECEPCION_EN_SUCURSAL

### Fase 4 — ROMIA completo (semana 10-12)
- API `/api/romia/timeline/:vin` con todos los eventos
- Panel "Velocidad operacional por etapa" con tiempos promedio por marca/sucursal/bodega
- Alertas por etapas con SLA violado
- Integración con Capital de Trabajo: K detenido por estado logístico

### Fase 5 — Predicción y optimización (post-ROMIA)
- Modelo: días esperados por etapa → desviación → alerta proactiva
- Ranking de transportistas por velocidad
- Comparativa marca: cuáles son rápidas vs lentas → señal a comercial

---

## ANEXO A — Llaves candidatas universales

| Hoja | Llave primaria | Llave secundaria | Notas |
|---|---|---|---|
| Todas las core | **VIN** | Cajón (sufijo VIN) | Universal |
| Solicitud Venta | VentaID | VIN | VentaID es ID externo (ROMA) |
| Solicitud Vitrina | ID | VIN | ID interno |
| SALIDAS Schiapp | Albaran Sal + VIN | — | Mismo VIN puede tener varios Albaran |
| SALIDAS KAR | Ref Carga + VIN | — | Similar |
| ENTRADAS | VIN + Fecha Ent | — | |
| Distribución | VIN + Fecha solicitud | — | Una solicitud por VIN viva |
| DIRECCIONES | NOMBRE SUCURSAL | — | Maestra |
| CODIGO DESPACHO | Codigo despacho | — | CLDN012XX |

## ANEXO B — Cobertura cruzada Logística ∩ FNE

```
FNE OPERATIVO total = 851 VINs
├─ En logística (cualquiera)       806 (94.7%)
├─── Schiapp                        375 (44.1%)
├─── KAR                            478 (56.2%)
└─ Sin track logístico              45  (5.3%)  ← investigar

FNE OPERATIVO por etapa logística:
                       Schiapp   KAR    Total
  Compra Marca         39        81     120
  Almacenamiento       62        27      89
  ENTRADAS             103       91     194
  Distribución         268       303    571   ← mayor concentración
  SALIDAS              222       289    511
  Solicitud Venta      40        100    140
  Solicitud Vitrina    0         1       1
```

## ANEXO C — Conteo de eventos esperados (proyección)

Si convertimos todo el archivo a stream de eventos:

```
COMPRA_ACORDADA               ~369   (106 + 263)
RECEPCION_FISICA            ~1.061   (599 + 462)
ALMACENADO_LIBERADO           ~875   (502 + 373)
SOLICITUD_CREADA              ~152   (48 + 104) [activos hoy]
DESPACHO_PROGRAMADO         ~5.605   (2664 + 2941)
SALIDA_FISICA              ~17.611   (8622 + 8989)
TRANSITO_INTER_BODEGA          ~76   (overlap)
LAMINADO                    ~1.181   (980 + 193 TINTE/VITRINA con dato)

TOTAL eventos universo          ~26.930
Eventos por VIN (avg)           ~1.4   (universo 19k VINs)
```

---

**FIN DEL INFORME — sin código implementado. Esperando OK para iniciar Fase 1 con quick wins.**
