/**
 * /velocity-comercial · Velocidad Comercial V2 — Torre de Control.
 * Portada: los MODELOS son PUERTAS a sus colas de negocios gestionables.
 * Verdad: V2-ontologia-y-principios.md (dddb71d). No reporte: cada modelo abre una cola.
 * Sin dinero, sin RVM, sin precio, sin aprobados masivos. Datos ROMA (read-only).
 */

import Link from "next/link";
import { Target, AlertTriangle, Car, FileSignature, PackageX, Clock, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { getPortadaModelos, type PortadaModelo } from "@/lib/comercial/cola";
import { fmtNum } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function Chip({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={tone ?? "text-[--color-fg-dim]"}>{icon}</span>
      <span className="mono text-[13px] font-semibold text-[--color-fg]">{fmtNum(value)}</span>
      <span className="text-[10.5px] text-[--color-fg-muted]">{label}</span>
    </div>
  );
}

function Puerta({ m }: { m: PortadaModelo }) {
  return (
    <Link
      href={`/velocity-comercial/modelo/${m.modelo.toLowerCase()}/cola`}
      className="surface bg-white px-4 py-3.5 flex items-center gap-4 transition hover:shadow-md hover:border-[--color-accent]/40"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-bold tracking-tight text-[--color-fg]">{m.modelo}</span>
          <span className="text-[12px] text-[--color-fg-muted]">· <b className="text-[--color-fg] mono">{fmtNum(m.total)}</b> en cola</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5">
          <Chip icon={<Car className="size-3.5" />} label="VPP activa" value={m.vpp} tone={m.vpp ? "text-[--color-success]" : undefined} />
          <Chip icon={<FileSignature className="size-3.5" />} label="sin firmar" value={m.sinFirmar} tone={m.sinFirmar ? "text-[--color-warning]" : undefined} />
          <Chip icon={<PackageX className="size-3.5" />} label="sin VIN" value={m.sinVin} tone={m.sinVin ? "text-[--color-danger]" : undefined} />
          <div className="flex items-center gap-1.5">
            <Clock className="size-3.5 text-[--color-fg-dim]" />
            <span className="mono text-[13px] font-semibold text-[--color-fg]">{fmtNum(m.perecMax)}d</span>
            <span className="text-[10.5px] text-[--color-fg-muted]">el más viejo</span>
          </div>
        </div>
      </div>
      <span className="shrink-0 inline-flex items-center gap-1 text-[12px] font-medium text-[--color-accent]">
        Ver cola <ChevronRight className="size-4" />
      </span>
    </Link>
  );
}

export default async function PortadaV2() {
  let modelos: PortadaModelo[] = [];
  let error: string | null = null;
  try {
    modelos = await getPortadaModelos();
  } catch (e) {
    error = e instanceof Error ? e.message : "Error consultando ROMA";
  }

  const totalNegocios = modelos.reduce((s, m) => s + m.total, 0);

  return (
    <div className="mx-auto max-w-5xl px-5 py-6 space-y-5">
      <PageHeader
        kicker="Velocidad Comercial · V2"
        kickerIcon={<Target className="size-3.5" />}
        title="Torre de Control"
        description="Cada modelo es una puerta a su cola de negocios gestionables. La cola se vacía cuando cambia la realidad del negocio — no se consulta."
      />

      {error ? (
        <div className="surface bg-white px-5 py-4 flex items-start gap-3">
          <AlertTriangle className="size-5 text-[--color-warning] shrink-0 mt-0.5" />
          <div>
            <div className="text-[14px] font-semibold text-[--color-fg]">ROMA no disponible</div>
            <div className="text-[12.5px] text-[--color-fg-muted] mt-1">
              En local requiere el túnel SSH al bastión y <span className="mono">ROMA_DATABASE_URL</span>. No muestro datos inventados.
            </div>
            <div className="text-[11px] text-[--color-fg-dim] mt-2 mono">{error}</div>
          </div>
        </div>
      ) : modelos.length === 0 ? (
        <div className="surface bg-white px-5 py-4 text-[13px] text-[--color-fg-muted]">
          No hay negocios gestionables en la cola hoy. Cola vacía — nada que destrabar.
        </div>
      ) : (
        <>
          <div className="text-[12.5px] text-[--color-fg-muted]">
            <b className="text-[--color-fg] mono">{fmtNum(totalNegocios)}</b> negocios gestionables en <b className="text-[--color-fg] mono">{modelos.length}</b> modelos.
            <span className="text-[--color-fg-dim]"> Núcleo: vigentes con VPP activa, crédito sin firmar o sin VIN. (Cotizaciones aprobadas fuera de la cola.)</span>
          </div>
          <div className="space-y-2">
            {modelos.map((m) => <Puerta key={m.modelo} m={m} />)}
          </div>
        </>
      )}
    </div>
  );
}
