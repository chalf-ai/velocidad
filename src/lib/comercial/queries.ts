import "server-only";
import { romaQuery } from "@/lib/roma";

/**
 * Velocity Comercial V1 · capa de datos.
 *
 * Lee ROMA en vivo (solo lectura, vía `romaQuery`). Queries VALIDADAS contra
 * ROMA producción (jun-2026). NO inventa datos: lo que no está en ROMA vivo
 * (RVM, listas, escalera VPP fina de AutoRed) NO se consulta acá.
 *
 * Ventanas: stock=actual · demanda=30d vs 30d previos · vigentes/crédito=90d.
 */

export type CreditoBreakdown = {
  sinSolicitud: number;
  solicitud: number;
  aprobado: number;
  rechazado: number;
  bloqueada: number;
  cursado: number;
};

export type Tendencia = "creciente" | "cayendo" | "estable" | "sin_base";

export type ModeloComercial = {
  modelo: string;
  stock: { disponibles: number; sobre90: number; diasProm: number; diasMax: number };
  demanda: { cot30: number; cotPrev30: number; deltaPct: number | null; tendencia: Tendencia };
  vigentes: { total90d: number; creditoSinFirmar: number; vppActiva: number };
  credito: CreditoBreakdown;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Estado de crédito (VT_Cotizaciones.EstadoID) — etiquetas oficiales.
const CRED_LABEL: Record<number, keyof CreditoBreakdown> = {
  1: "sinSolicitud",
  2: "aprobado",
  3: "rechazado",
  7: "cursado",
  9: "bloqueada",
  12: "solicitud",
};

function vacio(modelo: string): ModeloComercial {
  return {
    modelo,
    stock: { disponibles: 0, sobre90: 0, diasProm: 0, diasMax: 0 },
    demanda: { cot30: 0, cotPrev30: 0, deltaPct: null, tendencia: "sin_base" },
    vigentes: { total90d: 0, creditoSinFirmar: 0, vppActiva: 0 },
    credito: { sinSolicitud: 0, solicitud: 0, aprobado: 0, rechazado: 0, bloqueada: 0, cursado: 0 },
  };
}

function tendenciaDe(cot30: number, cotPrev30: number): { deltaPct: number | null; tendencia: Tendencia } {
  if (cotPrev30 <= 0) return { deltaPct: null, tendencia: "sin_base" };
  const deltaPct = Math.round((100 * (cot30 - cotPrev30)) / cotPrev30);
  const tendencia: Tendencia = deltaPct >= 10 ? "creciente" : deltaPct <= -10 ? "cayendo" : "estable";
  return { deltaPct, tendencia };
}

/**
 * Foto comercial de varios modelos desde ROMA vivo. Una query agrupada por
 * métrica (4 en total). Devuelve los modelos en el MISMO orden pedido; los que
 * no tienen datos vuelven en cero (no se inventan).
 */
export async function getModelosComercial(modelos: string[]): Promise<ModeloComercial[]> {
  const keys = modelos.map((m) => m.trim().toUpperCase());
  if (keys.length === 0) return [];
  const ph = keys.map(() => "?").join(", ");

  const [stockRows, demandaRows, vigentesRows, creditoRows] = await Promise.all([
    romaQuery<Record<string, unknown>>(
      `SELECT UPPER(TRIM(Modelo)) modelo, COUNT(*) total,
              SUM(CASE WHEN Dias_Stock>90 THEN 1 ELSE 0 END) sobre90,
              ROUND(AVG(Dias_Stock)) dias_prom, MAX(Dias_Stock) dias_max
         FROM APC_Stock_Spa
        WHERE Condicion_Vehiculo LIKE '%NUEVOS%'
          AND (Estado_Venta='' OR Estado_Venta IS NULL)
          AND UPPER(TRIM(Modelo)) IN (${ph})
        GROUP BY UPPER(TRIM(Modelo))`,
      keys,
    ),
    romaQuery<Record<string, unknown>>(
      `SELECT UPPER(TRIM(m.Modelo)) modelo,
              SUM(CASE WHEN c.FechaCreacion>=CURDATE()-INTERVAL 30 DAY THEN 1 ELSE 0 END) cot_30d,
              SUM(CASE WHEN c.FechaCreacion>=CURDATE()-INTERVAL 60 DAY AND c.FechaCreacion<CURDATE()-INTERVAL 30 DAY THEN 1 ELSE 0 END) cot_prev30
         FROM VT_Cotizaciones c JOIN MA_Modelos m ON m.ID=c.ModeloID
        WHERE UPPER(TRIM(m.Modelo)) IN (${ph})
        GROUP BY UPPER(TRIM(m.Modelo))`,
      keys,
    ),
    // VPP activa = VT_Vpp (vivo, trade-in tomado) por VentaID (join LIMPIO).
    romaQuery<Record<string, unknown>>(
      `SELECT UPPER(TRIM(m.Modelo)) modelo, COUNT(DISTINCT v.ID) vigentes,
              COUNT(DISTINCT CASE WHEN v.CreditoFirmado=2 THEN v.ID END) credito_sin_firmar,
              COUNT(DISTINCT CASE WHEN vp.Activo=1 THEN v.ID END) vpp_activa
         FROM VT_Ventas v JOIN MA_Modelos m ON m.ID=v.ModeloID
         LEFT JOIN VT_Vpp vp ON vp.VentaID=v.ID
        WHERE v.FechaFactura IS NULL AND v.FechaVenta>=CURDATE()-INTERVAL 90 DAY
          AND UPPER(TRIM(m.Modelo)) IN (${ph})
        GROUP BY UPPER(TRIM(m.Modelo))`,
      keys,
    ),
    romaQuery<Record<string, unknown>>(
      `SELECT UPPER(TRIM(m.Modelo)) modelo, c.EstadoID eid, COUNT(*) n
         FROM VT_Cotizaciones c JOIN MA_Modelos m ON m.ID=c.ModeloID
        WHERE UPPER(TRIM(m.Modelo)) IN (${ph})
          AND c.FechaCreacion>=CURDATE()-INTERVAL 90 DAY
        GROUP BY UPPER(TRIM(m.Modelo)), c.EstadoID`,
      keys,
    ),
  ]);

  const byKey = new Map<string, ModeloComercial>();
  for (const k of keys) byKey.set(k, vacio(k));

  for (const r of stockRows) {
    const m = byKey.get(String(r.modelo));
    if (m) m.stock = { disponibles: num(r.total), sobre90: num(r.sobre90), diasProm: num(r.dias_prom), diasMax: num(r.dias_max) };
  }
  for (const r of demandaRows) {
    const m = byKey.get(String(r.modelo));
    if (m) {
      const cot30 = num(r.cot_30d);
      const cotPrev30 = num(r.cot_prev30);
      m.demanda = { cot30, cotPrev30, ...tendenciaDe(cot30, cotPrev30) };
    }
  }
  for (const r of vigentesRows) {
    const m = byKey.get(String(r.modelo));
    if (m) m.vigentes = { total90d: num(r.vigentes), creditoSinFirmar: num(r.credito_sin_firmar), vppActiva: num(r.vpp_activa) };
  }
  for (const r of creditoRows) {
    const m = byKey.get(String(r.modelo));
    const label = CRED_LABEL[num(r.eid)];
    if (m && label) m.credito[label] = num(r.n);
  }

  return keys.map((k) => byKey.get(k)!);
}

export async function getModeloComercial(modelo: string): Promise<ModeloComercial> {
  const [m] = await getModelosComercial([modelo]);
  return m ?? vacio(modelo.trim().toUpperCase());
}

/** Los 5 modelos del set inicial de validación. */
export const MODELOS_INICIALES = ["Sportage", "Sonet", "Seltos", "Morning", "Starray"];
