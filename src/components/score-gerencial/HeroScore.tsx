"use client";

/**
 * Hero ejecutivo del Score Gerencial.
 *
 * Banner con gradiente diagonal (rosa→naranja) · 3 columnas:
 *   1. Score grande + estado
 *   2. Resumen general · barra de progreso 0/60/85/100 con marcador
 *   3. Cómo llegar a 100 · "Subes de X a Y pts" + flecha
 *
 * Sin cards blancas internas · el banner ES la card.
 * Datos: ScoreGerencialResultado · cero React state.
 */

import { TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type {
  ScoreGerencialResultado,
  EstadoScore,
} from "@/lib/selectors/score-gerencial";

const ESTADO_LABEL: Record<EstadoScore, string> = {
  bueno: "Bueno",
  riesgo: "En riesgo",
  critico: "Crítico",
};

// Marcadores fijos del progreso 0-60-85-100 para orientación visual.
const HITOS = [0, 60, 85, 100] as const;

/**
 * Gradiente del banner según el estado del score.
 *
 * El usuario lee el COLOR antes que el número: un gerente con score 94
 * tiene que ver verde, no rojo. La banda 0-60-85-100 sigue mostrándose
 * fija dentro de la barra (escala absoluta), pero el fondo del hero
 * comunica la situación actual.
 *
 *   bueno   (≥85)  · verde esmeralda → lima
 *   riesgo  (60-85)· naranja oscuro → ámbar
 *   crítico (<60)  · vinotinto → rojo brillante
 */
function gradientePorEstado(estado: EstadoScore): string {
  switch (estado) {
    case "bueno":
      return "linear-gradient(135deg, #047857 0%, #10B981 45%, #84CC16 100%)";
    case "riesgo":
      return "linear-gradient(135deg, #C2410C 0%, #EA580C 45%, #F59E0B 100%)";
    case "critico":
      return "linear-gradient(135deg, #7F1D1D 0%, #B91C1C 45%, #DC2626 100%)";
  }
}

export function HeroScore({ resultado }: { resultado: ScoreGerencialResultado }) {
  const { score, estado, plan } = resultado;
  const proyeccion = Math.min(
    100,
    score + plan.reduce((s, p) => s + p.puntosGanables, 0),
  );

  // Posición del marcador del score sobre la barra 0-100.
  const markerLeft = Math.max(0, Math.min(100, score));

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl text-white shadow-lg",
        "px-6 py-7",
      )}
      style={{
        background: gradientePorEstado(estado),
      }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_280px] gap-6 items-center">
        {/* ─── 1. Score gigante ────────────────────────────────────────── */}
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] opacity-85">
            Score Gerencial
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-[88px] font-bold tracking-tight leading-none mono">
              {score}
            </span>
            <span className="text-[20px] font-semibold opacity-80">/ 100</span>
          </div>
          <BadgeEstado estado={estado} />
        </div>

        {/* ─── 2. Resumen general · progreso ──────────────────────────── */}
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] opacity-85 mb-1">
            Resumen general
          </div>
          <div className="text-[13px] opacity-90 mb-3">
            Tu eficiencia de capital hoy
          </div>

          {/* Barra de progreso con hitos */}
          <div className="relative">
            <div className="h-2 rounded-full bg-white/25 overflow-hidden">
              {/* Segmento 0-60 rojo, 60-85 amarillo, 85-100 verde */}
              <div className="h-full flex">
                <div className="h-full bg-rose-500/85" style={{ width: "60%" }} />
                <div className="h-full bg-amber-400/85" style={{ width: "25%" }} />
                <div className="h-full bg-emerald-400/85" style={{ width: "15%" }} />
              </div>
            </div>
            {/* Marcador del score actual */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
              style={{ left: `${markerLeft}%` }}
            >
              <div className="size-4 rounded-full bg-white shadow-md ring-2 ring-white/40" />
            </div>
          </div>

          {/* Hitos numéricos */}
          <div className="relative mt-2 text-[10px] opacity-80">
            {HITOS.map((h) => (
              <span
                key={h}
                className="absolute -translate-x-1/2 mono"
                style={{ left: `${h}%` }}
              >
                {h}
              </span>
            ))}
          </div>
        </div>

        {/* ─── 3. Cómo llegar a 100 ───────────────────────────────────── */}
        <div className="text-right lg:text-right">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] opacity-85 mb-1">
            Cómo llegar a 100
          </div>
          <div className="text-[12px] opacity-90 mb-2">
            Si corriges las brechas actuales
          </div>
          <div className="flex items-end justify-end gap-2">
            <div>
              <div className="text-[13px] opacity-85">
                subes de <b className="text-[16px]">{score}</b> a
              </div>
              <div className="text-[36px] font-bold tracking-tight leading-none mono mt-1">
                {proyeccion} pts
              </div>
            </div>
            <TrendingUp
              className="size-9 opacity-80 -translate-y-1"
              strokeWidth={2}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function BadgeEstado({ estado }: { estado: EstadoScore }) {
  const Icon = estado === "bueno" ? CheckCircle2 : AlertTriangle;
  return (
    <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-md bg-white/15 border border-white/20 text-[12px] font-semibold uppercase tracking-[0.08em]">
      <Icon className="size-3.5" />
      {ESTADO_LABEL[estado]}
    </div>
  );
}
