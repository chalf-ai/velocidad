"use client";

/**
 * Cola gestionable por indicador del Score Gerencial · V2 visual.
 *
 * Cuatro modos según el tipo de fila:
 *   · stock_propio + cp_15d → VINs con AbrirCasoButton (regla R1).
 *   · provisiones_90d → provisiones con clave PROV-{id} + ficha grande (FilaProvision).
 *   · saldos_t3 → saldos vehículo · si tiene VIN → AbrirCasoButton,
 *                 si no → ficha grande FichaGestionDocumental con clave
 *                 SALDO-{numFactura}-{cajón} (FilaSaldoT3).
 *
 * Cero invenciones de datos. Reutiliza el sistema de gestión existente.
 *
 * Visual:
 *   · Header de la tabla con banda del color del indicador + ícono + badge
 *     "En meta / Brecha" + KPIs (N casos · $ retenido).
 *   · Filas zebra con hover suave.
 *   · Aging y tramos en `Badge` semántico (verde / ámbar / rojo).
 *   · Mismo lenguaje visual que los demás drills del sistema
 *     (`VinDrillTable`, /saldos, /provisiones).
 */

import { useMemo, useState } from "react";
import {
  Wallet,
  Receipt,
  Banknote,
  Truck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { fmtCLPCompact, fmtNum } from "@/lib/format";
import { AbrirCasoButton } from "@/components/AbrirCasoButton";
import { FichaGestionDocumental } from "@/components/FichaGestionDocumental";
import { limpiarVIN } from "@/lib/parser/venta-apc";
import { diasMaxCreditoPompeyoConFuente } from "@/lib/gestion/caso";
import { useGestionStore } from "@/lib/gestion/store";
import {
  ESTADO_GESTION_LABEL,
  ESTADO_GESTION_TONE,
} from "@/lib/gestion/types";
import type {
  ScoreGerencialResultado,
  IndicadorId,
  Indicador,
} from "@/lib/selectors/score-gerencial";
import type { VehiculoUnificado } from "@/lib/selectors/vehiculo-unificado";
import type { ProvisionRegistro, SaldoRegistro } from "@/lib/types";

const ICON_POR_INDICADOR: Record<IndicadorId, LucideIcon> = {
  stock_propio: Wallet,
  provisiones_90d: Receipt,
  cp_15d: Banknote,
  saldos_t3: Truck,
};

const MAX_FILAS = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Wrapper público — resuelve indicador desde el resultado y delega al modo.
// ─────────────────────────────────────────────────────────────────────────────

export function ColaIndicador({
  resultado,
  indicadorId,
}: {
  resultado: ScoreGerencialResultado;
  indicadorId: IndicadorId;
}) {
  const indicador = resultado.indicadores.find((i) => i.id === indicadorId);
  if (!indicador) return null;

  if (indicadorId === "stock_propio") {
    return (
      <ColaVins
        indicador={indicador}
        vus={resultado.drill.stockPropio}
        modo="stock"
      />
    );
  }
  if (indicadorId === "cp_15d") {
    return <ColaVins indicador={indicador} vus={resultado.drill.cp15d} modo="cp" />;
  }
  if (indicadorId === "provisiones_90d") {
    return (
      <ColaProvisiones
        indicador={indicador}
        provisiones={resultado.drill.provisiones90d}
      />
    );
  }
  return <ColaSaldosT3 indicador={indicador} saldos={resultado.drill.saldosT3} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shell común — header colorizado + cuerpo
// ─────────────────────────────────────────────────────────────────────────────

function ColaShell({
  indicador,
  totalCasos,
  totalMonto,
  totalMontoLabel = "retenido",
  empty,
  emptyHint,
  children,
}: {
  indicador: Indicador;
  totalCasos: number;
  totalMonto?: number;
  totalMontoLabel?: string;
  empty?: boolean;
  emptyHint?: string;
  children?: React.ReactNode;
}) {
  const Icon = ICON_POR_INDICADOR[indicador.id];
  // Tinte suave para el badge del ícono (12% del color).
  const tintBg = `${indicador.color}1F`;

  return (
    <div className="surface bg-white overflow-hidden">
      {/* Header colorizado */}
      <div className="flex items-stretch border-b border-[--color-border]">
        <div
          className="w-1 shrink-0"
          style={{ backgroundColor: indicador.color }}
        />
        <div className="flex-1 px-4 py-3 flex items-start gap-3">
          <div
            className="grid size-9 shrink-0 place-items-center rounded-md"
            style={{ backgroundColor: tintBg }}
          >
            <Icon
              className="size-4"
              style={{ color: indicador.color }}
              strokeWidth={2}
            />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13.5px] font-semibold tracking-tight text-[--color-fg]">
                {indicador.nombre}
              </span>
              <Badge
                tone={indicador.cumple ? "success" : "warning"}
                size="xs"
                dot
              >
                {indicador.cumple ? "En meta" : "Brecha"}
              </Badge>
              <span className="text-[10.5px] text-[--color-fg-dim]">
                · Meta {indicador.metaTexto.split(" del")[0]}
              </span>
            </div>
            <div className="text-[11.5px] text-[--color-fg-muted] mt-0.5">
              {indicador.accion}
            </div>
          </div>

          <div className="text-right shrink-0 whitespace-nowrap">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[--color-fg-dim] font-semibold">
              Casos · {totalMontoLabel}
            </div>
            <div className="text-[14px] font-bold mono text-[--color-fg] leading-tight mt-0.5">
              {fmtNum(totalCasos)}
              {totalMonto != null && (
                <>
                  {" · "}
                  <span className="text-[--color-danger]">
                    {fmtCLPCompact(totalMonto)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {empty ? (
        <div className="px-5 py-8 text-center">
          <CheckCircle2
            className="size-6 text-[--color-ok] mx-auto"
            strokeWidth={1.75}
          />
          <div className="mt-2 text-[12.5px] font-semibold text-[--color-fg]">
            Sin casos en este indicador
          </div>
          {emptyHint && (
            <div className="text-[11px] text-[--color-fg-muted] mt-0.5">
              {emptyHint}
            </div>
          )}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Badges semánticos compartidos
// ─────────────────────────────────────────────────────────────────────────────

/** Aging del CP / Stock — verde <umbral, ámbar <umbralAlto, rojo arriba. */
function AgingBadge({
  dias,
  umbralWarn = 15,
  umbralDanger = 30,
}: {
  dias: number | null;
  umbralWarn?: number;
  umbralDanger?: number;
}) {
  if (dias == null) {
    return (
      <Badge tone="muted" size="xs">
        Sin fecha
      </Badge>
    );
  }
  const tone =
    dias >= umbralDanger
      ? "danger"
      : dias >= umbralWarn
        ? "warning"
        : "success";
  return (
    <Badge tone={tone} size="xs">
      {dias}d
    </Badge>
  );
}

/** Tramo DPS de saldos — T3 / T4 / T5 con severidad creciente. */
function TramoBadge({ tramo }: { tramo: string }) {
  const tone =
    tramo === "T5" || tramo === "T6"
      ? "critical"
      : tramo === "T4"
        ? "danger"
        : tramo === "T3"
          ? "warning"
          : "muted";
  return (
    <Badge tone={tone} size="xs">
      {tramo}
    </Badge>
  );
}

// Helper para Marca · derivación desde sucursal si el campo viene vacío.
function marcaVisible(vu: VehiculoUnificado): string {
  if (vu.marca && vu.marca.trim()) return vu.marca;
  if (vu.marcaOriginadora && vu.marcaOriginadora.trim()) return vu.marcaOriginadora;
  // Fallback · primera palabra de la sucursal (KIA MELIPILLA → KIA).
  if (vu.sucursal) return vu.sucursal.split(/\s+/)[0];
  return "—";
}

// ─────────────────────────────────────────────────────────────────────────────
// Cola de VINs — usa misma estructura para stock_propio y cp_15d
// ─────────────────────────────────────────────────────────────────────────────

function ColaVins({
  indicador,
  vus,
  modo,
}: {
  indicador: Indicador;
  vus: VehiculoUnificado[];
  modo: "stock" | "cp";
}) {
  // Subscripción al store de gestión — refresca cuando cambia owner/estado
  // en cualquier ficha. Lookup O(1) por VIN al renderear filas.
  const gestionByVin = useGestionStore((s) => s.byVin);

  const totalMonto = useMemo(
    () =>
      vus.reduce(
        (s, vu) =>
          s + (modo === "cp" ? vu.creditoPompeyo : vu.capitalComprometido),
        0,
      ),
    [vus, modo],
  );

  const titulo =
    modo === "cp" ? "Crédito Pompeyo · > 15 días desde factura" : "VINs Stock Pagado";
  const origen =
    modo === "cp"
      ? "/score-gerencial · CP >15d"
      : "/score-gerencial · Stock pagado";

  if (vus.length === 0) {
    return (
      <ColaShell
        indicador={indicador}
        totalCasos={0}
        empty
        emptyHint={
          modo === "cp"
            ? "Sin CP >15 días — todos los VINs financiados están dentro del plazo."
            : "Sin VINs en Propio o FinPropio."
        }
      />
    );
  }

  return (
    <ColaShell
      indicador={indicador}
      totalCasos={vus.length}
      totalMonto={totalMonto}
      totalMontoLabel={modo === "cp" ? "retenido" : "capital"}
    >
      <div className="px-4 py-1.5 text-[11px] text-[--color-fg-muted] border-b border-[--color-border-soft] bg-[--color-bg-elev-1]/40">
        {titulo}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[1100px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-[0.05em] text-[--color-fg-muted] bg-[--color-bg-elev-1]">
              <th className="px-3 py-2 font-semibold">Marca / Modelo</th>
              <th className="px-3 py-2 font-semibold">VIN</th>
              <th className="px-3 py-2 font-semibold">Sucursal</th>
              <th className="px-3 py-2 font-semibold">Bodega</th>
              <th className="px-3 py-2 font-semibold text-right">
                {modo === "cp" ? "CP retenido" : "Capital"}
              </th>
              <th className="px-3 py-2 font-semibold text-right">Días stock</th>
              <th className="px-3 py-2 font-semibold">
                {modo === "cp" ? "Aging CP" : "Aging stock"}
              </th>
              <th className="px-3 py-2 font-semibold">Responsable / Físico</th>
              <th className="px-3 py-2 font-semibold">Estado</th>
              <th className="px-3 py-2 font-semibold">Gestión</th>
            </tr>
          </thead>
          <tbody>
            {vus.slice(0, MAX_FILAS).map((vu, idx) => {
              // Aging CP desde FECHA FACTURA; fallback a venta queda marcado.
              const cpInfo = modo === "cp" ? diasMaxCreditoPompeyoConFuente(vu) : null;
              const diasCP = cpInfo?.dias ?? null;
              const diasStock = vu.diasStock;
              const monto =
                modo === "cp" ? vu.creditoPompeyo : vu.capitalComprometido;
              const g = gestionByVin[vu.vinLimpio] ?? null;
              const fisico = chipFisicoSimple(vu);
              return (
                <tr
                  key={vu.vinLimpio}
                  className={cn(
                    "border-b border-[--color-border-soft] transition",
                    idx % 2 === 0
                      ? "bg-white hover:bg-[--color-bg-elev-1]/60"
                      : "bg-[--color-bg-elev-1]/30 hover:bg-[--color-bg-elev-1]/70",
                  )}
                >
                  <td className="px-3 py-2">
                    <div className="font-semibold text-[12.5px] text-[--color-fg]">
                      {marcaVisible(vu)}
                    </div>
                    <div className="text-[10.5px] text-[--color-fg-muted] truncate max-w-[200px]">
                      {vu.modelo ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 mono text-[11px] text-[--color-fg-muted] whitespace-nowrap">
                    {vu.vin}
                  </td>
                  <td className="px-3 py-2 text-[11.5px] text-[--color-fg-muted] truncate max-w-[160px]">
                    {vu.sucursal ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-[11.5px] text-[--color-fg-muted] truncate max-w-[160px]">
                    {vu.bodega ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right mono text-[--color-fg] font-semibold">
                    {fmtCLPCompact(monto)}
                  </td>
                  <td className="px-3 py-2 text-right mono text-[11.5px] text-[--color-fg-muted]">
                    {diasStock != null ? `${diasStock}d` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {modo === "cp" ? (
                      <span
                        className="inline-flex items-center gap-1"
                        title={
                          cpInfo?.fuente === "venta"
                            ? "Sin fecha factura registrada — aging medido desde fecha de venta (fallback)"
                            : "Aging medido desde fecha de factura"
                        }
                      >
                        <AgingBadge dias={diasCP} umbralWarn={15} umbralDanger={30} />
                        {cpInfo?.fuente === "venta" && (
                          <span className="text-[9.5px] text-amber-600 font-medium">venta*</span>
                        )}
                      </span>
                    ) : (
                      <AgingBadge dias={diasStock} umbralWarn={90} umbralDanger={180} />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-[11.5px] text-[--color-fg] truncate max-w-[150px]">
                      {g?.responsable ?? (
                        <span className="text-[--color-fg-dim] italic">Sin asignar</span>
                      )}
                    </div>
                    <Badge tone={fisico.tone} size="xs">
                      {fisico.label}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    {g ? (
                      <Badge tone={ESTADO_GESTION_TONE[g.estadoGestion]} size="xs">
                        {ESTADO_GESTION_LABEL[g.estadoGestion]}
                      </Badge>
                    ) : (
                      <Badge tone="muted" size="xs">
                        Sin gestionar
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <AbrirCasoButton vin={limpiarVIN(vu.vin)} origen={origen} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {vus.length > MAX_FILAS && (
        <div className="px-4 py-2 text-[11px] text-[--color-fg-muted] italic border-t border-[--color-border-soft] bg-[--color-bg-elev-1]/40">
          Mostrando primeros {fmtNum(MAX_FILAS)} de {fmtNum(vus.length)} casos · usa
          los filtros globales (marca / sucursal) para acotar más.
        </div>
      )}
    </ColaShell>
  );
}

/**
 * Chip físico simplificado para la cola del Score Gerencial.
 * Heurística rápida basada en `bodega` vs `sucursal` — la verdad física
 * EXACTA (con cruce FNE + logística) vive en la FichaOperacionalVIN cuando
 * se abre el caso. Acá solo informamos a primera vista dónde está el auto.
 */
function chipFisicoSimple(
  vu: VehiculoUnificado,
): { label: string; tone: "success" | "info" | "warning" | "muted" } {
  const b = (vu.bodega ?? "").toUpperCase().trim();
  const s = (vu.sucursal ?? "").toUpperCase().trim();
  if (!b) return { label: "Sin ubicación", tone: "muted" };
  // Bodega que empieza con "STOCK" o que comparte la primera palabra de la
  // sucursal → auto en sucursal de venta.
  const sFirst = s.split(/\s+/)[0];
  if (b.startsWith("STOCK") || (sFirst && b.includes(sFirst))) {
    return { label: "En sucursal", tone: "success" };
  }
  return { label: "En bodega", tone: "info" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cola de Provisiones >90d
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fila de provisión con GESTIÓN GRANDE estándar (regla gestión unificada
 * 2026-06): "Gestionar" expande la FichaGestionDocumental completa — misma
 * MesaGestionCaso + Asignar/Notificar del resto del sistema. Reemplaza al
 * popover chico GestionInline (que solo se mantiene para saldos/bonos).
 */
function FilaProvision({ p, idx }: { p: ProvisionRegistro; idx: number }) {
  const [casoAbierto, setCasoAbierto] = useState(false);
  return (
    <>
      <tr
        className={cn(
          "border-b border-[--color-border-soft] transition",
          idx % 2 === 0
            ? "bg-white hover:bg-[--color-bg-elev-1]/60"
            : "bg-[--color-bg-elev-1]/30 hover:bg-[--color-bg-elev-1]/70",
        )}
      >
        <td className="px-3 py-2">
          <div
            className="font-medium text-[--color-fg] truncate max-w-[300px]"
            title={p.concepto ?? undefined}
          >
            {p.concepto ?? "—"}
          </div>
        </td>
        <td className="px-3 py-2 text-[--color-fg-muted] truncate max-w-[160px]">
          {p.origen ?? "—"}
        </td>
        <td className="px-3 py-2">
          <AgingBadge dias={p.agingDias ?? null} umbralWarn={60} umbralDanger={90} />
        </td>
        <td className="px-3 py-2 text-right mono text-[--color-fg] font-semibold">
          {fmtCLPCompact(p.montoProvision)}
        </td>
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={() => setCasoAbierto((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold transition",
              casoAbierto
                ? "border-[--color-accent] bg-[--color-accent]/10 text-[--color-accent]"
                : "border-[--color-border-strong] bg-white text-[--color-fg] hover:bg-[--color-bg-elev-1]",
            )}
          >
            {casoAbierto ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {casoAbierto ? "Cerrar caso" : "Gestionar"}
          </button>
        </td>
      </tr>
      {casoAbierto && (
        <tr className="border-b border-[--color-border-soft]">
          <td colSpan={5} className="px-3 py-3 bg-[--color-bg-elev-1]/60">
            <FichaGestionDocumental
              clave={p.claveGestion}
              titulo={p.concepto ?? `Provisión ${p.claveGestion}`}
              subtitulo={[p.origen, p.periodo].filter(Boolean).join(" · ") || null}
              descripcionCaso={[p.concepto, p.origen].filter(Boolean).join(" · ") || null}
              datos={[
                { label: "Monto provisión", valor: fmtCLPCompact(p.montoProvision) },
                { label: "Aging", valor: p.agingDias != null ? `${p.agingDias}d` : "—" },
                { label: "Origen", valor: p.origen ?? "—" },
                { label: "Período", valor: p.periodo ?? "—" },
                { label: "Solicitante", valor: p.solicitante ?? "—" },
                { label: "Saldo", valor: fmtCLPCompact(p.saldo) },
              ]}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function ColaProvisiones({
  indicador,
  provisiones,
}: {
  indicador: Indicador;
  provisiones: ProvisionRegistro[];
}) {
  const total = useMemo(
    () => provisiones.reduce((s, p) => s + (p.montoProvision ?? 0), 0),
    [provisiones],
  );

  if (provisiones.length === 0) {
    return (
      <ColaShell
        indicador={indicador}
        totalCasos={0}
        empty
        emptyHint="Sin provisiones no facturadas > 90 días."
      />
    );
  }

  return (
    <ColaShell
      indicador={indicador}
      totalCasos={provisiones.length}
      totalMonto={total}
      totalMontoLabel="total"
    >
      <div className="px-4 py-1.5 text-[11px] text-[--color-fg-muted] border-b border-[--color-border-soft] bg-[--color-bg-elev-1]/40">
        Provisiones no facturadas con aging mayor a 90 días
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[680px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-[0.05em] text-[--color-fg-muted] bg-[--color-bg-elev-1]">
              <th className="px-3 py-2 font-semibold">Concepto</th>
              <th className="px-3 py-2 font-semibold">Origen</th>
              <th className="px-3 py-2 font-semibold">Aging</th>
              <th className="px-3 py-2 font-semibold text-right">Monto</th>
              <th className="px-3 py-2 font-semibold">Gestión</th>
            </tr>
          </thead>
          <tbody>
            {provisiones.slice(0, MAX_FILAS).map((p, idx) => (
              <FilaProvision key={p.claveGestion} p={p} idx={idx} />
            ))}
          </tbody>
        </table>
      </div>
      {provisiones.length > MAX_FILAS && (
        <div className="px-4 py-2 text-[11px] text-[--color-fg-muted] italic border-t border-[--color-border-soft] bg-[--color-bg-elev-1]/40">
          Mostrando primeros {fmtNum(MAX_FILAS)} de {fmtNum(provisiones.length)}{" "}
          provisiones.
        </div>
      )}
    </ColaShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cola de Saldos vehículo T3+
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fila de saldo T3+: con VIN → ficha VIN (AbrirCasoButton); sin VIN → GESTIÓN
 * GRANDE estándar (FichaGestionDocumental) con la MISMA clave SALDO-… que ya
 * persiste la gestión (no se cambia la clave). Reemplaza el popover GestionInline.
 */
function FilaSaldoT3({ s, idx }: { s: SaldoRegistro; idx: number }) {
  const [casoAbierto, setCasoAbierto] = useState(false);
  const vin = s.vinResuelto;
  const tieneVin = !!(vin && vin.length > 4);
  const claveSinVin = `SALDO-${s.numeroFactura ?? "X"}-${s.cajonLimpio ?? s.rowIndex}`;
  return (
    <>
      <tr
        className={cn(
          "border-b border-[--color-border-soft] transition",
          idx % 2 === 0
            ? "bg-white hover:bg-[--color-bg-elev-1]/60"
            : "bg-[--color-bg-elev-1]/30 hover:bg-[--color-bg-elev-1]/70",
        )}
      >
        <td className="px-3 py-2">
          {tieneVin ? (
            <div className="mono text-[11px] text-[--color-fg]">{vin}</div>
          ) : (
            <div className="text-[11.5px] text-[--color-fg-muted]">
              <span className="mono">Fac {s.numeroFactura ?? "—"}</span>
              <span className="text-[--color-fg-dim]"> · </span>
              <span className="mono">Caj {s.cajonLimpio ?? "—"}</span>
            </div>
          )}
        </td>
        <td className="px-3 py-2 text-[11.5px] text-[--color-fg-muted] truncate max-w-[160px]">
          {s.subTipo ?? "—"}
        </td>
        <td className="px-3 py-2">
          <TramoBadge tramo={s.statusDPS} />
        </td>
        <td className="px-3 py-2 text-right mono text-[--color-fg] font-semibold">
          {fmtCLPCompact(s.saldoXDocumentar)}
        </td>
        <td className="px-3 py-2">
          {tieneVin ? (
            <AbrirCasoButton vin={limpiarVIN(vin!)} origen="/score-gerencial · Saldos T3+" />
          ) : (
            <button
              type="button"
              onClick={() => setCasoAbierto((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold transition",
                casoAbierto
                  ? "border-[--color-accent] bg-[--color-accent]/10 text-[--color-accent]"
                  : "border-[--color-border-strong] bg-white text-[--color-fg] hover:bg-[--color-bg-elev-1]",
              )}
            >
              {casoAbierto ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              {casoAbierto ? "Cerrar caso" : "Gestionar"}
            </button>
          )}
        </td>
      </tr>
      {!tieneVin && casoAbierto && (
        <tr className="border-b border-[--color-border-soft]">
          <td colSpan={5} className="px-3 py-3 bg-[--color-bg-elev-1]/60">
            <FichaGestionDocumental
              clave={claveSinVin}
              titulo={`Saldo · ${s.numeroFactura ? `Fac ${s.numeroFactura}` : s.cajonLimpio ? `Caj ${s.cajonLimpio}` : "vehículo"}`}
              subtitulo={[s.subTipo, s.statusDPS].filter(Boolean).join(" · ") || null}
              descripcionCaso={s.subTipo ?? "Saldo vehículo"}
              datos={[
                { label: "Monto", valor: fmtCLPCompact(s.saldoXDocumentar) },
                { label: "Tramo DPS", valor: s.statusDPS ?? "—" },
                { label: "Sub-tipo", valor: s.subTipo ?? "—" },
                { label: "Factura", valor: s.numeroFactura != null ? String(s.numeroFactura) : "—" },
                { label: "Cajón", valor: s.cajonLimpio ?? "—" },
              ]}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function ColaSaldosT3({
  indicador,
  saldos,
}: {
  indicador: Indicador;
  saldos: SaldoRegistro[];
}) {
  const total = useMemo(
    () => saldos.reduce((s, r) => s + (r.saldoXDocumentar ?? 0), 0),
    [saldos],
  );

  if (saldos.length === 0) {
    return (
      <ColaShell
        indicador={indicador}
        totalCasos={0}
        empty
        emptyHint="Sin saldos vehículo en tramos T3 o superior."
      />
    );
  }

  return (
    <ColaShell
      indicador={indicador}
      totalCasos={saldos.length}
      totalMonto={total}
      totalMontoLabel="total"
    >
      <div className="px-4 py-1.5 text-[11px] text-[--color-fg-muted] border-b border-[--color-border-soft] bg-[--color-bg-elev-1]/40">
        Saldos vehículo en tramos T3+ ( &gt; 30 días desde vencimiento )
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[720px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-[0.05em] text-[--color-fg-muted] bg-[--color-bg-elev-1]">
              <th className="px-3 py-2 font-semibold">VIN / Documento</th>
              <th className="px-3 py-2 font-semibold">Sub-tipo</th>
              <th className="px-3 py-2 font-semibold">Tramo</th>
              <th className="px-3 py-2 font-semibold text-right">Saldo</th>
              <th className="px-3 py-2 font-semibold">Gestión</th>
            </tr>
          </thead>
          <tbody>
            {saldos.slice(0, MAX_FILAS).map((s, idx) => (
              <FilaSaldoT3 key={s.rowIndex} s={s} idx={idx} />
            ))}
          </tbody>
        </table>
      </div>
      {saldos.length > MAX_FILAS && (
        <div className="px-4 py-2 text-[11px] text-[--color-fg-muted] italic border-t border-[--color-border-soft] bg-[--color-bg-elev-1]/40">
          Mostrando primeros {fmtNum(MAX_FILAS)} de {fmtNum(saldos.length)} saldos.
        </div>
      )}
    </ColaShell>
  );
}
