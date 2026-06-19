"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FileSpreadsheet,
  Link2,
  Truck,
  X,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { UploadFNEButton } from "@/components/UploadFNEButton";
import { CreditoPompeyoBadge } from "@/components/CreditoPompeyoBadge";
import { BloqueosCell } from "@/components/BloqueosCell";
import { AbrirCasoButton } from "@/components/AbrirCasoButton";
import { useGestionStore } from "@/lib/gestion/store";
import { cruzarSaldosConStock } from "@/lib/selectors/saldos";
import { calcularCreditoPompeyoPorVIN } from "@/lib/selectors/credito-pompeyo";
import { razonesBloqueoFNE } from "@/lib/selectors/razones-bloqueo";
import { limpiarVIN } from "@/lib/parser/venta-apc";
import { useVinContexto, VinContextoBanner } from "@/components/VinContexto";
import { useDatosFiltrados } from "@/lib/marca-filtro";
import { cn } from "@/lib/cn";
import { fmtCLP, fmtCLPCompact, fmtDate, fmtNum, fmtPct } from "@/lib/format";
import {
  AGING_REAL_LABEL,
  AGING_REAL_TONE,
  ESTADOS_BLOQUEO_ARTIFICIAL,
  ESTADOS_ENTREGA_EN_SUCURSAL,
  ESTADOS_INSCRIPCION_PROCESO,
  ESTADOS_PATENTE_EN_CAMINO,
  ESTADO_ENTREGA_DESC,
  ESTADO_ENTREGA_LABEL,
  ESTADO_ENTREGA_TONE,
  ETAPA_LABEL,
  ORDEN_ESTADO,
  alinearFNEConROMA,
  cruzarFNEConStock,
  statsFNEReal,
} from "@/lib/selectors/fne-real";
import { useHistoricoStore } from "@/lib/historico/store-cliente";

/** Filtros que se pueden aplicar al panel inline al drillear desde una card.
 *  Los tramos son MUTUAMENTE EXCLUYENTES (cada operación cae en uno solo). */
type DrillFilter = "all" | "alertas" | "t0_3" | "t4_7" | "t8_15" | "t16_30" | "t30";

type Tone = "success" | "info" | "warning" | "danger" | "muted";

function toneToStrip(tone: Tone): string {
  switch (tone) {
    case "success":
      return "strip-success";
    case "info":
      return "strip-info";
    case "warning":
      return "strip-warning";
    case "danger":
      return "strip-danger";
    case "muted":
      return "strip-muted";
  }
}

function toneToTextColor(tone: Tone): string {
  switch (tone) {
    case "success":
      return "text-[--color-success]";
    case "info":
      return "text-[--color-info]";
    case "warning":
      return "text-[--color-warning]";
    case "danger":
      return "text-[--color-danger]";
    case "muted":
      return "text-[--color-fg]";
  }
}

const DRILL_FILTER_LABEL: Record<DrillFilter, string> = {
  all: "Todos",
  alertas: "Alertas (críticos)",
  t0_3: "≤3 días",
  t4_7: "4-7 días",
  t8_15: "8-15 días",
  t16_30: "16-30 días",
  t30: "Más de 30 días",
};
import { calcularVUEnFNE } from "@/lib/selectors/vu-en-fne";
import type { AgingFNEReal, EstadoEntrega, EtapaFNE } from "@/lib/types";

export default function FNEPage() {
  const { data, fne } = useDatosFiltrados();

  if (!fne) {
    return (
      <div className="max-w-3xl mx-auto px-10 py-16 fade-in">
        <Card variant="glass">
          <CardBody className="p-10">
            <EmptyState
              icon={<FileSpreadsheet className="size-7" />}
              title="Carga el archivo Autos no entregados"
              description="El módulo FNE usa el archivo oficial separado (no se infiere desde el stock). Súbelo para ver cantidad, valorización, aging real, listo para entregar y aging."
              action={
                <div className="space-y-4 mt-2">
                  <UploadFNEButton />
                  {!data && (
                    <div className="text-[12px] text-[--color-fg-muted]">
                      ¿Aún no cargaste el Excel maestro?{" "}
                      <Link href="/" className="text-[--color-accent] hover:underline">
                        Ir al inicio →
                      </Link>
                    </div>
                  )}
                </div>
              }
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="p-10 text-sm text-[--color-fg-muted]">Cargando…</div>}>
      <FNEInner />
    </Suspense>
  );
}

function FNEInner() {
  const { data, fne, saldos } = useDatosFiltrados();
  const cruceRoma = useHistoricoStore((s) => s.cruce);
  const parsedFNEBase = fne!;

  // Alinear flag `entregado` del archivo con ROMA-Actas (verdad operacional).
  // Si ROMA dice "no entregado" para un VIN, override aunque archivo diga
  // "Cargado". El archivo manda solo cuando ROMA no tiene la entrada.
  const parsedFNE = useMemo(() => {
    if (!cruceRoma || cruceRoma.filas.length === 0) return parsedFNEBase;
    const registrosAlineados = alinearFNEConROMA(
      parsedFNEBase.registros,
      cruceRoma.filas,
    );
    return {
      ...parsedFNEBase,
      registros: registrosAlineados,
      report: {
        ...parsedFNEBase.report,
        entregadosCount: registrosAlineados.filter((r) => r.entregado).length,
        noEntregadosCount: registrosAlineados.filter((r) => !r.entregado).length,
      },
    };
  }, [parsedFNEBase, cruceRoma]);

  const cruzados = useMemo(
    () =>
      cruzarFNEConStock(
        parsedFNE.registros,
        data?.vehiculos ?? [],
        data?.vinsExtra ?? null,
      ),
    [parsedFNE.registros, data?.vehiculos, data?.vinsExtra],
  );
  const stats = useMemo(() => statsFNEReal(cruzados), [cruzados]);

  // Crédito Pompeyo por VIN — solo si está cargado el archivo de saldos.
  // Sin saldos, todos pasan como "Sin C.P." (lo cual es optimista pero válido —
  // sin información financiera, asumimos no bloqueado).
  const creditoMap = useMemo(() => {
    if (!saldos) return new Map();
    const cruzadosSaldos = cruzarSaldosConStock(
      saldos.registros,
      data?.vehiculos ?? [],
      data?.vinsExtra ?? null,
      parsedFNE,
    );
    return calcularCreditoPompeyoPorVIN(cruzadosSaldos);
  }, [saldos, data?.vehiculos, data?.vinsExtra, parsedFNE]);

  // Listos para entrega 100% = sin bloqueos (operacional + financiero)
  const listosTotales = useMemo(() => {
    return cruzados.filter((c) => razonesBloqueoFNE(c, creditoMap).length === 0).length;
  }, [cruzados, creditoMap]);

  // Capital puente real desde Base_Stock (NO desde PatenteVpp del archivo FNE)
  const puente = useMemo(
    () => (data ? calcularVUEnFNE(data.vehiculos) : null),
    [data],
  );

  const [filtroEstado, setFiltroEstado] = useState<"todos" | EstadoEntrega>("todos");
  const [filtroAging, setFiltroAging] = useState<"todos" | AgingFNEReal>("todos");
  const [filtroSucursal, setFiltroSucursal] = useState<string>("todos");
  // Drill inline (panel debajo de la card, no lateral)
  const [drill, setDrill] = useState<{
    bucket: EstadoEntrega;
    filter: DrillFilter;
  } | null>(null);
  const tablaRef = useRef<HTMLDivElement>(null);

  // Navegación contextual por VIN (?vin=XXXX desde el caso operacional).
  const vinCtx = useVinContexto();

  // Hidratar capa de gestión desde localStorage al montar
  useEffect(() => {
    useGestionStore.getState().hydrate();
  }, []);

  // Si llegamos con ?vin=, posicionar la tabla del caso.
  useEffect(() => {
    if (vinCtx) tablaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [vinCtx]);

  const onDrill = (bucket: EstadoEntrega, filter: DrillFilter) => {
    setDrill((prev) =>
      prev?.bucket === bucket && prev.filter === filter ? null : { bucket, filter },
    );
  };

  // Auto-scroll a la tabla al activar un filtro (no en estado inicial "todos")
  useEffect(() => {
    if (filtroEstado === "todos" && filtroAging === "todos" && filtroSucursal === "todos") return;
    tablaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [filtroEstado, filtroAging, filtroSucursal]);

  const filtrado = useMemo(() => {
    // Contexto por VIN: muestra SOLO ese caso (ignora otros filtros).
    if (vinCtx) return cruzados.filter((c) => limpiarVIN(c.fne.vin) === vinCtx);
    return cruzados.filter((c) => {
      if (filtroEstado !== "todos" && c.estadoEntrega !== filtroEstado) return false;
      if (filtroAging !== "todos" && c.agingBucket !== filtroAging) return false;
      if (filtroSucursal !== "todos" && c.fne.sucursal !== filtroSucursal) return false;
      return true;
    });
  }, [cruzados, filtroEstado, filtroAging, filtroSucursal, vinCtx]);

  const pctListos = stats.total > 0 ? stats.listoParaEntregar / stats.total : 0;

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-10 space-y-8 fade-in overflow-x-hidden lg:overflow-x-visible">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-[--color-border] bg-gradient-to-br from-[#eef2ff] via-[#f0f9ff] to-white px-10 py-8">
        <div className="absolute -top-12 -right-12 size-56 rounded-full bg-[--color-info] opacity-[0.12] blur-3xl pointer-events-none" />
        <div className="relative flex items-start justify-between gap-6 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[--color-info] font-semibold">
              <Truck className="size-3.5" strokeWidth={2} />
              Fuente oficial · Autos no entregados
            </div>
            <h1 className="text-[28px] font-semibold tracking-tight mt-2 leading-tight text-[--color-fg]">
              Facturados no entregados
            </h1>
            <p className="text-[14px] text-[--color-fg-muted] mt-2 max-w-2xl leading-relaxed">
              Universo real del archivo{" "}
              <span className="text-[--color-fg] font-medium">Autos no entregados.xlsx</span>{" "}
              ({fmtNum(parsedFNE.registros.length)} registros). Cruzado por VIN con el stock para
              validar dónde está cada auto y dónde está su patente.
            </p>
          </div>
          <UploadFNEButton compact />
        </div>
      </div>

      {/* KPI hero — Listo para entregar (los hot) */}
      <div className="surface top-strip strip-success bg-white px-8 pt-7 pb-7">
        <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr] gap-6 md:gap-10 items-end">
          <div>
            <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-[--color-success] font-semibold">
              <CheckCircle2 className="size-3.5" strokeWidth={2} />
              Listo para entregar · hoy
            </div>
            <div className="display text-[56px] mt-3 leading-none text-[--color-success]">
              {saldos ? fmtNum(listosTotales) : fmtNum(stats.listoParaEntregar)}
            </div>
            <div className="text-[13.5px] text-[--color-fg-muted] mt-3 leading-relaxed">
              {saldos ? (
                <>
                  <span className="text-[--color-fg] font-semibold">
                    {fmtNum(listosTotales)} sin bloqueos
                  </span>{" "}
                  · patente + solicitud + autorización + sin Crédito Pompeyo ·{" "}
                  {fmtPct(stats.total > 0 ? listosTotales / stats.total : 0)} del universo FNE
                </>
              ) : (
                <>
                  <span className="text-[--color-fg] font-semibold">
                    {fmtCLPCompact(stats.valorListoParaEntregar)}
                  </span>{" "}
                  comprometidos · {fmtPct(pctListos)} del universo FNE · patente + sol +
                  autorización · <span className="text-[--color-warning]">carga Saldos para descontar Crédito Pompeyo</span>
                </>
              )}
            </div>
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
              Universo FNE
            </div>
            <div className="display text-[28px] mt-2 leading-none text-[--color-fg]">
              {fmtNum(stats.total)}
            </div>
            <div className="text-[12px] text-[--color-fg-muted] mt-2 leading-relaxed">
              {fmtCLPCompact(stats.valorTotal)} facturado · {fmtCLP(stats.valorTotal)}
            </div>
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
              Cobertura cruce VIN
            </div>
            <div className="display text-[28px] mt-2 leading-none text-[--color-fg]">
              {fmtPct(
                stats.total > 0
                  ? (stats.cruzadosConStock + stats.cruzadosConHistorico) / stats.total
                  : 0,
              )}
            </div>
            <div className="text-[12px] text-[--color-fg-muted] mt-2 leading-relaxed">
              {fmtNum(stats.cruzadosConStock)} en stock activo ·{" "}
              {fmtNum(stats.cruzadosConHistorico)} en histórico ·{" "}
              {fmtNum(stats.sinCruceStock)} sin cruce
            </div>
          </div>
        </div>
      </div>

      {/* Reconciliación automática: listos operacionalmente vs entregables hoy */}
      {saldos && (
        <div className="surface bg-white px-5 py-3 flex items-start gap-2.5 text-[12.5px] text-[--color-fg-muted] leading-relaxed">
          <CheckCircle2 className="size-4 text-[--color-success] shrink-0 mt-0.5" />
          <span>
            <span className="text-[--color-fg] font-medium">
              {fmtNum(stats.porEstado.listo_para_entregar)} listos operacionalmente
            </span>{" "}
            (patente + solicitud + autorización).{" "}
            {Math.max(0, stats.porEstado.listo_para_entregar - listosTotales) > 0 ? (
              <>
                De ellos,{" "}
                <span className="text-[--color-warning] font-medium">
                  {fmtNum(stats.porEstado.listo_para_entregar - listosTotales)} con Crédito Pompeyo
                  por cobrar
                </span>{" "}
                →{" "}
                <span className="text-[--color-success] font-medium">
                  entregables hoy: {fmtNum(listosTotales)}
                </span>
                . La diferencia es bloqueo financiero, no un error.
              </>
            ) : (
              <span className="text-[--color-success] font-medium">
                Todos entregables hoy, sin bloqueo financiero.
              </span>
            )}
          </span>
        </div>
      )}

      {/* Estado de entrega — 9 buckets agrupados por etapa del pipeline */}
      <Card>
        <CardHeader>
          <CardTitle>Estado de entrega · pipeline completo</CardTitle>
          <CardDescription>
            Nueve buckets mutuamente excluyentes, suman al universo total (
            {fmtNum(stats.total)} operaciones). Agrupados por la etapa del proceso:
            entrega → patente en camino → inscripción.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-5">
          <EstadoGrupo
            titulo="En sucursal"
            descripcion="Patente recibida — diferencia: ¿se cerraron los trámites de entrega?"
            estados={ESTADOS_ENTREGA_EN_SUCURSAL}
            stats={stats}
            cruzados={cruzados}
            creditoMap={creditoMap}
            drill={drill}
            onDrill={onDrill}
            onCloseDrill={() => setDrill(null)}
          />
          <EstadoGrupo
            titulo="Patente en camino"
            descripcion="Patente ya inscrita por Registro Civil — todavía no recibida en sucursal."
            estados={ESTADOS_PATENTE_EN_CAMINO}
            stats={stats}
            cruzados={cruzados}
            creditoMap={creditoMap}
            drill={drill}
            onDrill={onDrill}
            onCloseDrill={() => setDrill(null)}
          />
          <EstadoGrupo
            titulo="En proceso de inscripción"
            descripcion="Patente todavía no inscrita por Registro Civil. Aquí se ve dónde se detiene el flujo: sucursal, Control de Negocios o Registro Civil."
            estados={ESTADOS_INSCRIPCION_PROCESO}
            stats={stats}
            cruzados={cruzados}
            creditoMap={creditoMap}
            drill={drill}
            onDrill={onDrill}
            onCloseDrill={() => setDrill(null)}
          />
          <SumCheck
            label="Estado de entrega"
            partes={ORDEN_ESTADO.map((k) => stats.porEstado[k])}
            total={stats.total}
          />
        </CardBody>
      </Card>

      {/* Aging real */}
      <Card>
        <CardHeader>
          <CardTitle>Aging real desde FechaFactura</CardTitle>
          <CardDescription>
            Aging calculado directamente desde la fecha de factura del archivo (no estimado).
          </CardDescription>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {(Object.keys(AGING_REAL_LABEL) as AgingFNEReal[])
              .filter((k) => k !== "sin_fecha" || stats.porAging[k] > 0)
              .map((k) => {
              const active = filtroAging === k;
              const tone = AGING_REAL_TONE[k];
              const count = stats.porAging[k];
              const stripClass = toneToStrip(tone);
              const numColor = toneToTextColor(tone);
              return (
                <button
                  key={k}
                  onClick={() => setFiltroAging(active ? "todos" : k)}
                  disabled={count === 0}
                  className={cn(
                    "surface top-strip bg-white px-4 pt-5 pb-4 text-left transition",
                    stripClass,
                    count === 0 && "opacity-50 cursor-default",
                    count > 0 && "surface-hover hover:-translate-y-0.5",
                    active && "ring-2 ring-[--color-accent]/40 -translate-y-0.5",
                  )}
                >
                  <div className="text-[10.5px] uppercase tracking-[0.12em] text-[--color-fg-muted] font-medium">
                    {AGING_REAL_LABEL[k]}
                  </div>
                  <div className={cn("display text-[26px] mt-2 leading-none", numColor)}>
                    {fmtNum(count)}
                  </div>
                  <div className="text-[11px] text-[--color-fg-muted] mt-2 mono">
                    {stats.total > 0 ? fmtPct(count / stats.total) : "—"}
                  </div>
                </button>
              );
            })}
          </div>
          <SumCheck
            label="Aging"
            partes={(Object.keys(AGING_REAL_LABEL) as AgingFNEReal[]).map(
              (k) => stats.porAging[k],
            )}
            total={stats.total}
          />
        </CardBody>
      </Card>

      {/* Capital puente — link al módulo VPP (sigue Base_Stock, NO PatenteVpp) */}
      {puente && (
        <Link
          href="/vu-en-fne"
          className="surface surface-hover top-strip strip-puente group block bg-white px-7 pt-7 pb-6"
        >
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-center">
            <div>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[--color-warning] font-semibold">
                <Link2 className="size-3.5" strokeWidth={2} />
                Usados pendientes de recuperación
              </div>
              <div className="display text-[40px] mt-3 leading-none text-[--color-warning]">
                {fmtCLPCompact(puente.capitalTotal)}
              </div>
              <div className="text-[13px] text-[--color-fg-muted] mt-3 leading-relaxed max-w-xl">
                <span className="text-[--color-fg] font-medium">
                  {fmtNum(puente.totalUnidades)} usados retenidos
                </span>{" "}
                por operaciones nuevas todavía abiertas — capital que no recuperamos hasta cerrar
                la venta. La otra cara de los facturados no entregados.
              </div>
            </div>
            <div className="flex items-center gap-2 text-[13px] font-medium text-[--color-warning] group-hover:gap-3 transition-all">
              Ver usados retenidos
              <ArrowRight className="size-4" />
            </div>
          </div>
        </Link>
      )}

      {/* Filtros + chips activos */}
      <div className="surface bg-white px-5 py-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] uppercase tracking-[0.12em] text-[--color-fg-muted] font-medium">
            Filtros
          </span>
          <select
            value={filtroSucursal}
            onChange={(e) => setFiltroSucursal(e.target.value)}
            className="rounded-md border border-[--color-border-strong] bg-white px-2.5 py-1 text-[12.5px] text-[--color-fg] hover:border-[--color-accent]/40 transition"
          >
            <option value="todos">Sucursal · todas</option>
            {stats.porSucursal.map((s) => (
              <option key={s.sucursal} value={s.sucursal}>
                {s.sucursal} ({s.unidades})
              </option>
            ))}
          </select>
        </div>
        {filtroEstado !== "todos" && (
          <FiltroChip
            label={`Estado: ${ESTADO_ENTREGA_LABEL[filtroEstado]}`}
            onClear={() => setFiltroEstado("todos")}
          />
        )}
        {filtroAging !== "todos" && (
          <FiltroChip
            label={`Aging: ${AGING_REAL_LABEL[filtroAging]}`}
            onClear={() => setFiltroAging("todos")}
          />
        )}
        {filtroSucursal !== "todos" && (
          <FiltroChip
            label={`Sucursal: ${filtroSucursal}`}
            onClear={() => setFiltroSucursal("todos")}
          />
        )}
        {(filtroEstado !== "todos" || filtroAging !== "todos" || filtroSucursal !== "todos") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFiltroEstado("todos");
              setFiltroAging("todos");
              setFiltroSucursal("todos");
            }}
            className="ml-auto"
          >
            Limpiar todo
          </Button>
        )}
      </div>

      {/* Tabla */}
      <div ref={tablaRef} className="scroll-mt-6">
      {vinCtx && <VinContextoBanner vin={vinCtx} presentes={filtrado.length} />}
      <Card>
        <CardHeader>
          <CardTitle>
            Detalle — {fmtNum(filtrado.length)}{" "}
            {filtrado.length === 1 ? "operación" : "operaciones"}
          </CardTitle>
          <CardDescription>
            Vista detalle con cruce contra stock. Las notas de gestión (comentario, responsable,
            fecha compromiso) están indexadas por VIN, así que aparecen sincronizadas con el panel
            inline de cada bucket — son el mismo auto visto desde otro ángulo.
          </CardDescription>
        </CardHeader>
        <CardBody className="p-2 lg:p-0 lg:overflow-x-auto">
          <table className="w-full text-sm block lg:table lg:min-w-[1500px] linear-table">
            <thead className="hidden lg:table-header-group text-[10.5px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1]">
              <tr>
                <th className="text-left font-semibold px-4 py-3">Cliente · Vendedor</th>
                <th className="text-left font-semibold px-4 py-3">Sucursal</th>
                <th className="text-left font-semibold px-4 py-3">VIN</th>
                <th className="text-left font-semibold px-4 py-3">Estado</th>
                <th className="text-left font-semibold px-4 py-3">Aging</th>
                <th className="text-right font-semibold px-4 py-3">Días</th>
                <th className="text-left font-semibold px-4 py-3">Etapa</th>
                <th className="text-left font-semibold px-4 py-3">Patente / proceso</th>
                <th className="text-right font-semibold px-4 py-3">Valor factura</th>
                <th className="text-left font-semibold px-4 py-3">Alerta</th>
                <th className="text-left font-semibold px-4 py-3">C. Pompeyo</th>
                <th className="text-left font-semibold px-4 py-3">Bloqueos</th>
                <th className="text-left font-semibold px-4 py-3">Gestión</th>
                <th className="text-left font-semibold px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="block lg:table-row-group">
              {filtrado.slice(0, 200).map((c, idx) => {
                const f = c.fne;
                const dStato = c.diasEnEstado ?? 0;
                const alertaSev: "danger" | "warning" | "muted" | null =
                  dStato > 15 ? "danger" : dStato > 7 ? "warning" : null;
                const alertaTexto =
                  dStato > 30
                    ? "Crítico · >30d"
                    : dStato > 15
                      ? "Atrasado · >15d"
                      : dStato > 7
                        ? "Atención · >7d"
                        : null;
                // Móvil: cada td se apila como fila etiquetada (card); desktop: celda.
                const tdM =
                  "block lg:table-cell before:content-[attr(data-label)] before:block before:text-[9px] before:uppercase before:tracking-[0.08em] before:text-[--color-fg-muted] before:font-semibold before:mb-0.5 lg:before:hidden";
                return (
                  <tr
                    key={`${f.id}-${f.vin}-${f.rowIndex}`}
                    className={cn(
                      "align-top transition block lg:table-row",
                      "border border-[--color-border] rounded-xl mb-3 p-1.5 lg:p-0 lg:mb-0 lg:rounded-none lg:border-0 lg:border-b lg:border-[--color-border-soft] lg:last:border-0",
                      idx % 2 === 0
                        ? "bg-white hover:bg-[--color-bg-elev-1]"
                        : "bg-[--color-bg-elev-1]/40 hover:bg-[--color-bg-elev-1]",
                      alertaSev === "danger" &&
                        "shadow-[inset_3px_0_0_var(--color-danger)]",
                      alertaSev === "warning" &&
                        "shadow-[inset_3px_0_0_var(--color-warning)]",
                    )}
                  >
                    <td className="px-4 py-2 lg:py-3 block lg:table-cell">
                      <div className="font-semibold text-[13px] text-[--color-fg] truncate max-w-[220px]">
                        {f.cliente ?? "—"}
                      </div>
                      <div className="text-[11.5px] text-[--color-fg-muted] truncate max-w-[220px] mt-0.5">
                        {f.vendedor ?? "—"}
                      </div>
                    </td>
                    <td className="hidden lg:table-cell px-4 py-3 text-[12px] text-[--color-fg]">
                      {f.sucursal ?? "—"}
                    </td>
                    <td data-label="VIN" className={cn(tdM, "px-4 py-1.5 lg:py-3 mono text-[11px] text-[--color-fg-muted]")}>
                      {f.vin}
                    </td>
                    <td data-label="Estado" className={cn(tdM, "px-4 py-1.5 lg:py-3")}>
                      <Badge tone={ESTADO_ENTREGA_TONE[c.estadoEntrega]} size="xs">
                        {ESTADO_ENTREGA_LABEL[c.estadoEntrega]}
                      </Badge>
                    </td>
                    <td data-label="Aging" className={cn(tdM, "px-4 py-1.5 lg:py-3")}>
                      <Badge tone={AGING_REAL_TONE[c.agingBucket]} size="xs">
                        {AGING_REAL_LABEL[c.agingBucket]}
                      </Badge>
                    </td>
                    <td className="hidden lg:table-cell px-4 py-3 text-right mono text-[12.5px] text-[--color-fg]">
                      {c.diasDesdeFactura ?? <span className="text-[--color-fg-dim]">—</span>}
                    </td>
                    <td className="hidden lg:table-cell px-4 py-3 text-[11.5px] text-[--color-fg-muted]">
                      {ETAPA_LABEL[f.etapa]}
                    </td>
                    <td className="hidden lg:table-cell px-4 py-3 text-[11.5px]">
                      <PatenteCell c={c} />
                    </td>
                    <td data-label="Valor factura" className={cn(tdM, "px-4 py-1.5 lg:py-3 text-left lg:text-right mono text-[12.5px] font-medium text-[--color-fg]")}>
                      {fmtCLP(f.valorFactura)}
                    </td>
                    <td data-label="Alerta" className={cn(tdM, "px-4 py-1.5 lg:py-3")}>
                      {alertaTexto && alertaSev ? (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium border",
                            alertaSev === "danger"
                              ? "bg-[--color-danger]/12 text-[--color-danger] border-[--color-danger]/30"
                              : "bg-[--color-warning]/12 text-[--color-warning] border-[--color-warning]/30",
                          )}
                        >
                          <AlertTriangle className="size-3" strokeWidth={2.5} />
                          {alertaTexto}
                        </span>
                      ) : (
                        <span className="text-[--color-fg-dim] text-[11px]">—</span>
                      )}
                    </td>
                    <td className="hidden lg:table-cell px-4 py-3">
                      {(() => {
                        const vinL = limpiarVIN(f.vin);
                        const cp = creditoMap.get(vinL);
                        return <CreditoPompeyoBadge tiene={!!cp} monto={cp?.monto ?? 0} compact />;
                      })()}
                    </td>
                    <td data-label="Bloqueos" className={cn(tdM, "px-4 py-1.5 lg:py-3")}>
                      <BloqueosCell bloqueos={razonesBloqueoFNE(c, creditoMap)} />
                    </td>
                    <td data-label="Gestión" className={cn(tdM, "px-4 py-1.5 lg:py-3")}>
                      <AbrirCasoButton vin={limpiarVIN(f.vin)} origen="Facturados no entregados" />
                    </td>
                    <td className="hidden lg:table-cell px-4 py-3">
                      <Link
                        href={`/stock?q=${encodeURIComponent(f.vin)}&dup=1`}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[--color-border] text-[11px] text-[--color-fg-muted] hover:text-[--color-accent] hover:border-[--color-accent]/40 hover:bg-[--color-accent]/5 transition"
                      >
                        Stock
                        <ExternalLink className="size-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtrado.length > 200 && (
            <div className="px-4 py-3 text-xs text-[--color-fg-muted] border-t border-[--color-border]">
              Mostrando primeros 200 de {fmtNum(filtrado.length)}. Refina filtros para ver el
              resto.
            </div>
          )}
        </CardBody>
      </Card>
      </div>

      {/* Etapas + Sucursales */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ClipboardCheck className="size-4 text-[--color-fg-muted]" />
              <CardTitle>Distribución por etapa</CardTitle>
            </div>
            <CardDescription>
              Etapa del flujo administrativo (1 venta → 8 patente en sucursal).
            </CardDescription>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-[--color-fg-muted] uppercase tracking-wider">
                <tr className="border-b border-[--color-border]">
                  <th className="text-left font-medium px-4 py-2">Etapa</th>
                  <th className="text-right font-medium px-4 py-2">Unidades</th>
                  <th className="text-right font-medium px-4 py-2">% del total</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(stats.porEtapa) as unknown as EtapaFNE[])
                  .filter((k) => stats.porEtapa[k] > 0)
                  .sort((a, b) => stats.porEtapa[b] - stats.porEtapa[a])
                  .map((k) => (
                    <tr key={k} className="border-b border-[--color-border] last:border-0">
                      <td className="px-4 py-2 text-[13px]">{ETAPA_LABEL[k]}</td>
                      <td className="px-4 py-2 text-right mono">{fmtNum(stats.porEtapa[k])}</td>
                      <td className="px-4 py-2 text-right text-[--color-fg-muted]">
                        {stats.total > 0 ? fmtPct(stats.porEtapa[k] / stats.total) : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top sucursales</CardTitle>
            <CardDescription>FNE acumuladas por sucursal de venta.</CardDescription>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-[--color-fg-muted] uppercase tracking-wider">
                <tr className="border-b border-[--color-border]">
                  <th className="text-left font-medium px-4 py-2">Sucursal</th>
                  <th className="text-right font-medium px-4 py-2">Unidades</th>
                  <th className="text-right font-medium px-4 py-2">Valor</th>
                </tr>
              </thead>
              <tbody>
                {stats.porSucursal.slice(0, 12).map((s) => (
                  <tr key={s.sucursal} className="border-b border-[--color-border] last:border-0">
                    <td className="px-4 py-2 text-[13px]">{s.sucursal}</td>
                    <td className="px-4 py-2 text-right mono">{fmtNum(s.unidades)}</td>
                    <td className="px-4 py-2 text-right mono text-[--color-fg-muted]">
                      {fmtCLPCompact(s.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}


/** Muestra la señal más reciente del flujo de patente según el estado actual. */
function PatenteCell({ c }: { c: ReturnType<typeof cruzarFNEConStock>[number] }) {
  const f = c.fne;
  switch (c.estadoEntrega) {
    case "listo_para_entregar":
    case "falta_solo_autorizacion":
    case "patente_en_sucursal":
      return (
        <Badge tone="success" size="xs">
          Recibida {fmtDate(f.fechaPatenteRecibida)}
        </Badge>
      );
    case "patente_en_transito":
      return (
        <span className="text-[--color-fg-muted]">
          Enviada {fmtDate(f.fechaPatenteEnviada)}
        </span>
      );
    case "patente_en_admin":
      return (
        <span className="text-[--color-fg-muted]">
          En admin {fmtDate(f.patentesAdministracion)}
        </span>
      );
    case "inscrita_sin_admin":
      return (
        <Badge tone="info" size="xs">
          Inscrita {fmtDate(f.fechaInscripcion)}
        </Badge>
      );
    case "en_registro_civil":
      return (
        <span className="text-[--color-fg-muted]">
          Enviada a RC {fmtDate(f.fechaSolicitudInscripcion)}
        </span>
      );
    case "en_control_negocios":
      return <span className="text-[--color-fg-muted]">En CdN</span>;
    case "sin_solicitud_inscripcion":
      return (
        <span className="text-[--color-fg-dim] italic">Sin solicitud</span>
      );
  }
}

/** Grupo de buckets de Estado de entrega agrupado por etapa del pipeline. */
function EstadoGrupo({
  titulo,
  descripcion,
  estados,
  stats,
  cruzados,
  creditoMap,
  drill,
  onDrill,
  onCloseDrill,
}: {
  titulo: string;
  descripcion: string;
  estados: EstadoEntrega[];
  stats: ReturnType<typeof statsFNEReal>;
  cruzados: ReturnType<typeof cruzarFNEConStock>;
  creditoMap: ReturnType<typeof calcularCreditoPompeyoPorVIN>;
  drill: { bucket: EstadoEntrega; filter: DrillFilter } | null;
  onDrill: (bucket: EstadoEntrega, filter: DrillFilter) => void;
  onCloseDrill: () => void;
}) {
  const subtotal = estados.reduce((s, k) => s + stats.porEstado[k], 0);
  const subValor = estados.reduce((s, k) => s + stats.valorPorEstado[k], 0);
  const drillInThisGrupo = drill && estados.includes(drill.bucket) ? drill : null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
        <div>
          <div className="text-[11.5px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-semibold">
            {titulo}
          </div>
          <div className="text-[12px] text-[--color-fg-dim] mt-0.5 max-w-2xl">{descripcion}</div>
        </div>
        <div className="text-[12px] text-[--color-fg-muted] mono">
          {fmtNum(subtotal)} u · {fmtCLPCompact(subValor)}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {estados.map((k) => {
          const count = stats.porEstado[k];
          const valor = stats.valorPorEstado[k];
          const ant = stats.antiguedadPorEstado[k];
          const sev = sevDeAntiguedad(ant);
          const disabled = count === 0;
          const isActive = drillInThisGrupo?.bucket === k;
          const tone = ESTADO_ENTREGA_TONE[k] as Tone;
          // Bloqueo artificial: auto listo en sucursal, solo falta trámite interno.
          // Alerta INMEDIATA desde el día 0 (no depende del aging).
          const esArtificial = ESTADOS_BLOQUEO_ARTIFICIAL.includes(k);
          const alertaInmediata = esArtificial && !disabled;
          const effectiveTone: Tone =
            alertaInmediata || sev === "critical" ? "danger" : tone;
          const stripClass = toneToStrip(effectiveTone);
          const numColor = toneToTextColor(effectiveTone);
          return (
            <div
              key={k}
              title={ESTADO_ENTREGA_DESC[k]}
              className={cn(
                "group surface top-strip bg-white px-4 pt-5 pb-3 transition relative",
                stripClass,
                disabled && "opacity-50",
                !disabled && "surface-hover",
                alertaInmediata && "ring-1 ring-[--color-danger]/40",
                isActive && "ring-2 ring-[--color-accent]/50 -translate-y-0.5",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <Badge tone={alertaInmediata ? "danger" : ESTADO_ENTREGA_TONE[k]} size="xs">
                  {ESTADO_ENTREGA_LABEL[k]}
                </Badge>
                {alertaInmediata ? (
                  <button
                    onClick={() => onDrill(k, "all")}
                    title="El auto está listo para entregar (patente en sucursal). Solo falta un trámite interno — bloqueo artificial, gestionar ya."
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 bg-[--color-danger]/15 hover:bg-[--color-danger]/25 transition"
                  >
                    <Zap className="size-3 text-[--color-danger]" strokeWidth={2.5} />
                    <span className="text-[10px] text-[--color-danger] font-semibold uppercase tracking-wide">
                      Alerta inmediata
                    </span>
                  </button>
                ) : sev === "critical" && !disabled ? (
                  <button
                    onClick={() => onDrill(k, "alertas")}
                    title={
                      ant.mayor30d > 0
                        ? `${ant.mayor30d} operaciones llevan más de 30 días en este estado`
                        : `${ant.mayor15d} operaciones llevan más de 15 días en este estado`
                    }
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 bg-[--color-danger]/15 hover:bg-[--color-danger]/25 transition"
                  >
                    <AlertTriangle className="size-3 text-[--color-danger]" strokeWidth={2.5} />
                    <span className="text-[10px] text-[--color-danger] font-semibold mono">
                      {ant.mayor30d > 0 ? `${ant.mayor30d} >30d` : `${ant.mayor15d} >15d`}
                    </span>
                  </button>
                ) : null}
              </div>
              {/* Click en el número grande → drill all */}
              <button
                onClick={() => !disabled && onDrill(k, "all")}
                disabled={disabled}
                className={cn(
                  "block w-full text-left mt-3 transition",
                  !disabled && "cursor-pointer hover:opacity-90",
                )}
              >
                <div className={cn("display text-[28px] leading-none", numColor)}>
                  {fmtNum(count)}
                </div>
                <div className="text-[11.5px] text-[--color-fg-muted] mt-2">
                  {stats.total > 0 ? fmtPct(count / stats.total) : "—"} ·{" "}
                  {fmtCLPCompact(valor)}
                </div>
              </button>
              {count > 0 && (
                <AntiguedadFooter
                  ant={ant}
                  sev={sev}
                  onDrill={(filter) => onDrill(k, filter)}
                  activeFilter={isActive ? drillInThisGrupo?.filter ?? null : null}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Panel inline expandible — debajo de las cards de este grupo */}
      {drillInThisGrupo && (
        <BucketPanel
          bucket={drillInThisGrupo.bucket}
          filter={drillInThisGrupo.filter}
          cruzados={cruzados}
          stats={stats}
          creditoMap={creditoMap}
          onChangeFilter={(f) => onDrill(drillInThisGrupo.bucket, f)}
          onClose={onCloseDrill}
        />
      )}
    </div>
  );
}

type SevAntiguedad = "ok" | "warning" | "danger" | "critical";

function sevDeAntiguedad(ant: import("@/lib/types").AntigüedadEstado): SevAntiguedad {
  if (ant.mayor30d > 0) return "critical";
  if (ant.mayor15d > 0) return "danger";
  if (ant.mayor7d > 0) return "warning";
  return "ok";
}

/**
 * Tramos de antigüedad MUTUAMENTE EXCLUYENTES derivados de los conteos
 * acumulados de AntigüedadEstado. Cada operación cae en un solo tramo.
 *   t0_3 = ≤3d · t4_7 = 4-7d · t8_15 = 8-15d · t16_30 = 16-30d · t30 = >30d
 * Suma = conFecha.
 */
function tramosDeAntiguedad(ant: import("@/lib/types").AntigüedadEstado) {
  return {
    t0_3: ant.conFecha - ant.mayor3d,
    t4_7: ant.mayor3d - ant.mayor7d,
    t8_15: ant.mayor7d - ant.mayor15d,
    t16_30: ant.mayor15d - ant.mayor30d,
    t30: ant.mayor30d,
  };
}

function AntiguedadFooter({
  ant,
  sev,
  onDrill,
  activeFilter,
}: {
  ant: import("@/lib/types").AntigüedadEstado;
  sev: SevAntiguedad;
  onDrill: (filter: DrillFilter) => void;
  activeFilter: DrillFilter | null;
}) {
  if (ant.conFecha === 0) return null;

  const maxTextClass =
    sev === "critical"
      ? "text-[--color-danger]"
      : sev === "danger"
        ? "text-[--color-danger]"
        : sev === "warning"
          ? "text-[--color-warning]"
          : "text-[--color-fg]";

  return (
    <div className="mt-3 pt-3 border-t border-[--color-border-soft] space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] uppercase tracking-[0.1em] text-[--color-fg-muted] font-medium">
          Antigüedad máx
        </span>
        <span className={cn("mono font-semibold text-[15px]", maxTextClass)}>
          {ant.maxDias}d
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {(() => {
          const t = tramosDeAntiguedad(ant);
          return (
            <>
              {t.t0_3 > 0 && (
                <ThresholdChip n={t.t0_3} label="≤3d" tone="ok" onClick={() => onDrill("t0_3")} active={activeFilter === "t0_3"} />
              )}
              {t.t4_7 > 0 && (
                <ThresholdChip n={t.t4_7} label="4-7d" tone="warning" onClick={() => onDrill("t4_7")} active={activeFilter === "t4_7"} />
              )}
              {t.t8_15 > 0 && (
                <ThresholdChip n={t.t8_15} label="8-15d" tone="warning" onClick={() => onDrill("t8_15")} active={activeFilter === "t8_15"} />
              )}
              {t.t16_30 > 0 && (
                <ThresholdChip n={t.t16_30} label="16-30d" tone="danger" onClick={() => onDrill("t16_30")} active={activeFilter === "t16_30"} />
              )}
              {t.t30 > 0 && (
                <ThresholdChip n={t.t30} label=">30d" tone="critical" onClick={() => onDrill("t30")} active={activeFilter === "t30"} />
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}

function ThresholdChip({
  n,
  label,
  tone,
  onClick,
  active,
}: {
  n: number;
  label: string;
  tone: "ok" | "warning" | "danger" | "critical";
  onClick?: () => void;
  active?: boolean;
}) {
  const toneClass =
    tone === "critical"
      ? "bg-[--color-danger]/15 text-[--color-danger] border-[--color-danger]/30 hover:bg-[--color-danger]/25"
      : tone === "danger"
        ? "bg-[--color-danger]/10 text-[--color-danger] border-[--color-danger]/20 hover:bg-[--color-danger]/20"
        : tone === "warning"
          ? "bg-[--color-warning]/10 text-[--color-warning] border-[--color-warning]/25 hover:bg-[--color-warning]/20"
          : "bg-[--color-bg-elev-3] text-[--color-fg-muted] border-[--color-border] hover:bg-[--color-bg-elev-3]";
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border text-[10.5px] mono font-medium transition cursor-pointer",
        toneClass,
        active && "ring-2 ring-[--color-accent]/40",
      )}
    >
      <span>{n}</span>
      <span className="opacity-80">{label}</span>
    </button>
  );
}

/** Panel expandible debajo de las cards. Lista accionable de los registros del bucket. */
function BucketPanel({
  bucket,
  filter,
  cruzados,
  stats,
  creditoMap,
  onChangeFilter,
  onClose,
}: {
  bucket: EstadoEntrega;
  filter: DrillFilter;
  cruzados: ReturnType<typeof cruzarFNEConStock>;
  stats: ReturnType<typeof statsFNEReal>;
  creditoMap: ReturnType<typeof calcularCreditoPompeyoPorVIN>;
  onChangeFilter: (f: DrillFilter) => void;
  onClose: () => void;
}) {
  const ant = stats.antiguedadPorEstado[bucket];

  const tramos = tramosDeAntiguedad(ant);

  // Filtro aplicado por el chip activo. Los tramos son intervalos excluyentes.
  const filtered = useMemo(() => {
    const base = cruzados.filter((c) => c.estadoEntrega === bucket);
    // d > minExcl && d <= maxIncl (solo registros con fecha de antigüedad).
    const enTramo = (minExcl: number, maxIncl: number) =>
      base.filter((c) => {
        const d = c.diasEnEstado;
        return d != null && d > minExcl && d <= maxIncl;
      });
    let rows = base;
    switch (filter) {
      case "all":
        rows = base;
        break;
      case "alertas":
        // Alerta ejecutiva: el peor tramo con casos (acumulado crítico).
        if (ant.mayor30d > 0) rows = base.filter((c) => (c.diasEnEstado ?? 0) > 30);
        else if (ant.mayor15d > 0) rows = base.filter((c) => (c.diasEnEstado ?? 0) > 15);
        else if (ant.mayor7d > 0) rows = base.filter((c) => (c.diasEnEstado ?? 0) > 7);
        else if (ant.mayor3d > 0) rows = base.filter((c) => (c.diasEnEstado ?? 0) > 3);
        else rows = [];
        break;
      case "t0_3":
        rows = enTramo(Number.NEGATIVE_INFINITY, 3);
        break;
      case "t4_7":
        rows = enTramo(3, 7);
        break;
      case "t8_15":
        rows = enTramo(7, 15);
        break;
      case "t16_30":
        rows = enTramo(15, 30);
        break;
      case "t30":
        rows = enTramo(30, Number.POSITIVE_INFINITY);
        break;
    }
    return rows.sort((a, b) => (b.diasEnEstado ?? -1) - (a.diasEnEstado ?? -1));
  }, [cruzados, bucket, filter, ant]);

  const filtros: { f: DrillFilter; visible: boolean }[] = [
    { f: "all", visible: true },
    { f: "t0_3", visible: tramos.t0_3 > 0 },
    { f: "t4_7", visible: tramos.t4_7 > 0 },
    { f: "t8_15", visible: tramos.t8_15 > 0 },
    { f: "t16_30", visible: tramos.t16_30 > 0 },
    { f: "t30", visible: tramos.t30 > 0 },
    { f: "alertas", visible: filter === "alertas" },
  ];

  const bucketTone = ESTADO_ENTREGA_TONE[bucket] as Tone;
  return (
    <div
      className={cn(
        "mt-3 surface top-strip bg-white overflow-hidden ring-1 ring-[--color-accent]/40 shadow-[0_8px_24px_-12px_var(--color-accent-glow)]",
        toneToStrip(bucketTone),
      )}
    >
      {/* Header del panel */}
      <div className="px-5 pt-5 pb-3 border-b border-[--color-border-soft] flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={ESTADO_ENTREGA_TONE[bucket]} size="xs">
              {ESTADO_ENTREGA_LABEL[bucket]}
            </Badge>
            <span className="text-[12.5px] text-[--color-fg]">
              <span className="font-semibold mono">{fmtNum(filtered.length)}</span>{" "}
              <span className="text-[--color-fg-muted]">· {DRILL_FILTER_LABEL[filter]}</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {filtros
              .filter((x) => x.visible)
              .map((x) => (
                <button
                  key={x.f}
                  onClick={() => onChangeFilter(x.f)}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-[11px] font-medium border transition",
                    filter === x.f
                      ? "border-[--color-accent] bg-[--color-accent]/10 text-[--color-accent] shadow-sm"
                      : "border-[--color-border] bg-white text-[--color-fg-muted] hover:border-[--color-border-strong] hover:text-[--color-fg]",
                  )}
                >
                  {DRILL_FILTER_LABEL[x.f]}
                </button>
              ))}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-[--color-fg-muted] hover:text-[--color-fg] p-1.5 rounded-md hover:bg-[--color-bg-elev-2] transition shrink-0"
          aria-label="Cerrar panel"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[1200px]">
          <thead className="text-[10.5px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1]">
            <tr>
              <th className="text-left font-semibold px-4 py-3">Cliente · Sucursal</th>
              <th className="text-left font-semibold px-4 py-3">VIN · Patente</th>
              <th className="text-left font-semibold px-4 py-3">Marca / modelo</th>
              <th className="text-right font-semibold px-4 py-3">Días en estado</th>
              <th className="text-right font-semibold px-4 py-3">Valor</th>
              <th className="text-left font-semibold px-4 py-3">Alerta</th>
              <th className="text-left font-semibold px-4 py-3">C. Pompeyo</th>
              <th className="text-left font-semibold px-4 py-3">Bloqueos</th>
              <th className="text-left font-semibold px-4 py-3">Gestión</th>
              <th className="text-left font-semibold px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 100).map((c, idx) => (
              <BucketRow
                key={`${c.fne.id}-${c.fne.vin}-${c.fne.rowIndex}`}
                c={c}
                idx={idx}
                creditoMap={creditoMap}
              />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="px-6 py-10 text-center text-[13px] text-[--color-fg-muted]">
            No hay registros que cumplan este filtro.
          </div>
        )}
        {filtered.length > 100 && (
          <div className="px-4 py-3 text-[11.5px] text-[--color-fg-muted] border-t border-[--color-border-soft] bg-[--color-bg-elev-1]">
            Mostrando primeros 100 de {fmtNum(filtered.length)}. Aplica un filtro de antigüedad
            más estricto para acotar.
          </div>
        )}
      </div>
    </div>
  );
}

/** Fila individual de la tabla del panel — incluye gestión inline. */
function BucketRow({
  c,
  idx,
  creditoMap,
}: {
  c: ReturnType<typeof cruzarFNEConStock>[number];
  idx: number;
  creditoMap: ReturnType<typeof calcularCreditoPompeyoPorVIN>;
}) {
  const f = c.fne;
  const v = c.vehiculo;
  const ext = c.vehiculoExtra;
  const d = c.diasEnEstado ?? 0;
  const vinL = limpiarVIN(f.vin);
  const cp = creditoMap.get(vinL);
  const bloqueos = razonesBloqueoFNE(c, creditoMap);
  const dColor =
    d > 30
      ? "text-[--color-danger]"
      : d > 15
        ? "text-[--color-danger]"
        : d > 7
          ? "text-[--color-warning]"
          : "text-[--color-fg-muted]";

  const alertaTexto =
    d > 30
      ? "Crítico · >30d"
      : d > 15
        ? "Atrasado · >15d"
        : d > 7
          ? "Atención · >7d"
          : null;
  const alertaSev: "danger" | "warning" | null = d > 15 ? "danger" : d > 7 ? "warning" : null;

  return (
    <tr
      className={cn(
        "transition align-top border-b border-[--color-border-soft] last:border-0",
        idx % 2 === 0 ? "bg-white hover:bg-[--color-bg-elev-1]" : "bg-[--color-bg-elev-1]/40 hover:bg-[--color-bg-elev-1]",
        alertaSev === "danger" && "shadow-[inset_3px_0_0_var(--color-danger)]",
        alertaSev === "warning" && "shadow-[inset_3px_0_0_var(--color-warning)]",
      )}
    >
      <td className="px-4 py-3">
        <div className="font-medium text-[--color-fg] text-[13px] truncate max-w-[260px]">
          {f.cliente ?? "—"}
        </div>
        <div className="text-[11.5px] text-[--color-fg-muted] truncate max-w-[260px] mt-0.5">
          {f.sucursal ?? "—"} · {f.vendedor ?? "—"}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="mono text-[11px] text-[--color-fg]">{f.vin}</div>
        <div className="mono text-[11px] text-[--color-fg-muted] mt-0.5">
          {v?.patente ?? <span className="text-[--color-fg-dim]">—</span>}
        </div>
      </td>
      <td className="px-4 py-3">
        {v ? (
          <>
            <div className="text-[13px] text-[--color-fg]">{v.marca ?? v.marcaPompeyo ?? "—"}</div>
            <div className="text-[11.5px] text-[--color-fg-muted] truncate max-w-[200px] mt-0.5">
              {v.modelo ?? "—"}
            </div>
          </>
        ) : ext ? (
          <>
            <div className="text-[13px] text-[--color-fg]">{ext.marca ?? "—"}</div>
            <div className="text-[11.5px] text-[--color-fg-muted] truncate max-w-[200px] mt-0.5">
              {ext.modelo ?? "—"}{" "}
              <span className="text-[10px] text-[--color-fg-dim]">· {ext.fuente}</span>
            </div>
          </>
        ) : (
          <span className="text-[11.5px] text-[--color-fg-dim] italic">Sin cruce</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <div className={cn("mono text-[15px] font-semibold", dColor)}>{d}d</div>
        <div className="text-[10.5px] text-[--color-fg-dim] mt-0.5">
          {c.estadoEntrega === "listo_para_entregar" ||
          c.estadoEntrega === "falta_solo_autorizacion" ||
          c.estadoEntrega === "patente_en_sucursal"
            ? "recibida"
            : c.estadoEntrega === "inscrita_sin_admin"
              ? "inscrita"
              : "ref."}
        </div>
      </td>
      <td className="px-4 py-3 text-right mono text-[12.5px] font-medium text-[--color-fg]">
        {fmtCLP(f.valorFactura)}
      </td>
      <td className="px-4 py-3">
        {alertaTexto && alertaSev ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium border",
              alertaSev === "danger"
                ? "bg-[--color-danger]/12 text-[--color-danger] border-[--color-danger]/30"
                : "bg-[--color-warning]/12 text-[--color-warning] border-[--color-warning]/30",
            )}
          >
            <AlertTriangle className="size-3" strokeWidth={2.5} />
            {alertaTexto}
          </span>
        ) : (
          <span className="text-[--color-fg-dim] text-[11px]">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <CreditoPompeyoBadge tiene={!!cp} monto={cp?.monto ?? 0} compact />
      </td>
      <td className="px-4 py-3">
        <BloqueosCell bloqueos={bloqueos} />
      </td>
      <td className="px-4 py-3">
        <AbrirCasoButton vin={limpiarVIN(f.vin)} origen="Facturados no entregados" />
      </td>
      <td className="px-4 py-3">
        <Link
          href={`/stock?q=${encodeURIComponent(f.vin)}&dup=1`}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[--color-border] text-[11px] text-[--color-fg-muted] hover:text-[--color-accent] hover:border-[--color-accent]/40 hover:bg-[--color-accent]/5 transition"
        >
          Stock
          <ExternalLink className="size-3" />
        </Link>
      </td>
    </tr>
  );
}

function FiltroChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[--color-accent]/10 text-[--color-accent] text-[11.5px] font-medium border border-[--color-accent]/20">
      {label}
      <button
        onClick={onClear}
        className="hover:bg-[--color-accent]/15 rounded p-0.5 transition"
        aria-label="Quitar filtro"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/** Indicador de reconciliación — confirma que los buckets suman al universo total. */
function SumCheck({
  label,
  partes,
  total,
}: {
  label: string;
  partes: number[];
  total: number;
}) {
  const suma = partes.reduce((a, b) => a + b, 0);
  const ok = suma === total;
  return (
    <div
      className={cn(
        "mt-4 text-[11.5px] flex items-center gap-2",
        ok ? "text-[--color-fg-muted]" : "text-[--color-danger] font-medium",
      )}
    >
      <span
        className={cn(
          "inline-block size-1.5 rounded-full",
          ok ? "bg-[--color-success]" : "bg-[--color-danger]",
        )}
      />
      <span>
        {label}: {fmtNum(suma)} / {fmtNum(total)} ·{" "}
        {ok ? "cuadra" : `Δ ${fmtNum(Math.abs(total - suma))} sin clasificar`}
      </span>
    </div>
  );
}
