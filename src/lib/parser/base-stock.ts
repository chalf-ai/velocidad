/**
 * Parser de la hoja Base_Stock — fuente maestra de vehículos.
 *
 * El header está en la fila 1. Validamos columnas esperadas y reportamos
 * faltantes / sucias sin abortar el parseo.
 */

import type { WorkSheet } from "xlsx";
import * as XLSX from "xlsx";
import type {
  ConfianzaMarca,
  DestinoOperacional,
  EstadoCapitalOperacional,
  EstadoComercial,
  FuenteMarcaOriginadora,
  NaturalezaCapital,
  ParseIssue,
  SheetReport,
  StockAB,
  TipoStock,
  UnidadNegocio,
  Vehiculo,
  PorLlegar,
} from "../types";
import {
  canonicalMarca,
  clean,
  inferirMarcaOriginadoraDesdeSucursal,
  parseDate,
  toBoolSiNo,
  toNumber,
  toNumberOrZero,
} from "./normalize";

const EXPECTED_COLS = [
  "Numero VIN",
  "Marca",
  "Marca Pompeyo",
  "Modelo",
  "Version",
  "Año",
  "Color Exterior",
  "Sucursal",
  "Bodega",
  "Estado Dealer",
  "Estado Venta",
  "Estado AutoPro",
  "Status Stock",
  "Días Stock",
  "Tramo DPS",
  "Stock A/B",
  "Tipo Stock",
  "Por llegar",
  "Unidad Negocio",
  "Condicion Vehiculo",
  "Linea SI - NO",
  "Financiado",
  "Fecha vencimiento",
  "Fecha Vencimiento Fin",
  "Pagado?",
  "Pagado Financiera",
  "Costo Neto",
  "Precio Lista",
  "Precio Venta Total",
  "Folio Retoma",
  "Fecha Retoma",
  "Folio Venta",
  "Fecha Venta",
  "Vendedor",
  "Placa Patente",
  "Condicion de Stock",
  "Tipo de Stock",
  "AUX TM",
  "Marca Pompeyo C.",
  "Duplicado",
];

function mapStockAB(v: string | null): StockAB {
  if (!v) return "A";
  if (v.includes("Judicial")) return "Judicial";
  if (v.includes("Stock B")) return "B";
  return "A";
}

function mapTipoStock(v: string | null): TipoStock {
  if (!v) return "Desconocido";
  const u = v.toUpperCase();
  if (u === "FLOOR PLAN") return "FloorPlan";
  if (u === "PROPIO") return "Propio";
  if (u === "FINANCIADO") return "Financiado";
  if (u === "FIN PROPIO") return "FinPropio";
  if (u === "VU POR RECIBIR") return "VuPorRecibir";
  return "Desconocido";
}

function mapUnidadNegocio(v: string | null): UnidadNegocio {
  if (!v) return "Desconocido";
  const u = v.toLowerCase();
  if (u === "nuevos") return "Nuevos";
  if (u === "usados") return "Usados";
  if (u === "autos compañía" || u === "autos compania") return "AutosCompania";
  return "Desconocido";
}

function mapPorLlegar(v: string | null): PorLlegar {
  if (!v) return "Desconocido";
  if (v === "Stock") return "Stock";
  if (v === "Por Llegar") return "PorLlegar";
  if (v === "Pre-Inscrito") return "PreInscrito";
  return "Desconocido";
}

/**
 * Clasifica al vehículo en uno de los 9 EstadoCapitalOperacional.
 * Mutuamente excluyente. Prioridad (mayor → menor):
 *   1. VPP_EXPLICITO         — recibido como parte de pago
 *   2. INMOVILIZADO           — judicial / B / test car activo / traspaso 3°
 *   3. USADO_PAGADO_INMOVIL   — Condicion = "USADO PROPIO PAGADO" (mala rotación)
 *   4. FNE_EN_OPERACION       — vendido + facturado + no entregado
 *   5. PROCESO_VENTA          — cliente comprometido
 *   6. PROCESO_CPD            — documentación/preparación/tránsito
 *   7. POR_LLEGAR             — sin stock físico todavía
 *   8. RETAIL_DISPONIBLE      — stock libre vendible
 *   9. DESCONOCIDO            — no clasificado
 */
function deriveEstadoCapital(args: {
  esVPPComprometido: boolean;
  estadoDealer: string | null;
  estadoAutoPro: string | null;
  statusStock: string | null;
  stockAB: StockAB;
  estadoFlujoVO: string | null;
  porLlegar: PorLlegar;
  condicionVehiculo: string | null;
}): EstadoCapitalOperacional {
  const {
    esVPPComprometido,
    estadoDealer,
    estadoAutoPro,
    statusStock,
    stockAB,
    estadoFlujoVO,
    porLlegar,
    condicionVehiculo,
  } = args;

  if (esVPPComprometido) return "VPP_EXPLICITO";

  if (stockAB === "Judicial" || stockAB === "B") return "INMOVILIZADO";
  if (estadoDealer === "TEST CAR" || estadoDealer === "TRASPASO A 3RO") return "INMOVILIZADO";

  // Usado pagado sin operación viva — mala rotación, capital atrapado (NO puente)
  if (condicionVehiculo === "USADO PROPIO PAGADO") return "USADO_PAGADO_INMOVIL";

  // FNE: vendido + facturado + no entregado
  if (estadoAutoPro === "Vendido" && (statusStock === "Vigente" || statusStock === "Aprobada")) {
    return "FNE_EN_OPERACION";
  }

  // Proceso de Venta — operación abierta con cliente (sin factura todavía)
  if (estadoFlujoVO === "Proceso de Venta") return "PROCESO_VENTA";

  // Proceso CPD — preparación/habilitación
  if (estadoFlujoVO === "Proceso CPD") return "PROCESO_CPD";

  if (porLlegar === "PorLlegar" || porLlegar === "PreInscrito") return "POR_LLEGAR";

  if (estadoDealer === "DISPONIBLE" || estadoDealer === "DISPONIBLE CON DECLARACION") {
    return "RETAIL_DISPONIBLE";
  }

  return "DESCONOCIDO";
}

/**
 * Resuelve el destino operacional (uso real) del vehículo.
 *
 * Fuente AUTORITATIVA: `Condicion de Stock` (col 81 de Base_Stock).
 * Esta es la clasificación oficial usada en los pivots de gestión de Pompeyo —
 * garantiza cuadre exacto con el reporte oficial "Resumen Estado Inventarios".
 *
 * AUX TM se mantiene como `auxTM` crudo en el vehículo para detectar
 * discordancias (cuando flag SAP ≠ clasificación oficial).
 *
 * Devuelve `null` para vehículos en estados de stock normal (Existencia Nuevos,
 * Existencia Usados, VN CON PATENTE, VU por Recibir — no son destinos).
 */
function deriveDestinoOperacional(condicionDeStock: string | null): DestinoOperacional | null {
  const cs = (condicionDeStock ?? "").trim().toUpperCase();
  if (cs === "TEST CARS") return "demo";
  if (cs === "RENTING") return "renting";
  if (cs === "COMPANY CAR") return "company";
  if (cs === "ACTIVO FIJO") return "interno";
  if (cs === "SIN MATCH") return "desconocido";
  // VN ya patentado, transferido a TM para venta como nuevo o usado.
  // No es demo ni renting — es stock vendible de la marca con tratamiento especial.
  if (cs === "VN CON PATENTE") return "vn_con_patente";
  // VDR no aparece en Condicion de Stock — si aparece en AUX TM lo capturamos abajo.
  return null;
}

/**
 * Mapea estadoCapital → naturalezaCapital (agrupación superior).
 *
 * Reglas importantes:
 * - INMOVILIZADO + Stock A/B = Judicial → bucket "judicial" (legal aparte).
 * - PROCESO_CPD se reclasifica por tipoStock: el estado financiero gana.
 *   - CPD + FloorPlan → "retail" (ya en línea, no es transición real)
 *   - CPD + Propio    → "atrapado" (Pompeyo ya pagó, no es puente)
 *   - CPD + resto     → "puente" (transición real, fuera de línea, no pagado)
 */
function deriveNaturaleza(
  estado: EstadoCapitalOperacional,
  stockAB: StockAB,
  tipoStock: TipoStock,
): NaturalezaCapital {
  switch (estado) {
    case "VPP_EXPLICITO":
      return "puente";
    case "PROCESO_CPD":
      // El tipoStock financiero tiene prioridad sobre "Proceso CPD" operacional.
      // CPD ya en FloorPlan = stock usado en línea; CPD ya en Propio = pagado.
      if (tipoStock === "FloorPlan") return "retail";
      if (tipoStock === "Propio") return "atrapado";
      return "puente";
    case "FNE_EN_OPERACION":
    case "PROCESO_VENTA":
      return "operativo";
    case "USADO_PAGADO_INMOVIL":
      return "atrapado";
    case "INMOVILIZADO":
      // Judicial es bucket independiente
      return stockAB === "Judicial" ? "judicial" : "atrapado";
    case "POR_LLEGAR":
      return "transito";
    case "RETAIL_DISPONIBLE":
      return "retail";
    case "DESCONOCIDO":
      return "indefinido";
  }
}

/**
 * Resuelve la marca a la que se atribuye el capital consumido.
 *
 * Caso clave: un VPP usado MAZDA dejado en KIA REDCUBE consume capital de KIA,
 * no de MAZDA. La marca del vehículo NO siempre es la marca que financió la operación.
 *
 * Estrategia por estado:
 *   - FNE / RETAIL → marcaPompeyo del propio vehículo (es el VN).
 *   - VPP / EN_PROCESO → inferir desde sucursal marca-específica.
 *   - INMOVILIZADO / POR_LLEGAR → marcaPompeyo (no es capital puente).
 *
 * Fase 2: si tenemos cruce con "Venta APC Fact VN" por Folio Venta, eso será
 * la fuente más confiable y reemplazará la inferencia por sucursal.
 */
function deriveMarcaOriginadora(args: {
  estadoCapital: EstadoCapitalOperacional;
  marcaPompeyo: string | null;
  sucursal: string | null;
}): { marca: string | null; fuente: FuenteMarcaOriginadora; confianza: ConfianzaMarca } {
  const { estadoCapital, marcaPompeyo, sucursal } = args;

  // FNE: la marca originadora ES la marca del VN
  if (estadoCapital === "FNE_EN_OPERACION") {
    if (marcaPompeyo) return { marca: marcaPompeyo, fuente: "marca_vehiculo", confianza: "alta" };
    return { marca: null, fuente: "no_inferible", confianza: "ninguna" };
  }

  // VPP / PROCESO_CPD / PROCESO_VENTA: inferir desde sucursal (~90% cobertura para VPP)
  if (
    estadoCapital === "VPP_EXPLICITO" ||
    estadoCapital === "PROCESO_CPD" ||
    estadoCapital === "PROCESO_VENTA"
  ) {
    const inferida = inferirMarcaOriginadoraDesdeSucursal(sucursal);
    if (inferida) return { marca: inferida, fuente: "sucursal_marca_especifica", confianza: "media" };
    // No inferible — dejar null explícito para evitar atribuir capital a la marca del VU
    return { marca: null, fuente: "no_inferible", confianza: "ninguna" };
  }

  // Retail / Inmovilizado / Por llegar: marca del propio vehículo
  if (marcaPompeyo) return { marca: marcaPompeyo, fuente: "marca_vehiculo", confianza: "alta" };
  return { marca: null, fuente: "no_inferible", confianza: "ninguna" };
}

/**
 * Estado comercial — heurística inicial, documentada.
 *
 * VPP Comprometido (capital puente): vehículo recibido como parte de pago
 * cuya operación de venta del auto nuevo ya gatilló pago/línea pero
 * todavía no se monetizó. VPP = Vehículo en Parte de Pago.
 * Señales en Base_Stock:
 *   - Estado AutoPro = "Proceso Retoma"  → IS VPP Comprometido
 *   - Status Stock = "Aprobada" Y existe Folio Retoma → IS VPP Comprometido
 *
 * Esta lógica está aislada para ajustarla cuando Pompeyo confirme la regla exacta.
 */
function deriveEstadoComercial(args: {
  estadoDealer: string | null;
  estadoVenta: string | null;
  estadoAutoPro: string | null;
  statusStock: string | null;
  stockAB: StockAB;
  folioRetoma: string | null;
}): { estado: EstadoComercial; esVPPComprometido: boolean } {
  const { estadoDealer, estadoAutoPro, statusStock, stockAB, folioRetoma } = args;

  if (stockAB === "Judicial") return { estado: "Judicial", esVPPComprometido: false };
  if (stockAB === "B") return { estado: "StockB", esVPPComprometido: false };

  if (estadoDealer === "TEST CAR") return { estado: "Tescar", esVPPComprometido: false };
  if (estadoDealer === "TRASPASO A 3RO") return { estado: "Traspaso", esVPPComprometido: false };
  if (estadoDealer === "PRE-INSCRITO") return { estado: "PreInscrito", esVPPComprometido: false };

  // VPP Comprometido (capital puente)
  if (estadoAutoPro === "Proceso Retoma") {
    return { estado: "VPPComprometido", esVPPComprometido: true };
  }
  if (statusStock === "Aprobada" && folioRetoma) {
    return { estado: "VPPComprometido", esVPPComprometido: true };
  }

  if (statusStock === "Aprobada") return { estado: "VentaAprobada", esVPPComprometido: false };
  if (statusStock === "Vigente") return { estado: "Vendido", esVPPComprometido: false };

  if (estadoDealer === "DISPONIBLE" || estadoDealer === "DISPONIBLE CON DECLARACION") {
    return { estado: "Disponible", esVPPComprometido: false };
  }
  if (estadoDealer === "NO DISPONIBLE") return { estado: "NoDisponible", esVPPComprometido: false };

  return { estado: "Desconocido", esVPPComprometido: false };
}

interface ParseBaseStockResult {
  vehiculos: Vehiculo[];
  report: SheetReport;
  issues: ParseIssue[];
  marcasSinMapeo: Set<string>;
  estadosDealerDetectados: Set<string>;
  fechasInvalidas: number;
  vinsDuplicados: string[];
}

export function parseBaseStock(
  ws: WorkSheet,
  tcControlVins: Set<string> = new Set(),
): ParseBaseStockResult {
  const issues: ParseIssue[] = [];
  const marcasSinMapeo = new Set<string>();
  const estadosDealerDetectados = new Set<string>();
  let fechasInvalidas = 0;

  // Usamos raw:true para que los headers vengan del valor crudo (.v) y no del
  // formateado (.w) — algunos headers tienen espacios en .w pero no en .v.
  // Luego normalizamos todas las keys (trim) por defensa.
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    raw: true,
    defval: null,
    blankrows: false,
  });
  const rows: Record<string, unknown>[] = rawRows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      out[k.trim()] = v;
    }
    return out;
  });

  const detectadas = rows[0] ? Object.keys(rows[0]) : [];
  const faltantes = EXPECTED_COLS.filter((c) => !detectadas.includes(c));

  const vinSeen = new Map<string, number>();
  const vehiculos: Vehiculo[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowIndex = i + 2; // header en r1

    const vin = clean(r["Numero VIN"]);
    if (!vin) {
      issues.push({
        hoja: "Base_Stock",
        fila: rowIndex,
        columna: "Numero VIN",
        tipo: "vin_vacio",
        mensaje: "Fila sin VIN, omitida",
      });
      continue;
    }

    const marcaRaw = clean(r["Marca"]) ?? "";
    const marcaPompeyoRaw = clean(r["Marca Pompeyo"]) ?? marcaRaw;
    const { canon: marcaPompeyo, mapped } = canonicalMarca(marcaPompeyoRaw);
    if (!mapped && marcaPompeyo) marcasSinMapeo.add(marcaPompeyo);

    const estadoDealer = clean(r["Estado Dealer"]);
    if (estadoDealer) estadosDealerDetectados.add(estadoDealer);

    // Fecha vencimiento — prioridad: Fecha Vencimiento Fin → Fecha vencimiento
    const fechaFin = parseDate(r["Fecha Vencimiento Fin"]);
    const fechaPrincipal = parseDate(r["Fecha vencimiento"]);
    let fechaVencimiento: Date | null = null;
    let fvSource: "fin" | "principal" | "ninguna" = "ninguna";
    if (fechaFin) {
      fechaVencimiento = fechaFin;
      fvSource = "fin";
    } else if (fechaPrincipal) {
      fechaVencimiento = fechaPrincipal;
      fvSource = "principal";
    } else {
      const rawFin = r["Fecha Vencimiento Fin"];
      const rawPri = r["Fecha vencimiento"];
      const hadSomething = (rawFin && rawFin !== "#N/A" && rawFin !== "NO") ||
        (rawPri && rawPri !== "NO" && rawPri !== "");
      if (hadSomething) {
        fechasInvalidas++;
        issues.push({
          hoja: "Base_Stock",
          fila: rowIndex,
          columna: "Fecha Vencimiento",
          tipo: "fecha_invalida",
          mensaje: `No se pudo parsear: fin=${String(rawFin)} principal=${String(rawPri)}`,
          raw: { fin: rawFin, principal: rawPri },
        });
      }
    }

    const stockAB = mapStockAB(clean(r["Stock A/B"]));
    const folioRetoma = clean(r["Folio Retoma"]);
    const folioRetomaNorm = folioRetoma && folioRetoma !== "0" ? folioRetoma : null;
    const statusStock = clean(r["Status Stock"]);
    const estadoAutoPro = clean(r["Estado AutoPro"]);
    const estadoVenta = clean(r["Estado Venta"]);

    const { estado: estadoComercial, esVPPComprometido } = deriveEstadoComercial({
      estadoDealer,
      estadoVenta,
      estadoAutoPro,
      statusStock,
      stockAB,
      folioRetoma: folioRetomaNorm,
    });

    const estadoFlujoVO = clean(r["Marca Pompeyo C."]);
    const porLlegarMapped = mapPorLlegar(clean(r["Por llegar"]));
    const condicionVehiculo = clean(r["Condicion Vehiculo"]);

    const estadoCapital = deriveEstadoCapital({
      esVPPComprometido,
      estadoDealer,
      estadoAutoPro,
      statusStock,
      stockAB,
      estadoFlujoVO,
      porLlegar: porLlegarMapped,
      condicionVehiculo,
    });

    // tipoStock se calcula antes para poder priorizarlo sobre Proceso CPD
    // en la clasificación de naturaleza. Ver deriveNaturaleza.
    const tipoStock = mapTipoStock(clean(r["Tipo Stock"]));

    const naturalezaCapital = deriveNaturaleza(estadoCapital, stockAB, tipoStock);

    const tipoDeStock = clean(r["Tipo de Stock"]);
    const condicionDeStock = clean(r["Condicion de Stock"]);
    const auxTMRaw = clean(r["AUX TM"]);

    // Fuente principal: Condicion de Stock (clasificación oficial)
    let destinoOperacional = deriveDestinoOperacional(condicionDeStock);

    // Fallback ÚNICAMENTE para VDR (no aparece en Condicion de Stock)
    if (!destinoOperacional && (auxTMRaw ?? "").trim().toUpperCase() === "VDR") {
      destinoOperacional = "vdr";
    }

    const sucursalRow = clean(r["Sucursal"]);
    const marcaOriginadoraResult = deriveMarcaOriginadora({
      estadoCapital,
      marcaPompeyo: marcaPompeyo ?? marcaPompeyoRaw,
      sucursal: sucursalRow,
    });

    const duplicadoFlag = toNumberOrZero(r["Duplicado"]);

    // Track VIN duplicates
    vinSeen.set(vin, (vinSeen.get(vin) ?? 0) + 1);

    vehiculos.push({
      vin,
      marca: marcaRaw,
      marcaPompeyo: marcaPompeyo ?? marcaPompeyoRaw,
      marcaLinea: null, // se rellena en post-proceso

      modelo: clean(r["Modelo"]),
      version: clean(r["Version"]),
      anio: toNumber(r["Año"]),
      color: clean(r["Color Exterior"]),

      sucursal: sucursalRow,
      estadoDealer,
      estadoVenta,
      estadoAutoPro,
      statusStock,

      diasStock: toNumber(r["Días Stock"]),
      tramoDPS: clean(r["Tramo DPS"]),

      stockAB,
      tipoStock,
      porLlegar: mapPorLlegar(clean(r["Por llegar"])),
      unidadNegocio: mapUnidadNegocio(clean(r["Unidad Negocio"])),
      condicionVehiculo,
      estadoComercial,

      enLinea: toBoolSiNo(r["Linea SI - NO"]),
      financiado: toBoolSiNo(r["Financiado"]),
      fechaVencimiento,
      fechaVencimientoSource: fvSource,
      pagado: (clean(r["Pagado?"]) ?? "").toLowerCase() === "pagado",
      pagadoFinanciera: parseDate(r["Pagado Financiera"]),

      costoNeto: toNumberOrZero(r["Costo Neto"]),
      precioLista: toNumber(r["Precio Lista"]),
      precioVentaTotal: toNumber(r["Precio Venta Total"]),

      folioRetoma: folioRetomaNorm,
      fechaRetoma: parseDate(r["Fecha Retoma"]),
      folioVenta: (() => {
        const fv = r["Folio Venta"];
        if (fv === null || fv === undefined || fv === "" || fv === 0 || fv === "0") return null;
        return String(fv);
      })(),
      fechaVenta: parseDate(r["Fecha Venta"]),
      vendedor: clean(r["Vendedor"]),

      esTescar: estadoDealer === "TEST CAR" && destinoOperacional !== "vn_con_patente",
      tescarSignals: {
        estadoDealer: estadoDealer === "TEST CAR",
        condicionEnUso: condicionVehiculo === "TEST CAR EN USO",
        auxTM: clean(r["AUX TM"]) === "TEST CARS",
        tcControl: tcControlVins.has(vin),
      },
      // TESCAR operacional excluye VN CON PATENTE: aunque tengan señales de TESCAR,
      // son stock vendible traspasado a TM, NO parque demo.
      esTescarOperacional:
        destinoOperacional !== "vn_con_patente" &&
        (estadoDealer === "TEST CAR" ||
          condicionVehiculo === "TEST CAR EN USO" ||
          clean(r["AUX TM"]) === "TEST CARS" ||
          tcControlVins.has(vin)),
      esJudicial: stockAB === "Judicial",
      esStockB: stockAB === "B",
      esPagado: (clean(r["Pagado?"]) ?? "").toLowerCase() === "pagado",
      esDuplicado: duplicadoFlag === 2,
      esVPPComprometido,

      bodega: clean(r["Bodega"]),
      estadoFlujoVO,
      tipoDeStock,
      condicionDeStock,
      tipoStockUsados: clean(r["Tipo Stock Usados"]),
      auxTM: auxTMRaw,

      // Taxonomía capital operacional
      estadoCapital,
      naturalezaCapital,
      destinoOperacional,
      marcaOriginadora: marcaOriginadoraResult.marca,
      marcaOriginadoraFuente: marcaOriginadoraResult.fuente,
      confianzaMarcaOriginadora: marcaOriginadoraResult.confianza,

      // Fase 2 — solo patente se llena hoy
      patente: clean(r["Placa Patente"]),
      inscrito: null,
      fechaInscripcion: null,
      estadoInscripcion: null,
      fechaEntregaFinal: null,

      duplicadoFlag,
      rowIndex,
    });
  }

  const vinsDuplicados = Array.from(vinSeen.entries())
    .filter(([, n]) => n > 1)
    .map(([vin]) => vin);

  // Emite issues por VIN duplicado
  for (const vin of vinsDuplicados) {
    issues.push({
      hoja: "Base_Stock",
      fila: 0,
      columna: "Numero VIN",
      tipo: "vin_duplicado",
      mensaje: `VIN ${vin} aparece ${vinSeen.get(vin)} veces`,
    });
  }

  const report: SheetReport = {
    nombre: "Base_Stock",
    filasTotales: rows.length,
    filasProcesadas: vehiculos.length,
    filasOmitidas: rows.length - vehiculos.length,
    columnasDetectadas: detectadas,
    columnasEsperadas: EXPECTED_COLS,
    columnasFaltantes: faltantes,
    estado: faltantes.length === 0 ? "ok" : "parcial",
    mensaje:
      faltantes.length > 0
        ? `${faltantes.length} columna(s) esperada(s) no detectada(s): ${faltantes.join(", ")}`
        : undefined,
  };

  return {
    vehiculos,
    report,
    issues,
    marcasSinMapeo,
    estadosDealerDetectados,
    fechasInvalidas,
    vinsDuplicados,
  };
}
