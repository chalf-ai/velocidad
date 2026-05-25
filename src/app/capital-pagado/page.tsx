"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Clock,
  Coins,
  Flame,
  Gavel,
  Layers,
  Snowflake,
  TestTube2,
  TrendingDown,
  Zap,
} from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { useDatosFiltrados } from "@/lib/marca-filtro";
import { useVinContexto, VinContextoBanner } from "@/components/VinContexto";
import { useGestionStore } from "@/lib/gestion/store";
import { VinDrillTable } from "@/components/VinDrillTable";
import { esJudicial, segmentoCaja, type SegCajaKey } from "@/lib/selectors/segmentos-caja";
import { getMarcaOperacional } from "@/lib/selectors/owner-operacional";
import { fmtCLP, fmtCLPCompact, fmtNum, fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Vehiculo } from "@/lib/types";

const SEG_ORDER: SegCajaKey[] = ["rotacion", "puente", "tescar", "stockB"];

const SEG_META: Record<
  SegCajaKey,
  { label: string; desc: string; strip: string; text: string; iconBg: string; icon: React.ReactNode }
> = {
  rotacion: {
    label: "En rotación comercial",
    desc: "Unidades en venta normal — caja que rota vendiendo.",
    strip: "strip-operativo",
    text: "text-[--color-accent]",
    iconBg: "bg-[--color-accent]/10",
    icon: <Zap className="size-3.5" strokeWidth={1.75} />,
  },
  puente: {
    label: "Capital puente",
    desc: "Usados en parte de pago + en preparación, asociados a una operación nueva.",
    strip: "strip-teal",
    text: "text-[#0d9488]",
    iconBg: "bg-[#0d9488]/10",
    icon: <Layers className="size-3.5" strokeWidth={1.75} />,
  },
  tescar: {
    label: "Demo / TESCAR",
    desc: "Unidades en uso comercial demo — no están a la venta directa.",
    strip: "strip-violet",
    text: "text-[#7c3aed]",
    iconBg: "bg-[#7c3aed]/10",
    icon: <TestTube2 className="size-3.5" strokeWidth={1.75} />,
  },
  stockB: {
    label: "Stock B",
    desc: "Segunda categoría / pendiente de reacondicionamiento.",
    strip: "strip-warning",
    text: "text-[--color-warning]",
    iconBg: "bg-[--color-warning]/12",
    icon: <AlertTriangle className="size-3.5" strokeWidth={1.75} />,
  },
};

const AGING_BUCKETS: { key: string; label: string; lo: number; hi: number; fill: string; text: string }[] = [
  { key: "0-30", label: "0-30 días", lo: 0, hi: 30, fill: "#15a87b", text: "text-[--color-success]" },
  { key: "30-60", label: "30-60 días", lo: 30, hi: 60, fill: "#84cc16", text: "text-[#5f8c0b]" },
  { key: "60-90", label: "60-90 días", lo: 60, hi: 90, fill: "#d97706", text: "text-[--color-warning]" },
  { key: "90-180", label: "90-180 días", lo: 90, hi: 180, fill: "#ea580c", text: "text-[#ea580c]" },
  { key: "180+", label: ">180 días", lo: 180, hi: Infinity, fill: "#dc2626", text: "text-[--color-danger]" },
];

function bucketKey(dias: number): string {
  for (const b of AGING_BUCKETS) if (dias >= b.lo && dias < b.hi) return b.key;
  return "180+";
}

const sortAgingMonto = (a: Vehiculo, b: Vehiculo) => {
  const da = a.diasStock ?? 0;
  const db = b.diasStock ?? 0;
  if (db !== da) return db - da;
  return (b.costoNeto || 0) - (a.costoNeto || 0);
};

function topMarcasDe(vins: Vehiculo[], n = 3): string[] {
  // Marca operacional: marcas ajenas al grupo → OTRAS MARCAS, USADOS separado.
  const m = new Map<string, number>();
  for (const v of vins) {
    const k = getMarcaOperacional(v);
    m.set(k, (m.get(k) ?? 0) + (v.costoNeto || 0));
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

function agingPromDe(vins: Vehiculo[]): number {
  const con = vins.filter((v) => v.diasStock != null);
  return con.length > 0
    ? Math.round(con.reduce((s, v) => s + (v.diasStock ?? 0), 0) / con.length)
    : 0;
}

const cap = (vins: Vehiculo[]) => vins.reduce((s, v) => s + (v.costoNeto || 0), 0);

export default function CapitalPagadoPage() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-[--color-fg-muted]">Cargando…</div>}>
      <CapitalPagadoContent />
    </Suspense>
  );
}

function CapitalPagadoContent() {
  const { data } = useDatosFiltrados();
  const vinCtx = useVinContexto();
  useEffect(() => {
    useGestionStore.getState().hydrate();
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const seen = new Set<string>();
    const pagados: Vehiculo[] = [];
    for (const v of data.vehiculos) {
      if (!v.pagado) continue;
      if (seen.has(v.vin)) continue;
      seen.add(v.vin);
      pagados.push(v);
    }

    const judiciales = pagados.filter(esJudicial).sort(sortAgingMonto);
    const operacionales = pagados.filter((v) => !esJudicial(v));
    const capOperacional = cap(operacionales);
    const capJudicial = cap(judiciales);

    // Estados de recuperación (sin judicial)
    const rapidaV: Vehiculo[] = [];
    const lentaV: Vehiculo[] = [];
    const congeladaV: Vehiculo[] = [];
    const bucketMap: Record<string, Vehiculo[]> = {
      "0-30": [], "30-60": [], "60-90": [], "90-180": [], "180+": [],
    };
    const segMap: Record<SegCajaKey, Vehiculo[]> = {
      rotacion: [], puente: [], tescar: [], stockB: [],
    };
    const marcaMap = new Map<string, Vehiculo[]>();

    for (const v of operacionales) {
      const dias = v.diasStock ?? 0;
      bucketMap[bucketKey(dias)].push(v);
      segMap[segmentoCaja(v)].push(v);
      if (dias >= 180) congeladaV.push(v);
      else if (dias >= 60) lentaV.push(v);
      else rapidaV.push(v);
      const k = getMarcaOperacional(v);
      if (!marcaMap.has(k)) marcaMap.set(k, []);
      marcaMap.get(k)!.push(v);
    }

    const estado = (vins: Vehiculo[]) => ({
      vins: [...vins].sort(sortAgingMonto),
      u: vins.length,
      c: cap(vins),
      top: topMarcasDe(vins, 2),
    });

    const buckets = AGING_BUCKETS.map((b) => {
      const vins = [...bucketMap[b.key]].sort(sortAgingMonto);
      return { ...b, vins, unidades: vins.length, capital: cap(vins) };
    });
    const maxBucketCap = Math.max(...buckets.map((b) => b.capital), 1);

    const segmentos = SEG_ORDER.map((k) => {
      const vins = [...segMap[k]].sort(sortAgingMonto);
      const agingProm = agingPromDe(vins);
      return {
        key: k,
        vins,
        unidades: vins.length,
        capital: cap(vins),
        agingProm,
        mas180: vins.filter((v) => (v.diasStock ?? 0) >= 180).length,
        topMarcas: topMarcasDe(vins, 3),
      };
    });

    const peoresMarcas = [...marcaMap.entries()]
      .map(([marca, vins]) => ({
        marca,
        vins: [...vins].sort(sortAgingMonto),
        unidades: vins.length,
        capital: cap(vins),
        agingProm: agingPromDe(vins),
        congeladoCap: cap(vins.filter((v) => (v.diasStock ?? 0) >= 180)),
      }))
      .filter((m) => m.unidades >= 2)
      .sort((a, b) => b.agingProm - a.agingProm)
      .slice(0, 6);

    const destructores = operacionales
      .filter((v) => (v.diasStock ?? 0) >= 90)
      .sort((a, b) => (b.costoNeto || 0) - (a.costoNeto || 0))
      .slice(0, 12);

    const congeladoCap = cap(congeladaV);

    return {
      totalU: pagados.length,
      capOperacional,
      operacionalesU: operacionales.length,
      capJudicial,
      judiciales,
      judAgingProm: agingPromDe(judiciales),
      judMas180: judiciales.filter((v) => (v.diasStock ?? 0) >= 180).length,
      judTopMarcas: topMarcasDe(judiciales, 3),
      rapida: estado(rapidaV),
      lenta: estado(lentaV),
      congelada: estado(congeladaV),
      congeladoCap,
      buckets,
      maxBucketCap,
      segmentos,
      peoresMarcas,
      destructores,
    };
  }, [data]);

  // Drills por sección (abren abajo, no modal)
  const [drillA, setDrillA] = useState<{ titulo: string; vins: Vehiculo[] } | null>(null);
  const [drillB, setDrillB] = useState<{ titulo: string; vins: Vehiculo[] } | null>(null);
  const [drillC, setDrillC] = useState<{ titulo: string; vins: Vehiculo[] } | null>(null);
  const [riesgoAbierto, setRiesgoAbierto] = useState(false);
  const [judAbierto, setJudAbierto] = useState(false);

  const toggleA = (titulo: string, vins: Vehiculo[]) =>
    setDrillA((c) => (c && c.titulo === titulo ? null : { titulo, vins }));
  const toggleB = (titulo: string, vins: Vehiculo[]) =>
    setDrillB((c) => (c && c.titulo === titulo ? null : { titulo, vins }));
  const toggleC = (titulo: string, vins: Vehiculo[]) =>
    setDrillC((c) => (c && c.titulo === titulo ? null : { titulo, vins }));

  if (!data || !view) {
    return (
      <div className="p-10 max-w-3xl mx-auto fade-in">
        <Card variant="glass">
          <CardBody>
            <EmptyState
              icon={<Coins className="size-7" strokeWidth={1.5} />}
              title="Recuperación de caja propia"
              description="¿Qué hacer mañana para recuperar caja? Carga un Excel para verlo."
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

  const {
    capOperacional,
    operacionalesU,
    capJudicial,
    judiciales,
    judAgingProm,
    judMas180,
    judTopMarcas,
    rapida,
    lenta,
    congelada,
    congeladoCap,
    buckets,
    segmentos,
    peoresMarcas,
    destructores,
  } = view;
  const pctRapida = capOperacional > 0 ? rapida.c / capOperacional : 0;
  const maxAgingMarca = Math.max(...peoresMarcas.map((m) => m.agingProm), 1);

  return (
    <div className="max-w-[1400px] mx-auto px-10 py-10 space-y-7 fade-in">
      {vinCtx && (
        <VinContextoBanner
          vin={vinCtx}
          presentes={1}
          nota="Recuperación de Caja se muestra agregada (buckets / segmentos / marca). El detalle por VIN está en la ficha del caso."
        />
      )}
      {/* Breadcrumb + volver */}
      <div className="flex items-center gap-2 text-[12px] text-[--color-fg-muted]">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 hover:text-[--color-accent] transition"
        >
          <ArrowLeft className="size-3.5" /> Volver
        </Link>
        <span className="text-[--color-fg-dim]">/</span>
        <span>Sistema de Velocidad Operacional</span>
        <span className="text-[--color-fg-dim]">/</span>
        <span className="text-[--color-fg] font-medium">Recuperación de Caja</span>
      </div>

      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-[--color-border] bg-gradient-to-br from-[#f0fdf4] via-[#ecfeff] to-white px-10 py-8">
        <div className="absolute -top-12 -right-12 size-56 rounded-full bg-[--color-success] opacity-[0.10] blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[--color-success] font-semibold">
            <Coins className="size-3.5" strokeWidth={2} />
            Recuperación de caja propia
          </div>
          <h1 className="text-[28px] font-semibold tracking-tight mt-2 leading-tight text-[--color-fg]">
            ¿Qué hacer mañana para recuperar caja?
          </h1>
          <p className="text-[14px] text-[--color-fg-muted] mt-2 max-w-2xl leading-relaxed">
            {fmtCLPCompact(capOperacional)} de caja operacional en {fmtNum(operacionalesU)} unidades.
            El capital judicial se sigue aparte (riesgo legal), no entra en la velocidad.
          </p>
        </div>
      </div>

      {/* ════════ A · RECUPERACIÓN DE CAJA ════════ */}
      <section>
        <SecHeader letra="A" titulo="Recuperación de caja" sub="Qué tan rápido vuelve la caja operacional. Clic en cualquier tarjeta o tramo para ver y gestionar los VINs." />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          <EstadoCard
            label="Caja recuperable rápida"
            pregunta="Menos de 60 días — rota pronto"
            value={fmtCLPCompact(rapida.c)}
            unidades={rapida.u}
            top={rapida.top}
            tone="success"
            icon={<Zap className="size-4" strokeWidth={1.75} />}
            active={drillA?.titulo === "Caja recuperable rápida"}
            onClick={() => toggleA("Caja recuperable rápida", rapida.vins)}
          />
          <EstadoCard
            label="Caja lenta"
            pregunta="60-180 días — empieza a costar"
            value={fmtCLPCompact(lenta.c)}
            unidades={lenta.u}
            top={lenta.top}
            tone="warning"
            icon={<Clock className="size-4" strokeWidth={1.75} />}
            active={drillA?.titulo === "Caja lenta"}
            onClick={() => toggleA("Caja lenta", lenta.vins)}
          />
          <EstadoCard
            label="Caja congelada"
            pregunta="Más de 180 días — detenida"
            value={fmtCLPCompact(congelada.c)}
            unidades={congelada.u}
            top={congelada.top}
            tone="danger"
            icon={<Snowflake className="size-4" strokeWidth={1.75} />}
            active={drillA?.titulo === "Caja congelada"}
            onClick={() => toggleA("Caja congelada", congelada.vins)}
          />
        </div>

        {/* Barra recuperable */}
        <div className="surface bg-white px-6 py-4 mt-3">
          <div className="text-[12px] text-[--color-fg-muted] mb-2.5">
            <span className="text-[--color-success] font-semibold">{fmtCLPCompact(rapida.c)}</span>{" "}
            recuperable rápido ({fmtPct(pctRapida)}) ·{" "}
            <span className="text-[--color-warning] font-semibold">{fmtCLPCompact(lenta.c)}</span>{" "}
            lento ·{" "}
            <span className="text-[--color-danger] font-semibold">{fmtCLPCompact(congelada.c)}</span>{" "}
            congelado
          </div>
          <div className="flex h-3 rounded-full overflow-hidden bg-[--color-bg-elev-3]">
            <div className="bg-[--color-success]" style={{ width: `${capOperacional > 0 ? (rapida.c / capOperacional) * 100 : 0}%` }} title={`Rápida · ${fmtCLP(rapida.c)}`} />
            <div className="bg-[--color-warning]" style={{ width: `${capOperacional > 0 ? (lenta.c / capOperacional) * 100 : 0}%` }} title={`Lenta · ${fmtCLP(lenta.c)}`} />
            <div className="bg-[--color-danger]" style={{ width: `${capOperacional > 0 ? (congelada.c / capOperacional) * 100 : 0}%` }} title={`Congelada · ${fmtCLP(congelada.c)}`} />
          </div>
        </div>

        {/* Heatmap aging */}
        <div className="mt-3">
          <div className="text-[11px] uppercase tracking-wide text-[--color-fg-dim] font-medium mb-2">
            Antigüedad de la caja detenida
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
            {buckets.map((b) => {
              const titulo = `Aging ${b.label}`;
              const isOpen = drillA?.titulo === titulo;
              const intensidad = 0.18 + 0.82 * (b.capital / view.maxBucketCap);
              const critico = b.key === "180+";
              return (
                <button
                  key={b.key}
                  onClick={() => toggleA(titulo, b.vins)}
                  className={cn(
                    "rounded-xl border px-3 py-3 text-left transition",
                    isOpen
                      ? "border-[--color-accent] ring-2 ring-[--color-accent]/30"
                      : critico
                        ? "border-[--color-danger]/40 hover:border-[--color-danger]"
                        : "border-[--color-border] hover:border-[--color-border-strong]",
                  )}
                  style={{ backgroundColor: `${b.fill}${Math.round(intensidad * 38).toString(16).padStart(2, "0")}` }}
                >
                  <div className={cn("text-[11px] font-semibold uppercase tracking-wide", b.text)}>
                    {b.label}
                  </div>
                  <div className="display text-[20px] mt-1.5 leading-none text-[--color-fg]">
                    {fmtCLPCompact(b.capital)}
                  </div>
                  <div className="text-[11px] text-[--color-fg-muted] mt-1.5">{fmtNum(b.unidades)} u</div>
                  {critico && (
                    <div className="mt-1 text-[10px] font-semibold text-[--color-danger] uppercase tracking-wide">
                      Congelado
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {drillA && (
          <DrillCard titulo={drillA.titulo} subtitulo={`${fmtNum(drillA.vins.length)} unidades · ${fmtCLPCompact(cap(drillA.vins))}`} onClose={() => setDrillA(null)}>
            <VinDrillTable vins={drillA.vins} verTodosHref="/stock?flags=pagado" origen="Recuperación de caja" />
          </DrillCard>
        )}
      </section>

      {/* ════════ B · COMPOSICIÓN OPERACIONAL ════════ */}
      <section>
        <SecHeader letra="B" titulo="Composición operacional" sub="En qué está la caja recuperable. Clic para ver y gestionar." />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-3">
          {segmentos.filter((s) => s.unidades > 0).map((s) => {
            const meta = SEG_META[s.key];
            const isOpen = drillB?.titulo === meta.label;
            return (
              <button
                key={s.key}
                onClick={() => toggleB(meta.label, s.vins)}
                className={cn(
                  "surface top-strip bg-white px-4 pt-5 pb-4 text-left transition flex flex-col",
                  meta.strip,
                  isOpen ? "ring-2 ring-[--color-accent]/30 border-[--color-accent]" : "surface-hover",
                )}
              >
                <div className="flex items-center gap-2">
                  <div className={cn("size-7 rounded-lg grid place-items-center", meta.iconBg)}>
                    <span className={meta.text}>{meta.icon}</span>
                  </div>
                  <div className={cn("text-[11px] uppercase tracking-[0.1em] font-semibold", meta.text)}>
                    {meta.label}
                  </div>
                </div>
                <div className="flex items-baseline gap-2 mt-3">
                  <div className="display text-[22px] leading-none text-[--color-fg]">
                    {fmtCLPCompact(s.capital)}
                  </div>
                  <div className="text-[11px] text-[--color-fg-muted]">{fmtNum(s.unidades)} u</div>
                </div>
                <div className="text-[11px] text-[--color-fg-dim] mt-2 leading-snug min-h-[32px]">
                  {meta.desc}
                </div>
                <div className="mt-2.5 pt-2.5 border-t border-[--color-border-soft] flex items-center gap-3 text-[11px] text-[--color-fg-muted]">
                  <span>aging <span className="mono text-[--color-fg]">{s.agingProm}d</span></span>
                  {s.mas180 > 0 && (
                    <span>· <span className="mono text-[--color-danger]">{fmtNum(s.mas180)}</span> &gt;180d</span>
                  )}
                  <span className="ml-auto inline-flex items-center gap-1 text-[--color-accent]">
                    {isOpen ? "Ocultar" : "Ver"} <ArrowRight className="size-3" />
                  </span>
                </div>
                {s.topMarcas.length > 0 && (
                  <div className="text-[10.5px] text-[--color-fg-dim] mt-1.5 truncate">
                    Top: {s.topMarcas.join(" · ")}
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {drillB && (
          <DrillCard titulo={drillB.titulo} subtitulo={`${fmtNum(drillB.vins.length)} unidades · ${fmtCLPCompact(cap(drillB.vins))}`} onClose={() => setDrillB(null)}>
            <VinDrillTable vins={drillB.vins} verTodosHref="/stock?flags=pagado" origen="Recuperación de caja" />
          </DrillCard>
        )}
      </section>

      {/* ════════ C · RIESGO (colapsable) ════════ */}
      <section>
        <button
          onClick={() => setRiesgoAbierto((o) => !o)}
          className="w-full surface bg-white px-6 py-4 flex items-center justify-between gap-4 hover:bg-[--color-bg-elev-1] transition top-strip strip-danger"
        >
          <div className="flex items-center gap-3 text-left">
            <div className="size-9 rounded-lg bg-[--color-danger]/10 grid place-items-center shrink-0">
              <AlertTriangle className="size-4 text-[--color-danger]" strokeWidth={1.75} />
            </div>
            <div>
              <div className="text-[15px] font-semibold tracking-tight text-[--color-fg]">
                C · Riesgo
              </div>
              <div className="text-[12px] text-[--color-fg-muted]">
                Capital judicial, congelado &gt;180d y marcas más lentas. {fmtCLPCompact(capJudicial + congeladoCap)} en riesgo.
              </div>
            </div>
          </div>
          <ChevronDown className={cn("size-5 text-[--color-fg-dim] transition shrink-0", riesgoAbierto && "rotate-180")} />
        </button>

        {riesgoAbierto && (
          <div className="mt-3 space-y-3">
            {/* Judicial colapsable */}
            {judiciales.length > 0 && (
              <div className="surface top-strip strip-judicial bg-white px-7 py-5">
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="size-10 rounded-xl bg-[#7c2d12]/10 grid place-items-center shrink-0">
                    <Gavel className="size-5 text-[#7c2d12]" strokeWidth={1.75} />
                  </div>
                  <div className="flex-1 min-w-[240px]">
                    <div className="text-[10.5px] uppercase tracking-[0.13em] text-[#7c2d12] font-semibold">
                      Capital judicial · seguimiento jurídico
                    </div>
                    <div className="display text-[26px] mt-1.5 leading-none text-[--color-fg]">
                      {fmtCLPCompact(capJudicial)}
                    </div>
                    <div className="text-[12px] text-[--color-fg-muted] mt-1.5 leading-relaxed">
                      {fmtNum(judiciales.length)} unidades · aging legal {judAgingProm}d prom ·{" "}
                      {fmtNum(judMas180)} &gt;180d. Recuperabilidad depende del proceso legal, no de
                      la velocidad comercial.
                    </div>
                    {judTopMarcas.length > 0 && (
                      <div className="text-[11px] text-[--color-fg-dim] mt-1.5">
                        Top marcas: {judTopMarcas.join(" · ")}
                      </div>
                    )}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setJudAbierto((o) => !o)}>
                    {judAbierto ? "Ocultar VINs" : "Ver y gestionar VINs"} <ArrowRight className="size-3.5" />
                  </Button>
                </div>
                {judAbierto && (
                  <div className="mt-4 rounded-xl border border-[#7c2d12]/30 overflow-hidden">
                    <VinDrillTable vins={judiciales} verTodosHref="/stock?flags=judicial" origen="Recuperación de caja · judicial" />
                  </div>
                )}
              </div>
            )}

            {/* Marcas que destruyen velocidad — clickable */}
            <div className="surface bg-white overflow-hidden">
              <div className="px-6 pt-5 pb-3 border-b border-[--color-border-soft] flex items-center gap-2">
                <TrendingDown className="size-4 text-[--color-danger]" strokeWidth={1.75} />
                <div>
                  <div className="text-[14px] font-semibold tracking-tight text-[--color-fg]">
                    Marcas que destruyen más velocidad
                  </div>
                  <div className="text-[12px] text-[--color-fg-muted]">
                    Mayor antigüedad promedio. Clic para ver sus VINs (por aging y monto).
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 space-y-3">
                {peoresMarcas.length === 0 ? (
                  <div className="text-[12.5px] text-[--color-fg-muted] py-4 text-center">
                    Sin datos suficientes.
                  </div>
                ) : (
                  peoresMarcas.map((m) => {
                    const isOpen = drillC?.titulo === m.marca;
                    return (
                      <button
                        key={m.marca}
                        onClick={() => toggleC(m.marca, m.vins)}
                        className={cn(
                          "group block w-full text-left rounded-lg px-2 py-1.5 -mx-2 transition",
                          isOpen ? "bg-[--color-accent]/[0.05]" : "hover:bg-[--color-bg-elev-1]",
                        )}
                      >
                        <div className="flex items-baseline justify-between gap-3 mb-1">
                          <span className="text-[13px] font-medium text-[--color-fg] group-hover:text-[--color-accent] truncate">
                            {m.marca}
                          </span>
                          <span className="text-[12px] text-[--color-fg-muted] shrink-0">
                            <span className="mono text-[--color-danger] font-semibold">{m.agingProm}d</span>{" "}
                            · {fmtCLPCompact(m.capital)} · {fmtNum(m.unidades)}u
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-[--color-bg-elev-3] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[--color-warning] to-[--color-danger]"
                            style={{ width: `${(m.agingProm / maxAgingMarca) * 100}%` }}
                          />
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
              {drillC && (
                <div className="border-t border-[--color-border-soft]">
                  <div className="px-5 py-2.5 bg-[--color-bg-elev-1] flex items-center justify-between">
                    <span className="text-[12px] text-[--color-fg-muted]">
                      <span className="font-semibold text-[--color-fg]">{drillC.titulo}</span> ·{" "}
                      {fmtNum(drillC.vins.length)} VIN · {fmtCLPCompact(cap(drillC.vins))}
                    </span>
                    <button onClick={() => setDrillC(null)} className="text-[11px] text-[--color-fg-muted] hover:text-[--color-fg]">
                      Cerrar
                    </button>
                  </div>
                  <VinDrillTable vins={drillC.vins} verTodosHref={`/stock?marca=${encodeURIComponent(drillC.titulo)}&flags=pagado`} origen="Recuperación de caja" />
                </div>
              )}
            </div>

            {/* VINs que más capital inmovilizan */}
            <div className="surface bg-white overflow-hidden">
              <div className="px-6 pt-5 pb-3 border-b border-[--color-border-soft] flex items-center gap-2">
                <Flame className="size-4 text-[--color-danger]" strokeWidth={1.75} />
                <div>
                  <div className="text-[14px] font-semibold tracking-tight text-[--color-fg]">
                    VINs que más caja inmovilizan
                  </div>
                  <div className="text-[12px] text-[--color-fg-muted]">
                    Mayor capital con más de 90 días · prioridad de recuperación.
                  </div>
                </div>
              </div>
              <VinDrillTable vins={destructores} max={12} origen="Recuperación de caja" />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function SecHeader({ letra, titulo, sub }: { letra: string; titulo: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="size-7 rounded-md bg-[--color-accent]/10 text-[--color-accent] grid place-items-center text-[12px] font-bold mono shrink-0">
        {letra}
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-[16px] font-semibold tracking-tight text-[--color-fg]">{titulo}</h2>
        <p className="text-[12.5px] text-[--color-fg-muted] mt-0.5 leading-relaxed">{sub}</p>
      </div>
    </div>
  );
}

function DrillCard({
  titulo,
  subtitulo,
  onClose,
  children,
}: {
  titulo: string;
  subtitulo: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 rounded-xl border border-[--color-accent]/40 bg-white overflow-hidden ring-1 ring-[--color-accent]/20">
      <div className="px-5 py-3 border-b border-[--color-border-soft] flex items-center justify-between gap-3 flex-wrap bg-[--color-bg-elev-1]">
        <div>
          <span className="text-[13px] font-semibold text-[--color-fg]">{titulo}</span>
          <span className="text-[12px] text-[--color-fg-muted] ml-2">{subtitulo}</span>
        </div>
        <button onClick={onClose} className="text-[11px] text-[--color-fg-muted] hover:text-[--color-fg]">
          Cerrar
        </button>
      </div>
      {children}
    </div>
  );
}

function EstadoCard({
  label,
  pregunta,
  value,
  unidades,
  top,
  tone,
  icon,
  active,
  onClick,
}: {
  label: string;
  pregunta: string;
  value: string;
  unidades: number;
  top: string[];
  tone: "success" | "warning" | "danger";
  icon: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  const strip =
    tone === "success" ? "strip-success" : tone === "warning" ? "strip-warning" : "strip-danger";
  const text =
    tone === "success"
      ? "text-[--color-success]"
      : tone === "warning"
        ? "text-[--color-warning]"
        : "text-[--color-danger]";
  const iconBg =
    tone === "success"
      ? "bg-[--color-success]/10"
      : tone === "warning"
        ? "bg-[--color-warning]/12"
        : "bg-[--color-danger]/10";
  return (
    <button
      onClick={onClick}
      className={cn(
        "surface surface-hover top-strip bg-white px-5 pt-5 pb-4 text-left w-full",
        strip,
        active && "ring-2 ring-[--color-accent]/30 border-[--color-accent]",
      )}
    >
      <div className="flex items-center justify-between">
        <div className={cn("text-[10.5px] uppercase tracking-[0.12em] font-semibold", text)}>
          {label}
        </div>
        <div className={cn("size-7 rounded-lg grid place-items-center", iconBg)}>
          <span className={text}>{icon}</span>
        </div>
      </div>
      <div className="display text-[26px] mt-2.5 leading-none text-[--color-fg]">{value}</div>
      <div className="text-[11.5px] text-[--color-fg-muted] mt-1.5">{fmtNum(unidades)} unidades</div>
      <div className="text-[11px] text-[--color-fg-dim] mt-1.5 leading-snug">{pregunta}</div>
      {top.length > 0 && (
        <div className="text-[10.5px] text-[--color-fg-dim] mt-1.5 truncate">Top: {top.join(" · ")}</div>
      )}
      <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-[--color-accent]">
        {active ? "Ocultar detalle" : "Ver detalle"} <ArrowRight className="size-3" />
      </div>
    </button>
  );
}
