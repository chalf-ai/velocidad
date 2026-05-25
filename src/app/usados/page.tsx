"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Car, Gauge, Truck, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { AbrirCasoButton } from "@/components/AbrirCasoButton";
import { BotonesCasoPuente } from "@/components/BotonesCasoPuente";
import { indexarFNEPorOrigen, type FNEOrigenIndex } from "@/lib/selectors/vu-en-fne";
import { useVinContexto, VinContextoBanner } from "@/components/VinContexto";
import { limpiarVIN } from "@/lib/parser/venta-apc";
import { useExcelStore } from "@/lib/store";
import { useGestionStore } from "@/lib/gestion/store";
import { fmtCLPCompact, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  universoOperacionalUsados,
  CATEGORIA_USADO_LABEL,
  esComercializable,
  MAYORISTA_AGING,
  type CategoriaUsado,
  type DashboardUsados,
} from "@/lib/selectors/usados-operacional";
import {
  MARCA_USADOS,
  filtrarPorMarcaOperacional,
  filtrarLineasPorMarcaOperacional,
} from "@/lib/selectors/owner-operacional";
import {
  cruzarFNEConStock,
  filtrarFNEUsados,
  statsFNEReal,
  ESTADOS_BLOQUEO_ARTIFICIAL,
  ESTADO_ENTREGA_LABEL,
  ORDEN_ESTADO,
} from "@/lib/selectors/fne-real";
import type { FNERealStats } from "@/lib/types";
import { MOS_IDEAL, MOS_CRITICO, CV_IDEAL, CV_CRITICO } from "@/lib/selectors/eficiencia-capital";

/** Cruces operacionales de USADOS contra el resto del pipeline global. */
interface CrucesUsados {
  saldos: { u: number; monto: number; financiera: number; cp: number };
  provisiones: { u: number; monto: number };
  lineas: { n: number };
}

const COL = {
  verde: "#0f7a59",
  amarillo: "var(--color-warning)",
  naranjo: "#ea580c",
  rojo: "var(--color-danger)",
  fg: "var(--color-fg)",
  dim: "var(--color-fg-dim)",
};

/** Categorías que NO entran al MOS (todavía no son stock comercializable). */
const FUERA_MOS: CategoriaUsado[] = [
  "USADOS_CAPITAL_PUENTE",
  "USADOS_NO_RECEPCIONADO",
  "USADOS_TESCAR",
  "USADOS_NO_RETAIL",
];

type Sel =
  | { kind: "todos" }
  | { kind: "categoria"; value: CategoriaUsado }
  | { kind: "grupo"; value: "comercializable" | "muerto" | "fuera_mos" }
  | { kind: "aging"; value: number }
  | { kind: "mayoria"; value: number }
  | { kind: "pagado" }
  | { kind: "sucursal"; value: string };

export default function UsadosPage() {
  const data = useExcelStore((s) => s.data);
  const fne = useExcelStore((s) => s.fne);
  const saldos = useExcelStore((s) => s.saldos);
  const provisiones = useExcelStore((s) => s.provisiones);
  useEffect(() => {
    useGestionStore.getState().hydrate();
  }, []);

  // FUENTE ÚNICA: universoOperacionalUsados resuelve el MISMO universo USADOS que
  // el filtro global (esUsadoOperacional) y entrega la taxonomía + capital
  // propio/gestionado. Así /usados, dashboard, saldos y FNE conversan.
  const dash = useMemo(
    () => (data ? universoOperacionalUsados(data.vehiculos).dash : null),
    [data],
  );
  // Índice FNE para cruzar capital puente → operación nueva originadora.
  const fneIndex = useMemo(() => indexarFNEPorOrigen(fne?.registros ?? []), [fne]);

  // FNE de usados: detectado por reglas operacionales (VIN→stock usado ∪ sucursal
  // usados), NO por marca textual (el archivo FNE no trae marca).
  const fneStats = useMemo<FNERealStats | null>(() => {
    if (!data || !fne) return null;
    const cruzados = cruzarFNEConStock(fne.registros, data.vehiculos, data.vinsExtra ?? null);
    return statsFNEReal(filtrarFNEUsados(cruzados));
  }, [data, fne]);

  // Cruces de USADOS contra el resto del sistema (mismo filtro owner-operacional).
  const cruces = useMemo<CrucesUsados>(() => {
    const salReg = saldos ? filtrarPorMarcaOperacional(saldos.registros, MARCA_USADOS) : [];
    const provReg = provisiones
      ? filtrarPorMarcaOperacional(provisiones.registros, MARCA_USADOS)
      : [];
    const linReg = data ? filtrarLineasPorMarcaOperacional(data.lineas, MARCA_USADOS) : [];
    return {
      saldos: {
        u: salReg.length,
        monto: salReg.reduce((s, r) => s + (r.saldoXDocumentar || 0), 0),
        financiera: salReg.reduce((s, r) => s + (r.financieraCLP || 0), 0),
        cp: salReg.reduce((s, r) => s + (r.cPompeyoColCLP || 0), 0),
      },
      provisiones: {
        u: provReg.length,
        monto: provReg.reduce((s, r) => s + (r.montoProvision || 0), 0),
      },
      lineas: { n: linReg.length },
    };
  }, [data, saldos, provisiones]);

  if (!data || !dash) {
    return (
      <div className="p-10 max-w-3xl mx-auto fade-in">
        <Card variant="glass">
          <CardBody>
            <EmptyState
              icon={<Car className="size-7" strokeWidth={1.5} />}
              title="Dashboard operacional de Usados"
              description="USADOS como unidad de capital de trabajo. Carga el Excel maestro para verlo."
              action={
                <Link href="/">
                  <Button variant="primary" size="md">Ir al inicio</Button>
                </Link>
              }
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="p-10 text-sm text-[--color-fg-muted]">Cargando…</div>}>
      <UsadosInner dash={dash} cruces={cruces} fneStats={fneStats} fneIndex={fneIndex} />
    </Suspense>
  );
}

function UsadosInner({
  dash,
  cruces,
  fneStats,
  fneIndex,
}: {
  dash: DashboardUsados;
  cruces: CrucesUsados;
  fneStats: FNERealStats | null;
  fneIndex: FNEOrigenIndex;
}) {
  const [sel, setSel] = useState<Sel>({ kind: "todos" });
  const listaRef = useRef<HTMLDivElement>(null);
  const vinCtx = useVinContexto();
  const select = (s: Sel) => {
    setSel(s);
    requestAnimationFrame(() => listaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  useEffect(() => {
    if (vinCtx) requestAnimationFrame(() => listaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [vinCtx]);

  const casos = useMemo(() => {
    let cs = dash.casos;
    if (vinCtx) return dash.casos.filter((c) => limpiarVIN(c.v.vin) === vinCtx);
    if (sel.kind === "categoria") cs = cs.filter((c) => c.categoria === sel.value);
    else if (sel.kind === "grupo") {
      if (sel.value === "comercializable") cs = cs.filter((c) => esComercializable(c.categoria));
      else if (sel.value === "muerto")
        cs = cs.filter((c) => c.categoria === "USADOS_JUDICIAL" || c.categoria === "USADOS_STOCK_B");
      else cs = cs.filter((c) => FUERA_MOS.includes(c.categoria));
    } else if (sel.kind === "aging")
      cs = cs.filter((c) => esComercializable(c.categoria) && (c.aging ?? 0) > sel.value);
    else if (sel.kind === "mayoria")
      cs = cs.filter((c) => c.categoria === "USADOS_MAYORISTA" && (c.aging ?? 0) > sel.value);
    else if (sel.kind === "pagado")
      cs = cs.filter((c) => esComercializable(c.categoria) && c.v.esPagado);
    else if (sel.kind === "sucursal")
      cs = cs.filter((c) => (c.v.sucursal ?? "(sin sucursal)") === sel.value);
    return [...cs].sort((a, b) => (b.aging ?? 0) - (a.aging ?? 0) || (b.v.costoNeto || 0) - (a.v.costoNeto || 0));
  }, [sel, dash, vinCtx]);

  const bandaCV = (pct: number | null) =>
    pct == null ? COL.dim : pct <= CV_IDEAL ? COL.verde : pct <= CV_CRITICO ? COL.amarillo : COL.rojo;
  const cvColor = bandaCV(dash.capitalVentaPct);
  const cvOperColor = bandaCV(dash.capitalOperativoVentaPct);
  const mosColor =
    dash.mos == null ? COL.dim : dash.mos <= MOS_IDEAL ? COL.verde : dash.mos <= MOS_CRITICO ? COL.amarillo : COL.rojo;
  const scoreColor =
    dash.score == null ? COL.dim : dash.score >= 90 ? COL.verde : dash.score >= 80 ? COL.amarillo : COL.rojo;

  const r = (n: number) => Math.round(n);
  const c = dash.componentes;
  const scoreTip = c
    ? `Score = 100 − MOS ${r(c.mos)} − capital/vta ${r(c.capitalVenta)} − detenido ${r(c.detenido)} − judicial ${r(c.judicial)} − puente ${r(c.puente)} − stockB ${r(c.stockB)}`
    : "Sin ventas para calcular el score";

  // Stock pagado dentro del comercializable (cross-cut: caja propia comprometida).
  const pagado = useMemo(() => {
    const ps = dash.casos.filter((c2) => esComercializable(c2.categoria) && c2.v.esPagado);
    return { u: ps.length, cap: ps.reduce((s, c2) => s + (c2.v.costoNeto || 0), 0) };
  }, [dash.casos]);

  const metricas = [
    { label: "Capital en stock", value: fmtCLPCompact(dash.capitalUnidad), color: COL.fg, tip: "Capital de la UNIDAD = stock usado gestionado (propio + financiado terceros), EXCLUYE VU en nuevos (su capital es de la marca originadora). Es la base del MOS y la eficiencia. La caja propia de Pompeyo es solo una parte (ver hero)." },
    { label: "Cap/vta total (A)", value: dash.capitalVentaPct != null ? `${Math.round(dash.capitalVentaPct)}%` : "—", color: cvColor, tip: `A · Capital en stock (unidad) ÷ venta mensual ($) → carga de caja. Verde ≤${CV_IDEAL}% · rojo >${CV_CRITICO}%.` },
    { label: "Cap/vta oper. (B)", value: dash.capitalOperativoVentaPct != null ? `${Math.round(dash.capitalOperativoVentaPct)}%` : "—", color: cvOperColor, tip: `B · Capital OPERATIVO (comercializable + BU puente propio) ÷ venta mensual → eficiencia limpia.` },
    { label: "MOS · meses", value: dash.mos != null ? dash.mos.toFixed(2) : "—", color: mosColor, tip: `Stock COMERCIALIZABLE (retail+CPD+mayorista+judicial+stockB) ÷ venta mensual (u). Verde ≤${MOS_IDEAL} · crítico >${MOS_CRITICO}. Excluye puente y no recepcionado.` },
    { label: "Score eficiencia", value: dash.score != null ? `${dash.score}` : "—", sufijo: dash.score != null ? "/100" : "", color: scoreColor, tip: scoreTip },
  ];

  const mayAlerta = dash.mayoristaAging;

  return (
    <div className="max-w-[1400px] mx-auto px-10 py-10 space-y-7 fade-in">
      {vinCtx && <VinContextoBanner vin={vinCtx} presentes={casos.length} />}
      {/* Hero + eficiencia */}
      <div className="relative overflow-hidden rounded-3xl border border-[--color-border] bg-gradient-to-br from-[#eef6ff] via-[#f3f0ff] to-white px-10 py-7">
        <div className="absolute -top-16 -right-16 size-64 rounded-full bg-[--color-accent] opacity-[0.10] blur-3xl pointer-events-none" />
        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[--color-accent] font-semibold">
              <Car className="size-3.5" strokeWidth={2} />
              USADOS · unidad operacional de capital de trabajo
            </div>
            <h1 className="text-[28px] font-semibold tracking-tight mt-2 leading-tight text-[--color-fg]">
              {fmtNum(dash.totalUsados)} usados · unidad operacional
            </h1>
            {/* Tres métricas que CONVERSAN con el dashboard (Bloque A · origen del capital). */}
            <div className="flex flex-wrap items-end gap-x-6 gap-y-2 mt-3">
              <div>
                <div className="display text-[24px] leading-none text-[#0f7a59]">{fmtCLPCompact(dash.capitalPropio)}</div>
                <div className="text-[10px] uppercase tracking-wide text-[--color-fg-muted] mt-1">Capital propio · caja Pompeyo</div>
              </div>
              <div className="text-[--color-fg-dim] text-[18px] leading-none pb-1">+</div>
              <div>
                <div className="display text-[24px] leading-none text-[#d97706]">{fmtCLPCompact(dash.capitalTerceros)}</div>
                <div className="text-[10px] uppercase tracking-wide text-[--color-fg-muted] mt-1">Capital terceros · financiado</div>
              </div>
              <div className="text-[--color-fg-dim] text-[18px] leading-none pb-1">=</div>
              <div>
                <div className="display text-[24px] leading-none text-[--color-fg]">{fmtCLPCompact(dash.capitalUnidad)}</div>
                <div className="text-[10px] uppercase tracking-wide text-[--color-fg-muted] mt-1">Capital de la unidad · base MOS</div>
              </div>
              <div className="pl-2 border-l border-[--color-border]">
                <div className="display text-[24px] leading-none text-[--color-fg-muted]">{fmtCLPCompact(dash.capitalGestionado)}</div>
                <div className="text-[10px] uppercase tracking-wide text-[--color-fg-muted] mt-1">
                  Capital gestionado · incl. {fmtCLPCompact(dash.puenteNuevos.cap)} VU nuevos (no suma)
                </div>
              </div>
            </div>
            <p className="text-[13px] text-[--color-fg-muted] mt-3 max-w-3xl leading-relaxed">
              <b>Capital propio</b> = caja realmente expuesta por Pompeyo (conversa con &quot;Caja / Capital
              Pompeyo&quot; del dashboard). <b>+ Terceros</b> (financiado) = <b>capital de la unidad</b>, la base
              del MOS. <b>Stock comercializable</b> ({fmtNum(dash.comercializable.u)} u) = retail + CPD +
              mayorista + judicial + stock B. <b>VU en nuevos</b> se gestiona desde usados pero su capital es
              de la marca originadora — visible, no suma.
            </p>
          </div>
          {/* Tarjeta eficiencia */}
          <div className="relative shrink-0 w-full lg:w-[580px] rounded-xl border border-[--color-accent]/30 bg-white/75 backdrop-blur px-5 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="grid place-items-center size-7 rounded-lg bg-gradient-to-br from-[--color-accent] to-[#6366f1] text-white shadow-sm">
                  <Gauge className="size-4" strokeWidth={2} />
                </span>
                <div className="text-[13px] font-bold tracking-tight text-[--color-fg] leading-none">
                  Eficiencia de usados
                </div>
              </div>
              <div className="text-right leading-tight">
                <div className="whitespace-nowrap">
                  <span className="text-[8px] uppercase tracking-wide text-[--color-fg-muted]">Comercial </span>
                  <span className="text-[10.5px] text-[--color-fg] font-semibold">{fmtNum(dash.comercializable.u)} u</span>
                </div>
                <div className="whitespace-nowrap mt-0.5">
                  <span className="text-[8px] uppercase tracking-wide text-[--color-fg-muted]">Venta/mes </span>
                  {dash.ventaMensualMonto != null ? (
                    <span className="text-[10.5px] text-[--color-fg] font-semibold">
                      {fmtCLPCompact(dash.ventaMensualMonto)} · {fmtNum(Math.round(dash.ventaMensualUnidades ?? 0))} u
                    </span>
                  ) : (
                    <span className="text-[10.5px] text-[--color-fg-dim]">sin ventas</span>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-5 gap-2">
              {metricas.map((m) => (
                <div key={m.label} className="min-w-0 cursor-help" title={m.tip}>
                  <div className="flex items-baseline gap-0.5">
                    <span className="display text-[18px] leading-none" style={{ color: m.color }}>{m.value}</span>
                    {m.sufijo && <span className="text-[9px] text-[--color-fg-dim]">{m.sufijo}</span>}
                  </div>
                  <div className="text-[8px] uppercase tracking-wide text-[--color-fg-muted] leading-[1.1] mt-1">
                    {m.label}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[8.5px] text-[--color-fg-dim] mt-2 leading-snug">
              MOS = stock comercializable ÷ venta mensual (u) · ideal ≤{MOS_IDEAL} · crítico &gt;{MOS_CRITICO}. Q1 usados:{" "}
              {dash.ventaQ1Monto != null ? fmtCLPCompact(dash.ventaQ1Monto) : "—"} ·{" "}
              {dash.ventaQ1Unidades ?? "—"} u (÷3 = venta mensual).
            </div>
          </div>
        </div>
      </div>

      {/* Cruces operacionales: USADOS contra el resto del pipeline global */}
      <div className="surface bg-white px-5 py-3.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[--color-fg-muted] font-semibold">
            USADOS en el sistema · cruces operacionales
          </div>
          <div className="text-[10.5px] text-[--color-fg-dim]">
            Mismo filtro owner-operacional que el resto de los módulos.
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-3">
          <CruceCell label="Capital puente propio (BU)" value={fmtCLPCompact(dash.puenteUsados.cap)} sub={`${fmtNum(dash.puenteUsados.u)} u · ${fmtCLPCompact(dash.puenteNuevos.cap)} VU nuevos no suma`} />
          <CruceCell
            label="FNE usados"
            value={fneStats && fneStats.total > 0 ? fmtCLPCompact(fneStats.valorTotal) : "—"}
            sub={
              fneStats && fneStats.total > 0
                ? `${fmtNum(fneStats.total)} u · ${fmtNum(fneStats.listoParaEntregar)} listos`
                : "sin FNE de usados detectables"
            }
          />
          <CruceCell
            label="Saldos usados"
            value={cruces.saldos.u > 0 ? fmtCLPCompact(cruces.saldos.monto) : "—"}
            sub={
              cruces.saldos.u > 0
                ? `${fmtNum(cruces.saldos.u)} doc · financ. ${fmtCLPCompact(cruces.saldos.financiera)} · C.Pompeyo ${fmtCLPCompact(cruces.saldos.cp)}`
                : "no etiquetados como USADOS en el origen"
            }
          />
          <CruceCell
            label="Provisiones usados"
            value={cruces.provisiones.u > 0 ? fmtCLPCompact(cruces.provisiones.monto) : "—"}
            sub={cruces.provisiones.u > 0 ? `${fmtNum(cruces.provisiones.u)} reg` : "sin provisión atribuida a USADOS"}
          />
          <CruceCell
            label="Líneas usados"
            value={cruces.lineas.n > 0 ? `${fmtNum(cruces.lineas.n)}` : "—"}
            sub={cruces.lineas.n > 0 ? "líneas de crédito" : "sin línea propia de USADOS"}
          />
        </div>
      </div>

      {/* FNE de usados · facturados no entregados (detección operacional) */}
      {fneStats && fneStats.total > 0 && <FNEUsadosPanel s={fneStats} />}

      {/* KPIs por bucket operacional */}
      <div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-[--color-fg-muted] font-semibold mb-2">
          Estructura del capital de usados · clic para drill
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <Kpi label="Stock comercializable" value={fmtCLPCompact(dash.comercializable.cap)} sub={`${fmtNum(dash.comercializable.u)} u · MOS`} tone="caja" active={sel.kind === "grupo" && sel.value === "comercializable"} onClick={() => select({ kind: "grupo", value: "comercializable" })} />
          <Kpi label="Retail disponible" value={fmtCLPCompact(dash.retail.cap)} sub={`${fmtNum(dash.retail.u)} u`} active={sel.kind === "categoria" && sel.value === "USADOS_RETAIL"} onClick={() => select({ kind: "categoria", value: "USADOS_RETAIL" })} />
          <Kpi label="Preparación (CPD)" value={fmtCLPCompact(dash.cpd.cap)} sub={`${fmtNum(dash.cpd.u)} u`} active={sel.kind === "categoria" && sel.value === "USADOS_CPD"} onClick={() => select({ kind: "categoria", value: "USADOS_CPD" })} />
          <Kpi label="Liquidación / mayorista" value={fmtCLPCompact(dash.mayorista.cap)} sub={`${fmtNum(dash.mayorista.u)} u`} tone="warning" active={sel.kind === "categoria" && sel.value === "USADOS_MAYORISTA"} onClick={() => select({ kind: "categoria", value: "USADOS_MAYORISTA" })} />
          <Kpi label="Capital muerto" value={fmtCLPCompact(dash.capitalMuerto.cap)} sub={`${fmtNum(dash.capitalMuerto.u)} u · judicial + stock B`} tone="danger" active={sel.kind === "grupo" && sel.value === "muerto"} onClick={() => select({ kind: "grupo", value: "muerto" })} />
          <Kpi label="Capital puente (BU)" value={fmtCLPCompact(dash.puenteUsados.cap)} sub={`${fmtNum(dash.puenteUsados.u)} u · suma · fuera MOS`} tone="warning" active={sel.kind === "categoria" && sel.value === "USADOS_CAPITAL_PUENTE"} onClick={() => select({ kind: "categoria", value: "USADOS_CAPITAL_PUENTE" })} />
          <Kpi label="VU en nuevos" value={fmtCLPCompact(dash.puenteNuevos.cap)} sub={`${fmtNum(dash.puenteNuevos.u)} u · gestión, no suma`} tone="muted" active={sel.kind === "categoria" && sel.value === "USADOS_CAPITAL_PUENTE"} onClick={() => select({ kind: "categoria", value: "USADOS_CAPITAL_PUENTE" })} />
          <Kpi label="No recepcionado" value={fmtCLPCompact(dash.noRecepcionado.cap)} sub={`${fmtNum(dash.noRecepcionado.u)} u · fuera MOS`} tone="muted" active={sel.kind === "categoria" && sel.value === "USADOS_NO_RECEPCIONADO"} onClick={() => select({ kind: "categoria", value: "USADOS_NO_RECEPCIONADO" })} />
        </div>
        {/* Fila velocidad/aging */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <Kpi label="Comercial >60d" value={fmtNum(dash.agingMas60)} sub="unidades lentas" tone="warning" active={sel.kind === "aging" && sel.value === 60} onClick={() => select({ kind: "aging", value: 60 })} />
          <Kpi label="Capital detenido >180d" value={fmtCLPCompact(dash.capitalDetenido)} sub={`${fmtNum(dash.agingMas180)} u`} tone="danger" active={sel.kind === "aging" && sel.value === 180} onClick={() => select({ kind: "aging", value: 180 })} />
          <Kpi label="Mayorista >90d" value={fmtNum(mayAlerta.mas90.u)} sub={mayAlerta.mas90.u > 0 ? `${fmtCLPCompact(mayAlerta.mas90.cap)} detenido` : "sin alerta"} tone={mayAlerta.mas90.u > 0 ? "danger" : "muted"} active={sel.kind === "mayoria" && sel.value === 90} onClick={() => select({ kind: "mayoria", value: 90 })} />
          <Kpi label="Stock pagado (comercial)" value={fmtCLPCompact(pagado.cap)} sub={`${fmtNum(pagado.u)} u · caja propia`} tone="caja" active={sel.kind === "pagado"} onClick={() => select({ kind: "pagado" })} />
        </div>
      </div>

      {/* Alerta de mayorista envejecido — si ni el mayorista rota, está detenido */}
      {dash.mayorista.u > 0 && (
        <div className="surface bg-white px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="grid place-items-center size-7 rounded-lg bg-[#fff7ed] text-[#ea580c]">
              <AlertTriangle className="size-4" strokeWidth={2} />
            </span>
            <div>
              <div className="text-[13px] font-semibold tracking-tight text-[--color-fg] leading-none">
                Mayorista / liquidación · envejecimiento
              </div>
              <div className="text-[10.5px] text-[--color-fg-dim] mt-1">
                El mayorista debería rotar rápido. Si envejece, el auto está realmente detenido.
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <MayoristaAlerta label={`> ${MAYORISTA_AGING.warn} días`} nivel="warning" b={mayAlerta.mas30} onClick={() => select({ kind: "mayoria", value: MAYORISTA_AGING.warn })} active={sel.kind === "mayoria" && sel.value === MAYORISTA_AGING.warn} />
            <MayoristaAlerta label={`> ${MAYORISTA_AGING.alto} días`} nivel="alto" b={mayAlerta.mas90} onClick={() => select({ kind: "mayoria", value: MAYORISTA_AGING.alto })} active={sel.kind === "mayoria" && sel.value === MAYORISTA_AGING.alto} />
            <MayoristaAlerta label={`> ${MAYORISTA_AGING.critico} días`} nivel="critico" b={mayAlerta.mas180} onClick={() => select({ kind: "mayoria", value: MAYORISTA_AGING.critico })} active={sel.kind === "mayoria" && sel.value === MAYORISTA_AGING.critico} />
          </div>
        </div>
      )}

      {/* Composición operacional · todas las categorías */}
      <div>
        <h2 className="text-[16px] font-semibold tracking-tight text-[--color-fg] mb-1">
          Composición operacional de usados
        </h2>
        <p className="text-[11.5px] text-[--color-fg-muted] mb-3">
          Comercializable (entra al MOS) vs fuera del MOS (puente / no recepcionado / demo).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {dash.porCategoria.map((cat) => {
            const dentro = esComercializable(cat.categoria);
            return (
              <button
                key={cat.categoria}
                onClick={() => select({ kind: "categoria", value: cat.categoria })}
                className={cn(
                  "surface bg-white px-5 py-4 text-left transition surface-hover",
                  sel.kind === "categoria" && sel.value === cat.categoria && "ring-2 ring-[--color-accent]/30 border-[--color-accent]",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[13px] font-semibold text-[--color-fg]">
                    {CATEGORIA_USADO_LABEL[cat.categoria]}
                  </div>
                  <Badge tone={dentro ? "info" : "muted"} size="xs">{dentro ? "MOS" : "fuera MOS"}</Badge>
                </div>
                <div className="display text-[22px] mt-1.5 leading-none text-[--color-fg]">
                  {fmtCLPCompact(cat.capital)}
                </div>
                <div className="text-[12px] text-[--color-fg-muted] mt-1">
                  {fmtNum(cat.unidades)} u · aging prom {cat.agingPromedio}d
                </div>
                {cat.categoria === "USADOS_CAPITAL_PUENTE" && (
                  <div className="mt-2 text-[10.5px] text-[--color-fg-dim] leading-snug border-t border-[--color-border-soft] pt-2">
                    Propio (BU): <span className="text-[--color-fg] font-medium">{fmtCLPCompact(dash.puenteUsados.cap)}</span> ({fmtNum(dash.puenteUsados.u)} u) suma ·{" "}
                    VU nuevos: <span className="text-[--color-fg] font-medium">{fmtCLPCompact(dash.puenteNuevos.cap)}</span> ({fmtNum(dash.puenteNuevos.u)} u) capital en marca origen, no suma.
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Ranking por sucursal usados */}
      <div>
        <h2 className="text-[16px] font-semibold tracking-tight text-[--color-fg] mb-3">
          Sucursales de usados · dónde está el capital
        </h2>
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead className="text-[10px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1] border-b border-[--color-border]">
                <tr>
                  <th className="text-left font-semibold px-4 py-2.5">Sucursal</th>
                  <th className="text-right font-semibold px-4 py-2.5">Capital</th>
                  <th className="text-right font-semibold px-4 py-2.5">u</th>
                  <th className="text-right font-semibold px-4 py-2.5">Aging</th>
                  <th className="text-right font-semibold px-4 py-2.5">Comercial</th>
                  <th className="text-right font-semibold px-4 py-2.5">Mayorista</th>
                  <th className="text-right font-semibold px-4 py-2.5">Puente</th>
                  <th className="text-right font-semibold px-4 py-2.5">Muerto</th>
                </tr>
              </thead>
              <tbody>
                {dash.porSucursal.slice(0, 15).map((s, i) => (
                  <tr
                    key={s.sucursal}
                    onClick={() => select({ kind: "sucursal", value: s.sucursal })}
                    className={cn(
                      "border-b border-[--color-border-soft] last:border-0 cursor-pointer transition",
                      i % 2 === 0 ? "bg-white hover:bg-[--color-bg-elev-1]" : "bg-[--color-bg-elev-1]/40 hover:bg-[--color-bg-elev-1]",
                      sel.kind === "sucursal" && sel.value === s.sucursal && "ring-1 ring-inset ring-[--color-accent]/40",
                    )}
                  >
                    <td className="px-4 py-2.5 text-[12.5px] font-medium">{s.sucursal}</td>
                    <td className="px-4 py-2.5 text-right mono font-semibold">{fmtCLPCompact(s.capital)}</td>
                    <td className="px-4 py-2.5 text-right mono text-[--color-fg-muted]">{fmtNum(s.unidades)}</td>
                    <td className="px-4 py-2.5 text-right mono">{s.agingPromedio}d</td>
                    <td className="px-4 py-2.5 text-right mono text-[--color-fg-muted]">{s.comercializable > 0 ? fmtCLPCompact(s.comercializable) : "—"}</td>
                    <td className="px-4 py-2.5 text-right mono" style={{ color: s.mayorista > 0 ? "#ea580c" : "var(--color-fg-dim)" }}>{s.mayorista > 0 ? fmtCLPCompact(s.mayorista) : "—"}</td>
                    <td className="px-4 py-2.5 text-right mono" style={{ color: s.puente > 0 ? "var(--color-warning)" : "var(--color-fg-dim)" }}>{s.puente > 0 ? fmtCLPCompact(s.puente) : "—"}</td>
                    <td className="px-4 py-2.5 text-right mono" style={{ color: s.muerto > 0 ? "var(--color-danger)" : "var(--color-fg-dim)" }}>{s.muerto > 0 ? fmtCLPCompact(s.muerto) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Drill */}
      <div ref={listaRef} className="space-y-3 scroll-mt-6">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-[16px] font-semibold tracking-tight text-[--color-fg]">
            {tituloDrill(sel)} · {fmtNum(casos.length)} usados ·{" "}
            {fmtCLPCompact(casos.reduce((s, c2) => s + (c2.v.costoNeto || 0), 0))}
          </h2>
          {sel.kind !== "todos" && (
            <button onClick={() => setSel({ kind: "todos" })} className="text-[12px] text-[--color-accent] hover:underline">
              Ver todos
            </button>
          )}
        </div>
        {casos.length === 0 ? (
          <Card>
            <CardBody className="p-10 text-center text-[13px] text-[--color-fg-muted]">Sin usados en esta selección.</CardBody>
          </Card>
        ) : (
          <div className="space-y-2">
            {casos.slice(0, 80).map((c2) => (
              <div key={c2.v.vin} className="surface bg-white px-4 py-3 flex items-center gap-4 flex-wrap">
                <div className="min-w-[200px] flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[13px] text-[--color-fg]">
                      {c2.v.marca ?? "—"}{c2.v.modelo ? ` · ${c2.v.modelo}` : ""}
                    </span>
                    <span className="mono text-[10.5px] text-[--color-fg-muted]">{c2.v.vin}</span>
                    <Badge tone="muted" size="xs">{CATEGORIA_USADO_LABEL[c2.categoria]}</Badge>
                  </div>
                  <div className="text-[11px] text-[--color-fg-muted] mt-0.5">
                    {c2.v.sucursal ?? "—"}
                    {c2.v.patente ? ` · ${c2.v.patente}` : ""}
                  </div>
                </div>
                {c2.aging != null && (
                  <Badge tone={c2.aging > 180 ? "danger" : c2.aging > 60 ? "warning" : "muted"} size="xs">
                    {c2.aging}d
                  </Badge>
                )}
                <span className="mono text-[12.5px] text-[--color-fg] shrink-0">{fmtCLPCompact(c2.v.costoNeto)}</span>
                <div className="shrink-0">
                  {c2.categoria === "USADOS_CAPITAL_PUENTE" ? (
                    <BotonesCasoPuente usado={c2.v} fneIndex={fneIndex} />
                  ) : (
                    <AbrirCasoButton
                      vin={limpiarVIN(c2.v.vin)}
                      origen={`Usados · ${CATEGORIA_USADO_LABEL[c2.categoria]}`}
                    />
                  )}
                </div>
              </div>
            ))}
            {casos.length > 80 && (
              <div className="text-[11.5px] text-[--color-fg-muted] text-center mt-2">
                Mostrando primeros 80 de {fmtNum(casos.length)} · filtra por categoría o sucursal.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function tituloDrill(sel: Sel): string {
  if (sel.kind === "categoria") return CATEGORIA_USADO_LABEL[sel.value];
  if (sel.kind === "grupo")
    return sel.value === "comercializable"
      ? "Stock comercializable (MOS)"
      : sel.value === "muerto"
        ? "Capital muerto (judicial + stock B)"
        : "Fuera del MOS";
  if (sel.kind === "aging") return `Comercializable más de ${sel.value} días`;
  if (sel.kind === "mayoria") return `Mayorista más de ${sel.value} días`;
  if (sel.kind === "pagado") return "Stock pagado (comercializable)";
  if (sel.kind === "sucursal") return sel.value;
  return "Todos los usados";
}

function MayoristaAlerta({
  label,
  nivel,
  b,
  onClick,
  active,
}: {
  label: string;
  nivel: "warning" | "alto" | "critico";
  b: { u: number; cap: number };
  onClick: () => void;
  active?: boolean;
}) {
  const color = nivel === "critico" ? "var(--color-danger)" : nivel === "alto" ? "#ea580c" : "var(--color-warning)";
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg border px-4 py-3 text-left transition",
        b.u > 0 ? "bg-white" : "bg-[--color-bg-elev-1]/40",
        active ? "border-[--color-accent] ring-2 ring-[--color-accent]/25" : "border-[--color-border-soft] hover:border-[--color-border]",
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-[--color-fg-muted] font-medium">{label}</div>
      <div className="display text-[20px] mt-1 leading-none" style={{ color: b.u > 0 ? color : "var(--color-fg-dim)" }}>
        {fmtNum(b.u)} u
      </div>
      <div className="text-[10.5px] text-[--color-fg-dim] mt-1">{b.u > 0 ? fmtCLPCompact(b.cap) : "sin unidades"}</div>
    </button>
  );
}

function FNEUsadosPanel({ s }: { s: FNERealStats }) {
  const bloqueados = ESTADOS_BLOQUEO_ARTIFICIAL.reduce((acc, e) => acc + s.porEstado[e], 0);
  const valorBloqueados = ESTADOS_BLOQUEO_ARTIFICIAL.reduce((acc, e) => acc + s.valorPorEstado[e], 0);
  const aging30 = s.porAging["31-60"] + s.porAging["61+"];
  const estados = ORDEN_ESTADO.filter((e) => s.porEstado[e] > 0);
  return (
    <div className="surface bg-white px-5 py-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="grid place-items-center size-7 rounded-lg bg-[--color-accent]/12 text-[--color-accent]">
            <Truck className="size-4" strokeWidth={2} />
          </span>
          <div>
            <div className="text-[14px] font-semibold tracking-tight text-[--color-fg] leading-none">
              FNE de usados · facturados no entregados
            </div>
            <div className="text-[10.5px] text-[--color-fg-dim] mt-1">
              Detectado por reglas operacionales: VIN cruzado a stock usado ∪ sucursal de usados (el archivo FNE no trae marca).
            </div>
          </div>
        </div>
      </div>

      {/* KPIs FNE */}
      <div className="mt-3.5 grid grid-cols-2 md:grid-cols-4 gap-3">
        <FneKpi label="FNE usados" value={fmtNum(s.total)} sub={fmtCLPCompact(s.valorTotal)} />
        <FneKpi
          label="Listos para entregar"
          value={fmtNum(s.listoParaEntregar)}
          sub={fmtCLPCompact(s.valorListoParaEntregar)}
          color="#0f7a59"
        />
        <FneKpi
          label="Bloqueados (trámite interno)"
          value={fmtNum(bloqueados)}
          sub={fmtCLPCompact(valorBloqueados)}
          color="var(--color-warning)"
        />
        <FneKpi
          label="Aging > 30 días"
          value={fmtNum(aging30)}
          sub={`de ${fmtNum(s.total)} facturados`}
          color={aging30 > 0 ? "var(--color-danger)" : "var(--color-fg)"}
        />
      </div>

      {/* Estado entrega + sucursal */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.1em] text-[--color-fg-muted] font-semibold mb-2">
            Por estado de entrega
          </div>
          <div className="space-y-1.5">
            {estados.map((e) => {
              const n = s.porEstado[e];
              const pct = Math.round((n / s.total) * 100);
              const bloqueo = ESTADOS_BLOQUEO_ARTIFICIAL.includes(e);
              const listo = e === "listo_para_entregar";
              return (
                <div key={e} className="flex items-center gap-2 text-[12px]">
                  <div className="w-44 shrink-0 truncate text-[--color-fg-muted]">{ESTADO_ENTREGA_LABEL[e]}</div>
                  <div className="flex-1 h-2 rounded-full bg-[--color-bg-elev-1] overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        background: listo ? "#0f7a59" : bloqueo ? "var(--color-warning)" : "var(--color-accent)",
                      }}
                    />
                  </div>
                  <div className="w-10 text-right mono text-[--color-fg]">{fmtNum(n)}</div>
                  <div className="w-20 text-right mono text-[10.5px] text-[--color-fg-dim]">
                    {fmtCLPCompact(s.valorPorEstado[e])}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.1em] text-[--color-fg-muted] font-semibold mb-2">
            Por sucursal
          </div>
          <div className="space-y-1">
            {s.porSucursal.slice(0, 8).map((su) => (
              <div key={su.sucursal} className="flex items-center justify-between gap-3 text-[12px]">
                <span className="truncate text-[--color-fg]">{su.sucursal}</span>
                <span className="shrink-0 mono text-[--color-fg-muted]">
                  {fmtNum(su.unidades)} u · {fmtCLPCompact(su.valor)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FneKpi({ label, value, sub, color = "var(--color-fg)" }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="surface bg-[--color-bg-elev-1]/40 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-[--color-fg-muted] font-medium leading-[1.2]">{label}</div>
      <div className="display text-[22px] mt-1.5 leading-none" style={{ color }}>{value}</div>
      <div className="text-[10.5px] text-[--color-fg-dim] mt-1">{sub}</div>
    </div>
  );
}

function CruceCell({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-[--color-fg-muted] font-medium">{label}</div>
      <div className="display text-[18px] mt-1 leading-none text-[--color-fg]">{value}</div>
      <div className="text-[10px] text-[--color-fg-dim] mt-1 leading-snug">{sub}</div>
    </div>
  );
}

type KpiTone = "default" | "caja" | "warning" | "danger" | "muted";

function Kpi({
  label,
  value,
  sub,
  tone = "default",
  active,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: KpiTone;
  active?: boolean;
  onClick?: () => void;
}) {
  const strip =
    tone === "danger" ? "strip-danger" : tone === "warning" ? "strip-warning" : tone === "caja" ? "strip-caja" : "strip-muted";
  const color =
    tone === "danger"
      ? "var(--color-danger)"
      : tone === "warning"
        ? "var(--color-warning)"
        : "var(--color-fg)";
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "surface top-strip bg-white px-4 pt-4 pb-3.5 text-left w-full block",
        strip,
        onClick && "surface-hover cursor-pointer",
        active && "ring-2 ring-[--color-accent]/30 border-[--color-accent]",
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-[--color-fg-muted] font-medium">{label}</div>
      <div className="display text-[20px] mt-1.5 leading-none" style={{ color }}>{value}</div>
      {sub && <div className="text-[10.5px] text-[--color-fg-dim] mt-1">{sub}</div>}
    </Comp>
  );
}
