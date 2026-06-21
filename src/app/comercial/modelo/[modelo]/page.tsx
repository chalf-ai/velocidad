/**
 * /comercial/modelo/[modelo] · Ficha ejecutiva de un modelo.
 * Resumen · Qué pasa · Qué preocupa · Oportunidades · Acciones · Datos base · Limitaciones.
 * Datos ROMA en vivo (read-only). No inventa.
 */

import Link from "next/link";
import { ArrowLeft, AlertTriangle, Sparkles, Activity, ClipboardCheck, Database, Info } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { getModeloComercial } from "@/lib/comercial/queries";
import { evaluarModelo, tendenciaTexto, SITUACION_META } from "@/lib/comercial/logica";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function Bloque({ titulo, icon, color, children }: { titulo: string; icon: React.ReactNode; color?: string; children: React.ReactNode }) {
  return (
    <section className="surface bg-white px-5 py-4">
      <div className="flex items-center gap-2 mb-2.5">
        <span style={{ color: color ?? "var(--color-accent)" }}>{icon}</span>
        <h2 className="text-[13.5px] font-semibold tracking-tight text-[--color-fg]">{titulo}</h2>
      </div>
      {children}
    </section>
  );
}

function Lista({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-[12.5px] text-[--color-fg-dim]">Nada que destacar.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((t, i) => (
        <li key={i} className="text-[12.5px] text-[--color-fg-muted] leading-snug flex gap-2">
          <span className="text-[--color-fg-dim] shrink-0">•</span>
          <span dangerouslySetInnerHTML={{ __html: t }} />
        </li>
      ))}
    </ul>
  );
}

function Dato({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-3 py-2.5">
      <div className="text-[9.5px] uppercase tracking-[0.06em] text-[--color-fg-dim]">{label}</div>
      <div className="text-[18px] font-bold mono text-[--color-fg] leading-none mt-1">{value}</div>
      {sub && <div className="text-[10px] text-[--color-fg-muted] mt-0.5">{sub}</div>}
    </div>
  );
}

export default async function FichaModeloPage({ params }: { params: Promise<{ modelo: string }> }) {
  const { modelo } = await params;

  let m, ev, error: string | null = null;
  try {
    m = await getModeloComercial(modelo);
    ev = evaluarModelo(m);
  } catch (e) {
    error = e instanceof Error ? e.message : "Error consultando ROMA";
  }

  const back = (
    <Link href="/comercial" className="inline-flex items-center gap-1.5 text-[12px] text-[--color-accent] hover:underline">
      <ArrowLeft className="size-3.5" /> Volver a la torre
    </Link>
  );

  if (error || !m || !ev) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-6 space-y-4">
        {back}
        <div className="surface bg-white px-5 py-4 flex items-start gap-3">
          <AlertTriangle className="size-5 text-[--color-warning] shrink-0 mt-0.5" />
          <div>
            <div className="text-[14px] font-semibold text-[--color-fg]">ROMA no disponible</div>
            <div className="text-[12px] text-[--color-fg-dim] mt-1 mono">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  const meta = SITUACION_META[ev.situacion];
  const st = m.stock, d = m.demanda, vig = m.vigentes, cr = m.credito;
  const sinDatos = st.disponibles === 0 && d.cot30 === 0 && vig.total90d === 0;

  // Narrativa
  const quePasa: string[] = [];
  if (vig.vppActiva) quePasa.push(`<b>${vig.vppActiva}</b> vigentes con <b>VPP activa</b> — la señal más fuerte de cierre (trade-in tomado).`);
  quePasa.push(`<b>${cr.aprobado}</b> con crédito aprobado · ${cr.solicitud} en solicitud · ${cr.rechazado} rechazados (90d).`);
  quePasa.push(`Cotizaciones último mes: <b>${fmtNum(d.cot30)}</b> — ${tendenciaTexto(m)}.`);

  const quePreocupa: string[] = [];
  if (vig.creditoSinFirmar) quePreocupa.push(`<b>${vig.creditoSinFirmar}</b> vigentes con crédito <b>sin firmar</b> — ventas a un paso de facturar, frenadas.`);
  if (st.disponibles > 0 && st.disponibles <= 10 && d.tendencia === "creciente") quePreocupa.push(`Solo ${st.disponibles} unidades para demanda creciente — riesgo de quiebre de stock.`);
  if (st.sobre90) quePreocupa.push(`${st.sobre90} unidades sobre 90 días (máx ${st.diasMax}d) inmovilizando capital.`);
  if (cr.bloqueada) quePreocupa.push(`${cr.bloqueada} con crédito bloqueado (señal contaminada — revisar caso a caso).`);

  const oportunidades: string[] = [];
  if (vig.vppActiva) oportunidades.push(`<b>${vig.vppActiva}</b> VPP activas — máxima probabilidad de cierre (señal #1).`);
  if (cr.aprobado) oportunidades.push(`<b>${cr.aprobado}</b> aprobados sin cerrar — alta probabilidad de venta.`);
  if (vig.creditoSinFirmar) oportunidades.push(`${vig.creditoSinFirmar} vigentes a un crédito firmado de facturar este mes.`);
  if (cr.solicitud) oportunidades.push(`${cr.solicitud} solicitudes en proceso para empujar a aprobación.`);

  return (
    <div className="mx-auto max-w-4xl px-5 py-6 space-y-4">
      {back}
      <div className="relative surface bg-white px-5 py-4 overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ backgroundColor: meta.color }} />
        <PageHeader
          kicker="Velocity Comercial · Modelo"
          title={m.modelo}
          description={ev.motivo}
          actions={<span className={cn("inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold", meta.chip)}>{meta.label}</span>}
        />
      </div>

      {sinDatos && (
        <div className="surface bg-white px-5 py-4 text-[12.5px] text-[--color-fg-muted]">
          No encontré datos de <b>{m.modelo}</b> en ROMA (ni stock, ni cotizaciones, ni vigentes). ¿El nombre es correcto?
        </div>
      )}

      <Bloque titulo="Qué está pasando" icon={<Activity className="size-4" />}><Lista items={quePasa} /></Bloque>
      <Bloque titulo="Qué preocupa" icon={<AlertTriangle className="size-4" />} color="var(--color-danger)"><Lista items={quePreocupa} /></Bloque>
      <Bloque titulo="Dónde está la oportunidad" icon={<Sparkles className="size-4" />} color="var(--color-success)"><Lista items={oportunidades} /></Bloque>

      <Bloque titulo="Acciones recomendadas" icon={<ClipboardCheck className="size-4" />}>
        {ev.acciones.length === 0 ? (
          <p className="text-[12.5px] text-[--color-fg-dim]">Sin acción urgente — mantener seguimiento.</p>
        ) : (
          <ol className="space-y-2">
            {ev.acciones.map((a, i) => (
              <li key={a.id} className="flex gap-3 items-start">
                <span className="mono text-[11px] font-bold text-[--color-accent] bg-[--color-accent-dim] rounded px-1.5 py-0.5 shrink-0 mt-0.5">{a.id}</span>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold text-[--color-fg]">{i + 1}. {a.nombre}</div>
                  <div className="text-[11.5px] text-[--color-fg-muted] leading-snug">{a.detalle}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Bloque>

      <Bloque titulo="Datos base" icon={<Database className="size-4" />}>
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y divide-[--color-border] border border-[--color-border] rounded-lg overflow-hidden">
          <Dato label="Stock disp." value={fmtNum(st.disponibles)} sub={`${st.sobre90} sobre 90d · prom ${st.diasProm}d`} />
          <Dato label="Demanda 30d" value={fmtNum(d.cot30)} sub={`prev ${fmtNum(d.cotPrev30)}${d.deltaPct !== null ? ` · ${d.deltaPct > 0 ? "+" : ""}${d.deltaPct}%` : ""}`} />
          <Dato label="Vigentes 90d" value={fmtNum(vig.total90d)} />
          <Dato label="VPP activa" value={fmtNum(vig.vppActiva)} sub="trade-in tomado" />
          <Dato label="Sin firmar" value={fmtNum(vig.creditoSinFirmar)} sub="crédito vigente" />
          <Dato label="Aprobado" value={fmtNum(cr.aprobado)} />
          <Dato label="Solicitud" value={fmtNum(cr.solicitud)} />
          <Dato label="Rechazado" value={fmtNum(cr.rechazado)} />
        </div>
      </Bloque>

      <Bloque titulo="Limitaciones" icon={<Info className="size-4" />} color="var(--color-fg-dim)">
        <Lista
          items={[
            "<b>RVM (mercado)</b> no integrado — sin participación ni posición de mercado.",
            "<b>Listas de precio</b> no integradas — sin precio/bono vigente.",
            "<b>Escalera VPP fina</b> (tasada / inspeccionada / carta de toma) vive en AutoRed, no en ROMA vivo — hoy solo VPP activa. La acción <b>P4</b> (mover VPP detenida) queda pendiente de ese feed.",
          ]}
        />
      </Bloque>
    </div>
  );
}
