/**
 * Conciliación VIN entre FNE y Saldos.vehículo.
 *
 * Que un VIN aparezca simultáneamente en FNE (factura emitida pendiente de
 * entrega) y en Saldos.vehículo (saldo cliente) es ESPERADO en muchos casos
 * — el cliente compró, se le emitió factura y el saldo es lo que aún debe.
 * NO es doble conteo automático.
 *
 * Niveles de conciliación:
 *   ✅ ok           — montos cuadran con tolerancia ≤2%, situación normal
 *   🟢 menor        — diferencia 2-15%, ajuste contable esperable
 *   🟠 relevante    — diferencia 15-40%, validar con finanzas
 *   🔴 doble_conteo — diferencia <10% AND monto >$5M (la misma op contada dos veces)
 *   ⚠ inconsistente — diferencia >40%, posiblemente operaciones distintas
 */

import type { FNERealCruzado, SaldoCruzado, SaldoRegistro } from "../types";
import { limpiarVIN } from "../parser/venta-apc";

/** Niveles de conciliación VIN entre FNE y Saldos.
 *  Mantenemos el nombre del tipo `NivelAlertaDC` por compatibilidad pero
 *  los valores reflejan ahora estados de conciliación, no alarma. */
export type NivelAlertaDC = "ok" | "menor" | "relevante" | "doble_conteo" | "inconsistente";

export interface AlertaDobleConteo {
  vin: string;
  cajon: string | null;
  marca: string | null;
  modelo: string | null;
  cliente: string | null;
  numFactura: string | number | null;
  valorFacturaFNE: number;
  saldoXDocumentar: number;
  diferencia: number;        // saldo - factura
  diferenciaAbs: number;
  diferenciaPct: number;     // |dif| / max(saldo, factura), 0..1
  subTipoSaldo: string;
  fuenteSaldo: string;
  tieneCreditoPompeyo: boolean;
  montoCreditoPompeyo: number;
  nivelAlerta: NivelAlertaDC;
  motivo: string;
}

const UMBRAL_MONTO_ALTO = 5_000_000;

function calcularNivel(args: {
  factura: number;
  saldo: number;
  diferenciaPct: number;
  tieneCP: boolean;
}): { nivel: NivelAlertaDC; motivo: string } {
  const max = Math.max(args.factura, args.saldo);
  // Doble conteo verdadero: montos casi iguales + monto significativo
  if (args.diferenciaPct < 0.1 && max >= UMBRAL_MONTO_ALTO) {
    return {
      nivel: "doble_conteo",
      motivo: "Montos casi iguales y operación significativa — muy probable la misma operación",
    };
  }
  // OK: diferencia ≤2%
  if (args.diferenciaPct <= 0.02) {
    return {
      nivel: "ok",
      motivo: "Montos conciliados — situación normal de venta con saldo pendiente",
    };
  }
  // Inconsistente: diferencia >40% — probablemente son operaciones distintas
  if (args.diferenciaPct > 0.4) {
    return {
      nivel: "inconsistente",
      motivo:
        "Diferencia muy alta — probablemente FNE y saldo cubren operaciones distintas, no es doble conteo",
    };
  }
  // Relevante: 15-40% o tiene Crédito Pompeyo
  if (args.diferenciaPct > 0.15 || args.tieneCP) {
    return {
      nivel: "relevante",
      motivo: args.tieneCP
        ? "Tiene Crédito Pompeyo activo — validar relación con saldo cliente"
        : "Diferencia relevante (15-40%) — validar con finanzas",
    };
  }
  // Menor: 2-15%
  return {
    nivel: "menor",
    motivo: "Diferencia pequeña (2-15%), ajuste contable esperable",
  };
}

export function detectarDobleConteo(
  fneCruzados: FNERealCruzado[],
  saldosCruzados: SaldoCruzado[],
): AlertaDobleConteo[] {
  // Index FNE por VIN_LIMPIO
  const fneByVin = new Map<string, FNERealCruzado>();
  for (const c of fneCruzados) {
    const k = limpiarVIN(c.fne.vin);
    if (k && !fneByVin.has(k)) fneByVin.set(k, c);
  }

  // Para cada VIN, agrupar saldos asignados
  const saldosPorVIN = new Map<string, SaldoCruzado[]>();
  for (const s of saldosCruzados) {
    if (s.saldo.categoria !== "vehiculo") continue;
    if (!s.saldo.vinResuelto) continue;
    const k = s.saldo.vinResuelto;
    if (!saldosPorVIN.has(k)) saldosPorVIN.set(k, []);
    saldosPorVIN.get(k)!.push(s);
  }

  const alertas: AlertaDobleConteo[] = [];
  for (const [vin, saldos] of saldosPorVIN) {
    const fne = fneByVin.get(vin);
    if (!fne) continue;

    // Crédito Pompeyo agregado para este VIN
    const cpSaldos = saldos.filter(
      (s) => s.saldo.subTipo === "credito_pompeyo" || s.saldo.cPompeyoCLP > 0,
    );
    const tieneCP = cpSaldos.length > 0;
    const montoCP = cpSaldos.reduce((sum, s) => sum + s.saldo.cPompeyoCLP, 0);

    // Una alerta por saldo individual — un mismo VIN puede generar N alertas
    // si tiene varios saldos asociados (ej. crédito Pompeyo + financiera).
    for (const sc of saldos) {
      const s = sc.saldo;
      const factura = fne.fne.valorFactura;
      const saldo = s.saldoXDocumentar;
      if (saldo === 0) continue; // sin monto, no hay riesgo de doble conteo
      const diferencia = saldo - factura;
      const max = Math.max(saldo, factura) || 1;
      const diferenciaPct = Math.abs(diferencia) / max;

      const { nivel, motivo } = calcularNivel({
        factura,
        saldo,
        diferenciaPct,
        tieneCP,
      });

      alertas.push({
        vin,
        cajon: s.cajon,
        marca: s.marca ?? sc.vehiculo?.marca ?? sc.vehiculoExtra?.marca ?? null,
        modelo: s.modelo ?? sc.vehiculo?.modelo ?? sc.vehiculoExtra?.modelo ?? null,
        cliente: s.cliente ?? fne.fne.cliente,
        numFactura: s.numeroFactura ?? s.numNota,
        valorFacturaFNE: factura,
        saldoXDocumentar: saldo,
        diferencia,
        diferenciaAbs: Math.abs(diferencia),
        diferenciaPct,
        subTipoSaldo: s.subTipo,
        fuenteSaldo: s.tipoRaw ?? s.subTipo,
        tieneCreditoPompeyo: tieneCP,
        montoCreditoPompeyo: montoCP,
        nivelAlerta: nivel,
        motivo,
      });
    }
  }

  // Ordenar: doble_conteo > inconsistente > relevante > menor > ok
  // (lo más urgente primero), dentro de cada nivel por |dif| descendiente
  const peso: Record<NivelAlertaDC, number> = {
    doble_conteo: 0,
    inconsistente: 1,
    relevante: 2,
    menor: 3,
    ok: 4,
  };
  return alertas.sort((a, b) => {
    const d = peso[a.nivelAlerta] - peso[b.nivelAlerta];
    return d !== 0 ? d : b.diferenciaAbs - a.diferenciaAbs;
  });
}

export interface DobleConteoStats {
  total: number;
  /** VIN conciliados — montos cuadran con tolerancia ≤2%. Situación normal. */
  ok: number;
  /** Diferencia 2-15% — ajuste contable esperable. */
  menor: number;
  /** Diferencia 15-40% o con Crédito Pompeyo — validar con finanzas. */
  relevante: number;
  /** Diferencia <10% Y monto >$5M — muy probable la misma operación contada 2 veces. */
  doble_conteo: number;
  /** Diferencia >40% — operaciones distintas, no es doble conteo. */
  inconsistente: number;
  /** Suma de |diferencia| — magnitud agregada. */
  diferenciaTotalAbs: number;
  /** Suma de valor factura FNE de los VINs en conciliación. */
  capitalEnAlertas: number;
}

export function statsDobleConteo(alertas: AlertaDobleConteo[]): DobleConteoStats {
  const stats: DobleConteoStats = {
    total: alertas.length,
    ok: 0,
    menor: 0,
    relevante: 0,
    doble_conteo: 0,
    inconsistente: 0,
    diferenciaTotalAbs: 0,
    capitalEnAlertas: 0,
  };
  const vinsUnicos = new Set<string>();
  for (const a of alertas) {
    stats[a.nivelAlerta]++;
    stats.diferenciaTotalAbs += a.diferenciaAbs;
    if (!vinsUnicos.has(a.vin)) {
      vinsUnicos.add(a.vin);
      stats.capitalEnAlertas += a.valorFacturaFNE;
    }
  }
  return stats;
}
