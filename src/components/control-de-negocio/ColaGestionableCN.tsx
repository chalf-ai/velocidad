"use client";

/**
 * Cola gestionable de Control de Negocio.
 *
 * Reutiliza:
 *  · `AbrirCasoButton` + `useCasoModal` + `FichaOperacionalVIN` (regla R1)
 *  · `useGestionStore` (vía AbrirCasoButton)
 *
 * Brief §11 — columnas obligatorias:
 *   VIN · Marca · Modelo · Sucursal · Vendedor · Fecha factura ·
 *   Días desde factura · Último hito · Hito faltante · Responsable
 *   operacional · Monto retenido · Gestión (badge + Abrir caso)
 */

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fmtNum, fmtCLPCompact, fmtDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { AbrirCasoButton } from "@/components/AbrirCasoButton";
import { limpiarVIN } from "@/lib/parser/venta-apc";
import type { EntradaConsolidada } from "@/lib/historico/cruce-roma-actas";
import {
  ORDEN_HITOS,
  LABEL_HITO_FALTANTE,
  RESPONSABLE_POR_HITO_FALTANTE,
  LABEL_AREA,
  type HitoFaltante,
} from "@/lib/control-de-negocio/cn-responsables";

const PAGE_SIZE = 50;
const MS_DIA = 86_400_000;

function diasDesde(d: Date | null | undefined, hoy: Date): number | null {
  if (!(d instanceof Date)) return null;
  return Math.max(0, Math.floor((hoy.getTime() - d.getTime()) / MS_DIA));
}

// Detectores reutilizados (paralelos a cn-fne-atribuible.ts).
const TIENE: Record<HitoFaltante, (f: EntradaConsolidada) => boolean> = {
  solicitud_inscripcion: (f) => f.fSolicitudInscripcion !== null,
  inscripcion:           (f) => f.fInscripcion !== null,
  patente_recibida:      (f) => f.fPatenteRecibida !== null,
  patente_entregada:     (f) => f.fPatenteEntregada !== null,
  solicitud_entrega:     (f) => (f.solEntrega ?? "").trim() === "Si",
  autorizacion_entrega:  (f) => (f.autorizacionEntrega ?? "").trim() === "Si",
  entrega_real:          (f) => f.entregado,
};

function ultimoHitoCompletado(f: EntradaConsolidada): string {
  let ultimo: { label: string; fecha: Date } | null = null;
  const candidatas: { label: string; fecha: Date | null }[] = [
    { label: "Factura", fecha: f.fFactura },
    { label: "Sol. Inscripción", fecha: f.fSolicitudInscripcion },
    { label: "Inscripción", fecha: f.fInscripcion },
    { label: "Patente Recibida", fecha: f.fPatenteRecibida },
    { label: "Patente Entregada", fecha: f.fPatenteEntregada },
    { label: "Entrega Real", fecha: f.fEntregaReal },
  ];
  for (const c of candidatas) {
    if (c.fecha instanceof Date && (!ultimo || c.fecha.getTime() > ultimo.fecha.getTime())) {
      ultimo = { label: c.label, fecha: c.fecha };
    }
  }
  return ultimo?.label ?? "—";
}

function primerHitoFaltante(f: EntradaConsolidada): HitoFaltante | null {
  for (const h of ORDEN_HITOS) {
    if (!TIENE[h](f)) return h;
  }
  return null;
}

export function ColaGestionableCN({
  titulo,
  subtitulo,
  filas,
  origen,
  hoy = new Date(),
}: {
  titulo: string;
  subtitulo?: string;
  filas: EntradaConsolidada[];
  origen: string;
  hoy?: Date;
}) {
  const [page, setPage] = useState(0);
  const totalMonto = useMemo(
    () => filas.reduce((s, f) => s + (f.valorFactura ?? 0), 0),
    [filas],
  );
  const slice = useMemo(
    () => filas.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filas, page],
  );
  const totalPages = Math.max(1, Math.ceil(filas.length / PAGE_SIZE));

  if (filas.length === 0) {
    return (
      <div className="surface bg-white px-5 py-6 text-center text-[12.5px] text-[--color-fg-muted]">
        Sin casos para este foco.
      </div>
    );
  }

  return (
    <div className="surface bg-white">
      <div className="px-5 py-4 border-b border-[--color-border] flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[14px] font-semibold tracking-tight text-[--color-fg]">
            {titulo}
          </div>
          {subtitulo && (
            <div className="text-[11.5px] text-[--color-fg-muted] mt-0.5">{subtitulo}</div>
          )}
        </div>
        <div className="text-[12px] text-[--color-fg-muted]">
          <span className="text-[--color-fg] font-semibold">{fmtNum(filas.length)}</span> casos
          {" · "}
          <span className="text-[--color-danger] font-semibold">{fmtCLPCompact(totalMonto)}</span>{" "}
          retenido
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-[0.05em] text-[--color-fg-muted] bg-[--color-bg-elev-1]">
              <th className="px-3 py-2">VIN · Marca · Modelo</th>
              <th className="px-3 py-2">Sucursal · Vendedor</th>
              <th className="px-3 py-2 text-right">F. Factura</th>
              <th className="px-3 py-2 text-right">Días</th>
              <th className="px-3 py-2">Último hito</th>
              <th className="px-3 py-2">Hito faltante</th>
              <th className="px-3 py-2">Responsable</th>
              <th className="px-3 py-2 text-right">Monto</th>
              <th className="px-3 py-2">Gestión</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((f, i) => {
              const dias = diasDesde(f.fFactura, hoy);
              const hf = primerHitoFaltante(f);
              const tono =
                dias != null && dias > 30
                  ? "text-[--color-danger] font-semibold"
                  : dias != null && dias > 15
                  ? "text-[--color-warning] font-semibold"
                  : "text-[--color-fg]";
              return (
                <tr
                  key={`${f.vin}-${f.ventaId ?? i}`}
                  className="border-t border-[--color-border]/60 hover:bg-[--color-bg-elev-1]/40"
                >
                  <td className="px-3 py-2">
                    <div className="mono text-[--color-fg]">{f.vin}</div>
                    <div className="text-[10.5px] text-[--color-fg-dim]">
                      {f.marca ?? "—"} · {f.modelo ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-[--color-fg] truncate max-w-[200px]">
                      {f.sucursal ?? "—"}
                    </div>
                    <div className="text-[10.5px] text-[--color-fg-dim] truncate max-w-[200px]">
                      {f.vendedor ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right mono text-[--color-fg-muted]">
                    {f.fFactura ? fmtDate(f.fFactura) : "—"}
                  </td>
                  <td className={cn("px-3 py-2 text-right mono", tono)}>
                    {dias != null ? `${dias}d` : "—"}
                  </td>
                  <td className="px-3 py-2 text-[--color-fg-muted]">
                    {ultimoHitoCompletado(f)}
                  </td>
                  <td className="px-3 py-2 text-[--color-fg-muted]">
                    {hf ? LABEL_HITO_FALTANTE[hf] : "—"}
                  </td>
                  <td className="px-3 py-2 text-[--color-fg-muted]">
                    {hf ? LABEL_AREA[RESPONSABLE_POR_HITO_FALTANTE[hf].area] : "—"}
                  </td>
                  <td className="px-3 py-2 text-right mono text-[--color-fg]">
                    {fmtCLPCompact(f.valorFactura)}
                  </td>
                  <td className="px-3 py-2">
                    <AbrirCasoButton vin={limpiarVIN(f.vin)} origen={origen} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="px-5 py-3 flex items-center justify-end gap-3 border-t border-[--color-border] text-[11.5px] text-[--color-fg-muted]">
          <span>
            Página {page + 1} de {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="inline-flex items-center gap-1 rounded-md border border-[--color-border] px-2 py-1 disabled:opacity-40"
          >
            <ChevronLeft className="size-3.5" /> Anterior
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="inline-flex items-center gap-1 rounded-md border border-[--color-border] px-2 py-1 disabled:opacity-40"
          >
            Siguiente <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
