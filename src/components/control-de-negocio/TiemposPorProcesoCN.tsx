"use client";

/**
 * "Tiempos por proceso" · agrupado por ÁREA responsable.
 *
 * Responde el detalle de "¿quién consume los días?":
 *
 *   Comercial · pre-inscripción
 *     Factura → Solicitud inscripción       mediana avg p90 n
 *
 *   Control de Negocio
 *     Sol. inscripción → Inscripción        mediana avg p90 n
 *     Patente recibida → Patente entregada  mediana avg p90 n
 *     Sol. entrega → Autorización           sin granularidad
 *
 *   Registro Civil
 *     Inscripción → Patente recibida        mediana avg p90 n
 *
 *   Comercial · auto listo para entrega
 *     Patente entregada → Sol. entrega      sin granularidad
 *     Autorización → Entrega real           sin granularidad
 *
 * Para tramos sin timestamp (5-7): cobertura del flag + leyenda.
 * No inventa, no estima, no interpola.
 *
 * Drill INLINE: click en una fila abre cola gestionable con los casos
 * del tramo (mismo patrón que el resto del módulo).
 */

import { useEffect, useRef, type ReactNode } from "react";
import { Clock, AlertCircle } from "lucide-react";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { CapaA, Tramo, TramoId } from "@/lib/control-de-negocio/cn-velocidad";
import {
  COLOR_POR_AREA,
  LABEL_AREA,
  type AreaResponsable,
} from "@/lib/control-de-negocio/cn-responsables";

// ─── Agrupación por área (4 grupos visuales de CN V1.0 REV.1) ──────────────

type GrupoArea = {
  /** Label del grupo en la presentación (puede combinar áreas). */
  titulo: string;
  /** Color del grupo (tomado de COLOR_POR_AREA). */
  color: string;
  /** Áreas responsables agrupadas en este grupo. */
  areas: AreaResponsable[];
};

const GRUPOS_AREA: GrupoArea[] = [
  {
    titulo: "Comercial · pre-inscripción",
    color: COLOR_POR_AREA.COMERCIAL,
    areas: ["COMERCIAL"],
  },
  {
    titulo: "Control de Negocio",
    color: COLOR_POR_AREA.CONTROL_DE_NEGOCIO,
    areas: ["CONTROL_DE_NEGOCIO"],
  },
  {
    titulo: "Registro Civil",
    color: COLOR_POR_AREA.CONTROL_DE_NEGOCIO_RC,
    areas: ["CONTROL_DE_NEGOCIO_RC"],
  },
  {
    titulo: "Comercial · auto listo para entrega",
    color: COLOR_POR_AREA.COMERCIAL_SUCURSAL,
    areas: ["COMERCIAL_SUCURSAL", "COMERCIAL_CLIENTE"],
  },
];

export function TiemposPorProcesoCN({
  capa,
  tramoActivo,
  onTramoClick,
  colaInferior,
}: {
  capa: CapaA;
  tramoActivo: TramoId | null;
  onTramoClick: (id: TramoId | null) => void;
  colaInferior?: ReactNode;
}) {
  const colaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (colaInferior && colaRef.current) {
      colaRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [colaInferior, tramoActivo]);

  // Agrupar los tramos por área (los grupos definen el orden de presentación).
  const tramosPorGrupo = GRUPOS_AREA.map((g) => ({
    grupo: g,
    tramos: capa.tramos.filter((t) =>
      g.areas.includes(t.responsable.area),
    ),
  })).filter((x) => x.tramos.length > 0);

  return (
    <>
      <div className="surface bg-white px-5 py-5">
        <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-[--color-fg] flex items-center gap-2">
              <Clock className="size-4 text-[--color-accent]" />
              Tiempos por proceso
            </h2>
            <p className="text-[12px] text-[--color-fg-muted] mt-0.5">
              Días entre hitos cuando ambos están registrados · agrupado por
              área responsable.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {tramosPorGrupo.map(({ grupo, tramos }) => (
            <BloqueGrupo
              key={grupo.titulo}
              grupo={grupo}
              tramos={tramos}
              tramoActivo={tramoActivo}
              onTramoClick={onTramoClick}
            />
          ))}
        </div>

        <div className="mt-4 pt-3 border-t border-[--color-border] text-[10.5px] text-[--color-fg-muted] flex items-start gap-1.5">
          <AlertCircle className="size-3 text-[--color-warning] shrink-0 mt-0.5" />
          <span>
            Tramos sin timestamp (5-7): se muestra cobertura del flag (Si/No)
            en lugar de días. Pendiente instrumentación de los hitos.
          </span>
        </div>
      </div>
      {colaInferior && (
        <div ref={colaRef} className="scroll-mt-4">
          {colaInferior}
        </div>
      )}
    </>
  );
}

// ─── Bloque de un grupo (área) ─────────────────────────────────────────────

function BloqueGrupo({
  grupo,
  tramos,
  tramoActivo,
  onTramoClick,
}: {
  grupo: GrupoArea;
  tramos: Tramo[];
  tramoActivo: TramoId | null;
  onTramoClick: (id: TramoId | null) => void;
}) {
  return (
    <div className="rounded-md border border-[--color-border] overflow-hidden">
      {/* Header del grupo · color del área */}
      <div
        className="px-3 py-2 flex items-center gap-2 text-white text-[12px] font-semibold tracking-tight"
        style={{ backgroundColor: grupo.color }}
      >
        <span className="inline-block size-2 rounded-sm bg-white/70" />
        {grupo.titulo}
        <span className="ml-auto text-[10.5px] font-normal opacity-85">
          {tramos.length} {tramos.length === 1 ? "tramo" : "tramos"}
        </span>
      </div>

      {/* Tabla compacta de tramos del grupo */}
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.05em] text-[--color-fg-muted] bg-[--color-bg-elev-1]">
            <th className="text-left py-1.5 px-3">Tramo</th>
            <th className="text-right py-1.5 px-3">Mediana</th>
            <th className="text-right py-1.5 px-3">Promedio</th>
            <th className="text-right py-1.5 px-3">P90</th>
            <th className="text-right py-1.5 px-3">Max</th>
            <th className="text-right py-1.5 px-3">N</th>
            <th className="text-right py-1.5 px-3">Sin dato</th>
          </tr>
        </thead>
        <tbody>
          {tramos.map((t) => (
            <FilaTramo
              key={t.id}
              tramo={t}
              active={tramoActivo === t.id}
              onClick={() => onTramoClick(tramoActivo === t.id ? null : t.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FilaTramo({
  tramo,
  active,
  onClick,
}: {
  tramo: Tramo;
  active: boolean;
  onClick: () => void;
}) {
  if (tramo.kind === "cobertura") {
    return (
      <tr
        onClick={onClick}
        className={cn(
          "border-t border-[--color-border]/60 cursor-pointer transition",
          active ? "bg-[--color-accent]/[0.06]" : "hover:bg-[--color-bg-elev-1]/40",
        )}
      >
        <td className="py-2 px-3 text-[--color-fg]">{tramo.label}</td>
        <td
          colSpan={5}
          className="py-2 px-3 text-right text-[10.5px] italic text-[--color-fg-dim]"
        >
          <AlertCircle className="inline size-3 mr-1 text-[--color-warning]" />
          sin granularidad temporal · {tramo.pct.toFixed(0)}% cobertura del flag
          {" "}({fmtNum(tramo.conFlag)} de {fmtNum(tramo.universo)})
        </td>
        <td className="py-2 px-3 text-right mono text-[--color-fg-muted]">
          {fmtNum(tramo.universo)}
        </td>
      </tr>
    );
  }
  return (
    <tr
      onClick={onClick}
      className={cn(
        "border-t border-[--color-border]/60 cursor-pointer transition",
        active ? "bg-[--color-accent]/[0.06]" : "hover:bg-[--color-bg-elev-1]/40",
      )}
    >
      <td className="py-2 px-3 text-[--color-fg]">
        {tramo.label}
        {active && (
          <span className="ml-2 text-[10px] text-[--color-accent] font-semibold">
            ← cola abierta abajo
          </span>
        )}
      </td>
      <td className="py-2 px-3 text-right mono font-semibold text-[--color-fg]">
        {tramo.mediana != null ? `${tramo.mediana.toFixed(1)}d` : "—"}
      </td>
      <td className="py-2 px-3 text-right mono text-[--color-fg-muted]">
        {tramo.promedio != null ? `${tramo.promedio.toFixed(1)}d` : "—"}
      </td>
      <td className="py-2 px-3 text-right mono text-[--color-fg-muted]">
        {tramo.p90 != null ? `${tramo.p90.toFixed(1)}d` : "—"}
      </td>
      <td className="py-2 px-3 text-right mono text-[--color-fg-dim]">
        {tramo.max != null ? `${tramo.max.toFixed(0)}d` : "—"}
      </td>
      <td className="py-2 px-3 text-right mono text-[--color-fg-muted]">
        {fmtNum(tramo.n)}
      </td>
      <td className="py-2 px-3 text-right mono text-[--color-fg-dim]">
        {tramo.sinDato > 0 ? (
          <span className="text-[--color-warning]">{fmtNum(tramo.sinDato)}</span>
        ) : (
          "0"
        )}
      </td>
    </tr>
  );
}

// `LABEL_AREA` se mantiene importado para mostrar tooltip en el futuro si
// hace falta, pero no se usa en esta versión.
void LABEL_AREA;
