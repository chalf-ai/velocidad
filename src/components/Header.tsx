"use client";

import Link from "next/link";
import Image from "next/image";
import { Calendar, FileSpreadsheet, RotateCcw } from "lucide-react";
import { UploadButton } from "@/components/UploadButton";
import { MarcaFilterSelect } from "@/components/MarcaFilterSelect";
import { useExcelStore } from "@/lib/store";
import { fmtBytes, fmtDate } from "@/lib/format";

export function Header() {
  const { data, reset } = useExcelStore();

  return (
    <header className="flex h-18 w-full shrink-0 items-center gap-6 border-b border-[#2a4bc4] bg-[#3358e8] px-6">
      <Link href="/" className="flex shrink-0 items-center gap-3 transition hover:opacity-90">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white shadow-sm">
          <Image
            src="/pompeyo-menu-icon.png"
            alt="Pompeyo Carrasco"
            width={40}
            height={40}
            priority
            className="size-8"
          />
        </div>
        <div className="leading-tight">
          <div className="text-[14px] font-semibold tracking-tight text-white">Stock Command</div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-white/70">
            Pompeyo Carrasco
          </div>
        </div>
      </Link>

      <div className="hidden h-8 w-px shrink-0 bg-white/25 sm:block" />

      <div className="flex min-w-0 flex-1 items-center gap-5">
        {data ? (
          <>
            <div className="flex min-w-0 items-center gap-3">
              <FileSpreadsheet
                className="size-4.5 shrink-0 text-white/60"
                strokeWidth={1.75}
              />
              <span
                className="truncate text-[14px] font-medium text-white"
                title={data.report.archivoNombre}
              >
                {data.report.archivoNombre}
              </span>
              <span className="shrink-0 text-[12px] text-white/75">
                {fmtBytes(data.report.archivoSize)}
              </span>
            </div>

            {data.report.fechaCorteExcel && (
              <div className="hidden items-center gap-2 text-[13px] text-white/80 md:flex">
                <Calendar className="size-3.5 text-white/60" strokeWidth={1.75} />
                <span>Corte</span>
                <span className="mono text-white">{fmtDate(data.report.fechaCorteExcel)}</span>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2.5 text-[14px] text-white/80">
            <FileSpreadsheet className="size-4 text-white/60" strokeWidth={1.75} />
            Sin archivo cargado
          </div>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3.5">
        <MarcaFilterSelect onHeader />
        {data && (
          <button
            onClick={() => reset()}
            className="inline-flex items-center gap-1.5 text-[13px] text-white/80 hover:text-white"
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
