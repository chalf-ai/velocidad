/**
 * CRUCE FORENSE: Reportes Saldos ↔ Autos no entregados ↔ Informe Stock
 *
 * El archivo de saldos no tiene VIN, pero tiene Cajón (8 chars que coinciden
 * con los últimos chars del VIN).
 *
 * Estrategia:
 *   1. Construir un mapa bridge Cajón_LIMPIO → VIN desde:
 *        - FNE (Autos no entregados): tiene Cajón + Vin directos
 *        - Stock.Financiado: tiene Cajón + VIN
 *        - Stock.Base_Stock: derivamos Cajón desde últimos 8 del VIN
 *   2. Para cada registro de saldos: normalizar Cajón → buscar VIN → cruzar
 *   3. Match en capas: exacto Cajón → últimos 6 → auxiliar (folio + RUT)
 */

import * as XLSX from "xlsx";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const PATH_FNE =
  "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Autos no entregados.xlsx";
const PATH_STOCK =
  "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Informe Stock y Lineas - 18 Mayo 2026 - Pompeyo Carrasco.xlsx";
const PATH_SALDOS =
  "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Reportes Saldos 2.0 18-05-2026_.xlsx";
const OUT_PATH =
  "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Cruce Saldos.xlsx";

// ── Helpers ──────────────────────────────────────────────────────────────
function limpiarVIN(raw) {
  if (raw == null) return "";
  return String(raw)
    .replace(/[   ​-‍﻿]/g, "")
    .replace(/[\r\n\t]/g, "")
    .replace(/\s+/g, "")
    .replace(/[-_./]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}
function limpiarCajon(raw) {
  if (raw == null) return "";
  return String(raw)
    .replace(/\s+/g, "")
    .replace(/[-_./]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}
const esVINValido = (v) => typeof v === "string" && v.length === 17 && /^[A-Z0-9]{17}$/.test(v);
const s = (v) => (v == null || v === "" ? null : String(v).trim());
const num = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const d = (v) => {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t) : null;
  }
  return null;
};
const fmtD = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : "");

// ── 1) Bridge Cajón → VIN ───────────────────────────────────────────────
console.log("[1/5] Construyendo bridge Cajón → VIN …");
const cajonToVIN = new Map(); // cajonLimpio → array de candidatos { vin, fuente, marca, modelo, ... }

function addBridge(cajonRaw, vinRaw, info) {
  const cajon = limpiarCajon(cajonRaw);
  const vin = limpiarVIN(vinRaw);
  if (cajon.length < 4) return; // muy corto, ignorar
  if (!esVINValido(vin)) return;
  if (!cajonToVIN.has(cajon)) cajonToVIN.set(cajon, []);
  cajonToVIN.get(cajon).push({ vin, ...info });
}

// 1a) Desde FNE
{
  const wb = XLSX.read(readFileSync(PATH_FNE), { type: "buffer", cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["ROMA"], { defval: null, raw: true });
  for (const r of rows) {
    addBridge(r.Cajon, r.Vin, {
      fuente: "FNE",
      marca: null,
      modelo: null,
      cliente: s(r.Nombre_Cliente),
      sucursal: s(r.Sucursal),
      vendedor: s(r.Nombre_Vendedor),
      folioVenta: r.ID ?? null,
      valorFactura: num(r.ValorFactura),
    });
  }
}

// 1b) Desde stock: Financiado tiene Cajón + VIN
const stockWb = XLSX.read(readFileSync(PATH_STOCK), { type: "buffer", cellDates: true });
{
  const rows = XLSX.utils.sheet_to_json(stockWb.Sheets["Financiado"], { defval: null, raw: true });
  for (const r of rows) {
    addBridge(r.Cajon, r.VIN, {
      fuente: "Financiado",
      marca: s(r.Marca),
      modelo: s(r.Modelo),
      sucursal: s(r.Sucursal),
      tipoFinanciamiento: s(r["Tipo de Financiamiento"]),
      statusFinanciamiento: s(r.Status),
      financiera: s(r["Financiera/Banco"]),
      fechaVencimiento: d(r["Fecha de Vencimiento"]),
      actualmenteEnStock: s(r["Actualmente en Stock?"]),
      enLinea: s(r["En linea?"]),
      precioCompra: num(r["Precio De Compra"]),
    });
  }
}

// 1c) Desde stock: Base_Stock — derivamos Cajón = últimos 8 chars VIN
{
  const rows = XLSX.utils.sheet_to_json(stockWb.Sheets["Base_Stock"], { defval: null, raw: true });
  for (const r of rows) {
    const vin = limpiarVIN(r["Numero VIN"]);
    if (!esVINValido(vin)) continue;
    const cajon = vin.slice(-8);
    addBridge(cajon, vin, {
      fuente: "Base_Stock",
      marca: s(r["Marca"]),
      modelo: s(r["Modelo"]),
      patente: s(r["Placa Patente"]),
      sucursal: s(r["Sucursal"]),
      bodega: s(r["Bodega"]),
      tipoStock: s(r["Tipo Stock"]),
      condicionStock: s(r["Condicion de Stock"]),
      estadoDealer: s(r["Estado Dealer"]),
      diasStock: r["Días Stock"] ?? null,
      folioVenta: r["Folio Venta"] ?? null,
      costoNeto: num(r["Total Costo"]),
    });
  }
}

// 1d) Desde stock: Venta APC Fact VN — derivamos Cajón = últimos 8 chars VIN
{
  const rows = XLSX.utils.sheet_to_json(stockWb.Sheets["Venta APC Fact VN"], { defval: null, raw: true });
  for (const r of rows) {
    const vin = limpiarVIN(r["Numero VIN"] ?? r["Numero Chasis"]);
    if (!esVINValido(vin)) continue;
    addBridge(vin.slice(-8), vin, {
      fuente: "Venta APC VN",
      marca: s(r.Marca),
      modelo: s(r.Modelo),
      patente: s(r["Placa Patente"]),
      sucursal: s(r.Sucursal),
      cliente: s(r.Cliente),
      vendedor: s(r.Vendedor),
      folioVenta: r["Folio Venta"] ?? null,
      fechaFacturacion: d(r["Fecha Facturación"]),
      precioCompra: num(r["Precio Compra"]),
    });
  }
}

// 1e) Desde stock: Venta APC Fact VU
{
  const rows = XLSX.utils.sheet_to_json(stockWb.Sheets["Venta APC Fact VU"], { defval: null, raw: true });
  for (const r of rows) {
    const vin = limpiarVIN(r["Numero VIN"] ?? r["Numero Chasis"]);
    if (!esVINValido(vin)) continue;
    addBridge(vin.slice(-8), vin, {
      fuente: "Venta APC VU",
      marca: s(r.Marca),
      modelo: s(r.Modelo),
      patente: s(r["Placa Patente"]),
      sucursal: s(r.Sucursal),
      cliente: s(r.Cliente),
      vendedor: s(r.Vendedor),
    });
  }
}

const totalBridges = [...cajonToVIN.values()].reduce((s, arr) => s + arr.length, 0);
console.log(`    → Bridges Cajón→VIN: ${cajonToVIN.size} Cajones únicos, ${totalBridges} entradas`);

// Consolidar: para cada Cajón, elegir el "mejor" VIN (FNE/Financiado/Base_Stock antes que Venta APC histórica)
const PRIO = { FNE: 1, Financiado: 2, Base_Stock: 3, "Venta APC VN": 4, "Venta APC VU": 5 };
const cajonResolved = new Map(); // cajonLimpio → consolidated info
for (const [cajon, hits] of cajonToVIN) {
  const sorted = [...hits].sort((a, b) => (PRIO[a.fuente] ?? 99) - (PRIO[b.fuente] ?? 99));
  // Si los hits tienen distintos VIN, marca conflicto
  const uniqVins = new Set(hits.map((h) => h.vin));
  const consol = {
    cajon,
    vin: sorted[0].vin,
    vinAlternos: uniqVins.size > 1 ? [...uniqVins].filter((v) => v !== sorted[0].vin) : [],
    fuentes: sorted.map((h) => h.fuente).join(" + "),
  };
  // Merge metadata: primer no-null gana
  for (const h of sorted) {
    for (const [k, v] of Object.entries(h)) {
      if (v != null && consol[k] === undefined) consol[k] = v;
    }
  }
  cajonResolved.set(cajon, consol);
}
console.log(`    → Cajones únicos resueltos: ${cajonResolved.size}`);
const conflictos = [...cajonResolved.values()].filter((c) => c.vinAlternos.length > 0).length;
console.log(`    → Con conflicto multi-VIN: ${conflictos}`);

// ── 2) Leer saldos ───────────────────────────────────────────────────────
console.log("[2/5] Leyendo Reportes Saldos …");
const saldosWb = XLSX.read(readFileSync(PATH_SALDOS), { type: "buffer", cellDates: true });
const saldosRows = XLSX.utils.sheet_to_json(saldosWb.Sheets["FUSION BD 3.0"], { defval: null, raw: true });
console.log(`    → ${saldosRows.length} registros leídos`);

// ── 3) Match en capas ───────────────────────────────────────────────────
console.log("[3/5] Cruzando saldos …");

// Index auxiliar: últimos 6 chars de cajón
const cajonLast6 = new Map();
for (const [k, v] of cajonResolved) {
  const l6 = k.slice(-6);
  if (!cajonLast6.has(l6)) cajonLast6.set(l6, []);
  cajonLast6.get(l6).push(v);
}
// Index auxiliar: folio venta (N° Nota)
const folioIdx = new Map();
for (const [, v] of cajonResolved) {
  if (v.folioVenta != null) {
    const k = String(v.folioVenta);
    if (!folioIdx.has(k)) folioIdx.set(k, []);
    folioIdx.get(k).push(v);
  }
}
// Index auxiliar: patente
const patenteIdx = new Map();
for (const [, v] of cajonResolved) {
  if (v.patente) {
    const k = String(v.patente).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!patenteIdx.has(k)) patenteIdx.set(k, []);
    patenteIdx.get(k).push(v);
  }
}

// Detección: la columna "Cajon" del archivo de saldos a veces trae patente (largo 6)
// y a veces el Cajón real (largo 7-8). También viene vacía para saldos administrativos
// (a importadoras: SAIC, Stellantis, KIA Chile, etc), que no son por vehículo.
const RE_PATENTE_CHILE = /^[A-Z]{4}[0-9]{2}$|^[A-Z]{2}[0-9]{4}$|^[A-Z]{2}[A-Z0-9]{4}$/;
function esPatenteCL(v) {
  return typeof v === "string" && v.length === 6 && RE_PATENTE_CHILE.test(v);
}

const RE_IMPORTADORA = /SAIC|STELLANTIS|KIA CHILE|GEELY MOTOR|INCHCAPE|HYUNDAI MOTOR|NISSAN CHILE|TOYOTA CHILE|FORD MOTOR|MOTOR CITROEN|PEUGEOT CHILE|OPEL CHILE|SUBARU CHILE|MITSUBISHI|MAZDA|MAHINDRA|DERCO|ASTARA RETAIL/i;
const RE_ASEGURADORA = /SEGUROS|MAPFRE|HDI|BCI SEGUROS|REALE|ZURICH|ZENIT|SURAMERICANA|RENTA NACIONAL|CONSORCIO/i;
const RE_FINANCIERA = /TANNER|FORUM|S\.A\.\s*FINANCIERO|FINANCIAL SERVICES|SOCIEDAD DE CR[EÉ]DITOS|BANCO|SANTANDER|ITAU|SCOTIA/i;
const RE_OTRO_DEALER = /SPA|S\.A\.|LTDA|AUTOMOTRIZ|CARLOS VERDUGO|SENDING|DAVISCO|XTREME|MARTINEZ|KOVACS|BRUNO FRITSCH|HINO|NIQKEY|AUTOMOTORA/i;
const RE_MUNICIPAL = /MUNICIPALIDAD|GOBIERNO|MINISTERIO/i;

function clasificarNoVehiculo(cliente) {
  if (!cliente) return null;
  if (RE_IMPORTADORA.test(cliente)) return "Importadora";
  if (RE_ASEGURADORA.test(cliente)) return "Aseguradora";
  if (RE_FINANCIERA.test(cliente)) return "Financiera";
  if (RE_MUNICIPAL.test(cliente)) return "Sector público";
  if (RE_OTRO_DEALER.test(cliente)) return "Otro dealer/proveedor";
  return null;
}

let nExacto = 0, nLast6 = 0, nFolio = 0, nPatente = 0;
let nAdminImportadora = 0, nAdminAseguradora = 0, nAdminFinanciera = 0, nAdminPublico = 0, nAdminOtro = 0;
let nNoMatch = 0;
const cruce = [];
const noMatch = [];

for (let i = 0; i < saldosRows.length; i++) {
  const r = saldosRows[i];
  const cajonRaw = limpiarCajon(r.Cajon);
  const folio = s(r["N° Nota"]) || s(r["Número factura"]);
  const cliente = s(r.Cliente);

  let hit = null;
  let estadoMatch = "";
  let confianza = "";
  let obs = "";

  // CAPA 0: Si el campo "Cajon" en realidad es una patente (largo 6 con patrón chileno),
  // buscar por patente directamente
  if (cajonRaw && esPatenteCL(cajonRaw) && patenteIdx.has(cajonRaw)) {
    const cands = patenteIdx.get(cajonRaw);
    if (cands.length >= 1) {
      hit = cands[0];
      estadoMatch = "Patente (Cajón=patente)";
      confianza = cands.length === 1 ? "Alta" : "Media";
      obs = `El campo 'Cajon' contenía patente ${cajonRaw}`;
      nPatente++;
    }
  }
  // CAPA 1: exacto Cajón
  if (!hit && cajonRaw && cajonResolved.has(cajonRaw)) {
    hit = cajonResolved.get(cajonRaw);
    estadoMatch = "Exacto Cajón";
    confianza = "Alta";
    nExacto++;
  }
  // CAPA 2: últimos 6 chars Cajón (cuando Cajón viene truncado)
  if (!hit && cajonRaw && cajonRaw.length >= 6 && !esPatenteCL(cajonRaw)) {
    const cands = cajonLast6.get(cajonRaw.slice(-6)) ?? [];
    if (cands.length === 1) {
      hit = cands[0];
      estadoMatch = "Últimos 6 Cajón";
      confianza = "Media";
      obs = `Match único por últimos 6 chars`;
      nLast6++;
    } else if (cands.length > 1) {
      const byMarca = cands.filter((c) => c.marca && r.Marca && c.marca.toUpperCase() === String(r.Marca).toUpperCase());
      if (byMarca.length === 1) {
        hit = byMarca[0];
        estadoMatch = "Últimos 6 + Marca";
        confianza = "Media";
        obs = `${cands.length} cands, filtrado por marca=${r.Marca}`;
        nLast6++;
      }
    }
  }
  // CAPA 3: folio N° Nota
  if (!hit && folio && folioIdx.has(String(folio))) {
    const cands = folioIdx.get(String(folio));
    if (cands.length === 1) {
      hit = cands[0];
      estadoMatch = "Folio";
      confianza = "Media";
      obs = `Match por N° Nota = ${folio}`;
      nFolio++;
    }
  }

  if (hit) {
    cruce.push({ r, hit, estadoMatch, confianza, obs });
  } else {
    // ¿Saldo contable a contraparte no-vehicular?
    const tipo = !cajonRaw || cajonRaw.length < 6 ? clasificarNoVehiculo(cliente) : null;
    if (tipo) {
      if (tipo === "Importadora") nAdminImportadora++;
      else if (tipo === "Aseguradora") nAdminAseguradora++;
      else if (tipo === "Financiera") nAdminFinanciera++;
      else if (tipo === "Sector público") nAdminPublico++;
      else nAdminOtro++;
      cruce.push({
        r,
        hit: null,
        estadoMatch: tipo,
        confianza: "N/A",
        obs: `Saldo contable · ${tipo} (${cliente}) — no es por vehículo`,
        esAdminNoVehicular: true,
        tipoNoVehicular: tipo,
      });
    } else {
      noMatch.push({ r, cajon: cajonRaw });
      nNoMatch++;
    }
  }
}

const nTotalAdmin = nAdminImportadora + nAdminAseguradora + nAdminFinanciera + nAdminPublico + nAdminOtro;

const totalCruzados = nExacto + nLast6 + nFolio + nPatente;
const totalClasificados = totalCruzados + nTotalAdmin;
console.log(`    → CRUCE VEHÍCULO:`);
console.log(`        · Exacto Cajón     : ${nExacto}`);
console.log(`        · Últimos 6        : ${nLast6}`);
console.log(`        · Folio            : ${nFolio}`);
console.log(`        · Patente (Cajón=p): ${nPatente}`);
console.log(`        · Total            : ${totalCruzados}`);
console.log(`    → ADMIN NO-VEHICULAR:`);
console.log(`        · Importadora      : ${nAdminImportadora}`);
console.log(`        · Aseguradora      : ${nAdminAseguradora}`);
console.log(`        · Financiera       : ${nAdminFinanciera}`);
console.log(`        · Sector público   : ${nAdminPublico}`);
console.log(`        · Otro dealer/prov : ${nAdminOtro}`);
console.log(`        · Total            : ${nTotalAdmin}`);
console.log(`    → Sin clasificar     : ${nNoMatch}`);
console.log(`    ────────`);
console.log(`    → Total clasificado: ${totalClasificados}/${saldosRows.length} (${(totalClasificados / saldosRows.length * 100).toFixed(1)}%)`);

// ── 4) Construir hojas de output ────────────────────────────────────────
console.log("[4/5] Construyendo Excel de salida …");

const HOY = new Date("2026-05-21");

// (a) Cruce_Saldos_Master — fila por registro saldos
const cruceRows = saldosRows.map((r, i) => {
  const m = cruce.find((c) => c.r === r);
  const hit = m?.hit;
  return {
    "Cajón saldos": r.Cajon ?? "",
    "Cajón limpio": limpiarCajon(r.Cajon),
    "VIN resuelto": hit?.vin ?? "",
    "VINs alternos": hit?.vinAlternos?.join(" | ") ?? "",
    "Estado Match": m?.estadoMatch ?? "No encontrado",
    "Confianza": m?.confianza ?? "Sin match",
    "Fuentes bridge": hit?.fuentes ?? "",
    "Marca": r.Marca ?? hit?.marca ?? "",
    "Modelo": r.Modelo ?? hit?.modelo ?? "",
    "Cliente": s(r.Cliente) ?? hit?.cliente ?? "",
    "Rut Cliente": s(r["Rut Cliente"]) ?? "",
    "N° Nota": r["N° Nota"] ?? "",
    "Número factura": r["Número factura"] ?? "",
    "Fecha Venta": fmtD(d(r["Fecha Venta"])),
    "Fecha Vencimiento": fmtD(d(r["Fecha de vencimiento"])),
    "Días desde venta": d(r["Fecha Venta"]) ? Math.floor((HOY - d(r["Fecha Venta"])) / 86400000) : "",
    "Días (archivo)": r.Días ?? "",
    "Status": s(r.Status) ?? "",
    "E° Pago": s(r["E°_Pago"]) ?? "",
    "Fecha Pago": fmtD(d(r["Fch_Pago"])),
    "E° Entrega": s(r["E°entrega"]) ?? "",
    "Entregado": s(r[" Entregado"]) ?? s(r["Entregado"]) ?? "",
    "Inscrito": s(r[" Inscrito"]) ?? s(r["Inscrito"]) ?? "",
    "Sucursal": s(r.Sucursal) ?? hit?.sucursal ?? "",
    "Vendedor": s(r.Vendedor) ?? "",
    "Saldo x Documentar": num(r["Saldo x Documentar"]),
    "Financiera (CLP)": num(r[" Financiera"]),
    "C. Pompeyo (CLP)": num(r[" C.Pompeyo"]),
    "MM$": num(r[" MM$"]),
    "Entidad Financiera": s(r["Entidad Financiera"]) ?? "",
    "Origen": s(r.Origen) ?? "",
    "Categoría": s(r.CATEGORIA) ?? "",
    "Clasificación Salvin": s(r["CLASIFICASIÓN SALVIN"]) ?? "",
    "Comentarios Finanzas": s(r["COMENTARIOS FINANZAS"]) ?? "",
    "Está en stock activo": hit?.fuentes?.includes("Base_Stock") ? "Sí" : "No",
    "Está en línea": hit?.enLinea === "Si" || (hit?.tipoStock && /floor plan/i.test(hit.tipoStock)) ? "Sí" : "No",
    "Tipo stock": hit?.tipoStock ?? "",
    "Días stock": hit?.diasStock ?? "",
    "Vencimiento financ.": fmtD(hit?.fechaVencimiento),
    "Observación técnica": m?.obs ?? "",
  };
});

// (b) Saldos_No_Cruzados
const noMatchRows = noMatch.map(({ r, cajon }) => ({
  "Cajón saldos": r.Cajon ?? "",
  "Cajón limpio": cajon,
  "Largo Cajón": cajon.length,
  "Últimos 6": cajon.slice(-6),
  "Marca": r.Marca ?? "",
  "Modelo": r.Modelo ?? "",
  "Cliente": r.Cliente ?? "",
  "N° Nota": r["N° Nota"] ?? "",
  "Número factura": r["Número factura"] ?? "",
  "Saldo": num(r["Saldo x Documentar"]),
  "Status": r.Status ?? "",
  "Sucursal": r.Sucursal ?? "",
  "Posible causa": cajon.length < 6 ? "Cajón muy corto o vacío" : "Sin match en ningún bridge",
}));

// (c) Auditoria_Cruce_Saldos
const totalConSaldo = saldosRows.filter((r) => num(r["Saldo x Documentar"]) > 0).length;
const totalSaldoCLP = saldosRows.reduce((s, r) => s + num(r["Saldo x Documentar"]), 0);
const saldoCruzadoVehiculo = cruce
  .filter((c) => !c.esAdminNoVehicular && c.hit)
  .reduce((s, c) => s + num(c.r["Saldo x Documentar"]), 0);
const saldoAdminTotal = cruce
  .filter((c) => c.esAdminNoVehicular)
  .reduce((s, c) => s + num(c.r["Saldo x Documentar"]), 0);
const saldoPorTipoAdmin = {};
for (const c of cruce) {
  if (!c.esAdminNoVehicular) continue;
  saldoPorTipoAdmin[c.tipoNoVehicular] = (saldoPorTipoAdmin[c.tipoNoVehicular] ?? 0) + num(c.r["Saldo x Documentar"]);
}
const saldoNoCruzado = noMatch.reduce((s, m) => s + num(m.r["Saldo x Documentar"]), 0);

const audit = [
  { Métrica: "Total registros saldos", Valor: saldosRows.length },
  { Métrica: "Saldo total CLP", Valor: totalSaldoCLP.toLocaleString("es-CL") },
  { Métrica: "—", Valor: "—" },
  { Métrica: "▸ CRUZADOS A VEHÍCULO", Valor: totalCruzados },
  { Métrica: "  · Exacto Cajón", Valor: nExacto },
  { Métrica: "  · Últimos 6 Cajón", Valor: nLast6 },
  { Métrica: "  · Patente (Cajón=patente)", Valor: nPatente },
  { Métrica: "  · Folio (N° Nota)", Valor: nFolio },
  { Métrica: "  Saldo asociado CLP", Valor: saldoCruzadoVehiculo.toLocaleString("es-CL") },
  { Métrica: "—", Valor: "—" },
  { Métrica: "▸ SALDOS ADMIN NO-VEHICULARES", Valor: nTotalAdmin },
  { Métrica: "  · Importadora", Valor: `${nAdminImportadora} u · $${(saldoPorTipoAdmin["Importadora"] ?? 0).toLocaleString("es-CL")}` },
  { Métrica: "  · Aseguradora", Valor: `${nAdminAseguradora} u · $${(saldoPorTipoAdmin["Aseguradora"] ?? 0).toLocaleString("es-CL")}` },
  { Métrica: "  · Financiera", Valor: `${nAdminFinanciera} u · $${(saldoPorTipoAdmin["Financiera"] ?? 0).toLocaleString("es-CL")}` },
  { Métrica: "  · Sector público", Valor: `${nAdminPublico} u · $${(saldoPorTipoAdmin["Sector público"] ?? 0).toLocaleString("es-CL")}` },
  { Métrica: "  · Otro dealer/proveedor", Valor: `${nAdminOtro} u · $${(saldoPorTipoAdmin["Otro dealer/proveedor"] ?? 0).toLocaleString("es-CL")}` },
  { Métrica: "  Saldo admin total CLP", Valor: saldoAdminTotal.toLocaleString("es-CL") },
  { Métrica: "—", Valor: "—" },
  { Métrica: "▸ SIN MATCH", Valor: nNoMatch },
  { Métrica: "  Saldo no cruzado CLP", Valor: saldoNoCruzado.toLocaleString("es-CL") },
  { Métrica: "—", Valor: "—" },
  { Métrica: "% Clasificados (cruce + admin)", Valor: `${((totalCruzados + nAdminImportadora) / saldosRows.length * 100).toFixed(2)}%` },
  { Métrica: "% Cruce VIN sobre total saldos", Valor: `${(totalCruzados / saldosRows.length * 100).toFixed(2)}%` },
  { Métrica: "% Cruce VIN sobre saldos con Cajón válido", Valor: (() => {
    const conCajon = saldosRows.filter((r) => limpiarCajon(r.Cajon).length >= 6).length;
    return conCajon ? `${(totalCruzados / conCajon * 100).toFixed(2)}% (${totalCruzados}/${conCajon})` : "—";
  })()},
  { Métrica: "—", Valor: "—" },
  { Métrica: "Con saldo > 0", Valor: totalConSaldo },
  { Métrica: "Bridge Cajón→VIN: Cajones únicos", Valor: cajonResolved.size },
  { Métrica: "Bridge con conflicto multi-VIN", Valor: conflictos },
];

// (d) Mapa_Cajon_a_VIN
const mapaRows = [...cajonResolved.values()].map((c) => ({
  "Cajón": c.cajon,
  "VIN elegido": c.vin,
  "VINs alternos": c.vinAlternos.join(" | "),
  "Fuentes": c.fuentes,
  "Marca": c.marca ?? "",
  "Modelo": c.modelo ?? "",
  "Patente": c.patente ?? "",
  "Sucursal": c.sucursal ?? "",
  "Tipo Stock": c.tipoStock ?? "",
  "Financiera": c.financiera ?? "",
}));

// (e) Base_Saldos_Normalizada
const saldosNormRows = saldosRows.map((r) => ({
  "Cajón": r.Cajon ?? "",
  "Cajón limpio": limpiarCajon(r.Cajon),
  "Marca": r.Marca ?? "",
  "Modelo": r.Modelo ?? "",
  "Cliente": r.Cliente ?? "",
  "Rut Cliente": r["Rut Cliente"] ?? "",
  "N° Nota": r["N° Nota"] ?? "",
  "Número factura": r["Número factura"] ?? "",
  "Sucursal": r.Sucursal ?? "",
  "Vendedor": r.Vendedor ?? "",
  "Estado Venta": r["Estado Venta"] ?? "",
  "Fecha Venta": fmtD(d(r["Fecha Venta"])),
  "Fecha Vencimiento": fmtD(d(r["Fecha de vencimiento"])),
  "Días": r.Días ?? "",
  "Status": r.Status ?? "",
  "E° Pago": r["E°_Pago"] ?? "",
  "Fch Pago": fmtD(d(r["Fch_Pago"])),
  "E° Entrega": r["E°entrega"] ?? "",
  "Entregado": r[" Entregado"] ?? r.Entregado ?? "",
  "Inscrito": r[" Inscrito"] ?? r.Inscrito ?? "",
  "Saldo x Documentar": num(r["Saldo x Documentar"]),
  "Financiera (CLP)": num(r[" Financiera"]),
  "C. Pompeyo (CLP)": num(r[" C.Pompeyo"]),
  "Entidad Financiera": r["Entidad Financiera"] ?? "",
  "Origen": r.Origen ?? "",
  "Tipo": r.Tipo ?? "",
  "Categoría": r.CATEGORIA ?? "",
  "Clasificación Salvin": r["CLASIFICASIÓN SALVIN"] ?? "",
  "Comentarios Finanzas": r["COMENTARIOS FINANZAS"] ?? "",
  "N° Operación": r["N° OPERACIÓN"] ?? "",
}));

// ── 5) Escribir XLSX ────────────────────────────────────────────────────
console.log("[5/5] Escribiendo XLSX …");
const wbOut = XLSX.utils.book_new();
const addSheet = (rows, name) => {
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wbOut, ws, name);
};
addSheet(cruceRows, "Cruce_Saldos_Master");
addSheet(noMatchRows, "Saldos_No_Cruzados");
addSheet([...audit], "Auditoria_Cruce_Saldos");
addSheet(mapaRows, "Mapa_Cajon_a_VIN");
addSheet(saldosNormRows, "Base_Saldos_Normalizada");

mkdirSync(dirname(OUT_PATH), { recursive: true });
XLSX.writeFile(wbOut, OUT_PATH);

console.log(`\n✓ Archivo escrito en:\n  ${OUT_PATH}\n`);
console.log("Resumen final:");
console.log(`  Saldos total                 : ${saldosRows.length}`);
console.log(`  Saldo total CLP              : $${totalSaldoCLP.toLocaleString("es-CL")}`);
console.log(`  ─────────`);
console.log(`  Cruzados a vehículo          : ${totalCruzados} (${(totalCruzados / saldosRows.length * 100).toFixed(1)}%)`);
console.log(`     · saldo asociado          : $${saldoCruzadoVehiculo.toLocaleString("es-CL")} (${(saldoCruzadoVehiculo / totalSaldoCLP * 100).toFixed(1)}%)`);
console.log(`  Saldos admin no-vehiculares  : ${nTotalAdmin}`);
console.log(`     · saldo asociado          : $${saldoAdminTotal.toLocaleString("es-CL")} (${(saldoAdminTotal / totalSaldoCLP * 100).toFixed(1)}%)`);
console.log(`  Sin match                    : ${nNoMatch}`);
console.log(`     · saldo no cruzado        : $${saldoNoCruzado.toLocaleString("es-CL")} (${(saldoNoCruzado / totalSaldoCLP * 100).toFixed(1)}%)`);
