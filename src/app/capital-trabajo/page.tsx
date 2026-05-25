"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileSpreadsheet,
  HandCoins,
  ShieldAlert,
  Truck,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { VinDrillTable } from "@/components/VinDrillTable";
import { useVinContexto, VinContextoBanner } from "@/components/VinContexto";
import { useDatosFiltrados } from "@/lib/marca-filtro";
import { useGestionStore } from "@/lib/gestion/store";
import { cn } from "@/lib/cn";
import { fmtCLP, fmtCLPCompact, fmtNum, fmtPct } from "@/lib/format";
import type { Vehiculo } from "@/lib/types";
import { cruzarFNEConStock } from "@/lib/selectors/fne-real";
import { cruzarSaldosConStock } from "@/lib/selectors/saldos";
import {
  calcularCreditoPompeyoPorVIN,
  creditoPompeyoSinVIN,
} from "@/lib/selectors/credito-pompeyo";
import { razonesBloqueoFNE } from "@/lib/selectors/razones-bloqueo";
import {
  detectarDobleConteo,
  statsDobleConteo,
  type NivelAlertaDC,
} from "@/lib/selectors/doble-conteo";
import { capitalTrabajoPorMarca } from "@/lib/selectors/capital-trabajo-marca";
import { normalizarMarcaOperacional, MARCA_OTRAS } from "@/lib/selectors/owner-operacional";
import { auditarCalidadDatos } from "@/lib/selectors/auditoria-calidad";

type Tab = "marca" | "doble_conteo" | "auditoria";

/** Umbral de materialidad para alertas ejecutivas (CLP). */
const UMBRAL_MATERIAL = 1_000_000;

export default function CapitalTrabajoPage() {
  const { data } = useDatosFiltrados();
  if (!data) {
    return (
      <div className="max-w-3xl mx-auto px-10 py-16 fade-in">
        <Card variant="glass">
          <CardBody className="p-10">
            <EmptyState
              icon={<Banknote className="size-7" />}
              title="Capital de Trabajo"
              description="Vista unificada: stock + FNE + saldos por marca, alertas de doble conteo y auditoría de calidad de datos. Carga primero el Excel maestro de stock."
              action={
                <Link href="/" className="text-[--color-accent] text-sm hover:underline">
                  Ir al inicio →
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
      <CapitalTrabajoInner />
    </Suspense>
  );
}

function CapitalTrabajoInner() {
  const { data, fne, saldos, provisiones } = useDatosFiltrados();
  const vinCtx = useVinContexto();
  const parsed = data!;
  const [tab, setTab] = useState<Tab>("marca");

  const cruzadosFNE = useMemo(
    () =>
      fne
        ? cruzarFNEConStock(fne.registros, parsed.vehiculos, parsed.vinsExtra ?? null)
        : [],
    [fne, parsed.vehiculos, parsed.vinsExtra],
  );
  const cruzadosSaldos = useMemo(
    () =>
      saldos
        ? cruzarSaldosConStock(saldos.registros, parsed.vehiculos, parsed.vinsExtra ?? null, fne)
        : [],
    [saldos, parsed.vehiculos, parsed.vinsExtra, fne],
  );
  const creditoMap = useMemo(
    () => calcularCreditoPompeyoPorVIN(cruzadosSaldos),
    [cruzadosSaldos],
  );
  const dobleConteoAlertas = useMemo(
    () => detectarDobleConteo(cruzadosFNE, cruzadosSaldos),
    [cruzadosFNE, cruzadosSaldos],
  );
  const dcStats = useMemo(() => statsDobleConteo(dobleConteoAlertas), [dobleConteoAlertas]);
  const cpSinVIN = useMemo(() => creditoPompeyoSinVIN(cruzadosSaldos), [cruzadosSaldos]);
  const cpSinVINMonto = useMemo(
    () => cpSinVIN.reduce((s, x) => s + x.cPompeyoCLP, 0),
    [cpSinVIN],
  );
  const porMarca = useMemo(
    () =>
      capitalTrabajoPorMarca(
        parsed.vehiculos,
        cruzadosFNE,
        cruzadosSaldos,
        provisiones?.registros ?? [],
      ),
    [parsed.vehiculos, cruzadosFNE, cruzadosSaldos, provisiones],
  );
  const auditoria = useMemo(
    () => auditarCalidadDatos(parsed, fne, saldos),
    [parsed, fne, saldos],
  );

  // Gestión persistente por VIN
  useEffect(() => {
    useGestionStore.getState().hydrate();
  }, []);

  // VINs por marca (para el drill de cada fila)
  const vehiculosPorMarca = useMemo(() => {
    const m = new Map<string, Vehiculo[]>();
    const seen = new Set<string>();
    for (const v of parsed.vehiculos) {
      if (!v.vin || seen.has(v.vin)) continue;
      seen.add(v.vin);
      // Mismo plegado que capitalTrabajoPorMarca: marcas ajenas → OTRAS MARCAS,
      // para que el drill de cada fila calce con el bucket consolidado.
      const marca = normalizarMarcaOperacional(v.marca ?? v.marcaPompeyo);
      if (!m.has(marca)) m.set(marca, []);
      m.get(marca)!.push(v);
    }
    for (const arr of m.values()) arr.sort((a, b) => (b.diasStock ?? 0) - (a.diasStock ?? 0));
    return m;
  }, [parsed.vehiculos]);

  // Conjuntos de VINs para los drills de KPIs macro
  const uniqVeh = useMemo(() => {
    const seen = new Set<string>();
    const out: Vehiculo[] = [];
    for (const v of parsed.vehiculos) {
      if (!v.vin || seen.has(v.vin)) continue;
      seen.add(v.vin);
      out.push(v);
    }
    return out;
  }, [parsed.vehiculos]);
  const fneVehs = useMemo(() => {
    const seen = new Set<string>();
    const out: Vehiculo[] = [];
    for (const c of cruzadosFNE) {
      if (c.vehiculo && !seen.has(c.vehiculo.vin)) {
        seen.add(c.vehiculo.vin);
        out.push(c.vehiculo);
      }
    }
    return out;
  }, [cruzadosFNE]);
  const cpVehs = useMemo(
    () => uniqVeh.filter((v) => creditoMap.has(v.vin)),
    [uniqVeh, creditoMap],
  );
  const listosVehs = useMemo(() => {
    const seen = new Set<string>();
    const out: Vehiculo[] = [];
    for (const c of cruzadosFNE) {
      if (!c.vehiculo) continue;
      const b = razonesBloqueoFNE(c, creditoMap);
      if (b.length === 0 && !seen.has(c.vehiculo.vin)) {
        seen.add(c.vehiculo.vin);
        out.push(c.vehiculo);
      }
    }
    return out;
  }, [cruzadosFNE, creditoMap]);
  const bloqFinVehs = useMemo(() => {
    const seen = new Set<string>();
    const out: Vehiculo[] = [];
    for (const c of cruzadosFNE) {
      if (!c.vehiculo) continue;
      const b = razonesBloqueoFNE(c, creditoMap);
      if (b.some((x) => x.tipo === "financiero") && !seen.has(c.vehiculo.vin)) {
        seen.add(c.vehiculo.vin);
        out.push(c.vehiculo);
      }
    }
    return out;
  }, [cruzadosFNE, creditoMap]);
  const bloqOpVehs = useMemo(() => {
    const seen = new Set<string>();
    const out: Vehiculo[] = [];
    for (const c of cruzadosFNE) {
      if (!c.vehiculo) continue;
      const b = razonesBloqueoFNE(c, creditoMap);
      if (b.length > 0 && !b.some((x) => x.tipo === "financiero") && !seen.has(c.vehiculo.vin)) {
        seen.add(c.vehiculo.vin);
        out.push(c.vehiculo);
      }
    }
    return out;
  }, [cruzadosFNE, creditoMap]);

  const [kpiDrill, setKpiDrill] = useState<{ titulo: string; vins: Vehiculo[] } | null>(null);
  const openDrill = (titulo: string, vins: Vehiculo[]) => {
    setKpiDrill((cur) => (cur && cur.titulo === titulo ? null : { titulo, vins }));
  };

  // Macro KPIs
  const totalStock = porMarca.reduce((s, m) => s + m.stockValorizado, 0);
  const totalFNE = porMarca.reduce((s, m) => s + m.fneValorizado, 0);
  const totalSaldos = porMarca.reduce((s, m) => s + m.saldosClienteCLP, 0);
  const totalCP = porMarca.reduce((s, m) => s + m.creditoPompeyoCLP, 0);
  const unidadesListas = cruzadosFNE.filter((c) => {
    const b = razonesBloqueoFNE(c, creditoMap);
    return b.length === 0;
  }).length;
  const unidadesBloqFin = cruzadosFNE.filter((c) => {
    const b = razonesBloqueoFNE(c, creditoMap);
    return b.some((x) => x.tipo === "financiero");
  }).length;
  const unidadesBloqOp = cruzadosFNE.filter((c) => {
    const b = razonesBloqueoFNE(c, creditoMap);
    return b.length > 0 && !b.some((x) => x.tipo === "financiero");
  }).length;

  // FNE valorizado por estado financiero (con vs sin C.P.)
  const fneBloqueadoPorCP = cruzadosFNE.reduce((s, c) => {
    const b = razonesBloqueoFNE(c, creditoMap);
    return b.some((x) => x.tipo === "financiero") ? s + c.fne.valorFactura : s;
  }, 0);

  // === SECCIÓN A · Exposición operacional ===
  // Stock total y FNE valorizados (sin doble conteo entre sí — son cosas distintas)
  const stockTotalValor = parsed.vehiculos.reduce((acc, v) => acc + (v.costoNeto || 0), 0);
  const stockUnidades = parsed.vehiculos.length;
  const fneValorTotal = fne?.registros.reduce((s, r) => s + (r.valorFactura ?? 0), 0) ?? 0;
  const fneUnidades = fne?.registros.length ?? 0;

  // === SECCIÓN B · Financiamiento / línea ===
  const lineaAutorizada = parsed.lineas.reduce((s, l) => s + l.lineaAutorizada, 0);
  const lineaOcupada = parsed.lineas.reduce((s, l) => s + l.lineaOcupada, 0);
  const lineaLibreReal = lineaAutorizada - lineaOcupada; // puede ser negativo (sobregiro)
  const sobregiro = lineaLibreReal < 0 ? Math.abs(lineaLibreReal) : 0;

  const stockFinanciado = parsed.vehiculos
    .filter((v) => v.tipoStock === "FloorPlan" || v.tipoStock === "Financiado")
    .reduce((s, v) => s + (v.costoNeto || 0), 0);

  // === SECCIÓN C · Caja comprometida estimada ===
  const stockPagado = parsed.vehiculos
    .filter((v) => v.tipoStock === "Propio" || v.tipoStock === "FinPropio")
    .reduce((s, v) => s + (v.costoNeto || 0), 0);
  const provisionesNoFacturadas = porMarca.reduce(
    (s, m) => s + m.provisionesNoFacturadas,
    0,
  );
  // Caja comprometida estimada = lo que Pompeyo financia con su propia caja.
  // Fórmula: stock pagado + provisiones no facturadas + Crédito Pompeyo
  // (porque CP es plata que Pompeyo todavía no cobra y financia internamente)
  const capitalPropioEstimado = stockPagado + provisionesNoFacturadas + totalCP;
  const cpVinsCount = creditoMap.size;

  return (
    <div className="max-w-[1500px] mx-auto px-10 py-10 space-y-6 fade-in">
      {vinCtx && (
        <VinContextoBanner
          vin={vinCtx}
          presentes={1}
          nota="Capital de Trabajo se muestra agregado por marca/fuente. El detalle por VIN está en la ficha del caso."
        />
      )}
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-[--color-border] bg-gradient-to-br from-[#eff3ff] via-[#f5f0ff] to-white px-10 py-8">
        <div className="absolute -top-12 -right-12 size-56 rounded-full bg-[--color-accent] opacity-[0.12] blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[--color-accent] font-semibold">
            <Banknote className="size-3.5" strokeWidth={2} />
            Capital de Trabajo · vista macro a micro
          </div>
          <h1 className="text-[28px] font-semibold tracking-tight mt-2 leading-tight text-[--color-fg]">
            Exposición · Financiamiento · Caja comprometida · Ejecución
          </h1>
          <p className="text-[14px] text-[--color-fg-muted] mt-2 max-w-3xl leading-relaxed">
            Cuatro lentes sobre el mismo universo VIN. <strong>Crédito Pompeyo pendiente</strong> y{" "}
            <strong>FNE bloqueado por C.P.</strong> son cosas distintas: el primero es la deuda
            ($447.9M), el segundo es el valor facturado de los autos que no se entregan hasta
            cobrarla.
          </p>
        </div>
      </div>

      {/* Alerta sobregiro línea — solo si hay */}
      {sobregiro > 0 && (
        <div className="surface top-strip strip-danger bg-[--color-danger]/5 px-6 py-4 flex items-center gap-4">
          <div className="size-10 rounded-lg bg-[--color-danger]/15 grid place-items-center shrink-0">
            <AlertTriangle className="size-5 text-[--color-danger]" strokeWidth={2.5} />
          </div>
          <div className="flex-1">
            <div className="text-[11px] uppercase tracking-[0.14em] text-[--color-danger] font-semibold">
              Sobregiro de línea
            </div>
            <div className="text-[15px] font-medium text-[--color-fg] mt-0.5">
              La línea ocupada excede la línea autorizada en{" "}
              <span className="text-[--color-danger] font-semibold">
                {fmtCLPCompact(sobregiro)}
              </span>
            </div>
            <div className="text-[12px] text-[--color-fg-muted] mt-0.5">
              Autorizada {fmtCLPCompact(lineaAutorizada)} · Ocupada{" "}
              {fmtCLPCompact(lineaOcupada)} · Riesgo financiero alto
            </div>
          </div>
        </div>
      )}

      {/* ===== A · EXPOSICIÓN OPERACIONAL ===== */}
      <section>
        <SectionHeader
          letter="A"
          title="Exposición operacional"
          desc="Stock activo y FNE — universo de autos sin entregar al cliente. NO se suman entre sí."
        />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          <KPI
            label="Stock total $"
            value={fmtCLPCompact(stockTotalValor)}
            sub={`${fmtNum(stockUnidades)} unidades`}
            tone="accent"
            onClick={() => openDrill("Stock total", uniqVeh)}
            active={kpiDrill?.titulo === "Stock total"}
          />
          <KPI
            label="Stock unidades"
            value={fmtNum(stockUnidades)}
            sub="vehículos en stock"
            onClick={() => openDrill("Stock total", uniqVeh)}
            active={kpiDrill?.titulo === "Stock total"}
          />
          <KPI
            label="FNE $"
            value={fmtCLPCompact(fneValorTotal)}
            sub={`${fmtNum(fneUnidades)} facturados`}
            tone="accent"
            onClick={() => openDrill("FNE", fneVehs)}
            active={kpiDrill?.titulo === "FNE"}
          />
          <KPI
            label="FNE unidades"
            value={fmtNum(fneUnidades)}
            sub="autos no entregados"
            onClick={() => openDrill("FNE", fneVehs)}
            active={kpiDrill?.titulo === "FNE"}
          />
        </div>
      </section>

      {/* ===== B · FINANCIAMIENTO / LÍNEA ===== */}
      <section>
        <SectionHeader
          letter="B"
          title="Financiamiento / línea"
          desc="Línea de crédito disponible y obligaciones financieras. Crédito Pompeyo aparece acá como deuda pendiente del cliente, NO como bloqueo de capital."
        />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-3">
          <KPI label="Línea autorizada" value={fmtCLPCompact(lineaAutorizada)} sub="total marcas" />
          <KPI label="Línea ocupada" value={fmtCLPCompact(lineaOcupada)} sub={`${fmtPct(lineaAutorizada > 0 ? lineaOcupada / lineaAutorizada : 0)} de autorizada`} tone={lineaOcupada > lineaAutorizada ? "danger" : "default"} />
          <KPI
            label={sobregiro > 0 ? "Sobregiro" : "Línea libre"}
            value={fmtCLPCompact(Math.abs(lineaLibreReal))}
            sub={sobregiro > 0 ? "ocupada > autorizada" : "disponible"}
            tone={sobregiro > 0 ? "danger" : "success"}
          />
          <KPI label="Stock financiado" value={fmtCLPCompact(stockFinanciado)} sub="Floor Plan + Financiado" />
          <KPI
            label="C. Pompeyo pendiente"
            value={fmtCLPCompact(totalCP)}
            sub={`${fmtNum(cpVinsCount)} VIN con deuda`}
            tone={totalCP > 0 ? "warning" : "default"}
            onClick={() => openDrill("Crédito Pompeyo", cpVehs)}
            active={kpiDrill?.titulo === "Crédito Pompeyo"}
          />
        </div>
      </section>

      {/* ===== C · CAJA COMPROMETIDA ESTIMADA ===== */}
      <section>
        <SectionHeader
          letter="C"
          title="Caja comprometida estimada"
          desc="Métrica operacional, NO balance contable. Estima la caja propia comprometida = stock pagado + provisiones no facturadas + Crédito Pompeyo pendiente. NO suma stock financiado (es deuda con la financiera, no caja propia)."
        />
        <div className="text-[11.5px] text-[--color-fg-dim] mt-2 leading-relaxed bg-[--color-bg-elev-1] rounded-md px-3 py-2 border border-[--color-border-soft]">
          <span className="text-[--color-fg-muted] font-medium">Regla configurable:</span>{" "}
          las provisiones no facturadas se incluyen como compromiso operacional mientras no
          exista una definición contable final. Cuando se defina, este KPI se ajusta sin
          tocar el resto.
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          <KPI label="Stock pagado" value={fmtCLPCompact(stockPagado)} sub="Propio + FinPropio" tone="success" />
          <KPI
            label="Provisiones no facturadas"
            value={fmtCLPCompact(provisionesNoFacturadas)}
            sub="capital activo sin facturar"
            tone={provisionesNoFacturadas > 0 ? "warning" : "default"}
          />
          <KPI
            label="C. Pompeyo (deuda cliente)"
            value={fmtCLPCompact(totalCP)}
            sub="plata por cobrar"
            tone={totalCP > 0 ? "warning" : "default"}
            onClick={() => openDrill("Crédito Pompeyo", cpVehs)}
            active={kpiDrill?.titulo === "Crédito Pompeyo"}
          />
          <KPI
            label="Caja comprometida estimada"
            value={fmtCLPCompact(capitalPropioEstimado)}
            sub="Estimación operacional · no contable · = pagado + provisiones + C.P."
            tone="accent"
          />
        </div>
      </section>

      {/* ===== D · EJECUCIÓN DE ENTREGA ===== */}
      <section>
        <SectionHeader
          letter="D"
          title="Ejecución de entrega · FNE"
          desc="De los autos facturados, cuáles se pueden entregar hoy y qué bloquea al resto. El monto $X.XB en bloqueados por C.P. corresponde al VALOR FACTURADO de esos FNE, no a la deuda C.P. ($447.9M)."
        />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          <KPI
            label="Listos para entregar"
            value={fmtNum(unidadesListas)}
            sub="sin bloqueo financiero ni operativo"
            tone="success"
            onClick={() => openDrill("Listos para entregar", listosVehs)}
            active={kpiDrill?.titulo === "Listos para entregar"}
          />
          <KPI
            label="Bloqueados por C. Pompeyo"
            value={fmtNum(unidadesBloqFin)}
            sub={`${fmtCLPCompact(fneBloqueadoPorCP)} valor facturado FNE`}
            tone={unidadesBloqFin > 0 ? "danger" : "default"}
            onClick={() => openDrill("Bloqueados por C. Pompeyo", bloqFinVehs)}
            active={kpiDrill?.titulo === "Bloqueados por C. Pompeyo"}
          />
          <KPI
            label="Bloqueados operacionales"
            value={fmtNum(unidadesBloqOp)}
            sub="patente / inscripción / logística"
            tone={unidadesBloqOp > 0 ? "warning" : "default"}
            onClick={() => openDrill("Bloqueados operacionales", bloqOpVehs)}
            active={kpiDrill?.titulo === "Bloqueados operacionales"}
          />
          <KPI
            label="FNE total"
            value={fmtNum(fneUnidades)}
            sub={fmtCLPCompact(fneValorTotal) + " facturado"}
            onClick={() => openDrill("FNE", fneVehs)}
            active={kpiDrill?.titulo === "FNE"}
          />
        </div>
      </section>

      {/* Drill inline de KPIs macro */}
      {kpiDrill && (
        <div className="rounded-xl border border-[--color-accent]/40 bg-white overflow-hidden ring-1 ring-[--color-accent]/20">
          <div className="px-5 py-3 border-b border-[--color-border-soft] flex items-center justify-between gap-3 flex-wrap bg-[--color-bg-elev-1]">
            <div>
              <span className="text-[13px] font-semibold text-[--color-fg]">{kpiDrill.titulo}</span>
              <span className="text-[12px] text-[--color-fg-muted] ml-2">
                {fmtNum(kpiDrill.vins.length)} VIN con stock asociado · gestión por VIN
              </span>
            </div>
            <button
              onClick={() => setKpiDrill(null)}
              className="text-[--color-fg-muted] hover:text-[--color-fg] p-1 rounded-md hover:bg-[--color-bg-elev-2] transition"
              aria-label="Cerrar"
            >
              <X className="size-4" />
            </button>
          </div>
          <VinDrillTable vins={kpiDrill.vins} />
        </div>
      )}

      {/* Observaciones para conciliación — tono no alarmista */}
      {(cpSinVINMonto >= UMBRAL_MATERIAL || dcStats.total > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cpSinVINMonto >= UMBRAL_MATERIAL && (
            <AlertaCard
              tone="warning"
              icon={<ShieldAlert className="size-4" />}
              title={`Crédito Pompeyo sin VIN · ${fmtCLPCompact(cpSinVINMonto)}`}
              body={`${cpSinVIN.length} saldos C.P. material sin auto asociado — conciliar el Cajón con un VIN.`}
              actionLabel="Ver en Auditoría"
              onClick={() => setTab("auditoria")}
            />
          )}
          {dcStats.total > 0 && (
            <AlertaCard
              tone="warning"
              icon={<AlertTriangle className="size-4" />}
              title={`${fmtNum(dcStats.total)} operaciones para conciliación`}
              body={`Cruces FNE ↔ Saldos pendientes de validar. La mayoría es situación normal (cliente con factura y saldo). ${dcStats.doble_conteo > 0 ? `${dcStats.doble_conteo} requieren revisión por montos casi iguales.` : ""}`}
              actionLabel="Ver conciliación"
              onClick={() => setTab("doble_conteo")}
            />
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[--color-border]">
        <TabBtn active={tab === "marca"} onClick={() => setTab("marca")}>
          Por marca
        </TabBtn>
        <TabBtn active={tab === "doble_conteo"} onClick={() => setTab("doble_conteo")}>
          Conciliación FNE ↔ Saldos
          {dcStats.total > 0 && (
            <span className="ml-1.5 text-[10px] mono text-[--color-fg-muted]">{dcStats.total}</span>
          )}
        </TabBtn>
        <TabBtn active={tab === "auditoria"} onClick={() => setTab("auditoria")}>
          Auditoría
        </TabBtn>
      </div>

      {tab === "marca" && (
        <TabMarca
          marcas={porMarca}
          vehiculosPorMarca={vehiculosPorMarca}
          totalStock={totalStock}
          totalFNE={totalFNE}
          totalSaldos={totalSaldos}
        />
      )}
      {tab === "doble_conteo" && (
        <TabDobleConteo alertas={dobleConteoAlertas} stats={dcStats} />
      )}
      {tab === "auditoria" && <TabAuditoria auditoria={auditoria} cpSinVIN={cpSinVIN} />}
    </div>
  );
}

function SectionHeader({
  letter,
  title,
  desc,
}: {
  letter: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="size-7 rounded-md bg-[--color-accent]/10 text-[--color-accent] grid place-items-center text-[12px] font-bold mono shrink-0">
        {letter}
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-[--color-fg]">{title}</h2>
        <p className="text-[12.5px] text-[--color-fg-muted] mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

function KPI({
  label,
  value,
  sub,
  tone = "default",
  onClick,
  active,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "accent" | "danger" | "warning" | "success";
  onClick?: () => void;
  active?: boolean;
}) {
  const stripClass =
    tone === "accent"
      ? "strip-operativo"
      : tone === "danger"
        ? "strip-danger"
        : tone === "warning"
          ? "strip-warning"
          : tone === "success"
            ? "strip-success"
            : "strip-muted";
  const numColor =
    tone === "danger"
      ? "text-[--color-danger]"
      : tone === "warning"
        ? "text-[--color-warning]"
        : tone === "success"
          ? "text-[--color-success]"
          : "text-[--color-fg]";
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "surface top-strip bg-white px-5 pt-6 pb-5 text-left w-full block",
        stripClass,
        onClick && "surface-hover cursor-pointer",
        active && "ring-2 ring-[--color-accent]/40 border-[--color-accent]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
          {label}
        </div>
        {onClick && (
          <ChevronDown
            className={cn(
              "size-3.5 text-[--color-fg-dim] transition shrink-0",
              active && "rotate-180 text-[--color-accent]",
            )}
          />
        )}
      </div>
      <div className={cn("display text-[28px] mt-2 leading-none", numColor)}>{value}</div>
      {sub && <div className="text-[12px] text-[--color-fg-muted] mt-2 leading-relaxed">{sub}</div>}
    </Comp>
  );
}

function AlertaCard({
  tone,
  icon,
  title,
  body,
  actionLabel,
  onClick,
}: {
  tone: "danger" | "warning";
  icon: React.ReactNode;
  title: string;
  body: string;
  actionLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "surface surface-hover top-strip bg-white px-5 pt-6 pb-5 text-left",
        tone === "danger" ? "strip-danger" : "strip-warning",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 text-[11.5px] uppercase tracking-[0.14em] font-semibold",
          tone === "danger" ? "text-[--color-danger]" : "text-[--color-warning]",
        )}
      >
        {icon}
        {title}
      </div>
      <div className="text-[13px] text-[--color-fg-muted] mt-2 leading-relaxed">{body}</div>
      <div className="flex items-center gap-1 text-[12px] text-[--color-accent] mt-3 font-medium">
        {actionLabel} <ArrowRight className="size-3.5" />
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

// ── TAB: Por marca ──────────────────────────────────────────────────────

function TabMarca({
  marcas,
  vehiculosPorMarca,
  totalStock,
  totalFNE,
  totalSaldos,
}: {
  marcas: ReturnType<typeof capitalTrabajoPorMarca>;
  vehiculosPorMarca: Map<string, Vehiculo[]>;
  totalStock: number;
  totalFNE: number;
  totalSaldos: number;
}) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const maxCaja = Math.max(...marcas.map((m) => m.capitalComprometidoEstimado), 1);

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-[--color-fg]">
            Capital de trabajo por marca
          </h2>
          <p className="text-[12.5px] text-[--color-fg-muted] mt-1">
            Cada marca: stock, FNE, Crédito Pompeyo, provisiones, aging, listos y bloqueados. Clic
            para ver y gestionar los VINs.
          </p>
        </div>
        <div className="text-[12px] text-[--color-fg-muted]">
          Total stock <span className="mono text-[--color-fg]">{fmtCLPCompact(totalStock)}</span> ·
          FNE <span className="mono text-[--color-fg]">{fmtCLPCompact(totalFNE)}</span> · saldos{" "}
          <span className="mono text-[--color-fg]">{fmtCLPCompact(totalSaldos)}</span>
        </div>
      </div>

      <div className="space-y-2">
        {marcas.map((m) => {
          const isOpen = abierta === m.marca;
          const critico = m.creditoPompeyoCLP > 0 || m.unidadesBloqueadas > 0;
          const aging = m.agingPromedioFNE > 0 ? Math.round(m.agingPromedioFNE) : 0;
          const sevBorder = critico
            ? "border-l-[--color-danger]"
            : aging > 30
              ? "border-l-[--color-warning]"
              : "border-l-[--color-success]";
          const vins = vehiculosPorMarca.get(m.marca) ?? [];
          return (
            <div
              key={m.marca}
              className={cn(
                "rounded-xl border border-[--color-border] border-l-4 bg-white overflow-hidden transition",
                sevBorder,
                isOpen && "ring-1 ring-[--color-accent]/30",
              )}
            >
              <button
                onClick={() => setAbierta(isOpen ? null : m.marca)}
                className="w-full text-left px-5 py-4 hover:bg-[--color-bg-elev-1] transition"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  {/* Marca + badges */}
                  <div className="min-w-[180px]">
                    <div className="text-[15px] font-semibold text-[--color-fg]">{m.marca}</div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                      {m.unidadesFNE > 0 && (
                        <BadgeMini tone="info" icon={<Truck className="size-2.5" />}>
                          FNE {fmtNum(m.unidadesFNE)}
                        </BadgeMini>
                      )}
                      {m.creditoPompeyoCLP > 0 && (
                        <BadgeMini tone="danger" icon={<HandCoins className="size-2.5" />}>
                          C.P.
                        </BadgeMini>
                      )}
                      {aging > 30 && (
                        <BadgeMini tone="warning" icon={<Clock className="size-2.5" />}>
                          {aging}d
                        </BadgeMini>
                      )}
                      {m.unidadesBloqueadas > 0 && (
                        <BadgeMini tone="danger">{fmtNum(m.unidadesBloqueadas)} bloq.</BadgeMini>
                      )}
                      {m.unidadesListasEntrega > 0 && (
                        <BadgeMini tone="success">{fmtNum(m.unidadesListasEntrega)} listos</BadgeMini>
                      )}
                    </div>
                  </div>

                  {/* Caja comprometida + barra */}
                  <div className="text-right shrink-0 min-w-[160px]">
                    <div className="text-[9.5px] uppercase tracking-wide text-[--color-fg-dim]">
                      Caja comprometida
                    </div>
                    <div className="display text-[22px] leading-none text-[--color-fg] mt-0.5">
                      {fmtCLPCompact(m.capitalComprometidoEstimado)}
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-[--color-bg-elev-3] overflow-hidden mt-1.5">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          critico ? "bg-[--color-danger]" : aging > 30 ? "bg-[--color-warning]" : "bg-[--color-accent]",
                        )}
                        style={{ width: `${(m.capitalComprometidoEstimado / maxCaja) * 100}%` }}
                      />
                    </div>
                  </div>

                  <ChevronDown
                    className={cn(
                      "size-4 text-[--color-fg-dim] transition shrink-0 mt-1",
                      isOpen && "rotate-180 text-[--color-accent]",
                    )}
                  />
                </div>

                {/* Mini-KPIs */}
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-3.5">
                  <Mini label="Stock" tone="accent" value={fmtCLPCompact(m.stockValorizado)} extra={`${fmtNum(m.unidadesStock)}u`} />
                  <Mini label="FNE" tone="info" value={fmtCLPCompact(m.fneValorizado)} extra={`${fmtNum(m.unidadesFNE)}u`} />
                  <Mini label="Saldos cliente" value={fmtCLPCompact(m.saldosClienteCLP)} />
                  <Mini
                    label="C. Pompeyo"
                    tone={m.creditoPompeyoCLP > 0 ? "danger" : "muted"}
                    value={m.creditoPompeyoCLP > 0 ? fmtCLPCompact(m.creditoPompeyoCLP) : "—"}
                  />
                  <Mini
                    label="Prov. no fact."
                    tone={m.provisionesNoFacturadas > 0 ? "warning" : "muted"}
                    value={m.provisionesNoFacturadas > 0 ? fmtCLPCompact(m.provisionesNoFacturadas) : "—"}
                  />
                  <Mini
                    label="Aging FNE"
                    tone={aging > 30 ? "warning" : "muted"}
                    value={aging > 0 ? `${aging}d` : "—"}
                  />
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-[--color-border-soft]">
                  <VinDrillTable
                    vins={vins}
                    verTodosHref={
                      // El explorador conserva granularidad (auditoría): para el
                      // bucket sintético OTRAS MARCAS se expanden sus marcas físicas
                      // reales; el resto usa la marca operacional directa.
                      m.marca === MARCA_OTRAS
                        ? (() => {
                            const fisicas = [
                              ...new Set(
                                vins.map((v) => v.marca ?? v.marcaPompeyo).filter(Boolean),
                              ),
                            ];
                            return fisicas.length
                              ? `/stock?marca=${encodeURIComponent(fisicas.join(","))}`
                              : "/stock";
                          })()
                        : `/stock?marca=${encodeURIComponent(m.marca)}`
                    }
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BadgeMini({
  tone,
  icon,
  children,
}: {
  tone: "info" | "danger" | "warning" | "success";
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const cls =
    tone === "danger"
      ? "bg-[--color-danger]/10 text-[--color-danger]"
      : tone === "warning"
        ? "bg-[--color-warning]/12 text-[--color-warning]"
        : tone === "success"
          ? "bg-[--color-success]/10 text-[--color-success]"
          : "bg-[--color-info]/10 text-[--color-info]";
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold", cls)}>
      {icon}
      {children}
    </span>
  );
}

function Mini({
  label,
  value,
  extra,
  tone = "default",
}: {
  label: string;
  value: string;
  extra?: string;
  tone?: "default" | "accent" | "info" | "danger" | "warning" | "muted";
}) {
  const valueColor =
    tone === "accent"
      ? "text-[--color-accent]"
      : tone === "info"
        ? "text-[--color-info]"
        : tone === "danger"
          ? "text-[--color-danger]"
          : tone === "warning"
            ? "text-[--color-warning]"
            : tone === "muted"
              ? "text-[--color-fg-dim]"
              : "text-[--color-fg]";
  return (
    <div className="rounded-lg bg-[--color-bg-elev-2] border border-[--color-border-soft] px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-[--color-fg-dim] truncate">{label}</div>
      <div className={cn("mono text-[12.5px] mt-0.5", valueColor)}>
        {value}
        {extra && <span className="text-[--color-fg-dim] text-[10px] ml-1">{extra}</span>}
      </div>
    </div>
  );
}

// ── TAB: Doble conteo ───────────────────────────────────────────────────

function TabDobleConteo({
  alertas,
  stats,
}: {
  alertas: ReturnType<typeof detectarDobleConteo>;
  stats: ReturnType<typeof statsDobleConteo>;
}) {
  const [nivel, setNivel] = useState<"todos" | NivelAlertaDC>("todos");
  const filtered = nivel === "todos" ? alertas : alertas.filter((a) => a.nivelAlerta === nivel);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPI label="Operaciones a conciliar" value={fmtNum(stats.total)} sub="FNE ∩ Saldos vehículo" />
        <KPI label="Conciliadas OK" value={fmtNum(stats.ok)} sub="Δ ≤ 2%" tone={stats.ok > 0 ? "success" : "default"} />
        <KPI label="Diferencia menor" value={fmtNum(stats.menor)} sub="Δ 2-15%" />
        <KPI
          label="Casos para validar"
          value={fmtNum(stats.relevante)}
          sub="Δ 15-40%"
          tone={stats.relevante > 0 ? "warning" : "default"}
        />
        <KPI
          label="Revisar montos"
          value={fmtNum(stats.doble_conteo)}
          sub="Δ<10% · monto>$5M"
          tone={stats.doble_conteo > 0 ? "warning" : "default"}
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(
          ["todos", "doble_conteo", "inconsistente", "relevante", "menor", "ok"] as const
        ).map((n) => (
          <button
            key={n}
            onClick={() => setNivel(n)}
            className={cn(
              "px-3 py-1 rounded-md text-[12px] font-medium border transition",
              nivel === n
                ? "border-[--color-accent] bg-[--color-accent]/10 text-[--color-accent]"
                : "border-[--color-border] bg-white text-[--color-fg-muted] hover:text-[--color-fg]",
            )}
          >
            {n === "todos"
              ? "Todos"
              : n === "doble_conteo"
                ? "Doble conteo"
                : n === "inconsistente"
                  ? "Inconsistentes"
                  : n === "relevante"
                    ? "Relevantes"
                    : n === "menor"
                      ? "Menores"
                      : "OK"}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conciliación FNE ↔ Saldos · {fmtNum(filtered.length)} VIN</CardTitle>
          <CardDescription>
            VINs presentes en FNE y Saldos.vehículo simultáneamente. La mayoría es situación
            normal (cliente con factura y saldo pendiente). Solo se marca &ldquo;doble conteo&rdquo;
            cuando los montos cuadran y son significativos.
          </CardDescription>
        </CardHeader>
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[1300px]">
            <thead className="text-[10.5px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1]">
              <tr>
                <th className="text-left font-semibold px-4 py-3">Nivel</th>
                <th className="text-left font-semibold px-4 py-3">VIN · Cajón</th>
                <th className="text-left font-semibold px-4 py-3">Marca · Modelo</th>
                <th className="text-left font-semibold px-4 py-3">Cliente · Factura</th>
                <th className="text-right font-semibold px-4 py-3">Valor FNE</th>
                <th className="text-right font-semibold px-4 py-3">Saldo</th>
                <th className="text-right font-semibold px-4 py-3">Diferencia</th>
                <th className="text-left font-semibold px-4 py-3">Tipo saldo</th>
                <th className="text-left font-semibold px-4 py-3">C.P.</th>
                <th className="text-left font-semibold px-4 py-3">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map((a, i) => (
                <tr
                  key={`${a.vin}-${i}`}
                  className={cn(
                    "border-b border-[--color-border-soft] align-top",
                    a.nivelAlerta === "doble_conteo" &&
                      "shadow-[inset_3px_0_0_var(--color-danger)]",
                    a.nivelAlerta === "inconsistente" &&
                      "shadow-[inset_3px_0_0_var(--color-warning)]",
                    a.nivelAlerta === "relevante" &&
                      "shadow-[inset_3px_0_0_var(--color-warning)]",
                  )}
                >
                  <td className="px-4 py-3">
                    <Badge
                      tone={
                        a.nivelAlerta === "doble_conteo"
                          ? "danger"
                          : a.nivelAlerta === "inconsistente" || a.nivelAlerta === "relevante"
                            ? "warning"
                            : a.nivelAlerta === "menor"
                              ? "info"
                              : "success"
                      }
                      size="xs"
                    >
                      {a.nivelAlerta === "ok"
                        ? "OK"
                        : a.nivelAlerta === "doble_conteo"
                          ? "Doble conteo"
                          : a.nivelAlerta.charAt(0).toUpperCase() + a.nivelAlerta.slice(1)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 mono text-[11px]">
                    <div>{a.vin}</div>
                    <div className="text-[--color-fg-muted]">{a.cajon ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-[12px]">
                    <div className="text-[--color-fg]">{a.marca ?? "—"}</div>
                    <div className="text-[--color-fg-muted] truncate max-w-[180px]">
                      {a.modelo ?? "—"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[12px]">
                    <div className="text-[--color-fg] truncate max-w-[200px]">
                      {a.cliente ?? "—"}
                    </div>
                    <div className="text-[--color-fg-muted] mono">
                      {a.numFactura ?? "—"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right mono text-[12px]">
                    {fmtCLP(a.valorFacturaFNE)}
                  </td>
                  <td className="px-4 py-3 text-right mono text-[12px]">
                    {fmtCLP(a.saldoXDocumentar)}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 text-right mono text-[12px]",
                      a.diferenciaPct < 0.1 ? "text-[--color-danger] font-semibold" : "text-[--color-fg-muted]",
                    )}
                  >
                    {fmtCLP(a.diferenciaAbs)}
                    <div className="text-[10px]">{fmtPct(a.diferenciaPct)}</div>
                  </td>
                  <td className="px-4 py-3 text-[11px] text-[--color-fg-muted]">
                    {a.subTipoSaldo}
                  </td>
                  <td className="px-4 py-3">
                    {a.tieneCreditoPompeyo ? (
                      <span className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded bg-[--color-danger]/10 text-[--color-danger] border border-[--color-danger]/30">
                        <AlertCircle className="size-2.5" />
                        Sí
                      </span>
                    ) : (
                      <span className="text-[--color-fg-dim] text-[11px]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-[--color-fg-muted] max-w-[260px]">
                    {a.motivo}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 100 && (
            <div className="px-4 py-3 text-[11.5px] text-[--color-fg-muted] border-t border-[--color-border-soft] bg-[--color-bg-elev-1]">
              Mostrando primeros 100 de {fmtNum(filtered.length)}.
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ── TAB: Auditoría ──────────────────────────────────────────────────────

function TabAuditoria({
  auditoria,
  cpSinVIN,
}: {
  auditoria: ReturnType<typeof auditarCalidadDatos>;
  cpSinVIN: ReturnType<typeof creditoPompeyoSinVIN>;
}) {
  const a = auditoria;
  return (
    <div className="space-y-5">
      {/* Archivos cargados */}
      <Card>
        <CardHeader>
          <CardTitle>Archivos cargados en sesión</CardTitle>
          <CardDescription>
            Lo que el sistema está leyendo ahora mismo. Si alguno falta, los KPIs cross-fuente
            son parciales.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ArchivoCard
              titulo="Stock maestro"
              cargado={a.archivosCargados.stock.cargado}
              detalle={
                a.archivosCargados.stock.cargado
                  ? `${fmtNum(a.archivosCargados.stock.vehiculos)} vehículos`
                  : "No cargado"
              }
              fecha={a.archivosCargados.stock.fechaCorte}
            />
            <ArchivoCard
              titulo="Autos no entregados"
              cargado={a.archivosCargados.fne.cargado}
              detalle={
                a.archivosCargados.fne.cargado
                  ? `${fmtNum(a.archivosCargados.fne.registros)} registros · ${a.archivosCargados.fne.archivoNombre}`
                  : "No cargado"
              }
            />
            <ArchivoCard
              titulo="Reportes Saldos"
              cargado={a.archivosCargados.saldos.cargado}
              detalle={
                a.archivosCargados.saldos.cargado
                  ? `${fmtNum(a.archivosCargados.saldos.registros)} registros · ${a.archivosCargados.saldos.archivoNombre}`
                  : "No cargado"
              }
            />
          </div>
        </CardBody>
      </Card>

      {/* Crédito Pompeyo sin VIN */}
      {cpSinVIN.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-[--color-danger]" />
              Crédito Pompeyo sin VIN identificado · {cpSinVIN.length}
            </CardTitle>
            <CardDescription>
              Saldos con Crédito Pompeyo activo que no cruzaron con un VIN. Es plata identificada
              como bloqueante pero sin auto asociado — revisar manualmente.
            </CardDescription>
          </CardHeader>
          <CardBody className="p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="text-[10.5px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1]">
                <tr>
                  <th className="text-left font-semibold px-4 py-3">Cliente</th>
                  <th className="text-left font-semibold px-4 py-3">Cajón</th>
                  <th className="text-left font-semibold px-4 py-3">Sucursal</th>
                  <th className="text-left font-semibold px-4 py-3">N° Nota</th>
                  <th className="text-right font-semibold px-4 py-3">C. Pompeyo</th>
                  <th className="text-right font-semibold px-4 py-3">Saldo total</th>
                </tr>
              </thead>
              <tbody>
                {cpSinVIN.slice(0, 50).map((s, i) => (
                  <tr key={i} className="border-b border-[--color-border-soft]">
                    <td className="px-4 py-3 text-[12px] truncate max-w-[260px]">
                      {s.cliente ?? "—"}
                    </td>
                    <td className="px-4 py-3 mono text-[11px]">{s.cajon ?? "—"}</td>
                    <td className="px-4 py-3 text-[11.5px] text-[--color-fg-muted]">
                      {s.sucursal ?? "—"}
                    </td>
                    <td className="px-4 py-3 mono text-[11px]">{s.numNota ?? "—"}</td>
                    <td className="px-4 py-3 text-right mono text-[12px] text-[--color-danger] font-semibold">
                      {fmtCLP(s.cPompeyoCLP)}
                    </td>
                    <td className="px-4 py-3 text-right mono text-[12px]">
                      {fmtCLP(s.saldoXDocumentar)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {/* VIN duplicados */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DupCard titulo="VIN duplicados en Stock" items={a.vinDuplicadosStock} />
        <DupCard titulo="VIN duplicados en FNE" items={a.vinDuplicadosFNE} />
        <DupCard titulo="Cajones ambiguos en Saldos" items={a.cajonesAmbiguos.map((c) => ({
          vinLimpio: c.cajon,
          cuenta: c.vins.length,
          fuente: "Saldos" as const,
          detalles: c.vins,
        }))} />
        <DupCard titulo="Saldos vehículo sin Cajón" items={a.saldosVehiculoSinCajon.slice(0, 50).map((s) => ({
          vinLimpio: `${s.cliente ?? "—"}`,
          cuenta: 1,
          fuente: "Saldos" as const,
          detalles: [`${s.numNota ?? "—"} · $${fmtCLP(s.saldoXDocumentar)}`],
        }))} cuenta={a.saldosVehiculoSinCajon.length} />
      </div>

      {/* VIN inválidos */}
      {a.vinsInvalidos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>VINs inválidos · {a.vinsInvalidos.length}</CardTitle>
            <CardDescription>
              Valores que no cumplen el formato VIN. No participaron en cruces.
            </CardDescription>
          </CardHeader>
          <CardBody className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10.5px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1]">
                <tr>
                  <th className="text-left font-semibold px-4 py-3">Fuente</th>
                  <th className="text-left font-semibold px-4 py-3">Valor original</th>
                  <th className="text-left font-semibold px-4 py-3">Limpio</th>
                  <th className="text-left font-semibold px-4 py-3">Problema</th>
                </tr>
              </thead>
              <tbody>
                {a.vinsInvalidos.slice(0, 30).map((iv, i) => (
                  <tr key={i} className="border-b border-[--color-border-soft]">
                    <td className="px-4 py-2 text-[11.5px]">{iv.fuente}</td>
                    <td className="px-4 py-2 mono text-[11px]">{iv.valorOriginal || "(vacío)"}</td>
                    <td className="px-4 py-2 mono text-[11px] text-[--color-fg-muted]">
                      {iv.valorLimpio}
                    </td>
                    <td className="px-4 py-2 text-[11.5px] text-[--color-fg-muted]">
                      {iv.problema}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function ArchivoCard({
  titulo,
  cargado,
  detalle,
  fecha,
}: {
  titulo: string;
  cargado: boolean;
  detalle: string;
  fecha?: Date | null;
}) {
  return (
    <div
      className={cn(
        "surface bg-white px-4 py-3 flex items-start gap-3",
        cargado ? "" : "opacity-60",
      )}
    >
      <div
        className={cn(
          "size-9 rounded-lg grid place-items-center shrink-0",
          cargado ? "bg-[--color-success-dim]" : "bg-[--color-bg-elev-2]",
        )}
      >
        {cargado ? (
          <CheckCircle2 className="size-4 text-[--color-success]" />
        ) : (
          <FileSpreadsheet className="size-4 text-[--color-fg-muted]" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-medium text-[--color-fg]">{titulo}</div>
        <div className="text-[11.5px] text-[--color-fg-muted] mt-0.5 truncate">{detalle}</div>
        {fecha && (
          <div className="text-[10.5px] text-[--color-fg-dim] mt-0.5">
            Corte: {fecha.toISOString().slice(0, 10)}
          </div>
        )}
      </div>
    </div>
  );
}

function DupCard({
  titulo,
  items,
  cuenta,
}: {
  titulo: string;
  items: { vinLimpio: string; cuenta: number; detalles: string[] }[];
  cuenta?: number;
}) {
  const total = cuenta ?? items.length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[13px]">
          {titulo} · {fmtNum(total)}
        </CardTitle>
      </CardHeader>
      <CardBody className="p-0">
        {total === 0 ? (
          <div className="px-6 py-6 text-[12px] text-[--color-fg-muted]">Sin casos.</div>
        ) : (
          <ul>
            {items.slice(0, 10).map((d, i) => (
              <li
                key={`${d.vinLimpio}-${i}`}
                className="px-4 py-2 border-t border-[--color-border-soft] text-[11.5px]"
              >
                <div className="mono text-[--color-fg]">{d.vinLimpio}</div>
                <div className="text-[--color-fg-muted]">{d.detalles.join(" · ")}</div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
