"use client";

import { useMemo, useState } from "react";
import { Activity, FlaskConical } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { fmtNum } from "@/lib/format";

import { HistoricoUploader } from "@/components/historico/HistoricoUploader";
import { EstadoCargaPanel } from "@/components/historico/EstadoCargaPanel";
import { FiltrosHistoricoBar } from "@/components/historico/FiltrosHistoricoBar";
import {
  EjeVelocidadCard,
  type FocoVelocidad,
} from "@/components/historico/EjeVelocidadCard";
import {
  EjeCumplimientoCard,
  type FocoCumplimiento,
} from "@/components/historico/EjeCumplimientoCard";
import {
  EjeCalidadCierreCard,
  type FocoCalidadCierre,
} from "@/components/historico/EjeCalidadCierreCard";
import { DrillHistoricoTable } from "@/components/historico/DrillHistoricoTable";
import { TimelineProcesoCard } from "@/components/historico/TimelineProcesoCard";

import { useHistoricoStore } from "@/lib/historico/store-cliente";
import {
  agregadosEje1,
  agregadosEje2,
  agregadosEje3,
  calcularTimelineProceso,
  extraerOpciones,
  filtrarFilas,
  filasDeTramo,
  fingerprintGlobal,
  inferirTipoHuerfano,
  procesoDeCuello,
  FILTROS_VACIOS,
  type FiltrosVista,
  type TramoId,
} from "@/lib/historico/vista-derivados";
import type {
  EntradaConsolidada,
  CuelloPrincipal,
  BucketVelocidad,
} from "@/lib/historico/cruce-roma-actas";
import type { BandaCumplimiento } from "@/lib/historico/cruce-roma-actas";
import type { NivelDocumental } from "@/lib/historico/parser-actas";

export default function VelocidadOperacionalPage() {
  const cruce = useHistoricoStore((s) => s.cruce);
  const [filtros, setFiltros] = useState<FiltrosVista>(FILTROS_VACIOS);
  const [modoValidacion, setModoValidacion] = useState(false);

  // Foco por eje (uno a la vez)
  const [foco1, setFoco1] = useState<FocoVelocidad | null>(null);
  const [foco2, setFoco2] = useState<FocoCumplimiento | null>(null);
  const [foco3, setFoco3] = useState<FocoCalidadCierre | null>(null);
  // Foco de tramo (solo válido cuando foco1.tipo === "cuello" y el cuello es operacional).
  const [focoTramo, setFocoTramo] = useState<TramoId | null>(null);

  const setFocoExclusivo = (n: 1 | 2 | 3, v: unknown) => {
    if (n === 1) {
      setFoco1(v as FocoVelocidad | null);
      setFoco2(null);
      setFoco3(null);
      // Al cambiar el foco 1, el foco de tramo deja de tener sentido.
      setFocoTramo(null);
    } else if (n === 2) {
      setFoco1(null);
      setFoco2(v as FocoCumplimiento | null);
      setFoco3(null);
      setFocoTramo(null);
    } else {
      setFoco1(null);
      setFoco2(null);
      setFoco3(v as FocoCalidadCierre | null);
      setFocoTramo(null);
    }
  };

  const opciones = useMemo(
    () => (cruce ? extraerOpciones(cruce) : { marcas: [], sucursales: [], vendedores: [] }),
    [cruce],
  );

  const filasFiltradas = useMemo(
    () => (cruce ? filtrarFilas(cruce, filtros) : []),
    [cruce, filtros],
  );

  const eje1 = useMemo(() => agregadosEje1(filasFiltradas), [filasFiltradas]);
  const eje2 = useMemo(() => agregadosEje2(filasFiltradas), [filasFiltradas]);
  const eje3 = useMemo(() => agregadosEje3(filasFiltradas), [filasFiltradas]);

  // Timeline activo solo si foco1 es un cuello operacional (Logística, Control de Negocio, Cliente, Comercial).
  const procesoActivo = useMemo(() => {
    if (!foco1 || foco1.tipo !== "cuello") return null;
    return procesoDeCuello(foco1.valor as CuelloPrincipal);
  }, [foco1]);

  const timelineData = useMemo(
    () => (procesoActivo ? calcularTimelineProceso(filasFiltradas, procesoActivo) : null),
    [procesoActivo, filasFiltradas],
  );

  // Drill por eje en foco
  const filasDrill = useMemo<EntradaConsolidada[]>(() => {
    if (!foco1 && !foco2 && !foco3) return [];
    if (foco1) {
      if (foco1.tipo === "cuello") {
        const base = filasFiltradas.filter((f) => f.cuelloPrincipal === (foco1.valor as CuelloPrincipal));
        // Si hay foco de tramo, restringir más a las filas con ambas fechas del tramo
        if (procesoActivo && focoTramo) {
          return filasDeTramo(base, procesoActivo, focoTramo);
        }
        return base;
      }
      return filasFiltradas.filter((f) => f.ejeVelocidad.bucket === (foco1.valor as BucketVelocidad));
    }
    if (foco2) {
      if (foco2.tipo === "nivel")
        return filasFiltradas.filter((f) => f.nivelDocumental === (foco2.valor as NivelDocumental));
      return filasFiltradas.filter(
        (f) => f.ejeCumplimiento.banda === (foco2.valor as BandaCumplimiento),
      );
    }
    if (foco3) {
      if (foco3.tipo === "estado")
        return filasFiltradas.filter(
          (f) => (f.ejeCalidadCierre ?? "no_evaluable") === foco3.valor,
        );
      if (foco3.tipo === "huerfano")
        return filasFiltradas.filter(
          (f) => f.ejeCalidadCierre === "huerfano" && inferirTipoHuerfano(f) === foco3.valor,
        );
      return filasFiltradas.filter(
        (f) =>
          f.ejeCalidadCierre === "inconsistente" &&
          f.conflictos.some((c) => c.esMaterial && c.kind === foco3.valor),
      );
    }
    return [];
  }, [foco1, foco2, foco3, filasFiltradas, procesoActivo, focoTramo]);

  const tituloDrill = useMemo(() => {
    if (foco1) {
      if (foco1.tipo === "cuello") {
        const base = `Cuello: ${foco1.valor}`;
        if (procesoActivo && focoTramo && timelineData) {
          const tramo = timelineData.tramos.find((t) => t.id === focoTramo);
          if (tramo) return `${base} · tramo: ${tramo.label}`;
        }
        return base;
      }
      return `Velocidad: ${foco1.valor}`;
    }
    if (foco2)
      return foco2.tipo === "nivel" ? `Nivel documental: ${foco2.valor}` : `Banda cumplimiento: ${foco2.valor}`;
    if (foco3) {
      if (foco3.tipo === "estado") return `Calidad cierre: ${foco3.valor}`;
      if (foco3.tipo === "huerfano") return `Huérfano: ${foco3.valor}`;
      return `Conflicto: ${foco3.valor}`;
    }
    return "";
  }, [foco1, foco2, foco3, procesoActivo, focoTramo, timelineData]);

  // Fingerprint (modo validación)
  const fingerprint = useMemo(
    () => (cruce ? fingerprintGlobal(cruce) : null),
    [cruce],
  );

  const filasParaDrill = foco1 || foco2 || foco3 ? filasDrill : [];

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="HISTÓRICO"
        kickerIcon={<Activity className="size-3" />}
        title="Vista Histórica · 3 ejes"
        description="Velocidad, Cumplimiento y Calidad de Cierre del universo ROMA × Actas × ROMIA. Carga local, sin persistencia."
        actions={
          <button
            onClick={() => setModoValidacion((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium ring-1 ring-inset transition ${
              modoValidacion
                ? "bg-[--color-accent] text-white ring-[--color-accent]"
                : "bg-[--color-bg-elev-1] text-[--color-fg-muted] ring-[--color-border] hover:ring-[--color-accent]"
            }`}
          >
            <FlaskConical className="size-3.5" />
            Modo validación
          </button>
        }
      />

      <HistoricoUploader />
      <EstadoCargaPanel />

      {!cruce && (
        <EmptyState
          icon={<Activity className="size-5" />}
          title="Cargá los archivos del histórico para activar los 3 ejes"
          description="Necesitas al menos ROMA (uno o más meses) y Actas. SCHIAPP y KAR son opcionales — sin ellos, las líneas físicas quedan en null."
        />
      )}

      {cruce && (
        <>
          <FiltrosHistoricoBar
            opciones={opciones}
            filtros={filtros}
            onChange={setFiltros}
            onReset={() => setFiltros(FILTROS_VACIOS)}
            totalUniverso={cruce.filas.length}
            totalFiltrado={filasFiltradas.length}
          />

          {modoValidacion && fingerprint && (
            <Card variant="elevated">
              <CardBody>
                <div className="flex items-center gap-2 mb-3">
                  <FlaskConical className="size-3.5 text-[--color-accent]" />
                  <span className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium">
                    Modo validación · fingerprint global (universo SIN filtros)
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[12px]">
                  <Metric label="Filas" value={fmtNum(fingerprint.totalFilas)} />
                  <Metric label="VentaIDs únicos" value={fmtNum(fingerprint.ventaIdsUnicos)} />
                  <Metric label="VINs únicos" value={fmtNum(fingerprint.vinsUnicos)} />
                  <Metric
                    label="Caso VR3KAHPY3VS000844"
                    value={
                      <CasoFingerprint
                        fila={cruce.byVin.get("VR3KAHPY3VS000844")?.[0]}
                      />
                    }
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-3 text-[12px]">
                  <Dist titulo="Cuello principal" entries={fingerprint.cuello.map((c) => [c.cuello, c.cantidad])} />
                  <Dist
                    titulo="Calidad cierre"
                    entries={Object.entries(fingerprint.calidadCierre)}
                  />
                  <Dist
                    titulo="Velocidad bucket"
                    entries={Object.entries(fingerprint.velocidadBucket)}
                  />
                </div>
              </CardBody>
            </Card>
          )}

          <EjeVelocidadCard
            data={eje1}
            foco={foco1}
            onFoco={(v) => setFocoExclusivo(1, v)}
          />
          {procesoActivo && timelineData && foco1?.tipo === "cuello" && (
            <TimelineProcesoCard
              data={timelineData}
              focoTramo={focoTramo}
              onFocoTramo={setFocoTramo}
              cuelloLabel={foco1.valor as CuelloPrincipal}
            />
          )}
          {foco1 && <DrillHistoricoTable titulo={tituloDrill} filas={filasParaDrill} />}

          <EjeCumplimientoCard
            data={eje2}
            foco={foco2}
            onFoco={(v) => setFocoExclusivo(2, v)}
          />
          {foco2 && <DrillHistoricoTable titulo={tituloDrill} filas={filasParaDrill} />}

          <EjeCalidadCierreCard
            data={eje3}
            foco={foco3}
            onFoco={(v) => setFocoExclusivo(3, v)}
          />
          {foco3 && <DrillHistoricoTable titulo={tituloDrill} filas={filasParaDrill} />}
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="surface rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[--color-fg-muted]">{label}</div>
      <div className="text-[14px] font-medium mt-0.5">{value}</div>
    </div>
  );
}

function Dist({ titulo, entries }: { titulo: string; entries: Array<[string, number]> }) {
  return (
    <div className="surface rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[--color-fg-muted] mb-1.5">{titulo}</div>
      <div className="space-y-0.5">
        {entries.map(([k, v]) => (
          <div key={k} className="flex justify-between text-[11.5px]">
            <span className="text-[--color-fg-muted]">{k}</span>
            <span className="mono">{fmtNum(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CasoFingerprint({ fila }: { fila: EntradaConsolidada | undefined }) {
  if (!fila) return <Badge tone="muted" size="xs">no presente</Badge>;
  const cuelloOk = fila.cuelloPrincipal === "Logística";
  const ventaOk = fila.ventaId === 213357;
  const listoOk =
    fila.fListoParaEntrega?.toISOString().slice(0, 10) === "2026-05-29";
  const ok = cuelloOk && ventaOk && listoOk;
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={ok ? "success" : "danger"} size="xs">
        {ok ? "15/15" : "regresión"}
      </Badge>
      <span className="text-[11px] text-[--color-fg-muted]">
        {fila.ventaId} · {fila.cuelloPrincipal}
      </span>
    </span>
  );
}
