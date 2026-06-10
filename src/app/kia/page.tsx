"use client";

/**
 * KIA Operating View — primera vista operacional por marca (marca piloto).
 *
 * NO es un fork ni un sistema separado. Es el MISMO sistema con el contexto
 * inyectado: marca = "KIA MOTORS". Reutiliza:
 *   - buildVehiculosUnificados (universo cruzado por VIN)
 *   - calcularScore (motor de priorización)
 *   - computeDashboardKPIs (capital / aging)
 *   - financieras-master (validación financiera oficial)
 *   - GestionInline (gestión por VIN, MISMA llave vinLimpio que Centro de Acción
 *     → gestionar un VIN aquí se ve en macro / Dashboard / FNE / Centro)
 *
 * El filtro de marca vive en src/lib/selectors/marca-contexto.ts (única fuente
 * de "qué pertenece a KIA"). Las sucursales importan: todo es filtrable y
 * agrupable por sucursal.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertOctagon,
  Banknote,
  Building2,
  Car,
  ChevronDown,
  ChevronRight,
  CreditCard,
  ExternalLink,
  Gauge,
  Gavel,
  MapPin,
  Target,
  Truck,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterChips } from "@/components/ui/FilterChips";
import { AbrirCasoButton } from "@/components/AbrirCasoButton";
import { ScoreChip } from "@/components/ScoreBadge";
import { ComponentesBars, RazonesScore } from "@/components/RazonesScore";
import { useExcelStore } from "@/lib/store";
import { useGestionStore } from "@/lib/gestion/store";
import { cn } from "@/lib/cn";
import { fmtCLPCompact, fmtNum } from "@/lib/format";
import {
  buildVehiculosUnificados,
  FUENTE_CAPITAL_LABEL,
  type VehiculoUnificado,
} from "@/lib/selectors/vehiculo-unificado";
import { calcularScore, type ScoreVIN } from "@/lib/selectors/score";
import type { FNERealCruzado, LineaCredito } from "@/lib/types";
import { limpiarVIN } from "@/lib/parser/venta-apc";
import { computeDashboardKPIs } from "@/lib/selectors/kpis";
import {
  ESTADO_ENTREGA_LABEL,
  ESTADO_ENTREGA_TONE,
  cruzarFNEConStock,
} from "@/lib/selectors/fne-real";
import { validarFinanciera } from "@/lib/selectors/financieras-master";
import {
  OWNER_KIA,
  SIN_SUCURSAL as SIN_SUC,
  filtrarLineasOwner,
  filtrarVehiculosPorOwner,
  marcaGlosaEsOwner,
  ownerPorSucursal,
  vinsPorOwner,
} from "@/lib/selectors/marca-contexto";

const maxAging = (vu: VehiculoUnificado) =>
  Math.max(vu.fneDiasFactura ?? 0, vu.diasStock ?? 0, vu.fneDiasEnEstado ?? 0, vu.diasTescar ?? 0);

interface Scored {
  vu: VehiculoUnificado;
  score: ScoreVIN;
}

type KiaTab = "resumen" | "centro" | "sucursales" | "lineas" | "fne";

// ─────────────────────────────────────────────────────────────────────────

export default function KiaPage() {
  const { data } = useExcelStore();
  useEffect(() => {
    useGestionStore.getState().hydrate();
  }, []);

  if (!data) {
    return (
      <div className="max-w-3xl mx-auto px-10 py-16 fade-in">
        <Card variant="glass">
          <CardBody className="p-10">
            <EmptyState
              icon={<Car className="size-7" />}
              title="KIA Operating View"
              description="Vista operacional de la marca piloto. Carga primero el Excel maestro de stock para ver el sistema contextualizado a KIA."
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
  return <KiaInner />;
}

function KiaInner() {
  const store = useExcelStore();
  // KiaInner solo se monta cuando data existe (ver KiaPage).
  const data = store.data!;
  const { fne, saldos } = store;
  const [tab, setTab] = useState<KiaTab>("resumen");
  const [sucursales, setSucursales] = useState<string[]>([]);

  // Universo cruzado completo.
  const universo = useMemo(
    () => buildVehiculosUnificados({ data, fne, saldos }),
    [data, fne, saldos],
  );

  // OWNER OPERACIONAL = KIA MOTORS. Se resuelve desde Base_Stock (marcaOriginadora,
  // VPP, usados, renting…) — NO desde la marca física del vehículo. El set de
  // vinLimpio es el puente para filtrar el universo unificado.
  const ownerVins = useMemo(() => vinsPorOwner(data.vehiculos, OWNER_KIA), [data.vehiculos]);
  const vusKiaAll = useMemo(
    () => [...universo.values()].filter((vu) => ownerVins.has(vu.vinLimpio)),
    [universo, ownerVins],
  );

  // Opciones de sucursal (sobre activos KIA).
  const sucursalOpts = useMemo(() => {
    const m = new Map<string, number>();
    for (const vu of vusKiaAll) {
      if (!vu.esOperacionalActivo) continue;
      const s = vu.sucursal ?? SIN_SUC;
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  }, [vusKiaAll]);

  const sucActivo = (s: string | null) =>
    sucursales.length === 0 || sucursales.includes(s ?? SIN_SUC);

  // KIA contextualizado por sucursal.
  const vusKia = useMemo(() => vusKiaAll.filter((vu) => sucActivo(vu.sucursal)), [vusKiaAll, sucursales]); // eslint-disable-line react-hooks/exhaustive-deps
  const activosKia = useMemo(() => vusKia.filter((vu) => vu.esOperacionalActivo), [vusKia]);
  const conScore = useMemo<Scored[]>(
    () => activosKia.map((vu) => ({ vu, score: calcularScore(vu) })).filter((x) => x.score.total > 0),
    [activosKia],
  );

  // Vehículos owner KIA (Base_Stock).
  const vehKia = useMemo(() => {
    const base = filtrarVehiculosPorOwner(data.vehiculos, OWNER_KIA);
    return base.filter((v) => sucActivo(v.sucursal));
  }, [data.vehiculos, sucursales]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── SEPARACIÓN CONTABLE BÁSICA ──
  // STOCK KIA retail  = autos nuevos KIA retail (NO VU/BU recibidos).
  // CAPITAL PUENTE KIA = VU/BU recibidos en parte de pago por operaciones KIA.
  // El capital puente NO es stock nuevo → no infla unidades/$/aging/línea de stock.
  const stockKiaRetail = useMemo(() => vehKia.filter((v) => !v.esVPPComprometido), [vehKia]);
  const capitalPuenteKia = useMemo(() => vehKia.filter((v) => v.esVPPComprometido), [vehKia]);

  // KPIs de STOCK (solo retail) — reutiliza el selector macro. Valores en costo neto.
  const kpisStock = useMemo(() => computeDashboardKPIs(stockKiaRetail), [stockKiaRetail]);
  const puente = useMemo(
    () => ({
      unidades: capitalPuenteKia.length,
      capital: capitalPuenteKia.reduce((s, v) => s + (v.costoNeto || 0), 0),
    }),
    [capitalPuenteKia],
  );

  // Línea de crédito KIA.
  const lineasKia = useMemo(() => filtrarLineasOwner(data.lineas, OWNER_KIA), [data.lineas]);

  // ── FNE KIA · owner por SUCURSAL de venta (no por VIN en Base_Stock) ──
  // Una operación FNE pertenece a KIA si su sucursal es marca-específica KIA.
  // Antes se gateaba por VIN en stock activo y se perdían ~3/4 de los casos.
  const fneCruz = useMemo<FNERealCruzado[]>(
    () => (fne ? cruzarFNEConStock(fne.registros, data.vehiculos, data.vinsExtra ?? null) : []),
    [fne, data],
  );
  const fneKia = useMemo(
    () => fneCruz.filter((c) => ownerPorSucursal(c.fne.sucursal) === OWNER_KIA),
    [fneCruz],
  );
  const fneStats = useMemo(() => {
    const listos = fneKia.filter((c) => c.listoParaEntregar).length;
    return {
      unidades: fneKia.length,
      valor: fneKia.reduce((s, c) => s + c.fne.valorFactura, 0),
      listos,
      bloqueados: fneKia.length - listos,
    };
  }, [fneKia]);

  // ── SALDOS KIA · desde registros (vehículo por marca, bonos por sucursal) ──
  // El universo unificado solo trae saldos-vehículo que cruzan stock activo;
  // por eso se computa directo de saldos.registros. Servicios EXCLUIDOS.
  const saldosKia = useMemo(() => {
    const out = { cliente: 0, clienteSinCP: 0, cp: 0, judicial: 0, bonos: 0, servicios: 0, nVeh: 0 };
    if (!saldos) return out;
    for (const r of saldos.registros) {
      if (r.categoria === "vehiculo" && marcaGlosaEsOwner(r.marca, OWNER_KIA)) {
        out.cliente += r.saldoXDocumentar;
        out.nVeh++;
        if (r.subTipo === "credito_pompeyo") out.cp += r.saldoXDocumentar;
        if (r.subTipo === "judicial") out.judicial += r.saldoXDocumentar;
      } else if (r.categoria === "bono_comision") {
        if (ownerPorSucursal(r.sucursal) === OWNER_KIA) out.bonos += r.saldoXDocumentar;
      } else if (r.categoria === "servicio") {
        if (marcaGlosaEsOwner(r.marca, OWNER_KIA) || ownerPorSucursal(r.sucursal) === OWNER_KIA)
          out.servicios += r.saldoXDocumentar;
      }
    }
    out.clienteSinCP = out.cliente - out.cp;
    return out;
  }, [saldos]);

  // ── PROVISIONES KIA · desde registros (origen = marca, saldo pendiente) ──
  // Misma regla que el módulo Provisiones: solo área "ventas" con saldo > 0.
  // Excluye postventa y ajustes contables negativos.
  const provKia = useMemo(() => {
    const prov = store.provisiones;
    if (!prov) return { saldo: 0, n: 0 };
    let saldo = 0;
    let n = 0;
    for (const r of prov.registros) {
      if (r.area !== "ventas" || r.saldo <= 0) continue;
      if (!marcaGlosaEsOwner(r.origen, OWNER_KIA)) continue;
      saldo += r.saldo;
      n++;
    }
    return { saldo, n };
  }, [store.provisiones]);

  const enLineaKia = useMemo(() => stockKiaRetail.filter((v) => v.enLinea).length, [stockKiaRetail]);
  const cajaAtrapadaKia = useMemo(
    () => activosKia.reduce((s, vu) => s + vu.capitalComprometido, 0),
    [activosKia],
  );

  // ── CAPITAL DE TRABAJO KIA = caja realmente utilizada por KIA ──
  const capitalTrabajo = useMemo(() => {
    const stockPagado = kpisStock.capitalPagado;
    return {
      stockPagado,
      fne: fneStats.valor,
      saldos: saldosKia.cliente,
      provisiones: provKia.saldo,
      puente: puente.capital,
      total: stockPagado + fneStats.valor + saldosKia.cliente + provKia.saldo + puente.capital,
    };
  }, [kpisStock.capitalPagado, fneStats.valor, saldosKia.cliente, provKia.saldo, puente.capital]);

  // Agregado por sucursal (sobre activos KIA) — sucursales importan muchísimo.
  const sucAgg = useMemo(() => agruparPorSucursal(activosKia), [activosKia]);

  const irASucursal = (s: string) => {
    setSucursales([s]);
    setTab("centro");
  };

  const TABS: { id: KiaTab; label: string; icon: React.ReactNode }[] = [
    { id: "resumen", label: "Resumen", icon: <Gauge className="size-4" /> },
    { id: "centro", label: "Centro de Acción", icon: <Target className="size-4" /> },
    { id: "sucursales", label: "Sucursales", icon: <Building2 className="size-4" /> },
    { id: "lineas", label: "Línea KIA", icon: <CreditCard className="size-4" /> },
    { id: "fne", label: "FNE", icon: <Truck className="size-4" /> },
  ];

  return (
    <div className="max-w-[1500px] mx-auto px-10 py-10 space-y-6 fade-in">
      {/* Header KIA Operating */}
      <div className="relative overflow-hidden rounded-3xl border border-[--color-border] bg-gradient-to-br from-[#eef2ff] via-[#f5f3ff] to-white px-10 py-8">
        <div className="absolute -top-12 -right-12 size-56 rounded-full bg-[--color-accent] opacity-[0.10] blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[--color-accent] font-semibold">
            <Car className="size-3.5" strokeWidth={2} />
            Marcas · Marca piloto operacional
          </div>
          <h1 className="text-[30px] font-semibold tracking-tight mt-2 leading-tight text-[--color-fg]">
            KIA Operating View
          </h1>
          <p className="text-[13.5px] text-[--color-fg-muted] mt-2 max-w-3xl leading-relaxed">
            El sistema completo, contextualizado a KIA. Mismos selectores, score, líneas, FNE,
            saldos y gestión — solo KIA.
            {sucursales.length > 0 && (
              <span className="text-[--color-accent] font-medium">
                {" "}
                · Filtrado a {sucursales.length === 1 ? sucursales[0] : `${sucursales.length} sucursales`}
              </span>
            )}
          </p>

          {/* KPIs cabecera — stock retail separado de capital puente */}
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3 mt-6">
            <KpiTile label="Stock KIA (uds)" valor={fmtNum(kpisStock.unidadesTotal)} />
            <KpiTile label="Stock" valor={fmtCLPCompact(kpisStock.capitalBruto)} />
            <KpiTile label="Capital puente (uds)" valor={fmtNum(puente.unidades)} tone="warning" />
            <KpiTile label="FNE" valor={fmtNum(fneStats.unidades)} tone="warning" />
            <KpiTile label="En saldos" valor={fmtCLPCompact(saldosKia.cliente)} tone="warning" />
            <KpiTile label="En línea" valor={fmtNum(enLineaKia)} />
            <KpiTile label="Bloqueados" valor={fmtNum(fneStats.bloqueados)} tone="danger" />
            <KpiTile label="Listos p/ entregar" valor={fmtNum(fneStats.listos)} tone="success" />
          </div>
        </div>
      </div>

      {/* CAPITAL DE TRABAJO KIA — caja realmente utilizada (destacado) */}
      <div className="relative overflow-hidden rounded-2xl border-2 border-[--color-danger]/40 bg-gradient-to-br from-[#fef2f2] to-white px-7 py-5">
        <div className="flex flex-col lg:flex-row lg:items-center gap-5 justify-between">
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-danger] font-bold">
              Capital de trabajo KIA · caja utilizada
            </div>
            <div className="display text-[40px] leading-none mt-1.5 text-[--color-danger]">
              {fmtCLPCompact(capitalTrabajo.total)}
            </div>
            <div className="text-[11.5px] text-[--color-fg-muted] mt-1.5">
              Stock pagado + FNE + saldos + provisiones + capital puente
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 lg:max-w-[680px] w-full">
            <CapTrabItem label="Stock pagado" valor={fmtCLPCompact(capitalTrabajo.stockPagado)} />
            <CapTrabItem label="FNE" valor={fmtCLPCompact(capitalTrabajo.fne)} />
            <CapTrabItem label="Saldos" valor={fmtCLPCompact(capitalTrabajo.saldos)} />
            <CapTrabItem label="Provisiones" valor={fmtCLPCompact(capitalTrabajo.provisiones)} />
            <CapTrabItem label="Capital puente" valor={fmtCLPCompact(capitalTrabajo.puente)} />
          </div>
        </div>
      </div>

      {/* Nota de alcance — qué significa "KIA" en esta vista */}
      <div className="flex items-start gap-2.5 rounded-xl border border-[--color-accent]/25 bg-[--color-accent]/[0.04] px-4 py-3">
        <Activity className="size-4 text-[--color-accent] mt-0.5 shrink-0" />
        <p className="text-[12px] text-[--color-fg-muted] leading-relaxed">
          Vista filtrada por <span className="font-semibold text-[--color-fg]">marca operacional: KIA MOTORS</span>{" "}
          (quién gestiona la operación), no por marca física.{" "}
          <span className="text-[--color-fg]">Stock KIA</span> = autos nuevos retail (disponible,
          preinscrito, tránsito/logística, resciliación).{" "}
          Los <span className="text-[--color-fg]">VU/BU recibidos en parte de pago</span> se muestran
          aparte como capital puente, no se suman al stock.{" "}
          <span className="text-[--color-fg]">Excluye</span> usados, seminuevos, renting, company car,
          VDR, test car en uso y otras marcas.
        </p>
      </div>

      {/* Filtro de sucursal — contextualiza TODA la vista */}
      {sucursalOpts.length > 1 && (
        <Card>
          <CardBody className="py-3.5">
            <FilterChips
              label="Sucursal"
              options={sucursalOpts}
              value={sucursales}
              onChange={setSucursales}
            />
          </CardBody>
        </Card>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium border transition",
              tab === t.id
                ? "bg-[--color-accent] border-[--color-accent] text-white shadow-sm"
                : "bg-white border-[--color-border] text-[--color-fg-muted] hover:text-[--color-fg] hover:border-[--color-border-strong]",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenido por tab */}
      {tab === "resumen" && (
        <ResumenKia
          kpis={kpisStock}
          puente={puente}
          cajaAtrapada={cajaAtrapadaKia}
          saldosKia={saldosKia}
          provKia={provKia}
          fneValor={fneStats.valor}
          lineasKia={lineasKia}
          sucAgg={sucAgg}
          onSucursal={irASucursal}
        />
      )}
      {tab === "centro" && <CentroKia conScore={conScore} />}
      {tab === "sucursales" && <SucursalesKia sucAgg={sucAgg} onPick={irASucursal} />}
      {tab === "lineas" && <LineasKia lineasKia={lineasKia} conScore={conScore} />}
      {tab === "fne" && <FneKia fneKia={fneKia} />}
    </div>
  );
}

// ── KPI tile ───────────────────────────────────────────────────────────

function KpiTile({
  label,
  valor,
  tone = "default",
}: {
  label: string;
  valor: string;
  tone?: "default" | "danger" | "warning" | "success";
}) {
  const text =
    tone === "danger"
      ? "text-[--color-danger]"
      : tone === "warning"
        ? "text-[--color-warning]"
        : tone === "success"
          ? "text-[#0f7a59]"
          : "text-[--color-fg]";
  return (
    <div className="rounded-xl border border-[--color-border] bg-white/70 backdrop-blur px-3.5 py-3">
      <div className="text-[9.5px] uppercase tracking-[0.12em] text-[--color-fg-muted] font-semibold">
        {label}
      </div>
      <div className={cn("display text-[22px] mt-1 leading-none", text)}>{valor}</div>
    </div>
  );
}

function CapTrabItem({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-lg border border-[--color-danger]/20 bg-white px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.1em] text-[--color-fg-muted] font-semibold">
        {label}
      </div>
      <div className="mono text-[14px] font-semibold mt-0.5 text-[--color-fg]">{valor}</div>
    </div>
  );
}

// ── Agregación por sucursal ──────────────────────────────────────────────

interface SucAgg {
  sucursal: string;
  unidades: number;
  capital: number;
  agingProm: number;
  mas90: number;
  fne: number;
  bloqueados: number;
  listos: number;
  cp: number;
}

function agruparPorSucursal(activos: VehiculoUnificado[]): SucAgg[] {
  const m = new Map<
    string,
    { unidades: number; capital: number; sumDias: number; conDias: number; mas90: number; fne: number; bloqueados: number; listos: number; cp: number }
  >();
  for (const vu of activos) {
    const k = vu.sucursal ?? SIN_SUC;
    const e =
      m.get(k) ??
      { unidades: 0, capital: 0, sumDias: 0, conDias: 0, mas90: 0, fne: 0, bloqueados: 0, listos: 0, cp: 0 };
    e.unidades++;
    e.capital += vu.capitalComprometido;
    const d = maxAging(vu);
    if (d > 0) {
      e.sumDias += d;
      e.conDias++;
    }
    if (d > 90) e.mas90++;
    if (vu.enFNE) {
      e.fne++;
      if (vu.fneEstado === "listo_para_entregar") e.listos++;
      else e.bloqueados++;
    }
    e.cp += vu.creditoPompeyo;
    m.set(k, e);
  }
  return [...m.entries()]
    .map(([sucursal, e]) => ({
      sucursal,
      unidades: e.unidades,
      capital: e.capital,
      agingProm: e.conDias > 0 ? Math.round(e.sumDias / e.conDias) : 0,
      mas90: e.mas90,
      fne: e.fne,
      bloqueados: e.bloqueados,
      listos: e.listos,
      cp: e.cp,
    }))
    .sort((a, b) => b.capital - a.capital);
}

// ── Tab: Resumen ─────────────────────────────────────────────────────────

function ResumenKia({
  kpis,
  puente,
  cajaAtrapada,
  saldosKia,
  provKia,
  fneValor,
  lineasKia,
  sucAgg,
  onSucursal,
}: {
  kpis: ReturnType<typeof computeDashboardKPIs>;
  puente: { unidades: number; capital: number };
  cajaAtrapada: number;
  saldosKia: {
    cliente: number;
    clienteSinCP: number;
    cp: number;
    judicial: number;
    bonos: number;
    servicios: number;
    nVeh: number;
  };
  provKia: { saldo: number; n: number };
  fneValor: number;
  lineasKia: LineaCredito[];
  sucAgg: SucAgg[];
  onSucursal: (s: string) => void;
}) {
  const autorizada = lineasKia.reduce((s, l) => s + l.lineaAutorizada, 0);
  const ocupada = lineasKia.reduce((s, l) => s + l.lineaOcupada, 0);
  const pct = autorizada > 0 ? ocupada / autorizada : 0;
  const topSuc = sucAgg.slice(0, 6);

  return (
    <div className="space-y-6">
      {/* Stock KIA retail (costo neto) */}
      <div>
        <SectionTitle
          title="Stock KIA retail"
          sub="Autos nuevos KIA retail (valor en costo neto). Excluye VU/BU recibidos en parte de pago."
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <DataCard
            label="Stock"
            valor={fmtCLPCompact(kpis.capitalBruto)}
            sub={`${fmtNum(kpis.unidadesTotal)} unidades · costo neto`}
            tone="info"
          />
          <DataCard label="Caja Pompeyo" valor={fmtCLPCompact(kpis.capitalCajaPompeyo)} sub={`${fmtNum(kpis.unidadesCajaPompeyo)} unidades`} />
          <DataCard label="Financiado terceros" valor={fmtCLPCompact(kpis.capitalFinanciadoTerceros)} sub={`${fmtNum(kpis.unidadesFinanciadoTerceros)} unidades`} />
          <DataCard label="Judicial" valor={fmtNum(kpis.unidadesJudicial)} sub="unidades en proceso judicial" tone="danger" />
        </div>
      </div>

      {/* Capital puente KIA — SEPARADO del stock */}
      <div>
        <SectionTitle
          title="Capital puente KIA"
          sub="Usados (VU/BU) recibidos en parte de pago por operaciones KIA. Pertenece a KIA pero NO es stock nuevo — no se suma al stock."
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <DataCard label="Usados recibidos por KIA" valor={fmtNum(puente.unidades)} sub="unidades en parte de pago" tone="warning" />
          <DataCard label="Capital puente $" valor={fmtCLPCompact(puente.capital)} sub="costo neto · separado del stock" tone="warning" />
          <DataCard label="Caja atrapada" valor={fmtCLPCompact(cajaAtrapada)} sub="capital comprometido operacional" tone="danger" />
        </div>
      </div>

      {/* Aging stock retail */}
      <div>
        <SectionTitle title="Aging del stock retail" sub="Velocidad del stock retail KIA (sin capital puente)." />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <DataCard label="Stock > 60 días" valor={fmtNum(kpis.unidadesMas60)} sub={fmtCLPCompact(kpis.capitalMas60)} tone="warning" />
          <DataCard label="Stock > 180 días" valor={fmtNum(kpis.unidadesMas180)} sub={fmtCLPCompact(kpis.capitalMas180)} tone="danger" />
          <DataCard label="Caja atrapada" valor={fmtCLPCompact(cajaAtrapada)} sub="capital comprometido operacional" tone="danger" />
          <DataCard label="Provisiones KIA" valor={fmtCLPCompact(provKia.saldo)} sub={`${fmtNum(provKia.n)} provisiones · saldo pendiente`} tone="warning" />
        </div>
      </div>

      {/* Saldos KIA — desde el reporte de saldos (no del stock) */}
      <div>
        <SectionTitle
          title="Saldos KIA"
          sub="Caja por cobrar de operaciones KIA. Vehículo por marca, bonos por sucursal. Servicios excluidos."
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <DataCard
            label="Saldo cliente (vehículo)"
            valor={fmtCLPCompact(saldosKia.cliente)}
            sub={`${fmtNum(saldosKia.nVeh)} reg · sin CP ${fmtCLPCompact(saldosKia.clienteSinCP)}`}
            tone="warning"
          />
          <DataCard label="Crédito Pompeyo" valor={fmtCLPCompact(saldosKia.cp)} sub="bloqueo financiero" tone="danger" />
          <DataCard label="Bonos / comisiones" valor={fmtCLPCompact(saldosKia.bonos)} sub="por sucursal KIA" />
          <DataCard
            label="Judicial"
            valor={fmtCLPCompact(saldosKia.judicial)}
            sub={saldosKia.servicios > 0 ? `servicios excluidos: ${fmtCLPCompact(saldosKia.servicios)}` : "separado del operacional"}
            tone="danger"
          />
        </div>
      </div>

      {/* Línea KIA + FNE + usados asociados */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-4">
        <Card>
          <CardBody className="p-5">
            <SectionTitle title="Línea KIA" sub="Tensión financiera de la marca." />
            {lineasKia.length === 0 ? (
              <div className="text-[12.5px] text-[--color-fg-muted] mt-3">
                Sin línea de crédito KIA en el informe.
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[--color-fg-muted] font-semibold">
                      Ocupación
                    </div>
                    <div className="display text-[26px] mt-0.5 text-[--color-fg]">
                      {(pct * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="text-right text-[12px] text-[--color-fg-muted]">
                    <div>
                      Ocupada{" "}
                      <span className="mono text-[--color-fg] font-semibold">
                        {fmtCLPCompact(ocupada)}
                      </span>
                    </div>
                    <div>
                      Autorizada{" "}
                      <span className="mono text-[--color-fg]">{fmtCLPCompact(autorizada)}</span>
                    </div>
                  </div>
                </div>
                <div className="h-2.5 rounded-full bg-[--color-bg-elev-3] overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      pct >= 1
                        ? "bg-[--color-danger]"
                        : pct >= 0.9
                          ? "bg-[--color-danger]"
                          : pct >= 0.8
                            ? "bg-[--color-warning]"
                            : "bg-[--color-success]",
                    )}
                    style={{ width: `${Math.min(100, pct * 100)}%` }}
                  />
                </div>
                <div className="text-[11.5px] text-[--color-fg-muted]">
                  Libre{" "}
                  <span className="mono text-[--color-fg] font-medium">
                    {fmtCLPCompact(autorizada - ocupada)}
                  </span>{" "}
                  · ver detalle en{" "}
                  <span className="text-[--color-accent]">pestaña Línea KIA</span>.
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-5">
            <SectionTitle title="Otras señales" sub="Trazabilidad financiera." />
            <div className="mt-3 space-y-2.5">
              <RowKV k="FNE valor facturado" v={fmtCLPCompact(fneValor)} />
              <RowKV
                k="Capital puente KIA"
                v={`${fmtNum(puente.unidades)} · ${fmtCLPCompact(puente.capital)}`}
                hint="VU/BU recibidos en parte de pago — separado del stock"
              />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Top sucursales */}
      <div>
        <SectionTitle title="Sucursales con más caja atrapada" sub="Dónde está detenida la plata KIA. Clic para abrir el Centro de Acción de esa sucursal." />
        <Card className="mt-3">
          <CardBody className="p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-[10.5px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1]">
                <tr>
                  <th className="text-left font-semibold px-4 py-2.5">Sucursal</th>
                  <th className="text-right font-semibold px-4 py-2.5">Unidades</th>
                  <th className="text-right font-semibold px-4 py-2.5">Caja atrapada</th>
                  <th className="text-right font-semibold px-4 py-2.5">Aging prom</th>
                  <th className="text-right font-semibold px-4 py-2.5">FNE</th>
                  <th className="text-right font-semibold px-4 py-2.5">Bloqueados</th>
                </tr>
              </thead>
              <tbody>
                {topSuc.map((s) => (
                  <tr
                    key={s.sucursal}
                    onClick={() => onSucursal(s.sucursal)}
                    className="border-b border-[--color-border-soft] last:border-0 cursor-pointer hover:bg-[--color-accent]/[0.04]"
                  >
                    <td className="px-4 py-2.5 text-[13px] font-medium text-[--color-fg]">{s.sucursal}</td>
                    <td className="px-4 py-2.5 text-right mono text-[--color-fg-muted]">{fmtNum(s.unidades)}</td>
                    <td className="px-4 py-2.5 text-right mono font-semibold">{fmtCLPCompact(s.capital)}</td>
                    <td className="px-4 py-2.5 text-right mono text-[--color-fg-muted]">{s.agingProm}d</td>
                    <td className="px-4 py-2.5 text-right mono text-[--color-fg-muted]">{fmtNum(s.fne)}</td>
                    <td className="px-4 py-2.5 text-right mono">
                      {s.bloqueados > 0 ? (
                        <span className="text-[--color-danger] font-semibold">{fmtNum(s.bloqueados)}</span>
                      ) : (
                        <span className="text-[--color-fg-dim]">—</span>
                      )}
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

// ── Tab: Centro de Acción KIA (núcleo de validación) ──────────────────────

type CentroFiltro = "todos" | "bloqueados" | "aging90" | "capital" | "cp" | "judicial";

const CENTRO_TILES: { id: CentroFiltro; label: string; icon: React.ReactNode; tone: "danger" | "warning" | "info" }[] = [
  { id: "todos", label: "Todos con score", icon: <Gauge className="size-4" />, tone: "info" },
  { id: "bloqueados", label: "FNE detenidos", icon: <AlertOctagon className="size-4" />, tone: "danger" },
  { id: "aging90", label: "Aging > 90d", icon: <Activity className="size-4" />, tone: "danger" },
  { id: "capital", label: "Capital atrapado", icon: <Banknote className="size-4" />, tone: "danger" },
  { id: "cp", label: "Crédito Pompeyo", icon: <CreditCard className="size-4" />, tone: "warning" },
  { id: "judicial", label: "Judicial", icon: <Gavel className="size-4" />, tone: "danger" },
];

const CENTRO_PRED: Record<CentroFiltro, (x: Scored) => boolean> = {
  todos: () => true,
  bloqueados: ({ vu }) => vu.enFNE && vu.fneEstado !== "listo_para_entregar",
  aging90: ({ vu }) => maxAging(vu) > 90,
  capital: ({ vu }) => vu.capitalComprometido > 0,
  cp: ({ vu }) => vu.creditoPompeyo > 0,
  judicial: ({ vu }) => vu.esJudicial,
};

function CentroKia({ conScore }: { conScore: Scored[] }) {
  const [filtro, setFiltro] = useState<CentroFiltro>("todos");
  const [openVin, setOpenVin] = useState<string | null>(null);

  const counts = useMemo(() => {
    const m = {} as Record<CentroFiltro, { n: number; cap: number }>;
    for (const t of CENTRO_TILES) {
      const items = conScore.filter(CENTRO_PRED[t.id]);
      m[t.id] = { n: items.length, cap: items.reduce((s, x) => s + x.vu.capitalComprometido, 0) };
    }
    return m;
  }, [conScore]);

  const lista = useMemo(() => {
    const items = conScore.filter(CENTRO_PRED[filtro]);
    if (filtro === "capital" || filtro === "cp") {
      return [...items].sort((a, b) => b.vu.capitalComprometido - a.vu.capitalComprometido);
    }
    if (filtro === "aging90") {
      return [...items].sort((a, b) => maxAging(b.vu) - maxAging(a.vu));
    }
    return [...items].sort((a, b) => b.score.total - a.score.total);
  }, [conScore, filtro]);

  const impacto = lista.reduce((s, x) => s + x.vu.capitalComprometido, 0);

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Centro de Acción KIA"
        sub="Donde se valida el sistema: priorización, bloqueos y gestión por VIN (la misma que el macro)."
      />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {CENTRO_TILES.map((t) => {
          const c = counts[t.id];
          const active = filtro === t.id;
          const text =
            t.tone === "danger" ? "text-[--color-danger]" : t.tone === "warning" ? "text-[--color-warning]" : "text-[--color-accent]";
          return (
            <button
              key={t.id}
              onClick={() => {
                setFiltro(t.id);
                setOpenVin(null);
              }}
              className={cn(
                "surface top-strip bg-white px-4 pt-4 pb-3.5 text-left transition flex flex-col",
                t.tone === "danger" ? "strip-danger" : t.tone === "warning" ? "strip-warning" : "strip-info",
                active ? "ring-2 ring-[--color-accent]/30 border-[--color-accent]" : "surface-hover",
              )}
            >
              <div className={cn("flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.1em] font-semibold", text)}>
                {t.icon}
                <span className="truncate">{t.label}</span>
              </div>
              <div className="display text-[22px] mt-2 leading-none text-[--color-fg]">{fmtNum(c.n)}</div>
              <div className="text-[11px] text-[--color-fg-muted] mt-1.5">
                {c.cap > 0 ? fmtCLPCompact(c.cap) : "casos"}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-[12.5px] text-[--color-fg-muted]">
          {fmtNum(lista.length)} casos · {fmtCLPCompact(impacto)} en juego
        </p>
      </div>

      {lista.length === 0 ? (
        <Card>
          <CardBody className="p-10 text-center text-[13px] text-[--color-fg-muted]">
            Sin casos KIA en este filtro.
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-2">
          {lista.slice(0, 80).map((x) => (
            <KiaVinRow
              key={x.vu.vinLimpio}
              vu={x.vu}
              score={x.score}
              open={openVin === x.vu.vinLimpio}
              onToggle={() => setOpenVin(openVin === x.vu.vinLimpio ? null : x.vu.vinLimpio)}
            />
          ))}
          {lista.length > 80 && (
            <div className="text-[11.5px] text-[--color-fg-muted] text-center mt-2">
              Mostrando primeros 80 de {fmtNum(lista.length)}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function KiaVinRow({
  vu,
  score,
  open,
  onToggle,
}: {
  vu: VehiculoUnificado;
  score: ScoreVIN;
  open: boolean;
  onToggle: () => void;
}) {
  const dias = maxAging(vu);
  return (
    <div className={cn("surface border transition", open ? "border-[--color-accent]/40" : "border-[--color-border]")}>
      <button
        onClick={onToggle}
        className="w-full text-left px-5 py-3.5 flex items-stretch gap-4 hover:bg-[--color-bg-elev-1]/40 transition"
      >
        <div className="shrink-0 w-[130px] border-r border-[--color-border-soft] pr-4">
          <div className="text-[9.5px] uppercase tracking-[0.1em] text-[--color-fg-muted] font-medium">
            Capital atrapado
          </div>
          <div className="display text-[20px] mt-1 leading-none text-[--color-fg]">
            {vu.capitalComprometido > 0 ? fmtCLPCompact(vu.capitalComprometido) : "—"}
          </div>
          <div className="text-[9.5px] text-[--color-fg-dim] mt-1 leading-snug">
            {FUENTE_CAPITAL_LABEL[vu.capitalComprometidoFuente]}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[13.5px] text-[--color-fg]">
              {vu.marca ?? "KIA"} {vu.modelo ? `· ${vu.modelo}` : ""}
            </span>
            <span className="mono text-[11px] text-[--color-fg-muted]">{vu.vinLimpio}</span>
            {vu.sucursal && <span className="text-[11px] text-[--color-fg-muted]">· {vu.sucursal}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {dias > 0 && (
              <Badge tone={dias > 90 ? "danger" : dias > 60 ? "warning" : "muted"} size="xs">
                {dias}d
              </Badge>
            )}
            {vu.enFNE && vu.fneEstado && (
              <Badge tone={ESTADO_ENTREGA_TONE[vu.fneEstado]} size="xs">
                {ESTADO_ENTREGA_LABEL[vu.fneEstado]}
              </Badge>
            )}
            {vu.creditoPompeyo > 0 && (
              <Badge tone="danger" size="xs">
                C. Pompeyo {fmtCLPCompact(vu.creditoPompeyo)}
              </Badge>
            )}
            {vu.esJudicial && <Badge tone="danger" size="xs">Judicial</Badge>}
            <GestionMini vin={vu.vinLimpio} />
          </div>
          <div className="text-[12px] text-[--color-accent] mt-1.5 font-medium">→ {score.accionSugerida}</div>
        </div>

        <div className="shrink-0 self-center flex items-center gap-3">
          <ScoreChip score={score} />
          {open ? (
            <ChevronDown className="size-4 text-[--color-fg-muted]" />
          ) : (
            <ChevronRight className="size-4 text-[--color-fg-muted]" />
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-[--color-border-soft] px-5 py-4 bg-[--color-bg-elev-1]/40 fade-in">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div>
                <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-semibold mb-2">
                  Por qué pesa
                </div>
                <RazonesScore score={score} />
              </div>
              <div>
                <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-semibold mb-2">
                  Componentes
                </div>
                <ComponentesBars score={score} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/stock?q=${encodeURIComponent(vu.vinLimpio)}&dup=1`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[--color-border] text-[11.5px] text-[--color-fg-muted] hover:text-[--color-accent] hover:border-[--color-accent]/40 transition"
                >
                  Stock Explorer <ExternalLink className="size-3" />
                </Link>
                <Link
                  href="/centro-accion"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[--color-border] text-[11.5px] text-[--color-fg-muted] hover:text-[--color-accent] hover:border-[--color-accent]/40 transition"
                >
                  Centro de Acción macro <ExternalLink className="size-3" />
                </Link>
              </div>
            </div>
            <div className="rounded-2xl border border-[--color-border] bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="size-4 text-[--color-accent]" />
                <span className="text-[12px] font-semibold text-[--color-fg]">
                  Gestión del caso · global por VIN
                </span>
              </div>
              <AbrirCasoButton vin={vu.vinLimpio} origen="KIA Operating View" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GestionMini({ vin }: { vin: string }) {
  const gestion = useGestionStore((s) => s.byVin[vin]);
  if (!gestion) return null;
  const tieneNota = !!(
    gestion.comentario ||
    gestion.proximaAccion ||
    gestion.responsable ||
    gestion.fechaCompromiso ||
    gestion.prioridadManual
  );
  if (!tieneNota) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[--color-accent]/8 border border-[--color-accent]/25 text-[10.5px] text-[--color-fg-muted]">
      {gestion.responsable ?? "En gestión"}
    </span>
  );
}

// ── Tab: Sucursales ──────────────────────────────────────────────────────

function SucursalesKia({ sucAgg, onPick }: { sucAgg: SucAgg[]; onPick: (s: string) => void }) {
  if (sucAgg.length === 0) {
    return (
      <Card>
        <CardBody className="p-10 text-center text-[13px] text-[--color-fg-muted]">
          Sin sucursales con actividad KIA.
        </CardBody>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <SectionTitle
        title="Ranking de sucursales KIA"
        sub="Dentro de KIA, las sucursales importan muchísimo. Clic para abrir el Centro de Acción de la sucursal."
      />
      <Card>
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead className="text-[10.5px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1]">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Sucursal</th>
                <th className="text-right font-semibold px-4 py-2.5">Unidades</th>
                <th className="text-right font-semibold px-4 py-2.5">Caja atrapada</th>
                <th className="text-right font-semibold px-4 py-2.5">Aging prom</th>
                <th className="text-right font-semibold px-4 py-2.5">&gt; 90d</th>
                <th className="text-right font-semibold px-4 py-2.5">FNE</th>
                <th className="text-right font-semibold px-4 py-2.5">Bloqueados</th>
                <th className="text-right font-semibold px-4 py-2.5">Listos</th>
                <th className="text-right font-semibold px-4 py-2.5">C. Pompeyo</th>
              </tr>
            </thead>
            <tbody>
              {sucAgg.map((s) => (
                <tr
                  key={s.sucursal}
                  onClick={() => onPick(s.sucursal)}
                  className="border-b border-[--color-border-soft] last:border-0 cursor-pointer hover:bg-[--color-accent]/[0.04]"
                >
                  <td className="px-4 py-2.5 text-[13px] font-medium text-[--color-fg]">
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="size-3.5 text-[--color-fg-dim]" />
                      {s.sucursal}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right mono text-[--color-fg-muted]">{fmtNum(s.unidades)}</td>
                  <td className="px-4 py-2.5 text-right mono font-semibold">{fmtCLPCompact(s.capital)}</td>
                  <td className="px-4 py-2.5 text-right mono">
                    <span className={cn(s.agingProm > 90 ? "text-[--color-danger]" : s.agingProm > 60 ? "text-[--color-warning]" : "text-[--color-fg-muted]")}>
                      {s.agingProm}d
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right mono text-[--color-fg-muted]">{fmtNum(s.mas90)}</td>
                  <td className="px-4 py-2.5 text-right mono text-[--color-fg-muted]">{fmtNum(s.fne)}</td>
                  <td className="px-4 py-2.5 text-right mono">
                    {s.bloqueados > 0 ? (
                      <span className="text-[--color-danger] font-semibold">{fmtNum(s.bloqueados)}</span>
                    ) : (
                      <span className="text-[--color-fg-dim]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right mono">
                    {s.listos > 0 ? (
                      <span className="text-[#0f7a59] font-semibold">{fmtNum(s.listos)}</span>
                    ) : (
                      <span className="text-[--color-fg-dim]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right mono text-[--color-fg-muted]">
                    {s.cp > 0 ? fmtCLPCompact(s.cp) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}

// ── Tab: Línea KIA ───────────────────────────────────────────────────────

function LineasKia({
  lineasKia,
  conScore,
}: {
  lineasKia: LineaCredito[];
  conScore: Scored[];
}) {
  const autorizada = lineasKia.reduce((s, l) => s + l.lineaAutorizada, 0);
  const ocupada = lineasKia.reduce((s, l) => s + l.lineaOcupada, 0);
  const libre = autorizada - ocupada;
  const sobregiro = ocupada > autorizada ? ocupada - autorizada : 0;
  const pct = autorizada > 0 ? ocupada / autorizada : 0;
  const val = lineasKia.length > 0 ? validarFinanciera(lineasKia[0].marca, lineasKia[0].financiera, lineasKia[0].marcaPompeyo) : null;

  // VINs KIA que consumen línea (en saldos/FNE/stock financiado).
  const enLinea = conScore
    .filter(({ vu }) => vu.capitalComprometido > 0)
    .sort((a, b) => b.vu.capitalComprometido - a.vu.capitalComprometido)
    .slice(0, 40);

  return (
    <div className="space-y-5">
      <SectionTitle title="Línea de financiamiento KIA" sub="Financiera oficial, tensión y descarga pendiente." />

      {lineasKia.length === 0 ? (
        <Card>
          <CardBody className="p-10 text-center text-[13px] text-[--color-fg-muted]">
            Sin línea de crédito KIA en el informe cargado.
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <DataCard label="Autorizada" valor={fmtCLPCompact(autorizada)} sub="cupo total KIA" />
            <DataCard label="Utilizada" valor={fmtCLPCompact(ocupada)} sub={`${(pct * 100).toFixed(1)}% ocupación`} tone={pct >= 0.9 ? "danger" : pct >= 0.8 ? "warning" : "default"} />
            <DataCard label="Libre" valor={fmtCLPCompact(libre)} sub={libre < 0 ? "sobregiro" : "disponible"} tone={libre < 0 ? "danger" : "success"} />
            <DataCard label="Sobregiro" valor={sobregiro > 0 ? fmtCLPCompact(sobregiro) : "—"} sub="sobre el cupo" tone={sobregiro > 0 ? "danger" : "default"} />
          </div>

          <Card>
            <CardBody className="p-5 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-[12px] text-[--color-fg-muted]">
                  Financiera oficial:{" "}
                  <span className="font-semibold text-[--color-fg]">
                    {val?.financieraOficial ?? "En conciliación"}
                  </span>
                </div>
                {val && (
                  <Badge
                    tone={val.estado === "validado" ? "success" : val.estado === "diferencia" ? "danger" : "warning"}
                    size="xs"
                  >
                    {val.estado === "validado" ? "Validada vs maestro" : val.estado === "diferencia" ? "Diferencia con sistema" : "En conciliación"}
                  </Badge>
                )}
              </div>
              {val && <div className="text-[11.5px] text-[--color-fg-muted]">{val.mensaje}</div>}
              <div className="h-2.5 rounded-full bg-[--color-bg-elev-3] overflow-hidden">
                <div
                  className={cn("h-full rounded-full", pct >= 0.9 ? "bg-[--color-danger]" : pct >= 0.8 ? "bg-[--color-warning]" : "bg-[--color-success]")}
                  style={{ width: `${Math.min(100, pct * 100)}%` }}
                />
              </div>
            </CardBody>
          </Card>
        </>
      )}

      <div>
        <SectionTitle title="Capital KIA por descargar" sub="VINs que consumen caja — drilldown con gestión." />
        <div className="space-y-2 mt-3">
          {enLinea.length === 0 ? (
            <Card>
              <CardBody className="p-8 text-center text-[12.5px] text-[--color-fg-muted]">
                Sin capital KIA comprometido detectado.
              </CardBody>
            </Card>
          ) : (
            enLinea.map((x) => <LineaVinRow key={x.vu.vinLimpio} vu={x.vu} score={x.score} />)
          )}
        </div>
      </div>
    </div>
  );
}

function LineaVinRow({ vu, score }: { vu: VehiculoUnificado; score: ScoreVIN }) {
  const [open, setOpen] = useState(false);
  const dias = maxAging(vu);
  return (
    <div className="surface border border-[--color-border]">
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left px-4 py-3 flex items-center gap-4 hover:bg-[--color-bg-elev-1]/40 transition">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-[13px] text-[--color-fg]">
              {vu.marca ?? "KIA"} {vu.modelo ? `· ${vu.modelo}` : ""}
            </span>
            <span className="mono text-[11px] text-[--color-fg-muted]">{vu.vinLimpio}</span>
            {vu.sucursal && <span className="text-[11px] text-[--color-fg-muted]">· {vu.sucursal}</span>}
            {dias > 0 && (
              <Badge tone={dias > 90 ? "danger" : dias > 60 ? "warning" : "muted"} size="xs">
                {dias}d
              </Badge>
            )}
            <GestionMini vin={vu.vinLimpio} />
          </div>
        </div>
        <div className="shrink-0 mono text-[13px] font-semibold text-[--color-fg]">
          {fmtCLPCompact(vu.capitalComprometido)}
        </div>
        <ScoreChip score={score} />
        {open ? <ChevronDown className="size-4 text-[--color-fg-muted]" /> : <ChevronRight className="size-4 text-[--color-fg-muted]" />}
      </button>
      {open && (
        <div className="border-t border-[--color-border-soft] px-4 py-3 bg-[--color-bg-elev-1]/40">
          <div className="max-w-[640px]">
            <AbrirCasoButton vin={vu.vinLimpio} origen="KIA Operating View" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: FNE KIA ─────────────────────────────────────────────────────────

function FneKia({ fneKia }: { fneKia: FNERealCruzado[] }) {
  const porEstado = useMemo(() => {
    const m = new Map<string, { n: number; valor: number; dias: number; conDias: number }>();
    for (const c of fneKia) {
      const k = c.estadoEntrega;
      const e = m.get(k) ?? { n: 0, valor: 0, dias: 0, conDias: 0 };
      e.n++;
      e.valor += c.fne.valorFactura;
      const d = c.diasEnEstado ?? 0;
      if (d > 0) {
        e.dias += d;
        e.conDias++;
      }
      m.set(k, e);
    }
    return [...m.entries()]
      .map(([estado, e]) => ({
        estado: estado as keyof typeof ESTADO_ENTREGA_LABEL,
        n: e.n,
        valor: e.valor,
        agingProm: e.conDias > 0 ? Math.round(e.dias / e.conDias) : 0,
      }))
      .sort((a, b) => b.n - a.n);
  }, [fneKia]);

  const [open, setOpen] = useState<string | null>(null);
  const listos = fneKia.filter((c) => c.listoParaEntregar).length;
  const valorTot = fneKia.reduce((s, c) => s + c.fne.valorFactura, 0);

  if (fneKia.length === 0) {
    return (
      <Card>
        <CardBody className="p-10 text-center text-[13px] text-[--color-fg-muted]">
          Sin facturados no entregados KIA. (Carga el archivo de FNE si falta.)
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Facturados no entregados KIA"
        sub={`${fmtNum(fneKia.length)} operaciones · ${fmtCLPCompact(valorTot)} · ${fmtNum(listos)} listas para entregar. Atribución por sucursal de venta KIA.`}
      />

      <Card>
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-[10.5px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1]">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Estado</th>
                <th className="text-right font-semibold px-4 py-2.5">Operaciones</th>
                <th className="text-right font-semibold px-4 py-2.5">Valor</th>
                <th className="text-right font-semibold px-4 py-2.5">Días prom en estado</th>
              </tr>
            </thead>
            <tbody>
              {porEstado.map((e) => (
                <tr key={e.estado} className="border-b border-[--color-border-soft] last:border-0">
                  <td className="px-4 py-2.5">
                    <Badge tone={ESTADO_ENTREGA_TONE[e.estado]} size="xs">
                      {ESTADO_ENTREGA_LABEL[e.estado]}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right mono font-semibold">{fmtNum(e.n)}</td>
                  <td className="px-4 py-2.5 text-right mono text-[--color-fg-muted]">{fmtCLPCompact(e.valor)}</td>
                  <td className="px-4 py-2.5 text-right mono">
                    <span className={cn(e.agingProm > 15 ? "text-[--color-danger]" : e.agingProm > 7 ? "text-[--color-warning]" : "text-[--color-fg-muted]")}>
                      {e.agingProm}d
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <div>
        <SectionTitle title="Detalle FNE KIA" sub="Drilldown con gestión por VIN." />
        <div className="space-y-2 mt-3">
          {[...fneKia]
            .sort((a, b) => (b.diasEnEstado ?? 0) - (a.diasEnEstado ?? 0))
            .slice(0, 80)
            .map((c) => {
              const vin = limpiarVIN(c.fne.vin);
              const marca = c.vehiculo?.marca ?? c.vehiculoExtra?.marca ?? "KIA";
              const modelo = c.vehiculo?.modelo ?? c.vehiculoExtra?.modelo ?? null;
              return (
                <div key={`${vin}-${c.fne.rowIndex}`} className="surface border border-[--color-border]">
                  <button
                    onClick={() => setOpen(open === vin ? null : vin)}
                    className="w-full text-left px-4 py-3 flex items-center gap-4 hover:bg-[--color-bg-elev-1]/40 transition"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-[13px] text-[--color-fg]">
                          {marca} {modelo ? `· ${modelo}` : ""}
                        </span>
                        <span className="mono text-[11px] text-[--color-fg-muted]">{vin}</span>
                        {c.fne.sucursal && <span className="text-[11px] text-[--color-fg-muted]">· {c.fne.sucursal}</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <Badge tone={ESTADO_ENTREGA_TONE[c.estadoEntrega]} size="xs">
                          {ESTADO_ENTREGA_LABEL[c.estadoEntrega]}
                        </Badge>
                        {(c.diasEnEstado ?? 0) > 0 && (
                          <span className="text-[11px] text-[--color-fg-muted]">{c.diasEnEstado}d en estado</span>
                        )}
                        <GestionMini vin={vin} />
                      </div>
                    </div>
                    <div className="shrink-0 mono text-[13px] font-semibold text-[--color-fg]">
                      {fmtCLPCompact(c.fne.valorFactura)}
                    </div>
                    {open === vin ? (
                      <ChevronDown className="size-4 text-[--color-fg-muted]" />
                    ) : (
                      <ChevronRight className="size-4 text-[--color-fg-muted]" />
                    )}
                  </button>
                  {open === vin && (
                    <div className="border-t border-[--color-border-soft] px-4 py-3 bg-[--color-bg-elev-1]/40">
                      <div className="max-w-[640px]">
                        <AbrirCasoButton vin={vin} origen="KIA Operating View" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

// ── Primitivas de presentación ───────────────────────────────────────────

function SectionTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h2 className="text-[16px] font-semibold tracking-tight text-[--color-fg]">{title}</h2>
      <p className="text-[12.5px] text-[--color-fg-muted] mt-0.5">{sub}</p>
    </div>
  );
}

function DataCard({
  label,
  valor,
  sub,
  tone = "default",
}: {
  label: string;
  valor: string;
  sub?: string;
  tone?: "default" | "danger" | "warning" | "info" | "success";
}) {
  const text =
    tone === "danger"
      ? "text-[--color-danger]"
      : tone === "warning"
        ? "text-[--color-warning]"
        : tone === "info"
          ? "text-[--color-info]"
          : tone === "success"
            ? "text-[#0f7a59]"
            : "text-[--color-fg]";
  return (
    <div className="surface bg-white px-4 py-3.5">
      <div className="text-[10px] uppercase tracking-[0.1em] text-[--color-fg-muted] font-semibold">
        {label}
      </div>
      <div className={cn("display text-[22px] mt-1 leading-none", text)}>{valor}</div>
      {sub && <div className="text-[11px] text-[--color-fg-dim] mt-1.5 leading-snug">{sub}</div>}
    </div>
  );
}

function RowKV({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[--color-border-soft] last:border-0 pb-2 last:pb-0">
      <div className="min-w-0">
        <div className="text-[12.5px] text-[--color-fg]">{k}</div>
        {hint && <div className="text-[10.5px] text-[--color-fg-dim] mt-0.5 leading-snug">{hint}</div>}
      </div>
      <div className="mono text-[12.5px] font-semibold text-[--color-fg] shrink-0">{v}</div>
    </div>
  );
}
