"use client";

/**
 * Banner "Cómo llegar a 100" · acciones recomendadas + proyección.
 *
 * 3 columnas:
 *   1. Ícono + título + subtítulo
 *   2. Lista de acciones con puntos ganables (ordenadas DESC)
 *   3. Proyección · "Subes de X a Y pts"
 *
 * Usa los iconos del sistema (Banknote, Truck, Wallet, Receipt) según el
 * indicador para que el ojo conecte cada acción con su card resumida.
 */

import {
  TrendingUp,
  Receipt,
  Truck,
  Wallet,
  Banknote,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  ScoreGerencialResultado,
  IndicadorId,
} from "@/lib/selectors/score-gerencial";

const ICON_POR_INDICADOR: Record<IndicadorId, LucideIcon> = {
  stock_propio: Wallet,
  provisiones_90d: Receipt,
  cp_15d: Banknote,
  saldos_t3: Truck,
};

const COLOR_POR_INDICADOR: Record<IndicadorId, string> = {
  stock_propio: "#1F2A44",
  provisiones_90d: "#B83B6A",
  cp_15d: "#8E44AD",
  saldos_t3: "#E67E22",
};

export function PlanLlegarA100Banner({
  resultado,
}: {
  resultado: ScoreGerencialResultado;
}) {
  const { score, plan } = resultado;
  const proyeccion = Math.min(
    100,
    score + plan.reduce((s, p) => s + p.puntosGanables, 0),
  );

  if (plan.length === 0) {
    return (
      <div className="surface bg-[--color-ok]/8 border border-[--color-ok]/30 px-5 py-4">
        <div className="flex items-center gap-2 text-[--color-ok]">
          <TrendingUp className="size-4" />
          <span className="text-[13px] font-semibold">
            ✓ Score completo · todos los indicadores en meta. Sin brechas que corregir.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      // Texto default oscuro (NO text-white) · fondo crema con borde + sombra.
      className="rounded-2xl text-[--color-fg] shadow-md overflow-hidden border border-[--color-warning]/20"
      style={{
        background:
          "linear-gradient(135deg, #FFE5D6 0%, #FFF1E0 100%)",
      }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_220px] gap-5 px-5 py-4 items-center">
        {/* ─── 1. Título ─────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#7C2D12]">
            <TrendingUp className="size-3.5 text-[#7C2D12]" />
            Cómo llegar a 100
          </div>
          <div className="text-[14px] font-semibold text-[--color-fg] tracking-tight mt-1">
            Acciones recomendadas por impacto
          </div>
          <div className="text-[11px] text-[#7C2D12]/70 mt-0.5">
            Ordenadas por puntos ganables.
          </div>
        </div>

        {/* ─── 2. Lista de acciones ─────────────────────────────────── */}
        <ul className="space-y-1.5">
          {plan.map((p) => {
            const Icon = ICON_POR_INDICADOR[p.indicador];
            const color = COLOR_POR_INDICADOR[p.indicador];
            return (
              <li
                key={p.indicador}
                className="flex items-center justify-between gap-3 bg-white/95 rounded-md px-3 py-2 shadow-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icon className="size-3.5 shrink-0" style={{ color }} />
                  <span className="text-[12px] text-[--color-fg] font-medium truncate">
                    {p.accion}
                  </span>
                </div>
                <span
                  className="shrink-0 text-[13px] font-bold mono"
                  style={{ color }}
                >
                  +{p.puntosGanables} pts
                </span>
              </li>
            );
          })}
        </ul>

        {/* ─── 3. Proyección ─────────────────────────────────────────── */}
        <div className="bg-white rounded-lg px-4 py-3 border border-[--color-ok]/30 text-center shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[--color-fg-muted]">
            Proyección
          </div>
          <div className="text-[11.5px] text-[--color-fg-muted] mt-1">
            Subes de <b className="text-[--color-fg]">{score}</b> a
          </div>
          <div className="text-[32px] font-bold tracking-tight leading-none mono text-[--color-ok] mt-1">
            {proyeccion}{" "}
            <span className="text-[14px] font-semibold opacity-80">pts</span>
          </div>
          <div className="text-[10px] text-[--color-fg-muted] mt-1.5">
            Corrigiendo todas las brechas
          </div>
        </div>
      </div>
    </div>
  );
}
