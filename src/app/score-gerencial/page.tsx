"use client";

/**
 * /score-gerencial · Score Gerencial de Eficiencia de Capital · V2 visual.
 *
 * Layout en 5 bloques:
 *   1. PageHeader · kicker + título + corte
 *   2. HeroScore · banner ejecutivo gradiente (score + barra + llegar a 100)
 *   3. Grid IndicadorResumido · 4 cards compactas con gauge
 *   4. PlanLlegarA100Banner · banner con acciones recomendadas + proyección
 *   5. Grid IndicadorCard · 4 cards detalladas con drill clickeable
 *   6. Cola gestionable inline + nota al pie + capital gestionado secundario
 *
 * Cero cambios a fórmulas/pesos/selectores.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Trophy } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { useDatosFiltrados } from "@/lib/marca-filtro";
import { useMarcaFilter } from "@/lib/marca-filtro";
import { useExcelStore } from "@/lib/store";
import { fmtDate, fmtCLPCompact } from "@/lib/format";
import { buildVehiculosUnificados } from "@/lib/selectors/vehiculo-unificado";

import { HeroScore } from "@/components/score-gerencial/HeroScore";
import { IndicadorResumido } from "@/components/score-gerencial/IndicadorResumido";
import { PlanLlegarA100Banner } from "@/components/score-gerencial/PlanLlegarA100Banner";
import { IndicadorCard } from "@/components/score-gerencial/IndicadorCard";
import { ColaIndicador } from "@/components/score-gerencial/ColaIndicador";

import {
  calcularScoreGerencial,
  type IndicadorId,
} from "@/lib/selectors/score-gerencial";

export default function ScoreGerencialPage() {
  const datos = useDatosFiltrados();
  const marcaGlobal = useMarcaFilter((s) => s.marca);
  const corte = useExcelStore((s) => s.data?.report?.fechaCorteExcel ?? null);
  const [foco, setFoco] = useState<IndicadorId | null>(null);
  const colaRef = useRef<HTMLDivElement>(null);

  // Universo VU (filtrado por marca/sucursal globales)
  const vus = useMemo(() => {
    if (!datos.data) return [];
    const map = buildVehiculosUnificados({
      data: datos.data,
      fne: datos.fne,
      saldos: datos.saldos,
    });
    return Array.from(map.values());
  }, [datos.data, datos.fne, datos.saldos]);

  const resultado = useMemo(() => {
    if (!datos.data) return null;
    return calcularScoreGerencial({
      marca: marcaGlobal ?? "Todas las marcas",
      vus,
      saldos: datos.saldos?.registros ?? [],
      provisiones: datos.provisiones?.registros ?? [],
    });
  }, [datos.data, datos.saldos, datos.provisiones, vus, marcaGlobal]);

  useEffect(() => {
    if (foco && colaRef.current) {
      colaRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [foco]);

  if (!datos.data || !resultado) {
    return (
      <div className="space-y-4">
        <PageHeader
          kicker="Ejecutivo · Capital"
          kickerIcon={<Trophy className="size-3.5" />}
          title="Score Gerencial"
          description="Cómo está administrando el gerente el capital de su marca."
        />
        <EmptyState
          icon={<Trophy className="size-5" />}
          title="Sin datos cargados"
          description="Carga el Excel macro desde /cargar para ver el score gerencial."
        />
      </div>
    );
  }

  const { capitalGestionado } = resultado;

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Ejecutivo · Capital"
        kickerIcon={<Trophy className="size-3.5" />}
        title="Score Gerencial"
        description="Cómo está administrando el gerente el capital de su marca."
        actions={
          corte ? (
            <div className="text-[11px] text-[--color-fg-muted]">
              Datos al <b className="text-[--color-fg]">{fmtDate(corte)}</b>
            </div>
          ) : null
        }
      />

      {/* 1 · Hero ejecutivo (banner gradiente) */}
      <HeroScore resultado={resultado} />

      {/* 2 · Indicadores resumidos · 4 cards compactas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {resultado.indicadores.map((ind) => (
          <IndicadorResumido
            key={`res-${ind.id}`}
            indicador={ind}
            active={foco === ind.id}
            onClick={() => setFoco(foco === ind.id ? null : ind.id)}
          />
        ))}
      </div>

      {/* 3 · Cómo llegar a 100 (banner siempre visible) */}
      <PlanLlegarA100Banner resultado={resultado} />

      {/* 4 · Indicadores detallados · 4 cards con drill clickeable */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {resultado.indicadores.map((ind) => (
          <IndicadorCard
            key={`det-${ind.id}`}
            indicador={ind}
            active={foco === ind.id}
            onClick={() => setFoco(foco === ind.id ? null : ind.id)}
          />
        ))}
      </div>

      {/* 5 · Cola gestionable activa cuando hay foco */}
      {foco && (
        <div ref={colaRef} className="scroll-mt-4">
          <ColaIndicador resultado={resultado} indicadorId={foco} />
        </div>
      )}

      {/* 6 · Capital gestionado · bloque secundario al pie (no compite con el score) */}
      <div className="surface bg-white px-5 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[--color-fg-muted] mb-2">
          Capital gestionado · contexto
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11.5px]">
          <CapitalMini label="Stock total" value={fmtCLPCompact(capitalGestionado.stockTotal)} sub={`${fmtCLPCompact(capitalGestionado.stockPropio)} propio`} />
          <CapitalMini label="FNE" value={fmtCLPCompact(capitalGestionado.fne)} />
          <CapitalMini label="Saldos vehículo" value={fmtCLPCompact(capitalGestionado.saldos)} />
          <CapitalMini label="Provisiones" value={fmtCLPCompact(capitalGestionado.provisiones)} />
        </div>
      </div>

      {/* Nota al pie */}
      <div className="text-[10.5px] text-[--color-fg-dim] italic leading-snug px-1">
        Score Gerencial mide el cumplimiento de metas operacionales que el gerente
        puede gestionar directamente. Datos consolidados según filtros globales
        (marca y sucursal).
      </div>
    </div>
  );
}

function CapitalMini({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-[0.05em] text-[--color-fg-dim]">
        {label}
      </div>
      <div className="text-[14px] font-bold tracking-tight text-[--color-fg] mono mt-0.5 leading-none">
        {value}
      </div>
      {sub && (
        <div className="text-[10px] text-[--color-fg-dim] mt-0.5">{sub}</div>
      )}
    </div>
  );
}
