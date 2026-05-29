"use client";

import { CheckCircle2, Circle, AlertTriangle, FileSpreadsheet } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import { useHistoricoStore } from "@/lib/historico/store-cliente";

interface SlotProps {
  label: string;
  cargado: boolean;
  detalle?: string;
  meta?: string;
  warn?: boolean;
}

function Slot({ label, cargado, detalle, meta, warn }: SlotProps) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 flex items-start gap-2.5",
        cargado
          ? warn
            ? "bg-[--color-warning-dim] border-[--color-warning]/30"
            : "bg-[--color-success-dim] border-[--color-success]/25"
          : "bg-[--color-bg-elev-1] border-[--color-border]",
      )}
    >
      <div className="mt-0.5">
        {cargado ? (
          warn ? (
            <AlertTriangle className="size-4 text-[--color-warning]" />
          ) : (
            <CheckCircle2 className="size-4 text-[--color-success]" />
          )
        ) : (
          <Circle className="size-4 text-[--color-fg-dim]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-[--color-fg]">{label}</div>
        {detalle && (
          <div className="text-[11px] text-[--color-fg-muted] truncate">{detalle}</div>
        )}
        {meta && (
          <div className="text-[10.5px] text-[--color-fg-dim] mt-0.5">{meta}</div>
        )}
      </div>
    </div>
  );
}

export function EstadoCargaPanel() {
  const { cargasRoma, cargaActas, cargaSchiapp, cargaKar, errores } = useHistoricoStore();

  const mesesEsperados = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];
  const labels: Record<string, string> = {
    "2026-01": "ROMA Enero",
    "2026-02": "ROMA Febrero",
    "2026-03": "ROMA Marzo",
    "2026-04": "ROMA Abril",
    "2026-05": "ROMA Mayo",
  };

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="size-3.5 text-[--color-fg-muted]" />
            <span className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium">
              Estado de carga
            </span>
          </div>
          {errores.length > 0 && (
            <Badge tone="danger" size="xs">
              {errores.length} {errores.length === 1 ? "error" : "errores"}
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {mesesEsperados.map((mes) => {
            const c = cargasRoma.find((x) => x.mes === mes);
            return (
              <Slot
                key={mes}
                label={labels[mes]}
                cargado={!!c}
                detalle={c?.archivoNombre}
                meta={c ? `${fmtNum(c.filas)} filas · ${c.confianzaMesDeteccion}` : undefined}
                warn={c?.confianzaMesDeteccion === "baja"}
              />
            );
          })}
          <Slot
            label="Actas"
            cargado={!!cargaActas}
            detalle={cargaActas?.archivoNombre}
            meta={cargaActas ? `${fmtNum(cargaActas.filas)} filas · corte ${cargaActas.corte}` : undefined}
            warn={cargaActas?.confianzaCorte === "baja"}
          />
          <Slot
            label="SCHIAPPCASSE"
            cargado={!!cargaSchiapp}
            detalle={cargaSchiapp?.archivoNombre}
            meta={cargaSchiapp ? `${fmtNum(cargaSchiapp.vins)} VINs` : undefined}
          />
          <Slot
            label="KAR-LOGISTICS"
            cargado={!!cargaKar}
            detalle={cargaKar?.archivoNombre}
            meta={cargaKar ? `${fmtNum(cargaKar.vins)} VINs` : undefined}
          />
        </div>

        {errores.length > 0 && (
          <div className="border-t border-[--color-border] pt-2.5 space-y-1">
            {errores.map((e, i) => (
              <div key={i} className="text-[11px] text-[--color-danger]">
                <span className="font-medium">{e.archivoNombre}:</span> {e.mensaje}
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
