/**
 * Pesos del motor de score · ajustables sin tocar la lógica.
 *
 * Cada factor aporta puntos a un componente del score:
 *   - financiero (max 25)
 *   - aging      (max 25)
 *   - operacional(max 25)
 *   - caja       (max 15)
 *   - riesgo     (max 10)
 *
 * Total: max 100. Severidad por tramos al final.
 */

export const SCORE_CONFIG = {
  // === AGING ===
  aging: {
    /** Días desde factura FNE o días stock, lo que sea más alto */
    bucket180: 25,    // >180 días → crítico
    bucket91_180: 15, // 91-180
    bucket61_90: 8,   // 61-90
    bucket31_60: 4,   // 31-60
  },

  // === FINANCIERO ===
  financiero: {
    creditoPompeyoActivo: 20,
    sobregiroLineaMarca: 10,
    lineaProximaAVencer: 8,    // <30 días
    provisionMarcaAlta: 4,     // capital de provisiones de la marca > X
  },

  // === OPERACIONAL ===
  operacional: {
    fneDetenidoMas15d: 15,
    fneListoRetenidoMas3d: 12, // tiene los 3 Si pero no se entrega
    sinSolicitudComercial: 8,
    faltaPatenteMas30d: 10,
    vuPuenteEnvejecidoMas60d: 10,
    autoNoEnSucursal: 5,
  },

  // === CAJA (capital comprometido) ===
  caja: {
    capitalMayor30M: 10,
    capital10a30M: 6,
    capital5a10M: 3,
    stockPagadoMas180d: 12,
    tescarMas180d: 12,
  },

  // === RIESGO ===
  riesgo: {
    judicial: 20,
  },

  // === SEVERIDAD POR TRAMOS ===
  severidad: {
    critica: 80,
    alta: 60,
    media: 30,
  },
} as const;

export const COMPONENTES_LABEL = {
  financiero: "Financiero",
  aging: "Aging",
  operacional: "Operacional",
  caja: "Caja comprometida",
  riesgo: "Riesgo",
} as const;
