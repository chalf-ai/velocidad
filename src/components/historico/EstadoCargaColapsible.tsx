"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, AlertTriangle, FileSpreadsheet, UploadCloud } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useHistoricoStore } from "@/lib/historico/store-cliente";
import { HistoricoUploader } from "@/components/historico/HistoricoUploader";

/**
 * Variante colapsible del estado de carga:
 *  - Si los 8 slots están OK → barra delgada con chip "8/8 ✓" y botón "Reemplazar archivos".
 *  - Si falta algo → siempre expandido para mostrar qué falta.
 *  - Click en chevron alterna el detalle (grid de 8 mini-slots + uploader inline).
 */
export function EstadoCargaColapsible() {
  const { cargasRoma, cargaActas, cargaSchiapp, cargaKar, errores } = useHistoricoStore();
  const mesesEsperados = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];
  const labelMes: Record<string, string> = {
    "2026-01": "ROMA Ene",
    "2026-02": "ROMA Feb",
    "2026-03": "ROMA Mar",
    "2026-04": "ROMA Abr",
    "2026-05": "ROMA May",
  };

  const slots = [
    ...mesesEsperados.map((m) => {
      const c = cargasRoma.find((x) => x.mes === m);
      return { label: labelMes[m], ok: !!c, detalle: c?.archivoNombre, sub: c ? `${fmtNum(c.filas)} filas` : undefined, warn: c?.confianzaMesDeteccion === "baja" };
    }),
    { label: "Actas", ok: !!cargaActas, detalle: cargaActas?.archivoNombre, sub: cargaActas ? `${fmtNum(cargaActas.filas)} filas` : undefined, warn: cargaActas?.confianzaCorte === "baja" },
    { label: "SCHIAPP", ok: !!cargaSchiapp, detalle: cargaSchiapp?.archivoNombre, sub: cargaSchiapp ? `${fmtNum(cargaSchiapp.vins)} VINs` : undefined, warn: false },
    { label: "KAR", ok: !!cargaKar, detalle: cargaKar?.archivoNombre, sub: cargaKar ? `${fmtNum(cargaKar.vins)} VINs` : undefined, warn: false },
  ];

  const okCount = slots.filter((s) => s.ok).length;
  const total = slots.length;
  const algunoMal = okCount < total;
  const hayWarn = slots.some((s) => s.ok && s.warn);
  const hayError = errores.length > 0;

  // Auto-expandido si falta algo o hay errores; manual si todo OK.
  const [manualExpand, setManualExpand] = useState(false);
  const expandido = algunoMal || hayError || manualExpand;

  return (
    <Card>
      <CardBody className={cn(expandido ? "space-y-3" : "py-2 px-4")}>
        {/* Barra delgada — siempre presente */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1">
            <FileSpreadsheet className="size-3.5 text-[--color-fg-muted]" />
            <span className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium">
              Estado de carga
            </span>
            <Badge tone={algunoMal ? "warning" : "success"} size="sm" dot>
              {okCount}/{total} archivos
            </Badge>
            {hayWarn && (
              <Badge tone="warning" size="xs">
                <AlertTriangle className="size-2.5 mr-0.5" /> confianza baja
              </Badge>
            )}
            {hayError && (
              <Badge tone="danger" size="xs">
                {errores.length} error{errores.length === 1 ? "" : "es"}
              </Badge>
            )}
          </div>
          {!algunoMal && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setManualExpand((v) => !v)}
            >
              {expandido ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              {expandido ? "Ocultar detalle" : "Detalle"}
            </Button>
          )}
        </div>

        {expandido && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {slots.map((s, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-lg border px-2.5 py-2 flex items-start gap-2",
                    s.ok
                      ? s.warn
                        ? "bg-[--color-warning-dim] border-[--color-warning]/30"
                        : "bg-[--color-success-dim] border-[--color-success]/25"
                      : "bg-[--color-bg-elev-1] border-[--color-border]",
                  )}
                >
                  {s.ok ? (
                    <CheckCircle2 className="size-3.5 mt-0.5 text-[--color-success] shrink-0" />
                  ) : (
                    <UploadCloud className="size-3.5 mt-0.5 text-[--color-fg-dim] shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium">{s.label}</div>
                    {s.detalle && (
                      <div className="text-[10.5px] text-[--color-fg-muted] truncate">{s.detalle}</div>
                    )}
                    {s.sub && (
                      <div className="text-[10px] text-[--color-fg-dim] mt-0.5">{s.sub}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {hayError && (
              <div className="border-t border-[--color-border] pt-2 space-y-0.5">
                {errores.map((e, i) => (
                  <div key={i} className="text-[11px] text-[--color-danger]">
                    <span className="font-medium">{e.archivoNombre}:</span> {e.mensaje}
                  </div>
                ))}
              </div>
            )}

            <div className="pt-1">
              <HistoricoUploader />
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
