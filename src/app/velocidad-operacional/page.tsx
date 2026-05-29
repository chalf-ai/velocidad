"use client";

import { useMemo, useState } from "react";
import { Activity, FlaskConical } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { fmtNum } from "@/lib/format";

import { EstadoFuentesBanner } from "@/components/historico/EstadoFuentesBanner";
import { FiltrosHistoricoBar } from "@/components/historico/FiltrosHistoricoBar";
import {
  HeroEjecutivoVO,
  type EjeId,
  type KpiNav,
  type PrincipalFocoOperacional,
} from "@/components/historico/HeroEjecutivoVO";
import {
  AlertasAccionables,
  type AlertaId,
  type AlertaTarget,
} from "@/components/historico/AlertasAccionables";
import { ProcesoSelector } from "@/components/historico/ProcesoSelector";
import { ModoProcesoToggle } from "@/components/historico/ModoProcesoToggle";
import { EjeTabs } from "@/components/historico/EjeTabs";
import { EjeVelocidadInline } from "@/components/historico/EjeVelocidadInline";
import { EjeCumplimientoInline } from "@/components/historico/EjeCumplimientoInline";
import { EjeCalidadCierreInline } from "@/components/historico/EjeCalidadCierreInline";
import { DrillPanel } from "@/components/historico/DrillPanel";

import { useHistoricoStore } from "@/lib/historico/store-cliente";
import {
  agregadosEje1,
  agregadosEje2,
  agregadosEje3,
  calcularTimelineProceso,
  extraerOpciones,
  filtrarFilas,
  filasDeTramo,
  filasCerrado,
  filasAbierto,
  fingerprintGlobal,
  inferirTipoHuerfano,
  procesoDeCuello,
  FILTROS_VACIOS,
  type FiltrosVista,
  type TramoId,
  type ProcesoActivo,
  type ProcesoOperacional,
  type ModoProceso,
} from "@/lib/historico/vista-derivados";
import type {
  EntradaConsolidada,
  CuelloPrincipal,
  BucketVelocidad,
} from "@/lib/historico/cruce-roma-actas";
import type { BandaCumplimiento } from "@/lib/historico/cruce-roma-actas";
import type { NivelDocumental } from "@/lib/historico/parser-actas";

// Tipos de foco reusados de los Eje*Card legacy (que siguen vivos como deprecated).
import type { FocoVelocidad } from "@/components/historico/EjeVelocidadCard";
import type { FocoCumplimiento } from "@/components/historico/EjeCumplimientoCard";
import type { FocoCalidadCierre } from "@/components/historico/EjeCalidadCierreCard";

export default function VelocidadOperacionalPage() {
  const cruce = useHistoricoStore((s) => s.cruce);

  const [filtros, setFiltros] = useState<FiltrosVista>(FILTROS_VACIOS);
  const [modoValidacion, setModoValidacion] = useState(false);

  // Fase 3 — navegación por proceso (Tanda A: solo selectores).
  const [procesoActivo, setProcesoActivo] = useState<ProcesoActivo>("control_negocio");
  const [modoProceso, setModoProceso] = useState<ModoProceso>("historico_cerrado");

  // Eje activo + foco preservado por eje (capa legacy — convive con la nueva
  // navegación hasta Tanda E que reescribe page.tsx).
  const [ejeActivo, setEjeActivo] = useState<EjeId>("velocidad");
  const [focoVelocidad, setFocoVelocidad] = useState<FocoVelocidad | null>(null);
  const [focoCumplimiento, setFocoCumplimiento] = useState<FocoCumplimiento | null>(null);
  const [focoCalidad, setFocoCalidad] = useState<FocoCalidadCierre | null>(null);
  const [focoTramo, setFocoTramo] = useState<TramoId | null>(null);
  const [alertaActiva, setAlertaActiva] = useState<AlertaId | null>(null);

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

  // Cuellos counts para alertas
  const cuelloCounts = useMemo(() => {
    const m = new Map<CuelloPrincipal, number>();
    for (const d of eje1.distribucionCuello) m.set(d.cuello, d.cantidad);
    return m;
  }, [eje1]);

  // Tanda A — counts por proceso para el ProcesoSelector.
  // Los 4 operacionales se cuentan por su cuello. "Cierre y Cumplimiento"
  // suma los entregados evaluables (correcto + huerfano + inconsistente).
  const procesoCounts = useMemo<Record<ProcesoActivo, number>>(() => {
    const entregadosEval =
      eje3.distribucion.correcto + eje3.distribucion.huerfano + eje3.distribucion.inconsistente;
    return {
      control_negocio: cuelloCounts.get("Control de Negocio") ?? 0,
      logistica: cuelloCounts.get("Logística") ?? 0,
      comercial: cuelloCounts.get("Comercial") ?? 0,
      cliente: cuelloCounts.get("Cliente") ?? 0,
      cierre_y_cumplimiento: entregadosEval,
    };
  }, [cuelloCounts, eje3]);

  // Tanda A — counts cerrado/abierto para el ModoProcesoToggle del proceso
  // operacional activo. Si el proceso es "cierre_y_cumplimiento" no se usa.
  const modoCounts = useMemo<{ cerrado: number; abierto: number }>(() => {
    if (procesoActivo === "cierre_y_cumplimiento") return { cerrado: 0, abierto: 0 };
    const op = procesoActivo as ProcesoOperacional;
    return {
      cerrado: filasCerrado(filasFiltradas, op).length,
      abierto: filasAbierto(filasFiltradas, op).length,
    };
  }, [procesoActivo, filasFiltradas]);

  // Hero: "Principal foco operacional" — proceso operacional con mayor backlog
  // abierto dentro del universo filtrado. Solo considera los 4 operacionales
  // (Mixto / Sin información / Cierre quedan fuera).
  const principalFoco = useMemo<PrincipalFocoOperacional | null>(() => {
    const procesosOps: Array<{ id: ProcesoOperacional; nombre: string }> = [
      { id: "control_negocio", nombre: "Control de Negocio" },
      { id: "logistica",       nombre: "Logística" },
      { id: "comercial",       nombre: "Comercial" },
      { id: "cliente",         nombre: "Cliente" },
    ];
    let mejor: { proceso: ProcesoOperacional; nombre: string; casosAbiertos: number } | null = null;
    for (const p of procesosOps) {
      const n = filasAbierto(filasFiltradas, p.id).length;
      if (n === 0) continue;
      if (!mejor || n > mejor.casosAbiertos) {
        mejor = { proceso: p.id, nombre: p.nombre, casosAbiertos: n };
      }
    }
    return mejor;
  }, [filasFiltradas]);

  // Counts para tabs
  const tabCounts = useMemo(() => {
    if (!cruce) return { vel: 0, cum: 0, cal: 0 };
    const evaluados =
      eje3.distribucion.correcto + eje3.distribucion.huerfano + eje3.distribucion.inconsistente;
    return {
      vel: filasFiltradas.length,
      cum: eje2.global.universo,
      cal: evaluados,
    };
  }, [cruce, filasFiltradas, eje2, eje3]);

  // Timeline LEGACY solo cuando foco velocidad cae en cuello operacional.
  // (Renombrado de `procesoActivo` para no colisionar con el state de Fase 3.)
  const procesoLegacy = useMemo(() => {
    if (!focoVelocidad || focoVelocidad.tipo !== "cuello") return null;
    return procesoDeCuello(focoVelocidad.valor as CuelloPrincipal);
  }, [focoVelocidad]);

  const timelineData = useMemo(
    () => (procesoLegacy ? calcularTimelineProceso(filasFiltradas, procesoLegacy) : null),
    [procesoLegacy, filasFiltradas],
  );

  // Drill — el drill activo depende del eje activo.
  const filasDrill = useMemo<EntradaConsolidada[]>(() => {
    if (ejeActivo === "velocidad" && focoVelocidad) {
      if (focoVelocidad.tipo === "cuello") {
        const base = filasFiltradas.filter(
          (f) => f.cuelloPrincipal === (focoVelocidad.valor as CuelloPrincipal),
        );
        if (procesoLegacy && focoTramo) return filasDeTramo(base, procesoLegacy, focoTramo);
        return base;
      }
      return filasFiltradas.filter(
        (f) => f.ejeVelocidad.bucket === (focoVelocidad.valor as BucketVelocidad),
      );
    }
    if (ejeActivo === "cumplimiento" && focoCumplimiento) {
      if (focoCumplimiento.tipo === "nivel")
        return filasFiltradas.filter(
          (f) => f.nivelDocumental === (focoCumplimiento.valor as NivelDocumental),
        );
      return filasFiltradas.filter(
        (f) => f.ejeCumplimiento.banda === (focoCumplimiento.valor as BandaCumplimiento),
      );
    }
    if (ejeActivo === "calidad" && focoCalidad) {
      if (focoCalidad.tipo === "estado")
        return filasFiltradas.filter(
          (f) => (f.ejeCalidadCierre ?? "no_evaluable") === focoCalidad.valor,
        );
      if (focoCalidad.tipo === "huerfano")
        return filasFiltradas.filter(
          (f) => f.ejeCalidadCierre === "huerfano" && inferirTipoHuerfano(f) === focoCalidad.valor,
        );
      return filasFiltradas.filter(
        (f) =>
          f.ejeCalidadCierre === "inconsistente" &&
          f.conflictos.some((c) => c.esMaterial && c.kind === focoCalidad.valor),
      );
    }
    return [];
  }, [
    ejeActivo,
    focoVelocidad,
    focoCumplimiento,
    focoCalidad,
    focoTramo,
    procesoLegacy,
    filasFiltradas,
  ]);

  const tituloDrill = useMemo(() => {
    if (ejeActivo === "velocidad" && focoVelocidad) {
      if (focoVelocidad.tipo === "cuello") {
        const base = `Cuello: ${focoVelocidad.valor}`;
        if (procesoLegacy && focoTramo && timelineData) {
          const tramo = timelineData.tramos.find((t) => t.id === focoTramo);
          if (tramo) return `${base} · tramo: ${tramo.label}`;
        }
        return base;
      }
      return `Velocidad: ${focoVelocidad.valor}`;
    }
    if (ejeActivo === "cumplimiento" && focoCumplimiento) {
      return focoCumplimiento.tipo === "nivel"
        ? `Nivel documental: ${focoCumplimiento.valor}`
        : `Banda cumplimiento: ${focoCumplimiento.valor}`;
    }
    if (ejeActivo === "calidad" && focoCalidad) {
      if (focoCalidad.tipo === "estado") return `Calidad cierre: ${focoCalidad.valor}`;
      if (focoCalidad.tipo === "huerfano") return `Huérfano: ${focoCalidad.valor}`;
      return `Conflicto: ${focoCalidad.valor}`;
    }
    return "";
  }, [
    ejeActivo,
    focoVelocidad,
    focoCumplimiento,
    focoCalidad,
    procesoLegacy,
    focoTramo,
    timelineData,
  ]);

  const fingerprint = useMemo(() => (cruce ? fingerprintGlobal(cruce) : null), [cruce]);

  const drillVisible = filasDrill.length > 0 || (
    (ejeActivo === "velocidad" && !!focoVelocidad) ||
    (ejeActivo === "cumplimiento" && !!focoCumplimiento) ||
    (ejeActivo === "calidad" && !!focoCalidad)
  );

  const cerrarDrillActivo = () => {
    if (ejeActivo === "velocidad") {
      setFocoVelocidad(null);
      setFocoTramo(null);
    } else if (ejeActivo === "cumplimiento") {
      setFocoCumplimiento(null);
    } else {
      setFocoCalidad(null);
    }
    setAlertaActiva(null);
  };

  // Navegación desde KPIs del Hero.
  const navegarKpi = (target: KpiNav) => {
    setAlertaActiva(null);
    if (target.tipo === "proceso") {
      // KPI "Principal foco operacional" → cambia proceso + modo, no eje.
      setProcesoActivo(target.proceso);
      setModoProceso(target.modo);
      return;
    }
    // Resto de KPIs: navegación legacy por eje.
    setEjeActivo(target.eje);
    if (target.eje === "calidad") {
      if (target.focoCalidad === "huerfano")
        setFocoCalidad({ tipo: "estado", valor: "huerfano" });
      else if (target.focoCalidad === "inconsistente")
        setFocoCalidad({ tipo: "estado", valor: "inconsistente" });
      else if (target.focoCalidad === "correcto")
        setFocoCalidad({ tipo: "estado", valor: "correcto" });
    }
  };

  // Navegación desde Alertas.
  const navegarAlerta = (t: AlertaTarget) => {
    setEjeActivo(t.eje);
    setAlertaActiva(t.id);
    if (t.eje === "velocidad" && t.focoCuello) {
      setFocoVelocidad({ tipo: "cuello", valor: t.focoCuello });
      setFocoTramo(null);
    } else if (t.eje === "calidad" && t.focoCalidad) {
      setFocoCalidad({ tipo: "estado", valor: t.focoCalidad });
    } else if (t.eje === "cumplimiento") {
      // Si es "sin patente": ponemos foco en banda mayor para que el drill aterrice en algo útil.
      setFocoCumplimiento({ tipo: "banda", valor: "mayor" });
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="HISTÓRICO"
        kickerIcon={<Activity className="size-3" />}
        title="Vista Histórica · 3 ejes"
        description="Velocidad, Cumplimiento y Calidad de Cierre del universo ROMA × Actas × ROMIA. Carga local, sin persistencia."
      />

      <EstadoFuentesBanner />

      {!cruce && (
        <EmptyState
          icon={<Activity className="size-5" />}
          title="Cargá los archivos del histórico para activar la vista"
          description="Mínimo ROMA + Actas. Ingresá a /ingesta para cargar las fuentes."
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

          {/* Orden nuevo (post-Tanda A reordenamiento):
              alertas → proceso → modo → contexto ejecutivo.
              El Hero ya NO domina — es referencia secundaria. */}
          <AlertasAccionables
            eje2={eje2}
            eje3={eje3}
            cuelloCounts={cuelloCounts}
            alertaActiva={alertaActiva}
            onAlerta={navegarAlerta}
          />

          <ProcesoSelector
            activo={procesoActivo}
            onChange={(p) => {
              setProcesoActivo(p);
              setModoProceso("historico_cerrado"); // reset modo al cambiar proceso
            }}
            counts={procesoCounts}
          />
          {procesoActivo !== "cierre_y_cumplimiento" && (
            <ModoProcesoToggle
              activo={modoProceso}
              onChange={setModoProceso}
              countCerrado={modoCounts.cerrado}
              countAbierto={modoCounts.abierto}
            />
          )}

          <HeroEjecutivoVO
            totalUniverso={cruce.filas.length}
            totalFiltrado={filasFiltradas.length}
            ventaIdsUnicos={cruce.reporte.totales.ventaIds}
            vinsUnicos={cruce.reporte.totales.vinsUnicos}
            eje1={eje1}
            eje2={eje2}
            eje3={eje3}
            principalFoco={principalFoco}
            modoValidacion={modoValidacion}
            onToggleModoValidacion={() => setModoValidacion((v) => !v)}
            onNavigate={navegarKpi}
          />

          {modoValidacion && fingerprint && (
            <Card>
              <CardBody className="space-y-2">
                <div className="flex items-center gap-2">
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
                    value={<CasoFingerprint fila={cruce.byVin.get("VR3KAHPY3VS000844")?.[0]} />}
                  />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-[12px]">
                  <Dist
                    titulo="Cuello"
                    entries={fingerprint.cuello.map((c) => [c.cuello, c.cantidad])}
                  />
                  <Dist titulo="Calidad cierre" entries={Object.entries(fingerprint.calidadCierre)} />
                  <Dist titulo="Velocidad bucket" entries={Object.entries(fingerprint.velocidadBucket)} />
                </div>
              </CardBody>
            </Card>
          )}

          {/* ─ Capa LEGACY (Fase 2 v2) — convive hasta Tanda E ──────────────── */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <EjeTabs
              activo={ejeActivo}
              onChange={(e) => {
                setEjeActivo(e);
                setAlertaActiva(null);
              }}
              countVelocidad={tabCounts.vel}
              countCumplimiento={tabCounts.cum}
              countCalidad={tabCounts.cal}
            />
          </div>

          {ejeActivo === "velocidad" && (
            <EjeVelocidadInline
              data={eje1}
              filas={filasFiltradas}
              foco={focoVelocidad}
              onFoco={(v) => {
                setFocoVelocidad(v);
                setFocoTramo(null);
              }}
              timeline={timelineData}
              focoTramo={focoTramo}
              onFocoTramo={setFocoTramo}
            />
          )}
          {ejeActivo === "cumplimiento" && (
            <EjeCumplimientoInline
              data={eje2}
              filas={filasFiltradas}
              foco={focoCumplimiento}
              onFoco={setFocoCumplimiento}
            />
          )}
          {ejeActivo === "calidad" && (
            <EjeCalidadCierreInline
              data={eje3}
              filas={filasFiltradas}
              foco={focoCalidad}
              onFoco={setFocoCalidad}
            />
          )}

          {drillVisible && (
            <DrillPanel titulo={tituloDrill} filas={filasDrill} onClose={cerrarDrillActivo} />
          )}
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
  const listoOk = fila.fListoParaEntrega?.toISOString().slice(0, 10) === "2026-05-29";
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
