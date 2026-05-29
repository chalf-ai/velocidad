"use client";

import { useRef, useState } from "react";
import { UploadCloud, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import {
  procesarArchivos,
  limpiarTodo,
} from "@/lib/historico/cargar-archivos-cliente";
import { useHistoricoStore } from "@/lib/historico/store-cliente";

/**
 * Dropzone para los 7 archivos del histórico: 5 ROMA + Actas + SCHIAPP + KAR.
 * Detecta el tipo por nombre. Procesa secuencial (los Excel son grandes).
 */
export function HistoricoUploader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const progreso = useHistoricoStore((s) => s.progreso);

  const onFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    await procesarArchivos(arr);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) void onFiles(e.dataTransfer.files);
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) void onFiles(e.target.files);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={cn(
        "surface rounded-2xl border-2 border-dashed transition p-8 text-center",
        dragOver
          ? "border-[--color-accent] bg-[--color-accent-dim]"
          : "border-[--color-border-strong]",
      )}
    >
      <div className="mx-auto mb-3 size-12 rounded-full bg-[--color-bg-elev-3] grid place-items-center text-[--color-fg-muted]">
        {progreso.enCurso ? <Loader2 className="size-5 animate-spin" /> : <UploadCloud className="size-5" />}
      </div>
      <div className="text-[14px] font-medium text-[--color-fg]">
        {progreso.enCurso
          ? `Procesando ${progreso.procesados + 1}/${progreso.total} — ${progreso.archivoActual ?? ""}`
          : "Arrastra los archivos del histórico aquí"}
      </div>
      <div className="text-[12px] text-[--color-fg-muted] mt-1.5">
        5 ROMA (LOG Enero/Febrero/Marzo/Abril/Mayo) · Actas · SCHIAPPCASSE · KAR-LOGISTICS
      </div>
      <div className="mt-4 flex items-center justify-center gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={progreso.enCurso}
        >
          Elegir archivos
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={limpiarTodo}
          disabled={progreso.enCurso}
        >
          Limpiar todo
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".xlsx,.xls"
          className="hidden"
          onChange={onChange}
        />
      </div>
    </div>
  );
}
