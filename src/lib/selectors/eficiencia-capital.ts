/**
 * SCORE DE EFICIENCIA DE CAPITAL · función pura, explicable.
 *
 * Mide qué tan eficientemente una marca (o el total Pompeyo) convierte su
 * CAPITAL UTILIZADO actual en ventas, usando la VENTA MENSUAL PROMEDIO (Q1/3).
 *
 * Dos lentes DISTINTAS (no son lo mismo):
 *   - Capital / Venta %  →  en PLATA: capital utilizado ($) / venta mensual ($).
 *       "Cuánta caja propia tengo ocupada por cada peso de venta del mes." Menor = mejor.
 *   - MOS (Months of Supply) → en UNIDADES: unidades en stock / venta mensual (uu).
 *       "Cuántos meses de venta tengo en inventario." Menor = mejor.
 *
 * Score eficiencia 0-100 → 100 = óptimo; baja con MOS alto (unidades), aging,
 * FNE detenido, saldos vencidos y provisiones.
 *
 * El capital utilizado NO incluye stock financiado por terceros (solo caja
 * propia comprometida). Lo calcula el Dashboard (ct) y se pasa acá.
 */

export interface EficienciaSenales {
  /** Capital propio comprometido (stock pagado + puente + saldos + bonos + prov). */
  capitalUtilizado: number;
  /** Venta mensual promedio en PLATA (Q1$/3). null si la marca no tiene ventas. */
  ventaMensualMonto: number | null;
  /** Venta mensual promedio en UNIDADES (Q1u/3). null si no hay ventas. */
  ventaMensualUnidades: number | null;
  /** Unidades totales en stock (inventario) del universo filtrado. */
  stockUnidades: number;
  /** Capital inmovilizado >180d / capital utilizado (0-1). */
  agingShare: number;
  /** Valor FNE detenido >15d / valor FNE total (0-1). */
  fneDetenidoShare: number;
  /** Saldos vencidos / saldos totales (0-1). */
  saldosVencidosShare: number;
  /** Provisiones / capital utilizado (0-1). */
  provisionShare: number;
}

export interface EficienciaComponentes {
  /** Penalización aplicada por cada factor (puntos restados al 100). */
  capitalVenta: number;
  mos: number;
  aging: number;
  fne: number;
  saldos: number;
  prov: number;
}

export interface EficienciaCapital {
  capital: number;
  /** Venta mensual promedio en plata. null si no hay ventas para la marca. */
  ventaMensualMonto: number | null;
  /** Venta mensual promedio en unidades. */
  ventaMensualUnidades: number | null;
  stockUnidades: number;
  tieneVenta: boolean;
  /** capital ($) / venta mensual ($) · 100. null si no hay venta en plata. */
  capitalVentaPct: number | null;
  /** unidades stock / venta mensual (uu) → meses. null si no hay venta en uu. */
  mos: number | null;
  /** 0-100. null si no hay venta para calcular. */
  score: number | null;
  componentes: EficienciaComponentes | null;
  /** Bases medidas (0-1) — para el instructivo de cómo se resta el puntaje. */
  bases: {
    agingShare: number;
    fneDetenidoShare: number;
    saldosVencidosShare: number;
    provisionShare: number;
  };
}

/** Pesos máximos de cada penalización del score. Ajustables sin tocar la lógica. */
export const EFICIENCIA_PESOS = {
  capitalVenta: 30, // plata ocupada vs venta (acordado)
  mos: 30, // inventario en unidades
  aging: 30, // antigüedad pesa fuerte (acordado)
  fne: 12,
  saldos: 10,
  prov: 8,
} as const;

/**
 * Capital / Venta % (plata): capital utilizado vs venta mensual.
 *   - ≤ CV_IDEAL (80%)    → verde, 0 penalización
 *   - ≤ CV_CRITICO (100%) → amarillo
 *   - > CV_CRITICO        → rojo; castiga hasta CV_MAXIMO (200%) = completo
 */
export const CV_IDEAL = 80;
export const CV_CRITICO = 100;
export const CV_MAXIMO = 200;

/**
 * MOS escalonado (meses de inventario en unidades):
 *   - ≤ MOS_IDEAL (1.2)    → verde, 0 penalización
 *   - ≤ MOS_CRITICO (1.7)  → amarillo
 *   - > MOS_CRITICO        → rojo; castiga hasta MOS_MAXIMO (4) = completo
 * La penalización del score arranca en MOS_IDEAL y sube lineal hasta MOS_MAXIMO.
 */
export const MOS_IDEAL = 1.2;
export const MOS_CRITICO = 1.7;
export const MOS_MAXIMO = 4;

/** Umbrales de las bases (informativos, para el instructivo). */
export const EFICIENCIA_UMBRALES = {
  agingDias: 180,
  fneDetenidoDias: 15,
  saldosVencidosDias: 90,
} as const;

const clamp01 = (x: number): number => (isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

export function calcularEficienciaCapital(s: EficienciaSenales): EficienciaCapital {
  const capital = s.capitalUtilizado;
  const bases = {
    agingShare: clamp01(s.agingShare),
    fneDetenidoShare: clamp01(s.fneDetenidoShare),
    saldosVencidosShare: clamp01(s.saldosVencidosShare),
    provisionShare: clamp01(s.provisionShare),
  };

  const tieneMonto = !!s.ventaMensualMonto && s.ventaMensualMonto > 0;
  const tieneUnidades = !!s.ventaMensualUnidades && s.ventaMensualUnidades > 0;
  const tieneVenta = tieneMonto && tieneUnidades;

  const capitalVentaPct = tieneMonto ? (capital / (s.ventaMensualMonto as number)) * 100 : null;
  const mos = tieneUnidades ? s.stockUnidades / (s.ventaMensualUnidades as number) : null;

  if (!tieneVenta || mos == null) {
    return {
      capital,
      ventaMensualMonto: s.ventaMensualMonto ?? null,
      ventaMensualUnidades: s.ventaMensualUnidades ?? null,
      stockUnidades: s.stockUnidades,
      tieneVenta: false,
      capitalVentaPct,
      mos,
      score: null,
      componentes: null,
      bases,
    };
  }

  // Capital/Venta (plata): 0 hasta CV_IDEAL (80%), sube lineal hasta CV_MAXIMO.
  const pCapVenta =
    capitalVentaPct != null
      ? clamp01((capitalVentaPct - CV_IDEAL) / (CV_MAXIMO - CV_IDEAL)) *
        EFICIENCIA_PESOS.capitalVenta
      : 0;
  // MOS escalonado: 0 hasta el ideal (1.2); de ahí sube lineal hasta MOS_MAXIMO.
  const pMos =
    clamp01((mos - MOS_IDEAL) / (MOS_MAXIMO - MOS_IDEAL)) * EFICIENCIA_PESOS.mos;
  const pAging = bases.agingShare * EFICIENCIA_PESOS.aging;
  const pFne = bases.fneDetenidoShare * EFICIENCIA_PESOS.fne;
  const pSaldos = bases.saldosVencidosShare * EFICIENCIA_PESOS.saldos;
  const pProv = bases.provisionShare * EFICIENCIA_PESOS.prov;

  const score = Math.round(
    Math.max(0, Math.min(100, 100 - pCapVenta - pMos - pAging - pFne - pSaldos - pProv)),
  );

  return {
    capital,
    ventaMensualMonto: s.ventaMensualMonto as number,
    ventaMensualUnidades: s.ventaMensualUnidades as number,
    stockUnidades: s.stockUnidades,
    tieneVenta: true,
    capitalVentaPct,
    mos,
    score,
    componentes: {
      capitalVenta: pCapVenta,
      mos: pMos,
      aging: pAging,
      fne: pFne,
      saldos: pSaldos,
      prov: pProv,
    },
    bases,
  };
}
