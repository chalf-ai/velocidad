"use client";

import { useRef } from "react";
import { Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useExcelStore } from "@/lib/store";
import { parseExcelFile } from "@/lib/parser";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function UploadButton({ variant = "primary" }: { variant?: Variant }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { loading, setLoading, setError, setData } = useExcelStore();

  const onPick = () => inputRef.current?.click();

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const data = await parseExcelFile(file);
      setData(data);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Error desconocido al leer el archivo");
    } finally {
      setLoading(false);
      // permitir re-cargar el mismo archivo
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xlsm,.xls"
        className="hidden"
        onChange={onChange}
      />
      <Button variant={variant} onClick={onPick} disabled={loading}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {loading ? "Procesando…" : "Cargar Excel"}
      </Button>
    </>
  );
}
