/**
 * Histórico Fase 1b · configuración centralizada.
 *
 * Todos los umbrales y mapeos del motor histórico viven acá para que
 * cambiarlos no requiera tocar lógica de extracción ni de UI.
 *
 * Reglas que codifica:
 *   · Capital atado (β): VINs/saldos/provisiones con más de X días en el
 *     mismo estado, que no rotan. "Capital muerto" en términos operacionales.
 *   · Sucursal con brecha: definición propia (Camino 2 — Decisión 0.4 usuario)
 *     basada en VU directamente, NO derivada del shape de Alerta.
 *   · Marca con brecha: marca con scoreGerencial < UMBRAL (Decisión 0.3).
 *   · Bloqueos FNE: mapeo tipado fuerte desde el enum TipoBloqueo del
 *     selector razonesBloqueoFNE — sin strings sueltos.
 *
 * Si un umbral hay que validarlo operacionalmente, dejar comentario
 * "(VALIDAR)" para que aparezca en grep cuando llegue el feedback.
 */

import type { TipoBloqueo } from "../selectors/razones-bloqueo";

// ────────────────────────────────────────────────────────────────────
// Umbrales · días para clasificar capital atado (Decisión 0.2 = β)
// ────────────────────────────────────────────────────────────────────

/** Aging de stock para clasificar el vehículo como "capital atado". */
export const AGING_ATADO_DIAS = 180;

/** Días desde fecha de factura FNE para clasificar como atado. */
export const FNE_ATADO_DIAS = 15;

/** Días de vencimiento de saldo vehículo para clasificar como atado. */
export const SALDOS_ATADO_DIAS = 90;

/** Días desde generación de provisión NO facturada para clasificar como atado. */
export const PROV_ATADO_DIAS = 90;

// ────────────────────────────────────────────────────────────────────
// Umbrales · sucursales y marcas con brecha
// ────────────────────────────────────────────────────────────────────

/** Score Gerencial bajo este valor → marca con brecha. (VALIDAR con Directorio) */
export const UMBRAL_MARCA_BRECHA = 60;

/** Mínimo de vehículos con aging > 180d para que la sucursal cuente como brecha. */
export const SUCURSAL_MIN_VEHICULOS_AGING_180 = 5;

/** Mínimo de FNE bloqueados para que la sucursal cuente como brecha. */
export const SUCURSAL_MIN_FNE_BLOQUEADOS = 3;

/** Mínimo de alertas críticas asociadas a la sucursal para contar como brecha. */
export const SUCURSAL_MIN_ALERTAS_CRITICAS = 2;

// ────────────────────────────────────────────────────────────────────
// Bloqueos FNE · mapeo tipado del enum operacional → categoría schema
//
// El selector razonesBloqueoFNE emite TipoBloqueo fuertemente tipado.
// Acá mapeamos cada tipo a una de las 4 categorías que persistimos en
// fneBloqueadosCp/Inscripcion/Logistica/Comercial.
//
// Decisión 0.6 (usuario): lógica Venn — un VIN puede sumar en varias
// categorías a la vez. Los contadores pueden sumar más que el total FNE.
// ────────────────────────────────────────────────────────────────────

export type CategoriaBloqueoFNE = "cp" | "inscripcion" | "logistica" | "comercial";

export const MAPEO_BLOQUEO_FNE: Record<TipoBloqueo, CategoriaBloqueoFNE> = {
  financiero:            "cp",
  logistica:             "logistica",
  inscripcion_comercial: "inscripcion",
  inscripcion_cdn:       "inscripcion",
  inscripcion_rc:        "inscripcion",
  admin_pompeyo:         "inscripcion",
  patente_transito:      "inscripcion",
  solicitud_entrega:     "comercial",
  autorizacion:          "comercial",
};

// ────────────────────────────────────────────────────────────────────
// Fase 1b-B · Score Capital — drivers y umbrales
//
// Pregunta operacional: ¿qué tan eficientemente esta marca convierte
// capital en caja? Sin denominador de ventas (prohibido por usuario).
//
// Score = 100 − Σ penalizaciones, donde cada driver penaliza con
// función lineal entre meta (0 pts) y max (peso completo).
//
// Todos los umbrales: VALIDAR con Directorio en calibración a 6 meses.
// ────────────────────────────────────────────────────────────────────

/** V1 — % capital atado (Utilizado/Total). Peso central. VALIDAR. */
export const SC_V1_META = 0.30;
export const SC_V1_MAX  = 0.70;
export const SC_V1_PESO = 30;

/** V2 — % stock unidades con aging > 180 d. Peso central. VALIDAR. */
export const SC_V2_META = 0.05;
export const SC_V2_MAX  = 0.25;
export const SC_V2_PESO = 25;

/** V3 — Utilización de línea (ocupada/autorizada). VALIDAR. */
export const SC_V3_META = 0.80;
export const SC_V3_MAX  = 1.00;
export const SC_V3_PESO = 15;

/** V4 — % provisiones no facturadas > 90 d sobre capital total. VALIDAR. */
export const SC_V4_META = 0.05;
export const SC_V4_MAX  = 0.25;
export const SC_V4_PESO = 10;

/** V5 — % stock pagado (Propio + FinPropio) sobre stockMontoTotal. VALIDAR. */
export const SC_V5_META = 0.05;
export const SC_V5_MAX  = 0.30;
export const SC_V5_PESO = 10;

/** V6 — Gini de capital atado por marca (concentración). VALIDAR. */
export const SC_V6_META = 0.40;
export const SC_V6_MAX  = 0.70;
export const SC_V6_PESO = 10;

/** Mín marcas para que V6 sea confiable. Bajo este número → V6 = null. */
export const SC_V6_MIN_MARCAS = 5;

// ────────────────────────────────────────────────────────────────────
// Fase 1b-B · Score Gerencial — drivers y umbrales
//
// Pregunta: ¿qué tan disciplinada está la operación?
// Sin SLA, sin GestionSnapshot (postergados). Densidad NO valores absolutos.
// ────────────────────────────────────────────────────────────────────

/** G1 — alertas críticas por cada 100 vehículos. Peso central. VALIDAR. */
export const SG_G1_META = 0.5;
export const SG_G1_MAX  = 5;
export const SG_G1_PESO = 35;

/** G2 — alertas altas por cada 100 vehículos. Peso central. VALIDAR. */
export const SG_G2_META = 5;
export const SG_G2_MAX  = 30;
export const SG_G2_PESO = 25;

/** G3 — alertas medias por cada 100 vehículos. VALIDAR. */
export const SG_G3_META = 3;
export const SG_G3_MAX  = 15;
export const SG_G3_PESO = 10;

/** G4 — % sucursales con brecha sobre sucursales con stock. VALIDAR. */
export const SG_G4_META = 0.20;
export const SG_G4_MAX  = 0.80;
export const SG_G4_PESO = 15;

/**
 * G5 — Reincidencia 2 meses (crit+alta).
 * % de VINs en alerta crit/alta del período N que ya estaban en alerta
 * crit/alta en N-1. Mide cuánto está apilando el equipo vs cerrando.
 * VALIDAR.
 */
export const SG_G5_META = 0.05;
export const SG_G5_MAX  = 0.50;
export const SG_G5_PESO = 15;

// ────────────────────────────────────────────────────────────────────
// Confianza de scores · función de pesoCubierto (Σ pesos de drivers
// presentes, sobre 100). Define cómo se reporta el score.
// ────────────────────────────────────────────────────────────────────

export const COBERTURA_MIN_ALTA = 90;
export const COBERTURA_MIN_MEDIA = 70;
export const COBERTURA_MIN_BAJA = 55;

// ────────────────────────────────────────────────────────────────────
// Fase 1b-C · Score Velocidad — drivers y umbrales
//
// Pregunta operacional: ¿dónde se consumen los días y quién los consume?
//
// Score ortogonal a Capital y Gerencial — mide TIEMPO, no monto ni alertas.
// Sin denominador de ventas. Solo días, buckets de aging y evolución vs N-1.
//
// Todos los umbrales: VALIDAR con Directorio en calibración a 6 meses.
// ────────────────────────────────────────────────────────────────────

/**
 * VEL1 — Mediana de días en bodega del stock activo. Peso central. VALIDAR.
 *
 * Recalibración 2026-06: meta bajada de 45→25, max de 120→60. Razón: con
 * umbrales originales el score salía ~100 todos los meses (mediana real de
 * Pompeyo es 30-35 d, muy bajo). Los nuevos umbrales hacen que el score
 * DISCRIMINE entre períodos.
 */
export const SVE_VEL1_META = 25;
export const SVE_VEL1_MAX  = 60;
export const SVE_VEL1_PESO = 35;

/**
 * VEL2 — % stock en bucket 60–180 d (estancado pero recuperable). Peso central. VALIDAR.
 *
 * Recalibración 2026-06: meta bajada de 25%→15%, max de 60%→40%. Misma razón
 * que VEL1: discriminar entre períodos reales en lugar de quedar todos en meta.
 */
export const SVE_VEL2_META = 0.15;
export const SVE_VEL2_MAX  = 0.40;
export const SVE_VEL2_PESO = 25;

/**
 * VEL3 — Δ unidades aging > 180 d vs N-1 (crecimiento neto stock muerto).
 * Valor positivo = creció el stock muerto (mal). 0 o negativo = sano.
 * Requiere snapshot previo; sin él → driver null + redistribución.
 * VALIDAR.
 */
export const SVE_VEL3_META = 0;
export const SVE_VEL3_MAX  = 50;
export const SVE_VEL3_PESO = 20;

/**
 * VEL4 — % stock < 30 d (frescura del inventario). DRIVER INVERSO:
 *   · valor ≥ meta (30 %) → sano, 0 puntos
 *   · valor ≤ max  (10 %) → peso completo
 *   · entre meta y max  → penalización lineal
 * VALIDAR.
 */
export const SVE_VEL4_META = 0.30;
export const SVE_VEL4_MAX  = 0.10;
export const SVE_VEL4_PESO = 10;
export const SVE_VEL4_INVERSO = true;

/**
 * VEL5 — Días promedio de saldos vehículo vencidos.
 * Requiere SALDOS histórico; sin él → driver null + redistribución.
 * VALIDAR.
 */
export const SVE_VEL5_META = 30;
export const SVE_VEL5_MAX  = 120;
export const SVE_VEL5_PESO = 10;
