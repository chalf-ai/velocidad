/**
 * /modelo/[modelo]/cola · Nivel 2 — la cola de negocios. Vertical, no tabla.
 * Cada ítem: cliente+flag Pompeyo, vehículo, marcador sin-VIN, estado dominante, perecibilidad.
 * Orden: VPP > crédito sin firmar > sin VIN, luego perecibilidad desc.
 */

import Link from "next/link";
import { ArrowLeft, AlertTriangle, Car, FileSignature, PackageX, Clock, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { getCola, type ColaItem, type EstadoDominante } from "@/lib/comercial/cola";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ESTADO_META: Record<EstadoDominante, { icon: React.ReactNode; tone: string; chip: string }> = {
  "VPP activa": { icon: <Car className="size-3.5" />, tone: "var(--color-success)", chip: "bg-[--color-success-dim] text-[--color-success]" },
  "crédito sin firmar": { icon: <FileSignature className="size-3.5" />, tone: "var(--color-warning)", chip: "bg-[--color-warning-dim] text-[--color-warning]" },
  "sin VIN": { icon: <PackageX className="size-3.5" />, tone: "var(--color-danger)", chip: "bg-[--color-danger-dim] text-[--color-danger]" },
};

function Item({ n }: { n: ColaItem }) {
  const meta = ESTADO_META[n.estadoDominante];
  return (
    <Link
      href={`/negocio/${n.tipo}/${n.negocioId}`}
      className="relative surface bg-white pl-4 pr-3 py-3 flex items-center gap-3 transition hover:shadow-md hover:border-[--color-accent]/40"
    >
      <div className="absolute top-0 bottom-0 left-0 w-[3px] rounded-l-2xl" style={{ backgroundColor: meta.tone }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-semibold text-[--color-fg] truncate">{n.cliente}</span>
          {n.pompeyo && <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded bg-[--color-accent-dim] text-[--color-accent]">Pompeyo</span>}
          {n.sinVin && <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded bg-[--color-danger-dim] text-[--color-danger]">SIN VIN</span>}
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-semibold", meta.chip)}>
            {meta.icon}{n.estadoDominante}
          </span>
          <span className="text-[11.5px] text-[--color-fg-muted]">{n.modelo}</span>
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-1 text-right">
        <Clock className="size-3.5 text-[--color-fg-dim]" />
        <span className="mono text-[14px] font-bold text-[--color-fg]">{n.perecibilidad}d</span>
      </div>
      <ChevronRight className="size-4 text-[--color-accent] shrink-0" />
    </Link>
  );
}

export default async function ColaModelo({ params }: { params: Promise<{ modelo: string }> }) {
  const { modelo } = await params;
  let cola: ColaItem[] = [];
  let error: string | null = null;
  try {
    cola = await getCola(modelo);
  } catch (e) {
    error = e instanceof Error ? e.message : "Error consultando ROMA";
  }
  const nombre = decodeURIComponent(modelo).toUpperCase();

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 space-y-4">
      <Link href="/" className="inline-flex items-center gap-1.5 text-[12px] text-[--color-accent] hover:underline">
        <ArrowLeft className="size-3.5" /> Volver a la torre
      </Link>
      <PageHeader
        kicker="Velocidad Comercial · Cola"
        title={nombre}
        description="Negocios gestionables, de mayor a menor intención y antigüedad. Cada negocio se reduce a una jugada — no se estudia."
      />

      {error ? (
        <div className="surface bg-white px-5 py-4 flex items-start gap-3">
          <AlertTriangle className="size-5 text-[--color-warning] shrink-0 mt-0.5" />
          <div>
            <div className="text-[14px] font-semibold text-[--color-fg]">ROMA no disponible</div>
            <div className="text-[11px] text-[--color-fg-dim] mt-1 mono">{error}</div>
          </div>
        </div>
      ) : cola.length === 0 ? (
        <div className="surface bg-white px-5 py-4 text-[13px] text-[--color-fg-muted]">
          Cola vacía para <b>{nombre}</b>. Nada que destrabar — eso es lo que queremos.
        </div>
      ) : (
        <>
          <div className="text-[12px] text-[--color-fg-muted]"><b className="text-[--color-fg] mono">{cola.length}</b> negocios en cola.</div>
          <div className="space-y-2">
            {cola.map((n) => <Item key={n.negocioId} n={n} />)}
          </div>
        </>
      )}
    </div>
  );
}
