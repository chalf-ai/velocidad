#!/usr/bin/env node
/**
 * Valida que el detector de fuente del Hub de Ingesta clasifica correctamente
 * los 3 archivos críticos como las fuentes correctas.
 */
import XLSX from "xlsx";

const BASE = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive";

const archivos = [
  { path: `${BASE}/Actas al 28 de Mayo.xlsx`, esperado: "fne" },
  { path: `${BASE}/SCHIAPPCASSE 28 de Mayo.xlsx`, esperado: "romia_schiapp" },
  { path: `${BASE}/KAR-LOGISTICS 28 de Mayo.xlsx`, esperado: "romia_kar" },
];

// Replica de detectarFuente() pura en JS para validar offline
function detectar(wb) {
  const hojas = wb.SheetNames;
  const tieneHoja = (n) => hojas.some((h) => h.trim().toLowerCase() === n.toLowerCase());
  const cols = new Map();
  for (const n of hojas) {
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false });
    const header = filas[0] ?? [];
    const set = new Set();
    for (const c of header) if (c != null) { const k = String(c).trim(); if (k) set.add(k); }
    cols.set(n, set);
  }
  const hojaCon = (...req) => {
    for (const [name, set] of cols) {
      if (req.every((c) => set.has(c))) return name;
    }
    return null;
  };

  if (tieneHoja("Base_Stock")) return { tipo: "stock", hoja: "Base_Stock" };
  if (tieneHoja("DIRECCIONES") || tieneHoja("Listado laminado"))
    return { tipo: "romia_schiapp", hoja: tieneHoja("DIRECCIONES") ? "DIRECCIONES" : "Listado laminado" };
  if (tieneHoja("CODIGO DESPACHO") || tieneHoja("Compras Marca"))
    return { tipo: "romia_kar", hoja: tieneHoja("CODIGO DESPACHO") ? "CODIGO DESPACHO" : "Compras Marca" };
  const hSal = tieneHoja("FUSION BD 3.0") ? "FUSION BD 3.0" : hojaCon("CATEGORIA", "Saldo x Documentar");
  if (hSal) return { tipo: "saldos", hoja: hSal };
  const hRoma = hojaCon("VentaID", "PasoActual");
  if (hRoma) return { tipo: "logistica_roma", hoja: hRoma };
  const hStli = hojaCon("Fecha de solicitud a STLI") ?? hojaCon("VIN", "Fecha Ingreso APC");
  if (hStli) return { tipo: "logistica_stli", hoja: hStli };
  const hProv = hojaCon("montoProvision") ?? hojaCon("Concepto", "saldo", "EstadoAjuste");
  if (hProv) return { tipo: "provisiones", hoja: hProv };
  const hFne =
    hojaCon("Vin", "Nombre_Cliente") ??
    hojaCon("Vin", "entrega_auto_txt") ??
    hojaCon("Vin", "etapa", "ValorFactura");
  if (hFne) return { tipo: "fne", hoja: hFne };
  const hTes = tieneHoja("Control TestCars") ? "Control TestCars" : hojaCon("Tipo Vehículo", "Valor compra");
  if (hTes) return { tipo: "tescar", hoja: hTes };
  return { tipo: "desconocido", hoja: null };
}

console.log("════════════════════════════════════════════════════════════════════════════════");
console.log("  VALIDACIÓN — Detector de fuente Hub Ingesta");
console.log("════════════════════════════════════════════════════════════════════════════════");
console.log("");

let allOk = true;
for (const a of archivos) {
  const wb = XLSX.readFile(a.path, { sheetRows: 1, cellDates: true });
  const det = detectar(wb);
  const ok = det.tipo === a.esperado;
  if (!ok) allOk = false;
  const archivo = a.path.split("/").pop();
  console.log(`  ${ok ? "✅" : "❌"} ${archivo}`);
  console.log(`     Esperado: ${a.esperado}`);
  console.log(`     Detectado: ${det.tipo}${det.hoja ? ` (hoja: "${det.hoja}")` : ""}`);
  console.log("");
}

console.log("════════════════════════════════════════════════════════════════════════════════");
console.log(`  Resultado: ${allOk ? "✅ TODOS los archivos se detectan correctamente" : "❌ Hay archivos mal detectados"}`);
console.log("════════════════════════════════════════════════════════════════════════════════");
