/**
 * Distribución del ciclo Factura → Entrega Real por área responsable.
 *
 * Responde la pregunta operacional clave de CN V1.0 REV.1:
 *   "¿Quién consumió los días del ciclo?"
 *
 * MÉTRICA: PROMEDIO (no mediana). El usuario aprobó el trade-off — el
 * promedio refleja mejor "los días que en promedio se demoran TODOS los
 * procesos", aunque esconde la dispersión. La mediana queda en otros
 * bloques (cards de Tiempos por proceso) para análisis robusto.
 *
 * AGRUPACIÓN: Control de Negocio + Registro Civil se presentan como UNA
 * sola área (responsabilidad funcional del mismo flujo, aunque RC sea
 * un ente externo). La fila muestra el agregado + desglose interno
 * (CdN solo · RC solo) para auditoría.
 *
 * NOMENCLATURA OPERACIONAL (decisión usuario · 2026-06):
 * Las áreas "Comercial pre-inscripción" y "Comercial · auto listo para
 * entrega" son ambas responsabilidad de Comercial — sólo cambia el
 * momento del ciclo. Antes se llamaban "Comercial" (pre-inscripción) y
 * "Sucursal + Cliente" (residuo post-patente); el rename refleja que
 * en ambos tramos el dueño operativo es Comercial.
 *
 * Estrategia de cálculo:
 *   · Comercial · pre-inscripción         → promedio Factura → Sol. Inscripción.
 *   · CN + RC                              → promedio(Sol. Ins. → Inscripción) +
 *                                            promedio(Inscripción → Pat. Recibida).
 *   · Comercial · auto listo para entrega → RESIDUO del ciclo total.
 *
 * NOTA CRÍTICA · Tramo Patente Recibida → Patente Entregada (excluido):
 * `fecha_patente_entregada` está contaminada en la captura (brief §4 ·
 * 86,6% de casos con timestamp idéntico a `entrega_auto`). Su tiempo
 * medido pertenece en realidad al tramo Comercial · auto listo para
 * entrega. Por eso se excluye del cálculo de CN+RC. La responsabilidad
 * operacional sigue siendo de CN (visible en Capa B y Capa C).
 *
 * Fallback: si el período tiene 0 datos, devuelve los valores oficiales
 * aprobados en CN V1.0 REV.1 (vista de referencia, declarada en la UI).
 */

import type { CapaA } from "./cn-velocidad";

export interface SubdesgloseArea {
  sub: string;
  dias: number;
  color: string;
}

export interface DistribucionDias {
  area: string;
  dias: number;
  pctParticipacion: number;
  color: string;
  cubre: string;
  origen: "calculado" | "derivado" | "referencia";
  /** Sub-desglose visible debajo del bloque (ej. CN+RC). */
  desglose?: SubdesgloseArea[];
}

export type FuenteDistribucion = "dinamico" | "referencia";

export interface ResultadoDistribucion {
  filas: DistribucionDias[];
  /** Ciclo total expresado como promedio Factura → Entrega Real. */
  cicloTotalDias: number;
  fuente: FuenteDistribucion;
  /** Métrica usada para alimentar el bloque · siempre "promedio" en v2.5. */
  metrica: "promedio";
}

const COLOR_COMERCIAL_PRE = "#B83B6A";
const COLOR_CN = "#1F2A44";
const COLOR_RC = "#8E44AD";
const COLOR_COMERCIAL_POST = "#E67E22";

/** Valores aprobados CN V1.0 REV.1 — fallback cuando no hay datos. */
const DISTRIBUCION_OFICIAL: DistribucionDias[] = [
  {
    area: "Comercial · auto listo para entrega",
    dias: 8.8,
    pctParticipacion: 43,
    color: COLOR_COMERCIAL_POST,
    cubre: "Patente entregada → Entrega real",
    origen: "referencia",
  },
  {
    area: "Control de Negocio + Registro Civil",
    dias: 4.94 + 3.34,
    pctParticipacion: 40,
    color: COLOR_CN,
    cubre: "Solicitud inscripción → Patente recibida",
    origen: "referencia",
    desglose: [
      { sub: "CdN · Sol. Inscripción → Inscripción", dias: 4.94, color: COLOR_CN },
      { sub: "Registro Civil · Inscripción → Patente Recibida", dias: 3.34, color: COLOR_RC },
    ],
  },
  {
    area: "Comercial · pre-inscripción",
    dias: 6.75,
    pctParticipacion: 33,
    color: COLOR_COMERCIAL_PRE,
    cubre: "Factura → Solicitud inscripción",
    origen: "referencia",
  },
];

const CICLO_OFICIAL = 20.83;

/**
 * Calcula la distribución dinámica por área sobre el período activo, en
 * PROMEDIO de días.
 *
 * @param capa  output de `calcularCapaA(universo)` — provee promedio por tramo.
 * @param cicloTotalDiasPromedio  promedio Factura → Entrega Real del período
 *              (calculado en page.tsx sobre los entregados). Si null, se usa
 *              la suma de promedios medibles (sin residuo para el bloque
 *              Comercial · auto listo para entrega).
 */
export function calcularDistribucionDias(
  capa?: CapaA | null,
  cicloTotalDiasPromedio?: number | null,
): ResultadoDistribucion {
  if (!capa || capa.tramos.length === 0) {
    return {
      filas: DISTRIBUCION_OFICIAL,
      cicloTotalDias: CICLO_OFICIAL,
      fuente: "referencia",
      metrica: "promedio",
    };
  }

  // Mapa de promedios por tramoId (sólo tramos con timestamp).
  const prom: Record<string, number> = {};
  for (const t of capa.tramos) {
    if (t.kind === "dias" && t.promedio != null && t.n > 0) {
      prom[t.id] = t.promedio;
    }
  }

  const dComercial = prom.fac_sol_ins ?? 0;
  // CN puro = Sol. Inscripción → Inscripción (tramo 2). NO incluye
  // pat_rec_pat_ent por contaminación de captura (ver doc arriba).
  const dCN = prom.sol_ins_ins ?? 0;
  const dRC = prom.ins_pat_rec ?? 0;
  // CN+RC agrupado por presentación ejecutiva (responsabilidad funcional única).
  const dCNRC = dCN + dRC;

  const diasMedibles = dComercial + dCNRC;
  const cicloEfectivo = cicloTotalDiasPromedio ?? diasMedibles;

  const dSucCli = Math.max(0, cicloEfectivo - diasMedibles);
  const totalCalculado = diasMedibles + dSucCli;

  if (totalCalculado <= 0 || cicloEfectivo <= 0) {
    return {
      filas: DISTRIBUCION_OFICIAL,
      cicloTotalDias: CICLO_OFICIAL,
      fuente: "referencia",
      metrica: "promedio",
    };
  }

  const denom = cicloEfectivo;
  const pct = (d: number) => Math.round((d / denom) * 100);

  const filas: DistribucionDias[] = [
    {
      area: "Comercial · auto listo para entrega",
      dias: dSucCli,
      pctParticipacion: pct(dSucCli),
      color: COLOR_COMERCIAL_POST,
      cubre: "Patente entregada → Entrega real (+ tramo CdN no instrumentado)",
      origen: "derivado",
    },
    {
      area: "Control de Negocio + Registro Civil",
      dias: dCNRC,
      pctParticipacion: pct(dCNRC),
      color: COLOR_CN,
      cubre: "Solicitud inscripción → Patente recibida",
      origen: "calculado",
      desglose: [
        {
          sub: "CdN · Solicitud Inscripción → Inscripción",
          dias: dCN,
          color: COLOR_CN,
        },
        {
          sub: "Registro Civil · Inscripción → Patente Recibida",
          dias: dRC,
          color: COLOR_RC,
        },
      ],
    },
    {
      area: "Comercial · pre-inscripción",
      dias: dComercial,
      pctParticipacion: pct(dComercial),
      color: COLOR_COMERCIAL_PRE,
      cubre: "Factura → Solicitud inscripción",
      origen: "calculado",
    },
  ];

  filas.sort((a, b) => b.pctParticipacion - a.pctParticipacion);

  return {
    filas,
    cicloTotalDias: cicloEfectivo,
    fuente: "dinamico",
    metrica: "promedio",
  };
}

export function consumidorPrincipal(
  dist: DistribucionDias[],
): DistribucionDias {
  return [...dist].sort(
    (a, b) => b.pctParticipacion - a.pctParticipacion,
  )[0];
}

export const CICLO_TOTAL_DIAS = CICLO_OFICIAL;
