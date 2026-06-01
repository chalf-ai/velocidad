"use client";

/**
 * Velocidad por tramo · tabla compacta secundaria.
 *
 * 3 tramos del flujo:
 *   · Compra → Almacén           (carga marca → bodega operador)
 *   · Almacén → Solicitud        = Motor 1
 *   · Solicitud → Despacho       = Motor 2
 *
 * Para cada uno: N, mediana, avg, P90, max, responsable.
 */

import { Clock } from "lucide-react";
import { fmtNum } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import type { MotorStats } from "@/lib/logistica/log-motor1-disponibilidad";
import { COLOR_POR_OWNER, LABEL_OWNER, type OwnerLog } from "@/lib/logistica/log-responsables";

export interface TramoRow {
  id: string;
  label: string;
  cubre: string;
  owner: OwnerLog | "MARCA_OPERADOR";
  stats: MotorStats;
}

const OWNER_TXT: Record<OwnerLog | "MARCA_OPERADOR", string> = {
  SUCURSAL_COMERCIAL: LABEL_OWNER.SUCURSAL_COMERCIAL,
  OPERADOR: LABEL_OWNER.OPERADOR,
  MARCA_OPERADOR: "Marca + Operador",
};

const OWNER_COLOR: Record<OwnerLog | "MARCA_OPERADOR", string> = {
  ...COLOR_POR_OWNER,
  MARCA_OPERADOR: "#7C3AED",
};

export function VelocidadTramoTabla({ tramos }: { tramos: TramoRow[] }) {
  return (
    <div className="surface bg-white px-5 py-4">
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="text-[15px] font-semibold tracking-tight text-[--color-fg] flex items-center gap-2">
          <Clock className="size-4 text-[--color-accent]" />
          Velocidad por tramo
        </h2>
        <span className="text-[12px] text-[--color-fg-muted]">
          · 3 tramos del flujo con N + mediana + avg + P90 + max
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[680px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-[0.05em] text-[--color-fg-muted] bg-[--color-bg-elev-1]">
              <th className="px-3 py-2 font-semibold">Tramo</th>
              <th className="px-3 py-2 font-semibold">Responsable</th>
              <th className="px-3 py-2 font-semibold text-right">N</th>
              <th className="px-3 py-2 font-semibold text-right">Mediana</th>
              <th className="px-3 py-2 font-semibold text-right">Avg</th>
              <th className="px-3 py-2 font-semibold text-right">P90</th>
              <th className="px-3 py-2 font-semibold text-right">Max</th>
            </tr>
          </thead>
          <tbody>
            {tramos.map((t, idx) => (
              <tr
                key={t.id}
                className={idx % 2 === 0 ? "bg-white" : "bg-[--color-bg-elev-1]/30"}
              >
                <td className="px-3 py-2">
                  <div className="font-semibold text-[--color-fg]">{t.label}</div>
                  <div className="text-[10.5px] text-[--color-fg-muted]">
                    {t.cubre}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Badge tone="muted" size="xs">
                    <span
                      className="inline-block size-1.5 rounded-sm mr-1"
                      style={{ backgroundColor: OWNER_COLOR[t.owner] }}
                    />
                    {OWNER_TXT[t.owner]}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right mono text-[--color-fg]">
                  {fmtNum(t.stats.n)}
                </td>
                <td className="px-3 py-2 text-right mono text-[--color-fg] font-bold">
                  {t.stats.mediana != null ? `${t.stats.mediana.toFixed(1)} d` : "—"}
                </td>
                <td className="px-3 py-2 text-right mono text-[--color-fg-muted]">
                  {t.stats.avg != null ? `${t.stats.avg.toFixed(1)} d` : "—"}
                </td>
                <td className="px-3 py-2 text-right mono text-[--color-fg-muted]">
                  {t.stats.p90 != null ? `${t.stats.p90.toFixed(0)} d` : "—"}
                </td>
                <td className="px-3 py-2 text-right mono text-[--color-fg-dim]">
                  {t.stats.max != null ? `${t.stats.max.toFixed(0)} d` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
