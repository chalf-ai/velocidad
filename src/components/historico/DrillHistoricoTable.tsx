"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download, Table2 } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import type { EntradaConsolidada } from "@/lib/historico/cruce-roma-actas";

interface Props {
  titulo: string;
  filas: EntradaConsolidada[];
  /**
   * Texto opcional que se antepone a "Conflicto / Razón" en cada fila y al
   * CSV exportado. Usado por drills donde la razón no viene de los
   * conflictos materiales sino del contexto del foco (ej. cobertura por
   * hito faltante: "Hito faltante: Sin patente recibida").
   */
  prefijoRazon?: string;
}

type SortKey =
  | "ventaId"
  | "vin"
  | "marca"
  | "sucursal"
  | "vendedor"
  | "fSolicitud"
  | "fFactura"
  | "fInscripcion"
  | "fEntregaReal"
  | "cuelloPrincipal"
  | "nivelDocumental"
  | "calidadCierre";

interface Columna {
  key: SortKey;
  label: string;
  align?: "left" | "right";
}

const COLUMNAS: Columna[] = [
  { key: "vin", label: "VIN" },
  { key: "ventaId", label: "VentaID", align: "right" },
  { key: "marca", label: "Marca" },
  { key: "sucursal", label: "Sucursal" },
  { key: "vendedor", label: "Vendedor" },
  { key: "fSolicitud", label: "fSolicitud" },
  { key: "fFactura", label: "fFactura" },
  { key: "fInscripcion", label: "fInscripción" },
  { key: "fEntregaReal", label: "fEntregaReal" },
  { key: "cuelloPrincipal", label: "Cuello" },
  { key: "nivelDocumental", label: "Cumplimiento" },
  { key: "calidadCierre", label: "Calidad cierre" },
];

const PAGE_SIZE = 50;

function dayStr(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

function valor(f: EntradaConsolidada, k: SortKey): string | number | null {
  switch (k) {
    case "ventaId": return f.ventaId;
    case "vin": return f.vin;
    case "marca": return f.marca ?? "";
    case "sucursal": return f.sucursal ?? "";
    case "vendedor": return f.vendedor ?? "";
    case "fSolicitud": return dayStr(f.fSolicitud);
    case "fFactura": return dayStr(f.fFactura);
    case "fInscripcion": return dayStr(f.fInscripcion);
    case "fEntregaReal": return dayStr(f.fEntregaReal);
    case "cuelloPrincipal": return f.cuelloPrincipal;
    case "nivelDocumental": return f.nivelDocumental;
    case "calidadCierre": return f.ejeCalidadCierre ?? "no_evaluable";
  }
}

function razonConflicto(f: EntradaConsolidada): string {
  const m = f.conflictos.find((c) => c.esMaterial);
  if (m) return m.detalle;
  const adv = f.conflictos[0];
  return adv ? `(advertencia) ${adv.detalle}` : "";
}

function combinarRazon(prefijo: string | undefined, base: string): string {
  if (!prefijo) return base;
  if (!base) return prefijo;
  return `${prefijo} · ${base}`;
}

export function DrillHistoricoTable({ titulo, filas, prefijoRazon }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("ventaId");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const arr = [...filas];
    arr.sort((a, b) => {
      const va = valor(a, sortKey);
      const vb = valor(b, sortKey);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filas, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const slice = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const handleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir("asc");
    }
    setPage(0);
  };

  const exportarCSV = () => {
    const headers = [...COLUMNAS.map((c) => c.label), "Conflicto / Razón"].join(",");
    const rows = sorted.map((f) =>
      [
        f.vin,
        f.ventaId ?? "",
        f.marca ?? "",
        f.sucursal ?? "",
        f.vendedor ?? "",
        dayStr(f.fSolicitud),
        dayStr(f.fFactura),
        dayStr(f.fInscripcion),
        dayStr(f.fEntregaReal),
        f.cuelloPrincipal,
        f.nivelDocumental,
        f.ejeCalidadCierre ?? "no_evaluable",
        `"${combinarRazon(prefijoRazon, razonConflicto(f)).replace(/"/g, '""')}"`,
      ].join(","),
    );
    const csv = [headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `drill-historico-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Table2 className="size-3.5 text-[--color-fg-muted]" />
            <span className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium">
              Drill
            </span>
            <span className="text-[13.5px] text-[--color-fg]">{titulo}</span>
            <Badge tone="muted" size="sm">
              {fmtNum(filas.length)} casos
            </Badge>
          </div>
          <Button variant="secondary" size="sm" onClick={exportarCSV} disabled={filas.length === 0}>
            <Download className="size-3.5" />
            Exportar CSV
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-[--color-bg-elev-2] text-[--color-fg-muted] text-[10.5px] uppercase tracking-wider">
              <tr>
                {COLUMNAS.map((c) => {
                  const active = sortKey === c.key;
                  return (
                    <th
                      key={c.key}
                      className={cn(
                        "px-2 py-2 font-medium whitespace-nowrap cursor-pointer hover:text-[--color-fg]",
                        c.align === "right" ? "text-right" : "text-left",
                      )}
                      onClick={() => handleSort(c.key)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.label}
                        {active &&
                          (sortDir === "asc" ? (
                            <ArrowUp className="size-3" />
                          ) : (
                            <ArrowDown className="size-3" />
                          ))}
                      </span>
                    </th>
                  );
                })}
                <th className="text-left px-2 py-2 font-medium whitespace-nowrap">Conflicto / Razón</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[--color-border-soft]">
              {slice.map((f, i) => {
                const razon = combinarRazon(prefijoRazon, razonConflicto(f));
                return (
                  <tr key={`${f.vin}-${f.ventaId ?? "x"}-${i}`} className="hover:bg-[--color-bg-elev-1]">
                    <td className="px-2 py-1.5 mono whitespace-nowrap">{f.vin}</td>
                    <td className="px-2 py-1.5 text-right mono">{f.ventaId ?? "—"}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{f.marca ?? "—"}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{f.sucursal ?? "—"}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{f.vendedor ?? "—"}</td>
                    <td className="px-2 py-1.5 mono">{dayStr(f.fSolicitud) || "—"}</td>
                    <td className="px-2 py-1.5 mono">{dayStr(f.fFactura) || "—"}</td>
                    <td className="px-2 py-1.5 mono">{dayStr(f.fInscripcion) || "—"}</td>
                    <td className="px-2 py-1.5 mono">{dayStr(f.fEntregaReal) || "—"}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{f.cuelloPrincipal}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{f.nivelDocumental}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{f.ejeCalidadCierre ?? "no_evaluable"}</td>
                    <td className="px-2 py-1.5 text-[11px] text-[--color-fg-muted] max-w-[280px] truncate" title={razon}>
                      {razon || "—"}
                    </td>
                  </tr>
                );
              })}
              {slice.length === 0 && (
                <tr>
                  <td colSpan={COLUMNAS.length + 1} className="text-center py-6 text-[--color-fg-dim] italic">
                    Sin casos en este drill.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-[11px] text-[--color-fg-muted]">
              Página {safePage + 1} de {totalPages}
            </span>
            <div className="flex gap-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage(Math.max(0, safePage - 1))}
                disabled={safePage === 0}
              >
                Anterior
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
                disabled={safePage >= totalPages - 1}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
