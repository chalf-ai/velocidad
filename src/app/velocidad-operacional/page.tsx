"use client";

import { useMemo, useState } from "react";
import { Activity } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

import { EstadoFuentesBanner } from "@/components/historico/EstadoFuentesBanner";
import { FiltrosHistoricoBar } from "@/components/historico/FiltrosHistoricoBar";
import { ProcesoSelector } from "@/components/historico/ProcesoSelector";
import { ModoProcesoToggle } from "@/components/historico/ModoProcesoToggle";
import {
  FunnelProcesoCerrado,
  type FocoFunnel,
} from "@/components/historico/FunnelProcesoCerrado";
import { BacklogProcesoAbierto } from "@/components/historico/BacklogProcesoAbierto";
import {
  CierreCumplimientoView,
  type FocoCierreCumplimiento,
} from "@/components/historico/CierreCumplimientoView";
import { DrillPanel } from "@/components/historico/DrillPanel";

import { useHistoricoStore } from "@/lib/historico/store-cliente";
import {
  agregadosEje2,
  agregadosEje3,
  extraerOpciones,
  filtrarFilas,
  filasAbierto,
  filasFunnelCerrado,
  calcularFunnelCerrado,
  calcularSegmentacionTramo,
  calcularBacklogAbierto,
  inferirTipoHuerfano,
  filasDeEtapa,
  filasSinEtapa,
  filasDeCubeta,
  ETAPAS_POR_PROCESO,
  FILTROS_VACIOS,
  type FiltrosVista,
  type ProcesoActivo,
  type ProcesoOperacional,
  type ModoProceso,
} from "@/lib/historico/vista-derivados";
import type { EntradaConsolidada } from "@/lib/historico/cruce-roma-actas";

const NOMBRE_PROCESO: Record<ProcesoOperacional, string> = {
  control_negocio: "Control de Negocio",
  logistica:       "Logística",
  comercial:       "Comercial",
  cliente:         "Cliente",
};

/**
 * /velocidad-operacional — vista por proceso, tres lecturas separadas:
 *
 *   1. Funnel histórico cerrado   → universo cerrado, medianas sobre pares
 *   2. Backlog abierto             → universo abierto, aging desde última señal
 *   3. Cierre y Cumplimiento       → 4 buckets transversales sin funnel
 *
 * Cada proceso operacional tiene toggle cerrado/abierto. Cierre y Cumplimiento
 * NO tiene toggle (no aplica).
 *
 * Los componentes legacy (HeroEjecutivoVO, AlertasAccionables, CoberturaProcesoCard,
 * EjeTabs, Eje*Inline) están temporalmente desactivados — sus archivos siguen
 * en el árbol, solo no se renderizan acá.
 */
export default function VelocidadOperacionalPage() {
  const cruce = useHistoricoStore((s) => s.cruce);

  const [filtros, setFiltros] = useState<FiltrosVista>(FILTROS_VACIOS);
  const [procesoActivo, setProcesoActivo] = useState<ProcesoActivo>("control_negocio");
  const [modoProceso, setModoProceso] = useState<ModoProceso>("historico_cerrado");

  // Foco del funnel (etapa, transición o faltante).
  const [focoFunnel, setFocoFunnel] = useState<FocoFunnel | null>(null);
  // Foco del backlog (cubeta).
  const [focoCubeta, setFocoCubeta] = useState<string | null>(null);
  // Foco de cierre y cumplimiento (calidad).
  const [focoCierre, setFocoCierre] = useState<FocoCierreCumplimiento | null>(null);

  // ── Universo filtrado por la barra global ───────────────────────────────
  const opciones = useMemo(
    () => (cruce ? extraerOpciones(cruce) : { marcas: [], sucursales: [], vendedores: [] }),
    [cruce],
  );
  const filasFiltradas = useMemo(
    () => (cruce ? filtrarFilas(cruce, filtros) : []),
    [cruce, filtros],
  );

  // ── Counts para ProcesoSelector ──────────────────────────────────────────
  const eje2 = useMemo(() => agregadosEje2(filasFiltradas), [filasFiltradas]);
  const eje3 = useMemo(() => agregadosEje3(filasFiltradas), [filasFiltradas]);

  const procesoCounts = useMemo<Record<ProcesoActivo, number>>(() => {
    const entregadosEval =
      eje3.distribucion.correcto + eje3.distribucion.huerfano + eje3.distribucion.inconsistente;
    return {
      control_negocio:      filasFiltradas.filter((f) => f.entregado).length,
      logistica:            filasFiltradas.filter((f) => f.entregado).length,
      comercial:            filasFiltradas.filter((f) => f.fSolicitud !== null && f.fFactura !== null).length,
      cliente:              filasFiltradas.filter((f) => f.fListoParaEntrega !== null && f.fEntregaReal !== null).length,
      cierre_y_cumplimiento: entregadosEval + eje3.distribucion.no_evaluable,
    };
  }, [filasFiltradas, eje3]);

  // ── Universo cerrado/abierto del proceso operacional activo ─────────────
  const procesoOpActual: ProcesoOperacional | null =
    procesoActivo === "cierre_y_cumplimiento" ? null : (procesoActivo as ProcesoOperacional);

  const filasCerradasFunnel = useMemo(
    () => (procesoOpActual ? filasFunnelCerrado(filasFiltradas, procesoOpActual) : []),
    [procesoOpActual, filasFiltradas],
  );
  const filasAbiertasProc = useMemo(
    () => (procesoOpActual ? filasAbierto(filasFiltradas, procesoOpActual) : []),
    [procesoOpActual, filasFiltradas],
  );

  // ── Counts del toggle ModoProceso ────────────────────────────────────────
  const modoCounts = useMemo<{ cerrado: number; abierto: number }>(() => {
    if (!procesoOpActual) return { cerrado: 0, abierto: 0 };
    return {
      cerrado: filasCerradasFunnel.length,
      abierto: filasAbiertasProc.length,
    };
  }, [procesoOpActual, filasCerradasFunnel, filasAbiertasProc]);

  // ── Funnel cerrado del proceso ───────────────────────────────────────────
  const funnel = useMemo(
    () =>
      procesoOpActual && modoProceso === "historico_cerrado"
        ? calcularFunnelCerrado(filasCerradasFunnel, procesoOpActual)
        : null,
    [procesoOpActual, modoProceso, filasCerradasFunnel],
  );

  // ── Backlog abierto del proceso ──────────────────────────────────────────
  const backlog = useMemo(
    () =>
      procesoOpActual && modoProceso === "backlog_abierto"
        ? calcularBacklogAbierto(filasAbiertasProc, procesoOpActual)
        : null,
    [procesoOpActual, modoProceso, filasAbiertasProc],
  );

  // ── Segmentación temporal del tramo seleccionado ─────────────────────────
  const segmentacion = useMemo(() => {
    if (!procesoOpActual || modoProceso !== "historico_cerrado") return null;
    if (!focoFunnel || focoFunnel.tipo !== "transicion") return null;
    return calcularSegmentacionTramo(
      filasCerradasFunnel,
      procesoOpActual,
      focoFunnel.desdeId,
      focoFunnel.hastaId,
    );
  }, [procesoOpActual, modoProceso, focoFunnel, filasCerradasFunnel]);

  // ── Drill (filas + título + prefijo) ─────────────────────────────────────
  const { filasDrill, tituloDrill, prefijoDrill } = useMemo<{
    filasDrill: EntradaConsolidada[];
    tituloDrill: string;
    prefijoDrill?: string;
  }>(() => {
    // 1) Cierre y Cumplimiento — 5 tipos de foco (calidad / huérfano por tipo /
    //    conflicto material / nivel documental / alerta transversal).
    if (procesoActivo === "cierre_y_cumplimiento" && focoCierre) {
      switch (focoCierre.tipo) {
        case "calidad": {
          const filas = filasFiltradas.filter(
            (f) => (f.ejeCalidadCierre ?? "no_evaluable") === focoCierre.valor,
          );
          return {
            filasDrill: filas,
            tituloDrill: `Cierre y Cumplimiento · ${focoCierre.valor}`,
            prefijoDrill: `Calidad cierre: ${focoCierre.valor}`,
          };
        }
        case "huerfano_tipo": {
          const filas = filasFiltradas.filter(
            (f) => f.ejeCalidadCierre === "huerfano" && inferirTipoHuerfano(f) === focoCierre.valor,
          );
          return {
            filasDrill: filas,
            tituloDrill: `Cierre y Cumplimiento · Huérfano ${focoCierre.valor}`,
            prefijoDrill: `Huérfano ${focoCierre.valor}`,
          };
        }
        case "conflicto": {
          const filas = filasFiltradas.filter(
            (f) =>
              f.ejeCalidadCierre === "inconsistente" &&
              f.conflictos.some((c) => c.esMaterial && c.kind === focoCierre.valor),
          );
          return {
            filasDrill: filas,
            tituloDrill: `Cierre y Cumplimiento · Conflicto ${focoCierre.valor}`,
            prefijoDrill: `Conflicto material: ${focoCierre.valor}`,
          };
        }
        case "nivel": {
          const filas = filasFiltradas.filter((f) => f.nivelDocumental === focoCierre.valor);
          return {
            filasDrill: filas,
            tituloDrill: `Cierre y Cumplimiento · Nivel documental ${focoCierre.valor}`,
            prefijoDrill: `Nivel documental: ${focoCierre.valor}`,
          };
        }
        case "alerta": {
          // Alertas transversales — siempre sobre entregados.
          const pred =
            focoCierre.valor === "sin_patente_recibida"
              ? (f: typeof filasFiltradas[number]) => f.entregado && !f.fPatenteRecibida
              : focoCierre.valor === "sin_autorizacion"
                ? (f: typeof filasFiltradas[number]) => f.entregado && (f.autorizacionEntrega ?? "").trim() !== "Si"
                : (f: typeof filasFiltradas[number]) => f.entregado && (f.solEntrega ?? "").trim() !== "Si";
          const labels: Record<typeof focoCierre.valor, string> = {
            sin_patente_recibida: "Entregados sin patente recibida",
            sin_autorizacion:     "Entregados sin autorización",
            sin_sol_entrega:      "Entregados sin solicitud entrega",
          };
          const filas = filasFiltradas.filter(pred);
          return {
            filasDrill: filas,
            tituloDrill: `Cierre y Cumplimiento · ${labels[focoCierre.valor]}`,
            prefijoDrill: `Alerta: ${labels[focoCierre.valor]}`,
          };
        }
      }
    }

    // 2) Procesos operacionales con foco en backlog
    if (procesoOpActual && modoProceso === "backlog_abierto" && focoCubeta) {
      const filas = filasDeCubeta(filasAbiertasProc, procesoOpActual, focoCubeta);
      const label =
        backlog?.cubetas.find((c) => c.id === focoCubeta)?.label ?? focoCubeta;
      return {
        filasDrill: filas,
        tituloDrill: `${NOMBRE_PROCESO[procesoOpActual]} · Backlog · ${label}`,
        prefijoDrill: `Cubeta: ${label}`,
      };
    }

    // 3) Procesos operacionales con foco en funnel
    if (procesoOpActual && modoProceso === "historico_cerrado" && focoFunnel) {
      if (focoFunnel.tipo === "etapa") {
        const etapa = ETAPAS_POR_PROCESO[procesoOpActual].find((e) => e.id === focoFunnel.etapaId);
        const filas = filasDeEtapa(filasCerradasFunnel, procesoOpActual, focoFunnel.etapaId);
        return {
          filasDrill: filas,
          tituloDrill: `${NOMBRE_PROCESO[procesoOpActual]} · En etapa: ${etapa?.label ?? focoFunnel.etapaId}`,
          prefijoDrill: `En etapa: ${etapa?.label ?? ""}`,
        };
      }
      if (focoFunnel.tipo === "faltante") {
        const etapa = ETAPAS_POR_PROCESO[procesoOpActual].find((e) => e.id === focoFunnel.etapaId);
        const labelHito = etapa?.labelHito ?? etapa?.label ?? focoFunnel.etapaId;
        const filas = filasSinEtapa(filasCerradasFunnel, procesoOpActual, focoFunnel.etapaId);
        return {
          filasDrill: filas,
          tituloDrill: `${NOMBRE_PROCESO[procesoOpActual]} · Sin ${labelHito.toLowerCase()}`,
          prefijoDrill: `Hito faltante: ${labelHito}`,
        };
      }
      // transicion → drill del TRAMO = pares completos (desde != null && hasta != null).
      // Es el universo que participa de la mediana/p90 del tramo. Los caídos
      // (faltantes) tienen su propia vía via "Sin {hito}" en la lista de faltantes.
      const desde = ETAPAS_POR_PROCESO[procesoOpActual].find((e) => e.id === focoFunnel.desdeId);
      const hasta = ETAPAS_POR_PROCESO[procesoOpActual].find((e) => e.id === focoFunnel.hastaId);
      if (!desde || !hasta) return { filasDrill: [], tituloDrill: "" };
      const filas = filasCerradasFunnel.filter(
        (f) => f[desde.campo] != null && f[hasta.campo] != null,
      );
      return {
        filasDrill: filas,
        tituloDrill: `${NOMBRE_PROCESO[procesoOpActual]} · Velocidad · ${desde.label} → ${hasta.label}`,
        prefijoDrill: `Tramo medido: ${desde.label} → ${hasta.label}`,
      };
    }

    return { filasDrill: [], tituloDrill: "" };
  }, [
    procesoActivo,
    procesoOpActual,
    modoProceso,
    focoFunnel,
    focoCubeta,
    focoCierre,
    filasFiltradas,
    filasCerradasFunnel,
    filasAbiertasProc,
    backlog,
  ]);

  const drillVisible = filasDrill.length > 0 || focoFunnel !== null || focoCubeta !== null || focoCierre !== null;

  const cerrarDrill = () => {
    setFocoFunnel(null);
    setFocoCubeta(null);
    setFocoCierre(null);
  };

  // ── Handlers para mantener consistencia entre proceso/modo/focos ────────
  const handleProcesoChange = (p: ProcesoActivo) => {
    setProcesoActivo(p);
    setModoProceso("historico_cerrado"); // default al cambiar de proceso
    cerrarDrill();
  };

  const handleModoChange = (m: ModoProceso) => {
    setModoProceso(m);
    cerrarDrill();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="HISTÓRICO"
        kickerIcon={<Activity className="size-3" />}
        title="Tiempos Operacionales"
        description="Histórico de tiempos · Control de Negocio · Logística · Comercial · Cliente · Cierre y Cumplimiento"
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

          <ProcesoSelector
            activo={procesoActivo}
            onChange={handleProcesoChange}
            counts={procesoCounts}
          />

          {procesoOpActual && (
            <ModoProcesoToggle
              activo={modoProceso}
              onChange={handleModoChange}
              countCerrado={modoCounts.cerrado}
              countAbierto={modoCounts.abierto}
            />
          )}

          {/* ── Modo HISTÓRICO CERRADO ───────────────────────────────────── */}
          {procesoOpActual && modoProceso === "historico_cerrado" && funnel && (
            <FunnelProcesoCerrado
              funnel={funnel}
              nombreProceso={NOMBRE_PROCESO[procesoOpActual]}
              foco={focoFunnel}
              segmentacion={segmentacion}
              onSelectEtapa={(etapaId) => {
                setFocoFunnel((prev) =>
                  prev?.tipo === "etapa" && prev.etapaId === etapaId
                    ? null
                    : { tipo: "etapa", etapaId },
                );
              }}
              onSelectTransicion={(desdeId, hastaId) => {
                setFocoFunnel((prev) =>
                  prev?.tipo === "transicion" && prev.desdeId === desdeId && prev.hastaId === hastaId
                    ? null
                    : { tipo: "transicion", desdeId, hastaId },
                );
              }}
              onSelectFaltante={(etapaId) => {
                setFocoFunnel((prev) =>
                  prev?.tipo === "faltante" && prev.etapaId === etapaId
                    ? null
                    : { tipo: "faltante", etapaId },
                );
              }}
            />
          )}

          {/* ── Modo BACKLOG ABIERTO ─────────────────────────────────────── */}
          {procesoOpActual && modoProceso === "backlog_abierto" && backlog && (
            <BacklogProcesoAbierto
              backlog={backlog}
              nombreProceso={NOMBRE_PROCESO[procesoOpActual]}
              focoCubetaId={focoCubeta}
              onSelectCubeta={(id) => setFocoCubeta(id)}
            />
          )}

          {/* ── CIERRE Y CUMPLIMIENTO (sin toggle, sin funnel) ───────────── */}
          {procesoActivo === "cierre_y_cumplimiento" && (
            <CierreCumplimientoView
              eje2={eje2}
              eje3={eje3}
              focoCierre={focoCierre}
              onSelectFoco={(v) => setFocoCierre(v)}
            />
          )}

          {/* ── DrillPanel — reusado por las 3 vistas ────────────────────── */}
          {drillVisible && (
            <DrillPanel
              titulo={tituloDrill}
              filas={filasDrill}
              onClose={cerrarDrill}
              prefijoRazon={prefijoDrill}
            />
          )}
        </>
      )}
    </div>
  );
}
