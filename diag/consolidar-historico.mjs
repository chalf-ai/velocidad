#!/usr/bin/env node
/**
 * CONSOLIDADOR HISTÓRICO — análisis offline.
 *
 * Fuentes:
 *   - 5 archivos ROMA mensuales (Ene-May 2026)        → línea comercial
 *   - SCHIAPPACASSE + KAR-LOGISTICS (snapshot)        → línea física
 *   - Actas al 28 de Mayo                              → línea documental
 *
 * Llave canónica: VentaID + VIN (ROMA). VIN para Actas/ROMIA.
 * Cruce: ROMA + Actas + ROMIA por VIN normalizado.
 *
 * Salidas:
 *   - diag/output/historico-consolidado.json  (registros por VentaID/VIN)
 *   - diag/output/historico-consolidado.csv   (para Excel/Sheets)
 *   - diag/output/validacion-cobertura.txt    (informe de calidad)
 *
 * NO toca src/. NO toca DB. Análisis puro.
 */
import XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";

const OUT = path.join("diag", "output");
fs.mkdirSync(OUT, { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
// FUENTES
// ─────────────────────────────────────────────────────────────────────────────

const BASE = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive";

const ROMA_FILES = [
  { mes: "2026-01", path: `${BASE}/LOG Enero.xlsx` },
  { mes: "2026-02", path: `${BASE}/Log Febrero.xlsx` },
  { mes: "2026-03", path: `${BASE}/LOG Marzo.xlsx` },
  { mes: "2026-04", path: `${BASE}/Log Abril.xlsx` },
  { mes: "2026-05", path: `${BASE}/Log Roma 29-05-2026 .xlsx` },
];
const ACTAS_FILE = `${BASE}/Actas al 28 de Mayo.xlsx`;
const SCHIAPP_FILE = `${BASE}/SCHIAPPCASSE 28 de Mayo.xlsx`;
const KAR_FILE = `${BASE}/KAR-LOGISTICS 28 de Mayo.xlsx`;

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────

function toDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "number") {
    if (v === 0) return null;
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const s = String(v).trim();
  if (!s || s === "0" || s === "00-00-0000") return null;
  const lower = s.toLowerCase();
  if (lower === "sin salida" || lower === "en proceso" || lower === "por confirmar") return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}
function fmt(d) { return d ? d.toISOString().slice(0, 10) : null; }
function vinKey(v) {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  return s.length >= 11 ? s : null;
}
function nz(v) { return v == null || v === "" || v === 0 || v === "0" ? null : v; }
function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function rowsOf(ws) { return XLSX.utils.sheet_to_json(ws, { defval: null, raw: true }); }
function esSinSalida(v) { return v != null && String(v).trim().toUpperCase() === "SIN SALIDA"; }

/** No pisar fecha con null: si nueva es null y vieja tiene valor, preservar vieja. */
function mergeFecha(prev, next) { return next == null ? prev : next; }
/** Inmutable: primera ocurrencia gana. */
function mergeFirst(prev, next) { return prev == null ? next : prev; }
/** Evolutivo: nuevo gana, salvo null. */
function mergeLast(prev, next) { return next == null ? prev : next; }
/** Inmutable estricto para fechas: la más antigua gana. */
function mergeFechaMinima(prev, next) {
  if (next == null) return prev;
  if (prev == null) return next;
  return prev < next ? prev : next;
}
/** Evolutivo de fechas: la más reciente gana. */
function mergeFechaMaxima(prev, next) {
  if (next == null) return prev;
  if (prev == null) return next;
  return prev > next ? prev : next;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) CARGAR ROMA (5 meses, con MergePolicy)
// ─────────────────────────────────────────────────────────────────────────────

console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  CARGANDO FUENTES");
console.log("══════════════════════════════════════════════════════════════════════════════");

const romaByVenta = new Map();  // ventaId → consolidado
const romaVintoVenta = new Map(); // vin → set(ventaIds)
const romaConflictos = []; // INMUTABLES con valores distintos

for (const f of ROMA_FILES) {
  const wb = XLSX.readFile(f.path, { cellDates: true });
  const rows = rowsOf(wb.Sheets["ROMA"]);
  let nuevos = 0, mergeados = 0;
  for (const r of rows) {
    const ventaId = r["VentaID"] != null ? Number(r["VentaID"]) : null;
    const vin = vinKey(r["Vin"]);
    if (!ventaId || !vin) continue;
    const key = ventaId;
    const item = {
      ventaId,
      vin,
      gerencia: nz(r["Gerencia"]),
      sucursal: nz(r["Sucursal"]),
      marca: nz(r["Marca"]),
      modelo: nz(r["Modelo"]),
      // INMUTABLES
      fSolicitud: toDate(r["FechaSolicitud"]),
      fFactura_ROMA: toDate(r["FechaFactura"]),
      fInscripcion_ROMA: toDate(r["FechaEnprocesoIns"]),
      // EVOLUTIVOS
      estado: nz(r["Estado"]),
      pasoActual: nz(r["PasoActual"]),
      comentario: nz(r["Comentario"]),
      fEstimadaEntrega: toDate(r["FechaEstimadaEntrega"]),
      fRespuestaLogistica: toDate(r["fecha_RespuestaGestionLogistica"]),
      fRespuestaInstalacionAcc: toDate(r["fecha_RespuestaInstalacionAcc"]),
      fETASucursal: toDate(r["FechaETASucursal"]),
      fETALlegadaCalc: toDate(r["FechaEstimadaLLegadaSucursal_Calculo"]),
      // AUDITORÍA
      mesesPresente: new Set([f.mes]),
    };
    const prev = romaByVenta.get(key);
    if (!prev) {
      romaByVenta.set(key, item);
      nuevos++;
    } else {
      // Detectar conflictos en INMUTABLES
      if (prev.fSolicitud && item.fSolicitud && prev.fSolicitud.getTime() !== item.fSolicitud.getTime()) {
        romaConflictos.push({ ventaId, campo: "fSolicitud", prev: fmt(prev.fSolicitud), nuevo: fmt(item.fSolicitud), mesPrev: [...prev.mesesPresente].join(","), mesNuevo: f.mes });
      }
      if (prev.vin !== item.vin) {
        romaConflictos.push({ ventaId, campo: "vin", prev: prev.vin, nuevo: item.vin, mesPrev: [...prev.mesesPresente].join(","), mesNuevo: f.mes });
      }
      // Merge según política
      prev.fSolicitud = mergeFechaMinima(prev.fSolicitud, item.fSolicitud);
      prev.fFactura_ROMA = mergeFechaMinima(prev.fFactura_ROMA, item.fFactura_ROMA);
      prev.fInscripcion_ROMA = mergeFechaMinima(prev.fInscripcion_ROMA, item.fInscripcion_ROMA);
      prev.estado = mergeLast(prev.estado, item.estado);
      prev.pasoActual = mergeLast(prev.pasoActual, item.pasoActual);
      prev.comentario = mergeLast(prev.comentario, item.comentario);
      prev.fEstimadaEntrega = mergeFecha(prev.fEstimadaEntrega, item.fEstimadaEntrega);
      prev.fRespuestaLogistica = mergeFecha(prev.fRespuestaLogistica, item.fRespuestaLogistica);
      prev.fRespuestaInstalacionAcc = mergeFecha(prev.fRespuestaInstalacionAcc, item.fRespuestaInstalacionAcc);
      prev.fETASucursal = mergeFecha(prev.fETASucursal, item.fETASucursal);
      prev.fETALlegadaCalc = mergeFecha(prev.fETALlegadaCalc, item.fETALlegadaCalc);
      prev.sucursal = prev.sucursal ?? item.sucursal;
      prev.marca = prev.marca ?? item.marca;
      prev.modelo = prev.modelo ?? item.modelo;
      prev.gerencia = prev.gerencia ?? item.gerencia;
      prev.mesesPresente.add(f.mes);
      mergeados++;
    }
    // Index por VIN
    if (!romaVintoVenta.has(vin)) romaVintoVenta.set(vin, new Set());
    romaVintoVenta.get(vin).add(ventaId);
  }
  console.log(`  ROMA ${f.mes.padEnd(8)} ${rows.length.toString().padStart(5)} filas → +${nuevos} nuevos · ${mergeados} mergeados`);
}
console.log(`  ─ Total VentaIDs únicos ROMA: ${romaByVenta.size}`);
console.log(`  ─ Conflictos en campos inmutables: ${romaConflictos.length}`);

// ─────────────────────────────────────────────────────────────────────────────
// 2) CARGAR Actas (universo documental)
// ─────────────────────────────────────────────────────────────────────────────

const actasByVin = new Map();
{
  const wb = XLSX.readFile(ACTAS_FILE, { cellDates: true });
  const rows = rowsOf(wb.Sheets["ROMA"]);
  for (const r of rows) {
    const vin = vinKey(r["Vin"]);
    if (!vin) continue;
    const txt = String(r["entrega_auto_txt"] ?? "").trim();
    actasByVin.set(vin, {
      vin,
      id: r["ID"],
      sucursal: nz(r["Sucursal"]),
      cliente: nz(r["Nombre_Cliente"]),
      vendedor: nz(r["Nombre_Vendedor"]),
      valorFactura: Number(r["ValorFactura"] ?? 0),
      // Línea Control de Negocio
      fVenta: toDate(r["FechaVenta"]),
      fFactura_Actas: toDate(r["FechaFactura"]),
      solicitarInscripcion: r["SolicitarInscripcion"],
      fSolicitudInscripcion: toDate(r["FechaSolicitudInscripcion"]),
      fInscripcion_Actas: toDate(r["FechaInscripcion"]),
      fPatenteAdmin: toDate(r["patentes_administracion"]),
      fPatenteEnviada: toDate(r["fecha_patente_enviada"]),
      fPatenteRecibida: toDate(r["fecha_patente_recibida"]),
      fPatenteEntregada: toDate(r["fecha_patente_entregada"]),
      autorizacionEntrega: r["autorizacion_entrega"],
      solEntrega: r["sol_entrega"],
      entregado: txt === "Cargado",
      entregaAutoTxt: nz(r["entrega_auto_txt"]),
      etapa: r["etapa"],
    });
  }
  console.log(`  Actas       ${rows.length.toString().padStart(5)} filas → ${actasByVin.size} VINs únicos`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) CARGAR ROMIA (SCHIAPP + KAR) — línea física
// ─────────────────────────────────────────────────────────────────────────────

function loadRomia(file, bodega) {
  const wb = XLSX.readFile(file, { cellDates: true });
  const accs = new Map();
  const ensure = (vin) => {
    let a = accs.get(vin);
    if (!a) {
      a = {
        bodega, vin,
        fCompraMarca: null, fIngresoApc: null,
        fSolicitudBodega: null, fPlanificacion: null,
        fechaLimite: null, fDespacho: null,
        tieneSinSalida: false,
        fEntradaPatio: null, fSalidaPatio: null,
        estadoBodega: null, patio: null, puntoEntrega: null,
        cumplimientoDespacho: null, numTraslados: null,
      };
      accs.set(vin, a);
    }
    return a;
  };

  // Hojas variantes SCHIAPP vs KAR
  const hAlm = wb.SheetNames.find((n) => /^almacenamiento\s*$/i.test(n));
  const hDist = wb.SheetNames.find((n) => /^distribuci[oó]n\s*$/i.test(n));
  const hEnt = wb.SheetNames.find((n) => /^entradas\s*$/i.test(n));
  const hSal = wb.SheetNames.find((n) => /^salidas\s*$/i.test(n));

  if (hAlm) for (const r of rowsOf(wb.Sheets[hAlm])) {
    const vin = vinKey(r["VIN"]); if (!vin) continue;
    const a = ensure(vin);
    a.fIngresoApc = a.fIngresoApc ?? toDate(r["1° dia Almacenaje en bodega"]);
    a.estadoBodega = a.estadoBodega ?? nz(r["Disponible en bodega"]) ?? nz(r["Estado Kar"]) ?? nz(r["Estado Kar "]);
    a.fCompraMarca = a.fCompraMarca ?? toDate(r["Fecha compra marca"] ?? r["Fecha Compra marca"]);
  }
  if (hDist) for (const r of rowsOf(wb.Sheets[hDist])) {
    const vin = vinKey(r["VIN"]); if (!vin) continue;
    const a = ensure(vin);
    a.fCompraMarca = a.fCompraMarca ?? toDate(r["Fecha compra marca"] ?? r["Fecha Compra Marca"]);
    a.fIngresoApc = a.fIngresoApc ?? toDate(r["1° dia Almacenaje en bodega"] ?? r["1° dia Almacenaje"]);
    const fSol = toDate(r["Fecha de solicitud"]) ?? toDate(r["Fecha  Solicitud"]) ?? toDate(r["Fecha Solicitud"]);
    a.fSolicitudBodega = a.fSolicitudBodega ?? fSol;
    a.fPlanificacion = a.fPlanificacion ?? toDate(r["Fecha teorica STLI"]);
    a.fechaLimite = a.fechaLimite ?? toDate(r["Fecha limite"]);
    const desp = r["Fecha despacho a sucursal"];
    if (esSinSalida(desp)) a.tieneSinSalida = true;
    else a.fDespacho = a.fDespacho ?? toDate(desp);
    a.cumplimientoDespacho = a.cumplimientoDespacho ?? nz(r["Cumplimiento despacho"]) ?? nz(r["Cumplimiento fecha limite"]);
    a.numTraslados = a.numTraslados ?? r["N° Traslados"];
  }
  if (hEnt) for (const r of rowsOf(wb.Sheets[hEnt])) {
    const vin = vinKey(r["VIN"]); if (!vin) continue;
    const a = ensure(vin);
    a.fEntradaPatio = a.fEntradaPatio ?? toDate(r["Fecha Ent"] ?? r["Fecha Entrada"]);
    a.estadoBodega = a.estadoBodega ?? nz(r["Estado"]) ?? nz(r["Estado Gp Simplificado"]);
    a.patio = a.patio ?? nz(r["Patio"]) ?? nz(r["Zona"]);
    a.puntoEntrega = a.puntoEntrega ?? nz(r["Punto de Entrega"]) ?? nz(r["Destino"]);
  }
  if (hSal) for (const r of rowsOf(wb.Sheets[hSal])) {
    const vin = vinKey(r["VIN"]); if (!vin) continue;
    const a = ensure(vin);
    const fSal = toDate(r["Fecha Sal"] ?? r["Fecha Salida"]);
    if (fSal && (!a.fSalidaPatio || fSal > a.fSalidaPatio)) a.fSalidaPatio = fSal;
  }
  return accs;
}

const schiapp = loadRomia(SCHIAPP_FILE, "SCHIAPP");
const kar = loadRomia(KAR_FILE, "KAR");
console.log(`  SCHIAPP     ${schiapp.size} VINs`);
console.log(`  KAR         ${kar.size} VINs`);

// ─────────────────────────────────────────────────────────────────────────────
// 4) CONSOLIDAR — un registro por (VentaID, VIN)
// ─────────────────────────────────────────────────────────────────────────────

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  CONSOLIDANDO TABLA HISTÓRICA");
console.log("══════════════════════════════════════════════════════════════════════════════");

function pickRomia(vin) {
  // Si está en ambas, preferir la que tenga más datos (KAR primero por volumen)
  const k = kar.get(vin);
  const s = schiapp.get(vin);
  if (k && s) {
    // Mergear ambas — gana primera no-null
    const merged = { ...k };
    for (const key of Object.keys(s)) {
      if (merged[key] == null && s[key] != null) merged[key] = s[key];
    }
    if (s.tieneSinSalida) merged.tieneSinSalida = true;
    merged.bodega = `${k.bodega}+${s.bodega}`;
    return merged;
  }
  return k ?? s ?? null;
}

const consolidated = [];

for (const [ventaId, r] of romaByVenta) {
  const actas = actasByVin.get(r.vin);
  const romia = pickRomia(r.vin);

  // ── LÍNEA LOGÍSTICA COMERCIAL (ROMA)
  const fSolicitud = r.fSolicitud;
  const fRespuestaLogistica = r.fRespuestaLogistica;
  // ── LÍNEA LOGÍSTICA FÍSICA (KAR/SCHIAPP)
  const fIngresoBodega = romia?.fIngresoApc ?? null;
  const fSolicitudBodega = romia?.fSolicitudBodega ?? null;
  const fPlanificacionFisica = romia?.fPlanificacion ?? null;
  const fSalidaFisica = romia?.fSalidaPatio ?? romia?.fDespacho ?? null;
  // FechaLlegadaSucursal: ROMA es ETA (promesa). Mejor proxy físico real = max(fSalidaFisica, fETASucursal)
  // pero ETA es estimada. Usamos ETA como aproximación cuando no hay otra señal.
  const fLlegadaSucursal_ETA = r.fETASucursal;
  const tieneSinSalida = romia?.tieneSinSalida ?? false;

  // ── LÍNEA CONTROL DE NEGOCIO (Actas)
  const fFactura = mergeFechaMinima(r.fFactura_ROMA, actas?.fFactura_Actas ?? null);
  const fSolicitudInscripcion = actas?.fSolicitudInscripcion ?? null;
  const fInscripcion = mergeFechaMinima(r.fInscripcion_ROMA, actas?.fInscripcion_Actas ?? null);
  const fPatenteAdmin = actas?.fPatenteAdmin ?? null;
  const fPatenteEnviada = actas?.fPatenteEnviada ?? null;
  const fPatenteRecibida = actas?.fPatenteRecibida ?? null;

  // ── CONVERGENCIA
  // Auto físico listo: hay salida física Y/O llegada confirmada
  const fAutoFisicoListo = fSalidaFisica ?? fLlegadaSucursal_ETA ?? null;
  // Documentación lista: patente recibida en sucursal
  const fDocumentacionLista = fPatenteRecibida;
  // Listo para entrega: max de ambos
  let fListoParaEntrega = null;
  if (fAutoFisicoListo && fDocumentacionLista) {
    fListoParaEntrega = fAutoFisicoListo > fDocumentacionLista ? fAutoFisicoListo : fDocumentacionLista;
  }
  // Entrega real
  const fEntregaReal = actas?.entregado ? (actas?.fPatenteEntregada ?? null) : null;

  // ── DÍAS
  const diasLogistica = daysBetween(fSolicitud, fLlegadaSucursal_ETA ?? fSalidaFisica);
  const diasControlNegocio = daysBetween(fFactura, fPatenteRecibida);
  const diasEsperaEntrega = daysBetween(fListoParaEntrega, fEntregaReal);
  const diasTotales = daysBetween(fSolicitud, fEntregaReal);

  // ── CUELLO PRINCIPAL — clasificación automática
  const cuello = clasificarCuello({
    fSolicitud, fLlegadaSucursal_ETA, fSalidaFisica, tieneSinSalida,
    fFactura, fSolicitudInscripcion, fInscripcion, fPatenteRecibida,
    fListoParaEntrega, fEntregaReal,
    estado: r.estado,
    autorizacionEntrega: actas?.autorizacionEntrega,
    solEntrega: actas?.solEntrega,
    entregado: !!actas?.entregado,
  });

  consolidated.push({
    // Identidad
    ventaId: r.ventaId,
    vin: r.vin,
    marca: r.marca ?? actas?.sucursal,
    modelo: r.modelo,
    sucursal: r.sucursal ?? actas?.sucursal,
    gerencia: r.gerencia,
    valorFactura: actas?.valorFactura ?? null,
    // Línea Comercial (ROMA)
    fSolicitud: fmt(fSolicitud),
    fRespuestaLogistica: fmt(fRespuestaLogistica),
    fETASucursalPromesa: fmt(fLlegadaSucursal_ETA),
    fEstimadaEntrega: fmt(r.fEstimadaEntrega),
    estado_ROMA: r.estado,
    pasoActual_ROMA: r.pasoActual,
    // Línea Física (ROMIA)
    bodega_fisica: romia?.bodega ?? null,
    fIngresoBodega: fmt(fIngresoBodega),
    fSolicitudBodega: fmt(fSolicitudBodega),
    fPlanificacionFisica: fmt(fPlanificacionFisica),
    fSalidaFisica: fmt(fSalidaFisica),
    tieneSinSalida,
    estadoBodega: romia?.estadoBodega ?? null,
    patio: romia?.patio ?? null,
    puntoEntrega: romia?.puntoEntrega ?? null,
    cumplimientoDespacho: romia?.cumplimientoDespacho ?? null,
    // Línea Control de Negocio (Actas)
    fFactura: fmt(fFactura),
    fSolicitudInscripcion: fmt(fSolicitudInscripcion),
    fInscripcion: fmt(fInscripcion),
    fPatenteAdmin: fmt(fPatenteAdmin),
    fPatenteEnviada: fmt(fPatenteEnviada),
    fPatenteRecibida: fmt(fPatenteRecibida),
    autorizacionEntrega: actas?.autorizacionEntrega ?? null,
    solEntrega: actas?.solEntrega ?? null,
    // Convergencia
    fListoParaEntrega: fmt(fListoParaEntrega),
    fEntregaReal: fmt(fEntregaReal),
    entregado: !!actas?.entregado,
    // Días derivados
    diasLogistica,
    diasControlNegocio,
    diasEsperaEntrega,
    diasTotales,
    cuelloPrincipal: cuello,
    // Auditoría
    mesesROMA: [...r.mesesPresente].sort().join(","),
    enActas: !!actas,
    enROMIA: !!romia,
  });
}

console.log(`  Registros consolidados: ${consolidated.length}`);

// ─────────────────────────────────────────────────────────────────────────────
// 5) CLASIFICACIÓN DE CUELLO
// ─────────────────────────────────────────────────────────────────────────────

function clasificarCuello(d) {
  const {
    fSolicitud, fLlegadaSucursal_ETA, fSalidaFisica, tieneSinSalida,
    fFactura, fSolicitudInscripcion, fInscripcion, fPatenteRecibida,
    fListoParaEntrega, fEntregaReal,
    estado, autorizacionEntrega, solEntrega, entregado,
  } = d;

  if (!fSolicitud && !fFactura) return "Sin información suficiente";

  // Caso entregado: el cuello es histórico
  if (entregado) {
    const dl = fSolicitud && fLlegadaSucursal_ETA ? daysBetween(fSolicitud, fLlegadaSucursal_ETA) : null;
    const dc = fFactura && fPatenteRecibida ? daysBetween(fFactura, fPatenteRecibida) : null;
    if (dl != null && dc != null) {
      if (dl > dc + 7) return "Logística";
      if (dc > dl + 7) return "Control de Negocio";
      return "Mixto";
    }
    if (dl != null) return "Logística";
    if (dc != null) return "Control de Negocio";
    return "Sin información suficiente";
  }

  // Caso vivo: dónde está parado?
  // 1) Físico sin salida = Logística (bodega)
  if (tieneSinSalida && !fSalidaFisica) return "Logística";
  // 2) Tiene factura pero falta inscripción/patente = Control de Negocio
  if (fFactura && !fPatenteRecibida) {
    if (!fSolicitudInscripcion) return "Control de Negocio";
    if (!fInscripcion) return "Control de Negocio";
    return "Control de Negocio";
  }
  // 3) Está listo (patente recibida + auto físico) pero no se entrega
  if (fPatenteRecibida && (fSalidaFisica || fLlegadaSucursal_ETA)) {
    const sEntrega = String(solEntrega ?? "").trim();
    const aEntrega = String(autorizacionEntrega ?? "").trim();
    if (sEntrega === "Si" && aEntrega === "Si") return "Cliente";
    if (aEntrega !== "Si") return "Comercial";
    if (sEntrega !== "Si") return "Comercial";
    return "Cliente";
  }
  // 4) Sin respuesta logística
  if (fSolicitud && !fSalidaFisica && !fLlegadaSucursal_ETA) return "Logística";
  return "Sin información suficiente";
}

// Re-asignar cuello con función definida
for (const c of consolidated) {
  c.cuelloPrincipal = clasificarCuello({
    fSolicitud: c.fSolicitud ? new Date(c.fSolicitud) : null,
    fLlegadaSucursal_ETA: c.fETASucursalPromesa ? new Date(c.fETASucursalPromesa) : null,
    fSalidaFisica: c.fSalidaFisica ? new Date(c.fSalidaFisica) : null,
    tieneSinSalida: c.tieneSinSalida,
    fFactura: c.fFactura ? new Date(c.fFactura) : null,
    fSolicitudInscripcion: c.fSolicitudInscripcion ? new Date(c.fSolicitudInscripcion) : null,
    fInscripcion: c.fInscripcion ? new Date(c.fInscripcion) : null,
    fPatenteRecibida: c.fPatenteRecibida ? new Date(c.fPatenteRecibida) : null,
    fListoParaEntrega: c.fListoParaEntrega ? new Date(c.fListoParaEntrega) : null,
    fEntregaReal: c.fEntregaReal ? new Date(c.fEntregaReal) : null,
    estado: c.estado_ROMA,
    autorizacionEntrega: c.autorizacionEntrega,
    solEntrega: c.solEntrega,
    entregado: c.entregado,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 6) VALIDACIÓN — cobertura, marca, sucursal, descartes, calidad
// ─────────────────────────────────────────────────────────────────────────────

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  VALIDACIÓN DE COBERTURA Y CALIDAD");
console.log("══════════════════════════════════════════════════════════════════════════════");

const total = consolidated.length;
const cubre = (campo) => consolidated.filter((c) => c[campo] != null && c[campo] !== "" && c[campo] !== false).length;
const colsImportantes = [
  "fSolicitud", "fRespuestaLogistica", "fETASucursalPromesa",
  "fIngresoBodega", "fSolicitudBodega", "fSalidaFisica", "tieneSinSalida",
  "fFactura", "fSolicitudInscripcion", "fInscripcion", "fPatenteRecibida",
  "fListoParaEntrega", "fEntregaReal", "entregado",
  "diasLogistica", "diasControlNegocio", "diasTotales",
  "enActas", "enROMIA",
];

console.log(`\n  Cobertura por columna (sobre ${total} VentaIDs):`);
for (const col of colsImportantes) {
  const n = cubre(col);
  const pct = (n / total * 100).toFixed(1);
  const bar = "█".repeat(Math.round(n / total * 40));
  console.log(`    ${col.padEnd(28)} ${String(n).padStart(5)}/${total}  ${pct.padStart(5)}%  ${bar}`);
}

// Cobertura por marca
const porMarca = new Map();
for (const c of consolidated) {
  const m = c.marca ?? "(sin marca)";
  if (!porMarca.has(m)) porMarca.set(m, { total: 0, conSalida: 0, entregados: 0, sinInfo: 0 });
  const x = porMarca.get(m);
  x.total++;
  if (c.fSalidaFisica) x.conSalida++;
  if (c.entregado) x.entregados++;
  if (c.cuelloPrincipal === "Sin información suficiente") x.sinInfo++;
}
console.log(`\n  Cobertura por marca (top 15):`);
const marcas = [...porMarca.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 15);
console.log(`    ${"Marca".padEnd(20)} ${"Total".padStart(6)} ${"ConSalida".padStart(10)} ${"Entregados".padStart(11)} ${"SinInfo".padStart(8)}`);
for (const [m, x] of marcas) {
  console.log(`    ${m.padEnd(20)} ${String(x.total).padStart(6)} ${String(x.conSalida).padStart(10)} ${String(x.entregados).padStart(11)} ${String(x.sinInfo).padStart(8)}`);
}

// Cobertura por sucursal (top 15)
const porSucursal = new Map();
for (const c of consolidated) {
  const s = c.sucursal ?? "(sin sucursal)";
  porSucursal.set(s, (porSucursal.get(s) ?? 0) + 1);
}
console.log(`\n  Top 15 sucursales por volumen:`);
const sucs = [...porSucursal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
for (const [s, n] of sucs) console.log(`    ${s.padEnd(40)} ${String(n).padStart(5)}`);

// Distribución por cuello
const porCuello = new Map();
for (const c of consolidated) {
  porCuello.set(c.cuelloPrincipal, (porCuello.get(c.cuelloPrincipal) ?? 0) + 1);
}
console.log(`\n  Distribución por cuello principal:`);
for (const [c, n] of [...porCuello.entries()].sort((a, b) => b[1] - a[1])) {
  const pct = (n / total * 100).toFixed(1);
  console.log(`    ${c.padEnd(28)} ${String(n).padStart(5)}  (${pct}%)`);
}

// Calidad de llaves
console.log(`\n  Calidad de llaves:`);
const vinsConVarios = [...romaVintoVenta.entries()].filter(([_, set]) => set.size > 1);
console.log(`    VINs ROMA con >1 VentaID:    ${vinsConVarios.length}`);
console.log(`    Conflictos en INMUTABLES:    ${romaConflictos.length}`);
const conflictosVin = romaConflictos.filter((c) => c.campo === "vin").length;
console.log(`    ─ de los cuales conflicto VIN: ${conflictosVin}`);
const conflictosFSol = romaConflictos.filter((c) => c.campo === "fSolicitud").length;
console.log(`    ─ conflicto FechaSolicitud:    ${conflictosFSol}`);
if (romaConflictos.length > 0 && romaConflictos.length <= 10) {
  console.log(`    Detalle:`);
  for (const c of romaConflictos) console.log(`      VentaID ${c.ventaId} · ${c.campo}: ${c.prev} → ${c.nuevo} (${c.mesPrev} → ${c.mesNuevo})`);
}

// Cobertura cruzada ROMA × Actas × ROMIA
const enTodas = consolidated.filter((c) => c.enActas && c.enROMIA).length;
const soloROMA = consolidated.filter((c) => !c.enActas && !c.enROMIA).length;
const soloROMAyActas = consolidated.filter((c) => c.enActas && !c.enROMIA).length;
const soloROMAyROMIA = consolidated.filter((c) => !c.enActas && c.enROMIA).length;
console.log(`\n  Cobertura cruzada (¿qué casos están en cada fuente?):`);
console.log(`    Solo ROMA (sin Actas, sin ROMIA):        ${soloROMA}  (${(soloROMA/total*100).toFixed(1)}%)`);
console.log(`    ROMA + Actas (sin ROMIA):                ${soloROMAyActas}  (${(soloROMAyActas/total*100).toFixed(1)}%)`);
console.log(`    ROMA + ROMIA (sin Actas):                ${soloROMAyROMIA}  (${(soloROMAyROMIA/total*100).toFixed(1)}%)`);
console.log(`    ROMA + Actas + ROMIA (cobertura total):  ${enTodas}  (${(enTodas/total*100).toFixed(1)}%)`);

// Tiempos: distribución de días
function statsDias(field) {
  const vals = consolidated.map((c) => c[field]).filter((v) => v != null && v > 0);
  if (vals.length === 0) return null;
  vals.sort((a, b) => a - b);
  const median = vals[Math.floor(vals.length / 2)];
  const p90 = vals[Math.floor(vals.length * 0.9)];
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { n: vals.length, min: vals[0], median, avg: Math.round(avg), p90, max: vals[vals.length - 1] };
}
console.log(`\n  Distribución de tiempos (días, solo valores positivos):`);
for (const f of ["diasLogistica", "diasControlNegocio", "diasEsperaEntrega", "diasTotales"]) {
  const s = statsDias(f);
  if (s) {
    console.log(`    ${f.padEnd(22)} n=${String(s.n).padStart(4)}  min=${s.min}  mediana=${s.median}  promedio=${s.avg}  p90=${s.p90}  max=${s.max}`);
  } else {
    console.log(`    ${f.padEnd(22)} (sin datos válidos)`);
  }
}

// Casos descartados
console.log(`\n  Casos descartados durante carga:`);
let totalROMARows = 0;
for (const f of ROMA_FILES) {
  const wb = XLSX.readFile(f.path, { cellDates: true });
  totalROMARows += rowsOf(wb.Sheets["ROMA"]).length;
}
console.log(`    Filas ROMA totales:           ${totalROMARows}`);
console.log(`    VentaIDs únicos consolidados: ${consolidated.length}`);
console.log(`    Mermas (no VentaID o no VIN): ${totalROMARows - consolidated.length - romaByVenta.size + consolidated.length} aprox`);

// ─────────────────────────────────────────────────────────────────────────────
// 7) SALIDAS
// ─────────────────────────────────────────────────────────────────────────────

const jsonOut = path.join(OUT, "historico-consolidado.json");
fs.writeFileSync(jsonOut, JSON.stringify(consolidated, null, 2));

// CSV
const cols = Object.keys(consolidated[0]);
const csvOut = path.join(OUT, "historico-consolidado.csv");
const csvLines = [cols.join(",")];
for (const c of consolidated) {
  csvLines.push(cols.map((k) => {
    const v = c[k];
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return /[,"\n]/.test(s) ? `"${s}"` : s;
  }).join(","));
}
fs.writeFileSync(csvOut, csvLines.join("\n"));

console.log("");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log("  SALIDAS");
console.log("══════════════════════════════════════════════════════════════════════════════");
console.log(`  JSON: ${jsonOut}  (${(fs.statSync(jsonOut).size / 1024).toFixed(0)} KB)`);
console.log(`  CSV : ${csvOut}  (${(fs.statSync(csvOut).size / 1024).toFixed(0)} KB)`);
console.log(`  Registros: ${consolidated.length}`);
console.log("══════════════════════════════════════════════════════════════════════════════");
