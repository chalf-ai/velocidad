"use client";

/**
 * Bloque "Capital Propio Comprometido" (CPC) — Centro de Acción.
 *
 * Lectura ejecutiva de la caja propia inmovilizada en stock activo:
 * todos los VINs cuya inversión ya fue absorbida por Pompeyo
 * (tipoStock Propio / FinPropio / esPagado). NO mezcla floor plan ni
 * financiamiento de terceros — esos van con flag distinto.
 *
 * Decisión usuario 2026-06:
 *   · El UNIVERSO de la cola = TODOS los VINs CPC. Sin filtros por aging
 *     ni por meta. El gerente ve toda la caja propia inmovilizada.
 *   · La meta del 5% (= 5% × ventaPonderada$ de la marca activa) NO
 *     define el universo. Solo se usa para calcular el "potencial
 *     liberable" como métrica SECUNDARIA.
 *   · USADOS no excluye Stock B ni Judicial acá — esos también son
 *     caja propia inmovilizada. La exclusión vive SOLO en el indicador
 *     "Stock Propio ≤ 5%" del Score Gerencial.
 *
 * Drill: el botón "Ver todos los VIN pagados →" activa el tab del
 * comando `capital_propio` y hace scroll a la cola. Reutiliza la
 * infraestructura existente (ComandoCard → cola → AbrirCasoButton →
 * FichaOperacionalVIN). Cero código nuevo de cola/ficha.
 */

import { Wallet, AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";
import { fmtCLPCompact, fmtNum } from "@/lib/format";
import { ventaMensualPromedio, VENTANA_PONDERACION_LABEL } from "@/lib/ventas-q1";
import { cn } from "@/lib/cn";
import type { VehiculoUnificado } from "@/lib/selectors/vehiculo-unificado";

/** Filtro canónico del universo CPC — caja propia inmovilizada total.
 *
 *  Incluye tres señales complementarias:
 *    · tipoStock === "Propio"      → caja propia directa
 *    · tipoStock === "FinPropio"   → línea propia ya asumida
 *    · esPagado === true           → financiamiento de tercero ya CANCELADO
 *                                    (auto que entró como Financiado /
 *                                    FloorPlan / VuPorRecibir y que Pompeyo
 *                                    terminó de pagar). Suma 118 VINs y
 *                                    $2.175 MM respecto a usar solo tipoStock,
 *                                    medido sobre stock 31-05-2026.
 *
 *  Acá NO aplica la exclusión Stock B / Judicial para USADOS: medimos caja
 *  inmovilizada TOTAL, no el indicador de gestión gerencial. La exclusión
 *  sigue vigente solo en `score-gerencial.ts` (decisión 2026-06).
 *
 *  Score Gerencial NO cambia: su meta del 5% sigue calculada sobre
 *  tipoStock Propio/FinPropio. CPC es un universo más amplio para lectura
 *  ejecutiva de caja propia inmovilizada. */
export function esCapitalPropioComprometido(vu: VehiculoUnificado): boolean {
  if (!vu.enStockActivo) return false;
  return (
    vu.tipoStock === "Propio" ||
    vu.tipoStock === "FinPropio" ||
    vu.esPagado === true
  );
}

/** Meta de capital propio según la regla del 5% × venta ponderada de la marca. */
const META_PCT_STOCK_PROPIO = 0.05;

export interface CapitalPropioComprometidoBlockProps {
  /** Universo VU filtrado por marca/sucursal globales. */
  vus: VehiculoUnificado[];
  /** Marca operacional del filtro global (null = total Pompeyo). */
  marca: string | null;
  /** Callback: activa el tab `capital_propio` y scrollea a la cola. */
  onVerVins: () => void;
}

export function CapitalPropioComprometidoBlock({
  vus,
  marca,
  onVerVins,
}: CapitalPropioComprometidoBlockProps) {
  // ── Cálculo de métricas sobre el universo CPC ─────────────────────────
  const universoCPC = vus.filter(esCapitalPropioComprometido);
  const unidadesCPC = universoCPC.length;
  const capitalCPC = universoCPC.reduce((s, vu) => s + vu.capitalComprometido, 0);

  let sumDias = 0;
  let nConDias = 0;
  let maxDias = 0;
  for (const vu of universoCPC) {
    if (vu.diasStock != null && Number.isFinite(vu.diasStock)) {
      sumDias += vu.diasStock;
      nConDias++;
      if (vu.diasStock > maxDias) maxDias = vu.diasStock;
    }
  }
  const diasPromedio = nConDias > 0 ? sumDias / nConDias : null;

  // % sobre stock total (universo enStockActivo, sin filtro CPC)
  const unidadesStockTotal = vus.filter((vu) => vu.enStockActivo).length;
  const pctSobreStock =
    unidadesStockTotal > 0 ? (unidadesCPC / unidadesStockTotal) * 100 : null;

  // Venta ponderada → meta → potencial liberable
  const venta = ventaMensualPromedio(marca);
  const metaCapital = venta ? venta.monto * META_PCT_STOCK_PROPIO : null;
  const pctSobreVenta =
    venta && venta.monto > 0 ? (capitalCPC / venta.monto) * 100 : null;
  const potencialLiberable =
    metaCapital != null ? Math.max(0, capitalCPC - metaCapital) : null;
  const pctPotencialSobreCPC =
    potencialLiberable != null && capitalCPC > 0
      ? (potencialLiberable / capitalCPC) * 100
      : null;
  const enMeta = potencialLiberable != null && potencialLiberable === 0;

  const marcaLabel = marca ?? "Total Pompeyo";

  // ── Estado vacío ─────────────────────────────────────────────────────
  if (unidadesCPC === 0) {
    return (
      <section className="surface bg-white top-strip strip-info p-5">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-info] font-semibold flex items-center gap-2">
          <Wallet className="size-3.5" />
          Capital Propio Comprometido · {marcaLabel}
        </div>
        <p className="text-[12px] text-[--color-fg-muted] mt-1.5">
          Sin VINs en stock propio / pagado para los filtros actuales.
        </p>
      </section>
    );
  }

  return (
    <section className="surface bg-white top-strip strip-info p-5">
      {/* Header · mismo lenguaje visual que las cards del Hero (kicker uppercase
          + título + subtítulo). Antes era un card con gradient propio + icono
          en chip — se veía "de otro programa". Ahora respira con el resto. */}
      <div className="mb-4">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-info] font-semibold flex items-center gap-2">
          <Wallet className="size-3.5" />
          Capital Propio Comprometido · {marcaLabel}
        </div>
        <p className="text-[13px] text-[--color-fg-muted] mt-1.5 leading-snug max-w-2xl">
          Caja propia inmovilizada · ¿cuánta caja está detenida y dónde?
        </p>
      </div>

      {/* Grid de métricas primarias */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <MetricCell label="Unidades" value={fmtNum(unidadesCPC)} sub="VINs CPC" />
        <MetricCell label="Capital" value={fmtCLPCompact(capitalCPC)} sub="comprometido" />
        <MetricCell
          label="Días promedio"
          value={diasPromedio != null ? `${Math.round(diasPromedio)}d` : "—"}
          sub="retenido"
        />
        <MetricCell
          label="Días máximos"
          value={maxDias > 0 ? `${maxDias}d` : "—"}
          sub="retenido"
        />
      </div>

      {/* Grid de métricas contextuales (porcentajes) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <MetricCell
          label="% sobre stock total"
          value={pctSobreStock != null ? `${pctSobreStock.toFixed(1)}%` : "—"}
          sub={`${fmtNum(unidadesCPC)} de ${fmtNum(unidadesStockTotal)} VINs en stock activo`}
        />
        <MetricCell
          label="% sobre venta ponderada"
          value={pctSobreVenta != null ? `${pctSobreVenta.toFixed(1)}%` : "—"}
          sub={
            venta
              ? `${fmtCLPCompact(capitalCPC)} sobre ${fmtCLPCompact(venta.monto)} (${VENTANA_PONDERACION_LABEL})`
              : "Sin venta ponderada para la marca"
          }
        />
      </div>

      {/* Potencial liberable (secundario) · fondos sólidos sin /60 /40 para
          que el bloque sea visible sobre el outer bg-white. Antes los fondos
          con transparencia se diluían y dejaban un rectángulo casi vacío. */}
      <div
        className={cn(
          "rounded-xl border px-4 py-3 mb-4",
          enMeta
            ? "border-emerald-200 bg-emerald-50"
            : potencialLiberable != null
              ? "border-amber-200 bg-amber-50"
              : "border-[--color-border] bg-[--color-bg-elev-2]",
        )}
      >
        <div className="flex items-center gap-2 mb-1.5">
          {enMeta ? (
            <CheckCircle2 className="size-4 text-[--color-ok]" />
          ) : (
            <AlertTriangle
              className={cn(
                "size-4",
                potencialLiberable != null
                  ? "text-[--color-warning]"
                  : "text-[--color-fg-dim]",
              )}
            />
          )}
          <div className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-[--color-fg-muted]">
            Potencial liberable para meta 5%
          </div>
          <span className="ml-auto text-[9.5px] text-[--color-fg-dim] italic">
            métrica secundaria · no filtra la cola
          </span>
        </div>

        {potencialLiberable != null ? (
          enMeta ? (
            <div className="text-[12.5px] text-[--color-fg]">
              <span className="font-semibold text-[--color-ok]">En meta ✓</span>{" "}
              · sin brecha. CPC ({fmtCLPCompact(capitalCPC)}) está debajo de la
              meta {fmtCLPCompact(metaCapital ?? 0)}.
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-[22px] font-bold leading-none mono text-[--color-fg]">
                  {fmtCLPCompact(potencialLiberable)}
                </span>
                {pctPotencialSobreCPC != null && (
                  <span className="text-[12px] text-[--color-fg-muted]">
                    {pctPotencialSobreCPC.toFixed(1)}% del CPC
                  </span>
                )}
              </div>
              <div className="text-[11px] text-[--color-fg-muted] mt-1 leading-snug">
                Meta = 5% × {fmtCLPCompact(venta?.monto ?? 0)} (venta pond. {marcaLabel}){" "}
                = <span className="font-semibold text-[--color-fg]">{fmtCLPCompact(metaCapital ?? 0)}</span>.
                Esta es la caja que volvería a estar disponible para volver a la meta.
              </div>
            </>
          )
        ) : (
          <div className="text-[12px] text-[--color-fg-muted] italic">
            Sin venta ponderada para {marcaLabel} — no hay denominador para calcular la meta.
          </div>
        )}
      </div>

      {/* CTA · Ver todos los VINs.
          NOTA: usar bg-[color:var(--color-X)] (no bg-[--color-X]). La segunda
          forma NO resuelve la custom property en Tailwind v4 — queda transparente
          y el texto blanco se vuelve invisible. Mismo patrón documentado en
          FunnelHitosFactura.tsx:41 y ResumenEjecutivoProceso.tsx. */}
      <button
        type="button"
        onClick={onVerVins}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-[12.5px] font-semibold",
          "bg-[color:var(--color-accent)] text-white hover:opacity-90 transition",
          "shadow-sm",
        )}
      >
        Ver todos los VIN pagados
        <ArrowRight className="size-3.5" />
        <span className="text-[10.5px] font-normal opacity-80 ml-1">
          · {fmtNum(unidadesCPC)} VINs · {fmtCLPCompact(capitalCPC)}
        </span>
      </button>
    </section>
  );
}

// ─── Subcomponente · celda de métrica ───────────────────────────────────

function MetricCell({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-[--color-border] bg-[--color-bg-elev-2] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.08em] text-[--color-fg-dim] font-semibold mb-1">
        {label}
      </div>
      <div className="text-[18px] font-bold leading-none mono text-[--color-fg]">
        {value}
      </div>
      {sub && (
        <div className="text-[10.5px] text-[--color-fg-muted] mt-1 leading-snug">
          {sub}
        </div>
      )}
    </div>
  );
}
