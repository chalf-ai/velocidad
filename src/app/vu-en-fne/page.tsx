"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useVinContexto, VinContextoBanner } from "@/components/VinContexto";
import { ExternalLink, RotateCcw, Truck, Zap, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { AbrirCasoButton } from "@/components/AbrirCasoButton";
import { useDatosFiltrados } from "@/lib/marca-filtro";
import { useGestionStore } from "@/lib/gestion/store";
import { fmtCLPCompact, fmtNum, fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  recuperacionUsados,
  conciliacionPendiente,
  type CasoRecuperacion,
  type CasoConciliacion,
  type CandidatoFNE,
  type ClaseRecuperacion,
  type EstadoCruce,
  type EstadoConciliacion,
  type TipoCapitalPuente,
  type RecuperacionStats,
  type RecupMarcaRow,
} from "@/lib/selectors/vu-en-fne";
import { ESTADO_ENTREGA_LABEL } from "@/lib/selectors/fne-real";
import { limpiarVIN } from "@/lib/parser/venta-apc";

type BadgeTone = "success" | "warning" | "danger" | "info" | "muted";

const CLASE_META: Record<
  ClaseRecuperacion,
  { label: string; badge: BadgeTone; bar: string; urgent: boolean }
> = {
  entregar_ya: { label: "Entregar YA · recupera usado", badge: "success", bar: "#0f7a59", urgent: true },
  bloqueo_financiero: { label: "Listo · bloqueo financiero (Crédito Pompeyo)", badge: "warning", bar: "var(--color-warning)", urgent: false },
  falta_logistica: { label: "Falta llegar el auto · logística", badge: "danger", bar: "var(--color-danger)", urgent: false },
  falta_patente: { label: "Falta patente en sucursal", badge: "danger", bar: "var(--color-danger)", urgent: false },
  falta_inscripcion: { label: "Falta inscripción", badge: "info", bar: "var(--color-info)", urgent: false },
  falta_solicitud: { label: "Falta solicitud / autorización", badge: "warning", bar: "var(--color-warning)", urgent: false },
  sin_detalle_fne: { label: "Capital puente · sin detalle FNE", badge: "muted", bar: "var(--color-fg-muted)", urgent: false },
  sin_fecha: { label: "Sin fecha de origen", badge: "muted", bar: "#64748b", urgent: false },
};

const ESTADO_CRUCE_META: Record<EstadoCruce, { label: string; tone: BadgeTone }> = {
  enriquecido_fne: { label: "operación en FNE", tone: "success" },
  directo_base_stock: { label: "desde Base_Stock", tone: "info" },
  requiere_conciliacion: { label: "requiere conciliación", tone: "warning" },
  sin_datos_suficientes: { label: "sin datos suficientes", tone: "muted" },
};

const TIPO_BU_META: Record<TipoCapitalPuente, { label: string; tone: BadgeTone }> = {
  BU_NUEVOS: { label: "BU en nuevos", tone: "info" },
  BU_USADOS: { label: "BU en usados", tone: "muted" },
  SIN_CLASIFICAR: { label: "BU sin clasificar", tone: "warning" },
};

type Sel =
  | { kind: "todos" }
  | { kind: "marca"; value: string }
  | { kind: "aging"; value: number }
  | { kind: "tipo"; value: TipoCapitalPuente }
  | { kind: "conciliacion" }
  | { kind: "sinFecha" };

const esConciliacion = (c: CasoRecuperacion) =>
  c.estadoCruce === "requiere_conciliacion" || c.estadoCruce === "sin_datos_suficientes";

export default function VUEnFNEPage() {
  const { data, fne, saldos } = useDatosFiltrados();
  useEffect(() => {
    useGestionStore.getState().hydrate();
  }, []);

  const stats = useMemo(
    () =>
      data ? recuperacionUsados(data.vehiculos, fne, saldos, data.vinsExtra ?? null) : null,
    [data, fne, saldos],
  );

  const conciliacion = useMemo(
    () => (stats ? conciliacionPendiente(stats, fne) : []),
    [stats, fne],
  );

  if (!data || !stats) {
    return (
      <div className="p-10 max-w-3xl mx-auto fade-in">
        <Card variant="glass">
          <CardBody>
            <EmptyState
              icon={<RotateCcw className="size-7" strokeWidth={1.5} />}
              title="Usados pendientes de recuperación"
              description="Autos usados recibidos en parte de pago que todavía no recuperamos porque la operación nueva sigue abierta. Carga el Excel maestro para verlos."
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

  return (
    <Suspense fallback={<div className="p-10 text-sm text-[--color-fg-muted]">Cargando…</div>}>
      <UsadosInner stats={stats} conciliacion={conciliacion} />
    </Suspense>
  );
}

function UsadosInner({
  stats,
  conciliacion,
}: {
  stats: RecuperacionStats;
  conciliacion: CasoConciliacion[];
}) {
  const [sel, setSel] = useState<Sel>({ kind: "todos" });
  const listaRef = useRef<HTMLDivElement>(null);
  const vinCtx = useVinContexto();
  const irALista = () =>
    requestAnimationFrame(() => listaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  const select = (s: Sel) => {
    setSel(s);
    irALista();
  };
  useEffect(() => {
    if (vinCtx) irALista();
  }, [vinCtx]);

  const maxCapital = Math.max(...stats.porMarca.map((m) => m.capital), 1);

  const casos = useMemo(() => {
    if (vinCtx) return stats.casos.filter((c) => limpiarVIN(c.usado.vin) === vinCtx);
    let cs: CasoRecuperacion[];
    if (sel.kind === "marca") cs = stats.porMarca.find((m) => m.marca === sel.value)?.casos ?? [];
    else if (sel.kind === "aging")
      cs = stats.casos.filter((c) => c.aging != null && c.aging > sel.value);
    else if (sel.kind === "tipo")
      cs = stats.casos.filter((c) => c.tipoCapitalPuente === sel.value);
    else if (sel.kind === "conciliacion") cs = stats.casos.filter(esConciliacion);
    else if (sel.kind === "sinFecha") cs = stats.casos.filter((c) => c.aging == null);
    else cs = stats.casos;
    return [...cs].sort(
      (a, b) =>
        a.rank - b.rank ||
        (b.aging ?? -1) - (a.aging ?? -1) ||
        (b.usado.costoNeto || 0) - (a.usado.costoNeto || 0),
    );
  }, [sel, stats, vinCtx]);
  const casosCapital = casos.reduce((s, c) => s + (c.usado.costoNeto || 0), 0);

  const tituloDrill =
    sel.kind === "marca"
      ? sel.value
      : sel.kind === "aging"
        ? `Retenidos más de ${sel.value} días`
        : sel.kind === "tipo"
          ? TIPO_BU_META[sel.value].label
          : sel.kind === "conciliacion"
            ? "Casos que requieren conciliación"
            : sel.kind === "sinFecha"
              ? "Casos sin fecha de origen"
              : "Todos los casos de capital puente";

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-10 space-y-7 fade-in overflow-x-hidden lg:overflow-x-visible">
      {vinCtx && <VinContextoBanner vin={vinCtx} presentes={casos.length} />}
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-[--color-border] bg-gradient-to-br from-[#fffbeb] via-[#fef3f2] to-white px-10 py-8">
        <div className="absolute -top-12 -right-12 size-56 rounded-full bg-[--color-warning] opacity-[0.12] blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[--color-warning] font-semibold">
            <RotateCcw className="size-3.5" strokeWidth={2} />
            Usados pendientes de recuperación · capital puente
          </div>
          <h1 className="text-[28px] font-semibold tracking-tight mt-2 leading-tight text-[--color-fg]">
            {fmtNum(stats.totalUnidades)} usados retenidos por operaciones nuevas abiertas
          </h1>
          <p className="text-[14px] text-[--color-fg-muted] mt-2 max-w-3xl leading-relaxed">
            Recibidos en parte de pago. El capital se recupera cuando la operación nueva se entrega.
            Inmovilizan{" "}
            <span className="text-[--color-warning] font-semibold">
              {fmtCLPCompact(stats.capitalTotal)}
            </span>
            . Aging = días desde la fecha de origen del capital puente (factura de la operación nueva
            o retoma del usado).
          </p>
        </div>
      </div>

      {/* KPIs clickeables */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Kpi label="Capital puente" value={fmtCLPCompact(stats.capitalTotal)} tone="warning" active={sel.kind === "todos"} onClick={() => select({ kind: "todos" })} />
        <Kpi label="BU en nuevos" value={fmtNum(stats.buNuevos.unidades)} tone="default" active={sel.kind === "tipo" && sel.value === "BU_NUEVOS"} onClick={() => select({ kind: "tipo", value: "BU_NUEVOS" })} />
        <Kpi label="BU en usados" value={fmtNum(stats.buUsados.unidades)} tone="default" active={sel.kind === "tipo" && sel.value === "BU_USADOS"} onClick={() => select({ kind: "tipo", value: "BU_USADOS" })} />
        <Kpi label=">30 días" value={fmtNum(stats.mas30)} tone="warning" active={sel.kind === "aging" && sel.value === 30} onClick={() => select({ kind: "aging", value: 30 })} />
        <Kpi label=">60 días" value={fmtNum(stats.mas60)} tone="warning" active={sel.kind === "aging" && sel.value === 60} onClick={() => select({ kind: "aging", value: 60 })} />
        <Kpi label=">90 días" value={fmtNum(stats.mas90)} tone="danger" active={sel.kind === "aging" && sel.value === 90} onClick={() => select({ kind: "aging", value: 90 })} />
        <Kpi label="Sin fecha" value={fmtNum(stats.sinFecha.unidades)} tone="dark" active={sel.kind === "sinFecha"} onClick={() => select({ kind: "sinFecha" })} />
        <Kpi label="Requiere conciliación" value={fmtNum(stats.requiereConciliacion.unidades)} tone="muted" active={sel.kind === "conciliacion"} onClick={() => select({ kind: "conciliacion" })} />
      </div>

      {/* Banner conciliación — casos sin clasificar / sin datos en Base_Stock */}
      {stats.requiereConciliacion.unidades > 0 && (
        <button
          onClick={() => select({ kind: "conciliacion" })}
          className={cn(
            "w-full text-left surface bg-white px-5 py-4 flex items-center gap-4 flex-wrap transition surface-hover",
            sel.kind === "conciliacion" && "ring-2 ring-[--color-accent]/30 border-[--color-accent]",
          )}
        >
          <span className="grid place-items-center size-9 rounded-lg bg-[--color-warning]/12 text-[--color-warning] shrink-0">
            <AlertTriangle className="size-4.5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-[--color-fg]">
              {fmtNum(stats.requiereConciliacion.unidades)} casos requieren conciliación ·{" "}
              {fmtCLPCompact(stats.requiereConciliacion.monto)}
            </div>
            <div className="text-[12px] text-[--color-fg-muted] mt-0.5">
              Base_Stock no trae clasificación/marca origen o fecha confiable. Los demás casos SÍ son
              capital puente válido aunque no tengan detalle FNE.
            </div>
          </div>
          <span className="text-[12px] text-[--color-accent] font-medium shrink-0">Ver casos →</span>
        </button>
      )}

      {/* Ranking por marca */}
      <div>
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
          <div>
            <h2 className="text-[16px] font-semibold tracking-tight text-[--color-fg]">
              ¿Quién está reteniendo los usados?
            </h2>
            <p className="text-[12.5px] text-[--color-fg-muted] mt-0.5">
              Marca responsable de la operación nueva. USADOS es la unidad propia de seminuevos.
              Clic para ver y gestionar.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {stats.porMarca.map((m) => (
            <MarcaCard
              key={m.marca}
              row={m}
              maxCapital={maxCapital}
              active={sel.kind === "marca" && sel.value === m.marca}
              onClick={() => select({ kind: "marca", value: m.marca })}
            />
          ))}
        </div>
      </div>

      {/* Drill operativo */}
      <div ref={listaRef} className="space-y-3 scroll-mt-6">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-[16px] font-semibold tracking-tight text-[--color-fg]">
              {tituloDrill}
            </h2>
            <p className="text-[12.5px] text-[--color-fg-muted] mt-0.5">
              {fmtNum(casos.length)} casos · {fmtCLPCompact(casosCapital)} retenidos · ordenados por
              qué apura entregar y recuperar el usado.
            </p>
          </div>
          {sel.kind !== "todos" && (
            <button
              onClick={() => setSel({ kind: "todos" })}
              className="text-[12px] text-[--color-accent] hover:underline shrink-0"
            >
              Ver todos
            </button>
          )}
        </div>
        {casos.length === 0 ? (
          <Card>
            <CardBody className="p-10 text-center text-[13px] text-[--color-fg-muted]">
              Sin casos en esta selección.
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-2">
            {casos.slice(0, 60).map((c) => (
              <CasoRow key={c.usado.vin} caso={c} />
            ))}
            {casos.length > 60 && (
              <div className="text-[11.5px] text-[--color-fg-muted] text-center mt-2">
                Mostrando primeros 60 de {fmtNum(casos.length)} · filtra por marca o aging.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Conciliación pendiente */}
      {conciliacion.length > 0 && <ConciliacionPendiente casos={conciliacion} />}
    </div>
  );
}

// ── Conciliación pendiente ───────────────────────────────────────────────

const CONCILIACION_META: Record<EstadoConciliacion, { label: string; tone: BadgeTone }> = {
  candidato_alto: { label: "Candidato alto", tone: "success" },
  candidato_medio: { label: "Candidato medio", tone: "warning" },
  candidato_bajo: { label: "Candidato bajo", tone: "info" },
  sin_candidato: { label: "Sin candidato", tone: "muted" },
};

function fmtFecha(d: Date | null): string {
  if (!d) return "—";
  try {
    return d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "2-digit" });
  } catch {
    return "—";
  }
}

function ConciliacionPendiente({ casos }: { casos: CasoConciliacion[] }) {
  // Preselección manual — PROTOTIPO visual, no persiste (sin backend).
  const [preVinc, setPreVinc] = useState<Record<string, number | null>>({});
  const montoTotal = casos.reduce((s, c) => s + (c.caso.usado.costoNeto || 0), 0);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-[16px] font-semibold tracking-tight text-[--color-fg]">
          Conciliación pendiente
        </h2>
        <p className="text-[12.5px] text-[--color-fg-muted] mt-0.5">
          {fmtNum(casos.length)} casos sin clasificación/datos suficientes en Base_Stock ·{" "}
          {fmtCLPCompact(montoTotal)}. Candidatos FNE por coincidencia flexible (fallback, no fuente
          principal). Vincular manual es <span className="font-medium">prototipo — no guarda</span>.
        </p>
      </div>
      <div className="space-y-2">
        {casos.map(({ caso, candidatos, estado }) => {
          const u = caso.usado;
          const meta = CONCILIACION_META[estado];
          const sel = preVinc[u.vin];
          return (
            <div key={u.vin} className="surface bg-white px-4 py-3">
              {/* Cabecera: usado + estado */}
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[13.5px] text-[--color-fg]">
                      {u.marca ?? "—"}
                      {u.modelo ? ` · ${u.modelo}` : ""}
                    </span>
                    {u.patente && (
                      <span className="mono text-[10.5px] text-[--color-fg-muted]">{u.patente}</span>
                    )}
                    <Badge tone={meta.tone} size="xs">{meta.label}</Badge>
                  </div>
                  <div className="text-[10.5px] text-[--color-fg-dim] mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="mono">{u.vin}</span>
                    <span>retoma {fmtFecha(u.fechaRetoma)}</span>
                    {u.folioRetoma && <span>folio retoma {u.folioRetoma}</span>}
                    {u.folioVenta && <span>folio venta {u.folioVenta}</span>}
                    {u.vendedor && <span>vend. {u.vendedor}</span>}
                    {u.sucursal && <span>{u.sucursal}</span>}
                    <span>marca op. {caso.responsable}</span>
                  </div>
                </div>
                <span className="mono text-[13px] font-semibold text-[--color-fg] shrink-0">
                  {fmtCLPCompact(u.costoNeto)}{" "}
                  <span className="text-[9px] text-[--color-fg-dim] font-normal uppercase">VPP</span>
                </span>
              </div>

              {/* Candidatos */}
              <div className="mt-2.5 pt-2.5 border-t border-[--color-border-soft] space-y-1.5">
                {candidatos.length === 0 ? (
                  <div className="text-[11.5px] text-[--color-fg-muted]">
                    Sin candidatos FNE — faltan datos para cruzar (revisar patenteVpp / folio en el
                    archivo de origen).
                  </div>
                ) : (
                  candidatos.map((cand) => (
                    <CandidatoRow
                      key={`${u.vin}-${cand.fne.id ?? cand.vinNuevo}`}
                      cand={cand}
                      seleccionado={sel != null && sel === cand.fne.id}
                      onVincular={() =>
                        setPreVinc((p) => ({
                          ...p,
                          [u.vin]: sel === cand.fne.id ? null : cand.fne.id,
                        }))
                      }
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CandidatoRow({
  cand,
  seleccionado,
  onVincular,
}: {
  cand: CandidatoFNE;
  seleccionado: boolean;
  onVincular: () => void;
}) {
  const tone: BadgeTone =
    cand.confianza === "alto" ? "success" : cand.confianza === "medio" ? "warning" : "info";
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 flex items-start gap-3 flex-wrap",
        seleccionado
          ? "border-[--color-accent] bg-[--color-accent]/[0.06]"
          : "border-[--color-border-soft] bg-[--color-bg-elev-1]",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={tone} size="xs">{cand.confianza}</Badge>
          <span className="text-[12px] font-medium text-[--color-fg]">
            {cand.fne.cliente ?? "Operación FNE"}
          </span>
          <span className="mono text-[10px] text-[--color-fg-muted]">{cand.vinNuevo || "—"}</span>
        </div>
        <div className="text-[10.5px] text-[--color-fg-dim] mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
          {cand.fne.id != null && <span>folio {cand.fne.id}</span>}
          {cand.fne.vendedor && <span>vend. {cand.fne.vendedor}</span>}
          {cand.fne.sucursal && <span>{cand.fne.sucursal}</span>}
          <span>factura {fmtCLPCompact(cand.fne.valorFactura)}</span>
          <span>venta {fmtFecha(cand.fne.fechaVenta)}</span>
        </div>
        <div className="text-[10px] text-[--color-fg-muted] mt-1">
          Coincide: {cand.senales.join(" · ")}
        </div>
      </div>
      <button
        onClick={onVincular}
        className={cn(
          "shrink-0 text-[11px] px-2.5 py-1 rounded-md border transition",
          seleccionado
            ? "border-[--color-accent] bg-[--color-accent]/10 text-[--color-accent] font-medium"
            : "border-[--color-border] text-[--color-fg-muted] hover:text-[--color-accent] hover:border-[--color-accent]/40",
        )}
        title="Prototipo — no guarda (sin backend)"
      >
        {seleccionado ? "✓ Preseleccionado" : "Vincular manualmente"}
      </button>
    </div>
  );
}

// ── Componentes ─────────────────────────────────────────────────────────

type KpiTone = "default" | "warning" | "danger" | "muted" | "dark";

function Kpi({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: string;
  tone: KpiTone;
  active?: boolean;
  onClick?: () => void;
}) {
  const strip =
    tone === "danger" ? "strip-danger" : tone === "warning" ? "strip-warning" : tone === "dark" ? "strip-muted" : "strip-muted";
  const numStyle: React.CSSProperties = {
    color:
      tone === "danger"
        ? "var(--color-danger)"
        : tone === "warning"
          ? "var(--color-warning)"
          : tone === "dark"
            ? "#475569"
            : "var(--color-fg)",
  };
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
      <div className="text-[10px] uppercase tracking-wide text-[--color-fg-muted] font-medium">
        {label}
      </div>
      <div className="display text-[22px] mt-1.5 leading-none" style={numStyle}>
        {value}
      </div>
    </Comp>
  );
}

function MarcaCard({
  row,
  maxCapital,
  active,
  onClick,
}: {
  row: RecupMarcaRow;
  maxCapital: number;
  active: boolean;
  onClick: () => void;
}) {
  const critico = row.mas90 > 0;
  const stripClass = critico ? "strip-danger" : row.mas30 > 0 ? "strip-warning" : "strip-operativo";
  const barColor = critico ? "var(--color-danger)" : row.mas30 > 0 ? "var(--color-warning)" : "var(--color-accent)";
  return (
    <button
      onClick={onClick}
      className={cn(
        "surface top-strip bg-white px-5 pt-5 pb-4 text-left transition flex flex-col",
        stripClass,
        active ? "ring-2 ring-[--color-accent]/30 border-[--color-accent]" : "surface-hover",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-semibold tracking-tight text-[--color-fg]">
          {row.marca}
          {row.esUsadosUnidad && (
            <span className="ml-1.5 text-[10px] uppercase tracking-wide text-[--color-fg-dim]">
              unidad propia
            </span>
          )}
        </span>
        {critico && <Badge tone="danger" size="xs">{row.mas90} crít.</Badge>}
      </div>
      <div className="display text-[26px] mt-2.5 leading-none text-[--color-fg]">
        {fmtCLPCompact(row.capital)}
      </div>
      <div className="text-[12px] text-[--color-fg-muted] mt-1.5">
        {fmtNum(row.unidades)} usados · aging prom {row.diasPromedio}d
      </div>
      <div className="h-1.5 rounded-full bg-[--color-bg-elev-3] overflow-hidden mt-2.5">
        <div
          className="h-full rounded-full"
          style={{ width: `${(row.capital / maxCapital) * 100}%`, background: barColor }}
        />
      </div>
      <div className="flex items-center gap-3 mt-3 text-[11px] text-[--color-fg-muted] flex-wrap">
        <span>
          <span className="mono" style={{ color: "var(--color-warning)" }}>{fmtNum(row.mas30)}</span> &gt;30d
        </span>
        <span>
          <span className="mono" style={{ color: "var(--color-danger)" }}>{fmtNum(row.mas90)}</span> &gt;90d
        </span>
        <span className="text-[--color-fg-dim]">{row.buNuevos}N · {row.buUsados}U</span>
        {row.requiereConciliacion > 0 && (
          <span className="text-[--color-fg-dim]">{row.requiereConciliacion} concil.</span>
        )}
        {!row.esUsadosUnidad && row.unidadesExternas > 0 && (
          <span className="ml-auto text-[--color-fg-dim]">{fmtPct(row.pctExternos)} externos</span>
        )}
      </div>
      {!row.esUsadosUnidad && row.marcasExternas.length > 0 && (
        <div className="text-[10.5px] text-[--color-fg-dim] mt-1.5 truncate">
          Externos: {row.marcasExternas.join(" · ")}
        </div>
      )}
    </button>
  );
}

/**
 * Fila: la OPERACIÓN NUEVA (auto vendido) es la entidad principal; el VU/BU
 * recibido queda como detalle secundario. Estado destacado arriba; sin cruce =
 * bloque de conciliación explícito. Aging real de recuperación.
 */
function CasoRow({ caso }: { caso: CasoRecuperacion }) {
  const { usado, cruzado, clase, estadoCruce, tipoCapitalPuente, tieneCP, aging, fuenteFecha } = caso;
  const meta = CLASE_META[clase];
  const cruce = ESTADO_CRUCE_META[estadoCruce];
  const tipoBadge = TIPO_BU_META[tipoCapitalPuente];
  const requiereConcil =
    estadoCruce === "requiere_conciliacion" || estadoCruce === "sin_datos_suficientes";

  const nuevoMarca = cruzado?.vehiculo?.marca ?? cruzado?.vehiculoExtra?.marca ?? null;
  const nuevoModelo = cruzado?.vehiculo?.modelo ?? cruzado?.vehiculoExtra?.modelo ?? null;
  const nuevoVin = cruzado ? limpiarVIN(cruzado.fne.vin) : "";
  const gestVin = nuevoVin || usado.vin;

  const agingTone = aging == null ? "muted" : aging > 90 ? "danger" : aging > 30 ? "warning" : "muted";
  const externo =
    caso.responsable !== "USADOS" &&
    !!usado.marca &&
    !usado.marca.toUpperCase().includes(caso.responsable.split(" ")[0].toUpperCase());

  return (
    <div className="surface bg-white overflow-hidden flex">
      <div className="w-1 shrink-0" style={{ background: meta.bar }} />
      <div className="flex-1 px-4 py-3 min-w-0">
        {/* Estado + confianza de cruce + VPP retenido */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge tone={meta.badge} size="sm">
              {meta.urgent && <Zap className="size-3 inline -mt-px mr-0.5" />}
              {meta.label}
            </Badge>
            <Badge tone={tipoBadge.tone} size="xs">{tipoBadge.label}</Badge>
            <Badge tone={cruce.tone} size="xs">{cruce.label}</Badge>
          </div>
          <span className="mono text-[13px] font-semibold text-[--color-fg] shrink-0">
            {fmtCLPCompact(usado.costoNeto)}{" "}
            <span className="text-[9.5px] text-[--color-fg-dim] font-normal uppercase tracking-wide">
              VPP retenido
            </span>
          </span>
        </div>

        {/* PRINCIPAL: negocio nuevo o bloque de conciliación */}
        {cruzado ? (
          <div className="mt-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-[14px] text-[--color-fg]">
                {nuevoMarca ?? "Auto nuevo"}
                {nuevoModelo ? ` · ${nuevoModelo}` : ""}
              </span>
              <span className="mono text-[10.5px] text-[--color-fg-muted]">{nuevoVin || "—"}</span>
            </div>
            <div className="text-[11.5px] text-[--color-fg-muted] mt-0.5">
              {cruzado.fne.cliente ?? "—"}
              {cruzado.fne.vendedor ? ` · ${cruzado.fne.vendedor}` : ""}
              {cruzado.fne.sucursal ? ` · ${cruzado.fne.sucursal}` : ""}
              {cruzado.fne.id != null ? ` · folio ${cruzado.fne.id}` : ""}
            </div>
            <div className="text-[11px] text-[--color-fg-dim] mt-0.5">
              {cruzado.diasDesdeFactura != null ? `${cruzado.diasDesdeFactura}d desde factura · ` : ""}
              {ESTADO_ENTREGA_LABEL[cruzado.estadoEntrega]} · factura{" "}
              {fmtCLPCompact(cruzado.fne.valorFactura)}
              {tieneCP ? " · ⚠ Crédito Pompeyo pendiente" : ""}
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "mt-2 rounded-lg border px-3 py-2",
              requiereConcil
                ? "border-[--color-warning]/30 bg-[--color-warning]/[0.06]"
                : "border-[--color-border-soft] bg-[--color-bg-elev-1]",
            )}
          >
            <div className="text-[12px] text-[--color-fg] font-medium">
              {requiereConcil
                ? "Requiere conciliación de operación origen (Base_Stock)"
                : `Capital puente válido (${tipoBadge.label}) · sin detalle FNE`}
            </div>
            <div className="text-[11px] text-[--color-fg-muted] mt-0.5">
              {requiereConcil
                ? "Base_Stock no trae clasificación/marca origen confiable."
                : "Operación nueva no encontrada en FNE (puede faltar PatenteVpp). El caso es válido desde Base_Stock."}{" "}
              Datos:{" "}
              {[
                usado.patente ? `patente ${usado.patente}` : null,
                usado.folioRetoma ? `folio retoma ${usado.folioRetoma}` : null,
                `monto ${fmtCLPCompact(usado.costoNeto)}`,
                `marca ${caso.responsable}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        )}

        {/* SECUNDARIO: VU/BU recibido asociado + aging real */}
        <div className="mt-2.5 pt-2.5 border-t border-[--color-border-soft] flex items-center gap-2 flex-wrap">
          <span className="text-[9px] uppercase tracking-wide text-[--color-fg-dim] font-semibold">
            VU recibido
          </span>
          <span className="text-[11.5px] text-[--color-fg] font-medium">
            {usado.marca ?? "—"}
            {usado.modelo ? ` · ${usado.modelo}` : ""}
          </span>
          {usado.patente && <span className="mono text-[10.5px] text-[--color-fg-muted]">{usado.patente}</span>}
          {aging != null ? (
            <Badge tone={agingTone} size="xs">
              {aging}d retenido
            </Badge>
          ) : (
            <Badge tone="muted" size="xs">
              sin fecha de origen
            </Badge>
          )}
          <span className="text-[9.5px] text-[--color-fg-dim]">· {fuenteFecha}</span>
          {externo && <Badge tone="warning" size="xs">marca externa</Badge>}
          <span className="ml-auto flex items-center gap-2 shrink-0">
            {nuevoVin ? (
              <>
                <AbrirCasoButton
                  vin={nuevoVin}
                  origen="Operación origen · capital puente"
                  label="Abrir caso origen"
                />
                <AbrirCasoButton
                  vin={limpiarVIN(usado.vin)}
                  origen="VU recibido en parte de pago"
                  label="Ver VU recibido"
                  variant="ghost"
                />
              </>
            ) : requiereConcil ? (
              <AbrirCasoButton
                vin={limpiarVIN(usado.vin)}
                origen="Capital puente · conciliación técnica (faltan datos base)"
                label="Conciliar (datos base)"
              />
            ) : (
              <>
                <AbrirCasoButton
                  vin={limpiarVIN(usado.vin)}
                  origen="Capital puente · regularizar origen (revisar nota de venta / BPP / PatenteVpp)"
                  label="Regularizar origen"
                />
                <AbrirCasoButton
                  vin={limpiarVIN(usado.vin)}
                  origen="Capital puente · activo recibido"
                  label="Ver capital puente"
                  variant="ghost"
                />
              </>
            )}
            <Link
              href="/facturados-no-entregados"
              className="text-[--color-fg-dim] hover:text-[--color-accent] transition"
              title="Ver en Facturados no entregados (FNE)"
            >
              <Truck className="size-3.5" />
            </Link>
            <Link
              href={`/stock?q=${encodeURIComponent(gestVin)}&dup=1`}
              className="text-[--color-fg-dim] hover:text-[--color-accent] transition"
              title="Abrir en el explorador"
            >
              <ExternalLink className="size-3.5" />
            </Link>
          </span>
        </div>
      </div>
    </div>
  );
}
