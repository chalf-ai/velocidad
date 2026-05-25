/**
 * VENTAS REALES Q1 (acumulado 3 meses) por marca operacional.
 *
 * Fuente: ventas reales entregadas por el usuario. Viven DENTRO del sistema
 * (no como tabla externa) para alimentar los índices de eficiencia de capital.
 *
 * IMPORTANTE — mensualización:
 * El capital utilizado es una FOTO operacional del momento (viva, mensual). Las
 * ventas son TRIMESTRALES (Q1). Para comparar correctamente capital vs ventas,
 * SIEMPRE se usa la VENTA MENSUAL PROMEDIO = Q1 / 3. Nunca el trimestre directo.
 *
 * Las llaves son la marca operacional canónica (misma que useMarcaFilter /
 * getMarcaOperacional). USADOS combina retail + mayorista, porque el sistema
 * usa un único bucket "USADOS".
 */

export interface VentaQ1 {
  /** Monto vendido en el trimestre Q1 (CLP, neto). */
  montoQ1: number;
  /** Unidades vendidas en el trimestre Q1. */
  unidadesQ1: number;
}

/** Q1 por marca operacional canónica. */
export const VENTAS_Q1: Record<string, VentaQ1> = {
  CITROEN: { montoQ1: 3_036_000_000, unidadesQ1: 193 },
  DFSK: { montoQ1: 4_055_000_000, unidadesQ1: 261 },
  GEELY: { montoQ1: 6_485_000_000, unidadesQ1: 480 },
  "KIA MOTORS": { montoQ1: 12_861_000_000, unidadesQ1: 867 },
  LANDKING: { montoQ1: 833_000_000, unidadesQ1: 53 },
  LEAPMOTOR: { montoQ1: 320_000_000, unidadesQ1: 13 },
  MG: { montoQ1: 9_446_000_000, unidadesQ1: 720 },
  NISSAN: { montoQ1: 4_030_000_000, unidadesQ1: 175 },
  OPEL: { montoQ1: 2_727_000_000, unidadesQ1: 146 },
  PEUGEOT: { montoQ1: 7_357_000_000, unidadesQ1: 319 },
  SUBARU: { montoQ1: 4_189_000_000, unidadesQ1: 164 },
  // USADOS = retail ($9.622B / 754u) + mayorista ($3.228B / 445u)
  USADOS: { montoQ1: 9_622_000_000 + 3_228_000_000, unidadesQ1: 754 + 445 },
};

/** Total Pompeyo Q1 (usado cuando NO hay filtro de marca → "Todas"). */
export const VENTA_Q1_TOTAL: VentaQ1 = { montoQ1: 68_195_000_000, unidadesQ1: 4_590 };

/** Meses del trimestre — para mensualizar. */
export const MESES_TRIMESTRE = 3;

export interface VentaMensual {
  monto: number;
  unidades: number;
}

/**
 * Q1 (trimestre acumulado) para la marca activa del filtro global.
 *   - marca = null → total Pompeyo
 *   - marca con datos → esa marca
 *   - marca sin datos → null
 */
export function ventaQ1De(marca: string | null): VentaQ1 | null {
  return marca == null ? VENTA_Q1_TOTAL : (VENTAS_Q1[marca] ?? null);
}

/**
 * Venta MENSUAL PROMEDIO (Q1 / 3) para la marca activa del filtro global.
 *   - marca = null  → total Pompeyo (vista "Todas las marcas")
 *   - marca con datos → esa marca
 *   - marca sin datos de venta (ej. SUZUKI, OTRAS MARCAS) → null
 */
export function ventaMensualPromedio(marca: string | null): VentaMensual | null {
  const q1 = ventaQ1De(marca);
  if (!q1) return null;
  return {
    monto: q1.montoQ1 / MESES_TRIMESTRE,
    unidades: q1.unidadesQ1 / MESES_TRIMESTRE,
  };
}
