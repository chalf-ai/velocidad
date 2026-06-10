"use client";

import { Fragment, Suspense, useEffect, useMemo, useState, type ComponentType } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Clock,
  Coins,
  Download,
  Filter,
  RotateCcw,
  Search,
  Warehouse,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterChips } from "@/components/ui/FilterChips";
import { Sheet } from "@/components/ui/Sheet";
import { FichaOperacionalVIN } from "@/components/FichaOperacionalVIN";
import { useVinContexto, VinContextoBanner } from "@/components/VinContexto";
import { useDatosFiltrados, useMarcaFilter } from "@/lib/marca-filtro";
import { useGestionStore } from "@/lib/gestion/store";
import { limpiarVIN } from "@/lib/parser/venta-apc";
import { getCategoriaOperacional, sucursalEsRetailOperacional } from "@/lib/selectors/owner-operacional";
import { cn } from "@/lib/cn";
import { fmtCLP, fmtCLPCompact, fmtNum } from "@/lib/format";
import {
  EMPTY_FILTERS,
  countActiveFilters,
  decodeFilters,
  encodeFilters,
  extractFilterOptions,
  filterVehiculos,
  isFilterActive,
  statsFromFiltered,
  type StockFilters,
} from "@/lib/selectors/stock-filters";
import {
  DESTINO_LABEL,
  ESTADO_LABEL,
  ESTADO_TONE,
  NATURALEZA_LABEL,
  NATURALEZA_TONE,
} from "@/lib/selectors/capital-taxonomia";
import type {
  DestinoOperacional,
  EstadoCapitalOperacional,
  NaturalezaCapital,
  TipoStock,
  UnidadNegocio,
  Vehiculo,
} from "@/lib/types";

const PAGE_SIZE = 200;

const NATURALEZA_ORDER: NaturalezaCapital[] = [
  "puente",
  "operativo",
  "atrapado",
  "judicial",
  "transito",
  "retail",
  "indefinido",
];
const ESTADO_ORDER: EstadoCapitalOperacional[] = [
  "VPP_EXPLICITO",
  "PROCESO_CPD",
  "FNE_EN_OPERACION",
  "PROCESO_VENTA",
  "USADO_PAGADO_INMOVIL",
  "INMOVILIZADO",
  "POR_LLEGAR",
  "RETAIL_DISPONIBLE",
  "DESCONOCIDO",
];
const TIPO_STOCK_ORDER: TipoStock[] = [
  "FloorPlan",
  "Propio",
  "Financiado",
  "FinPropio",
  "VuPorRecibir",
  "Desconocido",
];
const UN_ORDER: UnidadNegocio[] = ["Nuevos", "Usados", "AutosCompania"];
const UN_LABEL: Record<UnidadNegocio, string> = {
  Nuevos: "Nuevos",
  Usados: "Usados",
  AutosCompania: "Autos Compañía",
  Desconocido: "Desconocido",
};
const DESTINO_ORDER: (DestinoOperacional | "_null")[] = [
  "demo",
  "renting",
  "company",
  "vn_con_patente",
  "vdr",
  "interno",
  "_null",
];

const TIPO_STOCK_LABEL: Record<TipoStock, string> = {
  FloorPlan: "Floor Plan",
  Propio: "Propio",
  Financiado: "Financiado",
  FinPropio: "Fin Propio",
  VuPorRecibir: "VU por Recibir",
  Desconocido: "Desconocido",
};

const FLAG_LABEL: Record<NonNullable<StockFilters["flags"]>[number], string> = {
  pagado: "Pagado",
  noPagado: "No pagado",
  vpp: "VPP",
  fne: "FNE",
  judicial: "Judicial",
  stockB: "Stock B",
  tescar: "TESCAR estricto",
  tescarOperacional: "TESCAR operacional",
  duplicado: "VIN duplicado",
  conPatente: "Con patente",
  sinPatente: "Sin patente",
};

export default function StockExplorerPage() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-[--color-fg-muted]">Cargando…</div>}>
      <StockExplorerInner />
    </Suspense>
  );
}

function StockExplorerInner() {
  const { data } = useDatosFiltrados();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<StockFilters>(() => decodeFilters(searchParams));
  const [sortBy, setSortBy] = useState<{ key: keyof Vehiculo; dir: "asc" | "desc" }>({
    key: "diasStock",
    dir: "desc",
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Cuántas páginas (de PAGE_SIZE c/u) están visibles. Se resetea al cambiar
   *  filtros u orden para evitar "lagunas" de scroll. */
  const [visiblePages, setVisiblePages] = useState(1);
  /** VIN con ficha operacional expandida inline · solo uno a la vez.
   *  Reemplaza el modal del AbrirCasoButton anterior. Misma UX que Centro de
   *  Acción: al abrir otro VIN, el actual se cierra automáticamente. */
  const [vinExpanded, setVinExpanded] = useState<string | null>(null);

  // Gestión persistente compartida — hidratar localStorage (igual que el resto).
  useEffect(() => {
    useGestionStore.getState().hydrate();
  }, []);

  useEffect(() => {
    const params = encodeFilters(filters);
    const search = params.toString();
    const next = search ? `?${search}` : "";
    router.replace(`/stock${next}`, { scroll: false });
    setVisiblePages(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  useEffect(() => {
    setVisiblePages(1);
  }, [sortBy]);

  const marcaCtx = useMarcaFilter((s) => s.marca);
  const vinCtx = useVinContexto();

  // En contexto de marca, el Stock Explorer muestra SOLO el stock retail de la
  // marca (no renting/company/test ni usados recibidos). Sin marca = todo.
  const vehiculosBase = useMemo(() => {
    if (!data) return [];
    if (!marcaCtx) return data.vehiculos;
    return data.vehiculos.filter((v) => getCategoriaOperacional(v) === "stock_retail");
  }, [data, marcaCtx]);

  const options = useMemo(() => {
    if (!data) return null;
    // Marcas Pompeyo válidas = todas las marcas con línea de crédito asignada.
    // Eso garantiza que solo aparezcan KIA, MG, PEUGEOT, etc. — no HYUNDAI ni TOYOTA.
    const marcasPompeyoValidas = data.lineas
      .map((l) => l.marcaPompeyo ?? l.marca)
      .filter(Boolean) as string[];
    const opts = extractFilterOptions(vehiculosBase, marcasPompeyoValidas);
    // En contexto de marca, el selector de sucursales solo ofrece sucursales
    // RETAIL (un auto retail puede estar físicamente en seminuevos, pero esa no
    // es una sucursal retail de la marca).
    if (marcaCtx) {
      return { ...opts, sucursales: opts.sucursales.filter(sucursalEsRetailOperacional) };
    }
    return opts;
  }, [data, marcaCtx, vehiculosBase]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const out = filterVehiculos(vehiculosBase, filters);
    return [...out].sort((a, b) => {
      const av = a[sortBy.key];
      const bv = b[sortBy.key];
      if (typeof av === "number" || typeof bv === "number") {
        const cmp = (typeof av === "number" ? av : 0) - (typeof bv === "number" ? bv : 0);
        return sortBy.dir === "asc" ? cmp : -cmp;
      }
      const cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      return sortBy.dir === "asc" ? cmp : -cmp;
    });
  }, [data, vehiculosBase, filters, sortBy]);

  const stats = useMemo(() => statsFromFiltered(filtered), [filtered]);

  // ── KPI cards ejecutivas (Velocity OS · alineadas al patrón del Hero) ────
  // Métricas DERIVADAS de `filtered` (no agrega nuevas queries ni selectores).
  // El usuario las usa como lectura rápida del universo actualmente visible.
  const kpis = useMemo(() => {
    let sumDias = 0;
    let nConDias = 0;
    let criticosCount = 0;
    let criticosCapital = 0;
    let propioCount = 0;
    let propioCapital = 0;
    let fpCount = 0;
    let fpCapital = 0;
    for (const v of filtered) {
      const dias = v.diasStock ?? 0;
      const costo = v.costoNeto ?? 0;
      if (v.diasStock != null && Number.isFinite(v.diasStock)) {
        sumDias += dias;
        nConDias++;
      }
      if (dias >= 180) {
        criticosCount++;
        criticosCapital += costo;
      }
      if (v.tipoStock === "Propio" || v.tipoStock === "FinPropio") {
        propioCount++;
        propioCapital += costo;
      }
      if (v.tipoStock === "FloorPlan" || v.tipoStock === "Financiado") {
        fpCount++;
        fpCapital += costo;
      }
    }
    return {
      agingPromedio: nConDias > 0 ? sumDias / nConDias : null,
      criticosCount,
      criticosCapital,
      propioCount,
      propioCapital,
      fpCount,
      fpCapital,
    };
  }, [filtered]);

  if (!data) {
    return (
      <div className="p-10 max-w-3xl mx-auto fade-in">
        <Card variant="glass">
          <CardBody>
            <EmptyState
              icon={<Warehouse className="size-7" strokeWidth={1.5} />}
              title="Stock Explorer"
              description="Carga un Excel desde la pantalla de inicio para ver los vehículos con filtros, drilldowns y exportación."
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

  // En contexto de marca, el universo de referencia es el stock retail de la marca.
  const totalUniverse = marcaCtx
    ? vehiculosBase.length
    : filters.soloVinUnico
      ? data.report.totalVinsUnicos
      : data.vehiculos.length;
  const activeCount = countActiveFilters(filters);
  const active = isFilterActive(filters);
  const hasFilters = countActiveFilters(filters) > 0;

  return (
    <div className="fade-in">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-6">
        {/* Hero — alineado al estándar Velocity OS: surface + top-strip.
            Antes era un gradient custom full-width que se sentía "de otro
            programa" frente al resto del sistema. */}
        <section className="surface bg-white top-strip strip-operativo p-5">
          {/* Back button cuando se llegó desde un drilldown */}
          {hasFilters && (
            <button
              onClick={() => router.back()}
              className="inline-flex items-center gap-1.5 text-[12px] text-[--color-fg-muted] hover:text-[--color-fg] mb-3 transition"
            >
              <ArrowLeft className="size-3.5" strokeWidth={1.75} />
              Volver
            </button>
          )}
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-[--color-info] font-semibold">
                <Warehouse className="size-3.5" strokeWidth={2} />
                Explorador
              </div>
              <h1 className="text-[24px] sm:text-[28px] font-semibold tracking-tight mt-1.5 leading-tight text-[--color-fg]">
                Stock Explorer
              </h1>
              <p className="text-[13px] text-[--color-fg-muted] mt-1.5 max-w-2xl leading-snug">
                <span className="mono text-[--color-fg] font-semibold">
                  {fmtNum(stats.unidades)}
                </span>{" "}
                de <span className="mono text-[--color-fg]">{fmtNum(totalUniverse)}</span> vehículos
                · <span className="mono text-[--color-fg] font-medium">{fmtCLPCompact(stats.capital)}</span> capital
                · {stats.marcasUnicas} marcas · {stats.sucursalesUnicas} sucursales
              </p>
            </div>

            {/* Search + actions */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search
                  className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-[--color-fg-dim]"
                  strokeWidth={1.75}
                />
                <input
                  type="text"
                  value={filters.q}
                  onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                  placeholder="Buscar VIN, patente, modelo…"
                  className="w-full sm:w-[280px] h-10 text-[13px] pl-10 pr-3 rounded-lg bg-white border border-[--color-border] focus:border-[--color-accent] outline-none transition placeholder:text-[--color-fg-dim]"
                />
                {filters.q && (
                  <button
                    onClick={() => setFilters({ ...filters, q: "" })}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[--color-fg-dim] hover:text-[--color-fg]"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>

              <Button variant="secondary" size="lg" onClick={() => setDrawerOpen(true)}>
                <Filter className="size-3.5" strokeWidth={1.75} />
                Filtros
                {activeCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 text-[10px] rounded-full bg-[color:var(--color-accent)] text-white font-semibold mono">
                    {activeCount}
                  </span>
                )}
              </Button>

              <Button variant="ghost" size="lg" onClick={() => exportCSV(filtered)}>
                <Download className="size-3.5" strokeWidth={1.75} />
                CSV
              </Button>
            </div>
          </div>

          {/* Active filter pills */}
          {active && (
            <div className="mt-4">
              <ActiveFilterPills filters={filters} setFilters={setFilters} />
            </div>
          )}
        </section>

        {/* KPI cards ejecutivas — lectura rápida del universo filtrado.
            Aging promedio · Críticos >180d · Stock Propio · Floor Plan/Fin.
            Derivadas de `filtered` (cero queries / fórmulas nuevas). */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            kicker="Aging promedio"
            icon={Clock}
            tone="info"
            value={kpis.agingPromedio != null ? `${Math.round(kpis.agingPromedio)}d` : "—"}
            sub="días stock promedio"
          />
          <KpiCard
            kicker="Críticos >180d"
            icon={AlertTriangle}
            tone="danger"
            value={fmtNum(kpis.criticosCount)}
            sub={fmtCLPCompact(kpis.criticosCapital)}
          />
          <KpiCard
            kicker="Stock propio"
            icon={Coins}
            tone="warning"
            value={fmtNum(kpis.propioCount)}
            sub={fmtCLPCompact(kpis.propioCapital)}
          />
          <KpiCard
            kicker="Floor Plan · Financiado"
            icon={Banknote}
            tone="muted"
            value={fmtNum(kpis.fpCount)}
            sub={fmtCLPCompact(kpis.fpCapital)}
          />
        </div>

        {vinCtx && <VinContextoBanner vin={vinCtx} presentes={filtered.length} />}
        {/* Tabla densa — patrón Explorer (sortable + 200+ filas + filtros densos
            justifican mantener `<table>` plana en vez de cardificar c/u). */}
        <div className="rounded-2xl border border-[--color-border] bg-[--color-bg-elev-1] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1400px] linear-table thead-sticky">
              <thead className="text-[10.5px] uppercase tracking-[0.08em] text-[--color-fg-muted]">
                <tr>
                  <Th label="Marca / Modelo" />
                  <Th label="VIN" />
                  <Th label="Patente" />
                  <Th label="Sucursal" />
                  <SortableTh
                    label="Días"
                    align="right"
                    active={sortBy.key === "diasStock"}
                    dir={sortBy.dir}
                    onClick={() =>
                      setSortBy({
                        key: "diasStock",
                        dir:
                          sortBy.key === "diasStock" && sortBy.dir === "desc" ? "asc" : "desc",
                      })
                    }
                  />
                  <SortableTh
                    label="Costo Neto"
                    align="right"
                    active={sortBy.key === "costoNeto"}
                    dir={sortBy.dir}
                    onClick={() =>
                      setSortBy({
                        key: "costoNeto",
                        dir:
                          sortBy.key === "costoNeto" && sortBy.dir === "desc" ? "asc" : "desc",
                      })
                    }
                  />
                  <Th label="Estado" />
                  <Th label="Naturaleza" />
                  <Th label="Tipo Stock" />
                  <Th label="Marca origen" />
                  <Th label="Destino" />
                  <Th label="Gestión" />
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, visiblePages * PAGE_SIZE).map((v) => {
                  const dias = v.diasStock ?? 0;
                  const diasColor =
                    dias >= 180
                      ? "text-[--color-danger]"
                      : dias >= 60
                        ? "text-[--color-warning]"
                        : "text-[--color-fg]";
                  const vinKey = limpiarVIN(v.vin);
                  const isExpanded = vinExpanded === vinKey;

                  return (
                    <Fragment key={`${v.vin}-${v.rowIndex}`}>
                    <tr className={cn(isExpanded && "bg-[--color-bg-elev-2]")}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[13px] text-[--color-fg]">
                            {v.marca || v.marcaPompeyo}
                          </span>
                          {(v.marcaPompeyo === "USADOS" ||
                            v.marcaPompeyo === "VU en Nuevos" ||
                            v.marcaPompeyo === "VU en Usados" ||
                            v.marcaPompeyo === "OTRAS MARCAS") && (
                            <span className="text-[10px] text-[--color-fg-dim] uppercase tracking-wider">
                              {v.marcaPompeyo === "USADOS"
                                ? "Usado"
                                : v.marcaPompeyo === "VU en Nuevos"
                                  ? "VU Nuevos"
                                  : v.marcaPompeyo === "VU en Usados"
                                    ? "VU Usados"
                                    : "Otras"}
                            </span>
                          )}
                        </div>
                        <div className="text-[11.5px] text-[--color-fg-muted] truncate max-w-[280px] mt-0.5">
                          {[v.modelo, v.version].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className="px-4 py-3 mono text-[11px] text-[--color-fg-muted]">{v.vin}</td>
                      <td className="px-4 py-3 mono text-[11px] text-[--color-fg]">
                        {v.patente ?? <span className="text-[--color-fg-dim]">—</span>}
                      </td>
                      <td className="px-4 py-3 text-[12px]">
                        <div className="text-[--color-fg]">
                          {v.sucursal ?? <span className="text-[--color-fg-dim]">—</span>}
                        </div>
                        {v.bodega && v.bodega !== v.sucursal && (
                          <div className="text-[10.5px] text-[--color-fg-dim] truncate max-w-[180px] mt-0.5">
                            {v.bodega}
                          </div>
                        )}
                      </td>
                      <td className={cn("px-4 py-3 text-right mono text-[13px]", diasColor)}>
                        {v.diasStock ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right mono text-[13px] text-[--color-fg]">
                        {fmtCLP(v.costoNeto)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={ESTADO_TONE[v.estadoCapital]} dot size="xs">
                          {ESTADO_LABEL[v.estadoCapital]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={NATURALEZA_TONE[v.naturalezaCapital]} size="xs">
                          {NATURALEZA_LABEL[v.naturalezaCapital]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-[--color-fg-muted]">
                        {TIPO_STOCK_LABEL[v.tipoStock]}
                      </td>
                      <td className="px-4 py-3 text-[12px]">
                        <div className="text-[--color-fg]">
                          {v.marcaOriginadora ?? (
                            <span className="text-[--color-fg-dim] italic">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {v.destinoOperacional ? (
                          <Badge tone="muted" size="xs">
                            {DESTINO_LABEL[v.destinoOperacional]}
                          </Badge>
                        ) : (
                          <span className="text-[--color-fg-dim] text-[11px]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() =>
                            setVinExpanded(isExpanded ? null : vinKey)
                          }
                          className={cn(
                            "inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2.5 py-1 rounded-md border transition",
                            isExpanded
                              ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-white hover:opacity-90"
                              : "border-[--color-border] bg-white text-[--color-fg] hover:bg-[--color-bg-elev-2]",
                          )}
                        >
                          {isExpanded ? "Cerrar" : "Gestionar"}
                        </button>
                      </td>
                    </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > PAGE_SIZE && (
            <div className="px-6 py-4 border-t border-[--color-border-soft] bg-[--color-bg-elev-1] flex items-center justify-between gap-4 flex-wrap">
              <div className="text-[12px] text-[--color-fg-muted]">
                Mostrando{" "}
                <span className="mono text-[--color-fg]">
                  {fmtNum(Math.min(visiblePages * PAGE_SIZE, filtered.length))}
                </span>{" "}
                de <span className="mono text-[--color-fg]">{fmtNum(filtered.length)}</span>{" "}
                vehículos
              </div>
              {visiblePages * PAGE_SIZE < filtered.length && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setVisiblePages((p) => p + 1)}
                  >
                    Cargar {fmtNum(Math.min(PAGE_SIZE, filtered.length - visiblePages * PAGE_SIZE))} más
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setVisiblePages(Math.ceil(filtered.length / PAGE_SIZE))}
                  >
                    Ver todo
                  </Button>
                </div>
              )}
            </div>
          )}
          {filtered.length === 0 && (
            <EmptyState
              icon={<Filter className="size-6" strokeWidth={1.5} />}
              title="Sin resultados"
              description="Ningún vehículo coincide con los filtros aplicados."
              action={
                <Button variant="outline" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                  <RotateCcw className="size-3.5" />
                  Limpiar filtros
                </Button>
              }
            />
          )}
        </div>

        {/* Ficha Operacional del VIN seleccionado · panel FUERA del scroll
            horizontal de la tabla. Antes vivía como <tr> dentro del <table
            min-w-[1400px]>, lo que cortaba el contenido por la izquierda al
            scrollear. Como panel independiente respeta el ancho del viewport. */}
        {vinExpanded && (
          <div className="surface bg-white top-strip strip-info p-5">
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-info] font-semibold">
                Gestión inline · {vinExpanded}
              </div>
              <button
                type="button"
                onClick={() => setVinExpanded(null)}
                className="text-[11.5px] text-[--color-fg-muted] hover:text-[--color-fg] inline-flex items-center gap-1"
              >
                <X className="size-3" />
                Cerrar
              </button>
            </div>
            <FichaOperacionalVIN vin={vinExpanded} />
          </div>
        )}
      </div>

      {/* Drawer de filtros */}
      <Sheet
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Filtros"
        description="Combina dimensiones para acotar la vista. Las URLs son compartibles."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
              <RotateCcw className="size-3.5" />
              Limpiar
            </Button>
            <Button variant="primary" size="sm" onClick={() => setDrawerOpen(false)}>
              Aplicar
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          {/* Días stock */}
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-[--color-fg-muted] font-semibold mb-2">
              Días stock
            </div>
            <div className="flex gap-1.5">
              {(["", "60", "180"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setFilters({ ...filters, diasMinimo: d })}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-[12px] border transition font-medium",
                    filters.diasMinimo === d
                      ? "border-[--color-accent] bg-[--color-accent] text-white shadow-sm"
                      : "border-[--color-border] bg-white text-[--color-fg-muted] hover:text-[--color-fg]",
                  )}
                >
                  {d === "" ? "Todos" : `≥${d} días`}
                </button>
              ))}
            </div>
          </div>

          {/* Banderas */}
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-[--color-fg-muted] font-semibold mb-2">
              Banderas rápidas
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(FLAG_LABEL) as (keyof typeof FLAG_LABEL)[]).map((flag) => {
                const isActive = filters.flags.includes(flag);
                return (
                  <button
                    key={flag}
                    onClick={() =>
                      setFilters({
                        ...filters,
                        flags: isActive
                          ? filters.flags.filter((f) => f !== flag)
                          : [...filters.flags, flag],
                      })
                    }
                    className={cn(
                      "px-2.5 py-1 rounded-md text-[11.5px] border transition font-medium",
                      isActive
                        ? "bg-[--color-accent] border-[--color-accent] text-white shadow-sm"
                        : "bg-white border-[--color-border] text-[--color-fg-muted] hover:text-[--color-fg]",
                    )}
                  >
                    {FLAG_LABEL[flag]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="hairline" />

          {options && (
            <>
              {/* Filtros principales — siempre visibles */}
              <div className="space-y-5">
                <FilterChips
                  label="Marca"
                  options={options.marcas.map((m) => ({ value: m }))}
                  value={filters.marca}
                  onChange={(marca) => setFilters({ ...filters, marca })}
                />
                <FilterChips
                  label="Modelo"
                  options={options.modelos.map((m) => ({ value: m }))}
                  value={filters.modelo}
                  onChange={(modelo) => setFilters({ ...filters, modelo })}
                  searchAfter={8}
                />
                <FilterChips
                  label="Unidad de negocio"
                  options={UN_ORDER.map((u) => ({ value: u, label: UN_LABEL[u] }))}
                  value={filters.unidadNegocio}
                  onChange={(unidadNegocio) => setFilters({ ...filters, unidadNegocio })}
                />
                <FilterChips
                  label="Naturaleza del capital"
                  options={NATURALEZA_ORDER.map((n) => ({ value: n, label: NATURALEZA_LABEL[n] }))}
                  value={filters.naturaleza}
                  onChange={(naturaleza) => setFilters({ ...filters, naturaleza })}
                />
                <FilterChips
                  label="Estado capital"
                  options={ESTADO_ORDER.map((e) => ({ value: e, label: ESTADO_LABEL[e] }))}
                  value={filters.estadoCapital}
                  onChange={(estadoCapital) => setFilters({ ...filters, estadoCapital })}
                />
              </div>

              {/* Filtros avanzados — colapsables */}
              <details className="group">
                <summary className="cursor-pointer text-[11px] uppercase tracking-[0.12em] text-[--color-fg-muted] hover:text-[--color-fg] font-semibold flex items-center gap-1.5 select-none py-2">
                  <span className="text-[--color-fg-dim] group-open:rotate-90 transition-transform">›</span>
                  Filtros avanzados
                </summary>
                <div className="space-y-5 pt-3">
                  <FilterChips
                    label="Destino operacional"
                    options={DESTINO_ORDER.map((d) => ({
                      value: d,
                      label:
                        d === "_null" ? "Sin destino (retail)" : DESTINO_LABEL[d as DestinoOperacional],
                    }))}
                    value={filters.destinoOperacional}
                    onChange={(destinoOperacional) =>
                      setFilters({ ...filters, destinoOperacional })
                    }
                  />
                  <FilterChips
                    label="Tipo Stock (financiero)"
                    options={TIPO_STOCK_ORDER.map((t) => ({ value: t, label: TIPO_STOCK_LABEL[t] }))}
                    value={filters.tipoStock}
                    onChange={(tipoStock) => setFilters({ ...filters, tipoStock })}
                  />
                  <FilterChips
                    label="Marca originadora"
                    options={options.marcasOriginadoras.map((m) => ({ value: m }))}
                    value={filters.marcaOriginadora}
                    onChange={(marcaOriginadora) => setFilters({ ...filters, marcaOriginadora })}
                  />
                  <FilterChips
                    label="Sucursal"
                    options={options.sucursales.map((s) => ({ value: s }))}
                    value={filters.sucursal}
                    onChange={(sucursal) => setFilters({ ...filters, sucursal })}
                  />
                  <FilterChips
                    label="Estado Dealer"
                    options={options.estadosDealer.map((s) => ({ value: s }))}
                    value={filters.estadoDealer}
                    onChange={(estadoDealer) => setFilters({ ...filters, estadoDealer })}
                  />
                  <FilterChips
                    label="Estado Flujo VO"
                    options={options.estadosFlujoVO.map((s) => ({ value: s }))}
                    value={filters.estadoFlujoVO}
                    onChange={(estadoFlujoVO) => setFilters({ ...filters, estadoFlujoVO })}
                  />
                </div>
              </details>
            </>
          )}

          <div className="hairline" />

          <label className="text-[12.5px] text-[--color-fg-muted] flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={filters.soloVinUnico}
              onChange={(e) => setFilters({ ...filters, soloVinUnico: e.target.checked })}
              className="accent-[--color-accent]"
            />
            Solo VIN únicos
          </label>
        </div>
      </Sheet>
    </div>
  );
}

// ─── Subcomponente · KPI card ejecutiva (patrón Velocity OS) ─────────────────
// Mismo lenguaje visual que las cards Hero del Centro de Acción · surface +
// top-strip + tinte de fondo y borde semántico para que el color "respire"
// más allá del strip de 3px arriba (feedback usuario: "colores apagados").
type KpiTone = "info" | "danger" | "warning" | "muted";
const KPI_TONE: Record<
  KpiTone,
  { strip: string; text: string; bg: string; border: string; iconBg: string }
> = {
  info: {
    strip: "strip-info",
    text: "text-[--color-info]",
    bg: "bg-blue-50/50",
    border: "border-blue-200",
    iconBg: "bg-blue-100 text-blue-700",
  },
  danger: {
    strip: "strip-danger",
    text: "text-[--color-danger]",
    bg: "bg-red-50/60",
    border: "border-red-200",
    iconBg: "bg-red-100 text-red-700",
  },
  warning: {
    strip: "strip-warning",
    text: "text-[--color-warning]",
    bg: "bg-amber-50/60",
    border: "border-amber-200",
    iconBg: "bg-amber-100 text-amber-800",
  },
  muted: {
    strip: "strip-muted",
    text: "text-[--color-fg-muted]",
    bg: "bg-slate-50",
    border: "border-slate-200",
    iconBg: "bg-slate-200 text-slate-700",
  },
};

function KpiCard({
  kicker,
  icon: Icon,
  tone,
  value,
  sub,
}: {
  kicker: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  tone: KpiTone;
  value: string;
  sub: string;
}) {
  const t = KPI_TONE[tone];
  return (
    <div className={cn("surface top-strip p-4", t.strip, t.bg, t.border)}>
      <div
        className={cn(
          "text-[10.5px] uppercase tracking-[0.14em] font-semibold flex items-center gap-2",
          t.text,
        )}
      >
        <span
          className={cn(
            "grid place-items-center size-5 rounded",
            t.iconBg,
          )}
        >
          <Icon className="size-3" strokeWidth={2.25} />
        </span>
        {kicker}
      </div>
      <div className="display text-[28px] mt-2.5 leading-none text-[--color-fg] mono font-bold">
        {value}
      </div>
      <div className="text-[11.5px] text-[--color-fg-muted] mt-2 leading-snug">
        {sub}
      </div>
    </div>
  );
}

function Th({ label, align = "left" }: { label: string; align?: "left" | "right" }) {
  return (
    <th
      className={cn(
        "font-semibold px-4 py-3",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {label}
    </th>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th
      className={cn(
        "font-semibold px-4 py-3 cursor-pointer select-none transition hover:text-[--color-fg]",
        align === "right" ? "text-right" : "text-left",
      )}
      onClick={onClick}
    >
      <span className={cn("inline-flex items-center gap-1", active && "text-[--color-fg]")}>
        {label}
        {active && <span className="text-[10px]">{dir === "asc" ? "↑" : "↓"}</span>}
      </span>
    </th>
  );
}

function ActiveFilterPills({
  filters,
  setFilters,
}: {
  filters: StockFilters;
  setFilters: (f: StockFilters) => void;
}) {
  const pills: { label: string; onRemove: () => void }[] = [];

  if (filters.q.trim()) {
    pills.push({ label: `"${filters.q}"`, onRemove: () => setFilters({ ...filters, q: "" }) });
  }
  if (filters.diasMinimo) {
    pills.push({
      label: `≥${filters.diasMinimo} días`,
      onRemove: () => setFilters({ ...filters, diasMinimo: "" }),
    });
  }
  filters.naturaleza.forEach((n) =>
    pills.push({
      label: NATURALEZA_LABEL[n],
      onRemove: () =>
        setFilters({ ...filters, naturaleza: filters.naturaleza.filter((x) => x !== n) }),
    }),
  );
  filters.estadoCapital.forEach((e) =>
    pills.push({
      label: ESTADO_LABEL[e],
      onRemove: () =>
        setFilters({ ...filters, estadoCapital: filters.estadoCapital.filter((x) => x !== e) }),
    }),
  );
  filters.destinoOperacional.forEach((d) =>
    pills.push({
      label:
        d === "_null"
          ? "Sin destino"
          : `Destino: ${DESTINO_LABEL[d as DestinoOperacional]}`,
      onRemove: () =>
        setFilters({
          ...filters,
          destinoOperacional: filters.destinoOperacional.filter((x) => x !== d),
        }),
    }),
  );
  filters.tipoStock.forEach((t) =>
    pills.push({
      label: TIPO_STOCK_LABEL[t],
      onRemove: () =>
        setFilters({ ...filters, tipoStock: filters.tipoStock.filter((x) => x !== t) }),
    }),
  );
  filters.marca.forEach((m) =>
    pills.push({
      label: m,
      onRemove: () => setFilters({ ...filters, marca: filters.marca.filter((x) => x !== m) }),
    }),
  );
  filters.modelo.forEach((m) =>
    pills.push({
      label: m,
      onRemove: () => setFilters({ ...filters, modelo: filters.modelo.filter((x) => x !== m) }),
    }),
  );
  filters.unidadNegocio.forEach((u) =>
    pills.push({
      label: UN_LABEL[u],
      onRemove: () =>
        setFilters({
          ...filters,
          unidadNegocio: filters.unidadNegocio.filter((x) => x !== u),
        }),
    }),
  );
  filters.marcaOriginadora.forEach((m) =>
    pills.push({
      label: `Origen: ${m}`,
      onRemove: () =>
        setFilters({
          ...filters,
          marcaOriginadora: filters.marcaOriginadora.filter((x) => x !== m),
        }),
    }),
  );
  filters.sucursal.forEach((s) =>
    pills.push({
      label: s,
      onRemove: () =>
        setFilters({ ...filters, sucursal: filters.sucursal.filter((x) => x !== s) }),
    }),
  );
  filters.estadoDealer.forEach((s) =>
    pills.push({
      label: s,
      onRemove: () =>
        setFilters({ ...filters, estadoDealer: filters.estadoDealer.filter((x) => x !== s) }),
    }),
  );
  filters.estadoFlujoVO.forEach((s) =>
    pills.push({
      label: s,
      onRemove: () =>
        setFilters({ ...filters, estadoFlujoVO: filters.estadoFlujoVO.filter((x) => x !== s) }),
    }),
  );
  filters.flags.forEach((f) =>
    pills.push({
      label: FLAG_LABEL[f],
      onRemove: () => setFilters({ ...filters, flags: filters.flags.filter((x) => x !== f) }),
    }),
  );

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {pills.map((p, i) => (
        <button
          key={i}
          onClick={p.onRemove}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-[--color-bg-elev-2] text-[--color-fg-muted] hover:text-[--color-fg] hover:bg-[--color-bg-elev-3] border border-[--color-border] transition"
        >
          {p.label}
          <X className="size-3" />
        </button>
      ))}
    </div>
  );
}

function exportCSV(rows: Vehiculo[]) {
  const headers = [
    "VIN",
    "Patente",
    "Marca",
    "Marca Pompeyo",
    "Modelo",
    "Versión",
    "Año",
    "Sucursal",
    "Bodega",
    "Estado Dealer",
    "Estado Flujo VO",
    "Tipo Stock",
    "Días Stock",
    "Tramo DPS",
    "Costo Neto",
    "Estado Capital",
    "Naturaleza",
    "Destino Operacional",
    "Marca Originadora",
    "Confianza Origen",
    "Pagado",
    "Financiado",
    "VPP",
    "Folio Venta",
    "Vendedor",
    "Fecha Venta",
    "Fecha Vencimiento",
  ];
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const csv = [
    headers.join(","),
    ...rows.map((v) =>
      [
        v.vin,
        v.patente,
        v.marca,
        v.marcaPompeyo,
        v.modelo,
        v.version,
        v.anio,
        v.sucursal,
        v.bodega,
        v.estadoDealer,
        v.estadoFlujoVO,
        v.tipoStock,
        v.diasStock,
        v.tramoDPS,
        v.costoNeto,
        v.estadoCapital,
        v.naturalezaCapital,
        v.destinoOperacional ?? "",
        v.marcaOriginadora,
        v.confianzaMarcaOriginadora,
        v.esPagado ? "Sí" : "No",
        v.financiado ? "Sí" : "No",
        v.esVPPComprometido ? "Sí" : "No",
        v.folioVenta,
        v.vendedor,
        v.fechaVenta,
        v.fechaVencimiento,
      ]
        .map(escape)
        .join(","),
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stock-explorer-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
