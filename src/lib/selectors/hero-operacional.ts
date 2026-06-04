/**
 * MOTOR DE NARRATIVA OPERACIONAL · radar inteligente del hero.
 *
 * Lee los KPIs ya calculados (eficiencia de capital + composición de caja) y
 * deriva una LECTURA EJECUTIVA determinística: nivel (verde/amarillo/naranjo/
 * rojo), tono visual, headline y acción sugerida. NO recalcula score ni
 * cálculos financieros — solo INTERPRETA lo que ya existe. Sin IA, sin random:
 * mismas entradas → misma salida, y cada nivel es explicable por sus reglas.
 */

import type { EficienciaCapital } from "./eficiencia-capital";

export type HeroNivel = "verde" | "amarillo" | "naranjo" | "rojo";

export interface HeroTone {
  /** Fondo suave del hero. */
  bg: string;
  /** Borde. */
  border: string;
  /** Acento (chip, viñeta, headline accent). */
  accent: string;
}

export interface HeroTension {
  id: "puente" | "saldos" | "pagado" | "provisiones" | "fne";
  /** Etiqueta para la narrativa ("el capital puente"). */
  label: string;
  /** Acción priorizada ("recuperar los VU/BU recibidos"). */
  accion: string;
  /** Magnitud relativa (0-1) — share de la caja o señal de velocidad. */
  peso: number;
}

export interface HeroNarrativa {
  nivel: HeroNivel;
  tone: HeroTone;
  /** Etiqueta corta del estado (chip). */
  estadoLabel: string;
  headline: string;
  subtitulo: string;
  /** Tensiones detectadas (orden por peso) — para trazabilidad. */
  tensiones: HeroTension[];
  /** Inputs resumidos para auditoría. */
  trazas: {
    /** Score Gerencial · fuente principal de severidad cuando hay venta pond. */
    scoreGerencial: number | null;
    /** Score Eficiencia · fallback de severidad. */
    score: number | null;
    capitalVentaPct: number | null;
    mos: number | null;
    agingShare: number;
  };
}

export interface HeroCT {
  mStock: number;
  mPuente: number;
  mSaldos: number;
  mBonos: number;
  mProv: number;
  total: number;
}

export interface HeroInputs {
  efic: EficienciaCapital;
  ct: HeroCT;
  /** Marca operacional activa (null = macro/grupo). */
  marca: string | null;
  /**
   * Score Gerencial 0..100 de la marca/universo actual (pesos 40+30+20+10
   * sobre Stock propio ≤5%, Provisiones >90d, CP >15d, Saldos T3+). Cuando
   * existe, ES la fuente de severidad del Hero (decisión usuario 2026-06).
   * Si es null (sin venta ponderada o universo vacío), cae al Score
   * Eficiencia como antes para mantener compatibilidad. Las TENSIONES
   * (puente, saldos, FNE, etc.) siguen viniendo de la composición de caja.
   */
  scoreGerencial: number | null;
}

const TONE: Record<HeroNivel, HeroTone> = {
  verde: { bg: "#f1f9f4", border: "rgba(15,122,89,0.22)", accent: "#0f7a59" },
  amarillo: { bg: "#fdfaf0", border: "rgba(180,83,9,0.22)", accent: "#b45309" },
  naranjo: { bg: "#fff5ed", border: "rgba(234,88,12,0.28)", accent: "#ea580c" },
  rojo: { bg: "#fef3f2", border: "rgba(220,38,38,0.30)", accent: "#dc2626" },
};

const ESTADO_LABEL: Record<HeroNivel, string> = {
  verde: "Operación sana",
  amarillo: "Tensión incipiente",
  naranjo: "Caja retenida",
  rojo: "Capital detenido",
};

/** Nombre legible de la marca para la narrativa (KIA MOTORS → KIA). */
function sujetoDe(marca: string | null): { Suj: string; suj: string; esGrupo: boolean } {
  if (!marca) return { Suj: "La operación", suj: "la operación", esGrupo: true };
  if (marca === "USADOS") return { Suj: "Usados", suj: "usados", esGrupo: false };
  const limpio = marca.replace(/\s+MOTORS$/i, "").trim();
  return { Suj: limpio, suj: limpio, esGrupo: false };
}

/**
 * Deriva la lectura operacional del hero. Determinística y explicable.
 *
 * NIVEL: base por score de eficiencia (0-100, 100 = veloz/sano), ajustado por
 * capital/venta, MOS y antigüedad. Sin score (sin ventas Q1) → desde composición.
 * TENSIONES: qué está reteniendo la caja (share sobre el capital utilizado).
 */
export function deriveHeroOperacional({ efic, ct, marca, scoreGerencial }: HeroInputs): HeroNarrativa {
  const total = ct.total || 0;
  const share = (x: number) => (total > 0 ? x / total : 0);
  const sPuente = share(ct.mPuente);
  const sSaldos = share(ct.mSaldos + ct.mBonos);
  const sPagado = share(ct.mStock);
  const sProv = share(ct.mProv);
  const aging = efic.bases.agingShare; // % del stock con +180d
  const fneDet = efic.bases.fneDetenidoShare; // % del valor FNE trabado
  const { score, capitalVentaPct: cvp, mos } = efic;

  // ── NIVEL ────────────────────────────────────────────────────────────────
  // Prioridad de la fuente de severidad (decisión usuario 2026-06):
  //   1) Score Gerencial cuando hay dato (≥85 verde · ≥65 amarillo · ≥50 naranjo · <50 rojo).
  //      Garantiza congruencia con la pantalla /score-gerencial.
  //   2) Score Eficiencia como fallback (≥85 verde · ≥65 amarillo · ≥50 naranjo · <50 rojo).
  //   3) Capital/Venta como fallback secundario.
  //   4) Composición de caja (puente+saldos+aging) si no hay ventas.
  let nivelIdx: number; // 0 verde · 1 amarillo · 2 naranjo · 3 rojo
  if (scoreGerencial != null) {
    nivelIdx = scoreGerencial >= 85 ? 0 : scoreGerencial >= 65 ? 1 : scoreGerencial >= 50 ? 2 : 3;
  } else if (score != null) {
    nivelIdx = score >= 85 ? 0 : score >= 65 ? 1 : score >= 50 ? 2 : 3;
  } else if (cvp != null) {
    nivelIdx = cvp <= 80 ? 0 : cvp <= 110 ? 1 : cvp <= 150 ? 2 : 3;
  } else {
    // Sin ventas: severidad por caja retenida (puente+saldos+aging).
    const retenida = sPuente + sSaldos + (aging > 0.3 ? 0.2 : 0);
    nivelIdx = retenida < 0.2 ? 0 : retenida < 0.4 ? 1 : retenida < 0.6 ? 2 : 3;
  }
  // Modificador: deterioro fuerte sube un nivel (tope rojo). Solo aplica
  // cuando la fuente de severidad NO es el Score Gerencial (que ya integra
  // sus propias señales). Evita doble penalización.
  const deterioroFuerte =
    scoreGerencial == null &&
    ((cvp != null && cvp > 150) || (mos != null && mos > 2.6) || aging > 0.4 || fneDet > 0.5);
  if (deterioroFuerte) nivelIdx = Math.min(3, nivelIdx + 1);
  const nivel: HeroNivel = (["verde", "amarillo", "naranjo", "rojo"] as const)[nivelIdx];

  // ── TENSIONES (qué retiene la caja) ───────────────────────────────────────
  const candidatas: HeroTension[] = [
    { id: "puente", label: "el capital puente", accion: "recuperar los VU/BU recibidos", peso: sPuente },
    { id: "saldos", label: "los saldos por cobrar", accion: "acelerar la recuperación de saldos", peso: sSaldos },
    {
      id: "pagado",
      label: "el stock pagado",
      accion: "rotar el stock pagado envejecido",
      // El stock pagado solo es tensión si además está envejecido.
      peso: sPagado * (aging > 0.25 ? 1 : 0.35),
    },
    { id: "provisiones", label: "las provisiones por facturar", accion: "facturar las provisiones pendientes", peso: sProv },
    { id: "fne", label: "los FNE detenidos", accion: "destrabar entregas e inscripción", peso: fneDet * 0.6 },
  ];
  const tensiones = candidatas.filter((t) => t.peso >= 0.08).sort((a, b) => b.peso - a.peso);
  const top = tensiones.slice(0, 2);
  const clause =
    top.length === 0 ? "" : top.length === 1 ? top[0].label : `${top[0].label} y ${top[1].label}`;
  const acciones = top.map((t) => t.accion).join(" y ");

  // ── NARRATIVA ──────────────────────────────────────────────────────────────
  const { Suj, suj, esGrupo } = sujetoDe(marca);
  let headline: string;
  let subtitulo: string;

  if (nivel === "verde") {
    headline = esGrupo
      ? "La operación está fluyendo."
      : `${Suj} mantiene buena velocidad operacional.`;
    subtitulo = "El foco ahora es acelerar la rotación y liberar el capital pagado.";
  } else if (nivel === "amarillo") {
    headline = clause
      ? `${Suj} mantiene velocidad comercial, pero ${clause} empieza${top.length > 1 ? "n" : ""} a tensionar la caja.`
      : `${Suj}: la velocidad empieza a deteriorarse.`;
    subtitulo = acciones
      ? `Prioriza ${acciones}.`
      : "El puente y los FNE empiezan a retener caja operacional.";
  } else if (nivel === "naranjo") {
    headline = clause
      ? `En ${suj} la caja se está acumulando: ${clause}.`
      : `En ${suj} la caja se está acumulando en operación.`;
    subtitulo = acciones
      ? `Prioriza ${acciones}.`
      : "Prioriza inscripción, entregas listas y rotación del stock envejecido.";
  } else {
    headline = clause
      ? `En ${suj} el capital está detenido: ${clause}.`
      : `En ${suj} el capital está detenido.`;
    subtitulo = acciones
      ? `La operación perdió velocidad y consume caja sin rotación. Prioriza ${acciones}.`
      : "La operación perdió velocidad y está consumiendo caja sin rotación.";
  }

  return {
    nivel,
    tone: TONE[nivel],
    estadoLabel: ESTADO_LABEL[nivel],
    headline,
    subtitulo,
    tensiones,
    trazas: { scoreGerencial, score, capitalVentaPct: cvp, mos, agingShare: aging },
  };
}
