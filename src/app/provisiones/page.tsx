"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  ClipboardList,
  Coins,
  FileSpreadsheet,
  MessageSquarePlus,
  Receipt,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { UploadProvisionesButton } from "@/components/UploadProvisionesButton";
import { useDatosFiltrados } from "@/lib/marca-filtro";
import { useGestionStore } from "@/lib/gestion/store";
import { SeguimientoBadge } from "@/components/SeguimientoBadge";
import { useVinContexto, VinContextoBanner } from "@/components/VinContexto";
import { limpiarVIN } from "@/lib/parser/venta-apc";
import { getMarcaOperacional, normalizarMarcaOperacional } from "@/lib/selectors/owner-operacional";
import {
  ESTADOS_GESTION_ORDEN,
  ESTADO_GESTION_LABEL,
  type EstadoGestion,
} from "@/lib/gestion/types";
import { cn } from "@/lib/cn";
import { fmtCLP, fmtCLPCompact, fmtDate, fmtNum, fmtPct } from "@/lib/format";
import {
  AGING_PROVISION_LABEL,
  AGING_PROVISION_ORDEN,
  AGING_PROVISION_TONE,
  AREA_LABEL,
  statsProvisiones,
} from "@/lib/selectors/provisiones";
import type { AgingProvision, AreaProvision, ProvisionRegistro } from "@/lib/types";

type Tab = "no_facturadas" | "facturadas_ref" | "revision";

export default function ProvisionesPage() {
  const { provisiones } = useDatosFiltrados();
  useEffect(() => {
    useGestionStore.getState().hydrate();
  }, []);

  if (!provisiones) {
    return (
      <div className="max-w-3xl mx-auto px-10 py-16 fade-in">
        <Card variant="glass">
          <CardBody className="p-10">
            <EmptyState
              icon={<FileSpreadsheet className="size-7" />}
              title="Carga el archivo de Provisiones"
              description="El módulo lee 'Provisiones al ... .xlsx' y trabaja solo con las NO facturadas — el capital de trabajo real que está provisionado y pendiente de facturar. Las facturadas se muestran como referencia secundaria."
              action={
                <div className="space-y-4 mt-2">
                  <UploadProvisionesButton />
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
      <ProvisionesInner />
    </Suspense>
  );
}

function ProvisionesInner() {
  const { data, provisiones } = useDatosFiltrados();
  const parsed = provisiones!;
  const stats = useMemo(() => statsProvisiones(parsed.registros), [parsed.registros]);

  const [tab, setTab] = useState<Tab>("no_facturadas");
  const [filtroArea, setFiltroArea] = useState<"todos" | AreaProvision>("todos");
  const [filtroMarca, setFiltroMarca] = useState<string>("todos");
  const [filtroAging, setFiltroAging] = useState<"todos" | AgingProvision>("todos");

  // Provisiones NO cruzan por VIN (son por marca/origen). Con ?vin=, mostramos
  // las provisiones de la MARCA OPERACIONAL del VIN, con nota explícita.
  const vinCtx = useVinContexto();
  const marcaDelVin = useMemo(() => {
    if (!vinCtx || !data) return null;
    const veh = data.vehiculos.find((v) => limpiarVIN(v.vin) === vinCtx);
    return veh ? getMarcaOperacional(veh) : null;
  }, [vinCtx, data]);
  useEffect(() => {
    if (marcaDelVin) setFiltroMarca(marcaDelVin);
  }, [marcaDelVin]);

  // Al clickear una card/fila de filtro, baja a la tabla de detalle.
  const detalleRef = useRef<HTMLDivElement>(null);
  const irADetalle = () =>
    requestAnimationFrame(() =>
      detalleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );

  const activas = useMemo(
    () => parsed.registros.filter((r) => r.estado === "no_facturada"),
    [parsed.registros],
  );
  const facturadas = useMemo(
    () => parsed.registros.filter((r) => r.estado === "facturada"),
    [parsed.registros],
  );
  const revision = useMemo(
    () => parsed.registros.filter((r) => r.estado === "revision_manual"),
    [parsed.registros],
  );

  const filteredActivas = useMemo(() => {
    return activas.filter((r) => {
      if (filtroArea !== "todos" && r.area !== filtroArea) return false;
      if (filtroMarca !== "todos" && normalizarMarcaOperacional(r.origen) !== filtroMarca) return false;
      if (filtroAging !== "todos" && r.agingBucket !== filtroAging) return false;
      return true;
    });
  }, [activas, filtroArea, filtroMarca, filtroAging]);

  const filteredSum = filteredActivas.reduce((s, r) => s + r.montoProvision, 0);
  const more90d = stats.agingNoFacturadas["91-180"].unidades + stats.agingNoFacturadas["180+"].unidades;
  const more90dMonto =
    stats.agingNoFacturadas["91-180"].monto + stats.agingNoFacturadas["180+"].monto;

  const visibleSet =
    tab === "no_facturadas" ? filteredActivas : tab === "facturadas_ref" ? facturadas : revision;

  return (
    <div className="max-w-[1400px] mx-auto px-10 py-10 space-y-8 fade-in">
      {vinCtx && (
        <VinContextoBanner
          vin={vinCtx}
          presentes={filteredActivas.length}
          nota={
            marcaDelVin
              ? `Las provisiones son agregadas por marca/origen; no hay detalle por VIN. Mostrando las de la marca operacional del VIN: ${marcaDelVin}.`
              : "Las provisiones son agregadas por marca/origen; no existe detalle por VIN en el archivo actual."
          }
        />
      )}
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-[--color-border] bg-gradient-to-br from-[#fff5f7] via-[#fff9eb] to-white px-10 py-8">
        <div className="absolute -top-12 -right-12 size-56 rounded-full bg-[--color-warning] opacity-[0.10] blur-3xl pointer-events-none" />
        <div className="relative flex items-start justify-between gap-6 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[--color-warning] font-semibold">
              <Receipt className="size-3.5" strokeWidth={2} />
              Provisiones · capital de trabajo no facturado
            </div>
            <h1 className="text-[28px] font-semibold tracking-tight mt-2 leading-tight text-[--color-fg]">
              {fmtNum(stats.noFacturadas.unidades)} provisiones esperando facturación
            </h1>
            <p className="text-[14px] text-[--color-fg-muted] mt-2 max-w-2xl leading-relaxed">
              Solo se cuentan provisiones <span className="text-[--color-fg] font-medium">NO facturadas</span> —
              capital activo de trabajo. Las facturadas conceptualmente migran a Saldos/Salvin si
              siguen pendientes de cobro, por eso se muestran solo como referencia.
            </p>
          </div>
          <UploadProvisionesButton compact />
        </div>
      </div>

      {/* KPI hero */}
      <div className="surface top-strip strip-warning bg-white px-8 pt-7 pb-7">
        <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr] gap-6 md:gap-10 items-end">
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-warning] font-semibold">
              Capital provisionado no facturado
            </div>
            <div className="display text-[48px] mt-3 leading-none text-[--color-fg]">
              {fmtCLPCompact(stats.noFacturadas.monto)}
            </div>
            <div className="text-[13.5px] text-[--color-fg-muted] mt-3 leading-relaxed">
              <span className="text-[--color-fg] font-semibold">
                {fmtNum(stats.noFacturadas.unidades)} provisiones
              </span>{" "}
              · {fmtCLP(stats.noFacturadas.monto)}
            </div>
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
              Aging promedio
            </div>
            <div className="display text-[28px] mt-2 leading-none text-[--color-fg]">
              {fmtNum(stats.agingPromedioDias)}d
            </div>
            <div className="text-[12px] text-[--color-fg-muted] mt-2 leading-relaxed">
              máx {fmtNum(stats.agingMaxDias)}d · sobre NO facturadas
            </div>
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
              +90 días (crítico)
            </div>
            <div
              className={cn(
                "display text-[28px] mt-2 leading-none",
                more90d > 0 ? "text-[--color-danger]" : "text-[--color-fg]",
              )}
            >
              {fmtNum(more90d)}
            </div>
            <div className="text-[12px] text-[--color-fg-muted] mt-2 leading-relaxed">
              {fmtCLPCompact(more90dMonto)} retenidos
            </div>
          </div>
        </div>
      </div>

      {/* KPI ventas vs postventa */}
      <div className="grid grid-cols-2 gap-3">
        <AreaCard
          label="Ventas"
          unidades={stats.porArea.ventas.unidades}
          monto={stats.porArea.ventas.monto}
          totalMonto={stats.noFacturadas.monto}
          active={filtroArea === "ventas"}
          onClick={() => {
            const next = filtroArea === "ventas" ? "todos" : "ventas";
            setFiltroArea(next);
            if (next !== "todos") irADetalle();
          }}
        />
        <AreaCard
          label="Postventa"
          unidades={stats.porArea.postventa.unidades}
          monto={stats.porArea.postventa.monto}
          totalMonto={stats.noFacturadas.monto}
          active={filtroArea === "postventa"}
          onClick={() => {
            const next = filtroArea === "postventa" ? "todos" : "postventa";
            setFiltroArea(next);
            if (next !== "todos") irADetalle();
          }}
        />
      </div>

      {/* Aging buckets */}
      <Card>
        <CardHeader>
          <CardTitle>Aging financiero · provisiones no facturadas</CardTitle>
          <CardDescription>
            Días desde fechaCreacion. Click para filtrar la tabla.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {AGING_PROVISION_ORDEN.map((k) => {
              const b = stats.agingNoFacturadas[k];
              if (b.unidades === 0) return null;
              const active = filtroAging === k;
              const tone = AGING_PROVISION_TONE[k];
              const stripClass =
                tone === "success"
                  ? "strip-success"
                  : tone === "info"
                    ? "strip-info"
                    : tone === "warning"
                      ? "strip-warning"
                      : tone === "danger"
                        ? "strip-danger"
                        : "strip-muted";
              const numColor =
                tone === "danger"
                  ? "text-[--color-danger]"
                  : tone === "warning"
                    ? "text-[--color-warning]"
                    : "text-[--color-fg]";
              return (
                <button
                  key={k}
                  onClick={() => {
                    setFiltroAging(active ? "todos" : k);
                    if (!active) irADetalle();
                  }}
                  className={cn(
                    "surface top-strip bg-white px-4 pt-5 pb-4 text-left transition",
                    stripClass,
                    "surface-hover",
                    active && "ring-2 ring-[--color-accent]/50 -translate-y-0.5",
                  )}
                >
                  <div className="text-[10.5px] uppercase tracking-[0.12em] text-[--color-fg-muted] font-medium">
                    {AGING_PROVISION_LABEL[k]}
                  </div>
                  <div className={cn("display text-[24px] mt-2 leading-none", numColor)}>
                    {fmtNum(b.unidades)}
                  </div>
                  <div className="text-[11px] text-[--color-fg-muted] mt-2 mono truncate">
                    {fmtCLPCompact(b.monto)}
                  </div>
                </button>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* Top marcas */}
      <Card>
        <CardHeader>
          <CardTitle>Capital provisionado por marca · solo no facturadas</CardTitle>
          <CardDescription>
            Top marcas con capital retenido en provisiones esperando facturación.
          </CardDescription>
        </CardHeader>
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10.5px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1]">
              <tr>
                <th className="text-left font-semibold px-4 py-3">Marca</th>
                <th className="text-right font-semibold px-4 py-3">Provisiones</th>
                <th className="text-right font-semibold px-4 py-3">Monto</th>
                <th className="text-right font-semibold px-4 py-3">% del total</th>
                <th className="text-left font-semibold px-4 py-3 w-[200px]">Distribución</th>
              </tr>
            </thead>
            <tbody>
              {stats.porMarcaNoFacturadas.slice(0, 15).map((m) => {
                const pct = stats.noFacturadas.monto > 0 ? m.monto / stats.noFacturadas.monto : 0;
                const active = filtroMarca === m.marca;
                return (
                  <tr
                    key={m.marca}
                    className={cn(
                      "border-b border-[--color-border-soft] last:border-0 hover:bg-[--color-bg-elev-1] transition cursor-pointer",
                      active && "bg-[--color-accent]/5",
                    )}
                    onClick={() => {
                      setFiltroMarca(active ? "todos" : m.marca);
                      if (!active) irADetalle();
                    }}
                  >
                    <td className="px-4 py-3 text-[13px] font-medium">{m.marca}</td>
                    <td className="px-4 py-3 text-right mono text-[12.5px] text-[--color-fg-muted]">
                      {fmtNum(m.unidades)}
                    </td>
                    <td className="px-4 py-3 text-right mono text-[13px] font-medium">
                      {fmtCLP(m.monto)}
                    </td>
                    <td className="px-4 py-3 text-right mono text-[12px] text-[--color-fg-muted]">
                      {fmtPct(pct)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-1.5 rounded-full bg-[--color-bg-elev-3] overflow-hidden">
                        <div
                          className="h-full bg-[--color-warning]"
                          style={{ width: `${pct * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {/* Tabs + filtros + tabla detalle */}
      <div ref={detalleRef} className="flex items-center gap-1 border-b border-[--color-border] scroll-mt-6">
        <TabBtn active={tab === "no_facturadas"} onClick={() => setTab("no_facturadas")}>
          No facturadas <span className="ml-1.5 text-[10px] mono">{fmtNum(stats.noFacturadas.unidades)}</span>
        </TabBtn>
        <TabBtn active={tab === "facturadas_ref"} onClick={() => setTab("facturadas_ref")}>
          Facturadas · revisar en Saldos{" "}
          <span className="ml-1.5 text-[10px] mono text-[--color-fg-dim]">
            {fmtNum(stats.facturadasReferencia.unidades)}
          </span>
        </TabBtn>
        {stats.revisionManual.unidades > 0 && (
          <TabBtn active={tab === "revision"} onClick={() => setTab("revision")}>
            Revisión manual{" "}
            <span className="ml-1.5 text-[10px] mono text-[--color-danger]">
              {fmtNum(stats.revisionManual.unidades)}
            </span>
          </TabBtn>
        )}
      </div>

      {tab === "no_facturadas" && (
        <>
          <div className="surface bg-white px-5 py-4 flex flex-wrap items-center gap-3">
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-[--color-fg-muted] font-medium">
              Filtros
            </div>
            <select
              value={filtroMarca}
              onChange={(e) => setFiltroMarca(e.target.value)}
              className="rounded-md border border-[--color-border-strong] bg-white px-2.5 py-1 text-[12.5px]"
            >
              <option value="todos">Marca · todas</option>
              {stats.porMarcaNoFacturadas.map((m) => (
                <option key={m.marca} value={m.marca}>
                  {m.marca} ({m.unidades})
                </option>
              ))}
            </select>
            <select
              value={filtroArea}
              onChange={(e) => setFiltroArea(e.target.value as "todos" | AreaProvision)}
              className="rounded-md border border-[--color-border-strong] bg-white px-2.5 py-1 text-[12.5px]"
            >
              <option value="todos">Área · todas</option>
              <option value="ventas">Ventas</option>
              <option value="postventa">Postventa</option>
            </select>
            {(filtroMarca !== "todos" || filtroArea !== "todos" || filtroAging !== "todos") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFiltroMarca("todos");
                  setFiltroArea("todos");
                  setFiltroAging("todos");
                }}
              >
                Limpiar filtros
              </Button>
            )}
            <div className="ml-auto text-[12px] text-[--color-fg-muted]">
              {fmtNum(filteredActivas.length)} provisiones · {fmtCLPCompact(filteredSum)}
            </div>
          </div>

          <DetalleTable registros={filteredActivas} mostrarGestion />
        </>
      )}

      {tab === "facturadas_ref" && (
        <div className="space-y-4">
          <Card>
            <CardBody className="p-5">
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-lg bg-[--color-info]/10 grid place-items-center shrink-0">
                  <ClipboardList className="size-4 text-[--color-info]" />
                </div>
                <div>
                  <div className="text-[13px] font-medium text-[--color-fg]">
                    Solo referencia · {fmtNum(stats.facturadasReferencia.unidades)} provisiones ya
                    facturadas
                  </div>
                  <div className="text-[12px] text-[--color-fg-muted] mt-0.5">
                    No entran al capital activo de provisiones. Si están pendientes de cobro,
                    conceptualmente viven en Saldos. No se gestionan acá.
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
          <DetalleTable registros={facturadas} mostrarGestion={false} />
        </div>
      )}

      {tab === "revision" && (
        <div className="space-y-4">
          <Card>
            <CardBody className="p-5">
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-lg bg-[--color-danger]/10 grid place-items-center shrink-0">
                  <AlertTriangle className="size-4 text-[--color-danger]" />
                </div>
                <div>
                  <div className="text-[13px] font-medium text-[--color-fg]">
                    {fmtNum(stats.revisionManual.unidades)} provisiones con EstadoAjuste pendiente
                  </div>
                  <div className="text-[12px] text-[--color-fg-muted] mt-0.5">
                    Estado contable ambiguo — pendiente aprobación gerencia o ajuste sin resolver.
                    Validar caso a caso.
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
          <DetalleTable registros={revision} mostrarGestion />
        </div>
      )}
    </div>
  );
}

function AreaCard({
  label,
  unidades,
  monto,
  totalMonto,
  active,
  onClick,
}: {
  label: string;
  unidades: number;
  monto: number;
  totalMonto: number;
  active: boolean;
  onClick: () => void;
}) {
  const pct = totalMonto > 0 ? monto / totalMonto : 0;
  return (
    <button
      onClick={onClick}
      disabled={unidades === 0}
      className={cn(
        "surface top-strip strip-info bg-white px-5 pt-5 pb-4 text-left transition",
        unidades === 0 && "opacity-50 cursor-default",
        unidades > 0 && "surface-hover",
        active && "ring-2 ring-[--color-accent]/50 -translate-y-0.5",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="text-[10.5px] uppercase tracking-[0.12em] text-[--color-info] font-semibold">
          {label}
        </div>
        <span className="text-[11px] mono text-[--color-fg-muted]">{fmtPct(pct)}</span>
      </div>
      <div className="display text-[28px] mt-3 leading-none text-[--color-fg]">
        {fmtCLPCompact(monto)}
      </div>
      <div className="text-[12px] text-[--color-fg-muted] mt-2">
        {fmtNum(unidades)} provisiones
      </div>
    </button>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-2.5 text-[13px] font-medium transition border-b-2 -mb-px",
        active
          ? "border-[--color-accent] text-[--color-fg]"
          : "border-transparent text-[--color-fg-muted] hover:text-[--color-fg]",
      )}
    >
      {children}
    </button>
  );
}

function DetalleTable({
  registros,
  mostrarGestion,
}: {
  registros: ProvisionRegistro[];
  mostrarGestion: boolean;
}) {
  return (
    <Card>
      <CardBody className="p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[1400px]">
          <thead className="text-[10.5px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1]">
            <tr>
              <th className="text-left font-semibold px-4 py-3">ID · Periodo</th>
              <th className="text-left font-semibold px-4 py-3">Marca</th>
              <th className="text-left font-semibold px-4 py-3">Concepto · Motivo</th>
              <th className="text-left font-semibold px-4 py-3">Solicitante</th>
              <th className="text-right font-semibold px-4 py-3">Monto provisión</th>
              <th className="text-left font-semibold px-4 py-3">Aging</th>
              <th className="text-right font-semibold px-4 py-3">Días</th>
              <th className="text-left font-semibold px-4 py-3">Área</th>
              <th className="text-left font-semibold px-4 py-3">Estado conta</th>
              {mostrarGestion && (
                <th className="text-left font-semibold px-4 py-3">Gestión</th>
              )}
            </tr>
          </thead>
          <tbody>
            {registros.slice(0, 200).map((r, idx) => (
              <ProvisionRow
                key={`${r.id}-${r.rowIndex}`}
                r={r}
                idx={idx}
                mostrarGestion={mostrarGestion}
              />
            ))}
          </tbody>
        </table>
        {registros.length > 200 && (
          <div className="px-4 py-3 text-[11.5px] text-[--color-fg-muted] border-t border-[--color-border-soft] bg-[--color-bg-elev-1]">
            Mostrando primeros 200 de {fmtNum(registros.length)}. Refina filtros para ver el resto.
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ProvisionRow({
  r,
  idx,
  mostrarGestion,
}: {
  r: ProvisionRegistro;
  idx: number;
  mostrarGestion: boolean;
}) {
  const sev =
    r.agingDias !== null && r.agingDias > 90
      ? "danger"
      : r.agingDias !== null && r.agingDias > 60
        ? "warning"
        : null;
  return (
    <tr
      className={cn(
        "align-top border-b border-[--color-border-soft] last:border-0 transition",
        idx % 2 === 0
          ? "bg-white hover:bg-[--color-bg-elev-1]"
          : "bg-[--color-bg-elev-1]/40 hover:bg-[--color-bg-elev-1]",
        sev === "danger" && "shadow-[inset_3px_0_0_var(--color-danger)]",
        sev === "warning" && "shadow-[inset_3px_0_0_var(--color-warning)]",
      )}
    >
      <td className="px-4 py-3">
        <div className="mono text-[11.5px] text-[--color-fg]">PROV-{r.id}</div>
        <div className="text-[11px] text-[--color-fg-muted] mt-0.5">{r.periodo ?? "—"}</div>
      </td>
      <td className="px-4 py-3 text-[12.5px] font-medium text-[--color-fg]">
        {r.origen ?? <span className="text-[--color-fg-dim]">—</span>}
      </td>
      <td className="px-4 py-3">
        <div className="text-[12.5px] text-[--color-fg]">{r.concepto ?? "—"}</div>
        <div className="text-[11px] text-[--color-fg-muted] truncate max-w-[220px] mt-0.5">
          {r.motivo ?? "—"}
        </div>
      </td>
      <td className="px-4 py-3 text-[11.5px] text-[--color-fg-muted] truncate max-w-[180px]">
        {r.solicitante ?? "—"}
      </td>
      <td className="px-4 py-3 text-right mono text-[13px] font-medium">
        {fmtCLP(r.montoProvision)}
      </td>
      <td className="px-4 py-3">
        <Badge tone={AGING_PROVISION_TONE[r.agingBucket]} size="xs">
          {AGING_PROVISION_LABEL[r.agingBucket]}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right mono text-[12px] text-[--color-fg-muted]">
        {r.agingDias ?? "—"}
      </td>
      <td className="px-4 py-3 text-[11.5px] text-[--color-fg-muted]">
        {AREA_LABEL[r.area]}
      </td>
      <td className="px-4 py-3 text-[11.5px] text-[--color-fg-muted]">
        {r.estadoArchivo ?? "—"}
        {r.estadoAjuste && /pendiente/i.test(r.estadoAjuste) && (
          <div className="text-[10.5px] text-[--color-danger] mt-0.5">
            Ajuste pendiente
          </div>
        )}
      </td>
      {mostrarGestion && (
        <td className="px-4 py-3">
          <GestionProvision clave={r.claveGestion} />
        </td>
      )}
    </tr>
  );
}

function GestionProvision({ clave }: { clave: string }) {
  const gestion = useGestionStore((s) => s.byVin[clave]);
  const setG = useGestionStore((s) => s.setGestion);
  const clearG = useGestionStore((s) => s.clearGestion);
  const [expanded, setExpanded] = useState(false);

  const estadoActual: EstadoGestion = gestion?.estadoGestion ?? "abierto";
  const tieneNota = !!(gestion?.comentario || gestion?.responsable || gestion?.fechaCompromiso);

  return (
    <div className="space-y-1">
      <button
        onClick={() => setExpanded((e) => !e)}
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md transition border",
          tieneNota
            ? "border-[--color-accent]/30 bg-[--color-accent]/5 text-[--color-fg] hover:bg-[--color-accent]/10"
            : "border-[--color-border] bg-[--color-bg-elev-2] text-[--color-fg-muted] hover:text-[--color-fg]",
        )}
      >
        {tieneNota ? (
          <>
            <SeguimientoBadge vin={clave} />
            {gestion?.responsable && (
              <span className="text-[--color-fg-dim] truncate max-w-[100px]">
                {gestion.responsable}
              </span>
            )}
          </>
        ) : (
          <>
            <MessageSquarePlus className="size-3" />
            Agregar
          </>
        )}
      </button>
      {expanded && (
        <div className="rounded-md border border-[--color-border] bg-[--color-bg-elev-1] p-2.5 space-y-2 w-[280px]">
          <select
            value={estadoActual}
            onChange={(e) => setG(clave, { estadoGestion: e.target.value as EstadoGestion })}
            className="w-full rounded-md border border-[--color-border-strong] bg-white px-2 py-1 text-[12px]"
          >
            {ESTADOS_GESTION_ORDEN.map((s) => (
              <option key={s} value={s}>
                {ESTADO_GESTION_LABEL[s]}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Responsable"
            defaultValue={gestion?.responsable ?? ""}
            onBlur={(e) => setG(clave, { responsable: e.target.value || null })}
            className="w-full rounded-md border border-[--color-border-strong] bg-white px-2 py-1 text-[12px]"
          />
          <input
            type="date"
            defaultValue={gestion?.fechaCompromiso ?? ""}
            onChange={(e) => setG(clave, { fechaCompromiso: e.target.value || null })}
            className="w-full rounded-md border border-[--color-border-strong] bg-white px-2 py-1 text-[12px]"
          />
          <textarea
            placeholder="Comentario · próximo paso, blocker, etc."
            defaultValue={gestion?.comentario ?? ""}
            onBlur={(e) => setG(clave, { comentario: e.target.value || null })}
            rows={3}
            className="w-full rounded-md border border-[--color-border-strong] bg-white px-2 py-1 text-[12px] resize-none"
          />
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-[--color-fg-dim]">
              {gestion?.ultimaActualizacion
                ? `act. ${new Date(gestion.ultimaActualizacion).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })}`
                : "Sin guardar"}
            </div>
            {gestion && (
              <button
                onClick={() => {
                  clearG(clave);
                  setExpanded(false);
                }}
                className="text-[10.5px] text-[--color-danger] hover:underline"
              >
                Limpiar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
