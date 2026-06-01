# Decisión técnica — Histórico anual ROMA y Actas

**Estado:** Aprobado como base de diseño (no implementado todavía).
**Fecha:** 2026-05-28.
**Alcance:** define qué fuentes son snapshot vivo y cuáles son históricas
acumulativas, con qué llaves dedupean, qué política de merge usan y cómo se
cargan en el tiempo. NO es spec de implementación; es la decisión que la
implementación debe respetar.

---

## 1. Hallazgos de la auditoría (sólo evidencia)

Auditados 5 archivos ROMA cubriendo enero a mayo 2026 (4.859 filas totales).

### 1.1 ROMA no es ninguno de los modelos planteados originalmente

| Hipótesis original | Veredicto | Evidencia |
|---|---|---|
| A — Snapshot mensual independiente | ❌ descartado | Los rangos de FechaSolicitud se solapan entre archivos consecutivos (cada uno cubre ~2 meses) |
| B — Snapshot acumulativo | ❌ descartado | Los duplicados entre archivos son ~0.5%, no crecen mes a mes |
| C — Snapshot con arrastre de casos abiertos | ❌ descartado | Casos en estado "Pendiente" desaparecen del siguiente archivo igual que los cerrados |
| **D — Exports paginados por mes de FechaSolicitud** | ✅ confirmado | Patrón consistente en los 5 archivos |

### 1.2 Patrón real observado

Cada archivo ROMA es un **export filtrado por FechaSolicitud del mes**, con
buffer mínimo de bordes:

- ~98-99% de las filas de cada archivo tienen FechaSolicitud dentro del rango
  `mes principal ± 7 días`.
- Los 22 VentaIDs (de 4.794) que aparecen en más de un archivo son siempre
  casos del **borde del mes** (últimos días del mes A + primeros del B).
- 99.5% de los casos viven en un solo archivo.
- El acumulado A+B+C+D+E construye el histórico de solicitudes 2026
  enero-mayo con casi cero duplicación.

### 1.3 Comportamiento de los casos repetidos

De los 22 casos rastreados a través de archivos consecutivos:

- **Fechas de origen** (FechaSolicitud, FechaFactura, FechaInscripcion):
  100% **idénticas** entre exports → INMUTABLES.
- **Estado**: cambia en 4 de cada 5 casos → EVOLUTIVO.
- **PasoActual**: no cambia → ESTABLE.
- **fETASucursal**: puede cambiar de fecha a null y viceversa → EVOLUTIVO,
  con la trampa de que null no debe pisar una fecha previa.
- **Comentario**: cambia con frecuencia → EVOLUTIVO.

### 1.4 Volumen estimado para histórico anual

| Métrica | Estimado |
|---|---|
| VentaIDs únicos por mes | ~900-1.000 |
| VentaIDs únicos anual (12 meses) | ~10.000-12.000 |
| Duplicación esperada entre meses adyacentes | <1% |
| Payload raw por mes (JSON gzip) | ~150-200 KB |
| Payload raw anual | ~2-3 MB |

**Cero problema de performance previsto.**

---

## 2. Decisión sobre ROMA

### 2.1 Paradigma

ROMA es **histórico anual incremental acumulativo**.

### 2.2 Regla de carga

- Cada archivo se identifica por mes (`YYYY-MM`) usando el contenido,
  no el nombre del archivo.
- Algoritmo de detección: `mes = max(FechaSolicitud)` truncado a `YYYY-MM`.
  Validación cruzada: la moda de la distribución mensual debe coincidir.
- Los archivos se **acumulan**, no reemplazan.
- Recarga de un mes ya cargado: **permitida con confirmación explícita**.
  Aplica MergePolicy normalmente; el archivo nuevo gana para campos
  evolutivos.

### 2.3 Regla de reemplazo

NO hay reemplazo total de ROMA. Sólo merge incremental.

### 2.4 Tabla materializada deseada

Una tabla consolidada por VentaID con todos los casos del año, lista para
consulta. Se reconstruye desde los cortes raw cuando cambia MergePolicy o
cuando se recarga un mes.

---

## 3. Decisión sobre Actas

### 3.1 Doble uso

Actas debe convivir como **dos cosas simultáneas**:

| Uso | Comportamiento | Llave | Para |
|---|---|---|---|
| **Actas vivo** | Snapshot operativo (reemplaza al cargar archivo nuevo) | VIN | FNE operativo, Centro de Acción, KPIs del día |
| **Actas histórico anual** | Acumulativo por mes/corte | VIN | Reportes de Control de Negocio, Inscripciones, SLA patente, tiempos de entrega anual |

### 3.2 Diferencia con ROMA

- Actas trae el **universo completo de operaciones del corte** (entregadas + no
  entregadas), no paginado por mes de solicitud.
- Cada archivo de Actas **solapa casi 100%** con el anterior (en contraste con
  ROMA que solapa <1%).
- La separación vivo/histórico para Actas se hace **por interpretación**:
  - Vivo = último corte cargado (reemplaza el anterior para FNE operativo)
  - Histórico = todos los cortes archivados como serie temporal,
    consolidados por VIN con la versión más reciente de cada campo
    evolutivo, conservando el rastro de cada estado por fecha.

### 3.3 Regla de carga

- Cargar nuevo archivo Actas:
  - **Reemplaza el snapshot vivo** (Actas vivo) → el sistema operativo
    siempre ve el último corte.
  - **Se agrega al histórico** como corte fechado → guarda el archivo raw
    con su fecha de corte para análisis temporales.

### 3.4 Frecuencia esperada

Actas se carga frecuentemente (probablemente semanal). Cada carga genera
un nuevo corte histórico, no reemplaza los anteriores.

---

## 4. Decisión sobre KAR/SCHIAPP (logística operacional)

Por ahora se mantiene como está: **snapshot diario operativo en memoria del
cliente**, sin persistencia histórica.

- KAR/SCHIAPP no se incluyen en el modelo histórico anual de esta etapa.
- Cuando se decida persistir cortes diarios para análisis de evolución
  física, será fase posterior con modelo "cortes datados" (paradigma C
  del análisis previo).
- Por ahora la pregunta "¿cómo evolucionó la bodega físicamente esta
  semana?" no es respondible con el sistema. Se acepta como limitación
  conocida.

---

## 5. Llaves canónicas

### 5.1 ROMA

| Prioridad | Llave | Cobertura observada |
|---|---|---|
| 1 | `VentaID + VIN` | 100% en los 5 archivos auditados |
| 2 | `VIN + FechaSolicitud + Sucursal` | Fallback si VentaID es null (no observado en los 5 archivos) |
| 3 | Hash de campos canónicos | Tercer fallback teórico, no esperado en práctica |

VentaID es único globalmente y permanente. Se reutiliza al reaparecer
un caso reabierto, no se reasigna.

### 5.2 Actas

| Prioridad | Llave |
|---|---|
| 1 | `VIN` |

VIN es la llave natural de Actas. No usa VentaID (no existe en este
universo). Si un mismo VIN aparece varias veces en distintos cortes,
es la misma operación con estado evolutivo.

### 5.3 KAR/SCHIAPP (cuando se persistan en fase futura)

| Prioridad | Llave |
|---|---|
| 1 | `VIN + bodega + fechaCorte` |

Acepta que el mismo VIN puede aparecer en cortes consecutivos con
distinto estado físico (entró al patio, salió, volvió). Cada corte es
un evento independiente.

---

## 6. MergePolicy

Política declarativa por campo. Aplicada al consolidar la tabla materializada
desde los cortes raw.

### 6.1 ROMA — políticas por campo

| Tipo | Campos | Política |
|---|---|---|
| **INMUTABLES** | VentaID, VIN, Cajon, Marca, Modelo, ColorReferencial, Gerencia, FechaVenta, FechaSolicitud, FechaFactura, FechaEnprocesoIns | Primera ocurrencia gana. Si dos cortes traen valores distintos: registrar advertencia, no pisar |
| **EVOLUTIVOS** | Estado, Comentario, FechaETASucursal, FechaEstimadaEntrega, fecha_RespuestaGestionLogistica, fecha_RespuestaInstalacionAcc, FechaEstimadaLLegadaSucursal_Calculo | Versión del corte más reciente gana. **Excepción:** si el nuevo trae null para una fecha que el viejo tenía con valor, preservar el valor viejo ("no pisar fecha con null") |
| **ESTABLES** | PasoActual, Sucursal, VentaAcc, varTieneLamina | Last-write-wins. Sin preservación de null |
| **DERIVADOS** | Aging, días entre etapas, semáforo | Recalcular siempre. No persistir |

### 6.2 Actas — políticas por campo

| Tipo | Campos | Política |
|---|---|---|
| **INMUTABLES** | VIN, Cajon, Vin, Sucursal (al momento de venta), FechaVenta, FechaFactura, ValorFactura | Primera ocurrencia gana |
| **EVOLUTIVOS** | entrega_auto, entrega_auto_txt, fecha_patente_administracion, fecha_patente_enviada, fecha_patente_recibida, fecha_patente_entregada, sol_entrega, autorizacion_entrega, etapa | Versión del corte más reciente gana, con regla "no pisar fecha con null" |
| **ESTABLES** | Nombre_Cliente, Nombre_Vendedor | Last-write-wins |
| **DERIVADOS** | entregado, fneEstado, agingFNE | Recalcular siempre |

### 6.3 Regla universal "no pisar fecha con null"

Aplica a TODOS los campos de tipo fecha en campos evolutivos:

```
nueva fecha es null   AND   vieja fecha tiene valor   →   preservar vieja
nueva fecha tiene valor                              →   pisar con nueva
ambas null                                            →   null
```

Razón: ROMA puede borrar una ETA cuando se reagenda, y luego volver a
ponerla. No queremos perder la última ETA conocida si el archivo en curso
no la trae.

### 6.4 Auditoría de cambios

Cada corte que aplique merge debe registrar:
- VentaID o VIN del caso
- Campo modificado
- Valor anterior → valor nuevo
- Corte de origen

Esto permite reconstruir la historia de cambios y debuggear conflictos.

---

## 7. Modelo futuro de carga

### 7.1 ROMA — flujo

```
Usuario carga ROMA Mes X
       │
       ▼
detectarMes(archivo) → "2026-XX" por max(FechaSolicitud)
       │
       ▼
¿ya existe corte para 2026-XX?
       │
   ┌───┴───┐
  Sí       No
   │       │
   ▼       ▼
 Pedir   Procesar
 confir-  como nuevo
 mación
       │
       ▼
Guardar corte raw + metadatos en CorteROMAMensual
       │
       ▼
Re-consolidar HistoricoVentaID aplicando MergePolicy
       │
       ▼
Refrescar selectores derivados (KPIs, reportes)
```

### 7.2 Actas — flujo

```
Usuario carga Actas (corte fechado)
       │
       ▼
detectarFechaCorte(archivo) → fecha del corte
       │
       ▼
Snapshot vivo: reemplaza el anterior
       │
       ▼
Histórico: agregar como CorteActas nuevo
       │
       ▼
Re-consolidar HistoricoActasVIN con MergePolicy
```

### 7.3 Comportamiento esperado mes a mes

| Mes | Acción del usuario | Sistema |
|---|---|---|
| Enero | Carga 5 archivos retroactivos | Construye base histórica inicial enero-mayo 2026 |
| Junio | Carga ROMA junio | Acumula ~900 casos nuevos. Re-consolida. |
| Junio | Recarga ROMA mayo (versión actualizada) | Confirma reemplazo. Re-consolida (estados/comentarios cambian) |
| Cualquier día | Carga Actas semanal | Reemplaza Actas vivo. Agrega corte al histórico |

### 7.4 Volumen proyectado a fin de 2026

- HistoricoVentaID ROMA: ~12.000 filas
- CorteROMAMensual: 12 entradas con payload ~150 KB c/u = ~2 MB
- HistoricoActasVIN: ~6.000-8.000 VINs
- Cortes Actas (semanales): ~50 entradas con payload ~500 KB c/u = ~25 MB
- Total proyectado: < 30 MB persistido. Sin impacto de performance.

---

## 8. Qué queda fuera de esta etapa

Decisiones tomadas que NO se implementan en `feature/historico-anual`:

1. **Persistencia de KAR/SCHIAPP** — siguen en memoria del cliente
   solamente. Cuando se decida persistir cortes diarios, se hará en
   etapa posterior con modelo de cortes datados.

2. **Reportes finales** — esta etapa construye sólo el modelo de datos
   y la lógica de carga + merge. Los reportes ejecutivos
   (Control de Negocio, Velocidad Operacional, SLA por marca/sucursal)
   son fase 3 sobre la base construida acá.

3. **UI de cobertura temporal** — visualización tipo calendario
   "qué meses tengo cargados, qué meses faltan" es deseable pero
   se difiere a la implementación si hay tiempo. Mínimo necesario:
   listar los cortes cargados con su mes/fecha.

4. **Migración de datos en producción** — esta rama queda local
   hasta que el modelo se valide. Productivo requiere su propia
   migración Prisma cuidadosa y plan de rollback.

5. **Detección automática del fin de mes** — el sistema no debe
   intentar adivinar "ya cerró abril, archivar". El usuario decide
   cuándo recargar o no.

6. **Borrado de cortes** — fuera de alcance. Si se requiere
   eliminar un corte, se hace por consola/admin manualmente.

7. **Versionado de MergePolicy** — la política es código.
   Si cambia, se re-consolida todo. No hay UI para cambiarla.

---

## 9. Riesgos pendientes

### 9.1 De datos

| Riesgo | Mitigación |
|---|---|
| Un archivo ROMA viene con `max(FechaSolicitud)` ambiguo (mes diferente del nombre) | Detectar por contenido siempre, ignorar nombre. Confirmar al usuario el mes detectado antes de procesar |
| Estado de un caso "retrocede" (Realizada → Anulada en corte siguiente) | Es comportamiento real del negocio. Aceptar. Mostrar advertencia en auditoría |
| Fechas de origen difieren entre cortes para mismo VentaID | INMUTABLES por política, primera gana. Registrar advertencia. Investigar caso a caso |
| Un VentaID se reasigna a otro VIN (improbable pero teóricamente posible) | La llave compuesta VentaID+VIN previene. Si pasa: dos registros distintos en HistoricoVentaID |
| Actas viene con `entrega_auto_txt` cambiado retroactivamente | La MergePolicy "EVOLUTIVO" lo maneja. El más reciente gana |

### 9.2 De diseño

| Riesgo | Mitigación |
|---|---|
| MergePolicy mal calibrada para algún campo | Política declarativa, fácil de ajustar. Re-consolidación regenera tabla materializada |
| Volumen mayor al estimado en años siguientes | Cero impacto previsto. Si crece anormalmente, particionar por año |
| Cliente carga el mismo archivo dos veces | Detector por contenido lo identifica como mismo mes. Pide confirmación de reemplazo |

### 9.3 De operación

| Riesgo | Mitigación |
|---|---|
| Usuario olvida cargar un mes intermedio | UI debe mostrar cobertura: qué meses tiene, cuáles faltan |
| Usuario carga ROMA y Actas mezclados | Detector por hojas/columnas los separa correctamente (ya funciona) |
| Pérdida de DB local durante desarrollo | Cortes raw están en payload Json, recargables desde los archivos originales |

### 9.4 Que NO se cubren acá

- **Snapshots de KAR/SCHIAPP persistidos** — diferido
- **Cortes mensuales de Stock master** — el snapshot vivo basta por ahora
- **Versionado de Saldos/Provisiones histórico** — la pregunta operacional
  no lo requiere todavía. Si surge, se evalúa modelo equivalente.

---

## 10. Resumen ejecutivo de las decisiones

| Fuente | Paradigma | Llave | Frecuencia | Volumen anual estimado |
|---|---|---|---|---|
| **ROMA** | Histórico acumulativo por mes | VentaID + VIN | Mensual + recargas | ~12K registros, ~3 MB |
| **Actas vivo** | Snapshot reemplaza | VIN | Semanal | ~900 registros (actual) |
| **Actas histórico** | Acumulativo por corte fechado | VIN | Semanal | ~8K VINs consolidados, ~25 MB |
| **Stock master** | Snapshot reemplaza | VIN | Semanal | sin cambios |
| **Saldos / Provisiones** | Snapshot reemplaza | varias | Semanal | sin cambios |
| **KAR / SCHIAPP** | Snapshot en memoria | — | Diaria | no persiste todavía |

---

## 11. Hallazgos finales de la fase de investigación

Auditorías realizadas: inventario ROMA, duplicados entre meses, refinamiento
del cuello principal, análisis de "Sin información suficiente", redefinición
del cierre documental, muestra cualitativa del bucket "Comercial demoró
inicio", y auditoría de casos huérfanos. Todas sobre el CSV consolidado
`diag/output/historico-consolidado.csv`.

### 11.1 Tabla histórica consolidada construida

- 4.750 VentaIDs únicos (enero-mayo 2026)
- 88% cobertura completa (ROMA + Actas + ROMIA)
- 0 conflictos en campos INMUTABLES tras aplicar MergePolicy
- 64 casos mergeados (los 22 bordes documentados en sección 1 + variantes
  de VIN en operaciones reabiertas)
- Tiempos del ciclo consistentes con la realidad operacional:
  mediana 14 días totales, líneas Logística y Control en paralelo
  (mediana 6 días cada una, NO se suman)

### 11.2 Regla canónica para "documentación lista"

```
fDocListo = fPatenteRecibida ?? fInscripcion
```

- Cobertura: 97.8% (4.643 / 4.750)
- Anomalías (fDoc > fEntrega): 0.47%
- Rescate de "Sin información suficiente": 737 de 781 (94.4%)
- Se descarta `fPatenteAdmin` por introducir ruido (1.20% anomalías)
- Se descarta cascada de 4 candidatos por aportar solo 1 caso adicional
  con más complejidad

### 11.3 Hallazgo crítico sobre casos huérfanos

531 casos huérfanos (11.2% del histórico) emergen al refinar la
clasificación. La distribución temporal y el patrón de campos no
completados revelan que **NO son cuello operacional**:

- 72.3% son de diciembre 2025 (evento puntual, no problema crónico)
- 94.5% con antigüedad > 120 días (deuda histórica, no operación viva)
- 94% sin `Nombre_Vendedor` en Actas (fallas sistemáticas de captura)
- Distribución geográfica difusa (27 de 59 sucursales concentran el 80%)

**Interpretación:** durante diciembre 2025 hubo un quiebre de proceso
administrativo (fin de año, cambio de sistema, vacaciones, migración —
a confirmar con Operaciones) que dejó cientos de operaciones físicamente
entregadas sin cierre administrativo en ROMA y sin acta cargada en Actas.

### 11.4 Casos prioritarios marcados

**Tipo 2 — Entregados con cierre inconsistente: 25 casos · $520 MM**

Perfil 100% homogéneo:
- ROMA Estado = Pendiente pese a entrega cargada en Actas
- Falta `fInscripcion` en Actas

Son operaciones de monto alto (promedio $20 MM por caso) probablemente
vinculadas a flotas, convenios o ventas mayoristas con proceso administrativo
distinto. **Quedan marcadas como revisión prioritaria con Operaciones**
antes de cualquier limpieza automática.

---

## 12. Arquitectura conceptual final — tres ejes independientes

Decisión central del sistema: NO mezclar comportamiento operacional con
calidad de datos ni con deuda administrativa. Tres ejes ortogonales,
cada uno responde a una pregunta distinta.

### Eje 1 — Velocidad operacional

**Pregunta:** ¿Quién consumió los días?

Clasificaciones (sobre casos con ambas líneas completables):
- Logística llegó última
- Control de Negocio llegó último
- Cliente demoró retiro
- Comercial demoró inicio
- Empate real

Métricas asociadas:
- Tiempos por etapa del ciclo
- Distribución del delta físico−documental
- SLA por marca / sucursal / vendedor
- Promesa comercial vs ejecución real

### Eje 2 — Cumplimiento operacional

**Pregunta:** ¿El proceso fue ejecutado y registrado?

Hitos a evaluar:
- Patente recibida en sucursal
- Solicitud de entrega cargada
- Autorización de entrega cargada
- Recepción confirmada en sucursal
- Confirmación de despacho
- Acta de entrega cargada

Métricas asociadas:
- % de cumplimiento por hito y sucursal
- Tasa de captura de información comercial
- Disciplina operacional por responsable

Distinción crítica: **un dato faltante NO es lo mismo que un proceso
incumplido.** Algunos campos son opcionales (ej. `fecha_patente_recibida`)
y su ausencia no debe penalizarse.

### Eje 3 — Calidad de cierre operacional

**Pregunta:** ¿Quién dejó procesos abiertos o mal cerrados?

Categorías:
- Caso huérfano vivo (Tipo 1 o Tipo 2 con FechaSolicitud reciente)
- Deuda histórica de cierre (huérfanos antiguos, evento puntual)
- Casos prioritarios marcados (los 25 de $520 MM Tipo 2)

Métricas asociadas:
- Casos huérfanos por sucursal / marca / responsable
- Tasa de huerfandad por unidad organizativa
- Monto histórico en limbo administrativo

---

## 13. Política de casos huérfanos

### Definición operativa

**Caso huérfano:** proceso aparentemente terminado físicamente con
señales operacionales inconsistentes o cierre administrativo incompleto.

### Tipo 1 — Probable entrega no registrada

- entregado = false (acta no cargada en Actas)
- Ambas líneas LISTAS: tiene fSalidaFisica y tiene fInscripcion
- `sol_entrega` y `autorizacion_entrega` vacíos o "No"
- Antigüedad desde fSolicitud > 60 días

Interpretación: el auto probablemente fue entregado pero el local nunca
completó el registro administrativo final.

### Tipo 2 — Entregado con cierre inconsistente

- entregado = true (acta cargada)
- Al menos 2 de las siguientes inconsistencias:
  - ROMA Estado = Pendiente (debería estar Realizada)
  - `sol_entrega` o `autorizacion_entrega` vacíos
  - falta `fInscripcion`

Interpretación: la entrega física ocurrió pero el cierre en sistemas
fuente (ROMA o Actas) quedó incompleto.

### Distinción operacional crítica

**Deuda histórica vs huérfano vivo:**

```
Huérfanos con FechaSolicitud > 60 días al corte    → DEUDA HISTÓRICA
  → Reportar aparte, no afecta KPI de velocidad
  → Sujeto a limpieza administrativa puntual con Operaciones

Huérfanos con FechaSolicitud ≤ 60 días al corte    → HUÉRFANOS VIVOS
  → Indicador real de fugas operacionales actuales
  → Monitorear en el flujo continuo del Eje 3
```

Con los datos al 29-05-2026: ~500 huérfanos son deuda histórica de
Dic 2025 - Ene 2026, ~30 son huérfanos vivos. **Los KPI operativos
deben reportar solo los ~30 vivos.**

### Tratamiento de los 25 casos prioritarios

Los 25 casos Tipo 2 por $520 MM quedan en una lista de revisión manual.
**No deben procesarse automáticamente** (ni clasificarse como velocidad,
ni cerrarse administrativamente sin validación) hasta que Operaciones
los revise caso por caso.

---

## 14. Próximos pasos

### 14.1 Fase de investigación: CERRADA

Esta sección reemplaza la antigua "11. Próximos pasos sugeridos". Las
decisiones técnicas y conceptuales están tomadas. Lo que sigue es
implementación.

### 14.2 Rama de implementación: feature/historico-anual

Abrir desde `feature/fne-operativo-filtrado`. Este documento queda como
guía de diseño inviolable.

### 14.3 Alcance de la rama

**Sí se construye:**

- Schema Prisma para histórico ROMA (CorteROMAMensual + HistoricoVentaID)
- Schema Prisma para histórico Actas (CorteActasFecha + HistoricoActasVIN)
- MergePolicy declarativa por campo y tests unitarios
- Parser ROMA acumulativo con detección de mes por contenido
- Parser Actas con dual uso (vivo + acumulativo histórico)
- Detector de mes/corte en `/ingesta` con confirmación de reemplazo
- UI mínima de cobertura temporal (lista de cortes cargados)
- Tabla histórica consolidada definitiva (la versión productiva
  del CSV que vive en `diag/output/`)
- Clasificación de los tres ejes (Velocidad / Cumplimiento / Calidad
  de Cierre) como selectores puros sobre la tabla consolidada
- Validación de no-regresión contra el VIN `VR3KAHPY3VS000844`

**NO se construye en esta rama:**

- Dashboards
- Reportería visual
- Vistas ejecutivas por marca/sucursal/responsable
- Velocity Operating System como módulo
- Reportes de Control de Negocio / Inscripciones
- Cortes diarios datados de KAR/SCHIAPP

Esos quedan para fases posteriores apoyados sobre la tabla histórica
consolidada que esta rama produce.

### 14.4 Criterios de cierre de la rama

La rama está lista cuando:

1. Se puede cargar los 5 meses ROMA + Actas histórico + ROMIA por
   `/ingesta` sin perder información.
2. El histórico consolidado en DB iguala (±1 caso) el CSV de auditoría.
3. La clasificación de los tres ejes funciona sobre cualquier rango de
   fechas pedido.
4. Caso de prueba `VR3KAHPY3VS000844` muestra los mismos hitos que en
   `feature/fne-operativo-filtrado`.
5. Los selectores derivados pasan tests de cobertura mínima
   (que los KPI tengan al menos N casos para reportar).

---

**FIN DEL DOCUMENTO.** No es spec de implementación; es la decisión
arquitectónica que cualquier implementación posterior debe respetar.
