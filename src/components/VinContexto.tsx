"use client";

/**
 * Navegación contextual por VIN — "una sola operación viva".
 *
 * Cuando un módulo se abre con `?vin=XXXX` (desde el caso operacional en Centro
 * de Acción u otra pantalla), filtra/posiciona ese VIN en vez de mostrar la home
 * del módulo. La gestión, score y seguimiento siguen siendo del VIN (se guardan
 * por VIN en el store), así el contexto se conserva entre módulos.
 *
 * `useVinContexto()` lee el parámetro (normalizado). Debe usarse dentro de un
 * <Suspense> (requisito de useSearchParams en export estático).
 * `VinContextoBanner` muestra el contexto + "Ver todo" para limpiar el filtro.
 */

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Crosshair, X } from "lucide-react";
import { limpiarVIN } from "@/lib/parser/venta-apc";

/** VIN del contexto actual (normalizado) o null. */
export function useVinContexto(): string | null {
  const sp = useSearchParams();
  const raw = sp.get("vin");
  return useMemo(() => {
    const v = raw ? limpiarVIN(raw) : "";
    return v || null;
  }, [raw]);
}

/**
 * Banner de contexto de VIN. `presentes` = cuántos registros del VIN hay en este
 * módulo (0 → "VIN no presente en este universo", manteniendo el contexto).
 */
export function VinContextoBanner({
  vin,
  presentes,
  extra,
  nota,
}: {
  vin: string;
  presentes: number;
  /** Texto secundario opcional (ej. monto, marca/modelo). */
  extra?: string;
  /** Nota que reemplaza la línea de "N registros" (ej. provisiones sin VIN). */
  nota?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const presente = presentes > 0;
  return (
    <div
      className="flex items-center justify-between gap-3 flex-wrap rounded-xl border px-4 py-2.5 mb-4"
      style={{
        borderColor: presente ? "var(--color-accent)" : "var(--color-warning)",
        background: presente ? "var(--color-accent)" + "0d" : "var(--color-warning)" + "0d",
      }}
    >
      <div className="flex items-center gap-2 text-[12.5px]">
        <Crosshair className="size-4" style={{ color: presente ? "var(--color-accent)" : "var(--color-warning)" }} />
        <span className="text-[--color-fg-muted]">Caso</span>
        <span className="mono font-semibold text-[--color-fg]">{vin}</span>
        {nota ? (
          <span className="text-[--color-fg-muted]">· {nota}</span>
        ) : presente ? (
          <span className="text-[--color-fg-muted]">
            · {presentes} registro{presentes === 1 ? "" : "s"} en este módulo
            {extra ? ` · ${extra}` : ""}
          </span>
        ) : (
          <span style={{ color: "var(--color-warning)" }}>· VIN no presente en este universo</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href={`/centro-accion?vin=${encodeURIComponent(vin)}`}
          className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-md border border-[--color-accent]/40 text-[--color-accent] hover:bg-[--color-accent]/8 transition font-medium"
        >
          <ArrowLeft className="size-3.5" /> Volver al caso
        </Link>
        <button
          onClick={() => router.replace(pathname)}
          className="inline-flex items-center gap-1 text-[12px] text-[--color-fg-muted] hover:text-[--color-fg] transition"
        >
          Ver todo <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
