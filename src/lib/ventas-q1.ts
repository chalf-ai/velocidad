/**
 * VENTAS PONDERADAS por marca operacional · base de eficiencia.
 *
 * Decisión usuario 2026-06 — recalibración Velocity OS:
 * dejamos de usar el promedio simple Q1/3 (que trataba los tres meses por
 * igual y enmascaraba a las marcas en escalada o en caída) y pasamos a una
 * ventana ponderada con pesos N-1 50% / N-2 30% / N-3 20%. Se actualiza
 * cada cierre mensual.
 *
 *   Ejemplo (cierre junio 2026 → ventana N-1..N-3 = mayo·abril·marzo):
 *     ventaPond_KIA = 0.5·may + 0.3·abr + 0.2·mar
 *
 * El cambio NO toca la lógica del Score Gerencial:
 *   · Stock propio ≤ 5% (peso 40%)
 *   · Provisiones >90d (peso 30%)
 *   · Crédito Pompeyo >15d (peso 20%)
 *   · Saldos T3+ (peso 10%)
 *   · Excepción USADOS: Stock B y Judicial fuera del indicador Stock propio.
 *
 * La venta ponderada es la BASE de cálculo del denominador (MOS, Capital/
 * Venta, Velocity OS, benchmarks, capacidad de absorción). La META del 5%
 * y la lógica de score se mantienen idénticas.
 *
 * IMPORTANTE — mensualización:
 * `ventaMensualPromedio()` mantuvo su nombre por compatibilidad pero ahora
 * devuelve los valores PONDERADOS directamente (no es un promedio simple).
 *
 * USADOS combina retail + mayorista en un único bucket — la categoría
 * MAYORISTA es operacionalmente una sub-categoría de USADOS (ver
 * `usados-operacional.ts` · USADOS_MAYORISTA).
 *
 * Marcas sin datos en N-1/N-2/N-3 (ej. SUZUKI, OTRAS MARCAS) devuelven
 * `null` y los selectores manejan el caso "sin venta para calcular".
 */

export interface VentaMensual {
  monto: number;
  unidades: number;
}

/** Pesos oficiales de la ventana — referencia documental. */
export const PESOS_PONDERACION = { n1: 0.5, n2: 0.3, n3: 0.2 } as const;

/** Etiqueta humana de la ventana usada (para tooltips/notas). */
export const VENTANA_PONDERACION_LABEL = "N-1 50% · N-2 30% · N-3 20%";

/** Meses concretos usados en la ventana actual — solo para mostrar. */
export const VENTANA_PONDERACION_MESES = "may·abr·mar 2026";

/**
 * Venta MENSUAL PONDERADA por marca operacional canónica.
 *
 * Cálculo: 0.5·mayo2026 + 0.3·abril2026 + 0.2·marzo2026.
 * USADOS combina retail + mayorista (decisión 2026-06).
 *
 * Cuando se actualice el corte (cierre del próximo mes), se reemplazan
 * estos valores con la nueva ventana móvil.
 */
export const VENTAS_PONDERADAS: Record<string, VentaMensual> = {
  CITROEN:      { monto: 1_038_318_268, unidades: 65 },
  DFSK:         { monto: 1_336_460_946, unidades: 81 },
  GEELY:        { monto: 2_363_170_701, unidades: 170 },
  "KIA MOTORS": { monto: 4_727_222_036, unidades: 321 },
  LANDKING:     { monto:   448_757_416, unidades: 31 },
  LEAPMOTOR:    { monto:   306_920_962, unidades: 14 },
  MG:           { monto: 3_286_600_049, unidades: 231 },
  NISSAN:       { monto:   710_414_058, unidades: 27 },
  OPEL:         { monto:   792_105_202, unidades: 42 },
  PEUGEOT:      { monto: 2_836_747_106, unidades: 125 },
  SUBARU:       { monto: 1_511_753_946, unidades: 61 },
  // USADOS = retail (290u / $3.365M mayo) + mayorista (183u / $1.330M mayo)
  USADOS:       { monto: 4_445_065_013, unidades: 436 },
};

/** Total Pompeyo (suma directa de marcas) — vista "Todas las marcas". */
export const VENTA_PONDERADA_TOTAL: VentaMensual = (() => {
  let monto = 0;
  let unidades = 0;
  for (const v of Object.values(VENTAS_PONDERADAS)) {
    monto += v.monto;
    unidades += v.unidades;
  }
  return { monto, unidades };
})();

/**
 * Venta MENSUAL PONDERADA para la marca activa del filtro global.
 *   - marca = null  → total Pompeyo (vista "Todas las marcas")
 *   - marca con datos → esa marca (ponderada)
 *   - marca sin datos → null (selectores manejan el caso)
 *
 * Nombre "Promedio" preservado por compatibilidad; el cálculo es ponderado.
 */
export function ventaMensualPromedio(marca: string | null): VentaMensual | null {
  if (marca == null) return VENTA_PONDERADA_TOTAL;
  return VENTAS_PONDERADAS[marca] ?? null;
}

// ─── COMPATIBILIDAD LEGACY ────────────────────────────────────────────────
// Antes la fuente eran ventas TRIMESTRALES Q1 (`montoQ1 / unidadesQ1`).
// Algunos consumidores siguen referenciando esa forma (campo `ventaQ1Monto`
// en el dashboard de usados, etc.). Mantenemos las firmas devolviendo
// "ponderado × 3" para que el bucket de salida no se rompa. Semánticamente
// ya no representa "el trimestre real", sino "3 × ventaPond" — cuando se
// migre el último consumer, este shim puede borrarse.

/** @deprecated Usar `VentaMensual` (ya mensualizado). Se mantiene por compat. */
export interface VentaQ1 {
  montoQ1: number;
  unidadesQ1: number;
}

/** @deprecated Era `Q1/3`. Hoy `VentaPonderada × 3`. Solo para consumers viejos. */
export const MESES_TRIMESTRE = 3;

/** @deprecated Derivado de VENTAS_PONDERADAS × 3. Solo para consumers viejos. */
export const VENTAS_Q1: Record<string, VentaQ1> = Object.fromEntries(
  Object.entries(VENTAS_PONDERADAS).map(([k, v]) => [
    k,
    { montoQ1: v.monto * 3, unidadesQ1: Math.round(v.unidades * 3) },
  ]),
);

/** @deprecated Total Pompeyo Q1 (= total ponderado × 3). */
export const VENTA_Q1_TOTAL: VentaQ1 = {
  montoQ1: VENTA_PONDERADA_TOTAL.monto * 3,
  unidadesQ1: Math.round(VENTA_PONDERADA_TOTAL.unidades * 3),
};

/** @deprecated Devuelve "ventaPond × 3". Preferir `ventaMensualPromedio`. */
export function ventaQ1De(marca: string | null): VentaQ1 | null {
  const v = ventaMensualPromedio(marca);
  if (!v) return null;
  return { montoQ1: v.monto * MESES_TRIMESTRE, unidadesQ1: Math.round(v.unidades * MESES_TRIMESTRE) };
}
