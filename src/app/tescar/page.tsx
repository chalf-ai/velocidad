"use client";

/**
 * TESCAR — fuente oficial "Control TestCars" (TEST CARS + BDR). Renting/company/
 * VDR quedan fuera (otra lógica). Es capital de trabajo por MARCA originadora:
 * aging, capital, status, decisión de venta, propietario y drill por VIN.
 */

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { TestTube2 } from "lucide-react";
import { useVinContexto, VinContextoBanner } from "@/components/VinContexto";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { EmptyState } from "@/components/ui/EmptyState";
import { AbrirCasoButton } from "@/components/AbrirCasoButton";
import { useExcelStore } from "@/lib/store";
import { useMarcaFilter } from "@/lib/marca-filtro";
import { fmtCLP, fmtCLPCompact, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import { tescarStats } from "@/lib/selectors/tescar-operacional";

export default function TescarPage() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-[--color-fg-muted]">Cargando…</div>}>
      <TescarInner />
    </Suspense>
  );
}

function TescarInner() {
  const data = useExcelStore((s) => s.data);
  const marca = useMarcaFilter((s) => s.marca);
  const vinCtx = useVinContexto();
  const [marcaSel, setMarcaSel] = useState<string | null>(null);

  const stats = useMemo(
    () => (data ? tescarStats(data.tescarControl, marca) : null),
    [data, marca],
  );

  if (!data || !stats) {
    return (
      <div className="p-8 max-w-3xl mx-auto fade-in">
        <Card variant="glass">
          <CardBody>
            <EmptyState
              icon={<TestTube2 className="size-7" />}
              title="TESCAR"
              description="TEST CARS + BDR desde Control TestCars: capital de trabajo por marca. Carga el Excel para verlo."
              action={<Link href="/" className="text-[--color-accent] text-sm">← Ir al inicio</Link>}
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  // Detalle: por VIN (contexto), o por marca seleccionada, o todo.
  const detalle = vinCtx
    ? stats.rows.filter((r) => r.vinLimpio === vinCtx)
    : marcaSel
      ? stats.rows.filter((r) => r.marca?.toUpperCase().includes(marcaSel.split(" ")[0]) || marcaSel === "—")
      : stats.rows;

  return (
    <div className="max-w-[1400px] mx-auto px-8 py-8 space-y-6 fade-in">
      {/* Header */}
      <div className="surface top-strip strip-violet bg-white px-7 py-6">
        <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-[#7c3aed] font-semibold">
          <TestTube2 className="size-4" /> Fuente oficial · Control TestCars
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight text-[--color-fg] mt-1">
          TESCAR · capital de trabajo en demos
        </h1>
        <p className="text-[13px] text-[--color-fg-muted] mt-1 max-w-3xl leading-relaxed">
          Solo <b>Test Cars + BDR</b> (renting y company quedan aparte). Capital atribuido a la marca
          que originó el demo — consume caja aunque esté financiado.
          {marca && <span className="text-[#7c3aed] font-medium"> · filtro {marca}</span>}
        </p>
      </div>

      {vinCtx && (
        <VinContextoBanner
          vin={vinCtx}
          presentes={detalle.length}
          nota={detalle.length > 0 ? "demo TESCAR" : "este VIN no es TESCAR (Test Car / BDR)"}
        />
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="TESCAR total" value={fmtNum(stats.totalUnidades)} sub={`${fmtNum(stats.testCars)} test · ${fmtNum(stats.bdr)} BDR`} />
        <Stat label="Capital comprometido" value={fmtCLPCompact(stats.capitalTotal)} sub={fmtCLP(stats.capitalTotal)} />
        <Stat label="Aging promedio" value={`${stats.agingPromedio}d`} sub={`${fmtNum(stats.mas60)} sobre 60d`} />
        <Stat label="TESCAR > 180 días" value={fmtNum(stats.mas180)} sub={stats.capitalCritico > 0 ? `${fmtCLPCompact(stats.capitalCritico)} crítico` : "—"} />
        <Stat label="Marcas con TESCAR" value={fmtNum(stats.porMarca.length)} />
      </div>

      {/* Por marca */}
      <div className="surface bg-white px-6 py-5">
        <div className="text-[11px] uppercase tracking-[0.12em] text-[--color-fg-muted] font-semibold mb-3">
          TESCAR por marca · clic para filtrar el detalle
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5">
          {stats.porMarca.map((m) => {
            const sel = marcaSel === m.marca;
            return (
              <button
                key={m.marca}
                onClick={() => setMarcaSel(sel ? null : m.marca)}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left transition",
                  sel
                    ? "border-[#7c3aed] ring-2 ring-[#7c3aed]/25 bg-[#7c3aed]/[0.04]"
                    : "border-[--color-border-soft] bg-[--color-bg-elev-1] hover:border-[#7c3aed]/40",
                )}
              >
                <div className="text-[12px] font-semibold text-[--color-fg] truncate">{m.marca}</div>
                <div className="mono text-[14px] text-[--color-fg] mt-0.5">{fmtCLPCompact(m.capital)}</div>
                <div className="text-[10.5px] text-[--color-fg-muted] mt-0.5">
                  {fmtNum(m.unidades)} u · {m.agingPromedio}d prom
                  {m.mas180 > 0 && <span className="text-[--color-danger]"> · {m.mas180} +180d</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detalle / drill */}
      <div className="surface bg-white overflow-hidden">
        <div className="px-6 py-3 border-b border-[--color-border-soft] flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[13px] font-semibold text-[--color-fg]">
            Detalle TESCAR{marcaSel ? ` · ${marcaSel}` : ""} <span className="text-[--color-fg-muted] font-normal">({fmtNum(detalle.length)} u)</span>
          </div>
          {marcaSel && (
            <button onClick={() => setMarcaSel(null)} className="text-[11.5px] text-[--color-accent] hover:underline">
              Ver todas las marcas
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead className="text-[10.5px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1]">
              <tr>
                <Th>Marca / Modelo</Th>
                <Th>VIN</Th>
                <Th>Patente</Th>
                <Th>Sucursal</Th>
                <Th>Status</Th>
                <Th>Decisión</Th>
                <Th>Propietario</Th>
                <Th align="right">Días</Th>
                <Th align="right">Capital</Th>
                <Th>Caso</Th>
              </tr>
            </thead>
            <tbody>
              {detalle.slice(0, 300).map((r, idx) => {
                const dias = r.diasPrestamo;
                const diasColor = dias == null ? "text-[--color-fg-dim]" : dias > 180 ? "text-[--color-danger]" : dias > 60 ? "text-[--color-warning]" : "text-[--color-fg]";
                return (
                  <tr
                    key={`${r.vin}-${r.rowIndex}`}
                    className={cn("border-b border-[--color-border-soft] last:border-0", idx % 2 === 0 ? "bg-white hover:bg-[--color-bg-elev-1]" : "bg-[--color-bg-elev-1]/40")}
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-[12.5px] text-[--color-fg] flex items-center gap-1.5">
                        {r.marca ?? "—"}
                        <Badge tone={r.tipo === "bdr" ? "info" : "muted"} size="xs">{r.tipo === "bdr" ? "BDR" : "Test car"}</Badge>
                      </div>
                      <div className="text-[11px] text-[--color-fg-muted] truncate max-w-[200px]">{r.modelo ?? "—"}</div>
                    </td>
                    <td className="px-4 py-2.5 mono text-[11px] text-[--color-fg-muted]">{r.vinLimpio || "—"}</td>
                    <td className="px-4 py-2.5 mono text-[11px] text-[--color-fg]">{r.patente ?? "—"}</td>
                    <td className="px-4 py-2.5 text-[11.5px] text-[--color-fg-muted]">{r.sucursal ?? "—"}</td>
                    <td className="px-4 py-2.5 text-[11.5px] text-[--color-fg-muted]">{r.status ?? "—"}</td>
                    <td className="px-4 py-2.5 text-[11.5px] text-[--color-fg-muted]">{r.decisionVenta ?? "—"}</td>
                    <td className="px-4 py-2.5 text-[11.5px] text-[--color-fg-muted] truncate max-w-[140px]">{r.propietario ?? "—"}</td>
                    <td className={cn("px-4 py-2.5 text-right mono text-[12.5px]", diasColor)}>{dias != null ? `${dias}d` : "—"}</td>
                    <td className="px-4 py-2.5 text-right mono text-[12.5px] text-[--color-fg]">{fmtCLP(r.valorCompra)}</td>
                    <td className="px-4 py-2.5">
                      {r.vinLimpio.length === 17 ? (
                        <AbrirCasoButton vin={r.vinLimpio} origen={`TESCAR · ${r.marca ?? ""}`} />
                      ) : (
                        <span className="text-[10.5px] text-[--color-fg-dim] italic">sin VIN</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {detalle.length > 300 && (
            <div className="px-6 py-3 text-[11.5px] text-[--color-fg-muted] border-t border-[--color-border-soft]">
              Mostrando 300 de {fmtNum(detalle.length)}.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={cn("font-semibold px-4 py-2.5", align === "right" ? "text-right" : "text-left")}>{children}</th>;
}
