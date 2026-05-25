# Stock Command Center — Pompeyo Carrasco

Capa operacional inteligente sobre el reporte semanal de stock y líneas de crédito.
**No reemplaza** el Excel — lo lee y le agrega visualización, validación y alertas.

## Cómo correrla

```bash
cd ~/stock-command-center
# en cada terminal nueva primero:
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"

npm run dev    # → http://localhost:3030
```

Al abrir la app, arriba a la derecha hay "Cargar Excel". El archivo se procesa
**100 % en el navegador** — nada se sube a servidores.

## Arquitectura

- **Next.js 15** (App Router) + React 19 + TypeScript estricto
- **Tailwind CSS 4** (dark mode forzado, estilo Linear/Stripe)
- **xlsx** (SheetJS) para leer el .xlsx en cliente
- **Zustand** para el store del archivo cargado
- **Recharts** (instalado, aún no usado)
- **lucide-react** para iconos

Sin backend, sin base de datos, sin login.

## Estructura

```
src/
  lib/
    types.ts                 Vehiculo, LineaCredito, ParseReport, Alerta, EstadoComercial
    cn.ts                    helper className
    format.ts                fmtCLP, fmtCLPCompact, fmtNum, fmtPct, fmtDate
    store.ts                 Zustand: data | loading | error
    parser/
      index.ts               orquestador parseExcelFile()
      normalize.ts           catálogo de marcas, parseDate robusto, toNumber, toBoolSiNo
      base-stock.ts          parser maestro (95 cols → Vehiculo)
      lineas-credito.ts      parser de "3.-Lineas de Credito" + AUX Financiera
      resumen-oficial.ts     parser de "Resumen Stock Propio"
    selectors/
      kpis.ts                computeDashboardKPIs, compararResumen, generarAlertas, capitalPorMarca
  components/
    Sidebar.tsx              navegación lateral
    Header.tsx               topbar con info del archivo + reset
    UploadButton.tsx
    PlaceholderPage.tsx
    ui/                      Card, Stat, Badge, Button
  app/
    layout.tsx               shell global
    page.tsx                 ⚡ Validación (primer entregable del MVP)
    dashboard/               placeholder
    lineas/                  placeholder
    stock/                   placeholder
    capital/                 placeholder
    vencimientos/            placeholder
    test-cars/               placeholder
    alertas/                 placeholder
    cargar/                  upload simple
```

## Trazabilidad (hoja → métrica)

| Métrica de la app                 | Origen en el Excel                                                 |
| --------------------------------- | ------------------------------------------------------------------ |
| Lista de vehículos                | `Base_Stock` (2 930 filas × 95 cols)                              |
| Marca canónica                    | `Base_Stock.Marca Pompeyo` + catálogo en `normalize.ts`           |
| Días stock y aging                | `Base_Stock.Días Stock`, `Tramo DPS`                              |
| En línea / Financiado / Pagado    | `Linea SI - NO`, `Financiado`, `Pagado?`                          |
| Fecha vencimiento                 | prioridad `Fecha Vencimiento Fin` → `Fecha vencimiento`           |
| Stock A / B / Judicial            | `Stock A/B`                                                       |
| Tipo Stock                        | `Tipo Stock` (Floor Plan / Propio / Financiado / Fin Propio / VU) |
| Capital propio (caja atrapada)    | suma `Costo Neto` donde Tipo Stock ∈ {Propio, Fin Propio}         |
| Capital financiero                | suma `Costo Neto` donde Tipo Stock = Financiado                   |
| **PP Comprometido**               | Estado AutoPro = `Proceso Retoma` ∨ (Status Stock = `Aprobada` ∧ Folio Retoma) |
| Líneas de crédito                 | `3.-Lineas de Credito` cols G-L (MARCA, Autorizada, Ocupada, Libre, Plazo, Fecha) |
| Financiera / Días libres por marca| `AUX Financiera Linea Autorizada`                                 |
| Resumen ejecutivo de comparación  | `Resumen Stock Propio` (Stock A vitrinas / Por facturar / B / Judicial) |

## Decisiones operacionales

- **Capital atrapado**: 4 cards separadas — no se mezclan en una sola métrica.
  El usuario eligió la opción C como objetivo principal (replicar el Resumen Oficial).
- **PP Comprometido (capital puente)**: categoría estructural — vehículos que ya
  consumieron línea pero no se monetizan aún. Heurística inicial documentada en
  `base-stock.ts → deriveEstadoComercial`.
- **VIN duplicados**: no se eliminan; se marca y se cuenta VIN único para KPIs.
- **Test Cars**: detectados por `Estado Dealer = TEST CAR`. Se excluyen de capital
  operativo vendible pero se ven aparte.
- **Línea sobregirada**: categoría aparte del semáforo rojo (libre < 0 o % > 100).
- **Hojas históricas grandes** (Venta APC VN, brand sheets): ignoradas en MVP.

## Validar la carga del Excel

La página principal (`/`) es la **pantalla técnica de validación**. Antes de
habilitar dashboards ejecutivos, valida:
1. Hojas leídas (estado, filas procesadas/omitidas, columnas faltantes)
2. Diff app vs Resumen Stock Propio oficial
3. 4 visiones de capital
4. VIN duplicados, fechas inválidas, marcas sin mapeo, estados dealer detectados
5. Tabla de líneas de crédito con semáforo
6. Detalle de issues (origen hoja:fila:columna)

Una vez validado, las vistas del menú lateral mostrarán dashboards ejecutivos
(actualmente placeholders con la spec de lo que cada una contendrá).

## Próximos pasos (post-validación)

1. **Stock Explorer** — tabla filtrable con todos los vehículos.
2. **Dashboard Ejecutivo** — KPIs + ranking marcas + alertas.
3. **Líneas de Crédito** — vista detallada con gráficos.
4. **Capital de Trabajo** — ranking de problemas por marca.
5. **Vencimientos** — calendario.
6. **Test Cars** — usando hoja `TC CONTROL` (31 cols).
7. **Alertas** — centro con filtros por severidad.
