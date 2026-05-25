"use client";

/**
 * MESA DE GESTIÓN DEL CASO — gestión viva, editable y persistente del VIN.
 *
 * Es el lugar de trabajo operacional del caso: responsable, prioridad (override),
 * compromiso, contexto, próxima acción (con sugerencia del sistema), bitácora /
 * historial y estado de seguimiento. Escribe sobre `useGestionStore` (indexado
 * por VIN) — la MISMA fuente de verdad que usa todo el sistema. Componente
 * compartido para que la ficha operacional y el Centro de Acción gestionen el
 * caso de forma idéntica, sin duplicar lógica.
 */

import { useState } from "react";
import {
  Activity,
  Calendar,
  CheckCircle2,
  CircleDot,
  Flag,
  MessageSquare,
  Target,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { useGestionStore } from "@/lib/gestion/store";
import {
  ESTADOS_GESTION_ORDEN,
  ESTADO_GESTION_LABEL,
  ESTADO_GESTION_TONE,
  type EstadoGestion,
  type GestionVIN,
  type PrioridadManual,
} from "@/lib/gestion/types";
import { evalCompromiso, type CompromisoEstado } from "@/lib/gestion/caso";
import type { ScoreVIN } from "@/lib/selectors/score";

const GESTION_INPUT_CLS =
  "w-full rounded-md border border-[--color-border-strong] bg-white px-2.5 py-1.5 text-[12px] focus:border-[--color-accent]";

/**
 * Mesa de gestión editable del caso. `score` alimenta la "acción sugerida" (botón
 * usar sugerencia). Pura sobre el store: toda escritura va a useGestionStore.
 */
export function MesaGestionCaso({ vin, score }: { vin: string; score: ScoreVIN }) {
  const gestion = useGestionStore((s) => s.byVin[vin]);
  const setG = useGestionStore((s) => s.setGestion);
  const clearG = useGestionStore((s) => s.clearGestion);

  const estadoActual: EstadoGestion = gestion?.estadoGestion ?? "abierto";
  const prioridadActual = gestion?.prioridadManual ?? null;

  // Próxima acción es controlada localmente para soportar el botón "usar sugerencia".
  const [proxText, setProxText] = useState(gestion?.proximaAccion ?? "");
  const sugerencia = score.accionSugerida.trim();
  const yaUsaSugerencia = (gestion?.proximaAccion ?? "").trim() === sugerencia && sugerencia !== "";
  const usarSugerencia = () => {
    setProxText(sugerencia);
    setG(vin, { proximaAccion: sugerencia });
  };

  return (
    <div className="space-y-4">
      {/* Responsable + ownership */}
      <div>
        <FieldLabel icon={<User className="size-3" />}>Responsable del caso</FieldLabel>
        <div className="flex items-center gap-2">
          {gestion?.responsable ? (
            <Avatar nombre={gestion.responsable} />
          ) : (
            <span className="inline-flex items-center justify-center size-8 rounded-full bg-[--color-bg-elev-3] text-[--color-fg-dim] text-[11px] font-bold shrink-0">
              ?
            </span>
          )}
          <input
            type="text"
            placeholder="Sin asignar — escribe quién toma el caso"
            defaultValue={gestion?.responsable ?? ""}
            onBlur={(e) => setG(vin, { responsable: e.target.value.trim() || null })}
            className={cn(GESTION_INPUT_CLS, "flex-1")}
          />
        </div>
        {/* Email del responsable — preparado para notificación automática futura
            (hoy NO se envían correos, solo se captura). */}
        <input
          type="email"
          placeholder="Email del responsable (para notificación futura · opcional)"
          defaultValue={gestion?.responsableEmail ?? ""}
          onBlur={(e) => setG(vin, { responsableEmail: e.target.value.trim() || null })}
          className={cn(GESTION_INPUT_CLS, "mt-2")}
        />
      </div>

      {/* Estado + prioridad */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <FieldLabel icon={<CircleDot className="size-3" />}>Estado</FieldLabel>
          <select
            value={estadoActual}
            onChange={(e) => setG(vin, { estadoGestion: e.target.value as EstadoGestion })}
            className={GESTION_INPUT_CLS}
          >
            {ESTADOS_GESTION_ORDEN.map((s) => (
              <option key={s} value={s}>
                {ESTADO_GESTION_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel icon={<Flag className="size-3" />}>Prioridad (override)</FieldLabel>
          <select
            value={prioridadActual ?? ""}
            onChange={(e) =>
              setG(vin, {
                prioridadManual: e.target.value === "" ? null : (e.target.value as PrioridadManual),
              })
            }
            className={GESTION_INPUT_CLS}
          >
            <option value="">Auto (usar score)</option>
            <option value="critica">Crítica</option>
            <option value="alta">Alta</option>
            <option value="media">Media</option>
            <option value="baja">Baja</option>
          </select>
        </div>
      </div>

      {/* Compromiso con estado visual */}
      <div>
        <FieldLabel icon={<Calendar className="size-3" />}>Compromiso</FieldLabel>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            defaultValue={gestion?.fechaCompromiso ?? ""}
            onChange={(e) => setG(vin, { fechaCompromiso: e.target.value || null })}
            className={cn(GESTION_INPUT_CLS, "max-w-[170px]")}
          />
          <CompromisoBadge fecha={gestion?.fechaCompromiso} size="md" />
        </div>
      </div>

      {/* CONTEXTO */}
      <div>
        <FieldLabel icon={<MessageSquare className="size-3" />}>
          Contexto · por qué está detenido
        </FieldLabel>
        <textarea
          placeholder="Situación actual, blocker, con quién está trabado…"
          defaultValue={gestion?.comentario ?? ""}
          onBlur={(e) => setG(vin, { comentario: e.target.value.trim() || null })}
          rows={2}
          className={cn(GESTION_INPUT_CLS, "resize-none")}
        />
      </div>

      {/* PRÓXIMA ACCIÓN */}
      <div>
        <FieldLabel icon={<Target className="size-3" />}>Próxima acción</FieldLabel>
        <textarea
          placeholder="Qué hay que hacer ahora · paso concreto y accionable"
          value={proxText}
          onChange={(e) => setProxText(e.target.value)}
          onBlur={(e) => setG(vin, { proximaAccion: e.target.value.trim() || null })}
          rows={2}
          className={cn(
            GESTION_INPUT_CLS,
            "resize-none border-[--color-accent]/30 bg-[--color-accent]/[0.03]",
          )}
        />
        {sugerencia &&
          (yaUsaSugerencia ? (
            <div className="flex items-center gap-1.5 text-[10.5px] text-[#0f7a59] mt-1.5">
              <CheckCircle2 className="size-3" /> Usando la acción sugerida por el sistema
            </div>
          ) : (
            <button
              onClick={usarSugerencia}
              className="group flex items-start gap-1.5 text-left mt-1.5 w-full rounded-md border border-[--color-accent]/25 bg-[--color-accent]/[0.04] px-2 py-1.5 hover:border-[--color-accent]/50 transition"
            >
              <Target className="size-3 text-[--color-accent] mt-0.5 shrink-0" />
              <span className="text-[10.5px] text-[--color-fg-muted] flex-1 leading-snug">
                Sugerencia: <span className="text-[--color-fg]">{sugerencia}</span>
              </span>
              <span className="text-[10px] font-semibold text-[--color-accent] shrink-0 group-hover:underline">
                Usar
              </span>
            </button>
          ))}
      </div>

      {/* TIMELINE viva */}
      <div className="border-t border-[--color-border-soft] pt-3">
        <div className="flex items-center justify-between mb-2">
          <FieldLabel icon={<Activity className="size-3" />}>Actividad del caso</FieldLabel>
          {gestion?.historial && gestion.historial.length > 0 && (
            <span className="text-[10px] text-[--color-fg-dim]">
              {gestion.historial.length} {gestion.historial.length === 1 ? "cambio" : "cambios"}
            </span>
          )}
        </div>
        <TimelineGestion historial={gestion?.historial ?? []} />
      </div>

      {/* footer */}
      <div className="flex items-center justify-between flex-wrap gap-2 border-t border-[--color-border-soft] pt-3">
        <div className="flex items-center gap-2">
          <Badge tone={ESTADO_GESTION_TONE[estadoActual]} size="xs">
            {ESTADO_GESTION_LABEL[estadoActual]}
          </Badge>
          <span className="text-[10.5px] text-[--color-fg-dim]">
            {gestion?.ultimaActualizacion
              ? `Actualizado ${tiempoRelativo(gestion.ultimaActualizacion)}`
              : "Sin gestión registrada"}
          </span>
        </div>
        {gestion && (
          <button
            onClick={() => clearG(vin)}
            className="text-[10.5px] text-[--color-danger] hover:underline"
          >
            Limpiar gestión
          </button>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── Helpers de presentación ──────────────────────────

function FieldLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[--color-fg-muted] font-semibold mb-1.5">
      <span className="text-[--color-fg-dim]">{icon}</span>
      {children}
    </label>
  );
}

/** Iniciales para avatar de responsable. */
function iniciales(nombre: string): string {
  const parts = nombre.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_COLORS = [
  "#3358e8",
  "#15a87b",
  "#d97706",
  "#7c3aed",
  "#0d9488",
  "#db2777",
  "#2e90fa",
  "#b45309",
];
/** Color estable por nombre (hash) — mismo responsable, mismo color. */
function colorResponsable(nombre: string): string {
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function Avatar({ nombre, size = "md" }: { nombre: string; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "size-6 text-[9.5px]" : "size-8 text-[11px]";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full text-white font-bold shrink-0 shadow-sm",
        dim,
      )}
      style={{ background: colorResponsable(nombre) }}
      title={nombre}
    >
      {iniciales(nombre)}
    </span>
  );
}

const COMPROMISO_CFG: Record<
  CompromisoEstado,
  { dot: string; text: string; bg: string; border: string }
> = {
  vigente: {
    dot: "#15a87b",
    text: "text-[#0f7a59]",
    bg: "bg-[#15a87b]/8",
    border: "border-[#15a87b]/30",
  },
  pronto: {
    dot: "#d97706",
    text: "text-[#b45309]",
    bg: "bg-[#d97706]/10",
    border: "border-[#d97706]/35",
  },
  vencido: {
    dot: "#dc2626",
    text: "text-[--color-danger]",
    bg: "bg-[--color-danger]/8",
    border: "border-[--color-danger]/40",
  },
  sin: {
    dot: "#94a3b8",
    text: "text-[--color-fg-muted]",
    bg: "bg-[--color-bg-elev-3]",
    border: "border-[--color-border]",
  },
};

function CompromisoBadge({
  fecha,
  size = "sm",
}: {
  fecha: string | null | undefined;
  size?: "sm" | "md";
}) {
  const info = evalCompromiso(fecha);
  if (info.estado === "sin") return null;
  const cfg = COMPROMISO_CFG[info.estado];
  const pad = size === "md" ? "px-2.5 py-1 text-[11.5px]" : "px-2 py-0.5 text-[10.5px]";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border font-medium",
        pad,
        cfg.bg,
        cfg.border,
        cfg.text,
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", info.estado === "vencido" && "dot-pulse")}
        style={{ background: cfg.dot }}
      />
      {info.label}
    </span>
  );
}

const CAMPO_META: Record<string, { icon: React.ReactNode; color: string }> = {
  Contexto: { icon: <MessageSquare className="size-3" />, color: "#3358e8" },
  Comentario: { icon: <MessageSquare className="size-3" />, color: "#3358e8" },
  "Próxima acción": { icon: <Target className="size-3" />, color: "#7c3aed" },
  Responsable: { icon: <User className="size-3" />, color: "#0d9488" },
  "Fecha compromiso": { icon: <Calendar className="size-3" />, color: "#d97706" },
  Estado: { icon: <CircleDot className="size-3" />, color: "#2e90fa" },
  "Prioridad manual": { icon: <Flag className="size-3" />, color: "#dc2626" },
};

/** Tiempo relativo legible para la timeline. */
function tiempoRelativo(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} d`;
  return new Date(iso).toLocaleDateString("es-CL", { dateStyle: "short" });
}

/** Timeline viva — actividad del caso desde el historial (más reciente arriba). */
function TimelineGestion({ historial }: { historial: GestionVIN["historial"] }) {
  if (!historial || historial.length === 0) {
    return (
      <div className="text-[11.5px] text-[--color-fg-dim] italic py-1">
        Sin actividad todavía. Asigna un responsable o deja la próxima acción para empezar la
        bitácora.
      </div>
    );
  }
  const entries = [...historial].reverse().slice(0, 12);
  return (
    <ol className="relative pl-5">
      <span className="absolute left-[6px] top-1 bottom-1 w-px bg-[--color-border]" />
      {entries.map((h, i) => {
        const meta = CAMPO_META[h.campo] ?? { icon: <Activity className="size-3" />, color: "#94a3b8" };
        return (
          <li key={i} className="relative pb-3 last:pb-0">
            <span
              className="absolute -left-5 top-0.5 inline-flex items-center justify-center size-[13px] rounded-full text-white"
              style={{ background: meta.color }}
            >
              {meta.icon}
            </span>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11.5px] font-semibold text-[--color-fg]">{h.campo}</span>
              <span className="text-[10px] text-[--color-fg-dim] shrink-0">
                {tiempoRelativo(h.fecha)}
              </span>
            </div>
            <div className="text-[11px] text-[--color-fg-muted] mt-0.5 leading-snug">
              <span className="line-through opacity-50">{h.valorAnterior}</span>
              <span className="mx-1">→</span>
              <span className="text-[--color-fg] font-medium">{h.valorNuevo}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
