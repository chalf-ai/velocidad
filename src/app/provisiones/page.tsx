"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ClipboardList,
  FileSpreadsheet,
  Receipt,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { UploadProvisionesButton } from "@/components/UploadProvisionesButton";
import { useDatosFiltrados } from "@/lib/marca-filtro";
import { useGestionStore } from "@/lib/gestion/store";
import { GestionInline } from "@/components/GestionInline";
import { useVinContexto, VinContextoBanner } from "@/components/VinContexto";
import { limpiarVIN } from "@/lib/parser/venta-apc";
import { getMarcaOperacional, normalizarMarcaOperacional } from "@/lib/selectors/owner-operacional";
import { cn } from "@/lib/cn";
import { fmtCLP, fmtCLPCompact, fmtNum, fmtPct } from "@/lib/format";
import {
  AGING_PROVISION_LABEL,
  AGING_PROVISION_ORDEN,
  AGING_PROVISION_TONE,
  statsProvisiones,
} from "@/lib/selectors/provisiones";
import type { AgingProvision, ProvisionRegistro } from "@/lib/types";

/** Buckets de saldo del módulo. */
type Bucket = "positivo" | "cero" | "negativo";

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
              description="El módulo lee 'Provisiones al ... .xlsx' y trabaja con el SALDO PENDIENTE oficial (columna saldo). Postventa queda como referencia separada."
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

  // Universo principal del módulo = "ventas" (postventa se reporta aparte).
  const ventas = useMemo(
    () => parsed.registros.filter((r) => r.area === "ventas"),
    [parsed.registros],
  );
  const postventa = useMemo(
    () => parsed.registros.filter((r) => r.area === "postventa"),
    [parsed.registros],
  );

  const [bucket, setBucket] = useState<Bucket>("positivo");
  const [filtroMarca, setFiltroMarca] = useState<string>("todos");
  const [filtroAging, setFiltroAging] = useState<"todos" | AgingProvision>("todos");
  const [mostrarPostventa, setMostrarPostventa] = useState(false);

  // Con ?vin=, mostramos las provisiones de la MARCA OPERACIONAL del VIN.
  const vinCtx = useVinContexto();
  const marcaDelVin = useMemo(() => {
    if (!vinCtx || !data) return null;
    const veh = data.vehiculos.find((v) => limpiarVIN(v.vin) === vinCtx);
    return veh ? getMarcaOperacional(veh) : null;
  }, [vinCtx, data]);
  useEffect(() => {
    if (marcaDelVin) setFiltroMarca(marcaDelVin);
  }, [marcaDelVin]);

  const detalleRef = useRef<HTMLDivElement>(null);
  const irADetalle = () =>
    requestAnimationFrame(() =>
      detalleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );

  const matchBucket = (r: ProvisionRegistro): boolean => {
    if (bucket === "positivo") return r.saldo > 0;
    if (bucket === "negativo") return r.saldo < 0;
    return r.saldo === 0;
  };

  const filtrados = useMemo(() => {
    const universo = mostrarPostventa ? postventa : ventas;
    return universo.filter((r) => {
      if (!matchBucket(r)) return false;
      if (filtroMarca !== "todos" && normalizarMarcaOperacional(r.origen) !== filtroMarca)
        return false;
      if (filtroAging !== "todos" && r.agingBucket !== filtroAging) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ventas, postventa, mostrarPostventa, bucket, filtroMarca, filtroAging]);

  const filtradosSaldo = filtrados.reduce((s, r) => s + (r.saldo || 0), 0);

  const more90 =
    stats.agingAbiertas["91-180"].unidades + stats.agingAbiertas["180+"].unidades;
  const more90Saldo =
    stats.agingAbiertas["91-180"].saldo + stats.agingAbiertas["180+"].saldo;

  return (
    <div className="max-w-[1400px] mx-auto px-10 py-10 space-y-8 fade-in">
      {vinCtx && (
        <VinContextoBanner
          vin={vinCtx}
          presentes={filtrados.length}
          nota={
            marcaDelVin
              ? `Las provisiones son agregadas por marca/origen; no hay detalle por VIN. Mostrando las de ${marcaDelVin}.`
              : "Las provisiones son agregadas por marca/origen; no existe detalle por VIN."
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
              Provisiones · saldo pendiente
            </div>
            <h1 className="text-[28px] font-semibold tracking-tight mt-2 leading-tight text-[--color-fg]">
              {fmtCLPCompact(stats.saldoPendiente)} de saldo pendiente
            </h1>
            <p className="text-[13.5px] text-[--color-fg-muted] mt-2 max-w-3xl leading-relaxed">
              Métrica oficial: <b>SUM(saldo)</b> sobre el área de Ventas
              ({fmtNum(stats.total)} registros · {fmtNum(stats.abiertas)} abiertas ·{" "}
              {fmtNum(stats.cerradas)} cerradas). Postventa va aparte como referencia. El monto
              provisionado original y el facturado se conservan como detalle, no como pendiente.
            </p>
          </div>
          <UploadProvisionesButton compact />
        </div>
      </div>

      {/* Fila de 5 KPIs principales */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiPrincipal
          label="Saldo pendiente"
          value={fmtCLPCompact(stats.saldoPendiente)}
          sub={`${fmtNum(stats.abiertas)} abiertas`}
          tone="warning"
          tip="SUM(saldo) sobre ventas. Métrica oficial del módulo."
        />
        <KpiPrincipal
          label="Monto provisionado"
          value={fmtCLPCompact(stats.montoProvisionTotal)}
          sub="provisión original"
          tip="SUM(montoProvision): lo que se provisionó en total (incluye lo ya facturado)."
        />
        <KpiPrincipal
          label="Monto facturado"
          value={fmtCLPCompact(stats.montoFacturaTotal)}
          sub="ya cobrado/emitido"
          tip="SUM(montoFactura): lo que se ha facturado contra las provisiones."
        />
        <KpiPrincipal
          label="Saldo negativo"
          value={fmtCLPCompact(stats.saldoNegativo)}
          sub="sobrefacturación / ajuste"
          tone={stats.saldoNegativo < 0 ? "danger" : "muted"}
          tip="SUM(saldo < 0): provisiones donde se facturó más de lo provisionado o hay ajuste pendiente. Se muestran, no se ocultan."
        />
        <KpiPrincipal
          label="Registros abiertos"
          value={fmtNum(stats.abiertas)}
          sub={`${fmtNum(stats.cerradas)} cerradas (saldo 0)`}
          tip="Cantidad de provisiones con saldo distinto de cero."
        />
      </div>

      {/* Aging crítico + buckets para drill */}
      <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-3">
        <Card>
          <CardHeader>
            <CardTitle>Aging del saldo abierto</CardTitle>
            <CardDescription>
              Días desde fechaCreacion en provisiones con saldo &gt; 0. Click para filtrar.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {AGING_PROVISION_ORDEN.map((k) => {
                const b = stats.agingAbiertas[k];
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
                      setBucket("positivo");
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
                    <div className={cn("display text-[22px] mt-2 leading-none", numColor)}>
                      {fmtNum(b.unidades)}
                    </div>
                    <div className="text-[11px] text-[--color-fg-muted] mt-2 mono truncate">
                      {fmtCLPCompact(b.saldo)}
                    </div>
                  </button>
                );
              })}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Crítico &gt;90 días</CardTitle>
            <CardDescription>
              Saldo abierto envejecido. Aging prom {fmtNum(stats.agingPromedioDias)}d · máx{" "}
              {fmtNum(stats.agingMaxDias)}d.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-[--color-danger] font-semibold">
              Provisiones &gt;90 días
            </div>
            <div className={cn("display text-[32px] mt-2 leading-none", more90 > 0 ? "text-[--color-danger]" : "text-[--color-fg]")}>
              {fmtNum(more90)}
            </div>
            <div className="text-[12.5px] text-[--color-fg-muted] mt-2">
              {fmtCLPCompact(more90Saldo)} en saldo pendiente
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Tabla por marca (ventas) */}
      <Card>
        <CardHeader>
          <CardTitle>Saldo pendiente por marca · ventas</CardTitle>
          <CardDescription>
            Ordenado por SUM(saldo). Click una fila para filtrar el detalle. Postventa queda excluida.
          </CardDescription>
        </CardHeader>
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead className="text-[10.5px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1]">
              <tr>
                <th className="text-left font-semibold px-4 py-3">Marca / Origen</th>
                <th className="text-right font-semibold px-4 py-3">u</th>
                <th className="text-right font-semibold px-4 py-3">Provisionado</th>
                <th className="text-right font-semibold px-4 py-3">Facturado</th>
                <th className="text-right font-semibold px-4 py-3">Saldo pendiente</th>
                <th className="text-right font-semibold px-4 py-3">Ajustes (neg)</th>
                <th className="text-left font-semibold px-4 py-3 w-[180px]">% saldo</th>
              </tr>
            </thead>
            <tbody>
              {stats.porMarca.map((m) => {
                const pct = stats.saldoPositivo > 0 ? Math.max(0, m.saldo) / stats.saldoPositivo : 0;
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
                      setBucket("positivo");
                      if (!active) irADetalle();
                    }}
                  >
                    <td className="px-4 py-3 text-[13px] font-medium">{m.marca}</td>
                    <td className="px-4 py-3 text-right mono text-[12px] text-[--color-fg-muted]">{fmtNum(m.unidades)}</td>
                    <td className="px-4 py-3 text-right mono text-[12.5px] text-[--color-fg-muted]">{fmtCLPCompact(m.montoProvision)}</td>
                    <td className="px-4 py-3 text-right mono text-[12.5px] text-[--color-fg-muted]">{fmtCLPCompact(m.montoFactura)}</td>
                    <td className="px-4 py-3 text-right mono text-[13px] font-semibold text-[--color-fg]">{fmtCLPCompact(m.saldo)}</td>
                    <td className="px-4 py-3 text-right mono text-[12px]" style={{ color: m.saldoNegativo < 0 ? "var(--color-danger)" : "var(--color-fg-dim)" }}>
                      {m.saldoNegativo < 0 ? fmtCLPCompact(m.saldoNegativo) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-1.5 rounded-full bg-[--color-bg-elev-3] overflow-hidden">
                        <div className="h-full bg-[--color-warning]" style={{ width: `${pct * 100}%` }} />
                      </div>
                      <div className="text-[10px] text-[--color-fg-dim] mt-1 mono">{fmtPct(pct)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {/* Tabs de bucket + filtros */}
      <div ref={detalleRef} className="flex items-center gap-1 border-b border-[--color-border] scroll-mt-6">
        <TabBtn
          active={bucket === "positivo" && !mostrarPostventa}
          onClick={() => {
            setBucket("positivo");
            setMostrarPostventa(false);
          }}
        >
          Saldo pendiente &gt; 0{" "}
          <span className="ml-1.5 text-[10px] mono">
            {fmtNum(ventas.filter((r) => r.saldo > 0).length)}
          </span>
        </TabBtn>
        <TabBtn
          active={bucket === "cero" && !mostrarPostventa}
          onClick={() => {
            setBucket("cero");
            setMostrarPostventa(false);
          }}
        >
          Cerradas (saldo 0){" "}
          <span className="ml-1.5 text-[10px] mono text-[--color-fg-dim]">{fmtNum(stats.cerradas)}</span>
        </TabBtn>
        <TabBtn
          active={bucket === "negativo" && !mostrarPostventa}
          onClick={() => {
            setBucket("negativo");
            setMostrarPostventa(false);
          }}
        >
          Saldo negativo / ajustes{" "}
          <span className="ml-1.5 text-[10px] mono text-[--color-danger]">
            {fmtNum(ventas.filter((r) => r.saldo < 0).length)}
          </span>
        </TabBtn>
        {postventa.length > 0 && (
          <TabBtn
            active={mostrarPostventa}
            onClick={() => {
              setMostrarPostventa(true);
              setBucket("positivo");
            }}
          >
            Postventa (referencia){" "}
            <span className="ml-1.5 text-[10px] mono text-[--color-fg-dim]">{fmtNum(postventa.length)}</span>
          </TabBtn>
        )}
      </div>

      {mostrarPostventa && (
        <Card>
          <CardBody className="p-5">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-lg bg-[--color-info]/10 grid place-items-center shrink-0">
                <ClipboardList className="size-4 text-[--color-info]" />
              </div>
              <div>
                <div className="text-[13px] font-medium text-[--color-fg]">
                  Postventa · {fmtNum(postventa.length)} registros · saldo{" "}
                  {fmtCLPCompact(stats.postventaReferencia.saldo)}
                </div>
                <div className="text-[12px] text-[--color-fg-muted] mt-0.5">
                  Excluida del panel principal de provisiones de venta de autos. Se muestra solo como referencia.
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Filtros + contador */}
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
          {stats.porMarca.map((m) => (
            <option key={m.marca} value={m.marca}>
              {m.marca} ({m.unidades})
            </option>
          ))}
        </select>
        {(filtroMarca !== "todos" || filtroAging !== "todos") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFiltroMarca("todos");
              setFiltroAging("todos");
            }}
          >
            Limpiar filtros
          </Button>
        )}
        <div className="ml-auto text-[12px] text-[--color-fg-muted]">
          {fmtNum(filtrados.length)} provisiones · saldo {fmtCLPCompact(filtradosSaldo)}
        </div>
      </div>

      <DetalleTable registros={filtrados} mostrarGestion={bucket !== "cero" && !mostrarPostventa} />
    </div>
  );
}

function KpiPrincipal({
  label,
  value,
  sub,
  tone = "default",
  tip,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warning" | "danger" | "muted";
  tip: string;
}) {
  const strip =
    tone === "danger" ? "strip-danger" : tone === "warning" ? "strip-warning" : "strip-muted";
  const color =
    tone === "danger"
      ? "var(--color-danger)"
      : tone === "warning"
        ? "var(--color-warning)"
        : "var(--color-fg)";
  return (
    <div className={cn("surface top-strip bg-white px-5 pt-5 pb-4 cursor-help", strip)} title={tip}>
      <div className="text-[10px] uppercase tracking-[0.12em] text-[--color-fg-muted] font-semibold">
        {label}
      </div>
      <div className="display text-[24px] mt-2 leading-none" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-[--color-fg-muted] mt-2">{sub}</div>}
    </div>
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
        <table className="w-full text-sm min-w-[1500px]">
          <thead className="text-[10.5px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1]">
            <tr>
              <th className="text-left font-semibold px-4 py-3">ID · Periodo</th>
              <th className="text-left font-semibold px-4 py-3">Marca</th>
              <th className="text-left font-semibold px-4 py-3">Concepto · Motivo</th>
              <th className="text-left font-semibold px-4 py-3">Solicitante / Razón social</th>
              <th className="text-right font-semibold px-4 py-3">Provisión</th>
              <th className="text-right font-semibold px-4 py-3">Facturado</th>
              <th className="text-right font-semibold px-4 py-3">Saldo</th>
              <th className="text-left font-semibold px-4 py-3">Aging</th>
              <th className="text-right font-semibold px-4 py-3">Días</th>
              <th className="text-left font-semibold px-4 py-3">Última factura</th>
              <th className="text-left font-semibold px-4 py-3">Estado / Ajuste</th>
              {mostrarGestion && <th className="text-left font-semibold px-4 py-3">Gestión</th>}
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
  const negativo = r.saldo < 0;
  const cerrado = r.saldo === 0;
  const sev =
    !cerrado && r.agingDias !== null && r.agingDias > 90
      ? "danger"
      : !cerrado && r.agingDias !== null && r.agingDias > 60
        ? "warning"
        : null;
  const narrativa = negativo
    ? `Saldo negativo (${fmtCLP(r.saldo)}): se facturó más que lo provisionado o hay ajuste pendiente.`
    : cerrado
      ? `Provisión cerrada: provisión $${fmtNum(r.montoProvision)} = facturado $${fmtNum(r.montoFactura)}.`
      : `Nació por ${fmtCLP(r.montoProvision)}, facturado ${fmtCLP(r.montoFactura)}, mantiene saldo pendiente ${fmtCLP(r.saldo)}.`;

  return (
    <tr
      title={narrativa}
      className={cn(
        "align-top border-b border-[--color-border-soft] last:border-0 transition",
        idx % 2 === 0
          ? "bg-white hover:bg-[--color-bg-elev-1]"
          : "bg-[--color-bg-elev-1]/40 hover:bg-[--color-bg-elev-1]",
        sev === "danger" && "shadow-[inset_3px_0_0_var(--color-danger)]",
        sev === "warning" && "shadow-[inset_3px_0_0_var(--color-warning)]",
        negativo && "shadow-[inset_3px_0_0_#ea580c]",
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
      <td className="px-4 py-3 text-[11.5px] text-[--color-fg-muted]">
        <div className="truncate max-w-[200px]">{r.solicitante ?? "—"}</div>
        <div className="text-[10.5px] text-[--color-fg-dim] truncate max-w-[200px]">{r.razonSocial ?? ""}</div>
      </td>
      <td className="px-4 py-3 text-right mono text-[12.5px] text-[--color-fg-muted]">
        {fmtCLP(r.montoProvision)}
      </td>
      <td className="px-4 py-3 text-right mono text-[12.5px] text-[--color-fg-muted]">
        {fmtCLP(r.montoFactura)}
      </td>
      <td
        className="px-4 py-3 text-right mono text-[13px] font-semibold"
        style={{ color: negativo ? "#ea580c" : cerrado ? "var(--color-fg-dim)" : "var(--color-fg)" }}
      >
        {fmtCLP(r.saldo)}
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
        {r.ultimaFechaFactura ? r.ultimaFechaFactura.toLocaleDateString("es-CL") : "—"}
      </td>
      <td className="px-4 py-3 text-[11.5px] text-[--color-fg-muted]">
        {r.estadoArchivo ?? "—"}
        {r.estadoAjuste && /pendiente/i.test(r.estadoAjuste) && (
          <div className="text-[10.5px] text-[--color-danger] mt-0.5 flex items-center gap-1">
            <AlertTriangle className="size-3" /> Ajuste pendiente
          </div>
        )}
      </td>
      {mostrarGestion && (
        <td className="px-4 py-3">
          {/* Patrón documental unificado: mismo popover que saldos/bonos,
              con prioridad + historial + Asignar / Notificar. */}
          <GestionInline
            vin={r.claveGestion}
            descripcionCaso={[r.concepto, r.origen].filter(Boolean).join(" · ") || null}
          />
        </td>
      )}
    </tr>
  );
}
