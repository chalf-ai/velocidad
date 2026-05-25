/**
 * Selector del módulo FNE — Facturados No Entregados.
 *
 * Estado operacional propio: vehículos con venta firmada/aprobada pero
 * todavía en stock (no entregados). Consume capital de trabajo.
 *
 * Detección en Base_Stock (Excel mayo 2026):
 *   Estado AutoPro = "Vendido" Y Status Stock ∈ {"Vigente", "Aprobada"}
 *
 * Aging — el Excel actual tiene "Fecha Facturación" 100% vacía, usamos
 * "Fecha Venta" como proxy y lo marcamos en agingFuente="venta".
 */

import type {
  AgingFNE,
  Alerta,
  EnSucursalVenta,
  FacturadoNoEntregado,
  FNEStats,
  Vehiculo,
} from "../types";
import { sucursalCoincideConBodega } from "../parser/normalize";

function agingBucket(dias: number | null): AgingFNE {
  if (dias === null || !Number.isFinite(dias)) return "sin_fecha";
  if (dias <= 3) return "0-3";
  if (dias <= 7) return "4-7";
  if (dias <= 15) return "8-15";
  return "16+";
}

function diasEntre(desde: Date | null, hasta: Date): number | null {
  if (!desde) return null;
  return Math.floor((hasta.getTime() - desde.getTime()) / (1000 * 60 * 60 * 24));
}

export function esFNE(v: Vehiculo): boolean {
  // Heurística: Estado AutoPro = Vendido + Status Stock activo (Vigente o Aprobada)
  // En el Excel actual: 478 (Vigente) + 29 (Aprobada) + 12 (En Stock) = 519 candidatos
  // Pero Vendido × En Stock parece ruido; nos quedamos con la combinación firme.
  if (v.estadoAutoPro !== "Vendido") return false;
  return v.statusStock === "Vigente" || v.statusStock === "Aprobada";
}

export function detectarFNE(vehiculos: Vehiculo[], hoy: Date = new Date()): FacturadoNoEntregado[] {
  return vehiculos.filter(esFNE).map<FacturadoNoEntregado>((v) => {
    const diasVenta = diasEntre(v.fechaVenta, hoy);
    const diasFact = diasEntre(null, hoy); // sin Fecha Facturación en este Excel

    const agingFuente: FacturadoNoEntregado["agingFuente"] = diasFact !== null
      ? "facturacion"
      : diasVenta !== null
        ? "venta"
        : "ninguna";
    const dias = diasFact ?? diasVenta;

    const enSucursalVenta: EnSucursalVenta = sucursalCoincideConBodega(v.sucursal, v.bodega);

    const folioRetomaAsociado = v.folioRetoma;
    const conVPP = folioRetomaAsociado !== null;

    return {
      vin: v.vin,
      marca: v.marca,
      marcaPompeyo: v.marcaPompeyo,
      modelo: v.modelo,
      version: v.version,
      color: v.color,
      anio: v.anio,

      sucursal: v.sucursal,
      bodega: v.bodega,
      enSucursalVenta,

      folioVenta: v.folioVenta,
      vendedor: v.vendedor,
      cliente: null, // no existe columna en Base_Stock; Fase 2 desde "Venta APC Fact VN"
      fechaVenta: v.fechaVenta,
      fechaFacturacion: null, // columna vacía en este Excel

      diasDesdeVenta: diasVenta,
      diasDesdeFacturacion: diasFact,
      agingBucket: agingBucket(dias),
      agingFuente,

      conVPP,
      folioRetomaAsociado,

      costoNeto: v.costoNeto,
      precioVentaTotal: v.precioVentaTotal,
      tipoStock: v.tipoStock,

      estadoOperacional: `${v.estadoAutoPro ?? "?"} / ${v.statusStock ?? "?"}`,

      patente: v.patente,
      inscrito: v.inscrito,
      fechaInscripcion: v.fechaInscripcion,
      estadoInscripcion: v.estadoInscripcion,
      fechaEntregaFinal: v.fechaEntregaFinal,

      rowIndex: v.rowIndex,
    };
  });
}

export function statsFNE(fnes: FacturadoNoEntregado[]): FNEStats {
  const porAging: Record<AgingFNE, number> = {
    "0-3": 0,
    "4-7": 0,
    "8-15": 0,
    "16+": 0,
    sin_fecha: 0,
  };

  const porTipoStock: FNEStats["porTipoStock"] = {
    floorPlan: { unidades: 0, capital: 0 },
    propio: { unidades: 0, capital: 0 },
    financiado: { unidades: 0, capital: 0 },
    finPropio: { unidades: 0, capital: 0 },
    vuPorRecibir: { unidades: 0, capital: 0 },
    desconocido: { unidades: 0, capital: 0 },
  };

  let valorTotal = 0;
  let conVPP = 0;
  let valorConVPP = 0;
  let mas7d = 0;
  let mas15d = 0;
  let fueraDeSucursal = 0;
  let porValidar = 0;
  let sinBodega = 0;
  let sinFechaAging = 0;

  for (const f of fnes) {
    porAging[f.agingBucket]++;
    valorTotal += f.costoNeto;
    if (f.conVPP) {
      conVPP++;
      valorConVPP += f.costoNeto;
    }
    const d = f.diasDesdeFacturacion ?? f.diasDesdeVenta;
    if (d !== null) {
      if (d > 7) mas7d++;
      if (d > 15) mas15d++;
    } else {
      sinFechaAging++;
    }
    if (f.enSucursalVenta === "no") fueraDeSucursal++;
    if (f.enSucursalVenta === "por_validar") porValidar++;
    if (!f.bodega) sinBodega++;

    // Dimensión financiera — dónde vive el capital de este FNE
    const bucket =
      f.tipoStock === "FloorPlan" ? porTipoStock.floorPlan
        : f.tipoStock === "Propio" ? porTipoStock.propio
          : f.tipoStock === "Financiado" ? porTipoStock.financiado
            : f.tipoStock === "FinPropio" ? porTipoStock.finPropio
              : f.tipoStock === "VuPorRecibir" ? porTipoStock.vuPorRecibir
                : porTipoStock.desconocido;
    bucket.unidades++;
    bucket.capital += f.costoNeto;
  }

  // Campos del Excel que necesitamos para tener cobertura completa
  const camposFaltantes: FNEStats["camposFaltantes"] = [];
  const conFechaFact = fnes.filter((f) => f.fechaFacturacion !== null).length;
  const conCliente = fnes.filter((f) => f.cliente !== null).length;

  if (conFechaFact === 0 && fnes.length > 0) {
    camposFaltantes.push({
      nombre: "Fecha Facturación",
      descripcion: "Columna existe en Base_Stock pero viene 100% vacía. Sin ella el aging real arranca desde 'Fecha Venta' (proxy).",
      impacto: "alto",
    });
  }
  if (conCliente === 0 && fnes.length > 0) {
    camposFaltantes.push({
      nombre: "Cliente",
      descripcion: "Base_Stock no tiene columna Cliente. Fase 2: cruzar con 'Venta APC Fact VN' por Folio Venta.",
      impacto: "medio",
    });
  }
  camposFaltantes.push({
    nombre: "Fecha Entrega",
    descripcion: "No existe columna de entrega real en Base_Stock. Sin ella no se puede medir 'días pendiente entrega' exacto.",
    impacto: "alto",
  });
  camposFaltantes.push({
    nombre: "Fecha Ingreso Sucursal Venta",
    descripcion: "No existe. Sin ella no se puede medir 'días en sucursal'.",
    impacto: "medio",
  });
  camposFaltantes.push({
    nombre: "Indicador VPP explícito",
    descripcion: "Hoy se infiere de Folio Retoma ≠ 0. Un flag explícito reduciría ambigüedad.",
    impacto: "bajo",
  });

  return {
    total: fnes.length,
    totalUnidades: fnes.length,
    valorTotal,
    conVPP,
    valorConVPP,
    pctConVPP: fnes.length > 0 ? conVPP / fnes.length : 0,
    mas7d,
    mas15d,
    fueraDeSucursal,
    porValidar,
    sinBodega,
    sinFechaAging,
    porAging,
    porTipoStock,
    camposFaltantes,
  };
}

export function alertasFNE(fnes: FacturadoNoEntregado[]): Alerta[] {
  const out: Alerta[] = [];
  let id = 0;
  const next = () => `fne${++id}`;

  for (const f of fnes) {
    const dias = f.diasDesdeFacturacion ?? f.diasDesdeVenta;

    if (dias !== null && dias > 15) {
      out.push({
        id: next(),
        severidad: "critica",
        tipo: "fne_mas_15d",
        titulo: `FNE > 15 días`,
        detalle: `${f.marcaPompeyo} ${f.modelo ?? ""} · ${dias} días desde ${f.agingFuente === "venta" ? "venta" : "facturación"} · folio ${f.folioVenta ?? "—"}`,
        vin: f.vin,
        marca: f.marcaPompeyo,
        valorImpacto: f.costoNeto,
        origen: `Base_Stock:r${f.rowIndex}`,
      });
    } else if (dias !== null && dias > 7) {
      out.push({
        id: next(),
        severidad: "alta",
        tipo: "fne_mas_7d",
        titulo: `FNE > 7 días`,
        detalle: `${f.marcaPompeyo} ${f.modelo ?? ""} · ${dias} días`,
        vin: f.vin,
        marca: f.marcaPompeyo,
        valorImpacto: f.costoNeto,
        origen: `Base_Stock:r${f.rowIndex}`,
      });
    }

    if (f.conVPP) {
      out.push({
        id: next(),
        severidad: "alta",
        tipo: "fne_con_vpp",
        titulo: `FNE con VU asociado comprometido`,
        detalle: `${f.marcaPompeyo} ${f.modelo ?? ""} · folio retoma ${f.folioRetomaAsociado} · capital puente vinculado`,
        vin: f.vin,
        marca: f.marcaPompeyo,
        valorImpacto: f.costoNeto,
        origen: `Base_Stock:r${f.rowIndex}`,
      });
    }

    if (f.enSucursalVenta === "no") {
      out.push({
        id: next(),
        severidad: "media",
        tipo: "fne_fuera_sucursal",
        titulo: `FNE fuera de sucursal de venta`,
        detalle: `Vendido en ${f.sucursal} · está en bodega ${f.bodega}`,
        vin: f.vin,
        marca: f.marcaPompeyo,
        origen: `Base_Stock:r${f.rowIndex}`,
      });
    }

    if (!f.bodega) {
      out.push({
        id: next(),
        severidad: "media",
        tipo: "fne_sin_bodega",
        titulo: `FNE sin bodega informada`,
        detalle: `${f.marcaPompeyo} ${f.modelo ?? ""} · sucursal ${f.sucursal ?? "—"}`,
        vin: f.vin,
        marca: f.marcaPompeyo,
        origen: `Base_Stock:r${f.rowIndex}`,
      });
    }

    if (f.agingFuente === "ninguna") {
      out.push({
        id: next(),
        severidad: "media",
        tipo: "fne_sin_fecha",
        titulo: `FNE sin fecha para medir aging`,
        detalle: `${f.marcaPompeyo} ${f.modelo ?? ""} · sin Fecha Venta ni Fecha Facturación`,
        vin: f.vin,
        marca: f.marcaPompeyo,
        origen: `Base_Stock:r${f.rowIndex}`,
      });
    }
  }

  return out;
}
