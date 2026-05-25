"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Bug, CheckCircle2, FileSpreadsheet, Layers, Table2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { EmptyState } from "@/components/ui/EmptyState";
import { useExcelStore } from "@/lib/store";
import { fmtCLP, fmtNum, fmtPct } from "@/lib/format";
import { computeResumenAppEstimado } from "@/lib/selectors/kpis";
import { cn } from "@/lib/cn";
import type { ResumenBlockKey } from "@/lib/types";

const BLOCK_LABEL: Record<ResumenBlockKey, string> = {
  stockAVitrinas: "Stock A vitrinas / Test Cars Propios",
  stockAPorFacturar: "Stock A por facturar",
  stockB: "Stock B",
  stockJudicial: "Stock Judicial",
  total: "Total general",
};

export default function DebugResumenPage() {
  const { data } = useExcelStore();
  const appResumen = useMemo(
    () => (data ? computeResumenAppEstimado(data.vehiculos) : null),
    [data],
  );

  if (!data) {
    return (
      <div className="p-8 max-w-3xl mx-auto fade-in">
        <Card variant="glass">
          <CardBody>
            <EmptyState
              icon={<Bug className="size-7" />}
              title="Debug · Resumen oficial"
              description="Estructura, merges, cell dump y comparación contra la pivot oficial. Carga un Excel para activarlo."
              action={
                <Link href="/" className="text-[--color-accent] text-sm">
                  ← Ir a la pantalla de inicio
                </Link>
              }
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  const resumen = data.resumenOficial;

  if (!resumen) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Card>
          <CardBody>
            <div className="flex items-start gap-3">
              <XCircle className="size-5 text-[--color-danger] mt-0.5" />
              <div>
                <div className="font-medium">No se pudo parsear la hoja</div>
                <div className="text-sm text-[--color-fg-muted] mt-1">
                  Revisa que la hoja &ldquo;Resumen Stock Propio&rdquo; exista en el archivo.
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  // Verificar coherencia: suma de bloques (no-total) vs gran total
  const sumInv = resumen.bloques.reduce((s, b) => s + b.inventario, 0);
  const sumAF = resumen.bloques.reduce((s, b) => s + b.activoFijo, 0);
  const sumTot = resumen.bloques.reduce((s, b) => s + b.total, 0);
  const totalRowMatches =
    resumen.totalRow &&
    Math.abs(sumInv - resumen.totalRow.inventario) < 1 &&
    Math.abs(sumAF - resumen.totalRow.activoFijo) < 1 &&
    Math.abs(sumTot - resumen.totalRow.total) < 1;

  return (
    <div className="p-8 space-y-6 max-w-[1400px] mx-auto fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-[--color-fg-muted] uppercase tracking-widest">
            <Bug className="size-3.5" />
            Debug · Resumen Stock Propio
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">
            Estructura real de la hoja oficial
          </h1>
          <p className="text-sm text-[--color-fg-muted] mt-1">
            Análisis quirúrgico: rango, merges, header detectado, bloques, dump de celdas y
            verificación de coherencia.
          </p>
        </div>
      </div>

      {/* Metadata de hoja */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="size-4 text-[--color-fg-muted]" />
            <CardTitle>Metadata de la hoja</CardTitle>
          </div>
          <CardDescription>
            Información estructural extraída antes de interpretar contenido.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat
              label="Rango (sheet[!ref])"
              value={<span className="mono text-base">{resumen.sheetRef}</span>}
              sub={`Filas ${resumen.rowStart}–${resumen.rowEnd}, Cols ${resumen.colStart}–${resumen.colEnd}`}
            />
            <Stat
              label="Header detectado"
              value={resumen.headerRow ? `Fila ${resumen.headerRow}` : "No encontrado"}
              sub={resumen.headerCells.filter(Boolean).join(" · ") || "—"}
              tone={resumen.headerRow ? "info" : "danger"}
            />
            <Stat
              label="Merges en la hoja"
              value={fmtNum(resumen.merges.length)}
              sub={
                resumen.merges.length === 0
                  ? "Sin celdas combinadas"
                  : resumen.merges.map((m) => `${m.s}:${m.e}`).join(", ")
              }
              tone={resumen.merges.length === 0 ? "success" : "info"}
            />
            <Stat
              label="Bloques detectados"
              value={`${resumen.bloques.length} + ${resumen.totalRow ? 1 : 0}`}
              sub={resumen.totalRow ? "incluyendo fila total" : "sin fila de total"}
              tone={resumen.bloques.length >= 4 ? "success" : "warning"}
            />
          </div>
        </CardBody>
      </Card>

      {/* Header detectado */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Layers className="size-4 text-[--color-fg-muted]" />
            <CardTitle>Header — columnas analíticas</CardTitle>
          </div>
          <CardDescription>
            Detectadas buscando las palabras &ldquo;Inventario&rdquo;, &ldquo;Activo Fijo&rdquo; y
            &ldquo;Total&rdquo; en alguna fila. NO se asume posición fija.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap gap-2">
            {resumen.headerCells.map((h, i) => (
              <Badge key={i} tone={h ? "info" : "muted"}>
                <span className="mono">
                  {String.fromCharCode(65 + resumen.colStart - 1 + i)}
                </span>
                {h ? ` · ${h}` : " · (vacío)"}
              </Badge>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Bloques con interpretación */}
      <Card>
        <CardHeader>
          <CardTitle>Bloques interpretados</CardTitle>
          <CardDescription>
            Cada fila del Excel se clasifica por contenido del label, no por posición. Las celdas
            origen se muestran a la izquierda.
          </CardDescription>
        </CardHeader>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead className="text-xs text-[--color-fg-muted] uppercase tracking-wider">
              <tr className="border-b border-[--color-border]">
                <th className="text-left font-medium px-5 py-2.5">Celda B</th>
                <th className="text-left font-medium px-5 py-2.5">Etiqueta literal</th>
                <th className="text-left font-medium px-5 py-2.5">Clasificación</th>
                <th className="text-right font-medium px-5 py-2.5">Inventario</th>
                <th className="text-right font-medium px-5 py-2.5">Activo Fijo</th>
                <th className="text-right font-medium px-5 py-2.5">Total (vendible)</th>
              </tr>
            </thead>
            <tbody>
              {resumen.bloques.map((b, i) => (
                <tr key={i} className="border-b border-[--color-border] last:border-0">
                  <td className="px-5 py-2 mono text-xs text-[--color-fg-muted]">
                    {b.labelCell}
                  </td>
                  <td className="px-5 py-2">{b.label}</td>
                  <td className="px-5 py-2">
                    <Badge tone="info">{BLOCK_LABEL[b.key]}</Badge>
                  </td>
                  <td className="px-5 py-2 text-right mono">
                    <span className="text-[--color-fg-muted] text-xs mr-1">{b.cells.inventario}</span>
                    {fmtCLP(b.inventario)}
                  </td>
                  <td className="px-5 py-2 text-right mono">
                    <span className="text-[--color-fg-muted] text-xs mr-1">{b.cells.activoFijo}</span>
                    {b.activoFijo ? fmtCLP(b.activoFijo) : "—"}
                  </td>
                  <td className="px-5 py-2 text-right mono">
                    <span className="text-[--color-fg-muted] text-xs mr-1">{b.cells.total}</span>
                    {fmtCLP(b.total)}
                  </td>
                </tr>
              ))}
              {resumen.totalRow && (
                <tr className="border-t-2 border-[--color-border-strong] bg-[--color-bg-elev-1]">
                  <td className="px-5 py-2.5 mono text-xs text-[--color-fg-muted]">
                    {resumen.totalRow.labelCell}
                  </td>
                  <td className="px-5 py-2.5 font-semibold">{resumen.totalRow.label}</td>
                  <td className="px-5 py-2.5">
                    <Badge tone="default">Total general</Badge>
                  </td>
                  <td className="px-5 py-2.5 text-right mono font-semibold">
                    {fmtCLP(resumen.totalRow.inventario)}
                  </td>
                  <td className="px-5 py-2.5 text-right mono font-semibold">
                    {fmtCLP(resumen.totalRow.activoFijo)}
                  </td>
                  <td className="px-5 py-2.5 text-right mono font-semibold text-[--color-accent]">
                    {fmtCLP(resumen.totalRow.total)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {/* Verificación de coherencia */}
      <Card>
        <CardHeader>
          <CardTitle>Verificación de coherencia interna</CardTitle>
          <CardDescription>
            La suma de los bloques debe coincidir con la fila de Total general del Excel.
          </CardDescription>
        </CardHeader>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead className="text-xs text-[--color-fg-muted] uppercase tracking-wider">
              <tr className="border-b border-[--color-border]">
                <th className="text-left font-medium px-5 py-2.5">Métrica</th>
                <th className="text-right font-medium px-5 py-2.5">Suma de bloques (app)</th>
                <th className="text-right font-medium px-5 py-2.5">Fila total (Excel)</th>
                <th className="text-right font-medium px-5 py-2.5">Δ</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Inventario", sumInv, resumen.totalRow?.inventario ?? 0],
                  ["Activo Fijo", sumAF, resumen.totalRow?.activoFijo ?? 0],
                  ["Total vendible", sumTot, resumen.totalRow?.total ?? 0],
                ] as [string, number, number][]
              ).map(([name, sum, official]) => {
                const diff = sum - official;
                const ok = Math.abs(diff) < 1;
                return (
                  <tr key={name} className="border-b border-[--color-border] last:border-0">
                    <td className="px-5 py-2.5">{name}</td>
                    <td className="px-5 py-2.5 text-right mono">{fmtCLP(sum)}</td>
                    <td className="px-5 py-2.5 text-right mono">{fmtCLP(official)}</td>
                    <td
                      className={cn(
                        "px-5 py-2.5 text-right mono",
                        ok ? "text-[--color-success]" : "text-[--color-danger]",
                      )}
                    >
                      {ok ? (
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 className="size-3.5" /> coincide
                        </span>
                      ) : (
                        fmtCLP(diff)
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-5 py-3 border-t border-[--color-border] text-xs">
            {totalRowMatches ? (
              <span className="text-[--color-success] inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" /> Los bloques cuadran exactamente con la fila
                de Total general del Excel.
              </span>
            ) : (
              <span className="text-[--color-warning]">
                Hay descalce entre suma de bloques y la fila total — revisar bloques no clasificados.
              </span>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Comparación contra app */}
      {appResumen && (
        <Card>
          <CardHeader>
            <CardTitle>Replica desde Base_Stock (app)</CardTitle>
            <CardDescription>
              Reconstruimos el resumen sumando <span className="mono">Costo Neto</span> desde
              Base_Stock con la misma definición de cada bloque.
            </CardDescription>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-[--color-fg-muted] uppercase tracking-wider">
                <tr className="border-b border-[--color-border]">
                  <th className="text-left font-medium px-5 py-2.5">Bloque</th>
                  <th className="text-right font-medium px-5 py-2.5">Oficial (Total)</th>
                  <th className="text-right font-medium px-5 py-2.5">App (Base_Stock)</th>
                  <th className="text-right font-medium px-5 py-2.5">Δ</th>
                  <th className="text-right font-medium px-5 py-2.5">Δ %</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Stock A vitrinas (vendible)", resumen.stockAVitrinasTotal, appResumen.stockAVitrinasNeto],
                    ["TESCAR Activo Fijo", resumen.stockAVitrinasActivoFijo, appResumen.tescarValor],
                    ["Stock A por facturar", resumen.stockAPorFacturar, appResumen.stockAPorFacturar],
                    ["Stock B", resumen.stockB, appResumen.stockB],
                    ["Stock Judicial", resumen.stockJudicial, appResumen.stockJudicial],
                    [
                      "TOTAL VENDIBLE",
                      resumen.granTotalVendible,
                      appResumen.stockAVitrinasNeto + appResumen.stockAPorFacturar + appResumen.stockB + appResumen.stockJudicial,
                    ],
                  ] as [string, number, number][]
                ).map(([name, official, app]) => {
                  const diff = app - official;
                  const pct = official !== 0 ? diff / official : 0;
                  const big = Math.abs(pct) > 0.05;
                  const isTotal = name === "TOTAL VENDIBLE";
                  return (
                    <tr
                      key={name}
                      className={cn(
                        "border-b border-[--color-border] last:border-0",
                        isTotal && "bg-[--color-bg-elev-1] font-medium",
                      )}
                    >
                      <td className="px-5 py-2.5">{name}</td>
                      <td className="px-5 py-2.5 text-right mono">{fmtCLP(official)}</td>
                      <td className="px-5 py-2.5 text-right mono">{fmtCLP(app)}</td>
                      <td
                        className={cn(
                          "px-5 py-2.5 text-right mono",
                          big ? "text-[--color-warning]" : "text-[--color-fg-muted]",
                        )}
                      >
                        {diff > 0 ? "+" : ""}
                        {fmtCLP(diff)}
                      </td>
                      <td
                        className={cn(
                          "px-5 py-2.5 text-right mono",
                          big ? "text-[--color-warning]" : "text-[--color-fg-muted]",
                        )}
                      >
                        {diff > 0 ? "+" : ""}
                        {fmtPct(pct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {/* Dump completo de celdas */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Table2 className="size-4 text-[--color-fg-muted]" />
            <CardTitle>Dump completo de celdas</CardTitle>
          </div>
          <CardDescription>
            Todas las celdas dentro del rango con su tipo, valor crudo (<span className="mono">.v</span>) y formato (<span className="mono">.w</span>). Tipos: <span className="mono">s</span>=string,{" "}
            <span className="mono">n</span>=number, <span className="mono">d</span>=date,{" "}
            <span className="mono">z</span>=empty, <span className="mono">e</span>=error.
          </CardDescription>
        </CardHeader>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead className="text-xs text-[--color-fg-muted] uppercase tracking-wider">
              <tr className="border-b border-[--color-border]">
                <th className="text-left font-medium px-5 py-2 mono">Celda</th>
                <th className="text-left font-medium px-5 py-2">Tipo</th>
                <th className="text-left font-medium px-5 py-2">Valor crudo (.v)</th>
                <th className="text-left font-medium px-5 py-2">Formato (.w)</th>
              </tr>
            </thead>
            <tbody>
              {resumen.cellDump.map((c) => (
                <tr key={c.addr} className="border-b border-[--color-border] last:border-0">
                  <td className="px-5 py-1.5 mono text-xs">{c.addr}</td>
                  <td className="px-5 py-1.5">
                    <Badge
                      tone={
                        c.type === "s"
                          ? "info"
                          : c.type === "n"
                            ? "success"
                            : c.type === "d"
                              ? "warning"
                              : "muted"
                      }
                    >
                      {c.type}
                    </Badge>
                  </td>
                  <td className="px-5 py-1.5 mono text-xs">
                    {c.value === null || c.value === undefined ? (
                      <span className="text-[--color-fg-dim] italic">empty</span>
                    ) : typeof c.value === "number" ? (
                      c.value.toLocaleString("es-CL")
                    ) : (
                      String(c.value)
                    )}
                  </td>
                  <td className="px-5 py-1.5 mono text-xs text-[--color-fg-muted]">
                    {c.formatted ?? <span className="text-[--color-fg-dim] italic">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {/* Grilla visual */}
      <Card>
        <CardHeader>
          <CardTitle>Vista en grilla</CardTitle>
          <CardDescription>
            Reproducción 1:1 de las celdas. Útil para confirmar visualmente que se está leyendo
            lo que ves en Excel.
          </CardDescription>
        </CardHeader>
        <CardBody className="overflow-x-auto">
          <Grid />
        </CardBody>
      </Card>
    </div>
  );
}

function Grid() {
  const { data } = useExcelStore();
  const resumen = data?.resumenOficial;
  if (!resumen) return null;

  const numCols = resumen.colEnd - resumen.colStart + 1;
  const numRows = resumen.rowEnd - resumen.rowStart + 1;

  // Build matrix [row][col] → cellDump entry
  const cellByKey = new Map(resumen.cellDump.map((c) => [`${c.row}-${c.col}`, c]));

  return (
    <table className="text-xs">
      <thead>
        <tr>
          <th className="px-2 py-1 text-right text-[--color-fg-dim] mono"></th>
          {Array.from({ length: numCols }).map((_, i) => (
            <th key={i} className="px-2 py-1 text-left text-[--color-fg-dim] mono">
              {String.fromCharCode(64 + resumen.colStart + i)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: numRows }).map((_, ri) => {
          const row = resumen.rowStart + ri;
          return (
            <tr key={ri}>
              <td className="px-2 py-1 text-right text-[--color-fg-dim] mono">{row}</td>
              {Array.from({ length: numCols }).map((_, ci) => {
                const col = resumen.colStart + ci;
                const cell = cellByKey.get(`${row}-${col}`);
                const v = cell?.value;
                const display =
                  v === null || v === undefined
                    ? ""
                    : typeof v === "number"
                      ? v.toLocaleString("es-CL")
                      : String(v);
                const isHeader = cell?.type === "s" && cell.row === resumen.headerRow;
                const isLabel = cell?.type === "s" && !isHeader;
                const isNum = cell?.type === "n";
                return (
                  <td
                    key={ci}
                    className={cn(
                      "px-3 py-1.5 border border-[--color-border] mono whitespace-nowrap",
                      isHeader && "bg-[--color-bg-elev-3] text-[--color-accent] font-medium",
                      isLabel && !isHeader && "text-[--color-fg]",
                      isNum && "text-right",
                    )}
                  >
                    {display}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
