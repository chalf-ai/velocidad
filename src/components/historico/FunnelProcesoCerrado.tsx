"use client";

import { TrendingDown, AlertTriangle, ArrowDown, CalendarDays } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
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
 * Funnel histórico cerrado de un proceso operacional.
 *
 * Tres lecturas separadas:
 *  A. Velocidad histórica — medianas y p90 SOLO sobre pares con ambos hitos.
 *  B. Cobertura del hito — count y faltantes sobre el universo cerrado.
 *  C. Brecha de registro — cuando una etapa posterior tiene MÁS casos que la
 *     anterior (ej. ENTREGADOS > PATENTE RECIBIDA) NO se interpreta como
 *     caída operacional sino como "X entregados sin {hito} registrado".
 *
 * Cuello = dos señales independientes (Mayor pérdida + Mayor demora), pueden
 * caer en etapas/tramos distintos. Se muestran en chips arriba.
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

  const maxCantidad = Math.max(1, ...etapas.map((e) => e.cantidad));

  const isEtapaActiva = (etapaId: string) =>
    foco?.tipo === "etapa" && foco.etapaId === etapaId;
  const isTransicionActiva = (desdeId: string, hastaId: string) =>
    foco?.tipo === "transicion" && foco.desdeId === desdeId && foco.hastaId === hastaId;
  const isFaltanteActiva = (etapaId: string) =>
    foco?.tipo === "faltante" && foco.etapaId === etapaId;

  return (
    <div className="space-y-3">
      {/* ── Header / contexto del funnel ──────────────────────────────────── */}
      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
              {nombreProceso} · Histórico cerrado
            </span>
            <Badge tone="muted" size="xs">
              Universo: {fmtNum(universoCerrado)} cerrados
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {/* Mayor pérdida de cobertura */}
            <div
              className={cn(
                "rounded-lg px-3 py-2 ring-1 ring-inset",
                cuelloPerdida
                  ? "bg-[--color-warning-dim] ring-[--color-warning]"
                  : "bg-[--color-bg-elev-1] ring-[--color-border]",
              )}
            >
              <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-[--color-fg-muted] font-medium">
                <AlertTriangle className="size-3 text-[--color-warning]" />
                Mayor pérdida de cobertura
              </div>
              <div className="mt-1 text-[13px] font-medium text-[--color-fg]">
                {cuelloPerdida ? (
                  <>
                    Sin {cuelloPerdida.labelHito.toLowerCase()} ·{" "}
                    <span className="text-[--color-warning] font-semibold">
                      {fmtNum(cuelloPerdida.faltantes)} casos
                    </span>{" "}
                    <span className="text-[--color-fg-muted]">
                      ({pct(cuelloPerdida.pctUniverso)})
                    </span>
                  </>
                ) : (
                  <span className="text-[--color-fg-muted]">
                    Sin pérdidas de cobertura — todos los hitos registrados.
                  </span>
                )}
              </div>
            </div>

            {/* Mayor demora histórica */}
            <div
              className={cn(
                "rounded-lg px-3 py-2 ring-1 ring-inset",
                cuelloDemora
                  ? "bg-[--color-accent-dim] ring-[--color-accent]"
                  : "bg-[--color-bg-elev-1] ring-[--color-border]",
              )}
            >
              <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-[--color-fg-muted] font-medium">
                <TrendingDown className="size-3 text-[--color-accent]" />
                Mayor demora histórica
              </div>
              <div className="mt-1 text-[13px] font-medium text-[--color-fg]">
                {cuelloDemora ? (
                  <>
                    {cuelloDemora.desdeLabel} → {cuelloDemora.hastaLabel} ·{" "}
                    <span className="text-[--color-accent] font-semibold">
                      {dias(cuelloDemora.medianaDias)} mediana
                    </span>{" "}
                    <span className="text-[--color-fg-muted]">
                      · {dias(cuelloDemora.p90Dias)} p90 · n {fmtNum(cuelloDemora.n)}
                    </span>
                  </>
                ) : (
                  <span className="text-[--color-fg-muted]">
                    Sin tramos con pares completos.
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── Funnel centrado ───────────────────────────────────────────────── */}
      <Card>
        <CardBody className="space-y-1.5 py-4">
          {etapas.map((etapa, i) => {
            const ancho = maxCantidad > 0 ? (etapa.cantidad / maxCantidad) * 100 : 0;
            const activa = isEtapaActiva(etapa.id);
            // La etapa terminal NUNCA se ringea como cuello pérdida — su
            // count visual es el universo (100%). El faltante real del hito
            // terminal aparece en la lista de faltantes (con labelHito).
            const esCuelloPerdida =
              !etapa.esTerminal && cuelloPerdida?.etapaId === etapa.id;
            const trans = i < transiciones.length ? transiciones[i] : null;
            const transActiva = trans ? isTransicionActiva(trans.desdeId, trans.hastaId) : false;
            const esCuelloDemora =
              trans && cuelloDemora &&
              trans.desdeId === cuelloDemora.desdeId &&
              trans.hastaId === cuelloDemora.hastaId;
            // La etapa de destino de esta transición — la siguiente en `etapas`.
            const etapaDestino = trans ? etapas[i + 1] : null;

            return (
              <div key={etapa.id} className="space-y-1.5">
                {/* Etapa — barra centrada con ancho proporcional */}
                <div className="flex items-center justify-center">
                  <div
                    style={{ width: `${Math.max(ancho, 18)}%` }}
                    className="relative"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectEtapa(etapa.id)}
                      title={`Ver VINs en etapa: ${etapa.label}`}
                      className={cn(
                        "w-full rounded-lg px-4 py-2.5 text-left transition",
                        "ring-1 ring-inset",
                        activa
                          ? "bg-[--color-accent-dim] ring-[--color-accent]"
                          : esCuelloPerdida
                            ? "bg-[--color-warning-dim] ring-[--color-warning]"
                            : "bg-[--color-bg-elev-1] ring-[--color-border] hover:ring-[--color-accent]",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3 min-w-0">
                        <span
                          className={cn(
                            "text-[12px] font-semibold uppercase tracking-wider truncate",
                            activa
                              ? "text-[--color-accent]"
                              : esCuelloPerdida
                                ? "text-[--color-warning]"
                                : "text-[--color-fg]",
                          )}
                        >
                          {etapa.label}
                          {esCuelloPerdida && (
                            <span className="ml-1 text-[--color-warning]">◆</span>
                          )}
                        </span>
                        <span
                          className={cn(
                            "text-[16px] font-semibold tabular-nums shrink-0",
                            activa
                              ? "text-[--color-accent]"
                              : esCuelloPerdida
                                ? "text-[--color-warning]"
                                : "text-[--color-fg]",
                          )}
                        >
                          {fmtNum(etapa.cantidad)}
                        </span>
                      </div>
                    </button>
                    {/* % vs universo, ancla derecha */}
                    <div
                      className="absolute top-1/2 -translate-y-1/2 -right-14 text-[11.5px] tabular-nums text-[--color-fg-muted] w-12 text-right"
                    >
                      {pct(etapa.pctVsUniverso)}
                    </div>
                  </div>
                </div>

                {/* Transición — velocidad del tramo + (opcional) brecha de registro
                    No usamos lenguaje de "caída" hacia etapas terminales: la
                    diferencia se enmarca como "X sin {desde} registrada". */}
                {trans && (
                  <div className="flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => onSelectTransicion(trans.desdeId, trans.hastaId)}
                      title={`Velocidad del tramo · ${trans.desdeLabel} → ${trans.hastaLabel}`}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-[11.5px] transition",
                        "ring-1 ring-inset",
                        transActiva
                          ? "bg-[--color-accent-dim] ring-[--color-accent] text-[--color-accent] font-semibold"
                          : esCuelloDemora
                            ? "bg-[--color-accent-dim]/40 ring-[--color-accent]/40 text-[--color-fg]"
                            : "bg-transparent ring-transparent text-[--color-fg-muted] hover:text-[--color-fg] hover:ring-[--color-border]",
                      )}
                    >
                      <ArrowDown className="size-3.5 shrink-0" />
                      <span className="tabular-nums">
                        {dias(trans.medianaDias)} med
                      </span>
                      <span className="text-[--color-fg-dim]">·</span>
                      <span className="tabular-nums">
                        {dias(trans.p90Dias)} p90
                      </span>
                      <span className="text-[--color-fg-dim]">·</span>
                      <span className="tabular-nums">n {fmtNum(trans.n)}</span>
                      {/* Caída operacional: solo cuando hasta NO es terminal y
                          la diferencia es positiva. Es una pérdida de proceso real. */}
                      {trans.caidaCount > 0 && !etapaDestino?.esTerminal && (
                        <>
                          <span className="text-[--color-fg-dim]">·</span>
                          <span className="tabular-nums">
                            ▼ {fmtNum(trans.caidaCount)} caídos
                          </span>
                        </>
                      )}
                      {/* Brecha de registro: cuando count[hasta] > count[desde].
                          Para terminales se redacta "X entregados sin {desde}";
                          para no-terminales, "X sin {desde} registrada". */}
                      {trans.caidaCount < 0 && (
                        <>
                          <span className="text-[--color-fg-dim]">·</span>
                          <span className="tabular-nums text-[--color-warning]">
                            {etapaDestino?.esTerminal
                              ? `${fmtNum(Math.abs(trans.caidaCount))} entregados sin ${trans.desdeLabel.toLowerCase()} registrada`
                              : `${fmtNum(Math.abs(trans.caidaCount))} sin ${trans.desdeLabel.toLowerCase()} registrada`}
                          </span>
                        </>
                      )}
                      {esCuelloDemora && (
                        <span className="text-[--color-accent]">◆</span>
                      )}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </CardBody>
      </Card>

      {/* ── Faltantes del proceso ─────────────────────────────────────────── */}
      <Card>
        <CardBody className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
              Faltantes del proceso · click = ver VINs
            </span>
            <Badge tone="muted" size="xs">
              sobre {fmtNum(universoCerrado)} cerrados
            </Badge>
          </div>
          {faltantes.length === 0 ? (
            <div className="text-[12px] text-[--color-fg-muted] italic">
              No hay hitos faltantes en el universo cerrado.
            </div>
          ) : (
            <ul className="space-y-1">
              {faltantes.map((f) => {
                const activa = isFaltanteActiva(f.etapaId);
                return (
                  <li key={f.etapaId}>
                    <button
                      type="button"
                      onClick={() => onSelectFaltante(f.etapaId)}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition ring-1 ring-inset",
                        activa
                          ? "bg-[--color-accent-dim] text-[--color-accent] ring-[--color-accent]"
                          : "bg-[--color-bg-elev-1] text-[--color-fg] ring-[--color-border] hover:ring-[--color-accent]",
                      )}
                    >
                      <span
                        className={cn(
                          "flex-1 text-[13px] truncate",
                          activa ? "font-semibold" : "font-medium",
                        )}
                      >
                        Sin {f.labelHito.toLowerCase()}
                      </span>
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
                      <span className="text-[11px] text-[--color-fg-muted] w-44 text-right truncate">
                        {f.desdeEtapaLabel ? `desde ${f.desdeEtapaLabel}` : "etapa inicial"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* ── Segmentación temporal ─────────────────────────────────────────── */}
      {segmentacion && <SegmentacionTramoPanel segmentacion={segmentacion} />}
    </div>
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
      <CardBody className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <CalendarDays className="size-3.5 text-[--color-fg-muted]" />
          <span className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
            Segmentación temporal · {segmentacion.desdeLabel} → {segmentacion.hastaLabel}
          </span>
          <Badge tone="muted" size="xs">
            Referencia: día del mes de {segmentacion.hastaLabel.toLowerCase()}
          </Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="text-[10.5px] uppercase tracking-wider text-[--color-fg-muted]">
              <tr>
                <th className="text-left py-1.5 font-medium">Tramo del mes</th>
                <th className="text-right py-1.5 font-medium">n</th>
                <th className="text-right py-1.5 font-medium">mediana</th>
                <th className="text-right py-1.5 font-medium">promedio</th>
                <th className="text-right py-1.5 font-medium">p90</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[--color-border-soft]">
              {filas.map((f) => (
                <tr key={f.label}>
                  <td className="py-1.5 font-medium text-[--color-fg]">{f.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtNum(f.m.n)}</td>
                  <td className="py-1.5 text-right tabular-nums">{dias(f.m.medianaDias)}</td>
                  <td className="py-1.5 text-right tabular-nums">{dias(f.m.promedioDias)}</td>
                  <td className="py-1.5 text-right tabular-nums">{dias(f.m.p90Dias)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] text-[--color-fg-muted] italic">
          Solo sobre pares con ambos hitos registrados y diferencia ≥ 0.
        </div>
      </CardBody>
    </Card>
  );
}
