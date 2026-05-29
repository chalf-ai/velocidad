"use client";

import { CheckCircle2, PackageX, AlertTriangle, HelpCircle } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import type { AgregadoCalidadCierre } from "@/lib/historico/vista-derivados";
import type { CalidadCierre } from "@/lib/historico/consolidador-actas";

export type FocoCierreCumplimiento = CalidadCierre | "no_evaluable";

interface Props {
  eje3: AgregadoCalidadCierre;
  focoCalidad: FocoCierreCumplimiento | null;
  onSelectCalidad: (v: FocoCierreCumplimiento | null) => void;
}

interface BucketDef {
  id: FocoCierreCumplimiento;
  label: string;
  icon: typeof CheckCircle2;
  tone: "success" | "warning" | "danger" | "muted";
}

const BUCKETS: BucketDef[] = [
  { id: "correcto",      label: "Correctos",      icon: CheckCircle2,   tone: "success" },
  { id: "huerfano",      label: "Huérfanos",      icon: PackageX,       tone: "warning" },
  { id: "inconsistente", label: "Inconsistentes", icon: AlertTriangle,  tone: "danger" },
  { id: "no_evaluable",  label: "No evaluables",  icon: HelpCircle,     tone: "muted" },
];

const TONE_CLASSES: Record<
  BucketDef["tone"],
  { bg: string; ring: string; text: string; icon: string }
> = {
  success: {
    bg: "bg-[--color-success-dim]",
    ring: "ring-[--color-success]",
    text: "text-[--color-success]",
    icon: "text-[--color-success]",
  },
  warning: {
    bg: "bg-[--color-warning-dim]",
    ring: "ring-[--color-warning]",
    text: "text-[--color-warning]",
    icon: "text-[--color-warning]",
  },
  danger: {
    bg: "bg-[--color-danger-dim]",
    ring: "ring-[--color-danger]",
    text: "text-[--color-danger]",
    icon: "text-[--color-danger]",
  },
  muted: {
    bg: "bg-[--color-bg-elev-1]",
    ring: "ring-[--color-border]",
    text: "text-[--color-fg-muted]",
    icon: "text-[--color-fg-muted]",
  },
};

/**
 * Cierre y Cumplimiento — vista transversal sin funnel.
 *
 * Solo 4 buckets: Correctos / Huérfanos / Inconsistentes / No evaluables.
 * Cada uno con su count, % sobre entregados y click → drill.
 *
 * No tiene toggle abierto/cerrado: este eje se evalúa solo sobre entregados.
 */
export function CierreCumplimientoView({ eje3, focoCalidad, onSelectCalidad }: Props) {
  const dist = eje3.distribucion;
  const total =
    dist.correcto + dist.huerfano + dist.inconsistente + dist.no_evaluable;

  return (
    <div className="space-y-3">
      <Card>
        <CardBody className="space-y-2">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
              Cierre y Cumplimiento
            </span>
            <Badge tone="muted" size="xs">
              Universo: {fmtNum(total)} entregados evaluados
            </Badge>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {BUCKETS.map((b) => {
          const cantidad = dist[b.id];
          const pctNum = total > 0 ? (cantidad / total) * 100 : 0;
          const activa = focoCalidad === b.id;
          const t = TONE_CLASSES[b.tone];
          const Icon = b.icon;
          return (
            <button
              key={b.id}
              type="button"
              disabled={cantidad === 0}
              onClick={() => onSelectCalidad(activa ? null : b.id)}
              className={cn(
                "rounded-xl p-4 text-left ring-1 ring-inset transition",
                cantidad === 0 && "opacity-50 cursor-not-allowed",
                activa
                  ? "bg-[--color-accent-dim] ring-[--color-accent]"
                  : cn(t.bg, t.ring),
              )}
            >
              <div className="flex items-center gap-2">
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    activa ? "text-[--color-accent]" : t.icon,
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
                {pctNum.toLocaleString("es-CL", { maximumFractionDigits: 1 })}% del universo
              </div>
              {cantidad > 0 && (
                <div className="mt-2 text-[11px] text-[--color-fg-muted]">
                  click = ver VINs
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
