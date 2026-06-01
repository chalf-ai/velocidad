"use client";

/**
 * Stock crítico · DOS familias separadas.
 *
 *   Familia A · En bodega sin solicitud (responsable: Sucursal + Comercial)
 *     · stock esperando que la sucursal pida despacho.
 *     · aging desde fIngresoApc.
 *
 *   Familia B · Solicitados sin despacho (responsable: Operador)
 *     · ejecución pendiente del operador.
 *     · aging desde fSolicitudBodega.
 *
 * Decisión explícita del usuario: NO mezclar. Cada familia tiene su propio
 * grid de 3 bandas (0-30 / 31-60 / >60).
 *
 * Drill INLINE: click en una banda abre la cola gestionable debajo de la
 * sección (igual que el patrón CN).
 */

import { useEffect, useRef, useMemo, type ReactNode } from "react";
import { Boxes } from "lucide-react";
import { StockBandaCard } from "./StockBandaCard";
import {
  COLOR_POR_OWNER,
  LABEL_OWNER,
} from "@/lib/logistica/log-responsables";
import type {
  ResultadoStockCritico,
  ResultadoFamilia,
  BandaAging,
  FamiliaStock,
} from "@/lib/logistica/log-stock-critico";
import type { LogisticaOperacionVIN } from "@/lib/logistica/modelo";
import { fmtNum } from "@/lib/format";

export type FocoBanda = { familia: FamiliaStock; banda: BandaAging["id"] } | null;

export function StockCriticoSection({
  resultado,
  foco,
  onFoco,
  colaInferior,
}: {
  resultado: ResultadoStockCritico;
  foco: FocoBanda;
  onFoco: (f: FocoBanda) => void;
  colaInferior?: ReactNode;
}) {
  const colaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (colaInferior && colaRef.current) {
      colaRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [colaInferior, foco]);

  return (
    <div className="surface bg-white px-5 py-5">
      <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-[--color-fg] flex items-center gap-2">
            <Boxes className="size-4 text-[--color-accent]" />
            Stock crítico
          </h2>
          <p className="text-[12px] text-[--color-fg-muted] mt-0.5">
            Dos familias con dueños distintos. No se mezclan.
          </p>
        </div>
      </div>

      <div className="space-y-5">
        {resultado.familias.map((fam) => (
          <FamiliaBlock
            key={fam.familia}
            familia={fam}
            foco={foco}
            onFoco={onFoco}
          />
        ))}
      </div>

      {colaInferior && (
        <div ref={colaRef} className="mt-4 scroll-mt-4">
          {colaInferior}
        </div>
      )}
    </div>
  );
}

function FamiliaBlock({
  familia,
  foco,
  onFoco,
}: {
  familia: ResultadoFamilia;
  foco: FocoBanda;
  onFoco: (f: FocoBanda) => void;
}) {
  const color = COLOR_POR_OWNER[familia.owner];

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-block size-2.5 rounded-sm"
            style={{ backgroundColor: color }}
          />
          <span className="text-[13px] font-semibold text-[--color-fg]">
            {familia.familia === "sin_solicitud"
              ? "En bodega sin solicitud"
              : "Solicitados sin despacho"}
          </span>
          <span className="text-[11px] text-[--color-fg-muted]">
            · {LABEL_OWNER[familia.owner]}
          </span>
        </div>
        <div className="text-[11.5px] text-[--color-fg-muted]">
          {fmtNum(familia.total)} vehículos · {familia.cubre}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {familia.bandas.map((banda) => {
          const active = foco?.familia === familia.familia && foco.banda === banda.id;
          return (
            <BandaWithTops
              key={banda.id}
              banda={banda}
              color={color}
              active={active}
              onClick={() =>
                onFoco(active ? null : { familia: familia.familia, banda: banda.id })
              }
            />
          );
        })}
      </div>
    </div>
  );
}

function BandaWithTops({
  banda,
  color,
  active,
  onClick,
}: {
  banda: BandaAging;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  const topMarcas = useMemo(() => topN(banda.filas, (op) => op.marca, 3), [banda.filas]);
  const topSucursales = useMemo(
    () => topN(banda.filas, (op) => op.sucursalDestino, 3),
    [banda.filas],
  );
  return (
    <StockBandaCard
      banda={banda}
      color={color}
      active={active}
      onClick={onClick}
      topMarcas={topMarcas}
      topSucursales={topSucursales}
    />
  );
}

function topN(
  filas: LogisticaOperacionVIN[],
  pick: (op: LogisticaOperacionVIN) => string | null | undefined,
  n: number,
): Array<{ label: string; n: number }> {
  const m = new Map<string, number>();
  for (const op of filas) {
    const k = (pick(op) ?? "").trim();
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Array.from(m, ([label, n]) => ({ label, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, n);
}
