"use client";

import { useRef } from "react";
import { Upload, Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { useExcelStore } from "@/lib/store";
import { parseExcelFile } from "@/lib/parser";
import { postSnapshot, serializeStockPayload } from "@/lib/snapshot-client";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const PUEDE_SUBIR = new Set(["ADMIN", "JEFE_STOCK"]);

export function UploadButton({ variant = "primary" }: { variant?: Variant }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { loading, setLoading, setError, setData } = useExcelStore();
  const { data: session } = useSession();
  const rol = session?.user.rol;

  // El upload sólo se ofrece a quienes pueden persistir snapshot. Los demás
  // usuarios verán el snapshot oficial vía el hidratador del AppShell.
  if (!rol || !PUEDE_SUBIR.has(rol)) return null;

  const onPick = () => inputRef.current?.click();

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const data = await parseExcelFile(file);
      setData(data);
      // Persistir snapshot oficial. Falla silenciosa: si rompe, el usuario
      // sigue con los datos en su sesión (sólo no se propagan a los demás).
      try {
        await postSnapshot({
          nombre: file.name,
          tamano: file.size,
          fechaCorte: data.report.fechaCorteExcel,
          fuente: "BASE_STOCK",
          payload: serializeStockPayload(data),
          registros: data.report.totalVehiculos,
        });
      } catch (snapErr) {
        console.warn("[snapshot] BASE_STOCK persistencia falló:", snapErr);
      }
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
