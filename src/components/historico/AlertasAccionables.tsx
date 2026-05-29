"use client";

import { AlertTriangle, Bell, FileWarning, PackageX, TimerReset } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import type {
  AgregadoCumplimiento,
  AgregadoCalidadCierre,
} from "@/lib/historico/vista-derivados";
import type { CuelloPrincipal } from "@/lib/historico/cruce-roma-actas";
import type { EjeId } from "@/components/historico/HeroEjecutivoVO";

export type AlertaId =
  | "huerfanos"
  | "inconsistentes"
  | "sin_patente"
  | "cuello_control_negocio"
  | "cuello_logistica";

export interface AlertaTarget {
  id: AlertaId;
  eje: EjeId;
  /** Foco extra a aplicar tras el cambio de eje. */
  focoCalidad?: "huerfano" | "inconsistente";
  focoCuello?: CuelloPrincipal;
}

interface Props {
  eje2: AgregadoCumplimiento;
  eje3: AgregadoCalidadCierre;
  cuelloCounts: Map<CuelloPrincipal, number>;
  alertaActiva: AlertaId | null;
  onAlerta: (t: AlertaTarget) => void;
}

interface AlertaSpec {
  id: AlertaId;
  icon: typeof AlertTriangle;
  label: string;
  tone: "warning" | "danger" | "info";
  target: AlertaTarget;
}

export function AlertasAccionables({
  eje2,
  eje3,
  cuelloCounts,
  alertaActiva,
  onAlerta,
}: Props) {
  const huer = eje3.distribucion.huerfano;
  const incon = eje3.distribucion.inconsistente;
  const sinPat = eje2.global.entregadosSinPatenteRecibida;
  const cuelloCN = cuelloCounts.get("Control de Negocio") ?? 0;
  const cuelloLog = cuelloCounts.get("Logística") ?? 0;

  const alertas: Array<{ spec: AlertaSpec; count: number }> = [
    {
      spec: {
        id: "huerfanos",
        icon: PackageX,
        label: "huérfanos",
        tone: "warning",
        target: { id: "huerfanos", eje: "calidad", focoCalidad: "huerfano" },
      },
      count: huer,
    },
    {
      spec: {
        id: "inconsistentes",
        icon: AlertTriangle,
        label: "inconsistentes",
        tone: "danger",
        target: { id: "inconsistentes", eje: "calidad", focoCalidad: "inconsistente" },
      },
      count: incon,
    },
    {
      spec: {
        id: "sin_patente",
        icon: FileWarning,
        label: "entregas sin patente recibida",
        tone: "warning",
        target: { id: "sin_patente", eje: "cumplimiento" },
      },
      count: sinPat,
    },
    {
      spec: {
        id: "cuello_control_negocio",
        icon: TimerReset,
        label: "cuello Control de Negocio",
        tone: "info",
        target: { id: "cuello_control_negocio", eje: "velocidad", focoCuello: "Control de Negocio" },
      },
      count: cuelloCN,
    },
    {
      spec: {
        id: "cuello_logistica",
        icon: TimerReset,
        label: "cuello Logística",
        tone: "info",
        target: { id: "cuello_logistica", eje: "velocidad", focoCuello: "Logística" },
      },
      count: cuelloLog,
    },
  ];

  const TONE: Record<
    AlertaSpec["tone"],
    { ring: string; ringActive: string; text: string; bg: string; bgActive: string; dot: string }
  > = {
    warning: {
      ring: "ring-[--color-warning]/30",
      ringActive: "ring-[--color-warning]",
      text: "text-[--color-warning]",
      bg: "bg-[--color-warning-dim]",
      bgActive: "bg-[--color-warning-dim]",
      dot: "bg-[--color-warning]",
    },
    danger: {
      ring: "ring-[--color-danger]/30",
      ringActive: "ring-[--color-danger]",
      text: "text-[--color-danger]",
      bg: "bg-[--color-danger-dim]",
      bgActive: "bg-[--color-danger-dim]",
      dot: "bg-[--color-danger]",
    },
    info: {
      ring: "ring-[--color-info]/30",
      ringActive: "ring-[--color-info]",
      text: "text-[--color-info]",
      bg: "bg-[--color-info-dim]",
      bgActive: "bg-[--color-info-dim]",
      dot: "bg-[--color-info]",
    },
  };

  return (
    <Card>
      <CardBody className="py-3 px-4 space-y-2">
        <div className="flex items-center gap-2">
          <Bell className="size-3.5 text-[--color-fg-muted]" />
          <span className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium">
            Alertas accionables
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {alertas.map(({ spec, count }) => {
            const t = TONE[spec.tone];
            const active = alertaActiva === spec.id;
            const Icon = spec.icon;
            return (
              <button
                key={spec.id}
                onClick={() => onAlerta(spec.target)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-3 py-2 ring-1 ring-inset transition",
                  active ? cn(t.bgActive, t.ringActive) : cn(t.bg, t.ring),
                )}
              >
                <Icon className={cn("size-3.5", t.text)} />
                <span className={cn("text-[13.5px] font-semibold mono", active ? t.text : "text-[--color-fg]")}>
                  {fmtNum(count)}
                </span>
                <span className="text-[12px] text-[--color-fg-muted]">
                  {spec.label}
                </span>
              </button>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
