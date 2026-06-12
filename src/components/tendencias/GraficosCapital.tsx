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

/** Metadatos de auditoría de un corte, mostrados en el tooltip. */
export interface MetaCorte {
  /** Fecha de corte humanizada, ej. "04 jun 2026". */
  fechaCorte: string;
  /** Días en que se cargaron los archivos del corte, ej. ["07-jun"]. */
  fechasCarga: string[];
  /** Cobertura por tipo: etiqueta + archivo considerado (null = falta). */
  cobertura: { etiqueta: string; archivo: string | null }[];
}

export interface PuntoIndicador {
  /** Label del corte, ej. "04-jun" (fecha de CORTE, no de carga). */
  corte: string;
  unidades: number | null;
  monto: number | null;
  meta?: MetaCorte;
}

export interface PuntoScore {
  corte: string;
  score: number | null;
  meta?: MetaCorte;
}

const COLOR_UNIDADES = "#3358e8"; // accent
const COLOR_MONTO = "#d97706"; // warning/ámbar — contraste claro con unidades
const COLOR_SCORE = "#059669"; // emerald

const tickStyle = { fontSize: 11, fill: "#6b7280" };

/** Bloque de auditoría compartido por los tooltips: corte, cargas, cobertura. */
function MetaCorteDetalle({ meta }: { meta: MetaCorte }) {
  return (
    <div className="mt-1.5 pt-1.5 border-t border-[--color-border] text-[11px] text-[--color-fg-muted] space-y-0.5">
      <div>
        <span className="font-medium text-[--color-fg]">Corte:</span> {meta.fechaCorte}
      </div>
      {meta.fechasCarga.length > 0 && (
        <div>
          <span className="font-medium text-[--color-fg]">Cargado:</span>{" "}
          {meta.fechasCarga.join(" · ")}
        </div>
      )}
      <div className="pt-0.5">
        {meta.cobertura.map((c) => (
          <div key={c.etiqueta} className="flex items-baseline gap-1">
            <span className={c.archivo ? "text-emerald-600" : "text-red-500"}>
              {c.archivo ? "✓" : "✗"}
            </span>
            <span className="font-medium">{c.etiqueta}</span>
            {c.archivo ? (
              <span className="truncate max-w-[220px]">· {c.archivo}</span>
            ) : (
              <span className="italic">sin archivo en este corte</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TooltipIndicador({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey?: string | number;
    value?: number | string | null;
    payload?: PuntoIndicador;
  }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const unidades = payload.find((p) => p.dataKey === "unidades")?.value;
  const monto = payload.find((p) => p.dataKey === "monto")?.value;
  const meta = payload[0]?.payload?.meta;
  return (
    <div className="rounded-lg border border-[--color-border] bg-white px-3 py-2 shadow-md text-[12px]">
      <div className="font-semibold text-[--color-fg] mb-1">{label}</div>
      {unidades != null && (
        <div style={{ color: COLOR_UNIDADES }}>{fmtNum(Number(unidades))} unidades</div>
      )}
      {monto != null && (
        <div style={{ color: COLOR_MONTO }}>{fmtCLPCompact(Number(monto))}</div>
      )}
      {meta && <MetaCorteDetalle meta={meta} />}
    </div>
  );
}

function TooltipScore({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number | string | null; payload?: PuntoScore }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const score = payload[0]?.value;
  const meta = payload[0]?.payload?.meta;
  return (
    <div className="rounded-lg border border-[--color-border] bg-white px-3 py-2 shadow-md text-[12px]">
      <div className="font-semibold text-[--color-fg] mb-1">{label}</div>
      <div style={{ color: COLOR_SCORE }}>{score ?? "—"} / 100 · Score Gerencial</div>
      {meta && <MetaCorteDetalle meta={meta} />}
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
          <Tooltip content={<TooltipScore />} />
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
