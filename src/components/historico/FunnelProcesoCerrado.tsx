"use client";

import {
  TrendingDown,
  AlertTriangle,
  ArrowDown,
  CalendarDays,
  ChevronRight,
} from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import type {
  FunnelCerrado,
  SegmentacionTramo,
  MetricasTramo,
} from "@/lib/historico/vista-derivados";

/** Foco visual del funnel. Un único foco activo por proceso. */
export type FocoFunnel =
  | { tipo: "etapa"; etapaId: string }
  | { tipo: "transicion"; desdeId: string; hastaId: string }
  | { tipo: "faltante"; etapaId: string };

interface Props {
  funnel: FunnelCerrado;
  nombreProceso: string;
  foco: FocoFunnel | null;
  /** Segmentación temporal del tramo seleccionado. null si no hay foco-transición. */
  segmentacion: SegmentacionTramo | null;
  onSelectEtapa: (etapaId: string) => void;
  onSelectTransicion: (desdeId: string, hastaId: string) => void;
  onSelectFaltante: (etapaId: string) => void;
}

function dias(v: number | null): string {
  if (v == null) return "—";
  return `${v.toLocaleString("es-CL", { maximumFractionDigits: 1 })} d`;
}

function pct(v: number): string {
  return `${v.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`;
}

/**
 * Funnel histórico cerrado de un proceso operacional — vista visual rica.
 *
 * Composición de arriba a abajo:
 *  1. Dos cards de cuello con tono (pérdida warning · demora accent).
 *  2. Funnel visual centrado con barras de ancho proporcional al count,
 *     fondo de color azul, ancla derecha con %.
 *  3. Flechas entre etapas con métricas tipográficamente jerarquizadas.
 *  4. Faltantes con barras de progreso semánticas (estilo tabla
 *     financieras del Sistema de Velocidad Operacional).
 *  5. Segmentación temporal aparece debajo cuando se selecciona una flecha.
 */
export function FunnelProcesoCerrado({
  funnel,
  nombreProceso,
  foco,
  segmentacion,
  onSelectEtapa,
  onSelectTransicion,
  onSelectFaltante,
}: Props) {
  const { universoCerrado, etapas, transiciones, cuelloPerdida, cuelloDemora, faltantes } = funnel;

  // Para las barras del funnel — todo proporcional al universo (no al máximo)
  // así la barra terminal queda al 100% y el embudo se lee claro.
  const maxParaEscala = Math.max(1, universoCerrado);

  const isEtapaActiva = (etapaId: string) =>
    foco?.tipo === "etapa" && foco.etapaId === etapaId;
  const isTransicionActiva = (desdeId: string, hastaId: string) =>
    foco?.tipo === "transicion" && foco.desdeId === desdeId && foco.hastaId === hastaId;
  const isFaltanteActiva = (etapaId: string) =>
    foco?.tipo === "faltante" && foco.etapaId === etapaId;

  // Faltante máximo — para escalar las barras de progreso de la sección B.
  const maxFaltantes = Math.max(1, ...faltantes.map((f) => f.faltantes));

  return (
    <div className="space-y-4">
      {/* ── A · Cards de cuello (con tono semántico) ──────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <CuelloCard
          tono="warn"
          icon={AlertTriangle}
          kicker="Mayor pérdida de cobertura"
          titulo={cuelloPerdida ? `Sin ${cuelloPerdida.labelHito.toLowerCase()}` : "Sin pérdidas"}
          valor={cuelloPerdida ? fmtNum(cuelloPerdida.faltantes) : "0"}
          unidad="casos"
          detalle={cuelloPerdida
            ? `${pct(cuelloPerdida.pctUniverso)} del universo cerrado`
            : "Todos los hitos están registrados"}
          cta={cuelloPerdida ? "Ver VINs sin este hito" : undefined}
          onClick={cuelloPerdida ? () => onSelectFaltante(cuelloPerdida.etapaId) : undefined}
        />
        <CuelloCard
          tono="info"
          icon={TrendingDown}
          kicker="Mayor demora histórica"
          titulo={cuelloDemora
            ? `${cuelloDemora.desdeLabel} → ${cuelloDemora.hastaLabel}`
            : "Sin tramos medibles"}
          valor={cuelloDemora ? dias(cuelloDemora.medianaDias) : "—"}
          unidad="mediana"
          detalle={cuelloDemora
            ? `p90 ${dias(cuelloDemora.p90Dias)} · n ${fmtNum(cuelloDemora.n)} pares completos`
            : "No hay pares con ambos hitos"}
          cta={cuelloDemora ? "Ver segmentación temporal" : undefined}
          onClick={cuelloDemora ? () => onSelectTransicion(cuelloDemora.desdeId, cuelloDemora.hastaId) : undefined}
        />
      </div>

      {/* ── B · Funnel visual ─────────────────────────────────────────────── */}
      <Card>
        <CardBody className="space-y-1.5 py-5 px-4">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-semibold mb-3 px-2">
            Funnel del proceso · {nombreProceso}
          </div>

          {etapas.map((etapa, i) => {
            const ancho = Math.max(22, (etapa.cantidad / maxParaEscala) * 100);
            const activa = isEtapaActiva(etapa.id);
            const esCuelloPerdida =
              !etapa.esTerminal && cuelloPerdida?.etapaId === etapa.id;
            const trans = i < transiciones.length ? transiciones[i] : null;
            const transActiva = trans ? isTransicionActiva(trans.desdeId, trans.hastaId) : false;
            const esCuelloDemora =
              trans && cuelloDemora &&
              trans.desdeId === cuelloDemora.desdeId &&
              trans.hastaId === cuelloDemora.hastaId;
            const etapaDestino = trans ? etapas[i + 1] : null;

            // Gradiente azul → más intenso en etapas con más cantidad.
            // Para etapas marcadas como cuello → tono warning.
            const tintBg = esCuelloPerdida
              ? "linear-gradient(90deg, color-mix(in srgb, var(--color-warning) 16%, transparent), color-mix(in srgb, var(--color-warning) 24%, transparent))"
              : activa
                ? "linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 18%, transparent), color-mix(in srgb, var(--color-accent) 28%, transparent))"
                : "linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 8%, transparent), color-mix(in srgb, var(--color-accent) 16%, transparent))";

            return (
              <div key={etapa.id} className="space-y-1.5">
                {/* Etapa — fila con barra proporcional + ancla derecha del % */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-center">
                      <button
                        type="button"
                        onClick={() => onSelectEtapa(etapa.id)}
                        title={`Ver VINs en etapa: ${etapa.label}`}
                        style={{ width: `${ancho}%`, background: tintBg }}
                        className={cn(
                          "rounded-lg px-4 py-3 text-left transition",
                          "ring-1 ring-inset",
                          activa
                            ? "ring-[--color-accent]"
                            : esCuelloPerdida
                              ? "ring-[--color-warning]"
                              : "ring-[--color-border]/40 hover:ring-[--color-accent]",
                        )}
                      >
                        <div className="flex items-center justify-between gap-3 min-w-0">
                          <span
                            className={cn(
                              "text-[11.5px] font-semibold uppercase tracking-[0.1em] truncate",
                              esCuelloPerdida ? "text-[--color-warning]" : "text-[--color-fg]",
                            )}
                          >
                            {etapa.label}
                            {esCuelloPerdida && (
                              <span className="ml-1.5 text-[--color-warning]">●</span>
                            )}
                          </span>
                          <span
                            className={cn(
                              "text-[18px] font-semibold tabular-nums shrink-0",
                              esCuelloPerdida ? "text-[--color-warning]" : "text-[--color-fg]",
                            )}
                          >
                            {fmtNum(etapa.cantidad)}
                          </span>
                        </div>
                      </button>
                    </div>
                  </div>
                  <div className="w-14 text-right text-[12px] tabular-nums text-[--color-fg-muted] shrink-0">
                    {pct(etapa.pctVsUniverso)}
                  </div>
                </div>

                {/* Transición — flecha + métricas */}
                {trans && (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 flex items-center justify-center">
                      <button
                        type="button"
                        onClick={() => onSelectTransicion(trans.desdeId, trans.hastaId)}
                        title={`Velocidad del tramo · ${trans.desdeLabel} → ${trans.hastaLabel}`}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[11.5px] transition ring-1 ring-inset",
                          transActiva
                            ? "bg-[--color-accent-dim] ring-[--color-accent] text-[--color-accent] font-semibold"
                            : esCuelloDemora
                              ? "bg-[--color-accent-dim]/60 ring-[--color-accent]/40 text-[--color-fg]"
                              : "bg-transparent ring-transparent text-[--color-fg-muted] hover:text-[--color-fg] hover:bg-[--color-bg-elev-1]",
                        )}
                      >
                        <ArrowDown className="size-3.5 shrink-0" />
                        <span className="tabular-nums font-medium">{dias(trans.medianaDias)} med</span>
                        <span className="text-[--color-fg-dim]">·</span>
                        <span className="tabular-nums">{dias(trans.p90Dias)} p90</span>
                        <span className="text-[--color-fg-dim]">·</span>
                        <span className="tabular-nums">n {fmtNum(trans.n)}</span>
                        {trans.caidaCount > 0 && !etapaDestino?.esTerminal && (
                          <>
                            <span className="text-[--color-fg-dim]">·</span>
                            <span className="tabular-nums">▼ {fmtNum(trans.caidaCount)} caídos</span>
                          </>
                        )}
                        {trans.caidaCount < 0 && (
                          <>
                            <span className="text-[--color-fg-dim]">·</span>
                            <span className="tabular-nums text-[--color-warning] font-medium">
                              {etapaDestino?.esTerminal
                                ? `${fmtNum(Math.abs(trans.caidaCount))} sin ${trans.desdeLabel.toLowerCase()}`
                                : `${fmtNum(Math.abs(trans.caidaCount))} sin ${trans.desdeLabel.toLowerCase()}`}
                            </span>
                          </>
                        )}
                        {esCuelloDemora && (
                          <span className="ml-0.5 text-[--color-accent]">●</span>
                        )}
                      </button>
                    </div>
                    <div className="w-14 shrink-0" />
                  </div>
                )}
              </div>
            );
          })}
        </CardBody>
      </Card>

      {/* ── C · Faltantes con barras de progreso ──────────────────────────── */}
      <Card>
        <CardBody className="space-y-2 py-4">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-semibold">
              Faltantes del proceso
            </span>
            <span className="text-[11px] text-[--color-fg-muted]">
              · sobre {fmtNum(universoCerrado)} cerrados · click = ver VINs
            </span>
          </div>
          {faltantes.length === 0 ? (
            <div className="text-[12px] text-[--color-fg-muted] italic">
              No hay hitos faltantes en el universo cerrado.
            </div>
          ) : (
            <ul className="space-y-1">
              {faltantes.map((f) => {
                const activa = isFaltanteActiva(f.etapaId);
                const proporcion = f.faltantes / maxFaltantes;
                // Tono semántico por intensidad: >40% naranjo intenso, 20-40% naranjo claro, <20% gris.
                const tonoBarra =
                  f.pctUniverso > 40
                    ? "bg-[--color-warning]"
                    : f.pctUniverso > 20
                      ? "bg-[--color-warning]/55"
                      : "bg-[--color-fg-muted]/40";
                return (
                  <li key={f.etapaId}>
                    <button
                      type="button"
                      onClick={() => onSelectFaltante(f.etapaId)}
                      className={cn(
                        "w-full grid grid-cols-[1fr_minmax(180px,40%)_auto_auto] items-center gap-3 rounded-lg px-3 py-2 text-left transition ring-1 ring-inset",
                        activa
                          ? "bg-[--color-accent-dim] ring-[--color-accent]"
                          : "bg-[--color-bg-elev-1] ring-[--color-border] hover:ring-[--color-accent]",
                      )}
                    >
                      <span
                        className={cn(
                          "text-[13px] truncate",
                          activa ? "font-semibold text-[--color-accent]" : "font-medium text-[--color-fg]",
                        )}
                      >
                        Sin {f.labelHito.toLowerCase()}
                        {f.desdeEtapaLabel && (
                          <span className="ml-2 text-[10.5px] text-[--color-fg-muted] font-normal">
                            desde {f.desdeEtapaLabel}
                          </span>
                        )}
                      </span>

                      {/* Barra de progreso */}
                      <div className="relative h-2 rounded-full bg-[--color-bg-elev-2] overflow-hidden">
                        <div
                          className={cn("absolute inset-y-0 left-0 rounded-full", tonoBarra)}
                          style={{ width: `${Math.max(2, proporcion * 100)}%` }}
                        />
                      </div>

                      <span
                        className={cn(
                          "text-[13.5px] tabular-nums font-semibold w-16 text-right",
                          activa ? "text-[--color-accent]" : "text-[--color-fg]",
                        )}
                      >
                        {fmtNum(f.faltantes)}
                      </span>
                      <span
                        className={cn(
                          "text-[12px] tabular-nums w-14 text-right",
                          activa ? "text-[--color-accent]" : "text-[--color-fg-muted]",
                        )}
                      >
                        {pct(f.pctUniverso)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* ── D · Segmentación temporal del tramo seleccionado ──────────────── */}
      {segmentacion && <SegmentacionTramoPanel segmentacion={segmentacion} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-componentes
// ─────────────────────────────────────────────────────────────────────────────

interface CuelloCardProps {
  tono: "warn" | "info";
  icon: typeof AlertTriangle;
  kicker: string;
  titulo: string;
  valor: string;
  unidad: string;
  detalle: string;
  cta?: string;
  onClick?: () => void;
}

function CuelloCard({ tono, icon: Icon, kicker, titulo, valor, unidad, detalle, cta, onClick }: CuelloCardProps) {
  const bg =
    tono === "warn"
      ? "bg-[--color-warning-dim] ring-[--color-warning]/40"
      : "bg-[--color-accent-dim] ring-[--color-accent]/40";
  const iconBg =
    tono === "warn"
      ? "bg-[--color-warning]/15 text-[--color-warning] ring-[--color-warning]/30"
      : "bg-[--color-accent]/15 text-[--color-accent] ring-[--color-accent]/30";
  const textTone = tono === "warn" ? "text-[--color-warning]" : "text-[--color-accent]";
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "rounded-2xl p-5 ring-1 ring-inset transition text-left",
        bg,
        onClick && "hover:ring-2 cursor-pointer",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "size-10 rounded-xl ring-1 ring-inset flex items-center justify-center shrink-0",
            iconBg,
          )}
        >
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-semibold">
            {kicker}
          </div>
          <div className="mt-0.5 text-[14px] font-semibold text-[--color-fg] truncate">
            {titulo}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className={cn("text-[32px] font-semibold tabular-nums leading-none", textTone)}>
          {valor}
        </span>
        <span className="text-[12px] text-[--color-fg-muted]">{unidad}</span>
      </div>
      <div className="mt-1 text-[12px] text-[--color-fg-muted]">
        {detalle}
      </div>
      {cta && (
        <div className={cn("mt-3 inline-flex items-center gap-1 text-[12px] font-semibold", textTone)}>
          {cta}
          <ChevronRight className="size-3.5" />
        </div>
      )}
    </Wrapper>
  );
}

function SegmentacionTramoPanel({ segmentacion }: { segmentacion: SegmentacionTramo }) {
  const filas: Array<{ label: string; m: MetricasTramo }> = [
    { label: "Global",       m: segmentacion.global },
    { label: "Días 1–10",    m: segmentacion.dias_1_10 },
    { label: "Días 11–20",   m: segmentacion.dias_11_20 },
    { label: "Días 21–fin",  m: segmentacion.dias_21_fin },
  ];
  return (
    <Card>
      <CardBody className="space-y-2 py-4">
        <div className="flex items-center gap-2 flex-wrap">
          <CalendarDays className="size-3.5 text-[--color-fg-muted]" />
          <span className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-semibold">
            Segmentación temporal del tramo
          </span>
          <span className="text-[12px] text-[--color-fg] font-medium">
            {segmentacion.desdeLabel} → {segmentacion.hastaLabel}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="text-[10.5px] uppercase tracking-wider text-[--color-fg-muted]">
              <tr>
                <th className="text-left py-1.5 font-semibold">Tramo del mes</th>
                <th className="text-right py-1.5 font-semibold">n</th>
                <th className="text-right py-1.5 font-semibold">mediana</th>
                <th className="text-right py-1.5 font-semibold">promedio</th>
                <th className="text-right py-1.5 font-semibold">p90</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[--color-border-soft]">
              {filas.map((f) => (
                <tr key={f.label} className={f.label === "Global" ? "bg-[--color-bg-elev-1]" : ""}>
                  <td className="py-1.5 font-medium text-[--color-fg]">{f.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtNum(f.m.n)}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold">{dias(f.m.medianaDias)}</td>
                  <td className="py-1.5 text-right tabular-nums">{dias(f.m.promedioDias)}</td>
                  <td className="py-1.5 text-right tabular-nums">{dias(f.m.p90Dias)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] text-[--color-fg-muted] italic">
          Referencia: día del mes de {segmentacion.hastaLabel.toLowerCase()}. Solo pares con ambos hitos y diff ≥ 0.
        </div>
      </CardBody>
    </Card>
  );
}
