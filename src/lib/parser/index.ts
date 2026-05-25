/**
 * Orquestador: lee el Excel completo y produce ParsedExcel + ParseReport.
 */

import * as XLSX from "xlsx";
import type { ParseReport, ParsedExcel, SheetReport, Vehiculo } from "../types";
import { parseBaseStock } from "./base-stock";
import { parseAuxFinanciera, parseLineasCredito } from "./lineas-credito";
import { parseResumenOficial } from "./resumen-oficial";
import { parseTcControl } from "./tc-control";
import { parseTescarControl } from "./tescar-control";
import { buildVINSupplementaryRegistry } from "./venta-apc";
import { canonicalMarca } from "./normalize";

const SHEET_BASE_STOCK = "Base_Stock";
const SHEET_LINEAS = "3.-Lineas de Credito";
const SHEET_AUX_FIN = "AUX Financiera Linea Autorizada";
const SHEET_RESUMEN = "Resumen Stock Propio";
const SHEET_TC_CONTROL = "TC CONTROL";
const SHEET_CONTROL_TESTCARS = "Control TestCars";
const SHEET_VENTA_APC_VN = "Venta APC Fact VN";
const SHEET_VENTA_APC_VU = "Venta APC Fact VU";
const SHEET_FINANCIADO = "Financiado";
const SHEET_BASE_FIN = "Base Financiamiento";

function missingSheetReport(nombre: string): SheetReport {
  return {
    nombre,
    filasTotales: 0,
    filasProcesadas: 0,
    filasOmitidas: 0,
    columnasDetectadas: [],
    columnasEsperadas: [],
    columnasFaltantes: [],
    estado: "no_encontrada",
    mensaje: `Hoja "${nombre}" no se encontró en el archivo`,
  };
}

export async function parseExcelFile(file: File): Promise<ParsedExcel> {
  const t0 = performance.now();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, {
    type: "array",
    cellDates: true,
    cellStyles: false,
    dense: false,
    // Hojas que cargamos:
    //  - Base_Stock, Lineas, Aux, Resumen, TC Control → módulos principales
    //  - Venta APC VN/VU, Financiado, Base Financiamiento → registry suplementario
    //    para enriquecer cruces VIN del módulo FNE (sin esto solo cruzamos 24%).
    sheets: [
      SHEET_BASE_STOCK,
      SHEET_LINEAS,
      SHEET_AUX_FIN,
      SHEET_RESUMEN,
      SHEET_TC_CONTROL,
      SHEET_CONTROL_TESTCARS,
      SHEET_VENTA_APC_VN,
      SHEET_VENTA_APC_VU,
      SHEET_FINANCIADO,
      SHEET_BASE_FIN,
    ],
  });

  const reports: SheetReport[] = [];
  const issues: ParsedExcel["report"]["issues"] = [];

  // 1) AUX Financiera (lookup)
  const auxWs = wb.Sheets[SHEET_AUX_FIN];
  const auxMap = auxWs ? parseAuxFinanciera(auxWs) : new Map();
  reports.push(
    auxWs
      ? {
          nombre: SHEET_AUX_FIN,
          filasTotales: auxMap.size,
          filasProcesadas: auxMap.size,
          filasOmitidas: 0,
          columnasDetectadas: ["MARCA", "Linea Autorizada", "FINANCIERA", "Dias Libres"],
          columnasEsperadas: ["MARCA", "FINANCIERA", "Dias Libres"],
          columnasFaltantes: [],
          estado: "ok",
        }
      : missingSheetReport(SHEET_AUX_FIN),
  );

  // 2) TC CONTROL — VINs para enriquecer TESCAR operacional
  let tcControlVins = new Set<string>();
  const tcWs = wb.Sheets[SHEET_TC_CONTROL];
  if (tcWs) {
    const r = parseTcControl(tcWs);
    tcControlVins = r.vins;
    reports.push(r.report);
  } else {
    reports.push(missingSheetReport(SHEET_TC_CONTROL));
  }

  // 2b) Control TestCars — FUENTE OFICIAL de TESCAR (TEST CARS + BDR).
  let tescarControl: ParsedExcel["tescarControl"] = [];
  const tescarWs = wb.Sheets[SHEET_CONTROL_TESTCARS];
  if (tescarWs) {
    const r = parseTescarControl(tescarWs);
    tescarControl = r.rows;
    reports.push(r.report);
  } else {
    reports.push(missingSheetReport(SHEET_CONTROL_TESTCARS));
  }

  // 3) Base_Stock — fuente maestra (recibe set TC CONTROL para enriquecer)
  let vehiculos: Vehiculo[] = [];
  let marcasSinMapeo = new Set<string>();
  let estadosDealerDetectados = new Set<string>();
  let fechasInvalidas = 0;
  let vinsDuplicados: string[] = [];

  const baseWs = wb.Sheets[SHEET_BASE_STOCK];
  if (baseWs) {
    const r = parseBaseStock(baseWs, tcControlVins);
    vehiculos = r.vehiculos;
    reports.push(r.report);
    issues.push(...r.issues);
    marcasSinMapeo = r.marcasSinMapeo;
    estadosDealerDetectados = r.estadosDealerDetectados;
    fechasInvalidas = r.fechasInvalidas;
    vinsDuplicados = r.vinsDuplicados;
  } else {
    reports.push(missingSheetReport(SHEET_BASE_STOCK));
  }

  // 3) Lineas de Credito
  let lineas: ParsedExcel["lineas"] = [];
  const lineasWs = wb.Sheets[SHEET_LINEAS];
  if (lineasWs) {
    const r = parseLineasCredito(lineasWs, auxMap);
    lineas = r.lineas;
    reports.push(r.report);
    issues.push(...r.issues);
  } else {
    reports.push(missingSheetReport(SHEET_LINEAS));
  }

  // 4) Resumen oficial
  let resumenOficial: ParsedExcel["resumenOficial"] = null;
  const resumenWs = wb.Sheets[SHEET_RESUMEN];
  if (resumenWs) {
    const r = parseResumenOficial(resumenWs);
    resumenOficial = r.resumen;
    reports.push(r.report);
  } else {
    reports.push(missingSheetReport(SHEET_RESUMEN));
  }

  // Post-proceso: mapear marcaLinea para cada vehiculo
  const marcasLinea = new Set(lineas.map((l) => l.marcaPompeyo).filter(Boolean) as string[]);
  for (const v of vehiculos) {
    const { canon } = canonicalMarca(v.marcaPompeyo);
    if (canon && marcasLinea.has(canon)) v.marcaLinea = canon;
  }

  // Registry suplementario VIN → metadata histórica (Venta APC + Financiado)
  const vinsExtra = buildVINSupplementaryRegistry(wb);
  reports.push({
    nombre: "Registry suplementario VIN",
    filasTotales: vinsExtra.size,
    filasProcesadas: vinsExtra.size,
    filasOmitidas: 0,
    columnasDetectadas: [SHEET_VENTA_APC_VN, SHEET_VENTA_APC_VU, SHEET_FINANCIADO, SHEET_BASE_FIN],
    columnasEsperadas: [],
    columnasFaltantes: [],
    estado: "ok",
    mensaje: `${vinsExtra.size} VINs únicos consolidados desde 4 hojas históricas`,
  });

  // Fecha de corte — desde lineas o desde Base_Stock col Fecha
  const fechaCorteExcel = lineas[0]?.fechaCalculo ?? null;

  // VINs únicos
  const vinSet = new Set(vehiculos.map((v) => v.vin));

  const report: ParseReport = {
    archivoNombre: file.name,
    archivoSize: file.size,
    fechaCarga: new Date(),
    fechaCorteExcel,
    hojas: reports,
    totalVehiculos: vehiculos.length,
    totalVinsUnicos: vinSet.size,
    vinsDuplicados,
    fechasInvalidas,
    marcasSinMapeo: Array.from(marcasSinMapeo),
    estadosDealerDetectados: Array.from(estadosDealerDetectados),
    issues,
    durMs: Math.round(performance.now() - t0),
  };

  return { vehiculos, lineas, resumenOficial, tescarControl, vinsExtra, report };
}
