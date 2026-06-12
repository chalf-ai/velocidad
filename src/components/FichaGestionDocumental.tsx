"use client";

/**
 * FICHA DE GESTIÓN GRANDE para casos DOCUMENTALES (sin VIN físico):
 * provisiones (PROV-…), y reutilizable para saldos/bonos si se decide.
 *
 * Es la MISMA experiencia de gestión estándar del sistema (decisión usuario
 * 2026-06): reutiliza `MesaGestionCaso` (estado, responsable, prioridad,
 * compromiso, contexto, próxima acción, historial — persistencia en
 * GestionVIN vía useGestionStore) y `AsignarTareaModal` (Asignar/Notificar →
 * TareaOperacional + AlertaLog). No duplica lógica: solo agrega el encabezado
 * de contexto del documento, que reemplaza al bloque de score/capas que un
 * caso sin VIN no tiene.
 */

import { useState } from "react";
import { FileText, Send } from "lucide-react";
import { MesaGestionCaso } from "@/components/MesaGestionCaso";
import { AsignarTareaModal } from "@/components/AsignarTareaModal";

export interface DatoDocumental {
  label: string;
  valor: string;
}

export function FichaGestionDocumental({
  clave,
  titulo,
  subtitulo,
  datos,
  descripcionCaso,
}: {
  /** Clave de gestión documental (PROV-…, SALDO-…, BONO-…). */
  clave: string;
  /** Título humano del caso (ej. concepto de la provisión). */
  titulo: string;
  subtitulo?: string | null;
  /** Pares contexto del documento (montos, aging, solicitante…). */
  datos: DatoDocumental[];
  /** Descripción para la tarea al Asignar / Notificar. */
  descripcionCaso?: string | null;
}) {
  const [asignarOpen, setAsignarOpen] = useState(false);

  return (
    <div className="rounded-xl border border-[--color-border] bg-white p-5 space-y-4 text-left">
      {/* ── Identidad del caso documental ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold">
            <FileText className="size-3.5" />
            Caso documental · <span className="mono normal-case">{clave}</span>
          </div>
          <div className="text-[15px] font-semibold text-[--color-fg] mt-1 leading-tight">
            {titulo}
          </div>
          {subtitulo && (
            <div className="text-[12px] text-[--color-fg-muted] mt-0.5">{subtitulo}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setAsignarOpen(true)}
          className="inline-flex items-center gap-1.5 shrink-0 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold bg-[color:var(--color-accent)] text-white hover:opacity-90 transition"
        >
          <Send className="size-3" strokeWidth={2} />
          Asignar / Notificar
        </button>
      </div>

      {/* ── Contexto del documento (reemplaza score/capas de un caso VIN) ── */}
      {datos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {datos.map((d) => (
            <div
              key={d.label}
              className="rounded-lg bg-[--color-bg-elev-1] px-3 py-2"
            >
              <div className="text-[10px] uppercase tracking-wide text-[--color-fg-dim] font-semibold">
                {d.label}
              </div>
              <div className="text-[12.5px] text-[--color-fg] mt-0.5 truncate" title={d.valor}>
                {d.valor}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Mesa de gestión estándar (la misma del resto del sistema) ── */}
      <div className="border-t border-[--color-border-soft] pt-4">
        <MesaGestionCaso vin={clave} />
      </div>

      {asignarOpen && (
        <AsignarTareaModal
          claveCaso={clave}
          tipoCaso="documental"
          vin={null}
          descripcionCaso={descripcionCaso ?? titulo}
          motivoSugerido={null}
          onClose={() => setAsignarOpen(false)}
        />
      )}
    </div>
  );
}
