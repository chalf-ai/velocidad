"use client";

import Link from "next/link";
import { CheckCircle2, AlertTriangle, ArrowUpRight, FileSpreadsheet } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import { useHistoricoStore } from "@/lib/historico/store-cliente";
import { useIngestaStore } from "@/lib/ingesta/store";

/**
 * Banner persistente del estado de fuentes históricas. Reemplaza la lógica
 * de carga propia que tenía /velocidad-operacional. Lee:
 *   - useHistoricoStore: cortes ROMA, Actas, SCHIAPP, KAR (los cargados via
 *     /ingesta llegan acá por el puente del dispatcher).
 *   - useIngestaStore: cross-check de metadatos.
 *
 * Si faltan fuentes, redirige a /ingesta con copy claro.
 */
export function EstadoFuentesBanner() {
  const cargasRoma = useHistoricoStore((s) => s.cargasRoma);
  const cargaActas = useHistoricoStore((s) => s.cargaActas);
  const cargaSchiapp = useHistoricoStore((s) => s.cargaSchiapp);
  const cargaKar = useHistoricoStore((s) => s.cargaKar);
  const cruce = useHistoricoStore((s) => s.cruce);
  // Reads from useIngestaStore for cross-check; not strictly needed pero
  // permite mostrar advertencia si /ingesta tiene fuentes que el motor
  // histórico no procesó por alguna razón.
  const metasIngesta = useIngestaStore((s) => s.metas);

  const tieneRoma = cargasRoma.length > 0;
  const tieneActas = !!cargaActas;
  const tieneSchiapp = !!cargaSchiapp;
  const tieneKar = !!cargaKar;

  const fuentesMin = tieneRoma && tieneActas; // mínimo para tener cruce
  const fuentesCompletas = fuentesMin && tieneSchiapp && tieneKar;

  // ── Caso 1: cruce listo y fuentes completas → banner verde compacto
  if (cruce && fuentesCompletas) {
    return (
      <Card>
        <CardBody className="py-2.5 px-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <CheckCircle2 className="size-3.5 text-[--color-success] shrink-0" />
              <span className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium shrink-0">
                Fuentes cargadas
              </span>
              <Badge tone="success" size="xs" dot>
                ROMA {cargasRoma.length} cortes
              </Badge>
              <Badge tone="success" size="xs" dot>
                Actas {cargaActas?.corte ?? ""}
              </Badge>
              <Badge tone="success" size="xs" dot>
                SCHIAPP {fmtNum(cargaSchiapp?.vins ?? 0)} VINs
              </Badge>
              <Badge tone="success" size="xs" dot>
                KAR {fmtNum(cargaKar?.vins ?? 0)} VINs
              </Badge>
            </div>
            <Link
              href="/ingesta"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[--color-accent] hover:underline shrink-0"
            >
              Editar fuentes
              <ArrowUpRight className="size-3" />
            </Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  // ── Caso 2: cruce listo pero faltan SCHIAPP/KAR → banner ámbar (parcial)
  if (cruce && fuentesMin && !fuentesCompletas) {
    const faltan: string[] = [];
    if (!tieneSchiapp) faltan.push("SCHIAPP");
    if (!tieneKar) faltan.push("KAR");
    return (
      <Card>
        <CardBody className="py-2.5 px-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <AlertTriangle className="size-3.5 text-[--color-warning] shrink-0" />
              <span className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium shrink-0">
                Fuentes parciales
              </span>
              <Badge tone="success" size="xs" dot>
                ROMA {cargasRoma.length} cortes
              </Badge>
              <Badge tone="success" size="xs" dot>
                Actas {cargaActas?.corte ?? ""}
              </Badge>
              {faltan.map((f) => (
                <Badge key={f} tone="warning" size="xs" dot>
                  {f} faltante
                </Badge>
              ))}
              <span className="text-[11px] text-[--color-fg-muted]">
                Logística tendrá hitos faltantes hasta cargar {faltan.join(" + ")}.
              </span>
            </div>
            <Link
              href="/ingesta"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[--color-accent] hover:underline shrink-0"
            >
              Cargar en Ingesta
              <ArrowUpRight className="size-3" />
            </Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  // ── Caso 3: faltan ROMA o Actas → banner llamativo + CTA
  const faltanMin: string[] = [];
  if (!tieneRoma) faltanMin.push("ROMA mensual (Ene-May)");
  if (!tieneActas) faltanMin.push("Actas histórico");

  // Si hay metas en /ingesta pero el motor histórico no las tiene, advertir
  const ingestaTieneActas = !!metasIngesta.actas;
  const ingestaTieneRoma = !!metasIngesta.logistica_roma;
  const desincronizado =
    (ingestaTieneActas && !tieneActas) || (ingestaTieneRoma && !tieneRoma);

  return (
    <Card variant="elevated">
      <CardBody className="py-3 px-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-2 min-w-0">
            <FileSpreadsheet className="size-4 text-[--color-warning] mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-[--color-fg]">
                Faltan fuentes para construir el histórico
              </div>
              <div className="text-[12px] text-[--color-fg-muted] mt-0.5">
                Para activar la Vista Histórica se necesita:{" "}
                <span className="text-[--color-fg] font-medium">
                  {faltanMin.join(" · ")}
                </span>
                .
              </div>
              {desincronizado && (
                <div
                  className={cn(
                    "mt-1.5 text-[11px] inline-flex items-center gap-1.5 rounded-md px-2 py-1",
                    "bg-[--color-warning-dim] text-[--color-warning] ring-1 ring-inset ring-[--color-warning]/30",
                  )}
                >
                  <AlertTriangle className="size-3" />
                  Hay fuentes cargadas en /ingesta que el motor histórico aún no procesó. Vuelve a /ingesta y
                  recargá el archivo correspondiente.
                </div>
              )}
            </div>
          </div>
          <Link
            href="/ingesta"
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium",
              "bg-[--color-accent] text-white hover:brightness-110 shrink-0",
              "shadow-[0_1px_2px_rgba(46,92,246,0.2),0_4px_12px_-4px_rgba(46,92,246,0.3)]",
            )}
          >
            Ir a Ingesta Operacional
            <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
