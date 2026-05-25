/**
 * STOCK COMMAND CENTER — Modelo de datos
 *
 * Convención: cada campo declara en comentario su HOJA y COLUMNA fuente
 * para mantener trazabilidad con el Excel original.
 */

export type StockAB = "A" | "B" | "Judicial";

export type TipoStock =
  | "FloorPlan"
  | "Propio"
  | "Financiado"
  | "FinPropio"
  | "VuPorRecibir"
  | "Desconocido";

export type UnidadNegocio = "Nuevos" | "Usados" | "AutosCompania" | "Desconocido";

export type PorLlegar = "Stock" | "PorLlegar" | "PreInscrito" | "Desconocido";

/**
 * Estado comercial derivado — separa stock disponible vs VPP comprometido
 * (capital puente). Ver heurística en lib/parser/base-stock.ts → deriveEstadoComercial.
 *
 * VPP = Vehículo en Parte de Pago.
 */
export type EstadoComercial =
  | "Disponible"
  | "VPPComprometido" // VPP en tránsito: ya consumió capital pero no monetizado
  | "VentaAprobada" // Status Stock = Aprobada (sale firmada, pendiente entrega)
  | "Vendido"
  | "Tescar"
  | "Judicial"
  | "StockB"
  | "Traspaso"
  | "PreInscrito"
  | "NoDisponible"
  | "Desconocido";

// ─────────────────────────────────────────────────────────────────────────────
// Taxonomía de capital operacional — versión sin cálculo final consolidado.
//
// La intención es separar conceptos operacionales que CONSUMEN capital de trabajo
// de forma estructuralmente distinta. Mutuamente excluyentes — un vehículo cae
// en exactamente uno de estos estados (prioridad declarada en deriveEstadoCapital).
//
// La consolidación financiera ("capital total por marca incluyendo todo") será
// un módulo futuro. Acá solo modelamos la clasificación y la atribución.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Taxonomía operacional de 9 estados — mutuamente excluyentes.
 *
 * Prioridad de asignación (mayor → menor):
 *   1. VPP_EXPLICITO        — vehículo recibido como parte de pago
 *   2. INMOVILIZADO          — judicial / B / test car activo / traspaso 3°
 *   3. USADO_PAGADO_INMOVIL  — usado pagado sin operación viva (mala rotación)
 *   4. FNE_EN_OPERACION      — vendido + facturado + no entregado
 *   5. PROCESO_VENTA         — cliente comprometido, negocio abierto (sin factura aún)
 *   6. PROCESO_CPD           — documentación / preparación / habilitación
 *   7. POR_LLEGAR            — sin stock físico todavía
 *   8. RETAIL_DISPONIBLE     — stock libre vendible
 *   9. DESCONOCIDO           — no clasificado, requiere revisión
 */
export type EstadoCapitalOperacional =
  | "VPP_EXPLICITO"
  | "INMOVILIZADO"
  | "USADO_PAGADO_INMOVIL"
  | "FNE_EN_OPERACION"
  | "PROCESO_VENTA"
  | "PROCESO_CPD"
  | "POR_LLEGAR"
  | "RETAIL_DISPONIBLE"
  | "DESCONOCIDO";

/**
 * Naturaleza del capital — agrupación superior con lenguaje concesionario.
 *
 * Keys internas (compatibles con URL params) y labels visibles:
 *   puente     → "Capital puente"          (VPP + Proceso CPD)
 *   operativo  → "Facturados no entregados" (FNE + Proceso Venta)
 *   atrapado   → "Capital pagado"          (Usado pagado + Inmovilizado no-judicial)
 *   judicial   → "Judiciales"              (Stock A/B = Judicial)
 *   transito   → "Vehículos por llegar"    (Por Llegar / Pre-Inscrito)
 *   retail     → "En línea"                (Stock en línea, disponible operacionalmente)
 *   indefinido → "Pendiente clasificación" (sin señales claras)
 */
export type NaturalezaCapital =
  | "puente"
  | "operativo"
  | "atrapado"
  | "judicial"
  | "transito"
  | "retail"
  | "indefinido";

/**
 * De qué fuente se resolvió la "marca originadora" para atribución de capital.
 *
 * Caso operacional clave: un VU usado MAZDA dejado en KIA REDCUBE consume capital
 * de KIA (la marca originadora del VN que generó la operación), NO de MAZDA.
 */
export type FuenteMarcaOriginadora =
  /** Marca del propio vehículo (FNE, retail libre). Confianza alta. */
  | "marca_vehiculo"
  /** Sucursal marca-específica (KIA REDCUBE → KIA). Confianza media-alta. */
  | "sucursal_marca_especifica"
  /** Fase 2: cruce por Folio Venta con hoja "Venta APC Fact VN". Confianza alta. */
  | "venta_apc_link"
  /** No inferible (sucursal logística/seminuevos/test cars). */
  | "no_inferible";

export type ConfianzaMarca = "alta" | "media" | "baja" | "ninguna";

// ─────────────────────────────────────────────────────────────────────────────
// Destino operacional — dimensión ORTOGONAL al estado de capital.
//
// La taxonomía de capital responde "¿qué consume mi capital?".
// El destino operacional responde "¿para qué se usa el vehículo?".
//
// Un vehículo puede tener `Estado Dealer = TEST CAR` pero estar en RENTING — son
// señales operacionales distintas. Antes mezclábamos esto bajo TESCAR, inflando
// el conteo. Ahora se separa:
//   - esTescar / esTescarOperacional → naturaleza del activo (etiquetas Excel)
//   - destinoOperacional             → uso comercial real
//
// Fuente principal: AUX TM (flag SAP/Toro Mundial) — mutuamente excluyente:
//   "TEST CARS" | "RENTING" | "COMPANY CAR" | "VDR" | "Sin Match"
// Fallbacks: Condicion Vehiculo, Unidad Negocio, Estado Dealer.
//
// `null` = retail / sin destino operacional especial (la gran mayoría).
// ─────────────────────────────────────────────────────────────────────────────

export type DestinoOperacional =
  | "demo"           // vehículo en uso comercial demo
  | "renting"        // arrendado a un cliente
  | "company"        // auto de compañía (uso interno corporativo)
  | "vdr"            // vehículo de representación / sigla operativa Pompeyo
  | "interno"        // activo fijo / uso interno sin clasificación específica
  | "vn_con_patente" // VN ya patentado, traspasado a TM para venta (stock vendible de la marca)
  | "marketing"      // (placeholder para fase 2 si aparece la señal)
  | "flota"          // (placeholder para fase 2 — venta a flota)
  | "desconocido";   // tiene señal de uso especial pero no clasificable

/**
 * Señales que componen el "parque TESCAR operacional ampliado".
 * El estado estricto sigue siendo `esTescar` (Estado Dealer = TEST CAR).
 */
export interface TescarSignals {
  /** Estado Dealer = "TEST CAR" en Base_Stock. */
  estadoDealer: boolean;
  /** Condicion Vehiculo = "TEST CAR EN USO" — visión operativa diaria. */
  condicionEnUso: boolean;
  /** AUX TM = "TEST CARS" — flag de control SAP/Toro Mundial. */
  auxTM: boolean;
  /** VIN presente en hoja "TC CONTROL". */
  tcControl: boolean;
}

export interface Vehiculo {
  // Identidad — Base_Stock col 14
  vin: string;

  // Marca — múltiples representaciones para trazabilidad
  marca: string; // Base_Stock col 15 (original Autopro)
  marcaPompeyo: string; // Base_Stock col 51 (canónica para dashboards)
  marcaLinea: string | null; // mapeada a 3.-Lineas de Credito (cuando exista)

  modelo: string | null; // col 16
  version: string | null; // col 17
  anio: number | null; // col 19
  color: string | null; // col 24

  // Operacional
  sucursal: string | null; // col 5
  estadoDealer: string | null; // col 29 — string crudo
  estadoVenta: string | null; // col 8
  estadoAutoPro: string | null; // col 27
  statusStock: string | null; // col 63

  // Aging
  diasStock: number | null; // col 28
  tramoDPS: string | null; // col 58 — "[0 - 30)" etc

  // Categorización
  stockAB: StockAB; // col 65
  tipoStock: TipoStock; // col 62
  porLlegar: PorLlegar; // col 64
  unidadNegocio: UnidadNegocio; // col 52
  condicionVehiculo: string | null; // col 23 — string crudo
  estadoComercial: EstadoComercial; // derivado

  // Financiero
  enLinea: boolean; // col 68 "Linea SI - NO"
  financiado: boolean; // col 84
  fechaVencimiento: Date | null; // mejor entre col 85 / col 91
  fechaVencimientoSource: "fin" | "principal" | "ninguna";
  pagado: boolean; // col 95 "Pagado?"
  pagadoFinanciera: Date | null; // col 94

  // Capital
  costoNeto: number; // col 60
  precioLista: number | null; // col 48
  precioVentaTotal: number | null; // col 26

  // Retoma (parte de pago)
  folioRetoma: string | null; // col 41
  fechaRetoma: Date | null; // col 42
  folioVenta: string | null; // col 6
  fechaVenta: Date | null; // col 9 — única fecha de venta disponible en este Excel
  vendedor: string | null; // col 11

  // Banderas derivadas
  /** TESCAR estricto — Estado Dealer = "TEST CAR". Definición oficial. */
  esTescar: boolean;
  /** Señales adicionales del parque demo operacional ampliado. */
  tescarSignals: TescarSignals;
  /** Unión: ¿está en el parque demo operacional (cualquier señal)? */
  esTescarOperacional: boolean;
  esJudicial: boolean;
  esStockB: boolean;
  esPagado: boolean;
  esDuplicado: boolean;
  esVPPComprometido: boolean;

  // Bodega (físico) — distinta de sucursal (comercial). Ver Base_Stock col 30.
  bodega: string | null;

  /** Estado del flujo del vehículo operativo — crudo de Base_Stock col "Marca Pompeyo C." (col 83).
   *
   *  Valores observados:
   *    - Marcas reales (KIA MOTORS, MG, ...) — duplica Marca Pompeyo
   *    - "Vitrina"          — auto en exhibición lista para venta
   *    - "Proceso CPD"       — en Centro de Preparación de Documentos
   *    - "Retoma Nuevos"     — VPP recibido como parte de pago
   *    - "Proceso de Venta"  — cliente comprometido, negocio abierto
   *
   *  Lo exponemos como dimensión filtrable porque captura la realidad operacional
   *  del vehículo más allá del Estado Dealer. */
  estadoFlujoVO: string | null;

  /** "Tipo de Stock" — col 82 — clasificación oficial nivel 1.
   *  Valores: "Venta Nuevos" | "Venta Usados" | "Autos Compañía" */
  tipoDeStock: string | null;

  /** "Condicion de Stock" — col 81 — clasificación oficial nivel 2 (fuente del pivot).
   *  Valores: "Existencia Nuevos" | "VN CON PATENTE" | "TEST CARS" | "Existencia Usados"
   *         | "VU por Recibir" | "RENTING" | "COMPANY CAR" | "Activo Fijo" | "Sin Match" */
  condicionDeStock: string | null;

  /** "Tipo Stock Usados" — subcategoría operacional de usados:
   *  "Disponibles" (retail) | "CPD" | "Vpp Por Llegar" (puente) | "Otros".
   *  Fallback de la categoría CPD en la taxonomía de usados. OPCIONAL/aditivo. */
  tipoStockUsados: string | null;

  /** "AUX TM" — col 27 — flag SAP/Toro Mundial. Señal secundaria de destino.
   *  Mantener crudo para detectar discordancias con condicionDeStock. */
  auxTM: string | null;

  // ── Taxonomía de capital operacional ──
  /** Clasificación mutuamente excluyente. Ver lógica en base-stock.ts → deriveEstadoCapital. */
  estadoCapital: EstadoCapitalOperacional;
  /** Agrupación superior — puente / operativo / atrapado / tránsito / retail / indefinido. */
  naturalezaCapital: NaturalezaCapital;
  /** Destino operacional (uso real). Dimensión ORTOGONAL a estadoCapital y esTescar.
   *  null = sin destino operacional especial (retail). */
  destinoOperacional: DestinoOperacional | null;
  /** Marca a la que se atribuye el capital consumido. NO necesariamente = marca del vehículo. */
  marcaOriginadora: string | null;
  /** Cómo se resolvió la marca originadora (para auditoría). */
  marcaOriginadoraFuente: FuenteMarcaOriginadora;
  /** Confianza de la atribución. */
  confianzaMarcaOriginadora: ConfianzaMarca;

  // ───────────────────────────────────────────────────────────────
  // Campos preparados para Fase 2 (inscripción / patente / entrega final).
  // Estructura presente para no romper compatibilidad cuando se conecten
  // las hojas "Maestro EURO VI", "Venta APC Fact VN" y otros documentos.
  // En MVP solo `patente` se llena (desde "Placa Patente" en Base_Stock).
  // ───────────────────────────────────────────────────────────────
  patente: string | null; // ya viene en Base_Stock como "Placa Patente"
  inscrito: boolean | null; // null = desconocido (Fase 2: cruzar con Maestro EURO VI)
  fechaInscripcion: Date | null; // Fase 2
  estadoInscripcion: string | null; // Fase 2 (texto libre)
  fechaEntregaFinal: Date | null; // Fase 2 (no existe columna hoy)

  // Auditoría
  duplicadoFlag: number; // col 93 — 0/1/2 según hoja
  rowIndex: number; // fila en la hoja Base_Stock (1-based, header en r1)
}

export type Semaforo = "verde" | "amarillo" | "rojo" | "sobregirada";

export interface LineaCredito {
  marca: string; // tal como aparece en 3.-Lineas de Credito
  marcaPompeyo: string | null; // mapeada — null si no se pudo mapear
  financiera: string | null; // de AUX Financiera Linea Autorizada
  diasLibres: number | null; // de AUX
  plazoPagoFP: number | null; // 3.-Lineas col 11
  lineaAutorizada: number;
  lineaOcupada: number;
  lineaLibre: number; // tal como viene (puede ser negativa)
  porcentajeOcupacion: number; // ocupada / autorizada
  semaforo: Semaforo;
  fechaCalculo: Date | null;
  rowIndex: number;
}

/**
 * Resumen oficial — modelado fiel a la hoja "Resumen Stock Propio".
 *
 * Layout real: B2:E7, sin merges. 3 columnas analíticas + 1 columna de etiqueta.
 *   Col B: etiqueta
 *   Col C: Inventario   (TODO el stock, incluye test cars en activo fijo)
 *   Col D: Activo Fijo  (subset: test cars que son activo fijo)
 *   Col E: Total        = Inventario − Activo Fijo (stock vendible)
 *
 * Bloques esperados:
 *   r3: Stock A en vitrinas / Test Cars Propios
 *   r4: Stock A por facturar
 *   r5: Stock B
 *   r6: Stock Judicial
 *   r7: (sin label) — fila de totales
 */

export type ResumenBlockKey =
  | "stockAVitrinas"
  | "stockAPorFacturar"
  | "stockB"
  | "stockJudicial"
  | "total";

export interface ResumenBlock {
  key: ResumenBlockKey;
  label: string; // etiqueta literal del Excel
  labelCell: string; // ej "B3"
  inventario: number; // col Inventario
  activoFijo: number; // col Activo Fijo (0 si vacío)
  total: number; // col Total
  cells: {
    inventario: string; // ej "C3"
    activoFijo: string;
    total: string;
  };
}

export interface ResumenCellDump {
  addr: string; // ej "C3"
  row: number; // 1-based
  col: number; // 1-based
  colLetter: string; // ej "C"
  type: string; // s / n / d / b / e / z / ?
  value: unknown; // .v
  formatted: string | null; // .w
}

export interface ResumenOficial {
  // estructura nueva
  bloques: ResumenBlock[];
  totalRow: ResumenBlock | null;

  // metadata de la hoja
  sheetRef: string; // ej "B2:E7"
  rowStart: number; // 1-based
  rowEnd: number;
  colStart: number; // 1-based
  colEnd: number;
  merges: { s: string; e: string }[]; // [{s:"B2", e:"D2"}, ...]
  headerRow: number | null; // fila donde están "Inventario / Activo Fijo / Total"
  headerCells: string[]; // headers literales detectados
  cellDump: ResumenCellDump[]; // dump completo para debug
  fechaCalculo: Date | null;

  // accesos rápidos retro-compatibles (calculados de bloques)
  stockAVitrinasInventario: number;
  stockAVitrinasActivoFijo: number;
  stockAVitrinasTotal: number;
  stockAPorFacturar: number;
  stockB: number;
  stockJudicial: number;
  granTotalInventario: number;
  granTotalActivoFijo: number;
  granTotalVendible: number;
}

export type AlertaSeveridad = "critica" | "alta" | "media" | "info";

export type AlertaTipo =
  | "linea_sobregirada"
  | "linea_sobre_90"
  | "linea_entre_80_90"
  | "vehiculo_mas_180"
  | "vehiculo_mas_60"
  | "pagado_sin_rotacion"
  | "test_car_excedido"
  | "stock_judicial"
  | "stock_b"
  | "venc_proximo_30d"
  | "venc_vencido"
  | "vpp_comprometido"
  | "vin_duplicado"
  | "concentracion_capital"
  | "marca_sin_mapeo"
  | "fecha_invalida"
  | "fne_mas_7d"
  | "fne_mas_15d"
  | "fne_con_vpp"
  | "fne_fuera_sucursal"
  | "fne_sin_bodega"
  | "fne_sin_fecha";

export interface Alerta {
  id: string;
  severidad: AlertaSeveridad;
  tipo: AlertaTipo;
  titulo: string;
  detalle: string;
  vin?: string;
  marca?: string;
  valorImpacto?: number;
  origen: string; // "hoja:columna" para trazabilidad
}

export interface ParseIssue {
  hoja: string;
  fila: number;
  columna?: string;
  tipo: "fecha_invalida" | "marca_sin_mapeo" | "vin_vacio" | "valor_no_numerico" | "vin_duplicado";
  mensaje: string;
  raw?: unknown;
}

export interface SheetReport {
  nombre: string;
  filasTotales: number;
  filasProcesadas: number;
  filasOmitidas: number;
  columnasDetectadas: string[];
  columnasEsperadas: string[];
  columnasFaltantes: string[];
  estado: "ok" | "parcial" | "error" | "no_encontrada";
  mensaje?: string;
}

export interface ParseReport {
  archivoNombre: string;
  archivoSize: number;
  fechaCarga: Date;
  fechaCorteExcel: Date | null;
  hojas: SheetReport[];
  totalVehiculos: number;
  totalVinsUnicos: number;
  vinsDuplicados: string[];
  fechasInvalidas: number;
  marcasSinMapeo: string[];
  estadosDealerDetectados: string[];
  issues: ParseIssue[];
  durMs: number;
}

/** Registro suplementario por VIN, viene de hojas históricas / financiamiento.
 *  Se importa desde "@/lib/parser/venta-apc". Definido como any-shaped acá
 *  para evitar circular import. */
export interface VINSupplementary {
  vinLimpio: string;
  fuente: string;
  marca: string | null;
  modelo: string | null;
  patente: string | null;
  sucursal: string | null;
  cliente: string | null;
  vendedor: string | null;
  folioVenta: string | number | null;
  fechaVenta: Date | null;
  fechaFacturacion: Date | null;
  tipoFinanciamiento: string | null;
  fechaVencimientoFin: Date | null;
  statusFinanciamiento: string | null;
  financiera: string | null;
  actualmenteEnStock: string | null;
  enLinea: string | null;
}

/** TESCAR oficial — fila de la hoja "Control TestCars" (TEST CARS + BDR). */
export type TipoTescar = "test_car" | "bdr";

export interface TescarControlRow {
  rowIndex: number;
  /** Marca originadora (col A) — la marca que compró/originó el demo. NO USADOS. */
  marca: string | null;
  modelo: string | null;
  color: string | null;
  vin: string;
  vinLimpio: string;
  patente: string | null;
  propietario: string | null;
  rutPropietario: string | null;
  /** Capital comprometido del demo (Valor compra). */
  valorCompra: number;
  vigencia: string | null;
  decisionVenta: string | null;
  /** Texto literal de "Tipo Vehículo" (TEST CARS / BDR). */
  tipoVehiculo: string;
  tipo: TipoTescar;
  status: string | null;
  sucursal: string | null;
  sucursalInicio: string | null;
  responsable: string | null;
  fechaPrestamo: Date | null;
  fechaDevolucion: Date | null;
  /** Días desde el préstamo (aging operacional). null si sin fecha. */
  diasPrestamo: number | null;
  cliente: string | null;
}

export interface ParsedExcel {
  vehiculos: Vehiculo[];
  lineas: LineaCredito[];
  resumenOficial: ResumenOficial | null;
  /** TESCAR oficial desde "Control TestCars" (TEST CARS + BDR). Capa operacional/
   *  visual; NO alimenta el score (el flag esTescar de Base_Stock se mantiene). */
  tescarControl: TescarControlRow[];
  /** Registry suplementario VIN_LIMPIO → metadata desde hojas Venta APC +
   *  Financiado + Base Financiamiento. Cubre VINs históricos que no están
   *  en Base_Stock (~24K VINs adicionales). */
  vinsExtra: Map<string, VINSupplementary>;
  report: ParseReport;
}

// ────────────────────────────────────────────────────────────────────
// Módulo: Facturados No Entregados (FNE)
//
// Estado operacional propio — vehículos cuya venta está firmada/aprobada
// pero todavía permanecen en stock (no entregados al cliente).
//
// Identificación en Base_Stock:
//   Estado AutoPro = "Vendido" Y Status Stock ∈ {"Vigente", "Aprobada"}
//
// Aging: el Excel actual tiene "Fecha Facturación" 100% vacía. Usamos
// "Fecha Venta" como proxy y lo documentamos claramente en la UI.
// ────────────────────────────────────────────────────────────────────

export type AgingFNE = "0-3" | "4-7" | "8-15" | "16+" | "sin_fecha";

export type EnSucursalVenta = "si" | "no" | "por_validar";

export interface FacturadoNoEntregado {
  // Identidad
  vin: string;
  marca: string;
  marcaPompeyo: string;
  modelo: string | null;
  version: string | null;
  color: string | null;
  anio: number | null;

  // Ubicación física
  sucursal: string | null; // Base_Stock col Sucursal
  bodega: string | null; // Base_Stock col Bodega
  enSucursalVenta: EnSucursalVenta;

  // Venta
  folioVenta: string | null;
  vendedor: string | null;
  cliente: string | null; // null hoy (no existe columna en Base_Stock — Fase 2)
  fechaVenta: Date | null;
  fechaFacturacion: Date | null; // null hoy (columna vacía en Excel actual)

  // Aging
  diasDesdeVenta: number | null;
  diasDesdeFacturacion: number | null;
  agingBucket: AgingFNE;
  agingFuente: "venta" | "facturacion" | "ninguna"; // de qué fecha salió

  // VPP
  conVPP: boolean;
  folioRetomaAsociado: string | null;

  // Capital
  costoNeto: number;
  precioVentaTotal: number | null;
  /** Dimensión financiera: dónde está parado el capital de este FNE. */
  tipoStock: TipoStock;

  // Estado textual
  estadoOperacional: string;

  // Fase 2 (placeholder)
  patente: string | null;
  inscrito: boolean | null;
  fechaInscripcion: Date | null;
  estadoInscripcion: string | null;
  fechaEntregaFinal: Date | null;

  // Auditoría
  rowIndex: number;
}

export interface FNEStats {
  total: number;
  totalUnidades: number;
  valorTotal: number;
  conVPP: number;
  valorConVPP: number;
  pctConVPP: number;
  mas7d: number;
  mas15d: number;
  fueraDeSucursal: number;
  porValidar: number;
  sinBodega: number;
  sinFechaAging: number;
  porAging: Record<AgingFNE, number>;
  /** Desglose por origen de capital — qué fondos consume cada FNE. */
  porTipoStock: {
    floorPlan: { unidades: number; capital: number };
    propio: { unidades: number; capital: number };
    financiado: { unidades: number; capital: number };
    finPropio: { unidades: number; capital: number };
    vuPorRecibir: { unidades: number; capital: number };
    desconocido: { unidades: number; capital: number };
  };
  /** Columnas que necesitaríamos para tener cobertura 100% del módulo. */
  camposFaltantes: {
    nombre: string;
    descripcion: string;
    impacto: "alto" | "medio" | "bajo";
  }[];
}

// ────────────────────────────────────────────────────────────────────
// Módulo: FNE Real — fuente oficial "Autos no entregados.xlsx"
//
// Universo independiente, NO se infiere desde Base_Stock. Cruce por VIN
// con stock entrega tipoStock / costoNeto / bodega / marcaPompeyo cuando
// existe match. Si no hay match: el registro queda como "sin cruce".
//
// Importante: PatenteVpp existe en este archivo pero NO se usa como
// fuente de VPP — el VPP/capital puente sigue viviendo en Base_Stock
// vía Vehiculo.esVPPComprometido. Este archivo solo es para FNE.
// ────────────────────────────────────────────────────────────────────

export type EtapaFNE = 1 | 2 | 3 | 4 | 6 | 7 | 8 | 12 | 14 | 0;
export type AgingFNEReal =
  | "0-3"
  | "4-7"
  | "8-15"
  | "16-30"
  | "31-60"
  | "61+"
  | "sin_fecha";

/** Estado de entrega operacional — derivado de las señales del archivo.
 *  Buckets mutuamente excluyentes, suman 100% del universo FNE.
 *
 *  Pipeline de patente (RC = Registro Civil, CdN = Control de Negocios):
 *    sucursal pide → CdN procesa → envía a RC → RC inscribe → vuelve a admin →
 *    admin envía a sucursal → sucursal recibe → sol_entrega + autorización → entrega
 *
 *  El orden enum va de "más listo" a "más lejos de entregar". */
export type EstadoEntrega =
  | "listo_para_entregar" // pat. en sucursal + sol_entrega=Si + autorización=Si
  | "falta_solo_autorizacion" // pat. en sucursal + sol_entrega=Si + autorización=No
  | "patente_en_sucursal" // pat. en sucursal, falta solicitud de entrega
  | "patente_en_transito" // pat. enviada admin → sucursal, sin recibir
  | "patente_en_admin" // pat. en admin Pompeyo (volvió de RC, sin enviar)
  | "inscrita_sin_admin" // inscripción completa en RC, sin llegar a admin
  | "en_registro_civil" // CdN mandó a RC, sin inscripción aún
  | "en_control_negocios" // sucursal pidió, CdN no mandó a RC
  | "sin_solicitud_inscripcion"; // sucursal no pidió inscripción

export interface AutoNoEntregado {
  /** ID interno del archivo (folio único de la operación). */
  id: number | null;
  sucursal: string | null;
  cliente: string | null;
  rut: number | string | null;
  vendedor: string | null;
  cajon: string | null;
  vin: string;

  valorFactura: number;
  fechaVenta: Date | null;
  fechaFactura: Date | null;
  fechaFacturaDiff: number | null;

  autorizacionEntrega: boolean | null;
  solEntrega: boolean | null;
  entregaAuto: string | null;

  solicitarInscripcion: boolean | null;
  fechaSolicitudInscripcion: Date | null;
  fechaInscripcion: Date | null;

  /** Recorrido patente — administración → envío → recepción sucursal → entrega cliente */
  patentesAdministracion: Date | null;
  fechaPatenteEnviada: Date | null;
  fechaPatenteRecibida: Date | null;
  fechaPatenteEntregada: Date | null;

  /** Patente del VPP (si la operación recibió VU en parte de pago).
   *  Se conserva por trazabilidad pero NO se usa como fuente de VPP.
   *  El VPP/capital puente vive en Base_Stock vía esVPPComprometido. */
  patenteVpp: string | null;

  etapa: EtapaFNE;
  entregaAutoTxt: string | null;

  rowIndex: number;

  /**
   * ¿La operación FNE pertenece a la unidad USADOS? Enriquecido al cruzar contra
   * Base_Stock (store.enriquecerFNEUsados): true si la sucursal es de usados O el
   * VIN cruza con un vehículo usado de la taxonomía operacional. undefined hasta
   * que el cruce corre (ambos archivos cargados). Lo consume getMarcaOperacional.
   */
  esUsado?: boolean;
}

/** FNE real enriquecido con cruce contra Base_Stock por VIN. */
export interface FNERealCruzado {
  fne: AutoNoEntregado;
  /** Vehículo de Base_Stock con mismo VIN (stock activo). null si no hay match. */
  vehiculo: Vehiculo | null;
  /** Si no cruza con Base_Stock, intentamos contra registry suplementario
   *  (Venta APC + Financiado). Provee marca/modelo/cliente del histórico. */
  vehiculoExtra: VINSupplementary | null;
  /** Estado operacional derivado de las señales del archivo + cruce. */
  estadoEntrega: EstadoEntrega;
  /** Días desde la facturación real (no proxy). */
  diasDesdeFactura: number | null;
  agingBucket: AgingFNEReal;
  /** Días en el estado actual del pipeline — desde la fecha de referencia
   *  del estado. null si no hay fecha anclable. */
  diasEnEstado: number | null;
  /** ¿El auto está físicamente en la sucursal de venta? */
  autoEnSucursal: EnSucursalVenta;
  /** ¿La patente fue recibida en sucursal? */
  patenteEnSucursal: boolean;
  /** ¿Listo para entregar? = auto en sucursal + patente en sucursal */
  listoParaEntregar: boolean;
}

/** Antigüedad en el estado actual — días desde la fecha de referencia
 *  del estado (cuándo entró a ese bucket del pipeline). */
export interface AntigüedadEstado {
  /** Total de operaciones con fecha de referencia válida. */
  conFecha: number;
  /** Antigüedad máxima (caso más viejo). */
  maxDias: number;
  /** Cuántos llevan más de N días. */
  mayor3d: number;
  mayor7d: number;
  mayor15d: number;
  mayor30d: number;
}

export interface FNERealStats {
  total: number;
  valorTotal: number;
  /** Universo "hot" — operaciones que ya pueden entregarse hoy. */
  listoParaEntregar: number;
  valorListoParaEntregar: number;
  /** Distribución completa por estado — suma = total. */
  porEstado: Record<EstadoEntrega, number>;
  valorPorEstado: Record<EstadoEntrega, number>;
  /** Antigüedad en el estado actual por bucket. */
  antiguedadPorEstado: Record<EstadoEntrega, AntigüedadEstado>;
  /** Aging real por FechaFactura — suma = total. */
  porAging: Record<AgingFNEReal, number>;
  porEtapa: Record<EtapaFNE, number>;
  /** Cruce contra Base_Stock (stock activo) — solo VINs en stock. */
  cruzadosConStock: number;
  /** Cruce contra registry suplementario (Venta APC + Financiado) —
   *  VINs ya facturados / entregados que no están en stock activo. */
  cruzadosConHistorico: number;
  /** Sin cruce en ninguna fuente. */
  sinCruceStock: number;
  /** Sucursales (top by count). */
  porSucursal: { sucursal: string; unidades: number; valor: number }[];
}

export interface FNERealParseReport {
  archivoNombre: string;
  archivoSize: number;
  fechaCarga: Date;
  filasTotales: number;
  filasProcesadas: number;
  filasOmitidas: number;
  vinsDuplicados: string[];
  durMs: number;
}

export interface ParsedFNE {
  registros: AutoNoEntregado[];
  report: FNERealParseReport;
}

// ────────────────────────────────────────────────────────────────────
// Módulo: Saldos (Reportes Saldos 2.0)
//
// Tres categorías mutuamente excluyentes según el archivo:
//   1) Vehículos        → cruzan por Cajón ↔ VIN, sí están en stock/FNE.
//                         Pesos: financieras, leasing, seguros, flotas,
//                         traspasos, crédito Pompeyo, judicial, buyback,
//                         acuerdo comercial, OC marca.
//   2) Bono/Comisión    → facturas administrativas (incentivos / comisiones).
//                         No tienen VIN ni Cajón pero SÍ consumen capital
//                         de trabajo (plata no cobrada).
//   3) Servicios        → post-venta (servicio técnico). EXCLUIDOS del
//                         módulo de capital de trabajo de ventas.
// ────────────────────────────────────────────────────────────────────

export type CategoriaSaldo = "vehiculo" | "bono_comision" | "servicio" | "desconocido";

export type SubTipoSaldoVehiculo =
  | "financieras"
  | "leasing"
  | "seguros"
  | "flotas"
  | "traspasos_dealer"
  | "credito_pompeyo"
  | "judicial"
  | "buy_back"
  | "acuerdo_comercial"
  | "oc_marca"
  | "indefinido";

export type SubTipoSaldoBono = "comisiones" | "incentivos" | "bonos" | "indefinido";

/** Empresa contable de Pompeyo — separación legal/contable. */
export type EmpresaPompeyo = "PC Automoviles" | "PC Spa" | "Desconocido";

/** Status DPS según la columna "Status" del archivo. */
export type StatusDPS =
  | "Por Vencer"      // 0-6 días
  | "T1"              // 7-13
  | "T2"              // 14-29
  | "T3"              // 30-60
  | "T4"              // 61-90
  | "T5"              // 91-120
  | "T6"              // 121-364
  | "T7"              // >364
  | "Desconocido";

export interface SaldoRegistro {
  rowIndex: number;
  // Categorización
  categoria: CategoriaSaldo;
  subTipo: string; // string libre (subTipoVehiculo o subTipoBono o nombre del servicio)
  empresa: EmpresaPompeyo;
  /** Texto literal de la columna "Tipo" (ej. "1.1 financieras") para auditoría. */
  tipoRaw: string | null;
  /** Texto literal de "CATEGORIA" (ej. "1 SALDOS DE VEHICULOS"). */
  categoriaRaw: string | null;
  // Identificación del auto (solo si categoria === "vehiculo")
  cajon: string | null;
  cajonLimpio: string | null;
  /** VIN resuelto desde bridge Cajón→VIN. null si no cruzó. */
  vinResuelto: string | null;
  patente: string | null; // del archivo de saldos si vino
  // Comercial
  marca: string | null;
  modelo: string | null;
  cliente: string | null;
  rutCliente: string | null;
  numNota: string | number | null;
  numeroFactura: string | number | null;
  sucursal: string | null;
  vendedor: string | null;
  // Financieros
  saldoXDocumentar: number;
  financieraCLP: number; // " Financiera"
  cPompeyoCLP: number;   // CP que alimenta score (subTipo 1.6 → Saldo x Documentar)
  /** Columna " C.Pompeyo " real (composición del saldo). Solo display, NO score. */
  cPompeyoColCLP: number;
  entidadFinanciera: string | null;
  origen: string | null;
  // Fechas
  fechaVenta: Date | null;
  fechaVencimiento: Date | null;
  fchPago: Date | null;
  // Estado
  diasArchivo: number | null;
  statusDPS: StatusDPS;
  statusRaw: string | null;
  estadoPago: string | null;       // E°_Pago
  estadoEntrega: string | null;    // E°entrega
  entregado: string | null;
  inscrito: string | null;
  clasificacionSalvin: string | null;
  comentariosFinanzas: string | null;
  numOperacion: string | null;
}

export interface ParsedSaldosReport {
  archivoNombre: string;
  archivoSize: number;
  fechaCarga: Date;
  filasTotales: number;
  filasProcesadas: number;
  filasOmitidas: number;
  cajonesSinFormato: number;
  durMs: number;
}

export interface ParsedSaldos {
  registros: SaldoRegistro[];
  report: ParsedSaldosReport;
}

/** Saldo enriquecido con cruce contra stock y FNE. */
export interface SaldoCruzado {
  saldo: SaldoRegistro;
  vehiculo: Vehiculo | null;
  vehiculoExtra: VINSupplementary | null;
  fne: AutoNoEntregado | null;
  /** "exacto" cuando el Cajón cruzó directo; "patente" cuando el campo
   *  Cajón en realidad era la patente; "no_aplica" para bonos/servicios. */
  tipoMatch: "exacto" | "patente" | "no_aplica" | "no_match";
}

// ────────────────────────────────────────────────────────────────────
// Módulo: Provisiones (Provisiones al 18 de Mayo.xlsx)
//
// Regla de alcance:
//   - Solo provisiones NO facturadas viven en este módulo como universo
//     activo. Consumen capital de trabajo y entran a KPIs + gestión.
//   - Las facturadas (montoFactura > 0) salen del módulo. Si tienen saldo
//     pendiente conceptualmente migran a Saldos/Salvin. Se muestran solo
//     como referencia en una tab secundaria, NO se gestionan acá.
// ────────────────────────────────────────────────────────────────────

export type EstadoProvision =
  | "no_facturada"      // montoFactura = 0 → universo activo
  | "facturada"         // montoFactura > 0 → fuera del módulo, ref. en tab secundaria
  | "revision_manual";  // EstadoAjuste crítico o ambigüedad

export type AreaProvision = "ventas" | "postventa";

export type AgingProvision = "0-30" | "31-60" | "61-90" | "91-180" | "180+" | "sin_fecha";

export interface ProvisionRegistro {
  rowIndex: number;
  id: number | null;
  fechaCreacion: Date | null;
  solicitante: string | null;
  razonSocial: string | null;
  periodo: string | null;          // "MM-YYYY"
  concepto: string | null;         // "Incentivo Ventas", "Bono Marca", etc.
  origen: string | null;           // marca (Kia, Nissan, Peugeot…)
  tipo: string | null;
  motivo: string | null;
  estadoArchivo: string | null;    // Estado original ("Confirmado" / "Facturado")
  montoProvision: number;
  montoFactura: number;
  saldo: number;
  ultimaFechaFactura: Date | null;
  estadoConta: number | null;
  estadoAjuste: string | null;
  notificarConta: number | null;

  // Derivados
  estado: EstadoProvision;
  area: AreaProvision;
  agingDias: number | null;
  agingBucket: AgingProvision;
  /** Llave única para gestión (no hay VIN). Formato: PROV-{ID}. */
  claveGestion: string;
}

export interface ProvisionesParseReport {
  archivoNombre: string;
  archivoSize: number;
  fechaCarga: Date;
  filasTotales: number;
  filasProcesadas: number;
  filasOmitidas: number;
  durMs: number;
}

export interface ParsedProvisiones {
  registros: ProvisionRegistro[];
  report: ProvisionesParseReport;
}

export interface ProvisionesStats {
  /** Solo cuenta NO facturadas — universo activo. */
  noFacturadas: { unidades: number; monto: number };
  /** Aging solo sobre NO facturadas. */
  agingNoFacturadas: Record<AgingProvision, { unidades: number; monto: number }>;
  /** Por marca, solo NO facturadas. */
  porMarcaNoFacturadas: { marca: string; unidades: number; monto: number }[];
  /** Por concepto, solo NO facturadas. */
  porConceptoNoFacturadas: { concepto: string; unidades: number; monto: number }[];
  /** Por motivo, solo NO facturadas. */
  porMotivoNoFacturadas: { motivo: string; unidades: number; monto: number }[];
  /** Por área (ventas vs postventa), solo NO facturadas. */
  porArea: Record<AreaProvision, { unidades: number; monto: number }>;
  /** Aging máximo y promedio (días) sobre NO facturadas. */
  agingPromedioDias: number;
  agingMaxDias: number;
  /** Cuenta de cómo se distribuyen — métricas secundarias. */
  facturadasReferencia: { unidades: number; monto: number };
  revisionManual: { unidades: number; monto: number };
  total: number;
}

export interface SaldosStats {
  total: number;
  saldoTotalCLP: number;
  /** Por categoría macro. */
  porCategoria: Record<CategoriaSaldo, { unidades: number; saldoCLP: number }>;
  /** Sub-tipos dentro de vehículos. */
  porSubTipoVehiculo: Record<SubTipoSaldoVehiculo, { unidades: number; saldoCLP: number }>;
  /** Por status DPS (aging financiero). */
  porStatusDPS: Record<StatusDPS, { unidades: number; saldoCLP: number }>;
  /** Por empresa contable. */
  porEmpresa: Record<EmpresaPompeyo, { unidades: number; saldoCLP: number }>;
  /** Cruce VIN — solo para categoría vehículo. */
  vehiculoCruzados: number;
  vehiculoSinCruce: number;
}
