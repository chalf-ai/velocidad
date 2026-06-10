"use client";

/**
 * Modal "Asignar / Notificar" — crea una TareaOperacional + notificación
 * pendiente (AlertaLog tipo TAREA_ASIGNADA).
 *
 * F1: NO envía nada real (ni WhatsApp ni email — ambos canales son
 * simulados). La notificación queda PENDIENTE en /notificaciones para
 * copia manual + marcar enviada. F2 la procesará César.
 *
 * La notificación solo LLEVA al caso: el asignado resuelve dejando
 * seguimiento en la FichaOperacionalVIN (gestión normal del auto),
 * nunca en la notificación ni en una bitácora paralela.
 *
 * El preview replica el render del server (misma función pura
 * renderMensajeTarea) con link construido desde window.location.origin.
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Send,
  X,
  AlertTriangle,
  CheckCircle2,
  Search,
  Mail,
  MessageCircle,
} from "lucide-react";
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
  telefono: string | null;
  tieneTelefono: boolean;
}

type Canal = "WHATSAPP" | "EMAIL";

export interface AsignarTareaModalProps {
  /** Clave única del caso: VIN o clave documental (SALDO-/BONO-/PROV-…). */
  claveCaso: string;
  tipoCaso: "vin" | "documental";
  /** VIN real — solo para tipoCaso "vin". */
  vin?: string | null;
  /** Descripción corta del caso documental (concepto/origen) para el mensaje. */
  descripcionCaso?: string | null;
  /** Cliente del caso — primera línea de identificación en el mensaje. */
  cliente?: string | null;
  patente?: string | null;
  marca?: string | null;
  modelo?: string | null;
  /** Motivo sugerido (ej. próxima acción del caso). Editable. */
  motivoSugerido?: string | null;
  onClose: () => void;
}

/** Búsqueda insensible a mayúsculas y tildes ("Pérez" matchea "perez"). */
function normalizar(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function BadgeWhatsApp({ tieneTelefono }: { tieneTelefono: boolean }) {
  return tieneTelefono ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[10px] font-semibold shrink-0">
      <MessageCircle className="size-2.5" /> WhatsApp
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] font-semibold shrink-0">
      sin teléfono
    </span>
  );
}

export function AsignarTareaModal({
  claveCaso,
  tipoCaso,
  vin,
  descripcionCaso,
  cliente,
  patente,
  marca,
  modelo,
  motivoSugerido,
  onClose,
}: AsignarTareaModalProps) {
  const [usuarios, setUsuarios] = useState<UsuarioAsignable[]>([]);
  const [cargandoUsuarios, setCargandoUsuarios] = useState(true);
  const [asignadoId, setAsignadoId] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [listaAbierta, setListaAbierta] = useState(false);
  const [canal, setCanal] = useState<Canal>("WHATSAPP");
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
      .catch(() => setUsuarios([]))
      .finally(() => setCargandoUsuarios(false));
  }, []);

  const asignado = usuarios.find((u) => u.id === asignadoId) ?? null;

  const usuariosFiltrados = useMemo(() => {
    const q = normalizar(busqueda.trim());
    if (!q) return usuarios;
    // Nombre (incluye apellido), email o teléfono.
    return usuarios.filter((u) =>
      [u.name, u.email, u.telefono].some((campo) => normalizar(campo).includes(q)),
    );
  }, [usuarios, busqueda]);

  function seleccionar(u: UsuarioAsignable) {
    setAsignadoId(u.id);
    setListaAbierta(false);
    setError(null);
  }

  // Canal Email exige email del asignado; sin email se bloquea la creación.
  // Canal WhatsApp sin teléfono solo advierte: la notificación queda
  // pendiente para copia manual (flujo F1 intacto).
  const canalInvalido = canal === "EMAIL" && !!asignado && !asignado.email;

  const preview = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const path = vin
      ? `/centro-accion?vin=${encodeURIComponent(vin)}`
      : `/centro-accion?clave=${encodeURIComponent(claveCaso)}`;
    return renderMensajeTarea({
      nombreAsignado: primerNombre(asignado?.name ?? "—"),
      claveCaso,
      descripcionCaso: descripcionCaso ?? null,
      cliente: cliente ?? null,
      vin: vin ?? null,
      patente: patente ?? null,
      marca: marca ?? null,
      modelo: modelo ?? null,
      motivo: motivo.trim() || null,
      mensaje,
      nombreCreador: "Tú",
      fechaCompromiso: fechaCompromiso ? new Date(`${fechaCompromiso}T12:00:00`) : null,
      link: `${origin}${path}`,
    });
  }, [asignado, claveCaso, descripcionCaso, vin, cliente, patente, marca, modelo, motivo, mensaje, fechaCompromiso]);

  async function crear() {
    if (!asignadoId || !mensaje.trim()) {
      setError("Seleccioná un usuario y escribí un mensaje.");
      return;
    }
    if (canalInvalido) {
      setError("El usuario no tiene email registrado — elegí WhatsApp simulado u otro usuario.");
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
          claveCaso,
          tipoCaso,
          mensaje,
          motivo: motivo.trim() || null,
          cliente: cliente ?? null,
          descripcionCaso: descripcionCaso ?? null,
          vin: vin ?? null,
          patente: patente ?? null,
          marca: marca ?? null,
          modelo: modelo ?? null,
          asignadoId,
          canal,
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
              <span className="mono text-[12px]">{vin ?? claveCaso}</span>
              {tipoCaso === "vin" && (marca || modelo) && (
                <span className="text-[--color-fg-muted]">
                  {" "}· {[marca, modelo].filter(Boolean).join(" ")}
                </span>
              )}
              {tipoCaso === "documental" && descripcionCaso && (
                <span className="text-[--color-fg-muted]"> · {descripcionCaso}</span>
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
            <p className="text-[12px] text-[--color-fg-muted]">
              El asignado resuelve abriendo el caso y dejando seguimiento en la
              ficha del auto.
            </p>
            {canal === "WHATSAPP" && asignado && !asignado.telefono && (
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
            {/* Asignar a · buscador con lista */}
            <div>
              <label className="text-[11px] uppercase tracking-[0.08em] text-[--color-fg-dim] font-semibold">
                Asignar a
              </label>
              {asignado ? (
                <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-[--color-border] bg-[--color-bg-elev-2] px-2.5 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-[--color-fg] truncate">
                        {asignado.name}
                      </span>
                      <BadgeWhatsApp tieneTelefono={!!asignado.telefono} />
                    </div>
                    <div className="text-[11.5px] text-[--color-fg-muted] truncate">
                      {asignado.email}
                      {asignado.telefono && (
                        <span className="mono"> · {asignado.telefono}</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAsignadoId("");
                      setBusqueda("");
                      setListaAbierta(true);
                    }}
                    className="shrink-0 rounded-md border border-[--color-border] px-2 py-1 text-[11px] text-[--color-fg-muted] hover:bg-white"
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <div className="relative mt-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[--color-fg-dim] pointer-events-none" />
                  <input
                    type="text"
                    value={busqueda}
                    onChange={(e) => {
                      setBusqueda(e.target.value);
                      setListaAbierta(true);
                    }}
                    onFocus={() => setListaAbierta(true)}
                    onBlur={() => setTimeout(() => setListaAbierta(false), 120)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && usuariosFiltrados.length > 0) {
                        e.preventDefault();
                        seleccionar(usuariosFiltrados[0]);
                      }
                      if (e.key === "Escape") setListaAbierta(false);
                    }}
                    placeholder="Buscar por nombre, email o teléfono…"
                    className="w-full h-9 text-[13px] pl-8 pr-2.5 rounded-lg bg-white border border-[--color-border] focus:border-[--color-accent] outline-none placeholder:text-[--color-fg-dim]"
                  />
                  {listaAbierta && (
                    <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-[--color-border] bg-white shadow-lg">
                      {cargandoUsuarios ? (
                        <div className="px-3 py-2.5 text-[12px] text-[--color-fg-muted]">
                          Cargando usuarios…
                        </div>
                      ) : usuariosFiltrados.length === 0 ? (
                        <div className="px-3 py-2.5 text-[12px] text-[--color-fg-muted]">
                          Sin coincidencias para “{busqueda}”.
                        </div>
                      ) : (
                        usuariosFiltrados.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            // onMouseDown: dispara antes del blur del input.
                            onMouseDown={(e) => {
                              e.preventDefault();
                              seleccionar(u);
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-[--color-bg-elev-2] border-b border-[--color-border-soft] last:border-0"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-[--color-fg] truncate">
                                {u.name}
                              </span>
                              <BadgeWhatsApp tieneTelefono={!!u.telefono} />
                            </div>
                            <div className="text-[11.5px] text-[--color-fg-muted] truncate">
                              {u.email}
                              {u.telefono && <span className="mono"> · {u.telefono}</span>}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Canal de notificación */}
            <div>
              <label className="text-[11px] uppercase tracking-[0.08em] text-[--color-fg-dim] font-semibold">
                Canal
              </label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {(
                  [
                    ["WHATSAPP", "WhatsApp simulado", MessageCircle],
                    ["EMAIL", "Email simulado", Mail],
                  ] as [Canal, string, typeof Mail][]
                ).map(([key, label, Icono]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setCanal(key)}
                    className={cn(
                      "inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-[12px] font-medium transition",
                      canal === key
                        ? "border-[color:var(--color-accent)] bg-[--color-bg-elev-2] text-[color:var(--color-accent)] font-semibold"
                        : "border-[--color-border] bg-white text-[--color-fg-muted] hover:bg-[--color-bg-elev-2]",
                    )}
                  >
                    <Icono className="size-3.5" />
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-[--color-fg-dim]">
                F1: no se envía nada real — la notificación queda pendiente en
                /notificaciones.
              </p>
              {canal === "WHATSAPP" && asignado && !asignado.telefono && (
                <div className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-900 flex items-start gap-1.5">
                  <AlertTriangle className="size-3.5 shrink-0 mt-px" />
                  Este usuario no tiene teléfono WhatsApp registrado. La
                  notificación quedará pendiente para copia manual.
                </div>
              )}
              {canalInvalido && (
                <div className="mt-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11.5px] text-red-800 flex items-start gap-1.5">
                  <AlertTriangle className="size-3.5 shrink-0 mt-px" />
                  Este usuario no tiene email registrado. Elegí WhatsApp
                  simulado u otro usuario — sin canal válido no se crea la
                  tarea.
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
                disabled={enviando || !asignadoId || !mensaje.trim() || canalInvalido}
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
