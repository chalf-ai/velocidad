"use client";

import { useRef } from "react";
import { CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { useExcelStore } from "@/lib/store";
import { parseFNEFile } from "@/lib/parser/autos-no-entregados";
import { postSnapshot } from "@/lib/snapshot-client";
import { fmtNum } from "@/lib/format";

const PUEDE_SUBIR = new Set(["ADMIN", "JEFE_STOCK"]);

/** Uploader del archivo "Autos no entregados.xlsx" — fuente oficial del módulo FNE.
 *  Se carga aparte del Excel maestro (Base_Stock). */
export function UploadFNEButton({ compact = false }: { compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { fne, fneLoading, fneError, setFNE, setFNELoading, setFNEError, resetFNE } =
    useExcelStore();
  const { data: session } = useSession();
  const rol = session?.user.rol;
  if (!rol || !PUEDE_SUBIR.has(rol)) return null;

  const onPick = () => inputRef.current?.click();

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFNELoading(true);
    setFNEError(null);
    try {
      const parsed = await parseFNEFile(file);
      setFNE(parsed);
      try {
        await postSnapshot({
          nombre: file.name,
          tamano: file.size,
          fechaCorte: null,
          fuente: "FNE",
          payload: parsed,
          registros: parsed.report.filasProcesadas,
        });
      } catch (snapErr) {
        const detalle = snapErr instanceof Error ? snapErr.message : String(snapErr);
        console.error("[snapshot] FNE persistencia falló:", detalle);
        setFNEError(
          `⚠ FNE cargado localmente, pero NO se persistió al servidor. Otros usuarios NO verán este corte. Detalle: ${detalle}`,
        );
      }
    } catch (err) {
      console.error(err);
      setFNEError(
        err instanceof Error ? err.message : "Error al leer Autos no entregados",
      );
    } finally {
      setFNELoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  if (compact) {
    return (
      <>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm,.xls"
          className="hidden"
          onChange={onChange}
        />
        <Button variant="outline" size="sm" onClick={onPick} disabled={fneLoading}>
          {fneLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          {fneLoading ? "Procesando…" : fne ? "Reemplazar FNE" : "Cargar Autos no entregados"}
        </Button>
      </>
    );
  }

  return (
    <div className="surface bg-white px-5 py-4">
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xlsm,.xls"
        className="hidden"
        onChange={onChange}
      />
      <div className="flex items-center gap-4">
        <div
          className={`size-10 rounded-xl grid place-items-center shrink-0 ${
            fne ? "bg-[--color-success-dim]" : "bg-[--color-bg-elev-2]"
          }`}
        >
          {fne ? (
            <CheckCircle2 className="size-5 text-[--color-success]" />
          ) : (
            <FileSpreadsheet className="size-5 text-[--color-fg-muted]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-[--color-fg]">
            Autos no entregados <span className="text-[--color-fg-dim]">(opcional)</span>
          </div>
          {fne ? (
            <div className="text-[12px] text-[--color-fg-muted] mt-0.5 truncate">
              {fne.report.archivoNombre} · {fmtNum(fne.registros.length)} registros
            </div>
          ) : (
            <div className="text-[12px] text-[--color-fg-muted] mt-0.5">
              Fuente oficial de FNE. Sin esto, el módulo FNE no se activa.
            </div>
          )}
          {fneError && (
            <div className="text-[12px] text-[--color-danger] mt-1">{fneError}</div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="outline" size="sm" onClick={onPick} disabled={fneLoading}>
            {fneLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {fneLoading ? "Procesando…" : fne ? "Reemplazar" : "Cargar"}
          </Button>
          {fne && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFNE}
              aria-label="Quitar archivo FNE"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
