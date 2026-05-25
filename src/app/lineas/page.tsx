"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  CreditCard,
  Scale,
  ShieldQuestion,
  TrendingUp,
} from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { useDatosFiltrados } from "@/lib/marca-filtro";
import { computeDashboardKPIs } from "@/lib/selectors/kpis";
import { cruzarFNEConStock } from "@/lib/selectors/fne-real";
import {
  statsValidacionFinanciera,
  validarFinanciera,
  type EstadoValidacion,
} from "@/lib/selectors/financieras-master";
import { fmtCLP, fmtCLPCompact, fmtNum, fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { LineaCredito } from "@/lib/types";

/** Severidad visual de una línea — foco tesorería/riesgo. */
function sevLinea(semaforo: string) {
  switch (semaforo) {
    case "sobregirada":
      return {
        label: "Sobregirada",
        text: "text-[--color-critical]",
        bar: "bg-gradient-to-r from-[#b91c1c] to-[#7f1d1d]",
        chipBg: "bg-[--color-critical]/10",
        rowBg: "bg-[--color-critical]/[0.045]",
        border: "border-l-[--color-critical]",
        rank: 0,
      };
    case "rojo":
      return {
        label: "Al límite",
        text: "text-[--color-danger]",
        bar: "bg-[--color-danger]",
        chipBg: "bg-[--color-danger]/10",
        rowBg: "bg-[--color-danger]/[0.035]",
        border: "border-l-[--color-danger]",
        rank: 1,
      };
    case "amarillo":
      return {
        label: "En tensión",
        text: "text-[--color-warning]",
        bar: "bg-[--color-warning]",
        chipBg: "bg-[--color-warning]/12",
        rowBg: "bg-white",
        border: "border-l-[--color-warning]",
        rank: 2,
      };
    default:
      return {
        label: "Saludable",
        text: "text-[--color-success]",
        bar: "bg-[--color-success]",
        chipBg: "bg-[--color-success]/10",
        rowBg: "bg-white",
        border: "border-l-[--color-success]",
        rank: 3,
      };
  }
}

const ESTADO_VAL: Record<
  EstadoValidacion,
  { label: string; text: string; bg: string; icon: React.ReactNode }
> = {
  validado: {
    label: "Validado",
    text: "text-[--color-success]",
    bg: "bg-[--color-success]/10",
    icon: <CheckCircle2 className="size-3" />,
  },
  diferencia: {
    label: "Diferencia",
    text: "text-[--color-danger]",
    bg: "bg-[--color-danger]/10",
    icon: <AlertTriangle className="size-3" />,
  },
  en_conciliacion: {
    label: "En conciliación",
    text: "text-[--color-warning]",
    bg: "bg-[--color-warning]/12",
    icon: <ShieldQuestion className="size-3" />,
  },
};

export default function LineasPage() {
  const { data, fne } = useDatosFiltrados();

  const stats = useMemo(() => {
    if (!data) return null;
    const lineas = data.lineas;
    const autorizada = lineas.reduce((s, l) => s + l.lineaAutorizada, 0);
    const ocupada = lineas.reduce((s, l) => s + l.lineaOcupada, 0);
    const libre = lineas.reduce((s, l) => s + l.lineaLibre, 0);
    const pct = autorizada > 0 ? ocupada / autorizada : 0;
    const sobregiroTotal = lineas.reduce(
      (s, l) => s + Math.max(0, l.lineaOcupada - l.lineaAutorizada),
      0,
    );
    const sobregiradas = lineas.filter((l) => l.semaforo === "sobregirada").length;
    const mas90 = lineas.filter((l) => l.semaforo === "rojo").length;
    const enTension = lineas.filter((l) => l.semaforo === "amarillo").length;
    // Reconciliación: universo operacional (stock físico, costo neto) vs
    // universo financiero (línea utilizada por las financieras).
    const capitalGestionado = computeDashboardKPIs(data.vehiculos).capitalBruto;
    const delta = ocupada - capitalGestionado;
    // Componente cuantificable del Δ: FNE todavía en línea (vendido, financiado,
    // sin descargar de la línea aún).
    const cruzadosFNE = fne
      ? cruzarFNEConStock(fne.registros, data.vehiculos, data.vinsExtra ?? null)
      : [];
    const fneEnLinea = cruzadosFNE.reduce((s, c) => {
      const t = c.vehiculo?.tipoStock;
      return t === "FloorPlan" || t === "Financiado" ? s + c.fne.valorFactura : s;
    }, 0);
    const stockFinanciado = data.vehiculos
      .filter((v) => v.tipoStock === "FloorPlan" || v.tipoStock === "Financiado")
      .reduce((s, v) => s + (v.costoNeto || 0), 0);
    return {
      autorizada,
      ocupada,
      libre,
      pct,
      sobregiroTotal,
      sobregiradas,
      mas90,
      enTension,
      total: lineas.length,
      capitalGestionado,
      delta,
      fneEnLinea,
      stockFinanciado,
    };
  }, [data, fne]);

  if (!data || !stats) {
    return (
      <div className="p-10 max-w-3xl mx-auto fade-in">
        <Card variant="glass">
          <CardBody>
            <EmptyState
              icon={<CreditCard className="size-7" strokeWidth={1.5} />}
              title="Líneas de financiamiento"
              description="Carga un Excel para ver autorizada / utilizada / libre / riesgo por marca y financiera."
              action={
                <Link href="/">
                  <Button variant="primary" size="md">
                    Ir a la pantalla de inicio
                  </Button>
                </Link>
              }
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  const lineas = [...data.lineas].sort((a, b) => {
    const ra = sevLinea(a.semaforo).rank;
    const rb = sevLinea(b.semaforo).rank;
    if (ra !== rb) return ra - rb;
    return b.porcentajeOcupacion - a.porcentajeOcupacion;
  });

  const enRiesgo = stats.sobregiradas + stats.mas90;
  const pctCajaVsLinea =
    stats.ocupada > 0 ? stats.capitalGestionado / stats.ocupada : 0;

  // Validación financiera (sistema vs maestro oficial) — capa, no reemplazo.
  const ordenEstado: Record<EstadoValidacion, number> = {
    diferencia: 0,
    en_conciliacion: 1,
    validado: 2,
  };
  const valRows = [...data.lineas]
    .map((l) => ({ l, v: validarFinanciera(l.marca, l.financiera, l.marcaPompeyo) }))
    .sort((a, b) => ordenEstado[a.v.estado] - ordenEstado[b.v.estado] || a.l.marca.localeCompare(b.l.marca));
  const valStats = statsValidacionFinanciera(valRows.map((r) => r.v));
  const montoDiferencias = valRows
    .filter((r) => r.v.estado === "diferencia")
    .reduce((s, r) => s + r.l.lineaOcupada, 0);
  const hayPendientes = valStats.diferencias + valStats.enConciliacion > 0;
  const corte = data.report?.fechaCorteExcel ?? null;

  return (
    <div className="max-w-[1400px] mx-auto px-10 py-10 space-y-7 fade-in">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-[--color-border] bg-gradient-to-br from-[#eff6ff] via-[#f0f4ff] to-white px-10 py-8">
        <div className="absolute -top-12 -right-12 size-56 rounded-full bg-[--color-accent] opacity-[0.10] blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[--color-accent] font-semibold">
            <Banknote className="size-3.5" strokeWidth={2} />
            Tesorería · Líneas de financiamiento
          </div>
          <h1 className="text-[28px] font-semibold tracking-tight mt-2 leading-tight text-[--color-fg]">
            Utilización y riesgo de líneas
          </h1>
          <p className="text-[14px] text-[--color-fg-muted] mt-2 max-w-2xl leading-relaxed">
            {stats.total} marcas con línea asignada · {fmtCLPCompact(stats.ocupada)} utilizados de{" "}
            {fmtCLPCompact(stats.autorizada)} autorizados. Clic en una línea para ver los vehículos
            en Floor Plan.
          </p>
        </div>
      </div>

      {/* Banner · información financiera en conciliación */}
      {hayPendientes && (
        <div className="surface top-strip strip-warning bg-[--color-warning]/[0.04] px-6 py-4 flex items-start gap-3">
          <AlertTriangle className="size-5 text-[--color-warning] shrink-0 mt-0.5" strokeWidth={1.75} />
          <div className="text-[12.5px] text-[--color-fg-muted] leading-relaxed">
            <span className="text-[--color-fg] font-semibold">Información financiera en conciliación.</span>{" "}
            {fmtNum(valStats.diferencias)} marca{valStats.diferencias === 1 ? "" : "s"} con financiera
            distinta entre el sistema y el maestro oficial
            {valStats.enConciliacion > 0 && (
              <> y {fmtNum(valStats.enConciliacion)} sin financiera oficial</>
            )}
            . Los montos operacionales se muestran, pero deben validarse con Tesorería antes de
            usarse como dato final.
          </div>
        </div>
      )}

      {/* ════ Reconciliación: universo operacional vs financiero ════ */}
      <div className="surface top-strip strip-operativo bg-white px-7 py-6">
        <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-[--color-accent] font-semibold">
          <Scale className="size-3.5" strokeWidth={2} />
          Reconciliación · universo operacional vs financiero
        </div>
        <div className="text-[12px] text-[--color-fg-muted] mt-1">
          Dos lentes del mismo negocio. Que difieran es normal — miden universos distintos.
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] gap-4 md:gap-6 items-center">
          {/* Universo operacional */}
          <div className="rounded-xl border border-[--color-success]/30 bg-[--color-success]/[0.04] px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-[--color-success] font-semibold">
              Universo operacional · Dashboard
            </div>
            <div className="display text-[26px] mt-1 leading-none text-[--color-fg]">
              {fmtCLPCompact(stats.capitalGestionado)}
            </div>
            <div className="text-[11px] text-[--color-fg-muted] mt-1">
              Stock físico operativo · a costo neto
            </div>
          </div>

          <div className="hidden md:flex items-center justify-center text-[--color-fg-dim] text-[18px] font-light">
            vs
          </div>

          {/* Universo financiero */}
          <div className="rounded-xl border border-[--color-warning]/30 bg-[--color-warning]/[0.04] px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-[--color-warning] font-semibold">
              Universo financiero · Líneas
            </div>
            <div className="display text-[26px] mt-1 leading-none text-[--color-fg]">
              {fmtCLPCompact(stats.ocupada)}
            </div>
            <div className="text-[11px] text-[--color-fg-muted] mt-1">
              Línea utilizada por las financieras
            </div>
          </div>

          <div className="hidden md:flex items-center justify-center text-[--color-fg-dim] text-[18px] font-light">
            =
          </div>

          {/* Delta */}
          <div className="rounded-xl border border-[--color-accent]/30 bg-[--color-accent]/[0.04] px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-[--color-accent] font-semibold">
              Diferencia (Δ) · normal
            </div>
            <div className="display text-[26px] mt-1 leading-none text-[--color-accent]">
              {stats.delta >= 0 ? "+" : "−"}
              {fmtCLPCompact(Math.abs(stats.delta))}
            </div>
            <div className="text-[11px] text-[--color-fg-muted] mt-1">
              Operaciones en línea sin stock físico visible
            </div>
          </div>
        </div>

        {/* Desglose del diferencial */}
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wide text-[--color-fg-dim] font-medium mb-2">
            El diferencial corresponde a
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
            <DeltaItem
              label="FNE todavía en línea"
              valor={stats.fneEnLinea > 0 ? fmtCLPCompact(stats.fneEnLinea) : "—"}
              desc="Vendidos, financiados, sin descargar."
            />
            <DeltaItem
              label="Stock financiado"
              valor={fmtCLPCompact(stats.stockFinanciado)}
              desc="Floor Plan / financiado a costo."
            />
            <DeltaItem
              label="Descargas pendientes"
              valor="incluido en Δ"
              desc="Operaciones por descargar con la financiera."
            />
            <DeltaItem
              label="Capital puente financiero"
              valor="incluido en Δ"
              desc="Operaciones sin stock físico visible."
            />
          </div>
        </div>

        <div className="mt-3 text-[12px] text-[--color-fg-muted] leading-relaxed rounded-lg bg-[--color-bg-elev-2] border border-[--color-border-soft] px-4 py-3">
          <span className="text-[--color-fg] font-medium">Lectura:</span> el universo financiero (
          {fmtCLPCompact(stats.ocupada)}) supera al operacional ({fmtCLPCompact(stats.capitalGestionado)})
          porque la línea sigue ocupada por operaciones ya vendidas o financiadas que aún no se
          descargan. El stock físico cubre{" "}
          <span className="text-[--color-fg] font-medium">{fmtPct(pctCajaVsLinea)}</span> de la línea
          ocupada. No es un error de cuadratura.
        </div>
      </div>

      {/* ════ Validación financiera · sistema vs maestro oficial ════ */}
      <div className="surface bg-white overflow-hidden">
        <div className="px-6 pt-5 pb-3 border-b border-[--color-border-soft] flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <ShieldQuestion className="size-4 text-[--color-accent]" strokeWidth={1.75} />
            <div>
              <div className="text-[14px] font-semibold tracking-tight text-[--color-fg]">
                Validación financiera
              </div>
              <div className="text-[12px] text-[--color-fg-muted]">
                Financiera que infiere el sistema vs el maestro oficial. No se reemplaza el cálculo —
                se exponen las diferencias.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[12px] flex-wrap">
            <span className="text-[--color-success] font-medium">{fmtNum(valStats.validados)} validadas</span>
            <span className="text-[--color-danger] font-medium">{fmtNum(valStats.diferencias)} diferencias</span>
            <span className="text-[--color-warning] font-medium">{fmtNum(valStats.enConciliacion)} en conciliación</span>
            {montoDiferencias > 0 && (
              <span className="text-[--color-fg-muted]">
                · <span className="text-[--color-danger] font-semibold">{fmtCLPCompact(montoDiferencias)}</span> ocupados con financiera por validar
              </span>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="text-[10px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1] border-b border-[--color-border]">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Marca</th>
                <th className="text-left font-semibold px-4 py-2.5">Financiera sistema</th>
                <th className="text-left font-semibold px-4 py-2.5">Financiera oficial</th>
                <th className="text-right font-semibold px-4 py-2.5">Autorizada</th>
                <th className="text-right font-semibold px-4 py-2.5">Ocupada</th>
                <th className="text-left font-semibold px-4 py-2.5">Estado</th>
              </tr>
            </thead>
            <tbody>
              {valRows.map(({ l, v }, idx) => {
                const cfg = ESTADO_VAL[v.estado];
                return (
                  <tr
                    key={l.marca}
                    className={cn(
                      "border-b border-[--color-border-soft] last:border-0",
                      idx % 2 === 0 ? "bg-white" : "bg-[--color-bg-elev-1]/40",
                      v.estado === "diferencia" && "bg-[--color-danger]/[0.04]",
                    )}
                    title={v.mensaje}
                  >
                    <td className="px-4 py-2.5 font-medium text-[12.5px] text-[--color-fg]">
                      {l.marca}
                      {v.estado !== "validado" && <span className="text-[--color-danger]"> *</span>}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-[--color-fg-muted]">
                      {v.financieraSistema ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-[12px]">
                      {v.financieraOficial ? (
                        <span className="font-medium text-[--color-fg]">{v.financieraOficial}</span>
                      ) : (
                        <span className="text-[--color-fg-dim] italic">sin maestro</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right mono text-[12px] text-[--color-fg-muted]">
                      {fmtCLPCompact(l.lineaAutorizada)}
                    </td>
                    <td className="px-4 py-2.5 text-right mono text-[12px] text-[--color-fg]">
                      {fmtCLPCompact(l.lineaOcupada)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide",
                          cfg.bg,
                          cfg.text,
                        )}
                        title={v.mensaje}
                      >
                        {cfg.icon}
                        {cfg.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Trazabilidad */}
        <div className="px-6 py-3 border-t border-[--color-border-soft] bg-[--color-bg-elev-1] text-[11px] text-[--color-fg-muted] flex flex-wrap gap-x-6 gap-y-1">
          <span>
            <span className="text-[--color-fg-dim]">Fuente operacional:</span> Informe Stock y Líneas
          </span>
          <span>
            <span className="text-[--color-fg-dim]">Fuente de validación:</span> Maestro financiero
            oficial (negocio)
          </span>
          {corte && (
            <span>
              <span className="text-[--color-fg-dim]">Corte:</span>{" "}
              {corte.toISOString().slice(0, 10)}
            </span>
          )}
        </div>
      </div>

      {/* ════ KPIs ════ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiLinea
          label="Línea autorizada"
          value={fmtCLPCompact(stats.autorizada)}
          sub={fmtCLP(stats.autorizada)}
          tone="default"
          icon={<CreditCard className="size-4" strokeWidth={1.75} />}
        />
        <KpiLinea
          label="Línea utilizada"
          value={fmtCLPCompact(stats.ocupada)}
          sub={`${fmtPct(stats.pct)} de la autorizada`}
          tone={stats.pct > 0.9 ? "danger" : stats.pct > 0.8 ? "warning" : "default"}
          icon={<TrendingUp className="size-4" strokeWidth={1.75} />}
        />
        <KpiLinea
          label={stats.libre < 0 ? "Línea libre (neta)" : "Línea libre"}
          value={fmtCLPCompact(stats.libre)}
          sub={stats.libre < 0 ? "sin margen disponible" : `${fmtPct(1 - stats.pct)} disponible`}
          tone={stats.libre < 0 ? "critical" : "success"}
          icon={<Banknote className="size-4" strokeWidth={1.75} />}
        />
        <KpiLinea
          label="Sobregiro total"
          value={fmtCLPCompact(stats.sobregiroTotal)}
          sub={`${stats.sobregiradas} líneas sobregiradas`}
          tone={stats.sobregiroTotal > 0 ? "critical" : "success"}
          icon={<AlertTriangle className="size-4" strokeWidth={1.75} />}
        />
      </div>

      {/* ════ Resumen de riesgo accionable ════ */}
      {enRiesgo > 0 && (
        <div className="surface top-strip strip-danger bg-white px-7 py-5">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="size-10 rounded-xl bg-[--color-critical]/10 grid place-items-center shrink-0">
              <AlertTriangle className="size-5 text-[--color-critical]" strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-[240px]">
              <div className="text-[14px] font-semibold text-[--color-fg]">
                Riesgo de financiamiento
              </div>
              <div className="flex items-center gap-x-5 gap-y-1 flex-wrap mt-2">
                <RiskStat
                  value={fmtCLPCompact(stats.sobregiroTotal)}
                  label="sobregirados"
                  tone="critical"
                />
                <RiskStat
                  value={fmtNum(stats.sobregiradas)}
                  label="líneas sobregiradas"
                  tone="critical"
                />
                <RiskStat
                  value={fmtNum(stats.mas90)}
                  label="líneas sobre 90%"
                  tone="danger"
                />
                <RiskStat
                  value={fmtNum(stats.enTension)}
                  label="líneas en tensión (80-90%)"
                  tone="warning"
                />
              </div>
              <div className="text-[12px] text-[--color-fg-muted] mt-2.5 leading-relaxed">
                Acción: priorizar la facturación/descarga de las marcas sobregiradas o renegociar
                cupo con la financiera para liberar línea.
              </div>
            </div>
            <Link href="/alertas">
              <Button variant="outline" size="sm">
                Ver alertas <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* ════ Líneas — filas ejecutivas con severidad ════ */}
      <div>
        <div className="flex items-end justify-between gap-4 flex-wrap mb-3">
          <div>
            <h2 className="text-[18px] font-semibold tracking-tight text-[--color-fg]">
              Detalle por línea
            </h2>
            <p className="text-[12.5px] text-[--color-fg-muted] mt-1">
              Ordenadas por riesgo · clic para ver los vehículos financiados de cada marca.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-[--color-fg-muted]">
            <LegendDot color="bg-[#7f1d1d]" label="Sobregirada" />
            <LegendDot color="bg-[--color-danger]" label=">90%" />
            <LegendDot color="bg-[--color-warning]" label="80-90%" />
            <LegendDot color="bg-[--color-success]" label="<80%" />
          </div>
        </div>

        <div className="space-y-2">
          {lineas.map((l) => (
            <LineaRow key={l.marca} l={l} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LineaRow({ l }: { l: LineaCredito }) {
  const sev = sevLinea(l.semaforo);
  const pct = l.porcentajeOcupacion;
  const sobregiro = Math.max(0, l.lineaOcupada - l.lineaAutorizada);
  const overflowPct = pct > 1 ? Math.round((pct - 1) * 100) : 0;
  const critico = l.semaforo === "sobregirada" || l.semaforo === "rojo";

  return (
    <Link
      href={`/stock?marcaOriginadora=${encodeURIComponent(l.marcaPompeyo ?? l.marca)}&tipoStock=FloorPlan`}
      className={cn(
        "group block rounded-xl border border-[--color-border] border-l-4 surface-hover transition",
        sev.border,
        sev.rowBg,
      )}
    >
      <div className="px-5 py-4 flex items-center gap-5">
        {/* Marca + financiera */}
        <div className="w-[170px] shrink-0 min-w-0">
          <div
            className={cn(
              "font-semibold tracking-tight truncate",
              critico ? "text-[15px] text-[--color-fg]" : "text-[14px] text-[--color-fg]",
            )}
          >
            {l.marca}
          </div>
          <div className="text-[12px] text-[--color-fg-muted] truncate">
            {l.financiera ?? "—"}
          </div>
        </div>

        {/* Barra + montos */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <span className="text-[11.5px] text-[--color-fg-muted]">
              Autorizada{" "}
              <span className="mono text-[--color-fg]">{fmtCLPCompact(l.lineaAutorizada)}</span> ·
              Utilizada{" "}
              <span className="mono text-[--color-fg]">{fmtCLPCompact(l.lineaOcupada)}</span>
            </span>
            <span className={cn("display text-[18px] leading-none", sev.text)}>
              {(pct * 100).toFixed(0)}%
            </span>
          </div>
          <div className="relative h-2.5 rounded-full bg-[--color-bg-elev-3] overflow-hidden">
            <div
              className={cn("h-full rounded-full", sev.bar)}
              style={{ width: `${Math.min(100, pct * 100)}%` }}
            />
            {/* marcador 100% cuando hay sobregiro */}
            {overflowPct > 0 && (
              <span className="absolute inset-y-0 right-1 flex items-center text-[9px] font-bold text-white">
                +{overflowPct}%
              </span>
            )}
          </div>
        </div>

        {/* Libre / sobregiro + estado */}
        <div className="w-[170px] shrink-0 text-right">
          {sobregiro > 0 ? (
            <div className="text-[13px] font-semibold text-[--color-critical]">
              Sobregiro {fmtCLPCompact(-sobregiro)}
            </div>
          ) : (
            <div className="text-[12.5px] text-[--color-fg-muted]">
              Libre <span className="mono text-[--color-fg]">{fmtCLPCompact(l.lineaLibre)}</span>
            </div>
          )}
          <div className="mt-1.5 flex justify-end">
            <span
              className={cn(
                "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide",
                sev.chipBg,
                sev.text,
              )}
            >
              {sev.label}
            </span>
          </div>
        </div>

        <ArrowRight className="size-4 text-[--color-fg-dim] group-hover:text-[--color-accent] group-hover:translate-x-0.5 transition shrink-0" />
      </div>
    </Link>
  );
}

function KpiLinea({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "default" | "warning" | "danger" | "critical" | "success";
  icon: React.ReactNode;
}) {
  const strip =
    tone === "critical"
      ? "strip-danger"
      : tone === "danger"
        ? "strip-danger"
        : tone === "warning"
          ? "strip-warning"
          : tone === "success"
            ? "strip-success"
            : "strip-operativo";
  const valueColor =
    tone === "critical"
      ? "text-[--color-critical]"
      : tone === "danger"
        ? "text-[--color-danger]"
        : tone === "warning"
          ? "text-[--color-warning]"
          : tone === "success"
            ? "text-[--color-success]"
            : "text-[--color-fg]";
  const iconColor =
    tone === "critical" || tone === "danger"
      ? "text-[--color-danger]"
      : tone === "warning"
        ? "text-[--color-warning]"
        : tone === "success"
          ? "text-[--color-success]"
          : "text-[--color-accent]";
  return (
    <div className={cn("surface top-strip bg-white px-5 pt-5 pb-4", strip)}>
      <div className="flex items-center justify-between">
        <div className="text-[10.5px] uppercase tracking-[0.13em] text-[--color-fg-muted] font-medium">
          {label}
        </div>
        <span className={iconColor}>{icon}</span>
      </div>
      <div className={cn("display text-[28px] mt-2.5 leading-none", valueColor)}>{value}</div>
      <div className="text-[12px] text-[--color-fg-muted] mt-2">{sub}</div>
    </div>
  );
}

function RiskStat({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone: "critical" | "danger" | "warning";
}) {
  const color =
    tone === "critical"
      ? "text-[--color-critical]"
      : tone === "danger"
        ? "text-[--color-danger]"
        : "text-[--color-warning]";
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={cn("display text-[20px] leading-none", color)}>{value}</span>
      <span className="text-[11.5px] text-[--color-fg-muted]">{label}</span>
    </div>
  );
}

function DeltaItem({ label, valor, desc }: { label: string; valor: string; desc: string }) {
  return (
    <div className="rounded-lg bg-[--color-bg-elev-2] border border-[--color-border-soft] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-[--color-fg-dim]">{label}</div>
      <div className="mono text-[14px] text-[--color-fg] mt-0.5">{valor}</div>
      <div className="text-[10.5px] text-[--color-fg-dim] mt-0.5 leading-snug">{desc}</div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block size-2 rounded-sm", color)} />
      {label}
    </span>
  );
}
