"use client";

/**
 * Cumplimiento por operador · barras KAR vs SCHIAPP + heatmap operador×marca.
 *
 * Lectura ejecutiva del Motor 3: brecha entre operadores y diagnóstico por
 * combinaciones operador-marca que están por debajo del umbral.
 */

import { Activity } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import { COLOR_OPERADOR } from "@/lib/logistica/log-responsables";
import type { ResultadoMotor3 } from "@/lib/logistica/log-motor3-cumplimiento";

const UMBRAL_OK = 85;
const UMBRAL_WARN = 70;

function toneByPct(pct: number | null): "ok" | "warn" | "danger" | "muted" {
  if (pct == null) return "muted";
  if (pct >= UMBRAL_OK) return "ok";
  if (pct >= UMBRAL_WARN) return "warn";
  return "danger";
}

export function CumplimientoOperadorSection({
  resultado,
}: {
  resultado: ResultadoMotor3;
}) {
  return (
    <div className="surface bg-white px-5 py-5">
      <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-[--color-fg] flex items-center gap-2">
            <Activity className="size-4 text-[--color-accent]" />
            Cumplimiento por operador
          </h2>
          <p className="text-[12px] text-[--color-fg-muted] mt-0.5">
            Comparación KAR vs SCHIAPP y heatmap por marca · responsable: operador.
          </p>
        </div>
        {resultado.brechaPp != null && (
          <Badge tone={Math.abs(resultado.brechaPp) >= 10 ? "danger" : "warning"} size="sm">
            Brecha {Math.abs(resultado.brechaPp).toFixed(1)} pp
          </Badge>
        )}
      </div>

      {/* Barras horizontales · KAR vs SCHIAPP */}
      <div className="space-y-2 mb-4">
        <BarraOperador
          operador="KAR"
          pct={resultado.porOperador.KAR.pct}
          n={resultado.porOperador.KAR.total}
        />
        <BarraOperador
          operador="SCHIAPP"
          pct={resultado.porOperador.SCHIAPP.pct}
          n={resultado.porOperador.SCHIAPP.total}
        />
      </div>

      {/* Heatmap operador × marca */}
      {resultado.matriz.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[--color-fg-dim] mb-2">
            Cumplimiento por operador × marca · peores primero
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[520px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-[0.05em] text-[--color-fg-muted] bg-[--color-bg-elev-1]">
                  <th className="px-3 py-2 font-semibold">Marca</th>
                  <th className="px-3 py-2 font-semibold">Operador</th>
                  <th className="px-3 py-2 font-semibold text-right">% Cumpl.</th>
                  <th className="px-3 py-2 font-semibold text-right">N</th>
                  <th className="px-3 py-2 font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody>
                {resultado.matriz.slice(0, 15).map((c, idx) => {
                  const tone = toneByPct(c.stats.pct);
                  return (
                    <tr
                      key={`${c.operador}-${c.marca}`}
                      className={cn(
                        "border-b border-[--color-border-soft]",
                        idx % 2 === 0
                          ? "bg-white"
                          : "bg-[--color-bg-elev-1]/30",
                      )}
                    >
                      <td className="px-3 py-2 font-semibold text-[--color-fg]">
                        {c.marca}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="inline-flex items-center gap-1.5 text-[11.5px]"
                          style={{ color: COLOR_OPERADOR[c.operador] }}
                        >
                          <span
                            className="inline-block size-2 rounded-sm"
                            style={{ backgroundColor: COLOR_OPERADOR[c.operador] }}
                          />
                          {c.operador}
                        </span>
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right mono font-bold",
                          tone === "ok"
                            ? "text-[--color-ok]"
                            : tone === "warn"
                              ? "text-[--color-warning]"
                              : tone === "danger"
                                ? "text-[--color-danger]"
                                : "text-[--color-fg-muted]",
                        )}
                      >
                        {c.stats.pct != null ? `${c.stats.pct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right mono text-[--color-fg-muted]">
                        {fmtNum(c.stats.total)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          tone={
                            tone === "ok"
                              ? "success"
                              : tone === "warn"
                                ? "warning"
                                : tone === "danger"
                                  ? "danger"
                                  : "muted"
                          }
                          size="xs"
                        >
                          {tone === "ok"
                            ? "OK"
                            : tone === "warn"
                              ? "atención"
                              : tone === "danger"
                                ? "crítico"
                                : "—"}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function BarraOperador({
  operador,
  pct,
  n,
}: {
  operador: "KAR" | "SCHIAPP";
  pct: number | null;
  n: number;
}) {
  const tone = toneByPct(pct);
  const color = COLOR_OPERADOR[operador];
  const ancho = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div className="flex items-center gap-3">
      <div className="w-[100px] shrink-0 flex items-center gap-2 text-[12.5px] font-semibold text-[--color-fg]">
        <span
          className="inline-block size-2.5 rounded-sm shrink-0"
          style={{ backgroundColor: color }}
        />
        {operador}
      </div>
      <div className="flex-1 h-5 rounded-md bg-[--color-bg-elev-1] overflow-hidden relative">
        <div
          className="h-full transition-all rounded-md"
          style={{ width: `${ancho}%`, backgroundColor: color, opacity: 0.9 }}
        />
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10.5px] text-white font-bold mono mix-blend-luminosity">
          {pct != null ? `${pct.toFixed(1)}%` : "—"}
        </span>
      </div>
      <div className="text-[11px] text-[--color-fg-muted] mono w-[70px] text-right">
        {fmtNum(n)} casos
      </div>
      <Badge tone={tone === "ok" ? "success" : tone === "warn" ? "warning" : tone === "danger" ? "danger" : "muted"} size="xs">
        {tone === "ok" ? "OK" : tone === "warn" ? "atención" : tone === "danger" ? "crítico" : "—"}
      </Badge>
    </div>
  );
}
