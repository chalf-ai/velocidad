"use client";

/**
 * Rankings al pie del módulo · brief §10.
 *
 * Selector de criterio dentro del bloque (NO global). Comparación por canal
 * separada para no mezclar universos.
 */

import { useState } from "react";
import { ChevronDown, ChevronUp, BarChart3 } from "lucide-react";
import { fmtNum, fmtCLPCompact } from "@/lib/format";
import { cn } from "@/lib/cn";
import type {
  RankingsCN,
  CriterioRanking,
} from "@/lib/control-de-negocio/cn-rankings";
import { LABEL_CANAL } from "@/lib/control-de-negocio/cn-canales";

export function RankingsSection({
  rankings,
  criterio,
  onCriterioChange,
}: {
  rankings: RankingsCN;
  criterio: CriterioRanking;
  onCriterioChange: (c: CriterioRanking) => void;
}) {
  const [abierto, setAbierto] = useState(false);

  return (
    <div className="surface bg-white">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="w-full px-5 py-4 flex items-center gap-2 text-left"
      >
        <BarChart3 className="size-4 text-[--color-fg-muted]" />
        <span className="text-[14px] font-semibold tracking-tight text-[--color-fg]">
          Rankings · sucursales y canales
        </span>
        <span className="text-[11px] text-[--color-fg-dim] ml-2">
          ≥30 facturas · ≥10 entregas para rankings de tiempo
        </span>
        <span className="ml-auto text-[--color-fg-muted]">
          {abierto ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </span>
      </button>

      {abierto && (
        <div className="px-5 pb-5 space-y-4 border-t border-[--color-border]">
          {/* Selector de criterio */}
          <div className="flex items-center gap-2 pt-3 flex-wrap">
            <span className="text-[11px] text-[--color-fg-muted] mr-1">Criterio:</span>
            <CriterioBtn
              value="mediana_fac_entrega"
              activo={criterio === "mediana_fac_entrega"}
              onClick={onCriterioChange}
            >
              Mediana Factura → Entrega
            </CriterioBtn>
            <CriterioBtn
              value="procesos_quebrados"
              activo={criterio === "procesos_quebrados"}
              onClick={onCriterioChange}
            >
              Procesos quebrados
            </CriterioBtn>
            <CriterioBtn
              value="fne_monto"
              activo={criterio === "fne_monto"}
              onClick={onCriterioChange}
            >
              FNE retenido $
            </CriterioBtn>
          </div>

          {/* Sucursales lentas y rápidas */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <TablaSucursales
              titulo="Sucursales más lentas (top 10)"
              rows={rankings.sucursalesLentas.rows}
              criterio={criterio}
              tono="danger"
            />
            <TablaSucursales
              titulo="Sucursales más rápidas (top 10)"
              rows={rankings.sucursalesRapidas.rows}
              criterio={criterio}
              tono="ok"
            />
          </div>

          {/* Por canal */}
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[--color-fg-muted] mb-1.5">
              Comparación por canal · universos separados
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-[0.05em] text-[--color-fg-muted] border-b border-[--color-border]">
                    <th className="py-1.5 px-2">Canal</th>
                    <th className="py-1.5 px-2 text-right">Facturados</th>
                    <th className="py-1.5 px-2 text-right">Entregados</th>
                    <th className="py-1.5 px-2 text-right">FNE</th>
                    <th className="py-1.5 px-2 text-right">FNE $</th>
                    <th className="py-1.5 px-2 text-right">Mediana Fac→Ent</th>
                  </tr>
                </thead>
                <tbody>
                  {rankings.porCanal.map((r) => (
                    <tr key={r.canal} className="border-b border-[--color-border]/40">
                      <td className="py-1.5 px-2 text-[--color-fg]">
                        {LABEL_CANAL[r.canal]}
                      </td>
                      <td className="py-1.5 px-2 text-right mono">{fmtNum(r.facturados)}</td>
                      <td className="py-1.5 px-2 text-right mono">{fmtNum(r.entregados)}</td>
                      <td className="py-1.5 px-2 text-right mono text-[--color-danger]">
                        {fmtNum(r.fne)}
                      </td>
                      <td className="py-1.5 px-2 text-right mono text-[--color-danger]">
                        {fmtCLPCompact(r.fneMonto)}
                      </td>
                      <td className="py-1.5 px-2 text-right mono">
                        {r.medianaFacturaEntrega != null
                          ? `${r.medianaFacturaEntrega.toFixed(1)}d`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CriterioBtn({
  value,
  activo,
  onClick,
  children,
}: {
  value: CriterioRanking;
  activo: boolean;
  onClick: (c: CriterioRanking) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={() => onClick(value)}
      className={cn(
        "text-[11px] rounded-md border px-2.5 py-1 transition",
        activo
          ? "border-[--color-accent] bg-[--color-accent]/[0.08] text-[--color-accent] font-semibold"
          : "border-[--color-border] text-[--color-fg-muted] hover:text-[--color-fg]",
      )}
    >
      {children}
    </button>
  );
}

function TablaSucursales({
  titulo,
  rows,
  criterio,
  tono,
}: {
  titulo: string;
  rows: { key: string; facturados: number; entregados: number; fne: number; fneMonto: number; medianaFacturaEntrega: number | null; procesosQuebrados: number }[];
  criterio: CriterioRanking;
  tono: "ok" | "danger";
}) {
  const colSrt =
    tono === "ok" ? "text-[--color-ok]" : "text-[--color-danger]";
  return (
    <div className="rounded-md border border-[--color-border]">
      <div className="px-3 py-2 border-b border-[--color-border] text-[11px] font-semibold uppercase tracking-[0.05em] text-[--color-fg-muted]">
        {titulo}
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-4 text-[11.5px] text-[--color-fg-dim] text-center">
          Sin sucursales que cumplan los mínimos.
        </div>
      ) : (
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.05em] text-[--color-fg-dim] border-b border-[--color-border]/60">
              <th className="py-1 px-3">#</th>
              <th className="py-1 px-3">Sucursal</th>
              <th className="py-1 px-3 text-right">Criterio</th>
              <th className="py-1 px-3 text-right">Fact</th>
              <th className="py-1 px-3 text-right">FNE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="border-b border-[--color-border]/30">
                <td className="py-1 px-3 text-[--color-fg-dim] mono">{i + 1}</td>
                <td className="py-1 px-3 text-[--color-fg] truncate max-w-[180px]">{r.key}</td>
                <td className={`py-1 px-3 text-right mono font-semibold ${colSrt}`}>
                  {criterio === "mediana_fac_entrega"
                    ? r.medianaFacturaEntrega != null
                      ? `${r.medianaFacturaEntrega.toFixed(1)}d`
                      : "—"
                    : criterio === "procesos_quebrados"
                    ? fmtNum(r.procesosQuebrados)
                    : fmtCLPCompact(r.fneMonto)}
                </td>
                <td className="py-1 px-3 text-right mono text-[--color-fg-muted]">
                  {fmtNum(r.facturados)}
                </td>
                <td className="py-1 px-3 text-right mono text-[--color-fg-muted]">
                  {fmtNum(r.fne)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
