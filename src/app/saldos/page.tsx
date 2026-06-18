"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Car,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileSpreadsheet,
  Gavel,
  HandCoins,
  Landmark,
  Receipt,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { UploadSaldosButton } from "@/components/UploadSaldosButton";
import { FichaGestionDocumental } from "@/components/FichaGestionDocumental";
import { AbrirCasoButton } from "@/components/AbrirCasoButton";
import { useVinContexto, VinContextoBanner } from "@/components/VinContexto";
import { limpiarVIN } from "@/lib/parser/venta-apc";
import { useDatosFiltrados } from "@/lib/marca-filtro";
import { useGestionStore } from "@/lib/gestion/store";
import { getMarcaOperacional, normalizarMarcaOperacional } from "@/lib/selectors/owner-operacional";
import { cn } from "@/lib/cn";
import { fmtCLP, fmtCLPCompact, fmtDate, fmtNum } from "@/lib/format";
import {
  CATEGORIA_DESC,
  CATEGORIA_LABEL,
  STATUS_DPS_LABEL,
  STATUS_DPS_ORDEN,
  STATUS_DPS_TONE,
  SUBTIPO_VEHICULO_LABEL,
  SUBTIPO_VEHICULO_ORDEN,
  cruzarSaldosConStock,
  filtrarSaldos,
  statsSaldos,
  sumSaldos,
} from "@/lib/selectors/saldos";
import { creditoPompeyoSinVIN } from "@/lib/selectors/credito-pompeyo";
import type {
  CategoriaSaldo,
  SaldoCruzado,
  StatusDPS,
  SubTipoSaldoVehiculo,
} from "@/lib/types";

/** Umbral de materialidad para alertas ejecutivas (CLP). */
const UMBRAL_MATERIAL = 1_000_000;

/** Status DPS que cuentan como "vencido / alta presión". */
const STATUS_VENCIDO: StatusDPS[] = ["T4", "T5", "T6", "T7"];

const STATUS_FILL: Record<string, string> = {
  success: "#15a87b",
  info: "#2e90fa",
  warning: "#d97706",
  danger: "#dc2626",
  muted: "#94a3b8",
};

// ── Lectura por familias ──
type FamiliaKey = "financieros" | "credito_pompeyo" | "comerciales" | "judicial" | "servicios";

const FAMILIAS: {
  key: FamiliaKey;
  label: string;
  desc: string;
  subs: SubTipoSaldoVehiculo[];
  esServicio?: boolean;
  strip: string;
  text: string;
  icon: React.ReactNode;
}[] = [
  {
    key: "financieros",
    label: "Financieros externos",
    desc: "Financieras · leasing · compañías de seguro.",
    subs: ["financieras", "leasing", "seguros"],
    strip: "strip-info",
    text: "text-[--color-info]",
    icon: <Landmark className="size-3.5" strokeWidth={1.75} />,
  },
  {
    key: "credito_pompeyo",
    label: "Crédito Pompeyo",
    desc: "Caja propia comprometida en la operación del cliente.",
    subs: ["credito_pompeyo"],
    strip: "strip-operativo",
    text: "text-[--color-accent]",
    icon: <HandCoins className="size-3.5" strokeWidth={1.75} />,
  },
  {
    key: "comerciales",
    label: "Comerciales / marcas",
    desc: "Buy back · acuerdo comercial · OC marca · flotas · traspasos.",
    subs: ["buy_back", "acuerdo_comercial", "oc_marca", "flotas", "traspasos_dealer"],
    strip: "strip-warning",
    text: "text-[--color-warning]",
    icon: <Building2 className="size-3.5" strokeWidth={1.75} />,
  },
  {
    key: "judicial",
    label: "Judicial",
    desc: "Bloqueado legalmente — seguimiento jurídico aparte.",
    subs: ["judicial"],
    strip: "strip-judicial",
    text: "text-[#7c2d12]",
    icon: <Gavel className="size-3.5" strokeWidth={1.75} />,
  },
  {
    key: "servicios",
    label: "Servicios postventa",
    desc: "Servicio técnico — no es capital de trabajo de ventas.",
    subs: [],
    esServicio: true,
    strip: "strip-muted",
    text: "text-[--color-fg-muted]",
    icon: <Wrench className="size-3.5" strokeWidth={1.75} />,
  },
];

const FAM_BY_KEY = Object.fromEntries(FAMILIAS.map((f) => [f.key, f])) as Record<
  FamiliaKey,
  (typeof FAMILIAS)[number]
>;

export default function SaldosPage() {
  const { data, saldos } = useDatosFiltrados();

  useEffect(() => {
    useGestionStore.getState().hydrate();
  }, []);

  if (!saldos) {
    return (
      <div className="max-w-3xl mx-auto px-10 py-16 fade-in">
        <Card variant="glass">
          <CardBody className="p-10">
            <EmptyState
              icon={<FileSpreadsheet className="size-7" />}
              title="Carga el archivo Reportes Saldos 2.0"
              description="El módulo Saldos cruza por Cajón ↔ VIN contra el stock y FNE. Súbelo para ver qué hay por cobrar: vehículos, bonos/comisiones, crédito Pompeyo, judicial y servicios."
              action={
                <div className="space-y-4 mt-2">
                  <UploadSaldosButton />
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
      <SaldosInner />
    </Suspense>
  );
}

function SaldosInner() {
  const { data, fne, saldos } = useDatosFiltrados();
  const parsed = saldos!;

  const cruzados = useMemo(
    () =>
      cruzarSaldosConStock(
        parsed.registros,
        data?.vehiculos ?? [],
        data?.vinsExtra ?? null,
        fne,
      ),
    [parsed.registros, data?.vehiculos, data?.vinsExtra, fne],
  );

  const stats = useMemo(() => statsSaldos(cruzados), [cruzados]);
  const cpSinVIN = useMemo(() => creditoPompeyoSinVIN(cruzados), [cruzados]);
  const cpSinVINMonto = useMemo(
    () => cpSinVIN.reduce((s, r) => s + r.cPompeyoCLP, 0),
    [cpSinVIN],
  );

  // ── Estado de filtros (declarado primero: todos los KPIs dependen de sucursal) ──
  const [filtroCategoria, setFiltroCategoria] = useState<"todos" | CategoriaSaldo>("todos");
  const [filtroSubTipo, setFiltroSubTipo] = useState<"todos" | SubTipoSaldoVehiculo>("todos");
  const [filtroFamilia, setFiltroFamilia] = useState<FamiliaKey | null>(null);
  const [filtroStatuses, setFiltroStatuses] = useState<StatusDPS[] | null>(null);
  const [soloOperacional, setSoloOperacional] = useState(false);
  const [filtroSucursal, setFiltroSucursal] = useState<string>("todos");
  const [incluirServicios, setIncluirServicios] = useState(false);

  const detalleRef = useRef<HTMLDivElement>(null);
  const irADetalle = () => {
    requestAnimationFrame(() =>
      detalleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  // Navegación contextual por VIN (?vin=XXXX desde el caso operacional).
  const vinCtx = useVinContexto();
  useEffect(() => {
    if (vinCtx) detalleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [vinCtx]);

  // Tabla = MISMO selector único que los KPIs. Con ?vin= muestra SOLO ese caso.
  const filtrado = useMemo(
    () =>
      vinCtx
        ? cruzados.filter((c) => limpiarVIN(c.saldo.vinResuelto ?? "") === vinCtx)
        : filtrarSaldos(cruzados, {
            incluirServicios,
            soloOperacional,
            sucursal: filtroSucursal,
            statuses: filtroStatuses,
            familiaSubs:
              filtroFamilia && !FAM_BY_KEY[filtroFamilia].esServicio
                ? FAM_BY_KEY[filtroFamilia].subs
                : null,
            familiaServicio: filtroFamilia ? FAM_BY_KEY[filtroFamilia].esServicio : false,
            categoria: filtroFamilia ? "todos" : filtroCategoria,
            subTipo: filtroFamilia ? "todos" : filtroSubTipo,
          }),
    [cruzados, vinCtx, incluirServicios, soloOperacional, filtroSucursal, filtroStatuses, filtroFamilia, filtroCategoria, filtroSubTipo],
  );

  // Aging operacional — MISMO selector (excluye judicial+servicios, respeta sucursal).
  // El conteo de cada tramo = exactamente lo que muestra la tabla al hacer clic.
  const agingOperacional = useMemo(() => {
    const m = Object.fromEntries(
      STATUS_DPS_ORDEN.map((k) => [k, { unidades: 0, saldoCLP: 0 }]),
    ) as Record<StatusDPS, { unidades: number; saldoCLP: number }>;
    for (const k of STATUS_DPS_ORDEN) {
      const set = filtrarSaldos(cruzados, {
        soloOperacional: true,
        incluirServicios: false,
        sucursal: filtroSucursal,
        statuses: [k],
      });
      m[k] = { unidades: set.length, saldoCLP: sumSaldos(set) };
    }
    return m;
  }, [cruzados, filtroSucursal]);

  const vencido = useMemo(() => {
    const set = filtrarSaldos(cruzados, {
      soloOperacional: true,
      incluirServicios: false,
      sucursal: filtroSucursal,
      statuses: STATUS_VENCIDO,
    });
    return { u: set.length, c: sumSaldos(set) };
  }, [cruzados, filtroSucursal]);

  const judicial = useMemo(() => {
    const items = filtrarSaldos(cruzados, { familiaSubs: ["judicial"], sucursal: filtroSucursal });
    const conDias = items.filter((c) => c.saldo.diasArchivo != null);
    const agingProm =
      conDias.length > 0
        ? Math.round(conDias.reduce((s, c) => s + (c.saldo.diasArchivo ?? 0), 0) / conDias.length)
        : 0;
    const marcaMap = new Map<string, number>();
    for (const c of items) {
      // Marca operacional: prefiere el owner del vehículo; marcas ajenas → OTRAS.
      const k = c.vehiculo ? getMarcaOperacional(c.vehiculo) : normalizarMarcaOperacional(c.saldo.marca);
      marcaMap.set(k, (marcaMap.get(k) ?? 0) + c.saldo.saldoXDocumentar);
    }
    const topMarcas = [...marcaMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
    return { unidades: items.length, monto: sumSaldos(items), agingProm, topMarcas };
  }, [cruzados, filtroSucursal]);

  const cp = useMemo(() => {
    const set = filtrarSaldos(cruzados, { familiaSubs: ["credito_pompeyo"], sucursal: filtroSucursal });
    return { u: set.length, c: sumSaldos(set) };
  }, [cruzados, filtroSucursal]);

  const serviciosKpi = useMemo(() => {
    const set = filtrarSaldos(cruzados, {
      familiaServicio: true,
      incluirServicios: true,
      sucursal: filtroSucursal,
    });
    return { u: set.length, c: sumSaldos(set) };
  }, [cruzados, filtroSucursal]);

  const familias = useMemo(
    () =>
      FAMILIAS.map((f) => {
        const set = f.esServicio
          ? filtrarSaldos(cruzados, { familiaServicio: true, incluirServicios: true, sucursal: filtroSucursal })
          : filtrarSaldos(cruzados, { familiaSubs: f.subs, sucursal: filtroSucursal });
        return { ...f, unidades: set.length, saldo: sumSaldos(set) };
      }),
    [cruzados, filtroSucursal],
  );

  const sucursales = useMemo(() => {
    const set = new Set<string>();
    for (const c of cruzados) if (c.saldo.sucursal) set.add(c.saldo.sucursal);
    return [...set].sort();
  }, [cruzados]);

  // ── Selectores (mutuamente coherentes con el universo de cada vista) ──
  const selFamilia = (k: FamiliaKey) => {
    const next = filtroFamilia === k ? null : k;
    setFiltroFamilia(next);
    setFiltroSubTipo("todos");
    setFiltroCategoria("todos");
    setFiltroStatuses(null);
    setSoloOperacional(false);
    if (next && FAM_BY_KEY[next].esServicio) setIncluirServicios(true);
    if (next) irADetalle();
  };
  const selCategoria = (k: CategoriaSaldo) => {
    setFiltroCategoria(filtroCategoria === k ? "todos" : k);
    setFiltroFamilia(null);
    setFiltroStatuses(null);
    setSoloOperacional(false);
    if (k === "servicio") setIncluirServicios(true);
    irADetalle();
  };
  const selSubTipo = (k: SubTipoSaldoVehiculo) => {
    setFiltroSubTipo(filtroSubTipo === k ? "todos" : k);
    setFiltroFamilia(null);
    setFiltroStatuses(null);
    setSoloOperacional(false);
    irADetalle();
  };
  const selStatus = (k: StatusDPS) => {
    const isSame = filtroStatuses?.length === 1 && filtroStatuses[0] === k;
    setFiltroStatuses(isSame ? null : [k]);
    setSoloOperacional(!isSame);
    setFiltroFamilia(null);
    setFiltroCategoria("todos");
    setFiltroSubTipo("todos");
    setIncluirServicios(false);
    irADetalle();
  };
  const selVencido = () => {
    const isSame =
      !!filtroStatuses &&
      filtroStatuses.length === STATUS_VENCIDO.length &&
      STATUS_VENCIDO.every((s) => filtroStatuses.includes(s));
    setFiltroStatuses(isSame ? null : STATUS_VENCIDO);
    setSoloOperacional(!isSame);
    setFiltroFamilia(null);
    setFiltroCategoria("todos");
    setFiltroSubTipo("todos");
    setIncluirServicios(false);
    irADetalle();
  };

  const capitalTrabajo =
    stats.porCategoria.vehiculo.saldoCLP + stats.porCategoria.bono_comision.saldoCLP;
  const unidadesCapitalTrabajo =
    stats.porCategoria.vehiculo.unidades + stats.porCategoria.bono_comision.unidades;
  const cpMonto = cp.c;
  const maxAging = Math.max(...STATUS_DPS_ORDEN.map((k) => agingOperacional[k].saldoCLP), 1);

  return (
    <div className="max-w-[1400px] mx-auto px-10 py-10 space-y-7 fade-in">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-[--color-border] bg-gradient-to-br from-[#f5f0ff] via-[#eff6ff] to-white px-10 py-8">
        <div className="absolute -top-12 -right-12 size-56 rounded-full bg-[--color-accent] opacity-[0.12] blur-3xl pointer-events-none" />
        <div className="relative flex items-start justify-between gap-6 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[--color-accent] font-semibold">
              <Receipt className="size-3.5" strokeWidth={2} />
              Fuente oficial · Reportes Saldos 2.0
            </div>
            <h1 className="text-[28px] font-semibold tracking-tight mt-2 leading-tight text-[--color-fg]">
              Saldos · Capital de Trabajo
            </h1>
            <p className="text-[14px] text-[--color-fg-muted] mt-2 max-w-2xl leading-relaxed">
              Qué hay por cobrar y qué requiere acción. El judicial se sigue aparte (legal) y los
              servicios post-venta no entran al capital de trabajo de ventas.
            </p>
          </div>
          <UploadSaldosButton compact />
        </div>
      </div>

      {/* KPI hero */}
      <div className="surface top-strip strip-info bg-white px-8 pt-7 pb-7">
        <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr] gap-6 md:gap-10 items-end">
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-info] font-semibold">
              Capital de trabajo por cobrar
            </div>
            <div className="display text-[48px] mt-3 leading-none text-[--color-fg]">
              {fmtCLPCompact(capitalTrabajo)}
            </div>
            <div className="text-[13.5px] text-[--color-fg-muted] mt-3 leading-relaxed">
              <span className="text-[--color-fg] font-semibold">
                {fmtNum(unidadesCapitalTrabajo)} registros
              </span>{" "}
              · vehículos + bonos · {fmtCLP(capitalTrabajo)}
            </div>
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
              Saldos de vehículos
            </div>
            <div className="display text-[28px] mt-2 leading-none text-[--color-fg]">
              {fmtCLPCompact(stats.porCategoria.vehiculo.saldoCLP)}
            </div>
            <div className="text-[12px] text-[--color-fg-muted] mt-2 leading-relaxed">
              {fmtNum(stats.porCategoria.vehiculo.unidades)} unidades ·{" "}
              {fmtNum(stats.vehiculoCruzados)} con VIN cruzado
            </div>
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
              Bonos · incentivos · comisiones
            </div>
            <div className="display text-[28px] mt-2 leading-none text-[--color-fg]">
              {fmtCLPCompact(stats.porCategoria.bono_comision.saldoCLP)}
            </div>
            <div className="text-[12px] text-[--color-fg-muted] mt-2 leading-relaxed">
              {fmtNum(stats.porCategoria.bono_comision.unidades)} facturas · sin VIN
            </div>
          </div>
        </div>
      </div>

      {/* KPIs de acción */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MiniKpi
          label="Vencido (alta presión)"
          value={fmtCLPCompact(vencido.c)}
          sub={`${fmtNum(vencido.u)} saldos T4+ · acción inmediata`}
          tone={vencido.c > 0 ? "danger" : "success"}
          onClick={selVencido}
        />
        <MiniKpi
          label="Crédito Pompeyo"
          value={fmtCLPCompact(cpMonto)}
          sub={`${fmtNum(cp.u)} saldos`}
          tone="accent"
          onClick={() => selFamilia("credito_pompeyo")}
        />
        <MiniKpi
          label="Judicial"
          value={fmtCLPCompact(judicial.monto)}
          sub={`${fmtNum(judicial.unidades)} unidades · legal`}
          tone="judicial"
          onClick={() => selFamilia("judicial")}
        />
        <MiniKpi
          label="Servicios postventa"
          value={fmtCLPCompact(serviciosKpi.c)}
          sub={`${fmtNum(serviciosKpi.u)} · fuera de ventas`}
          tone="muted"
          onClick={() => selFamilia("servicios")}
        />
      </div>

      {/* Crédito Pompeyo sin VIN — materialidad */}
      {cpSinVIN.length > 0 &&
        (cpSinVINMonto >= UMBRAL_MATERIAL ? (
          <Link
            href="/capital-trabajo"
            className="surface surface-hover top-strip strip-warning group block bg-white px-7 py-5"
          >
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-[11px] uppercase tracking-[0.14em] text-[--color-warning] font-semibold">
                  Crédito Pompeyo sin VIN
                </div>
                <div className="text-[14px] text-[--color-fg] font-medium mt-0.5">
                  {fmtNum(cpSinVIN.length)} saldos · {fmtCLPCompact(cpSinVINMonto)} sin auto
                  asociado
                </div>
                <div className="text-[12px] text-[--color-fg-muted] mt-0.5">
                  Monto material identificado como crédito Pompeyo pero el Cajón no cruzó con
                  ningún VIN. Requiere conciliación.
                </div>
              </div>
              <div className="flex items-center gap-1 text-[13px] text-[--color-warning] font-medium group-hover:gap-2 transition-all">
                Ver detalle <ArrowRight className="size-4" />
              </div>
            </div>
          </Link>
        ) : (
          <div className="text-[12px] text-[--color-fg-muted] px-4 py-2.5 rounded-lg bg-[--color-bg-elev-2] border border-[--color-border-soft] flex items-center gap-2">
            <span className="inline-block size-1.5 rounded-full bg-[--color-fg-dim]" />
            Observación menor (Auditoría): {fmtNum(cpSinVIN.length)} saldo
            {cpSinVIN.length > 1 ? "s" : ""} de Crédito Pompeyo sin VIN ·{" "}
            {fmtCLPCompact(cpSinVINMonto)} — monto no material.
          </div>
        ))}

      {/* Lectura por familias */}
      <div>
        <div className="mb-3">
          <h2 className="text-[18px] font-semibold tracking-tight text-[--color-fg]">
            Lectura por familias
          </h2>
          <p className="text-[12.5px] text-[--color-fg-muted] mt-1">
            Agrupación rápida del capital por origen. Clic para filtrar el detalle abajo.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {familias.map((f) => (
            <button
              key={f.key}
              onClick={() => selFamilia(f.key)}
              disabled={f.unidades === 0}
              className={cn(
                "surface top-strip bg-white px-4 pt-5 pb-4 text-left transition flex flex-col",
                f.strip,
                f.unidades === 0 && "opacity-50 cursor-default",
                f.unidades > 0 && "surface-hover",
                filtroFamilia === f.key && "ring-2 ring-[--color-accent]/40 border-[--color-accent]",
              )}
            >
              <div className={cn("flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.1em] font-semibold", f.text)}>
                {f.icon}
                <span className="truncate">{f.label}</span>
              </div>
              <div className="display text-[22px] mt-2.5 leading-none text-[--color-fg]">
                {fmtCLPCompact(f.saldo)}
              </div>
              <div className="text-[11px] text-[--color-fg-muted] mt-1.5">
                {fmtNum(f.unidades)} registros
              </div>
              <div className="text-[10.5px] text-[--color-fg-dim] mt-1.5 leading-snug line-clamp-2">
                {f.desc}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Categorías macro */}
      <Card>
        <CardHeader>
          <CardTitle>Categorías de saldo</CardTitle>
          <CardDescription>
            Tres categorías mutuamente excluyentes. Solo vehículos cruzan por VIN. Clic para
            filtrar el detalle.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <CategoriaCard
              icon={<Car className="size-4" />}
              label={CATEGORIA_LABEL.vehiculo}
              desc={CATEGORIA_DESC.vehiculo}
              unidades={stats.porCategoria.vehiculo.unidades}
              saldo={stats.porCategoria.vehiculo.saldoCLP}
              tone="info"
              active={filtroCategoria === "vehiculo" && !filtroFamilia}
              onClick={() => selCategoria("vehiculo")}
            />
            <CategoriaCard
              icon={<Receipt className="size-4" />}
              label={CATEGORIA_LABEL.bono_comision}
              desc={CATEGORIA_DESC.bono_comision}
              unidades={stats.porCategoria.bono_comision.unidades}
              saldo={stats.porCategoria.bono_comision.saldoCLP}
              tone="warning"
              active={filtroCategoria === "bono_comision" && !filtroFamilia}
              onClick={() => selCategoria("bono_comision")}
            />
            <CategoriaCard
              icon={<Wrench className="size-4" />}
              label={CATEGORIA_LABEL.servicio}
              desc={CATEGORIA_DESC.servicio}
              unidades={stats.porCategoria.servicio.unidades}
              saldo={stats.porCategoria.servicio.saldoCLP}
              tone="muted"
              active={filtroCategoria === "servicio" && !filtroFamilia}
              onClick={() => selCategoria("servicio")}
            />
          </div>
        </CardBody>
      </Card>

      {/* Sub-tipos de vehículo (judicial va aparte) */}
      <Card>
        <CardHeader>
          <CardTitle>Saldos de vehículos · por sub-tipo</CardTitle>
          <CardDescription>
            El judicial se muestra en su propio bloque. Clic para filtrar el detalle.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {SUBTIPO_VEHICULO_ORDEN.filter((k) => k !== "judicial").map((k) => {
              const b = stats.porSubTipoVehiculo[k];
              if (!b || b.unidades === 0) return null;
              const active = filtroSubTipo === k && !filtroFamilia;
              return (
                <button
                  key={k}
                  onClick={() => selSubTipo(k)}
                  className={cn(
                    "rounded-xl border px-4 py-3 text-left transition",
                    active
                      ? "border-[--color-accent] bg-[--color-bg-elev-3] ring-2 ring-[--color-accent]/40"
                      : "border-[--color-border] bg-[--color-bg-elev-2] hover:border-[--color-border-strong]",
                  )}
                >
                  <div className="text-[10.5px] uppercase tracking-[0.12em] text-[--color-fg-muted] font-medium truncate">
                    {SUBTIPO_VEHICULO_LABEL[k]}
                  </div>
                  <div className="mono text-[22px] font-semibold mt-1 text-[--color-fg]">
                    {fmtNum(b.unidades)}
                  </div>
                  <div className="text-[11px] text-[--color-fg-muted] mt-1 mono">
                    {fmtCLPCompact(b.saldoCLP)}
                  </div>
                </button>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* Judicial — bloque separado */}
      {judicial.unidades > 0 && (
        <button
          onClick={() => selFamilia("judicial")}
          className={cn(
            "surface surface-hover top-strip strip-judicial bg-white px-7 py-5 text-left w-full block",
            filtroFamilia === "judicial" && "ring-2 ring-[--color-accent]/40 border-[--color-accent]",
          )}
        >
          <div className="flex items-start gap-4 flex-wrap">
            <div className="size-10 rounded-xl bg-[#7c2d12]/10 grid place-items-center shrink-0">
              <Gavel className="size-5 text-[#7c2d12]" strokeWidth={1.75} />
            </div>
            <div className="flex-1 min-w-[240px]">
              <div className="text-[10.5px] uppercase tracking-[0.13em] text-[#7c2d12] font-semibold">
                Capital judicial · seguimiento jurídico
              </div>
              <div className="display text-[28px] mt-1.5 leading-none text-[--color-fg]">
                {fmtCLPCompact(judicial.monto)}
              </div>
              <div className="text-[12px] text-[--color-fg-muted] mt-1.5 leading-relaxed">
                {fmtNum(judicial.unidades)} unidades · aging legal {judicial.agingProm}d prom. No
                contamina el aging financiero operativo — su recuperabilidad depende del proceso
                legal.
              </div>
              {judicial.topMarcas.length > 0 && (
                <div className="text-[11px] text-[--color-fg-dim] mt-1.5">
                  Top marcas: {judicial.topMarcas.join(" · ")}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 text-[13px] text-[#7c2d12] font-medium">
              Ver y gestionar <ArrowRight className="size-4" />
            </div>
          </div>
        </button>
      )}

      {/* Aging financiero operacional (heatmap, sin judicial) */}
      <div>
        <div className="mb-3">
          <h2 className="text-[18px] font-semibold tracking-tight text-[--color-fg]">
            Aging financiero operacional
          </h2>
          <p className="text-[12.5px] text-[--color-fg-muted] mt-1">
            Días desde vencimiento · sin judiciales. T4+ es alta presión. Clic para filtrar.
          </p>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
          {STATUS_DPS_ORDEN.map((k) => {
            const b = agingOperacional[k];
            if (b.unidades === 0) return null;
            const active = filtroStatuses?.length === 1 && filtroStatuses[0] === k;
            const tone = STATUS_DPS_TONE[k];
            const fill = STATUS_FILL[tone] ?? "#94a3b8";
            const intensidad = 0.08 + 0.34 * (b.saldoCLP / maxAging);
            const numColor =
              tone === "danger"
                ? "text-[--color-danger]"
                : tone === "warning"
                  ? "text-[--color-warning]"
                  : tone === "info"
                    ? "text-[--color-info]"
                    : "text-[--color-fg]";
            return (
              <button
                key={k}
                onClick={() => selStatus(k)}
                className={cn(
                  "rounded-xl border px-3 pt-3.5 pb-3 text-left transition",
                  active
                    ? "border-[--color-accent] ring-2 ring-[--color-accent]/40 -translate-y-0.5"
                    : "border-[--color-border] hover:border-[--color-border-strong]",
                )}
                style={{
                  backgroundColor: `${fill}${Math.round(intensidad * 255)
                    .toString(16)
                    .padStart(2, "0")}`,
                }}
              >
                <div className="text-[10px] uppercase tracking-[0.08em] text-[--color-fg-muted] font-medium truncate">
                  {STATUS_DPS_LABEL[k]}
                </div>
                <div className={cn("display text-[20px] mt-1 leading-none", numColor)}>
                  {fmtNum(b.unidades)}
                </div>
                <div className="text-[10.5px] text-[--color-fg-muted] mt-1 mono truncate">
                  {fmtCLPCompact(b.saldoCLP)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filtros + Tabla */}
      <div ref={detalleRef} className="scroll-mt-6 space-y-4">
        {vinCtx && (
          <VinContextoBanner
            vin={vinCtx}
            presentes={filtrado.length}
            extra={
              filtrado.length > 0
                ? fmtCLPCompact(filtrado.reduce((s, c) => s + c.saldo.saldoXDocumentar, 0))
                : undefined
            }
          />
        )}
        <div className="surface bg-white px-5 py-4 flex flex-wrap items-center gap-3">
          <div className="text-[10.5px] uppercase tracking-[0.12em] text-[--color-fg-muted] font-medium">
            Filtros
          </div>
          <select
            value={filtroSucursal}
            onChange={(e) => setFiltroSucursal(e.target.value)}
            className="rounded-md border border-[--color-border-strong] bg-white px-2.5 py-1 text-[12.5px] hover:border-[--color-accent]/40 transition"
          >
            <option value="todos">Sucursal · todas</option>
            {sucursales.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[12px] text-[--color-fg-muted] cursor-pointer">
            <input
              type="checkbox"
              checked={incluirServicios}
              onChange={(e) => setIncluirServicios(e.target.checked)}
              className="accent-[--color-accent]"
            />
            Incluir servicios post-venta
          </label>
          {filtroFamilia && (
            <FiltroChip
              label={`Familia: ${FAM_BY_KEY[filtroFamilia].label}`}
              onClear={() => setFiltroFamilia(null)}
            />
          )}
          {filtroCategoria !== "todos" && (
            <FiltroChip
              label={`Categoría: ${CATEGORIA_LABEL[filtroCategoria]}`}
              onClear={() => setFiltroCategoria("todos")}
            />
          )}
          {filtroSubTipo !== "todos" && (
            <FiltroChip
              label={`Sub-tipo: ${SUBTIPO_VEHICULO_LABEL[filtroSubTipo]}`}
              onClear={() => setFiltroSubTipo("todos")}
            />
          )}
          {filtroStatuses && filtroStatuses.length > 0 && (
            <FiltroChip
              label={
                filtroStatuses.length === 1
                  ? `Aging: ${STATUS_DPS_LABEL[filtroStatuses[0]]}`
                  : `Aging: vencido (T4+) · ${filtroStatuses.length} tramos`
              }
              onClear={() => {
                setFiltroStatuses(null);
                setSoloOperacional(false);
              }}
            />
          )}
          {soloOperacional && (
            <span className="text-[10.5px] text-[--color-fg-dim] italic">
              universo operacional (sin judicial)
            </span>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              Detalle — {fmtNum(filtrado.length)} {filtrado.length === 1 ? "saldo" : "saldos"} ·{" "}
              {fmtCLPCompact(filtrado.reduce((s, c) => s + c.saldo.saldoXDocumentar, 0))}
            </CardTitle>
            <CardDescription>
              Gestión por VIN cuando cruza, o por Cajón/Nota cuando no. La gestión por VIN se
              comparte con Dashboard, Centro de Acción y FNE.
            </CardDescription>
          </CardHeader>
          <CardBody className="p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[1500px]">
              <thead className="text-[10.5px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1]">
                <tr>
                  <th className="text-left font-semibold px-4 py-3">Cliente · N° Nota</th>
                  <th className="text-left font-semibold px-4 py-3">Cajón / VIN</th>
                  <th className="text-left font-semibold px-4 py-3">Marca · Modelo</th>
                  <th className="text-left font-semibold px-4 py-3">Sub-tipo</th>
                  <th className="text-left font-semibold px-4 py-3">Status</th>
                  <th className="text-right font-semibold px-4 py-3">Días</th>
                  <th className="text-left font-semibold px-4 py-3">Vencimiento</th>
                  <th className="text-right font-semibold px-4 py-3">Saldo</th>
                  <th className="text-left font-semibold px-4 py-3">E° Pago</th>
                  <th className="text-left font-semibold px-4 py-3">Gestión</th>
                  <th className="text-left font-semibold px-4 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtrado.slice(0, 200).map((c, idx) => (
                  <SaldoRow key={`${c.saldo.rowIndex}`} c={c} idx={idx} />
                ))}
              </tbody>
            </table>
            {filtrado.length > 200 && (
              <div className="px-4 py-3 text-[11.5px] text-[--color-fg-muted] border-t border-[--color-border-soft] bg-[--color-bg-elev-1]">
                Mostrando primeros 200 de {fmtNum(filtrado.length)}. Refina filtros para ver el
                resto.
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function MiniKpi({
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "danger" | "accent" | "judicial" | "muted" | "success";
  onClick: () => void;
}) {
  const strip =
    tone === "danger"
      ? "strip-danger"
      : tone === "accent"
        ? "strip-operativo"
        : tone === "judicial"
          ? "strip-judicial"
          : tone === "success"
            ? "strip-success"
            : "strip-muted";
  const text =
    tone === "danger"
      ? "text-[--color-danger]"
      : tone === "accent"
        ? "text-[--color-accent]"
        : tone === "judicial"
          ? "text-[#7c2d12]"
          : tone === "success"
            ? "text-[--color-success]"
            : "text-[--color-fg-muted]";
  return (
    <button
      onClick={onClick}
      className={cn("surface surface-hover top-strip bg-white px-5 pt-5 pb-4 text-left", strip)}
    >
      <div className={cn("text-[10.5px] uppercase tracking-[0.12em] font-semibold", text)}>
        {label}
      </div>
      <div className="display text-[26px] mt-2 leading-none text-[--color-fg]">{value}</div>
      <div className="text-[11px] text-[--color-fg-muted] mt-1.5 leading-snug">{sub}</div>
    </button>
  );
}

function CategoriaCard({
  icon,
  label,
  desc,
  unidades,
  saldo,
  tone,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  unidades: number;
  saldo: number;
  tone: "info" | "warning" | "muted";
  active: boolean;
  onClick: () => void;
}) {
  const stripClass = tone === "info" ? "strip-info" : tone === "warning" ? "strip-warning" : "strip-muted";
  const accentText =
    tone === "info"
      ? "text-[--color-info]"
      : tone === "warning"
        ? "text-[--color-warning]"
        : "text-[--color-fg-muted]";
  return (
    <button
      onClick={onClick}
      disabled={unidades === 0}
      className={cn(
        "surface top-strip bg-white px-5 pt-6 pb-5 text-left transition",
        stripClass,
        unidades === 0 && "opacity-50 cursor-default",
        unidades > 0 && "surface-hover",
        active && "ring-2 ring-[--color-accent]/50 -translate-y-0.5",
      )}
    >
      <div className={cn("flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] font-semibold", accentText)}>
        {icon}
        {label}
      </div>
      <div className="display text-[32px] mt-3 leading-none text-[--color-fg]">
        {fmtCLPCompact(saldo)}
      </div>
      <div className="text-[12px] text-[--color-fg-muted] mt-2">{fmtNum(unidades)} registros</div>
      <div className="text-[11.5px] text-[--color-fg-dim] mt-2 leading-snug line-clamp-2">{desc}</div>
    </button>
  );
}

function FiltroChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[--color-accent]/10 text-[--color-accent] text-[11.5px] font-medium border border-[--color-accent]/20">
      {label}
      <button onClick={onClear} className="hover:bg-[--color-accent]/15 rounded p-0.5" aria-label="Quitar">
        ✕
      </button>
    </span>
  );
}

function SaldoRow({ c, idx }: { c: SaldoCruzado; idx: number }) {
  const s = c.saldo;
  const v = c.vehiculo;
  const ext = c.vehiculoExtra;
  const d = s.diasArchivo ?? 0;
  const sev: "danger" | "warning" | null = d > 120 ? "danger" : d > 60 ? "warning" : null;
  // Gestión por VIN, o por Cajón/Nota cuando no hay VIN.
  const gestionKey = s.vinResuelto
    ? s.vinResuelto
    : s.cajonLimpio
      ? `CAJON-${s.cajonLimpio}`
      : s.numNota != null
        ? `NOTA-${s.numNota}`
        : null;
  // Caso documental (sin VIN): gestión grande estándar inline (reemplaza el
  // popover chico). La clave (CAJON-/NOTA-) se conserva tal cual para no perder
  // la gestión ya guardada.
  const esDoc = !s.vinResuelto && !!gestionKey;
  const [casoAbierto, setCasoAbierto] = useState(false);

  return (
    <>
    <tr
      className={cn(
        "border-b border-[--color-border-soft] last:border-0 align-top transition",
        idx % 2 === 0 ? "bg-white hover:bg-[--color-bg-elev-1]" : "bg-[--color-bg-elev-1]/40 hover:bg-[--color-bg-elev-1]",
        sev === "danger" && "shadow-[inset_3px_0_0_var(--color-danger)]",
        sev === "warning" && "shadow-[inset_3px_0_0_var(--color-warning)]",
      )}
    >
      <td className="px-4 py-3">
        <div className="font-medium text-[13px] text-[--color-fg] truncate max-w-[220px]">
          {s.cliente ?? "—"}
        </div>
        <div className="text-[11.5px] text-[--color-fg-muted] truncate max-w-[220px] mt-0.5">
          {s.numNota ? `Nota ${s.numNota}` : "—"} · {s.vendedor ?? ""}
        </div>
      </td>
      <td className="px-4 py-3 text-[11.5px]">
        <div className="mono text-[--color-fg]">{s.cajon ?? "—"}</div>
        {s.vinResuelto ? (
          <div className="mono text-[10.5px] text-[--color-fg-muted] mt-0.5 truncate max-w-[180px]">
            VIN: {s.vinResuelto}
          </div>
        ) : s.categoria === "vehiculo" ? (
          <div className="text-[10.5px] text-[--color-fg-dim] italic mt-0.5">Sin cruce VIN</div>
        ) : null}
      </td>
      <td className="px-4 py-3">
        <div className="text-[13px] text-[--color-fg]">{s.marca ?? v?.marca ?? ext?.marca ?? "—"}</div>
        <div className="text-[11.5px] text-[--color-fg-muted] truncate max-w-[200px] mt-0.5">
          {s.modelo ?? v?.modelo ?? ext?.modelo ?? "—"}
        </div>
      </td>
      <td className="px-4 py-3 text-[11.5px] text-[--color-fg-muted]">
        {s.categoria === "vehiculo"
          ? SUBTIPO_VEHICULO_LABEL[s.subTipo as SubTipoSaldoVehiculo] ?? s.subTipo
          : s.subTipo}
      </td>
      <td className="px-4 py-3">
        <Badge tone={STATUS_DPS_TONE[s.statusDPS]} size="xs">
          {STATUS_DPS_LABEL[s.statusDPS]}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right mono text-[12.5px] text-[--color-fg]">
        {s.diasArchivo ?? <span className="text-[--color-fg-dim]">—</span>}
      </td>
      <td className="px-4 py-3 text-[11.5px] text-[--color-fg-muted]">
        {fmtDate(s.fechaVencimiento) || "—"}
      </td>
      <td className="px-4 py-3 text-right mono text-[12.5px] font-medium text-[--color-fg]">
        {fmtCLP(s.saldoXDocumentar)}
      </td>
      <td className="px-4 py-3 text-[11.5px]">
        {s.estadoPago ? (
          <Badge tone={/vigente/i.test(s.estadoPago) ? "warning" : "muted"} size="xs">
            {s.estadoPago}
          </Badge>
        ) : (
          <span className="text-[--color-fg-dim]">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        {s.vinResuelto ? (
          <AbrirCasoButton vin={limpiarVIN(s.vinResuelto)} origen="Saldos" />
        ) : esDoc ? (
          <button
            type="button"
            onClick={() => setCasoAbierto((vv) => !vv)}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold transition",
              casoAbierto
                ? "border-[--color-accent] bg-[--color-accent]/10 text-[--color-accent]"
                : "border-[--color-border-strong] bg-white text-[--color-fg] hover:bg-[--color-bg-elev-1]",
            )}
          >
            {casoAbierto ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {casoAbierto ? "Cerrar caso" : "Gestionar"}
          </button>
        ) : (
          <span className="text-[--color-fg-dim] text-[11px] italic">N/A</span>
        )}
      </td>
      <td className="px-4 py-3">
        {s.vinResuelto ? (
          <Link
            href={`/stock?q=${encodeURIComponent(s.vinResuelto)}&dup=1`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[--color-border] text-[11px] text-[--color-fg-muted] hover:text-[--color-accent] hover:border-[--color-accent]/40 hover:bg-[--color-accent]/5 transition"
          >
            Stock
            <ExternalLink className="size-3" />
          </Link>
        ) : (
          <span className="text-[--color-fg-dim] text-[11px]">—</span>
        )}
      </td>
    </tr>
    {esDoc && casoAbierto && gestionKey && (
      <tr className="border-b border-[--color-border-soft]">
        <td colSpan={11} className="px-4 py-4 bg-[--color-bg-elev-1]/60">
          <FichaGestionDocumental
            clave={gestionKey}
            titulo={`Saldo · ${s.cliente ?? (s.numNota ? `Nota ${s.numNota}` : s.cajon ?? "vehículo")}`}
            subtitulo={[s.subTipo, s.statusDPS].filter(Boolean).join(" · ") || null}
            descripcionCaso={[s.marca, s.modelo].filter(Boolean).join(" ") || s.subTipo || null}
            datos={[
              { label: "Monto", valor: fmtCLP(s.saldoXDocumentar) },
              { label: "Status DPS", valor: s.statusDPS ?? "—" },
              { label: "Sub-tipo", valor: s.subTipo ?? "—" },
              { label: "Días", valor: s.diasArchivo != null ? `${s.diasArchivo}d` : "—" },
              { label: "Vencimiento", valor: fmtDate(s.fechaVencimiento) || "—" },
              { label: "Cliente", valor: s.cliente ?? "—" },
              { label: "Cajón", valor: s.cajon ?? "—" },
              { label: "E° Pago", valor: s.estadoPago ?? "—" },
            ]}
          />
        </td>
      </tr>
    )}
    </>
  );
}
