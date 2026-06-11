"use client";

/**
 * Gráficos de /tendencias — evolución del capital de trabajo por corte.
 *
 * Reglas visuales (decisión usuario 2026-06):
 *   · Eje X categórico: SOLO fechas con cargas reales. Sin interpolación,
 *     sin días inventados (connectNulls=false → hueco visible si un corte
 *     no tiene el componente).
 *   · Doble eje: unidades a la izquierda · monto $ a la derecha.
 *   · Cada punto = un snapshot real (dot siempre visible).
 */

import {
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtCLPCompact, fmtNum } from "@/lib/format";

export interface PuntoIndicador {
  /** Label del corte, ej. "07-jun". */
  corte: string;
  unidades: number | null;
  monto: number | null;
}

export interface PuntoScore {
  corte: string;
  score: number | null;
}

const COLOR_UNIDADES = "#3358e8"; // accent
const COLOR_MONTO = "#d97706"; // warning/ámbar — contraste claro con unidades
const COLOR_SCORE = "#059669"; // emerald

const tickStyle = { fontSize: 11, fill: "#6b7280" };

function TooltipIndicador({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number | string | null }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const unidades = payload.find((p) => p.dataKey === "unidades")?.value;
  const monto = payload.find((p) => p.dataKey === "monto")?.value;
  return (
    <div className="rounded-lg border border-[--color-border] bg-white px-3 py-2 shadow-md text-[12px]">
      <div className="font-semibold text-[--color-fg] mb-1">{label}</div>
      {unidades != null && (
        <div style={{ color: COLOR_UNIDADES }}>{fmtNum(Number(unidades))} unidades</div>
      )}
      {monto != null && (
        <div style={{ color: COLOR_MONTO }}>{fmtCLPCompact(Number(monto))}</div>
      )}
    </div>
  );
}

export function GraficoIndicador({ puntos }: { puntos: PuntoIndicador[] }) {
  return (
    <div className="h-[230px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={puntos} margin={{ top: 12, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="corte" tick={tickStyle} tickLine={false} axisLine={{ stroke: "#e5e7eb" }} />
          <YAxis
            yAxisId="unidades"
            tick={tickStyle}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(v: number) => fmtNum(v)}
          />
          <YAxis
            yAxisId="monto"
            orientation="right"
            tick={tickStyle}
            tickLine={false}
            axisLine={false}
            width={62}
            tickFormatter={(v: number) => fmtCLPCompact(v)}
          />
          <Tooltip content={<TooltipIndicador />} />
          <Line
            yAxisId="unidades"
            type="monotone"
            dataKey="unidades"
            stroke={COLOR_UNIDADES}
            strokeWidth={2.5}
            dot={{ r: 4, fill: COLOR_UNIDADES }}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="monto"
            type="monotone"
            dataKey="monto"
            stroke={COLOR_MONTO}
            strokeWidth={2.5}
            strokeDasharray="6 3"
            dot={{ r: 4, fill: COLOR_MONTO }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function GraficoScore({ puntos }: { puntos: PuntoScore[] }) {
  return (
    <div className="h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={puntos} margin={{ top: 12, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="corte" tick={tickStyle} tickLine={false} axisLine={{ stroke: "#e5e7eb" }} />
          <YAxis
            domain={[0, 100]}
            tick={tickStyle}
            tickLine={false}
            axisLine={false}
            width={36}
          />
          <Tooltip
            formatter={(v) => [`${v ?? "—"} / 100`, "Score Gerencial"]}
            labelStyle={{ fontSize: 12, fontWeight: 600 }}
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
          />
          <Line
            type="monotone"
            dataKey="score"
            stroke={COLOR_SCORE}
            strokeWidth={2.5}
            dot={{ r: 4, fill: COLOR_SCORE }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Leyenda compacta unidades/monto compartida por las cards de indicador. */
export function LeyendaIndicador() {
  return (
    <div className="flex items-center gap-4 text-[11px] text-[--color-fg-muted]">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-4 h-0.5 rounded" style={{ background: COLOR_UNIDADES }} />
        Unidades (eje izq.)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block w-4 h-0.5 rounded"
          style={{
            background: `repeating-linear-gradient(90deg, ${COLOR_MONTO} 0 4px, transparent 4px 7px)`,
          }}
        />
        Monto $ (eje der.)
      </span>
    </div>
  );
}
