"use client";

import { Calendar, FileSpreadsheet, RotateCcw } from "lucide-react";
import { UploadButton } from "@/components/UploadButton";
import { MarcaFilterSelect } from "@/components/MarcaFilterSelect";
import { useExcelStore } from "@/lib/store";
import { fmtBytes, fmtDate } from "@/lib/format";

export function Header() {
  const { data, reset } = useExcelStore();

  return (
    <header className="h-14 shrink-0 bg-white/80 backdrop-blur-md flex items-center px-6 gap-4 sticky top-0 z-30 border-b border-[--color-border]">
      {data ? (
        <>
          <div className="flex items-center gap-2.5 min-w-0">
            <FileSpreadsheet className="size-4 text-[--color-fg-dim] shrink-0" strokeWidth={1.75} />
            <span
              className="text-[13px] text-[--color-fg] truncate font-medium"
              title={data.report.archivoNombre}
            >
              {data.report.archivoNombre}
            </span>
            <span className="text-[11px] text-[--color-fg-dim]">
              {fmtBytes(data.report.archivoSize)}
            </span>
          </div>

          {data.report.fechaCorteExcel && (
            <div className="hidden md:flex items-center gap-1.5 text-[12px] text-[--color-fg-muted]">
              <Calendar className="size-3.5 text-[--color-fg-dim]" strokeWidth={1.75} />
              <span>Corte</span>
              <span className="text-[--color-fg] mono">
                {fmtDate(data.report.fechaCorteExcel)}
              </span>
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2 text-[13px] text-[--color-fg-dim]">
          <FileSpreadsheet className="size-4" strokeWidth={1.75} />
          Sin archivo cargado
        </div>
      )}

      <div className="ml-auto flex items-center gap-3">
        <MarcaFilterSelect />
        {data && (
          <button
            onClick={() => reset()}
            className="text-[12px] text-[--color-fg-muted] hover:text-[--color-fg] inline-flex items-center gap-1.5"
            title="Limpiar y cargar otro"
          >
            <RotateCcw className="size-3.5" />
            Reset
          </button>
        )}
        <UploadButton variant={data ? "secondary" : "primary"} />
      </div>
    </header>
  );
}
