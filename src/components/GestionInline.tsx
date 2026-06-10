/**
 * Editor inline de gestión por VIN — COMPARTIDO entre todos los módulos.
 *
 * La gestión pertenece al VIN, no al módulo. Este componente lee/escribe
 * `useGestionStore` indexado por VIN, así que el mismo vehículo conserva su
 * estado (responsable, comentario, fecha compromiso, prioridad, historial)
 * sin importar desde qué pantalla se edite (Dashboard, Centro de Acción,
 * FNE, Judicial, TESCAR, Stock Explorer, …).
 *
 * Persiste en localStorage vía el store. Si se recarga un Excel nuevo con el
 * mismo VIN, la gestión se recupera automáticamente.
 *
 * Variantes:
 *   - "trigger" (default): chip compacto que despliega el panel inline.
 *   - "panel": panel siempre abierto (para usar dentro de filas expandidas).
 */

"use client";

import { useState } from "react";
import { History, MessageSquarePlus, Send } from "lucide-react";
import { cn } from "@/lib/cn";
import { useGestionStore } from "@/lib/gestion/store";
import { SeguimientoBadge } from "@/components/SeguimientoBadge";
import { AsignarTareaModal } from "@/components/AsignarTareaModal";

/** Clave documental (sin VIN físico): SALDO-…, BONO-…, PROV-… */
const esClaveDocumental = (clave: string) => /^(SALDO|BONO|PROV)-/.test(clave);
import {
  ESTADO_GESTION_LABEL,
  ESTADOS_GESTION_ORDEN,
  type EstadoGestion,
  type PrioridadManual,
} from "@/lib/gestion/types";

const PRIORIDAD_OPCIONES: { value: string; label: string }[] = [
  { value: "auto", label: "Automática" },
  { value: "baja", label: "Baja" },
  { value: "media", label: "Media" },
  { value: "alta", label: "Alta" },
  { value: "critica", label: "Crítica" },
];

const inputCls =
  "w-full rounded-md border border-[--color-border-strong] bg-white px-2 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-[--color-accent]/30";

function fmtFechaCorta(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-CL", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function GestionInline({
  vin,
  variant = "trigger",
  descripcionCaso,
}: {
  /** Clave del caso: VIN real o clave documental (SALDO-/BONO-/PROV-…). */
  vin: string;
  variant?: "trigger" | "panel";
  /** Descripción corta del caso documental (concepto/origen) — enriquece
   *  el mensaje de Asignar / Notificar. */
  descripcionCaso?: string | null;
}) {
  const gestion = useGestionStore((s) => s.byVin[vin]);
  const setG = useGestionStore((s) => s.setGestion);
  const clearG = useGestionStore((s) => s.clearGestion);
  const [expanded, setExpanded] = useState(variant === "panel");
  const [verHistorial, setVerHistorial] = useState(false);
  // Asignar / Notificar — mismo modal y cola que la FichaOperacionalVIN.
  // La tarea solo EMPUJA; el seguimiento sigue viviendo acá (store del caso).
  const [asignarOpen, setAsignarOpen] = useState(false);
  const documental = esClaveDocumental(vin);

  const estadoActual: EstadoGestion = gestion?.estadoGestion ?? "abierto";
  const tieneNota = !!(
    gestion?.comentario ||
    gestion?.responsable ||
    gestion?.fechaCompromiso ||
    gestion?.prioridadManual
  );
  const historial = gestion?.historial ?? [];

  const panel = (
    <div className="rounded-lg border border-[--color-border] bg-[--color-bg-elev-1] p-3 space-y-2.5">
      {gestion && (
        <div className="flex items-center gap-2">
          <span className="text-[9.5px] uppercase tracking-wide text-[--color-fg-dim]">
            Seguimiento
          </span>
          <SeguimientoBadge vin={vin} size="sm" />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[9.5px] uppercase tracking-wide text-[--color-fg-dim] block mb-0.5">
            Estado
          </label>
          <select
            value={estadoActual}
            onChange={(e) => setG(vin, { estadoGestion: e.target.value as EstadoGestion })}
            className={inputCls}
          >
            {ESTADOS_GESTION_ORDEN.map((s) => (
              <option key={s} value={s}>
                {ESTADO_GESTION_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[9.5px] uppercase tracking-wide text-[--color-fg-dim] block mb-0.5">
            Prioridad manual
          </label>
          <select
            value={gestion?.prioridadManual ?? "auto"}
            onChange={(e) => {
              const v = e.target.value;
              setG(vin, { prioridadManual: v === "auto" ? null : (v as PrioridadManual) });
            }}
            className={inputCls}
          >
            {PRIORIDAD_OPCIONES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[9.5px] uppercase tracking-wide text-[--color-fg-dim] block mb-0.5">
            Responsable
          </label>
          <input
            type="text"
            placeholder="Nombre"
            defaultValue={gestion?.responsable ?? ""}
            onBlur={(e) => setG(vin, { responsable: e.target.value || null })}
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-[9.5px] uppercase tracking-wide text-[--color-fg-dim] block mb-0.5">
            Fecha compromiso
          </label>
          <input
            type="date"
            defaultValue={gestion?.fechaCompromiso ?? ""}
            onChange={(e) => setG(vin, { fechaCompromiso: e.target.value || null })}
            className={inputCls}
          />
        </div>
      </div>

      {/* Email del responsable — preparado para notificación automática futura
          (hoy NO se envían correos). Misma capa única en todos los módulos. */}
      <div>
        <label className="text-[9.5px] uppercase tracking-wide text-[--color-fg-dim] block mb-0.5">
          Email responsable (notificación futura · opcional)
        </label>
        <input
          type="email"
          placeholder="correo@pompeyo.cl"
          defaultValue={gestion?.responsableEmail ?? ""}
          onBlur={(e) => setG(vin, { responsableEmail: e.target.value.trim() || null })}
          className={inputCls}
        />
      </div>

      <div>
        <label className="text-[9.5px] uppercase tracking-wide text-[--color-fg-dim] block mb-0.5">
          Comentario
        </label>
        <textarea
          placeholder="Qué pasa con este VIN · próximo paso"
          defaultValue={gestion?.comentario ?? ""}
          onBlur={(e) => setG(vin, { comentario: e.target.value || null })}
          rows={2}
          className={cn(inputCls, "resize-none")}
        />
      </div>

      {historial.length > 0 && (
        <div className="border-t border-[--color-border-soft] pt-2">
          <button
            onClick={() => setVerHistorial((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[10.5px] text-[--color-fg-muted] hover:text-[--color-fg] transition"
          >
            <History className="size-3" />
            Historial ({historial.length}) {verHistorial ? "▾" : "▸"}
          </button>
          {verHistorial && (
            <ul className="mt-1.5 space-y-1 max-h-[140px] overflow-y-auto">
              {[...historial].reverse().map((h, i) => (
                <li key={i} className="text-[10.5px] text-[--color-fg-muted] leading-snug">
                  <span className="text-[--color-fg-dim]">{fmtFechaCorta(h.fecha)}</span> ·{" "}
                  <span className="text-[--color-fg]">{h.campo}</span>:{" "}
                  <span className="text-[--color-fg-dim]">{h.valorAnterior}</span> →{" "}
                  <span className="text-[--color-fg]">{h.valorNuevo}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => setAsignarOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10.5px] font-semibold bg-[color:var(--color-accent)] text-white hover:opacity-90 transition"
        >
          <Send className="size-3" strokeWidth={2} />
          Asignar / Notificar
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-[10px] text-[--color-fg-dim] truncate">
            {gestion?.ultimaActualizacion
              ? `Actualizado ${fmtFechaCorta(gestion.ultimaActualizacion)}`
              : "Sin guardar"}
          </div>
          {gestion && (
            <button
              onClick={() => {
                clearG(vin);
                if (variant === "trigger") setExpanded(false);
              }}
              className="text-[10.5px] text-[--color-danger] hover:underline shrink-0"
            >
              Limpiar
            </button>
          )}
        </div>
      </div>

      {asignarOpen && (
        <AsignarTareaModal
          claveCaso={vin}
          tipoCaso={documental ? "documental" : "vin"}
          vin={documental ? null : vin}
          descripcionCaso={descripcionCaso ?? null}
          motivoSugerido={gestion?.comentario ?? null}
          onClose={() => setAsignarOpen(false)}
        />
      )}
    </div>
  );

  if (variant === "panel") return panel;

  return (
    <div className="space-y-1">
      <button
        onClick={() => setExpanded((e) => !e)}
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md transition border",
          tieneNota
            ? "border-[--color-accent]/30 bg-[--color-accent]/5 text-[--color-fg] hover:bg-[--color-accent]/10"
            : "border-[--color-border] bg-[--color-bg-elev-2] text-[--color-fg-muted] hover:text-[--color-fg]",
        )}
      >
        {tieneNota ? (
          <>
            <SeguimientoBadge vin={vin} />
            {gestion?.responsable && (
              <span className="text-[--color-fg-dim] truncate max-w-[100px]">
                {gestion.responsable}
              </span>
            )}
          </>
        ) : (
          <>
            <MessageSquarePlus className="size-3" />
            Gestionar
          </>
        )}
      </button>
      {expanded && panel}
    </div>
  );
}
