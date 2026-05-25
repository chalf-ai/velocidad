"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarClock,
  Clock,
  CreditCard,
  ExternalLink,
  Flame,
  Gavel,
  MapPin,
  Tag,
  TestTube2,
  TrendingDown,
} from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { AbrirCasoButton } from "@/components/AbrirCasoButton";
import { useExcelStore } from "@/lib/store";
import { useGestionStore } from "@/lib/gestion/store";
import { cn } from "@/lib/cn";
import { fmtCLPCompact, fmtNum, fmtPct } from "@/lib/format";
import { limpiarVIN } from "@/lib/parser/venta-apc";
import { normalizarMarcaOperacional } from "@/lib/selectors/owner-operacional";
import {
  buildVehiculosUnificados,
  type VehiculoUnificado,
} from "@/lib/selectors/vehiculo-unificado";

type Tone = "danger" | "warning" | "info" | "muted";

const TONE: Record<Tone, { strip: string; text: string; bar: string }> = {
  danger: { strip: "strip-danger", text: "text-[--color-danger]", bar: "bg-[--color-danger]" },
  warning: { strip: "strip-warning", text: "text-[--color-warning]", bar: "bg-[--color-warning]" },
  info: { strip: "strip-info", text: "text-[--color-info]", bar: "bg-[--color-info]" },
  muted: { strip: "strip-muted", text: "text-[--color-fg-muted]", bar: "bg-[--color-fg-dim]" },
};

const maxAging = (vu: VehiculoUnificado) =>
  Math.max(
    vu.fneDiasFactura ?? 0,
    vu.diasStock ?? 0,
    vu.fneDiasEnEstado ?? 0,
    vu.diasTescar ?? 0,
  );

export default function AlertasPage() {
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
              icon={<AlertTriangle className="size-7" />}
              title="Centro de tensión operacional"
              description="Qué resolver hoy: solo el capital realmente en tensión, priorizado y accionable. Carga el Excel maestro para empezar."
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
  return <AlertasInner />;
}

interface CategoriaTension {
  id: string;
  label: string;
  desc: string;
  accion: string;
  responsable: string;
  tone: Tone;
  icon: React.ReactNode;
  vins: VehiculoUnificado[];
  monto: number;
}

function AlertasInner() {
  const { data, fne, saldos } = useExcelStore();
  const parsed = data!;
  const gestionMap = useGestionStore((s) => s.byVin);
  const [sel, setSel] = useState<string>("todos");
  const listaRef = useRef<HTMLDivElement>(null);

  const universo = useMemo(
    () => buildVehiculosUnificados({ data, fne, saldos }),
    [data, fne, saldos],
  );
  const activos = useMemo(() => {
    const arr: VehiculoUnificado[] = [];
    for (const vu of universo.values()) if (vu.esOperacionalActivo) arr.push(vu);
    return arr;
  }, [universo]);

  // Set de VINs con vencimiento vencido (desde Base_Stock — no está en el unificado).
  const vencidosSet = useMemo(() => {
    const hoy = new Date();
    const s = new Set<string>();
    for (const v of parsed.vehiculos) {
      if (v.fechaVencimiento && v.fechaVencimiento < hoy) s.add(limpiarVIN(v.vin));
    }
    return s;
  }, [parsed.vehiculos]);

  // ── CAPA 2 · Tensiones reales (categorías VIN) ──
  const categorias = useMemo<CategoriaTension[]>(() => {
    const mk = (
      id: string,
      label: string,
      desc: string,
      accion: string,
      responsable: string,
      tone: Tone,
      icon: React.ReactNode,
      pred: (vu: VehiculoUnificado) => boolean,
      monto: (vu: VehiculoUnificado) => number,
    ): CategoriaTension => {
      const vins = activos.filter(pred);
      return { id, label, desc, accion, responsable, tone, icon, vins, monto: vins.reduce((s, v) => s + monto(v), 0) };
    };
    return [
      mk(
        "fne_detenidos",
        "FNE detenidos >15d",
        "Facturados sin avanzar más de 15 días en su estado.",
        "Acelerar trámite de entrega / cobrar diferencia.",
        "Sucursal · Entregas",
        "danger",
        <AlertOctagon className="size-4" />,
        (vu) => vu.enFNE && vu.fneEstado !== "listo_para_entregar" && (vu.fneDiasEnEstado ?? 0) > 15,
        (vu) => vu.fneValorFactura,
      ),
      mk(
        "stock180",
        "Stock >180 días",
        "Unidades en stock con más de 180 días sin rotar.",
        "Decidir: rebaja, traslado o castigo de precio.",
        "Comercial",
        "danger",
        <Clock className="size-4" />,
        (vu) => vu.enStockActivo && (vu.diasStock ?? 0) > 180,
        (vu) => vu.capitalComprometido,
      ),
      mk(
        "cp",
        "Crédito Pompeyo activo",
        "Operaciones con Crédito Pompeyo por cobrar.",
        "Cobrar para liberar la entrega.",
        "Cobranzas",
        "warning",
        <Banknote className="size-4" />,
        (vu) => vu.creditoPompeyo > 0,
        (vu) => vu.creditoPompeyo,
      ),
      mk(
        "judicial",
        "Judicial",
        "Stock en proceso judicial — bloqueado legalmente.",
        "Seguimiento jurídico — recuperabilidad legal.",
        "Legal",
        "danger",
        <Gavel className="size-4" />,
        (vu) => vu.esJudicial,
        (vu) => vu.capitalComprometido,
      ),
      mk(
        "vencidos",
        "Vencimientos vencidos",
        "VIN con fecha de vencimiento ya pasada.",
        "Gestionar pago o renovación urgente.",
        "Tesorería",
        "danger",
        <CalendarClock className="size-4" />,
        (vu) => vencidosSet.has(vu.vinLimpio),
        (vu) => vu.capitalComprometido,
      ),
      mk(
        "tescar180",
        "TESCAR >180d",
        "Demos / test cars con más de 180 días.",
        "Rotar a venta o reasignar.",
        "Comercial",
        "warning",
        <TestTube2 className="size-4" />,
        (vu) => vu.esTescar && (vu.diasTescar ?? 0) > 180,
        (vu) => vu.capitalComprometido,
      ),
      mk(
        "vu_puente",
        "VU puente >60d",
        "Usados en parte de pago sin liquidar +60 días.",
        "Liquidar / ingresar a línea.",
        "Comercial · Usados",
        "warning",
        <Clock className="size-4" />,
        (vu) => vu.esVPP && (vu.diasVPP ?? 0) > 60,
        (vu) => vu.capitalComprometido,
      ),
    ].filter((c) => c.vins.length > 0);
  }, [activos, vencidosSet]);

  // ── Tensiones de línea (no son VIN) ──
  const lineasSobregiradas = useMemo(
    () => parsed.lineas.filter((l) => l.semaforo === "sobregirada"),
    [parsed.lineas],
  );
  const lineasMas90 = useMemo(
    () => parsed.lineas.filter((l) => l.semaforo === "rojo"),
    [parsed.lineas],
  );
  const sobregiroTotal = lineasSobregiradas.reduce(
    (s, l) => s + Math.max(0, l.lineaOcupada - l.lineaAutorizada),
    0,
  );
  const ocupadaMas90 = lineasMas90.reduce((s, l) => s + l.lineaOcupada, 0);

  // ── Capital en tensión TOTAL — unión dedup de VINs en tensión (no todo el sistema) ──
  const tensionTotal = useMemo(() => {
    const seen = new Set<string>();
    let monto = 0;
    for (const c of categorias) {
      for (const vu of c.vins) {
        if (seen.has(vu.vinLimpio)) continue;
        seen.add(vu.vinLimpio);
        monto += vu.capitalComprometido;
      }
    }
    return { monto, casos: seen.size };
  }, [categorias]);

  const unionVins = useMemo(() => {
    const m = new Map<string, VehiculoUnificado>();
    for (const c of categorias) for (const vu of c.vins) if (!m.has(vu.vinLimpio)) m.set(vu.vinLimpio, vu);
    return [...m.values()];
  }, [categorias]);

  // ── CAPA 1 · Estado general (referencia, no accionable) ──
  const stockTotal = parsed.vehiculos.reduce((s, v) => s + (v.costoNeto || 0), 0);
  const fneCount = fne?.registros.length ?? 0;
  const fneValor = fne?.registros.reduce((s, r) => s + (r.valorFactura ?? 0), 0) ?? 0;
  const lineaAut = parsed.lineas.reduce((s, l) => s + l.lineaAutorizada, 0);
  const lineaOcu = parsed.lineas.reduce((s, l) => s + l.lineaOcupada, 0);
  const backlog = useMemo(() => {
    let n = 0;
    for (const g of Object.values(gestionMap)) {
      if (g.estadoGestion === "abierto" || g.estadoGestion === "en_curso" || g.estadoGestion === "esperando") {
        if (g.responsable || g.comentario || g.fechaCompromiso) n++;
      }
    }
    return n;
  }, [gestionMap]);

  // ── TOP CAUSAS operacionales ──
  const topCausas = useMemo(() => {
    const sortedCap = [...unionVins].sort((a, b) => b.capitalComprometido - a.capitalComprometido);
    const top5 = sortedCap.slice(0, 5);
    const top5Cap = top5.reduce((s, v) => s + v.capitalComprometido, 0);
    const pct5 = tensionTotal.monto > 0 ? top5Cap / tensionTotal.monto : 0;

    // Líneas: concentración del sobregiro
    const sortedSob = [...lineasSobregiradas]
      .map((l) => ({ l, sob: Math.max(0, l.lineaOcupada - l.lineaAutorizada) }))
      .sort((a, b) => b.sob - a.sob);
    const top3Sob = sortedSob.slice(0, 3).reduce((s, x) => s + x.sob, 0);
    const pctSob = sobregiroTotal > 0 ? top3Sob / sobregiroTotal : 0;

    // Sucursal con más FNE detenidos
    const fneDet = categorias.find((c) => c.id === "fne_detenidos")?.vins ?? [];
    const sucMap = new Map<string, number>();
    for (const vu of fneDet) {
      const k = vu.sucursal ?? "(sin sucursal)";
      sucMap.set(k, (sucMap.get(k) ?? 0) + 1);
    }
    const sucTop = [...sucMap.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

    // Marca con peor aging promedio (sobre unión)
    const marcaMap = new Map<string, { sum: number; n: number }>();
    for (const vu of unionVins) {
      const d = maxAging(vu);
      if (d <= 0) continue;
      const k = normalizarMarcaOperacional(vu.marca);
      const e = marcaMap.get(k) ?? { sum: 0, n: 0 };
      e.sum += d;
      e.n++;
      marcaMap.set(k, e);
    }
    const marcaTop =
      [...marcaMap.entries()]
        .map(([m, e]) => ({ m, prom: Math.round(e.sum / e.n), n: e.n }))
        .filter((x) => x.n >= 2)
        .sort((a, b) => b.prom - a.prom)[0] ?? null;

    // Concentración del capital congelado (stock>180)
    const stock180 = (categorias.find((c) => c.id === "stock180")?.vins ?? []).sort(
      (a, b) => b.capitalComprometido - a.capitalComprometido,
    );
    const stock180Total = stock180.reduce((s, v) => s + v.capitalComprometido, 0);
    const top10Cong = stock180.slice(0, 10).reduce((s, v) => s + v.capitalComprometido, 0);
    const pctCong = stock180Total > 0 ? top10Cong / stock180Total : 0;

    return { top5, top5Cap, pct5, top3Sob, pctSob, sucTop, marcaTop, top10Cong, pctCong };
  }, [unionVins, tensionTotal.monto, lineasSobregiradas, sobregiroTotal, categorias]);

  // ── Selección → lista CAPA 3 ──
  const irALista = () =>
    requestAnimationFrame(() => listaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  const select = (id: string) => {
    setSel(id);
    irALista();
  };

  const catSel = categorias.find((c) => c.id === sel) ?? null;
  const esLineaSel = sel === "linea_sobregiro" || sel === "linea_90";
  const casos = useMemo(() => {
    let arr: VehiculoUnificado[];
    if (sel === "todos") arr = unionVins;
    else if (sel === "top5") arr = topCausas.top5;
    else if (catSel) arr = catSel.vins;
    else arr = [];
    return [...arr].sort((a, b) => {
      if (b.capitalComprometido !== a.capitalComprometido)
        return b.capitalComprometido - a.capitalComprometido;
      return maxAging(b) - maxAging(a);
    });
  }, [sel, unionVins, topCausas.top5, catSel]);

  return (
    <div className="max-w-[1400px] mx-auto px-10 py-10 space-y-7 fade-in">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-[--color-border] bg-gradient-to-br from-[#fef2f2] via-[#fff7ed] to-white px-10 py-8">
        <div className="absolute -top-12 -right-12 size-56 rounded-full bg-[--color-danger] opacity-[0.10] blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[--color-danger] font-semibold">
            <AlertTriangle className="size-3.5" strokeWidth={2} />
            Centro de tensión operacional
          </div>
          <h1 className="text-[28px] font-semibold tracking-tight mt-2 leading-tight text-[--color-fg]">
            ¿Qué debo resolver hoy?
          </h1>
          <p className="text-[14px] text-[--color-fg-muted] mt-2 max-w-3xl leading-relaxed">
            Solo el capital realmente en tensión — no el backlog completo del sistema. Cada bloque
            abre sus casos con gestión y responsable.
          </p>
        </div>
      </div>

      {/* CAPA 1 · Estado general */}
      <div>
        <div className="text-[10.5px] uppercase tracking-[0.13em] text-[--color-fg-dim] font-semibold mb-2">
          Estado general · referencia (no accionable)
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
          <Capa1Stat label="Stock total" value={fmtCLPCompact(stockTotal)} sub={`${fmtNum(parsed.vehiculos.length)} unidades`} />
          <Capa1Stat label="FNE" value={fmtNum(fneCount)} sub={`${fmtCLPCompact(fneValor)} facturado`} />
          <Capa1Stat
            label="Línea ocupada"
            value={fmtPct(lineaAut > 0 ? lineaOcu / lineaAut : 0)}
            sub={`${fmtCLPCompact(lineaOcu)} de ${fmtCLPCompact(lineaAut)}`}
          />
          <Capa1Stat label="Operaciones activas" value={fmtNum(activos.length)} sub="stock vivo + FNE + saldos" />
          <Capa1Stat label="Backlog en gestión" value={fmtNum(backlog)} sub="abiertos / en curso" />
        </div>
      </div>

      {/* CAPA 2 · Tensiones reales */}
      <div>
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
          <div className="text-[10.5px] uppercase tracking-[0.13em] text-[--color-danger] font-semibold">
            Tensiones reales · accionable
          </div>
          <div className="text-[12.5px] text-[--color-fg-muted]">
            Capital en tensión:{" "}
            <span className="text-[--color-danger] font-semibold">{fmtCLPCompact(tensionTotal.monto)}</span>{" "}
            · {fmtNum(tensionTotal.casos)} operaciones{" "}
            <span className="text-[--color-fg-dim]">(unión sin doble conteo)</span>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {categorias.map((c) => (
            <TensionCard
              key={c.id}
              cat={c}
              active={sel === c.id}
              onClick={() => select(c.id)}
            />
          ))}
          {/* Líneas — tensión de cupo (no VIN) */}
          {lineasSobregiradas.length > 0 && (
            <LineaTensionCard
              label="Líneas sobregiradas"
              count={lineasSobregiradas.length}
              monto={sobregiroTotal}
              montoLabel="sobre cupo"
              accion="Frenar ingresos / renegociar línea"
              responsable="Tesorería"
              tone="danger"
              active={sel === "linea_sobregiro"}
              onClick={() => select("linea_sobregiro")}
            />
          )}
          {lineasMas90.length > 0 && (
            <LineaTensionCard
              label="Líneas >90%"
              count={lineasMas90.length}
              monto={ocupadaMas90}
              montoLabel="utilizado"
              accion="Vigilar / priorizar descargas"
              responsable="Tesorería"
              tone="warning"
              active={sel === "linea_90"}
              onClick={() => select("linea_90")}
            />
          )}
        </div>
      </div>

      {/* TOP CAUSAS operacionales */}
      <div>
        <div className="text-[10.5px] uppercase tracking-[0.13em] text-[--color-fg-dim] font-semibold mb-2">
          Dónde se concentra
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {topCausas.top5.length > 0 && (
            <CausaCard
              icon={<Flame className="size-4" />}
              tone="danger"
              texto={`5 VIN inmovilizan ${fmtCLPCompact(topCausas.top5Cap)}`}
              sub={`${Math.round(topCausas.pct5 * 100)}% del capital en tensión`}
              onClick={() => select("top5")}
            />
          )}
          {lineasSobregiradas.length > 0 && (
            <CausaCard
              icon={<TrendingDown className="size-4" />}
              tone="danger"
              texto={`${Math.min(3, lineasSobregiradas.length)} líneas concentran ${Math.round(topCausas.pctSob * 100)}% del sobregiro`}
              sub={`${fmtCLPCompact(topCausas.top3Sob)} de ${fmtCLPCompact(sobregiroTotal)}`}
              onClick={() => select("linea_sobregiro")}
            />
          )}
          {topCausas.sucTop && (
            <CausaCard
              icon={<MapPin className="size-4" />}
              tone="warning"
              texto={`${topCausas.sucTop[0]} concentra ${topCausas.sucTop[1]} FNE detenidos`}
              sub="Sucursal con más operaciones trabadas"
              onClick={() => select("fne_detenidos")}
            />
          )}
          {topCausas.marcaTop && (
            <CausaCard
              icon={<Tag className="size-4" />}
              tone="warning"
              texto={`${topCausas.marcaTop.m} tiene el peor aging promedio`}
              sub={`${topCausas.marcaTop.prom}d prom · ${topCausas.marcaTop.n} casos`}
            />
          )}
          {topCausas.top10Cong > 0 && (
            <CausaCard
              icon={<Flame className="size-4" />}
              tone="danger"
              texto={`10 VIN explican ${Math.round(topCausas.pctCong * 100)}% del capital congelado`}
              sub={`${fmtCLPCompact(topCausas.top10Cong)} en stock >180d`}
              onClick={() => select("stock180")}
            />
          )}
        </div>
      </div>

      {/* CAPA 3 · Casos prioritarios */}
      <div ref={listaRef} className="space-y-3 scroll-mt-6">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-[16px] font-semibold tracking-tight text-[--color-fg]">
              {sel === "todos"
                ? "Casos prioritarios"
                : sel === "top5"
                  ? "Top 5 por impacto"
                  : catSel
                    ? catSel.label
                    : esLineaSel
                      ? sel === "linea_sobregiro"
                        ? "Líneas sobregiradas"
                        : "Líneas sobre 90%"
                      : "Casos"}
            </h2>
            <p className="text-[12.5px] text-[--color-fg-muted] mt-0.5">
              {esLineaSel
                ? "Financieras con presión de cupo — clic en la marca para ver Floor Plan."
                : sel === "todos"
                  ? "Top por impacto y aging. Gestión persistente por VIN."
                  : catSel
                    ? `${catSel.desc} · acción: ${catSel.accion}`
                    : "Top por impacto."}
            </p>
          </div>
          {sel !== "todos" && (
            <button
              onClick={() => setSel("todos")}
              className="text-[12px] text-[--color-accent] hover:underline shrink-0"
            >
              Ver todas las tensiones
            </button>
          )}
        </div>

        {esLineaSel ? (
          <LineasLista lineas={sel === "linea_sobregiro" ? lineasSobregiradas : lineasMas90} />
        ) : casos.length === 0 ? (
          <Card>
            <CardBody className="p-10 text-center text-[13px] text-[--color-fg-muted]">
              Sin casos en esta tensión.
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-2">
            {casos.slice(0, 30).map((vu) => (
              <CasoRow key={vu.vinLimpio} vu={vu} accion={catSel?.accion ?? null} />
            ))}
            {casos.length > 30 && (
              <div className="text-[11.5px] text-[--color-fg-muted] text-center mt-2">
                Mostrando primeros 30 de {fmtNum(casos.length)} · refina con una tensión específica.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Componentes ─────────────────────────────────────────────────────────

function Capa1Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="surface bg-white px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-[--color-fg-dim]">{label}</div>
      <div className="display text-[22px] mt-1 leading-none text-[--color-fg]">{value}</div>
      <div className="text-[11px] text-[--color-fg-muted] mt-1.5">{sub}</div>
    </div>
  );
}

function TensionCard({
  cat,
  active,
  onClick,
}: {
  cat: CategoriaTension;
  active: boolean;
  onClick: () => void;
}) {
  const cfg = TONE[cat.tone];
  return (
    <button
      onClick={onClick}
      className={cn(
        "surface top-strip bg-white px-4 pt-4 pb-3.5 text-left transition flex flex-col",
        cfg.strip,
        active ? "ring-2 ring-[--color-accent]/30 border-[--color-accent]" : "surface-hover",
      )}
    >
      <div className={cn("flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.1em] font-semibold", cfg.text)}>
        {cat.icon}
        <span className="truncate">{cat.label}</span>
      </div>
      <div className="flex items-baseline gap-2 mt-2">
        <div className="display text-[24px] leading-none text-[--color-fg]">{fmtNum(cat.vins.length)}</div>
        <div className="text-[12px] text-[--color-fg-muted]">casos</div>
      </div>
      <div className={cn("text-[13px] font-semibold mt-1", cfg.text)}>{fmtCLPCompact(cat.monto)}</div>
      <div className="text-[10.5px] text-[--color-fg-dim] mt-1.5 leading-snug">{cat.accion}</div>
      <div className="text-[10px] text-[--color-fg-dim] mt-0.5">Resp: {cat.responsable}</div>
      <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-[--color-accent]">
        Ver operaciones <ArrowRight className="size-3" />
      </div>
    </button>
  );
}

function LineaTensionCard({
  label,
  count,
  monto,
  montoLabel,
  accion,
  responsable,
  tone,
  active,
  onClick,
}: {
  label: string;
  count: number;
  monto: number;
  montoLabel: string;
  accion: string;
  responsable: string;
  tone: Tone;
  active: boolean;
  onClick: () => void;
}) {
  const cfg = TONE[tone];
  return (
    <button
      onClick={onClick}
      className={cn(
        "surface top-strip bg-white px-4 pt-4 pb-3.5 text-left transition flex flex-col",
        cfg.strip,
        active ? "ring-2 ring-[--color-accent]/30 border-[--color-accent]" : "surface-hover",
      )}
    >
      <div className={cn("flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.1em] font-semibold", cfg.text)}>
        <CreditCard className="size-4" />
        <span className="truncate">{label}</span>
      </div>
      <div className="flex items-baseline gap-2 mt-2">
        <div className="display text-[24px] leading-none text-[--color-fg]">{fmtNum(count)}</div>
        <div className="text-[12px] text-[--color-fg-muted]">líneas</div>
      </div>
      <div className={cn("text-[13px] font-semibold mt-1", cfg.text)}>
        {fmtCLPCompact(monto)} <span className="text-[--color-fg-muted] font-normal">{montoLabel}</span>
      </div>
      <div className="text-[10.5px] text-[--color-fg-dim] mt-1.5 leading-snug">{accion}</div>
      <div className="text-[10px] text-[--color-fg-dim] mt-0.5">Resp: {responsable}</div>
      <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-[--color-accent]">
        Ver financieras <ArrowRight className="size-3" />
      </div>
    </button>
  );
}

function CausaCard({
  icon,
  tone,
  texto,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  tone: Tone;
  texto: string;
  sub: string;
  onClick?: () => void;
}) {
  const cfg = TONE[tone];
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "surface bg-white px-4 py-3 text-left w-full flex items-start gap-3",
        onClick && "surface-hover cursor-pointer",
      )}
    >
      <div className={cn("size-8 rounded-lg grid place-items-center shrink-0 bg-[--color-bg-elev-2]", cfg.text)}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-[--color-fg] leading-snug">{texto}</div>
        <div className="text-[11px] text-[--color-fg-muted] mt-0.5">{sub}</div>
      </div>
    </Comp>
  );
}

function CasoRow({ vu, accion }: { vu: VehiculoUnificado; accion: string | null }) {
  const dias = maxAging(vu);
  const diasTone = dias > 180 ? "danger" : dias > 60 ? "warning" : "muted";
  return (
    <div className="surface bg-white px-4 py-3">
      <div className="flex items-start gap-4 flex-wrap">
        {/* Capital */}
        <div className="w-[120px] shrink-0">
          <div className="text-[9.5px] uppercase tracking-wide text-[--color-fg-dim]">Capital</div>
          <div className="display text-[19px] mt-0.5 leading-none text-[--color-fg]">
            {vu.capitalComprometido > 0 ? fmtCLPCompact(vu.capitalComprometido) : "—"}
          </div>
        </div>
        {/* Identificación */}
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[13px] text-[--color-fg]">
              {vu.marca ?? "—"}{vu.modelo ? ` · ${vu.modelo}` : ""}
            </span>
            <span className="mono text-[10.5px] text-[--color-fg-muted]">{vu.vinLimpio}</span>
            {vu.sucursal && <span className="text-[11px] text-[--color-fg-muted]">· {vu.sucursal}</span>}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {dias > 0 && (
              <Badge tone={diasTone} size="xs">
                {dias}d
              </Badge>
            )}
            {vu.creditoPompeyo > 0 && (
              <Badge tone="danger" size="xs">C. Pompeyo {fmtCLPCompact(vu.creditoPompeyo)}</Badge>
            )}
            {vu.esJudicial && <Badge tone="danger" size="xs">Judicial</Badge>}
            {vu.enFNE && vu.fneBloqueos.length > 0 && (
              <Badge tone="warning" size="xs">{vu.fneBloqueos[0].descripcion}</Badge>
            )}
          </div>
          {accion && (
            <div className="text-[11.5px] text-[--color-accent] mt-1.5">→ {accion}</div>
          )}
        </div>
        {/* Gestión + link */}
        <div className="shrink-0 flex items-center gap-2 self-center">
          <AbrirCasoButton vin={vu.vinLimpio} origen="Centro de tensión" />
          <Link
            href={`/stock?q=${encodeURIComponent(vu.vinLimpio)}&dup=1`}
            className="text-[--color-fg-dim] hover:text-[--color-accent] transition"
            title="Abrir en el explorador"
          >
            <ExternalLink className="size-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function LineasLista({ lineas }: { lineas: import("@/lib/types").LineaCredito[] }) {
  return (
    <Card>
      <CardBody className="p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="text-[10.5px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1]">
            <tr>
              <th className="text-left font-semibold px-4 py-2.5">Marca</th>
              <th className="text-left font-semibold px-4 py-2.5">Financiera</th>
              <th className="text-right font-semibold px-4 py-2.5">Autorizada</th>
              <th className="text-right font-semibold px-4 py-2.5">Ocupada</th>
              <th className="text-right font-semibold px-4 py-2.5">Libre</th>
              <th className="text-left font-semibold px-4 py-2.5">Acción</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => (
              <tr key={l.marca} className="border-b border-[--color-border-soft] last:border-0">
                <td className="px-4 py-2.5 font-medium text-[12.5px]">{l.marca}</td>
                <td className="px-4 py-2.5 text-[12px] text-[--color-fg-muted]">{l.financiera ?? "—"}</td>
                <td className="px-4 py-2.5 text-right mono text-[12px]">{fmtCLPCompact(l.lineaAutorizada)}</td>
                <td className="px-4 py-2.5 text-right mono text-[12px]">{fmtCLPCompact(l.lineaOcupada)}</td>
                <td className={cn("px-4 py-2.5 text-right mono text-[12px]", l.lineaLibre < 0 ? "text-[--color-danger] font-semibold" : "text-[--color-fg-muted]")}>
                  {fmtCLPCompact(l.lineaLibre)}
                </td>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/stock?marcaOriginadora=${encodeURIComponent(l.marcaPompeyo ?? l.marca)}&tipoStock=FloorPlan`}
                    className="inline-flex items-center gap-1 text-[11px] text-[--color-accent] hover:underline"
                  >
                    Ver Floor Plan <ArrowRight className="size-3" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
