"use client";

/**
 * /velocidad-operacional — TIEMPOS OPERACIONALES (rediseño v3).
 *
 * Pantalla operacional construida sobre el universo de autos facturados en un
 * MES seleccionado. Cuatro lecturas posibles:
 *
 *   1. Funnel del mes        → cobertura por hito + tramos con responsable
 *                              operativo + top sucursales/responsables lentos
 *   2. Backlog abierto       → caja retenida (este mes o acumulado)
 *   3. Cierre y Cumplimiento → calidad documental + top problemas
 *
 * Filtros globales del header (marca + sucursal) entran en cascada. Drill
 * unificado: toda fila VIN abre `FichaOperacionalVIN` vía `AbrirCasoButton`
 * (regla transversal "VIN con V corta = gestión unificada").
 */

import { useEffect, useMemo, useState } from "react";
import { Activity } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

import { EstadoFuentesBanner } from "@/components/historico/EstadoFuentesBanner";
import { ProcesoSelector } from "@/components/historico/ProcesoSelector";
import { MesFacturaSelect } from "@/components/historico/MesFacturaSelect";
import { ResumenEjecutivoProceso } from "@/components/historico/ResumenEjecutivoProceso";
import {
  FunnelHitosFactura,
  type FocoFunnelFactura,
} from "@/components/historico/FunnelHitosFactura";
import { FaltantesProcesoSection } from "@/components/historico/FaltantesProcesoSection";
import { BacklogFacturaView } from "@/components/historico/BacklogFacturaView";
import { CierreCumplimientoMes } from "@/components/historico/CierreCumplimientoMes";
import { ColaGestionableHistorico } from "@/components/historico/ColaGestionableHistorico";

import { useHistoricoStore } from "@/lib/historico/store-cliente";
import { useMarcaFilter } from "@/lib/marca-filtro";
import { useSucursalFilter } from "@/lib/sucursal-filtro";
import { normalizarMarcaOperacional } from "@/lib/selectors/owner-operacional";
import {
  mesesFacturaDisponibles,
  filtrarPorMesFactura,
  aplicarRegladeUsados,
  esUsadoHistorico,
  calcularFunnelPorFactura,
  faltantesPorProceso,
  backlogFacturados,
  cierreYCumplimientoStats,
  TRAMOS_DEFINICION,
  type ProcesoOperacional,
  type ProcesoActivo,
  type MesFacturaKey,
  type ModoBacklog,
} from "@/lib/historico/vista-derivados";
import type { EntradaConsolidada } from "@/lib/historico/cruce-roma-actas";
import { cn } from "@/lib/cn";

const NOMBRE_PROCESO: Record<ProcesoActivo, string> = {
  control_negocio:        "Control de Negocio",
  logistica:              "Logística",
  comercial:              "Comercial",
  cliente:                "Cliente",
  cierre_y_cumplimiento:  "Cierre y Cumplimiento",
};

type Vista = "funnel" | "backlog";

export default function VelocidadOperacionalPage() {
  const cruce = useHistoricoStore((s) => s.cruce);
  const marcaGlobal = useMarcaFilter((s) => s.marca);
  const sucursalGlobal = useSucursalFilter((s) => s.sucursal);

  const [procesoActivo, setProcesoActivo] = useState<ProcesoActivo>("control_negocio");
  const [vista, setVista] = useState<Vista>("funnel");
  const [mes, setMes] = useState<MesFacturaKey | null>(null);
  const [modoBacklog, setModoBacklog] = useState<ModoBacklog>("acumulado");
  const [focoFunnel, setFocoFunnel] = useState<FocoFunnelFactura | null>(null);
  const [focoFaltanteId, setFocoFaltanteId] = useState<string | null>(null);

  // Universo: cruce filtrado por marca/sucursal globales.
  const filasGlobales = useMemo<EntradaConsolidada[]>(() => {
    if (!cruce) return [];
    const marcaObj = marcaGlobal ? normalizarMarcaOperacional(marcaGlobal) : null;
    return cruce.filas.filter((f) => {
      if (marcaObj && normalizarMarcaOperacional(f.marca) !== marcaObj) return false;
      if (sucursalGlobal && (f.sucursal ?? null) !== sucursalGlobal) return false;
      return true;
    });
  }, [cruce, marcaGlobal, sucursalGlobal]);

  // Opciones del selector de mes: sobre el universo YA filtrado por marca/
  // sucursal. Así el counter "X facturados en el mes" coincide con el universo
  // real del módulo, no con el cruce total (que confundía al usuario).
  const opcionesMes = useMemo(
    () => mesesFacturaDisponibles(filasGlobales),
    [filasGlobales],
  );

  // Default: último mes disponible al cargar (una vez, si no hay selección).
  useEffect(() => {
    if (mes === null && opcionesMes.length > 0) {
      setMes(opcionesMes[0].key);
    }
  }, [mes, opcionesMes]);

  // Si el mes seleccionado ya no existe en las opciones (porque cambió el
  // filtro global y ese mes ya no tiene facturas en el universo nuevo),
  // reasignamos al último disponible para evitar "todo vacío" silencioso.
  useEffect(() => {
    if (mes !== null && opcionesMes.length > 0 && !opcionesMes.some((o) => o.key === mes)) {
      setMes(opcionesMes[0].key);
    }
  }, [mes, opcionesMes]);

  // Universo del mes (lo que usa Funnel + Cierre + Backlog "este_mes").
  const filasMes = useMemo(
    () => filtrarPorMesFactura(filasGlobales, mes),
    [filasGlobales, mes],
  );

  const mesLabel = useMemo(() => {
    if (!mes) return "Todos los meses";
    return opcionesMes.find((o) => o.key === mes)?.label ?? mes;
  }, [mes, opcionesMes]);

  // Counts por proceso (sobre el universo del mes) para el selector.
  // CN y Logística excluyen Usados + Mayorista (flujo propio: transferencia +
  // venta mayorista, no inscripción nueva ni traslado retail).
  const procesoCounts = useMemo<Record<ProcesoActivo, number>>(() => {
    const sinUsados = aplicarRegladeUsados(filasMes, "control_negocio");
    return {
      control_negocio:        sinUsados.length,
      logistica:              sinUsados.length,
      comercial:              filasMes.length,
      cliente:                filasMes.length,
      cierre_y_cumplimiento:  filasMes.length,
    };
  }, [filasMes]);

  const procesoOp: ProcesoOperacional | null =
    procesoActivo === "cierre_y_cumplimiento" ? null : (procesoActivo as ProcesoOperacional);

  // Universo del proceso activo (aplica la regla "usados + mayorista" cuando
  // corresponde — solo CN y Logística).
  const filasProceso = useMemo(
    () => aplicarRegladeUsados(filasMes, procesoActivo),
    [filasMes, procesoActivo],
  );

  // Conteo de excluidos para nota informativa en la UI.
  const excluidosUsados = useMemo(
    () =>
      procesoActivo === "control_negocio" || procesoActivo === "logistica"
        ? filasMes.filter(esUsadoHistorico).length
        : 0,
    [filasMes, procesoActivo],
  );

  // Funnel + faltantes (solo si proceso operacional). Universo ya recortado.
  const funnel = useMemo(
    () => (procesoOp ? calcularFunnelPorFactura(filasProceso, procesoOp) : null),
    [procesoOp, filasProceso],
  );
  const faltantes = useMemo(
    () => (procesoOp ? faltantesPorProceso(filasProceso, procesoOp) : []),
    [procesoOp, filasProceso],
  );

  // Backlog: este_mes usa filasMes; acumulado usa filasGlobales (sin filtro mes).
  // En ambos modos aplica la regla de usados según el proceso activo.
  const backlog = useMemo(() => {
    const universoBase = modoBacklog === "este_mes" ? filasMes : filasGlobales;
    const universo = aplicarRegladeUsados(universoBase, procesoActivo);
    return backlogFacturados(universo);
  }, [modoBacklog, filasMes, filasGlobales, procesoActivo]);

  // Cierre y cumplimiento sobre el mes — usados sí entran (calidad documental
  // del cierre aplica igual a nuevos y usados).
  const cierre = useMemo(() => cierreYCumplimientoStats(filasMes), [filasMes]);

  // Reset focos al cambiar proceso/mes/vista.
  useEffect(() => {
    setFocoFunnel(null);
    setFocoFaltanteId(null);
  }, [procesoActivo, mes, vista]);

  // ── Cola activa derivada del foco actual (funnel) ────────────────────────
  const colaFunnel = useMemo(() => {
    if (!procesoOp || !funnel) return null;
    // Foco por faltante (sección separada)
    if (focoFaltanteId) {
      const f = faltantes.find((x) => x.id === focoFaltanteId);
      if (!f) return null;
      return {
        titulo: `Faltante · ${f.label}`,
        subtitulo: `Responsable operativo: ${f.owner}`,
        filas: f.filas,
        origen: `/velocidad-operacional · ${procesoActivo} · faltante:${f.id}`,
      };
    }
    if (focoFunnel) {
      if (focoFunnel.tipo === "etapa_cumple") {
        const etapa = funnel.etapas.find((x) => x.id === focoFunnel.etapaId);
        if (!etapa) return null;
        const filasCumple = filasProceso.filter((f) => {
          if (etapa.esTerminal) return f.entregado;
          // Resolver el campo desde el index de ETAPAS — necesitamos el `campo` real,
          // recurrimos al definidor:
          return (f as unknown as Record<string, unknown>)[campoDeEtapa(procesoOp, focoFunnel.etapaId)] instanceof Date;
        });
        return {
          titulo: `Etapa · ${etapa.label} · ${filasCumple.length} casos`,
          subtitulo: `Responsable operativo: ${etapa.owner}`,
          filas: filasCumple,
          origen: `/velocidad-operacional · ${procesoActivo} · etapa:${etapa.id}`,
        };
      }
      if (focoFunnel.tipo === "etapa_faltante") {
        const etapa = funnel.etapas.find((x) => x.id === focoFunnel.etapaId);
        if (!etapa) return null;
        const filasFalta = filasProceso.filter((f) => {
          if (etapa.esTerminal) return !f.entregado;
          return !((f as unknown as Record<string, unknown>)[campoDeEtapa(procesoOp, focoFunnel.etapaId)] instanceof Date);
        });
        return {
          titulo: `Faltante · Sin ${etapa.label.toLowerCase()} · ${filasFalta.length} casos`,
          subtitulo: `Responsable operativo: ${etapa.owner}`,
          filas: filasFalta,
          origen: `/velocidad-operacional · ${procesoActivo} · etapa_faltante:${etapa.id}`,
        };
      }
      if (focoFunnel.tipo === "tramo_lentos") {
        const def = TRAMOS_DEFINICION[procesoOp].find((d) => d.id === focoFunnel.tramoId);
        const tramo = funnel.tramos.find((t) => t.id === focoFunnel.tramoId);
        if (!def || !tramo) return null;
        // Filas que tienen ambos hitos del tramo
        const filasTramo = filasProceso.filter((f) => def.getDesde(f) instanceof Date && def.getHasta(f) instanceof Date);
        return {
          titulo: `Tramo · ${tramo.label} · ${filasTramo.length} pares`,
          subtitulo: `Mediana ${tramo.mediana?.toFixed(1) ?? "—"}d · responsable: ${tramo.owner}`,
          filas: filasTramo,
          origen: `/velocidad-operacional · ${procesoActivo} · tramo:${tramo.id}`,
        };
      }
    }
    return null;
  }, [procesoOp, procesoActivo, funnel, focoFunnel, focoFaltanteId, faltantes, filasProceso]);

  // ── Empty state ─────────────────────────────────────────────────────────
  if (!cruce) {
    return (
      <div className="space-y-4">
        <PageHeader
          kicker="Sistema de Velocidad Operacional"
          kickerIcon={<Activity className="size-3.5" />}
          title="Tiempos Operacionales"
          description="Control de tiempos por fecha de factura."
        />
        <EstadoFuentesBanner />
        <EmptyState
          icon={<Activity className="size-5" />}
          title="Sin datos del cruce"
          description="Carga los archivos del histórico (ROMA + Actas + ROMIA) desde /ingesta."
        />
      </div>
    );
  }

  // ── Resumen del proceso (para funnel) ────────────────────────────────────
  // Los conteos usan `filasProceso` (ya con regla de usados aplicada para
  // CN/Logística), de modo que `entregados` y `%` queden coherentes con el
  // universo del funnel.
  const tramos = funnel?.tramos ?? [];
  const tramoFinal = tramos.length ? tramos[tramos.length - 1] : null;
  const entregados = procesoOp
    ? procesoOp === "comercial"
      ? filasProceso.filter((f) => f.fSolicitud !== null && f.fFactura !== null).length
      : procesoOp === "cliente"
      ? filasProceso.filter((f) => f.fListoParaEntrega !== null && f.fEntregaReal !== null).length
      : filasProceso.filter((f) => f.entregado).length
    : 0;
  const pctEntregados = filasProceso.length > 0 ? (entregados / filasProceso.length) * 100 : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Sistema de Velocidad Operacional"
        kickerIcon={<Activity className="size-3.5" />}
        title="Tiempos Operacionales"
        description="Control de tiempos por fecha de factura. Cada proceso opera sobre el universo de autos facturados en el mes seleccionado."
      />
      <EstadoFuentesBanner />

      {/* Filtro principal: mes de factura */}
      <MesFacturaSelect opciones={opcionesMes} valor={mes} onChange={setMes} />

      {/* Selector de proceso (compacto) */}
      <ProcesoSelector
        activo={procesoActivo}
        onChange={setProcesoActivo}
        counts={procesoCounts}
      />

      {/* Toggle vista + nota de exclusión de usados */}
      {procesoOp && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex rounded-md border border-[--color-border] overflow-hidden text-[12px]">
            <button
              onClick={() => setVista("funnel")}
              className={cn(
                "px-4 py-2 transition",
                vista === "funnel"
                  ? "bg-[--color-accent]/[0.08] text-[--color-accent] font-semibold"
                  : "bg-white text-[--color-fg-muted] hover:text-[--color-fg]",
              )}
            >
              Funnel del mes
            </button>
            <button
              onClick={() => setVista("backlog")}
              className={cn(
                "px-4 py-2 transition",
                vista === "backlog"
                  ? "bg-[--color-accent]/[0.08] text-[--color-accent] font-semibold"
                  : "bg-white text-[--color-fg-muted] hover:text-[--color-fg]",
              )}
            >
              Backlog abierto
            </button>
          </div>
          {excluidosUsados > 0 && (
            <div className="text-[11px] text-[--color-fg-muted] inline-flex items-center gap-1.5 rounded-md border border-dashed border-[--color-border] px-2.5 py-1">
              <span className="text-[--color-fg-dim]">
                Usados + mayorista excluidos:
              </span>
              <span className="font-semibold text-[--color-fg]">
                {excluidosUsados.toLocaleString("es-CL")}
              </span>
              <span className="text-[--color-fg-dim]">
                · flujo propio (transferencia / liquidación), no aplica a {procesoOp === "control_negocio" ? "inscripción nueva" : "traslado retail"}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Contenido por proceso */}
      {procesoActivo === "cierre_y_cumplimiento" ? (
        <CierreCumplimientoMes stats={cierre} mesLabel={mesLabel} />
      ) : vista === "backlog" && procesoOp && funnel ? (
        <BacklogFacturaView
          stats={backlog}
          modo={modoBacklog}
          onModoChange={setModoBacklog}
          mesLabel={mesLabel}
          proceso={procesoOp}
        />
      ) : procesoOp && funnel ? (
        <>
          <ResumenEjecutivoProceso
            proceso={NOMBRE_PROCESO[procesoActivo]}
            mesLabel={mesLabel}
            facturados={funnel.universo}
            entregados={entregados}
            pctEntregados={pctEntregados}
            medianaTramoFinal={tramoFinal?.mediana ?? null}
            labelTramoFinal={tramoFinal?.label ?? "—"}
            montoRetenido={funnel.monto}
            notaMonto="suma valorFactura (null = 0)"
          />
          <FunnelHitosFactura
            etapas={funnel.etapas}
            tramos={funnel.tramos}
            foco={focoFunnel}
            onFoco={(f) => {
              setFocoFunnel(f);
              setFocoFaltanteId(null);
            }}
          />
          <FaltantesProcesoSection
            faltantes={faltantes}
            activeId={focoFaltanteId}
            onSelect={(id) => {
              setFocoFaltanteId(id);
              setFocoFunnel(null);
            }}
          />
          {colaFunnel && (
            <ColaGestionableHistorico
              titulo={colaFunnel.titulo}
              subtitulo={colaFunnel.subtitulo}
              filas={colaFunnel.filas}
              proceso={procesoOp}
              origen={colaFunnel.origen}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

/**
 * Resuelve el `campo` (clave de EntradaConsolidada) de una etapa por id.
 * Se hace acá (no en vista-derivados) porque la página necesita filtrar las
 * filas raw para construir la cola gestionable del foco.
 */
function campoDeEtapa(proceso: ProcesoOperacional, etapaId: string): string {
  const etapas: Record<string, Record<string, string>> = {
    control_negocio: {
      facturados:       "fFactura",
      sol_inscripcion:  "fSolicitudInscripcion",
      inscripcion:      "fInscripcion",
      patente_enviada:  "fPatenteEnviada",
      patente_recibida: "fPatenteRecibida",
      entregados:       "fEntregaReal",
    },
    logistica: {
      sol_roma:        "fSolicitud",
      resp_log:        "fRespuestaLogistica",
      sol_bodega:      "fSolicitudBodega",
      ing_bodega:      "fIngresoBodega",
      planificacion:   "fPlanificacionFisica",
      salida_fisica:   "fSalidaFisica",
      entrega:         "fEntregaReal",
    },
    comercial: {
      solicitud:       "fSolicitud",
      factura:         "fFactura",
    },
    cliente: {
      listo:           "fListoParaEntrega",
      entrega:         "fEntregaReal",
    },
  };
  return etapas[proceso]?.[etapaId] ?? "";
}
