/**
 * Selector primitivo: detectar Crédito Pompeyo por VIN.
 *
 * REGLA DE NEGOCIO:
 * Crédito Pompeyo cubre diferencias antes del cierre correcto. Si un VIN
 * tiene Crédito Pompeyo > 0, NO está listo para entrega — financieramente
 * bloqueado. Otros tipos de saldo (financiera externa, leasing, banco) NO
 * bloquean la entrega — ya están comprometidos con un tercero.
 *
 * Detección (unión para ser conservadores):
 *   - Algún saldo con cPompeyoCLP > 0 ASIGNADO a este VIN
 *   - O algún saldo con subTipo === "credito_pompeyo" para este VIN
 */

import type { SaldoCruzado, SaldoRegistro } from "../types";

export interface CreditoPompeyoVIN {
  vinLimpio: string;
  /** Suma de cPompeyoCLP de todos los saldos asignados al VIN. */
  monto: number;
  /** Saldos individuales que aportan al crédito Pompeyo. */
  saldos: SaldoRegistro[];
}

/** Construye un Map VIN → info de Crédito Pompeyo. Pasa solo los saldos cruzados
 *  (los que tienen vinResuelto). */
export function calcularCreditoPompeyoPorVIN(
  saldosCruzados: SaldoCruzado[],
): Map<string, CreditoPompeyoVIN> {
  const map = new Map<string, CreditoPompeyoVIN>();
  for (const c of saldosCruzados) {
    const s = c.saldo;
    const vin = s.vinResuelto;
    if (!vin) continue;
    if (s.cPompeyoCLP <= 0 && s.subTipo !== "credito_pompeyo") continue;
    if (!map.has(vin)) map.set(vin, { vinLimpio: vin, monto: 0, saldos: [] });
    const e = map.get(vin)!;
    e.monto += s.cPompeyoCLP;
    e.saldos.push(s);
  }
  return map;
}

/** Lookup helper. */
export function tieneCreditoPompeyo(
  vin: string | null | undefined,
  map: Map<string, CreditoPompeyoVIN>,
): boolean {
  return !!(vin && map.has(vin));
}

/** Crédito Pompeyo de saldos que NO cruzaron VIN — alerta crítica:
 *  hay plata identificada como Crédito Pompeyo pero no sabemos a qué auto. */
export function creditoPompeyoSinVIN(saldosCruzados: SaldoCruzado[]): SaldoRegistro[] {
  return saldosCruzados
    .filter((c) => {
      const s = c.saldo;
      if (s.vinResuelto) return false;
      return s.cPompeyoCLP > 0 || s.subTipo === "credito_pompeyo";
    })
    .map((c) => c.saldo);
}
