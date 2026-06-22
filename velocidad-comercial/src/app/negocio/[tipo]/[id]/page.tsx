/**
 * /negocio/[tipo]/[id] · Nivel 3 — el negocio se reduce a una jugada.
 * Muestra SOLO: bloqueo exacto · dueño del bloqueo · estado de vida · jugada.
 * Sin "marcar hecho", sin sacar de cola a mano (Principio 3).
 */

import Link from "next/link";
import { ArrowLeft, AlertTriangle, Ban, UserCog, HeartPulse, Swords, Info } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { getNegocio, type NegocioDetalle, type EstadoVida } from "@/lib/comercial/cola";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const VIDA_META: Record<EstadoVida, { tone: string; chip: string }> = {
  vivo: { tone: "var(--color-success)", chip: "bg-[--color-success-dim] text-[--color-success]" },
  agonizando: { tone: "var(--color-warning)", chip: "bg-[--color-warning-dim] text-[--color-warning]" },
  "muerto operativo": { tone: "var(--color-danger)", chip: "bg-[--color-danger-dim] text-[--color-danger]" },
};

function Campo({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="surface bg-white px-5 py-4">
      <div className="flex items-center gap-2 mb-1.5">
        <span style={{ color: color ?? "var(--color-accent)" }}>{icon}</span>
        <span className="text-[10.5px] uppercase tracking-[0.08em] text-[--color-fg-dim] font-semibold">{label}</span>
      </div>
      <div className="text-[15px] text-[--color-fg] leading-snug">{value}</div>
    </div>
  );
}

export default async function FichaNegocio({ params }: { params: Promise<{ tipo: string; id: string }> }) {
  const { tipo, id } = await params;
  let n: NegocioDetalle | null = null;
  let error: string | null = null;
  try {
    n = await getNegocio(tipo, Number(id));
  } catch (e) {
    error = e instanceof Error ? e.message : "Error consultando ROMA";
  }

  const back = (
    <Link href="/" className="inline-flex items-center gap-1.5 text-[12px] text-[--color-accent] hover:underline">
      <ArrowLeft className="size-3.5" /> Volver a la torre
    </Link>
  );

  if (error || !n) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-6 space-y-4">
        {back}
        <div className="surface bg-white px-5 py-4 flex items-start gap-3">
          <AlertTriangle className="size-5 text-[--color-warning] shrink-0 mt-0.5" />
          <div>
            <div className="text-[14px] font-semibold text-[--color-fg]">
              {error ? "ROMA no disponible" : "Negocio no encontrado o ya salió de la cola"}
            </div>
            <div className="text-[12px] text-[--color-fg-muted] mt-1">
              {error ? <span className="mono text-[11px]">{error}</span> : "Un negocio sale de la cola solo cuando cambia su realidad (facturó o murió)."}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const vida = VIDA_META[n.estadoVida];

  return (
    <div className="mx-auto max-w-2xl px-5 py-6 space-y-4">
      {back}
      <div className="relative surface bg-white px-5 py-4 overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ backgroundColor: vida.tone }} />
        <PageHeader
          kicker={`Velocidad Comercial · Negocio · ${n.modelo}`}
          title={n.cliente}
          description={
            <span className="flex items-center gap-2 flex-wrap">
              {n.pompeyo && <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-[--color-accent-dim] text-[--color-accent]">Cliente Pompeyo</span>}
              <span className="text-[12px] text-[--color-fg-muted]">{n.vin ? `VIN ${n.vin}` : "sin VIN"} · {n.perecibilidad}d en cola</span>
            </span>
          }
          actions={<span className={cn("inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold capitalize", vida.chip)}>{n.estadoVida}</span>}
        />
      </div>

      <Campo icon={<Ban className="size-4" />} label="Bloqueo exacto" value={n.bloqueo} color="var(--color-danger)" />
      <Campo icon={<UserCog className="size-4" />} label="Dueño del bloqueo" value={n.dueno} />
      <Campo icon={<HeartPulse className="size-4" />} label="Estado de vida" value={<span className="capitalize">{n.estadoVida}</span>} color={vida.tone} />
      <Campo icon={<Swords className="size-4" />} label="Jugada" value={<b>{n.jugada}</b>} color="var(--color-accent)" />

      <div className="flex items-start gap-2 text-[11px] text-[--color-fg-dim] border-t border-[--color-border] pt-3 leading-relaxed">
        <Info className="size-3.5 shrink-0 mt-0.5" />
        <span>
          Este negocio sale de la cola <b>solo cuando cambia su realidad</b> en ROMA (factura o muere). No se puede marcar como hecho ni sacar a mano —
          la cola se vacía con la realidad, no gestionando (Principio 3).
        </span>
      </div>
    </div>
  );
}
