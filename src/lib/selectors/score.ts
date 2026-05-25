/**
 * Motor de score por VIN · función pura, totalmente explicable.
 *
 * Cada factor que dispara aporta puntos a un componente y deja una entrada
 * en `razones[]` con la razón textual. El usuario puede ver POR QUÉ un VIN
 * es crítico, no solo cuánto puntúa.
 */

import { SCORE_CONFIG } from "./score-config";
import type { VehiculoUnificado } from "./vehiculo-unificado";

export type Severidad = "info" | "media" | "alta" | "critica";

export interface RazonScore {
  factor: string;
  componente: "financiero" | "aging" | "operacional" | "caja" | "riesgo";
  puntos: number;
  descripcion: string;
}

export interface ScoreVIN {
  total: number;
  severidad: Severidad;
  componentes: {
    financiero: number;
    aging: number;
    operacional: number;
    caja: number;
    riesgo: number;
  };
  razones: RazonScore[];
  accionSugerida: string;
}

function maxAgingDias(vu: VehiculoUnificado): number {
  // Tomamos el mayor de los aging disponibles para no subestimar
  const candidatos: number[] = [];
  if (vu.fneDiasFactura !== null) candidatos.push(vu.fneDiasFactura);
  if (vu.fneDiasEnEstado !== null) candidatos.push(vu.fneDiasEnEstado);
  if (vu.diasStock !== null) candidatos.push(vu.diasStock);
  if (vu.diasTescar !== null) candidatos.push(vu.diasTescar);
  return candidatos.length > 0 ? Math.max(...candidatos) : 0;
}

export function calcularScore(vu: VehiculoUnificado): ScoreVIN {
  const C = SCORE_CONFIG;
  const razones: RazonScore[] = [];
  let financiero = 0;
  let aging = 0;
  let operacional = 0;
  let caja = 0;
  let riesgo = 0;

  // === AGING ===
  const dias = maxAgingDias(vu);
  if (dias > 180) {
    aging += C.aging.bucket180;
    razones.push({
      factor: "aging_180",
      componente: "aging",
      puntos: C.aging.bucket180,
      descripcion: `+${C.aging.bucket180} Aging >180d (${dias} días)`,
    });
  } else if (dias > 90) {
    aging += C.aging.bucket91_180;
    razones.push({
      factor: "aging_91_180",
      componente: "aging",
      puntos: C.aging.bucket91_180,
      descripcion: `+${C.aging.bucket91_180} Aging 91-180d (${dias} días)`,
    });
  } else if (dias > 60) {
    aging += C.aging.bucket61_90;
    razones.push({
      factor: "aging_61_90",
      componente: "aging",
      puntos: C.aging.bucket61_90,
      descripcion: `+${C.aging.bucket61_90} Aging 61-90d (${dias} días)`,
    });
  } else if (dias > 30) {
    aging += C.aging.bucket31_60;
    razones.push({
      factor: "aging_31_60",
      componente: "aging",
      puntos: C.aging.bucket31_60,
      descripcion: `+${C.aging.bucket31_60} Aging 31-60d (${dias} días)`,
    });
  }

  // === FINANCIERO ===
  if (vu.creditoPompeyo > 0) {
    financiero += C.financiero.creditoPompeyoActivo;
    razones.push({
      factor: "credito_pompeyo",
      componente: "financiero",
      puntos: C.financiero.creditoPompeyoActivo,
      descripcion: `+${C.financiero.creditoPompeyoActivo} Crédito Pompeyo activo ($${vu.creditoPompeyo.toLocaleString("es-CL")})`,
    });
  }
  if (vu.lineaSobregirada) {
    financiero += C.financiero.sobregiroLineaMarca;
    razones.push({
      factor: "sobregiro_linea",
      componente: "financiero",
      puntos: C.financiero.sobregiroLineaMarca,
      descripcion: `+${C.financiero.sobregiroLineaMarca} Marca con sobregiro de línea (${vu.marcaLineaVinculada ?? vu.marca})`,
    });
  }
  if (vu.lineaDiasParaVencer !== null && vu.lineaDiasParaVencer >= 0 && vu.lineaDiasParaVencer < 30) {
    financiero += C.financiero.lineaProximaAVencer;
    razones.push({
      factor: "linea_proxima_vencer",
      componente: "financiero",
      puntos: C.financiero.lineaProximaAVencer,
      descripcion: `+${C.financiero.lineaProximaAVencer} Línea de marca vence en ${vu.lineaDiasParaVencer} días`,
    });
  }

  // === OPERACIONAL ===
  if (vu.enFNE) {
    const fneEnEstado = vu.fneDiasEnEstado ?? 0;
    // FNE detenido más de 15 días (no listo aún)
    if (vu.fneEstado !== "listo_para_entregar" && fneEnEstado > 15) {
      operacional += C.operacional.fneDetenidoMas15d;
      razones.push({
        factor: "fne_detenido_15d",
        componente: "operacional",
        puntos: C.operacional.fneDetenidoMas15d,
        descripcion: `+${C.operacional.fneDetenidoMas15d} FNE detenido en "${vu.fneEstado}" ${fneEnEstado} días`,
      });
    }
    // FNE listo retenido: tiene los 3 Si pero el auto no se va
    if (vu.fneEstado === "listo_para_entregar" && fneEnEstado > 3) {
      operacional += C.operacional.fneListoRetenidoMas3d;
      razones.push({
        factor: "fne_listo_retenido",
        componente: "operacional",
        puntos: C.operacional.fneListoRetenidoMas3d,
        descripcion: `+${C.operacional.fneListoRetenidoMas3d} FNE listo retenido ${fneEnEstado} días (cliente no retira)`,
      });
    }
    // Sin solicitud comercial
    if (vu.fneEstado === "sin_solicitud_inscripcion") {
      operacional += C.operacional.sinSolicitudComercial;
      razones.push({
        factor: "sin_solicitud_comercial",
        componente: "operacional",
        puntos: C.operacional.sinSolicitudComercial,
        descripcion: `+${C.operacional.sinSolicitudComercial} Sin solicitud comercial — sucursal no ha pedido inscripción`,
      });
    }
    // Auto no en sucursal
    if (vu.fneAutoEnSucursal === "no") {
      operacional += C.operacional.autoNoEnSucursal;
      razones.push({
        factor: "auto_no_en_sucursal",
        componente: "operacional",
        puntos: C.operacional.autoNoEnSucursal,
        descripcion: `+${C.operacional.autoNoEnSucursal} Auto físicamente NO está en sucursal de venta`,
      });
    }
    // Falta patente >30d (cualquier estado que no sea con patente en sucursal)
    const enProcesoPatente =
      vu.fneEstado === "patente_en_transito" ||
      vu.fneEstado === "patente_en_admin" ||
      vu.fneEstado === "inscrita_sin_admin" ||
      vu.fneEstado === "en_registro_civil" ||
      vu.fneEstado === "en_control_negocios";
    if (enProcesoPatente && fneEnEstado > 30) {
      operacional += C.operacional.faltaPatenteMas30d;
      razones.push({
        factor: "patente_30d",
        componente: "operacional",
        puntos: C.operacional.faltaPatenteMas30d,
        descripcion: `+${C.operacional.faltaPatenteMas30d} Proceso de patente lleva ${fneEnEstado} días sin avanzar`,
      });
    }
  }
  if (vu.esVPP && (vu.diasVPP ?? 0) > 60) {
    operacional += C.operacional.vuPuenteEnvejecidoMas60d;
    razones.push({
      factor: "vu_puente_envejecido",
      componente: "operacional",
      puntos: C.operacional.vuPuenteEnvejecidoMas60d,
      descripcion: `+${C.operacional.vuPuenteEnvejecidoMas60d} VU en parte de pago envejecido (${vu.diasVPP}d)`,
    });
  }

  // === CAJA ===
  const cap = vu.capitalComprometido;
  if (cap > 30_000_000) {
    caja += C.caja.capitalMayor30M;
    razones.push({
      factor: "capital_30M",
      componente: "caja",
      puntos: C.caja.capitalMayor30M,
      descripcion: `+${C.caja.capitalMayor30M} Capital comprometido >$30M ($${(cap / 1_000_000).toFixed(1)}M)`,
    });
  } else if (cap > 10_000_000) {
    caja += C.caja.capital10a30M;
    razones.push({
      factor: "capital_10_30M",
      componente: "caja",
      puntos: C.caja.capital10a30M,
      descripcion: `+${C.caja.capital10a30M} Capital comprometido $10-30M ($${(cap / 1_000_000).toFixed(1)}M)`,
    });
  } else if (cap > 5_000_000) {
    caja += C.caja.capital5a10M;
    razones.push({
      factor: "capital_5_10M",
      componente: "caja",
      puntos: C.caja.capital5a10M,
      descripcion: `+${C.caja.capital5a10M} Capital comprometido $5-10M ($${(cap / 1_000_000).toFixed(1)}M)`,
    });
  }
  if (vu.esStockPagadoViejo) {
    caja += C.caja.stockPagadoMas180d;
    razones.push({
      factor: "stock_pagado_180d",
      componente: "caja",
      puntos: C.caja.stockPagadoMas180d,
      descripcion: `+${C.caja.stockPagadoMas180d} Stock pagado (caja propia) +180d sin rotar`,
    });
  }
  if (vu.esTescar && (vu.diasTescar ?? 0) > 180) {
    caja += C.caja.tescarMas180d;
    razones.push({
      factor: "tescar_180d",
      componente: "caja",
      puntos: C.caja.tescarMas180d,
      descripcion: `+${C.caja.tescarMas180d} TESCAR envejecido +180d (${vu.diasTescar}d)`,
    });
  }

  // === RIESGO ===
  if (vu.esJudicial) {
    riesgo += C.riesgo.judicial;
    razones.push({
      factor: "judicial",
      componente: "riesgo",
      puntos: C.riesgo.judicial,
      descripcion: `+${C.riesgo.judicial} Stock judicial — situación legal especial`,
    });
  }

  // Caps por componente (no permitir sobre-puntaje)
  financiero = Math.min(financiero, 25);
  aging = Math.min(aging, 25);
  operacional = Math.min(operacional, 25);
  caja = Math.min(caja, 15);
  riesgo = Math.min(riesgo, 10);

  const total = Math.min(100, financiero + aging + operacional + caja + riesgo);
  const severidad = sevDe(total);

  return {
    total,
    severidad,
    componentes: { financiero, aging, operacional, caja, riesgo },
    razones: razones.sort((a, b) => b.puntos - a.puntos),
    accionSugerida: deriveAccion(vu, razones),
  };
}

function sevDe(total: number): Severidad {
  const C = SCORE_CONFIG.severidad;
  if (total >= C.critica) return "critica";
  if (total >= C.alta) return "alta";
  if (total >= C.media) return "media";
  return "info";
}

/** Acción concreta sugerida basada en la razón de mayor peso. */
function deriveAccion(vu: VehiculoUnificado, razones: RazonScore[]): string {
  if (razones.length === 0) return "Sin acción inmediata";
  const top = razones[0];
  switch (top.factor) {
    case "credito_pompeyo":
      return "Cobrar diferencia al cliente";
    case "judicial":
      return "Consultar área legal";
    case "sobregiro_linea":
      return `Liberar línea ${vu.marcaLineaVinculada} (facturar o pagar)`;
    case "linea_proxima_vencer":
      return "Renovar/refinanciar línea de la marca";
    case "fne_detenido_15d":
      // Acción depende del estado
      switch (vu.fneEstado) {
        case "patente_en_sucursal":
          return "Tramitar solicitud de entrega";
        case "falta_solo_autorizacion":
          return "Firmar autorización de entrega";
        case "patente_en_transito":
          return "Confirmar recepción de patente en sucursal";
        case "patente_en_admin":
          return "Admin debe enviar patente a sucursal";
        case "inscrita_sin_admin":
          return "Seguir recepción de patente desde Registro Civil";
        case "en_registro_civil":
          return "Seguimiento Registro Civil";
        case "en_control_negocios":
          return "Control de Negocios debe enviar a RC";
        default:
          return "Acelerar gestión FNE";
      }
    case "fne_listo_retenido":
      return "Llamar cliente para coordinar retiro";
    case "sin_solicitud_comercial":
      return "Sucursal debe solicitar inscripción";
    case "auto_no_en_sucursal":
      return "Solicitar traslado a logística";
    case "patente_30d":
      return "Escalar trámite de patente";
    case "stock_pagado_180d":
      return "Acelerar rotación de stock pagado";
    case "tescar_180d":
      return "Evaluar venta del TESCAR";
    case "vu_puente_envejecido":
      return "Cerrar/liquidar el VU recibido";
    case "aging_180":
    case "aging_91_180":
      return "Revisar bloqueos · escalar caso";
    case "capital_30M":
      return "Caso de alto impacto · priorizar resolución";
    default:
      return "Revisar caso";
  }
}

export const SEVERIDAD_LABEL: Record<Severidad, string> = {
  critica: "Crítica",
  alta: "Alta",
  media: "Media",
  info: "Info",
};

export const SEVERIDAD_TONE: Record<Severidad, "danger" | "warning" | "info" | "muted"> = {
  critica: "danger",
  alta: "danger",
  media: "warning",
  info: "muted",
};
