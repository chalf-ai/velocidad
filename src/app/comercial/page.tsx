/**
 * /comercial · Velocity Comercial V1 — Torre de Control de Modelos.
 *
 * Responde en <30s: ¿qué modelo requiere atención, por qué, dónde está la
 * oportunidad y qué acción ejecutar? Objeto = MODELO · acción = NEGOCIO.
 * Datos: ROMA en vivo (read-only). Sin RVM, sin listas, sin escalera VPP fina
 * (AutoRed) — declarados pendientes. No inventa datos.
 */

import { Target, AlertTriangle, Sparkles, Info } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { ModeloCard } from "@/components/comercial/ModeloCard";
import { getModelosComercial, MODELOS_INICIALES, type ModeloComercial } from "@/lib/comercial/queries";
import { evaluarModelo, ACCIONES, type AccionId, type EvalModelo } from "@/lib/comercial/logica";
import { fmtNum } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row = { m: ModeloComercial; ev: EvalModelo };

function Kpi({ label, value, tone, icon }: { label: string; value: string; tone?: string; icon?: React.ReactNode }) {
  return (
    <div className="surface bg-white px-4 py-3 flex items-center gap-3">
      <div className="size-9 rounded-xl bg-[--color-accent-dim] flex items-center justify-center text-[--color-accent] shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.08em] text-[--color-fg-dim]">{label}</div>
        <div className={`text-[20px] font-bold leading-none mt-0.5 mono ${tone ?? "text-[--color-fg]"}`}>{value}</div>
      </div>
    </div>
  );
}

function Seccion({ titulo, icon, color, rows }: { titulo: string; icon: React.ReactNode; color: string; rows: Row[] }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <span style={{ color }}>{icon}</span>
        <h2 className="text-[14px] font-semibold tracking-tight text-[--color-fg]">{titulo}</h2>
        <span className="text-[11px] text-[--color-fg-dim]">({rows.length})</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {rows.map(({ m }) => <ModeloCard key={m.modelo} m={m} />)}
      </div>
    </section>
  );
}

export default async function ComercialPage() {
  let rows: Row[] = [];
  let error: string | null = null;
  try {
    const modelos = await getModelosComercial(MODELOS_INICIALES);
    rows = modelos.map((m) => ({ m, ev: evaluarModelo(m) }));
  } catch (e) {
    error = e instanceof Error ? e.message : "Error consultando ROMA";
  }

  const atencion = rows.filter((r) => r.ev.situacion === "atencion").sort((a, b) => b.ev.altaIntencion - a.ev.altaIntencion);
  const oportunidad = rows.filter((r) => r.ev.situacion === "oportunidad").sort((a, b) => b.ev.altaIntencion - a.ev.altaIntencion);
  const estables = rows.filter((r) => r.ev.situacion === "estable");

  const totalIntencion = rows.reduce((s, r) => s + r.ev.altaIntencion, 0);
  const totalVPP = rows.reduce((s, r) => s + r.m.vigentes.vppActiva, 0);
  const totalSinFirmar = rows.reduce((s, r) => s + r.m.vigentes.creditoSinFirmar, 0);

  // Acciones recomendadas agregadas (cuántos modelos las disparan).
  const accCount = new Map<AccionId, number>();
  for (const r of rows) for (const a of r.ev.acciones) accCount.set(a.id, (accCount.get(a.id) ?? 0) + 1);
  const accionesAgg = [...accCount.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="mx-auto max-w-7xl px-5 py-6 space-y-6">
      <PageHeader
        kicker="Velocity Comercial · V1"
        kickerIcon={<Target className="size-3.5" />}
        title="Torre de Control de Modelos"
        description="Qué modelos requieren atención y qué acción comercial ejecutar para vender más. Datos ROMA en vivo · jerarquía VPP > crédito."
      />

      {error ? (
        <div className="surface bg-white px-5 py-4 flex items-start gap-3">
          <AlertTriangle className="size-5 text-[--color-warning] shrink-0 mt-0.5" />
          <div>
            <div className="text-[14px] font-semibold text-[--color-fg]">ROMA no disponible</div>
            <div className="text-[12.5px] text-[--color-fg-muted] mt-1">
              No pude consultar ROMA en vivo. En local requiere el túnel SSH al bastión y <span className="mono">ROMA_DATABASE_URL</span> en <span className="mono">.env.local</span>. No muestro datos inventados.
            </div>
            <div className="text-[11px] text-[--color-fg-dim] mt-2 mono">{error}</div>
          </div>
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Modelos en atención" value={fmtNum(atencion.length)} tone="text-[--color-danger]" icon={<AlertTriangle className="size-4" />} />
            <Kpi label="Negocios alta intención" value={fmtNum(totalIntencion)} icon={<Sparkles className="size-4" />} />
            <Kpi label="VPP activas (señal #1)" value={fmtNum(totalVPP)} tone="text-[--color-success]" icon={<Target className="size-4" />} />
            <Kpi label="Créditos sin firmar" value={fmtNum(totalSinFirmar)} tone="text-[--color-warning]" icon={<Info className="size-4" />} />
          </div>

          <Seccion titulo="Requieren atención" icon={<AlertTriangle className="size-4" />} color="var(--color-danger)" rows={atencion} />
          <Seccion titulo="Con oportunidad" icon={<Sparkles className="size-4" />} color="var(--color-success)" rows={oportunidad} />
          <Seccion titulo="Estables" icon={<Target className="size-4" />} color="var(--color-fg-dim)" rows={estables} />

          {/* Acciones recomendadas (agregado) */}
          {accionesAgg.length > 0 && (
            <section className="surface bg-white px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <Target className="size-4 text-[--color-accent]" />
                <h2 className="text-[14px] font-semibold tracking-tight text-[--color-fg]">Acciones recomendadas</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {accionesAgg.map(([id, n]) => (
                  <span key={id} className="inline-flex items-center gap-1.5 rounded-lg bg-[--color-bg-elev-3] px-3 py-1.5 text-[12px]">
                    <b className="text-[--color-accent]">{id}</b>
                    <span className="text-[--color-fg]">{ACCIONES[id]}</span>
                    <span className="text-[--color-fg-dim]">· {n} {n === 1 ? "modelo" : "modelos"}</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Limitaciones (honestas) */}
          <div className="text-[11px] text-[--color-fg-dim] leading-relaxed border-t border-[--color-border] pt-3">
            <b className="text-[--color-fg-muted]">Pendientes declarados:</b> RVM (mercado) y listas de precio no integrados ·
            escalera VPP fina (tasada / inspeccionada / carta de toma) vive en AutoRed, no en ROMA vivo — hoy solo VPP activa.
            Sin datos inventados.
          </div>
        </>
      )}
    </div>
  );
}
