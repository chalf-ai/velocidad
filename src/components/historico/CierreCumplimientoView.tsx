"use client";

import {
  CheckCircle2,
  PackageX,
  AlertTriangle,
  HelpCircle,
  FileWarning,
  ShieldCheck,
  Bell,
} from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import type {
  AgregadoCalidadCierre,
  AgregadoCumplimiento,
  TipoHuerfano,
} from "@/lib/historico/vista-derivados";
import type {
  CalidadCierre,
} from "@/lib/historico/consolidador-actas";
import type { ConflictoKind } from "@/lib/historico/cruce-roma-actas";
import type { NivelDocumental } from "@/lib/historico/parser-actas";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de foco — unión discriminada cubriendo las 5 lecturas de cierre
// ─────────────────────────────────────────────────────────────────────────────

export type AlertaTransversal =
  | "sin_patente_recibida"
  | "sin_autorizacion"
  | "sin_sol_entrega";

export type FocoCierreCumplimiento =
  | { tipo: "calidad"; valor: CalidadCierre | "no_evaluable" }
  | { tipo: "huerfano_tipo"; valor: TipoHuerfano }
  | { tipo: "conflicto"; valor: ConflictoKind }
  | { tipo: "nivel"; valor: NivelDocumental }
  | { tipo: "alerta"; valor: AlertaTransversal };

// ─────────────────────────────────────────────────────────────────────────────
// Labels — mismos del módulo legacy para mantener consistencia textual
// ─────────────────────────────────────────────────────────────────────────────

const HUERFANO_LABEL: Record<TipoHuerfano, string> = {
  tipo1: "T1 — entrega no registrada",
  tipo2: "T2 — cierre inconsistente",
  tipo3: "T3 — desaparecido",
  tipo4: "T4 — sin trazabilidad",
  otro:  "Otros",
};

const KIND_LABEL: Record<ConflictoKind, string> = {
  CONFLICTO_VIN:                                   "VIN cambiado",
  CONFLICTO_FFACTURA:                              "fFactura inconsistente",
  CONFLICTO_FINSCRIPCION:                          "fInscripción inconsistente",
  CONFLICTO_ENTREGA:                               "Estado de entrega",
  FECHA_IMPOSIBLE_ENTREGA_ANTES_DE_SOLICITUD:      "Entrega < Solicitud",
  FECHA_IMPOSIBLE_ENTREGA_ANTES_DE_FACTURA:        "Entrega < Factura",
  FECHA_IMPOSIBLE_PATENTE_ANTES_DE_INSCRIPCION:    "Patente < Inscripción",
  ESTADO_TERMINAL_DEGRADADO:                       "Terminal degradado",
};

const NIVEL_LABEL: Record<NivelDocumental, string> = {
  completo: "Completo",
  parcial:  "Parcial",
  minimo:   "Mínimo",
};

const ALERTA_LABEL: Record<AlertaTransversal, string> = {
  sin_patente_recibida: "Entregados sin patente recibida",
  sin_autorizacion:     "Entregados sin autorización",
  sin_sol_entrega:      "Entregados sin solicitud entrega",
};

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  eje2: AgregadoCumplimiento;
  eje3: AgregadoCalidadCierre;
  focoCierre: FocoCierreCumplimiento | null;
  onSelectFoco: (foco: FocoCierreCumplimiento | null) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cards principales (Correctos / Huérfanos / Inconsistentes / No evaluables)
// ─────────────────────────────────────────────────────────────────────────────

interface BucketDef {
  id: CalidadCierre | "no_evaluable";
  label: string;
  icon: typeof CheckCircle2;
  tone: "success" | "warning" | "danger" | "muted";
}

const BUCKETS: BucketDef[] = [
  { id: "correcto",      label: "Correctos",      icon: CheckCircle2,  tone: "success" },
  { id: "huerfano",      label: "Huérfanos",      icon: PackageX,      tone: "warning" },
  { id: "inconsistente", label: "Inconsistentes", icon: AlertTriangle, tone: "danger"  },
  { id: "no_evaluable",  label: "No evaluables",  icon: HelpCircle,    tone: "muted"   },
];

const TONE_BUCKET: Record<
  BucketDef["tone"],
  { bg: string; ring: string; text: string }
> = {
  success: { bg: "bg-[--color-success-dim]", ring: "ring-[--color-success]", text: "text-[--color-success]" },
  warning: { bg: "bg-[--color-warning-dim]", ring: "ring-[--color-warning]", text: "text-[--color-warning]" },
  danger:  { bg: "bg-[--color-danger-dim]",  ring: "ring-[--color-danger]",  text: "text-[--color-danger]"  },
  muted:   { bg: "bg-[--color-bg-elev-1]",   ring: "ring-[--color-border]",  text: "text-[--color-fg-muted]" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function pctOf(n: number, total: number): number {
  return total > 0 ? +((n / total) * 100).toFixed(1) : 0;
}

function pctTxt(p: number): string {
  return `${p.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`;
}

function eqFoco(a: FocoCierreCumplimiento | null, b: FocoCierreCumplimiento): boolean {
  if (!a || a.tipo !== b.tipo) return false;
  return a.valor === b.valor;
}

function toggle(prev: FocoCierreCumplimiento | null, next: FocoCierreCumplimiento) {
  return eqFoco(prev, next) ? null : next;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vista
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cierre y Cumplimiento — vista transversal de cierre operacional.
 *
 * 5 secciones:
 *   1. Cards principales — distribución global de calidad de cierre.
 *   2. Huérfanos por tipo — desglose del bucket Huérfanos.
 *   3. Inconsistentes por conflicto material — solo conflictos con
 *      `esMaterial === true` (`agregadosEje3` ya filtra por eso).
 *   4. Cumplimiento documental — nivel completo / parcial / mínimo.
 *   5. Alertas transversales — entregados sin patente / autorización /
 *      solicitud entrega.
 *
 * Todos los buckets clickeables abren el DrillPanel debajo (controlado
 * por el caller via `onSelectFoco`).
 */
export function CierreCumplimientoView({ eje2, eje3, focoCierre, onSelectFoco }: Props) {
  const dist = eje3.distribucion;
  const totalEvaluado =
    dist.correcto + dist.huerfano + dist.inconsistente + dist.no_evaluable;

  // Filas de Huérfanos por tipo — solo nonzero, ordenadas desc.
  const huerfanosFilas = (Object.entries(eje3.huerfanosPorTipo) as Array<[TipoHuerfano, number]>)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const totalHuer = eje3.totalHuerfanos;

  // Filas de Conflictos materiales — solo nonzero, ordenadas desc.
  const conflictosFilas = (Object.entries(eje3.inconsistentesPorConflicto) as Array<[ConflictoKind, number]>)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const totalIncon = eje3.totalInconsistentes;

  // Cumplimiento documental — universo = entregados del agregado eje2.
  const niveles = eje2.global.porNivelDocumental;
  const totalNivel = niveles.completo + niveles.parcial + niveles.minimo;

  // Alertas transversales (solo sobre entregados).
  const entregados = eje2.global.entregados;
  const alertas: Array<{ id: AlertaTransversal; cantidad: number }> = [
    { id: "sin_patente_recibida", cantidad: eje2.global.entregadosSinPatenteRecibida },
    { id: "sin_autorizacion",     cantidad: eje2.global.entregadosSinAutorizacion },
    { id: "sin_sol_entrega",      cantidad: eje2.global.entregadosSinSolicitudEntrega },
  ];

  return (
    <div className="space-y-3">
      {/* Header */}
      <Card>
        <CardBody className="py-3 px-4">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
              Cierre y Cumplimiento
            </span>
            <Badge tone="muted" size="xs">
              {fmtNum(totalEvaluado)} entregados evaluados
            </Badge>
          </div>
        </CardBody>
      </Card>

      {/* ── 1 · Cards principales ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {BUCKETS.map((b) => {
          const cantidad = dist[b.id];
          const pct = pctOf(cantidad, totalEvaluado);
          const activa = eqFoco(focoCierre, { tipo: "calidad", valor: b.id });
          const t = TONE_BUCKET[b.tone];
          const Icon = b.icon;
          const disabled = cantidad === 0;
          return (
            <button
              key={b.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelectFoco(toggle(focoCierre, { tipo: "calidad", valor: b.id }))}
              className={cn(
                "rounded-xl p-4 text-left ring-1 ring-inset transition",
                disabled && "opacity-50 cursor-not-allowed",
                activa
                  ? "bg-[--color-accent-dim] ring-[--color-accent]"
                  : cn(t.bg, t.ring),
              )}
            >
              <div className="flex items-center gap-2">
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    activa ? "text-[--color-accent]" : t.text,
                  )}
                />
                <span
                  className={cn(
                    "text-[12px] font-semibold uppercase tracking-wider",
                    activa ? "text-[--color-accent]" : t.text,
                  )}
                >
                  {b.label}
                </span>
              </div>
              <div
                className={cn(
                  "mt-2 text-[28px] font-semibold tabular-nums leading-none",
                  activa ? "text-[--color-accent]" : "text-[--color-fg]",
                )}
              >
                {fmtNum(cantidad)}
              </div>
              <div
                className={cn(
                  "mt-1 text-[12px] tabular-nums",
                  activa ? "text-[--color-accent]" : "text-[--color-fg-muted]",
                )}
              >
                {pctTxt(pct)} del universo
              </div>
              {!disabled && (
                <div className="mt-2 text-[11px] text-[--color-fg-muted]">click = ver VINs</div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── 2 · Huérfanos por tipo ────────────────────────────────────────── */}
      <Card>
        <CardBody className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <PackageX className="size-3.5 text-[--color-warning]" />
            <span className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
              Huérfanos por tipo
            </span>
            <Badge tone="muted" size="xs">
              sobre {fmtNum(totalHuer)} huérfanos
            </Badge>
          </div>
          {huerfanosFilas.length === 0 ? (
            <div className="text-[12px] text-[--color-fg-muted] italic">
              No hay huérfanos en el universo filtrado.
            </div>
          ) : (
            <ul className="space-y-1">
              {huerfanosFilas.map(([t, n]) => {
                const pct = pctOf(n, totalHuer);
                const activa = eqFoco(focoCierre, { tipo: "huerfano_tipo", valor: t });
                return (
                  <li key={t}>
                    <FilaClickable
                      label={HUERFANO_LABEL[t]}
                      cantidad={n}
                      pct={pct}
                      activa={activa}
                      onClick={() => onSelectFoco(toggle(focoCierre, { tipo: "huerfano_tipo", valor: t }))}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* ── 3 · Inconsistentes por conflicto material ─────────────────────── */}
      <Card>
        <CardBody className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <AlertTriangle className="size-3.5 text-[--color-danger]" />
            <span className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
              Inconsistentes por conflicto material
            </span>
            <Badge tone="muted" size="xs">
              sobre {fmtNum(totalIncon)} inconsistentes
            </Badge>
          </div>
          {conflictosFilas.length === 0 ? (
            <div className="text-[12px] text-[--color-fg-muted] italic">
              Sin conflictos materiales en el universo filtrado.
            </div>
          ) : (
            <ul className="space-y-1">
              {conflictosFilas.map(([k, n]) => {
                const pct = pctOf(n, totalIncon);
                const activa = eqFoco(focoCierre, { tipo: "conflicto", valor: k });
                return (
                  <li key={k}>
                    <FilaClickable
                      label={KIND_LABEL[k]}
                      cantidad={n}
                      pct={pct}
                      activa={activa}
                      onClick={() => onSelectFoco(toggle(focoCierre, { tipo: "conflicto", valor: k }))}
                    />
                  </li>
                );
              })}
            </ul>
          )}
          <div className="text-[11px] text-[--color-fg-muted] italic">
            Solo conflictos con `esMaterial === true`. Un caso puede aparecer en más de un conflicto.
          </div>
        </CardBody>
      </Card>

      {/* ── 4 · Cumplimiento documental ───────────────────────────────────── */}
      <Card>
        <CardBody className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <ShieldCheck className="size-3.5 text-[--color-fg-muted]" />
            <span className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
              Cumplimiento documental
            </span>
            <Badge tone="muted" size="xs">
              sobre {fmtNum(totalNivel)} casos
            </Badge>
          </div>
          <ul className="space-y-1">
            {(["completo", "parcial", "minimo"] as NivelDocumental[]).map((nivel) => {
              const n = niveles[nivel];
              const pct = pctOf(n, totalNivel);
              const activa = eqFoco(focoCierre, { tipo: "nivel", valor: nivel });
              return (
                <li key={nivel}>
                  <FilaClickable
                    label={NIVEL_LABEL[nivel]}
                    cantidad={n}
                    pct={pct}
                    activa={activa}
                    onClick={() => onSelectFoco(toggle(focoCierre, { tipo: "nivel", valor: nivel }))}
                  />
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>

      {/* ── 5 · Alertas transversales ─────────────────────────────────────── */}
      <Card>
        <CardBody className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Bell className="size-3.5 text-[--color-fg-muted]" />
            <span className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
              Alertas transversales
            </span>
            <Badge tone="muted" size="xs">
              sobre {fmtNum(entregados)} entregados
            </Badge>
          </div>
          <ul className="space-y-1">
            {alertas.map((a) => {
              const pct = pctOf(a.cantidad, entregados);
              const activa = eqFoco(focoCierre, { tipo: "alerta", valor: a.id });
              const disabled = a.cantidad === 0;
              return (
                <li key={a.id}>
                  <FilaClickable
                    icon={<FileWarning className="size-3.5 shrink-0" />}
                    label={ALERTA_LABEL[a.id]}
                    cantidad={a.cantidad}
                    pct={pct}
                    activa={activa}
                    disabled={disabled}
                    onClick={() => onSelectFoco(toggle(focoCierre, { tipo: "alerta", valor: a.id }))}
                  />
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fila reusable
// ─────────────────────────────────────────────────────────────────────────────

interface FilaProps {
  label: string;
  cantidad: number;
  pct: number;
  activa: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}

function FilaClickable({ label, cantidad, pct, activa, onClick, disabled, icon }: FilaProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition ring-1 ring-inset",
        disabled && "opacity-50 cursor-not-allowed",
        activa
          ? "bg-[--color-accent-dim] text-[--color-accent] ring-[--color-accent]"
          : "bg-[--color-bg-elev-1] text-[--color-fg] ring-[--color-border] hover:ring-[--color-accent]",
      )}
    >
      {icon}
      <span
        className={cn(
          "flex-1 text-[13px] truncate",
          activa ? "font-semibold" : "font-medium",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "text-[13.5px] tabular-nums font-semibold w-16 text-right",
          activa ? "text-[--color-accent]" : "text-[--color-fg]",
        )}
      >
        {fmtNum(cantidad)}
      </span>
      <span
        className={cn(
          "text-[12px] tabular-nums w-14 text-right",
          activa ? "text-[--color-accent]" : "text-[--color-fg-muted]",
        )}
      >
        {pctTxt(pct)}
      </span>
    </button>
  );
}
