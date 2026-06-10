"use client";

/**
 * Modal "Asignar / Notificar" — crea una TareaOperacional + notificación
 * WhatsApp pendiente (AlertaLog tipo TAREA_ASIGNADA).
 *
 * F1: NO envía WhatsApp real. La notificación queda PENDIENTE en
 * /notificaciones para copia manual + marcar enviada. F2 la procesará César.
 *
 * El preview replica el render del server (misma función pura
 * renderMensajeTarea) con link construido desde window.location.origin.
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Send, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  primerNombre,
  renderMensajeTarea,
} from "@/lib/notificaciones/render";

interface UsuarioAsignable {
  id: string;
  name: string;
  email: string;
  rol: string;
  tieneTelefono: boolean;
}

export interface AsignarTareaModalProps {
  vin: string;
  patente?: string | null;
  marca?: string | null;
  modelo?: string | null;
  /** Motivo sugerido (ej. próxima acción del caso). Editable. */
  motivoSugerido?: string | null;
  onClose: () => void;
}

export function AsignarTareaModal({
  vin,
  patente,
  marca,
  modelo,
  motivoSugerido,
  onClose,
}: AsignarTareaModalProps) {
  const [usuarios, setUsuarios] = useState<UsuarioAsignable[]>([]);
  const [asignadoId, setAsignadoId] = useState("");
  const [motivo, setMotivo] = useState(motivoSugerido ?? "");
  const [mensaje, setMensaje] = useState("");
  const [fechaCompromiso, setFechaCompromiso] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [creada, setCreada] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/usuarios-asignables", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then(setUsuarios)
      .catch(() => setUsuarios([]));
  }, []);

  const asignado = usuarios.find((u) => u.id === asignadoId) ?? null;

  const preview = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return renderMensajeTarea({
      nombreAsignado: primerNombre(asignado?.name ?? "—"),
      vin,
      patente: patente ?? null,
      marca: marca ?? null,
      modelo: modelo ?? null,
      motivo: motivo.trim() || null,
      mensaje,
      nombreCreador: "Tú",
      fechaCompromiso: fechaCompromiso ? new Date(`${fechaCompromiso}T12:00:00`) : null,
      link: `${origin}/centro-accion?vin=${encodeURIComponent(vin)}`,
    });
  }, [asignado, vin, patente, marca, modelo, motivo, mensaje, fechaCompromiso]);

  async function crear() {
    if (!asignadoId || !mensaje.trim()) {
      setError("Seleccioná un usuario y escribí un mensaje.");
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch("/api/tareas", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claveCaso: vin,
          tipoCaso: "vin",
          mensaje,
          motivo: motivo.trim() || null,
          vin,
          patente: patente ?? null,
          marca: marca ?? null,
          modelo: modelo ?? null,
          asignadoId,
          fechaCompromiso: fechaCompromiso || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Error ${res.status}`);
      }
      setCreada(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al crear la tarea");
    } finally {
      setEnviando(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] grid place-items-center bg-[#101828]/40 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-[--color-border] bg-white shadow-xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-[--color-border-soft]">
          <div className="min-w-0">
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-accent] font-semibold flex items-center gap-1.5">
              <Send className="size-3.5" />
              Asignar / Notificar
            </div>
            <div className="text-[13px] text-[--color-fg] mt-1 truncate">
              <span className="mono text-[12px]">{vin}</span>
              {(marca || modelo) && (
                <span className="text-[--color-fg-muted]">
                  {" "}· {[marca, modelo].filter(Boolean).join(" ")}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-7 place-items-center rounded-md text-[--color-fg-muted] hover:bg-[--color-bg-elev-2]"
            aria-label="Cerrar"
          >
            <X className="size-4" />
          </button>
        </div>

        {creada ? (
          /* ── Estado éxito ── */
          <div className="px-5 py-6 text-center space-y-3">
            <CheckCircle2 className="size-10 text-[--color-ok] mx-auto" strokeWidth={1.5} />
            <div className="text-[14px] font-semibold text-[--color-fg]">
              Tarea creada y notificación en cola
            </div>
            {asignado && !asignado.tieneTelefono && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 text-left">
                <AlertTriangle className="size-3.5 inline mr-1 -mt-0.5" />
                Este usuario no tiene teléfono WhatsApp registrado. La
                notificación quedará pendiente para copia manual.
              </div>
            )}
            <div className="flex items-center justify-center gap-2 pt-1">
              <a
                href="/notificaciones"
                className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold bg-[color:var(--color-accent)] text-white hover:opacity-90"
              >
                Ver notificaciones
              </a>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[--color-border] px-3.5 py-2 text-[12.5px] text-[--color-fg-muted] hover:bg-[--color-bg-elev-2]"
              >
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          /* ── Formulario ── */
          <div className="px-5 py-4 space-y-3.5">
            <div>
              <label className="text-[11px] uppercase tracking-[0.08em] text-[--color-fg-dim] font-semibold">
                Asignar a
              </label>
              <select
                value={asignadoId}
                onChange={(e) => setAsignadoId(e.target.value)}
                className="mt-1 w-full h-9 text-[13px] px-2.5 rounded-lg bg-white border border-[--color-border] focus:border-[--color-accent] outline-none"
              >
                <option value="">Seleccionar usuario…</option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.rol}){u.tieneTelefono ? "" : " · sin WhatsApp"}
                  </option>
                ))}
              </select>
              {asignado && !asignado.tieneTelefono && (
                <div className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-900 flex items-start gap-1.5">
                  <AlertTriangle className="size-3.5 shrink-0 mt-px" />
                  Este usuario no tiene teléfono WhatsApp registrado. La
                  notificación quedará pendiente para copia manual.
                </div>
              )}
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-[0.08em] text-[--color-fg-dim] font-semibold">
                Motivo
              </label>
              <input
                type="text"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej: Auto pagado pendiente de gestión"
                className="mt-1 w-full h-9 text-[13px] px-2.5 rounded-lg bg-white border border-[--color-border] focus:border-[--color-accent] outline-none placeholder:text-[--color-fg-dim]"
              />
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-[0.08em] text-[--color-fg-dim] font-semibold">
                Mensaje
              </label>
              <textarea
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
                rows={2}
                placeholder="Por favor revisa este caso"
                className="mt-1 w-full text-[13px] px-2.5 py-2 rounded-lg bg-white border border-[--color-border] focus:border-[--color-accent] outline-none placeholder:text-[--color-fg-dim] resize-y"
              />
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-[0.08em] text-[--color-fg-dim] font-semibold">
                Fecha compromiso <span className="font-normal normal-case">(opcional)</span>
              </label>
              <input
                type="date"
                value={fechaCompromiso}
                onChange={(e) => setFechaCompromiso(e.target.value)}
                className="mt-1 w-full h-9 text-[13px] px-2.5 rounded-lg bg-white border border-[--color-border] focus:border-[--color-accent] outline-none"
              />
            </div>

            {/* Preview burbuja WhatsApp */}
            <div>
              <div className="text-[11px] uppercase tracking-[0.08em] text-[--color-fg-dim] font-semibold mb-1">
                Vista previa
              </div>
              <pre className="rounded-xl rounded-tl-sm border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12px] text-emerald-950 whitespace-pre-wrap font-sans leading-relaxed">
                {preview}
              </pre>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[--color-border] px-3.5 py-2 text-[12.5px] text-[--color-fg-muted] hover:bg-[--color-bg-elev-2]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={crear}
                disabled={enviando || !asignadoId || !mensaje.trim()}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold transition",
                  "bg-[color:var(--color-accent)] text-white hover:opacity-90",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                <Send className="size-3.5" />
                {enviando ? "Creando…" : "Crear tarea"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
