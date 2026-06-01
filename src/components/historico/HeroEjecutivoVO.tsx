"use client";

import { FlaskConical } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import type {
  AgregadoVelocidad,
  AgregadoCumplimiento,
  AgregadoCalidadCierre,
  ProcesoOperacional,
  ModoProceso,
} from "@/lib/historico/vista-derivados";

export type EjeId = "velocidad" | "cumplimiento" | "calidad";

/**
 * Navegación que dispara un click en uno de los KPIs del Hero.
 * Union discriminada por `tipo`:
 *   - "eje": cambia el eje activo (legacy hasta Tanda E).
 *   - "proceso": cambia procesoActivo + modoProceso. Disparado por
 *     "Principal foco operacional".
 */
export type KpiNav =
  | {
      tipo: "eje";
      eje: EjeId;
      focoCalidad?: "huerfano" | "inconsistente" | "correcto";
    }
  | {
      tipo: "proceso";
      proceso: ProcesoOperacional;
      modo: ModoProceso;
    };

/** Datos del KPI "Principal foco operacional". null si no hay ningún proceso operacional con casos. */
export interface PrincipalFocoOperacional {
  proceso: ProcesoOperacional;
  /** Etiqueta legible para mostrar — ej. "Control de Negocio". */
  nombre: string;
  casosAbiertos: number;
}

interface Props {
  totalUniverso: number;
  totalFiltrado: number;
  ventaIdsUnicos: number;
  vinsUnicos: number;
  eje1: AgregadoVelocidad;
  eje2: AgregadoCumplimiento;
  eje3: AgregadoCalidadCierre;
  /** Calculado fuera del componente para mantenerlo declarativo. */
  principalFoco: PrincipalFocoOperacional | null;
  modoValidacion: boolean;
  onToggleModoValidacion: () => void;
  onNavigate: (target: KpiNav) => void;
}

function pct(n: number, d: number): number {
  return d > 0 ? +((n / d) * 100).toFixed(1) : 0;
}

export function HeroEjecutivoVO({
  totalUniverso,
  totalFiltrado,
  ventaIdsUnicos,
  vinsUnicos,
  eje2,
  eje3,
  principalFoco,
  modoValidacion,
  onToggleModoValidacion,
  onNavigate,
}: Props) {
  // Cumplimiento: % completo sobre todo el universo filtrado
  const completos = eje2.global.porNivelDocumental.completo;
  const pctCompleto = pct(completos, eje2.global.universo);

  // Calidad: % correctos sobre entregados evaluados (correcto+huerfano+inconsistente)
  const entregadosEvaluados =
    eje3.distribucion.correcto + eje3.distribucion.huerfano + eje3.distribucion.inconsistente;
  const pctCorrectos = pct(eje3.distribucion.correcto, entregadosEvaluados);

  const criticos = eje3.distribucion.huerfano + eje3.distribucion.inconsistente;

  // Tones
  const toneCompl = pctCompleto >= 70 ? "success" : pctCompleto >= 50 ? "warning" : "danger";
  const toneCalidad = pctCorrectos >= 70 ? "success" : pctCorrectos >= 50 ? "warning" : "danger";
  const toneCriticos = entregadosEvaluados === 0
    ? "default"
    : criticos / Math.max(entregadosEvaluados, 1) < 0.3
      ? "warning"
      : "danger";

  return (
    <Card variant="elevated">
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
            Resumen ejecutivo
            {totalFiltrado !== totalUniverso && (
              <span className="ml-2 text-[--color-accent] normal-case tracking-normal">
                · vista filtrada {fmtNum(totalFiltrado)} / {fmtNum(totalUniverso)}
              </span>
            )}
          </div>
          <button
            onClick={onToggleModoValidacion}
            className={cn(
              "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium ring-1 ring-inset transition",
              modoValidacion
                ? "bg-[--color-accent] text-white ring-[--color-accent]"
                : "bg-[--color-bg-elev-1] text-[--color-fg-muted] ring-[--color-border] hover:ring-[--color-accent]",
            )}
          >
            <FlaskConical className="size-3" />
            Modo validación
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat
            label="Universo total"
            value={fmtNum(totalUniverso)}
            sub={`${fmtNum(ventaIdsUnicos)} VentaIDs · ${fmtNum(vinsUnicos)} VINs`}
            size="lg"
          />
          <Stat
            label="Principal foco operacional"
            value={principalFoco?.nombre ?? "—"}
            sub={
              principalFoco
                ? `${fmtNum(principalFoco.casosAbiertos)} casos abiertos`
                : "sin proceso operacional activo"
            }
            tone="warning"
            size="lg"
            as={principalFoco ? "button" : "div"}
            onClick={
              principalFoco
                ? () =>
                    onNavigate({
                      tipo: "proceso",
                      proceso: principalFoco.proceso,
                      modo: "backlog_abierto",
                    })
                : undefined
            }
            title={
              principalFoco
                ? `Ir a ${principalFoco.nombre} · Backlog abierto`
                : undefined
            }
          />
          <Stat
            label="Cumplimiento documental"
            value={`${pctCompleto}%`}
            sub={`${fmtNum(completos)} completos / ${fmtNum(eje2.global.universo)}`}
            tone={toneCompl}
            size="lg"
            as="button"
            onClick={() => onNavigate({ tipo: "eje", eje: "cumplimiento" })}
            title="Ir a Cumplimiento"
          />
          <Stat
            label="Calidad de cierre"
            value={`${pctCorrectos}%`}
            sub={`${fmtNum(eje3.distribucion.correcto)} correctos / ${fmtNum(entregadosEvaluados)} entregados`}
            tone={toneCalidad}
            size="lg"
            as="button"
            onClick={() => onNavigate({ tipo: "eje", eje: "calidad", focoCalidad: "correcto" })}
            title="Ir a Calidad de cierre"
          />
          <Stat
            label="Casos críticos"
            value={fmtNum(criticos)}
            sub={`${fmtNum(eje3.distribucion.huerfano)} huérfanos · ${fmtNum(eje3.distribucion.inconsistente)} inconsistentes`}
            tone={toneCriticos}
            size="lg"
            as="button"
            onClick={() => onNavigate({ tipo: "eje", eje: "calidad", focoCalidad: "huerfano" })}
            title="Abrir huérfanos en Calidad"
          />
        </div>
      </CardBody>
    </Card>
  );
}
