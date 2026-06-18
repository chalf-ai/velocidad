"use client";

/**
 * /notificaciones — cola de notificaciones operativas (AlertaLog).
 *
 * F1: panel de gestión MANUAL. Las notificaciones de tareas
 * (TAREA_ASIGNADA) quedan pendientes acá; el operador copia el mensaje
 * (→ WhatsApp Web a mano) y la marca como enviada. De regalo, el panel
 * da visibilidad web sobre TODO lo que César ya envía (briefings,
 * compromisos vencidos, etc.) que antes solo vivía en WhatsApp.
 *
 * F2: César procesará las pendientes automáticamente — este panel pasa
 * a ser monitor de la cola, sin cambios de UI.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Check,
  CheckCheck,
  Copy,
  ExternalLink,
  Mail,
  MessageCircle,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/cn";

interface AlertaRow {
  id: string;
  tipo: string;
  vin: string | null;
  mensaje: string;
  enviado: boolean;
  errorMsg: string | null;
  waMsgId: string | null;
  /** "WHATSAPP" | "EMAIL" · null = pendiente de canal (registros previos). */
  canal: string | null;
  /** Estado real de entrega Meta: sending|accepted|sent|delivered|read|failed.
   *  null = registros previos a la integración real. `enviado=true` solo = aceptado. */
  waStatus: string | null;
  waStatusAt: string | null;
  waErrorCode: number | null;
  waErrorTitle: string | null;
  createdAt: string;
  user: { name: string | null; email: string; telefono: string | null };
  tarea: {
    id: string;
    claveCaso: string;
    vin: string | null;
    marca: string | null;
    modelo: string | null;
    motivo: string | null;
    estado: string;
    fechaCompromiso: string | null;
    creador: { name: string | null };
  } | null;
}

/**
 * Estado de entrega real para el badge. Prioriza waStatus (Meta Cloud API);
 * cae al comportamiento legacy (enviado/errorMsg) para registros previos a la
 * integración real. Clave: NUNCA mostrar "Enviada/Entregada" por solo `enviado=true`
 * cuando waStatus dice otra cosa — un mensaje "aceptado" no es "entregado".
 */
function estadoEntrega(a: AlertaRow): {
  label: string;
  cls: string;
  icono: "ok" | "fail" | null;
} {
  switch (a.waStatus) {
    case "read":
      return { label: "Leído", cls: "bg-emerald-100 text-emerald-800", icono: "ok" };
    case "delivered":
      return { label: "Entregado", cls: "bg-emerald-100 text-emerald-800", icono: "ok" };
    case "sent":
      return { label: "Enviado", cls: "bg-sky-100 text-sky-800", icono: null };
    case "accepted":
      return { label: "Aceptado por Meta", cls: "bg-slate-100 text-slate-600", icono: null };
    case "sending":
      return { label: "Enviando…", cls: "bg-amber-100 text-amber-800", icono: null };
    case "failed":
      return {
        label: a.waErrorTitle ? `Fallido · ${a.waErrorTitle}` : "Fallido",
        cls: "bg-red-100 text-red-800",
        icono: "fail",
      };
  }
  // Legacy (sin waStatus): comportamiento anterior.
  if (a.errorMsg) return { label: "Error", cls: "bg-red-100 text-red-800", icono: "fail" };
  if (a.enviado) return { label: "Enviada", cls: "bg-emerald-100 text-emerald-800", icono: "ok" };
  return { label: "Pendiente", cls: "bg-amber-100 text-amber-800", icono: null };
}

const TIPO_LABEL: Record<string, string> = {
  TAREA_ASIGNADA: "Tarea asignada",
  BRIEFING_DIARIO: "Briefing diario",
  FECHA_COMPROMISO_VENCIDA: "Compromiso vencido",
  CASO_SIN_MOVIMIENTO: "Caso sin movimiento",
  PRIORIDAD_CRITICA: "Prioridad crítica",
  MENSAJE_ENTRANTE: "Mensaje entrante",
};

type Filtro = "pendientes" | "enviadas" | "asignadas_mi" | "creadas_mi" | "todas";

/** Query string por filtro — la asignación interna siempre es visible acá. */
const FILTRO_QS: Record<Filtro, string> = {
  pendientes: "?enviado=false",
  enviadas: "?enviado=true",
  asignadas_mi: "?mias=asignadas",
  creadas_mi: "?mias=creadas",
  todas: "",
};

export default function NotificacionesPage() {
  const [alertas, setAlertas] = useState<AlertaRow[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("pendientes");
  const [cargando, setCargando] = useState(true);
  const [copiadaId, setCopiadaId] = useState<string | null>(null);
  const [marcandoId, setMarcandoId] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/notificaciones${FILTRO_QS[filtro]}`, { credentials: "include" });
      setAlertas(res.ok ? await res.json() : []);
    } catch {
      setAlertas([]);
    } finally {
      setCargando(false);
    }
  }, [filtro]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function copiar(a: AlertaRow) {
    try {
      await navigator.clipboard.writeText(a.mensaje);
      setCopiadaId(a.id);
      setTimeout(() => setCopiadaId(null), 2000);
    } catch {
      // clipboard denegado · sin acción
    }
  }

  async function marcarEnviada(a: AlertaRow) {
    setMarcandoId(a.id);
    try {
      const res = await fetch(`/api/notificaciones/${a.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enviado: true }),
      });
      if (res.ok) await cargar();
    } finally {
      setMarcandoId(null);
    }
  }

  const pendientesCount = alertas.filter((a) => !a.enviado).length;

  return (
    <div className="max-w-[1000px] mx-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-5 fade-in">
      {/* Hero */}
      <section className="surface bg-white top-strip strip-info p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-[--color-info] font-semibold">
              <Bell className="size-3.5" strokeWidth={2} />
              Operación
            </div>
            <h1 className="text-[24px] font-semibold tracking-tight mt-1.5 leading-tight text-[--color-fg]">
              Notificaciones operativas
            </h1>
            <p className="text-[13px] text-[--color-fg-muted] mt-1.5 max-w-2xl leading-snug">
              Cola de notificaciones (WhatsApp / email simulados). Las
              pendientes se copian manualmente y se marcan como enviadas — el
              envío automático por César llega en la fase siguiente. La
              notificación solo lleva al caso: el seguimiento se deja en la
              ficha del auto.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void cargar()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[--color-border] px-3 py-2 text-[12px] text-[--color-fg-muted] hover:bg-[--color-bg-elev-2]"
          >
            <RefreshCw className={cn("size-3.5", cargando && "animate-spin")} />
            Actualizar
          </button>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          {(
            [
              ["pendientes", "Pendientes"],
              ["enviadas", "Enviadas"],
              ["asignadas_mi", "Asignadas a mí"],
              ["creadas_mi", "Creadas por mí"],
              ["todas", "Todas"],
            ] as [Filtro, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFiltro(key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[12px] font-medium transition border",
                filtro === key
                  ? "bg-[color:var(--color-accent)] text-white border-transparent"
                  : "bg-white text-[--color-fg-muted] border-[--color-border] hover:bg-[--color-bg-elev-2]",
              )}
            >
              {label}
              {key === "pendientes" && filtro === "pendientes" && pendientesCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-4 h-4 px-1 text-[10px] rounded-full bg-white/25 mono">
                  {pendientesCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Lista */}
      {cargando && alertas.length === 0 ? (
        <div className="surface bg-white p-8 text-center text-[13px] text-[--color-fg-muted]">
          Cargando notificaciones…
        </div>
      ) : alertas.length === 0 ? (
        <div className="surface bg-white p-8 text-center">
          <MessageCircle className="size-8 text-[--color-fg-dim] mx-auto mb-2" strokeWidth={1.5} />
          <div className="text-[13px] text-[--color-fg-muted]">
            {filtro === "pendientes"
              ? "Sin notificaciones pendientes. Creá una tarea desde la ficha de un VIN (botón Asignar / Notificar)."
              : "Sin notificaciones en este filtro."}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {alertas.map((a) => {
            const esTarea = a.tipo === "TAREA_ASIGNADA";
            // VIN → deep-link por vin. Documental → deep-link por clave
            // (SALDO-/BONO-/PROV-), procesado por /centro-accion.
            const linkCaso = a.vin
              ? `/centro-accion?vin=${encodeURIComponent(a.vin)}`
              : a.tarea?.claveCaso
                ? `/centro-accion?clave=${encodeURIComponent(a.tarea.claveCaso)}`
                : null;
            return (
              <div key={a.id} className="surface bg-white p-4">
                {/* Header fila */}
                <div className="flex items-center gap-2 flex-wrap text-[11.5px]">
                  {(() => {
                    const est = estadoEntrega(a);
                    return (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide text-[10px]",
                          est.cls,
                        )}
                      >
                        {est.icono === "ok" ? (
                          <CheckCheck className="size-3" />
                        ) : est.icono === "fail" ? (
                          <TriangleAlert className="size-3" />
                        ) : null}
                        {est.label}
                      </span>
                    );
                  })()}
                  <span className="text-[--color-fg-muted] font-medium">
                    {TIPO_LABEL[a.tipo] ?? a.tipo}
                  </span>
                  <span className="text-[--color-fg-dim]">·</span>
                  <span className="text-[--color-fg]">
                    Para: <span className="font-semibold">{a.user.name ?? a.user.email}</span>
                    {a.user.telefono ? (
                      <span className="text-[--color-fg-muted] mono text-[11px]"> {a.user.telefono}</span>
                    ) : (
                      <span className="text-amber-700"> · sin WhatsApp registrado</span>
                    )}
                  </span>
                  {/* Canal externo (opcional — la asignación interna ya está hecha). */}
                  {esTarea && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        a.canal
                          ? "bg-[--color-bg-elev-2] text-[--color-fg-muted]"
                          : "bg-slate-100 text-slate-500",
                      )}
                    >
                      {a.canal === "WHATSAPP" ? (
                        <>
                          <MessageCircle className="size-3" /> WhatsApp simulado
                        </>
                      ) : a.canal === "EMAIL" ? (
                        <>
                          <Mail className="size-3" /> Email simulado
                        </>
                      ) : (
                        "Pendiente de canal"
                      )}
                    </span>
                  )}
                  <span className="ml-auto text-[--color-fg-dim]">
                    {new Date(a.createdAt).toLocaleString("es-CL", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                {a.tarea?.creador?.name && (
                  <div className="text-[11px] text-[--color-fg-dim] mt-1">
                    Solicitado por {a.tarea.creador.name}
                    {a.tarea.fechaCompromiso &&
                      ` · compromiso ${new Date(a.tarea.fechaCompromiso).toLocaleDateString("es-CL")}`}
                  </div>
                )}

                {/* Burbuja mensaje */}
                <pre className="mt-2.5 rounded-xl rounded-tl-sm border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[12.5px] text-emerald-950 whitespace-pre-wrap font-sans leading-relaxed">
                  {a.mensaje}
                </pre>

                {a.errorMsg && (
                  <div className="mt-2 text-[11.5px] text-red-700">Error: {a.errorMsg}</div>
                )}

                {/* Resolución: la notificación solo lleva al caso */}
                {esTarea && linkCaso && (
                  <div className="mt-2.5 text-[11.5px] text-[--color-fg-muted]">
                    Para resolver, abre el caso y deja seguimiento en la ficha
                    del auto.
                  </div>
                )}

                {/* Acciones — Abrir caso es la acción principal */}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {linkCaso && (
                    <a
                      href={linkCaso}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold bg-[color:var(--color-accent)] text-white hover:opacity-90"
                    >
                      <ExternalLink className="size-3.5" /> Abrir caso
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => void copiar(a)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[--color-border] px-3 py-1.5 text-[12px] font-medium text-[--color-fg] hover:bg-[--color-bg-elev-2]"
                  >
                    {copiadaId === a.id ? (
                      <>
                        <Check className="size-3.5 text-[--color-ok]" /> Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5" /> Copiar mensaje
                      </>
                    )}
                  </button>
                  {!a.enviado && esTarea && (
                    <button
                      type="button"
                      onClick={() => void marcarEnviada(a)}
                      disabled={marcandoId === a.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[--color-border] px-3 py-1.5 text-[12px] font-medium text-[--color-fg] hover:bg-[--color-bg-elev-2] disabled:opacity-50"
                    >
                      <CheckCheck className="size-3.5" />
                      {marcandoId === a.id ? "Marcando…" : "Marcar enviada"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
