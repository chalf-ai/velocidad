"use client";

import { useRef } from "react";
import { CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { useExcelStore } from "@/lib/store";
import { parseProvisionesFile } from "@/lib/parser/provisiones";
import { postSnapshot } from "@/lib/snapshot-client";
import { fmtNum } from "@/lib/format";

const PUEDE_SUBIR = new Set(["ADMIN", "GERENTE_GENERAL"]);

export function UploadProvisionesButton({ compact = false }: { compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    provisiones,
    provisionesLoading,
    provisionesError,
    setProvisiones,
    setProvisionesLoading,
    setProvisionesError,
    resetProvisiones,
  } = useExcelStore();
  const { data: session } = useSession();
  const rol = session?.user.rol;
  if (!rol || !PUEDE_SUBIR.has(rol)) return null;

  const onPick = () => inputRef.current?.click();

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProvisionesLoading(true);
    setProvisionesError(null);
    try {
      const parsed = await parseProvisionesFile(file);
      setProvisiones(parsed);
      try {
        await postSnapshot({
          nombre: file.name,
          tamano: file.size,
          fechaCorte: null,
          fuente: "PROVISIONES",
          payload: parsed,
          registros: parsed.report.filasProcesadas,
        });
      } catch (snapErr) {
        const detalle = snapErr instanceof Error ? snapErr.message : String(snapErr);
        console.error("[snapshot] PROVISIONES persistencia falló:", detalle);
        setProvisionesError(
          `⚠ Provisiones cargadas localmente, pero NO se persistieron al servidor. Otros usuarios NO verán este corte. Detalle: ${detalle}`,
        );
      }
    } catch (err) {
      console.error(err);
      setProvisionesError(err instanceof Error ? err.message : "Error al leer Provisiones");
    } finally {
      setProvisionesLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  if (compact) {
    return (
      <>
        <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.xls" className="hidden" onChange={onChange} />
        <Button variant="outline" size="sm" onClick={onPick} disabled={provisionesLoading}>
          {provisionesLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          {provisionesLoading ? "Procesando…" : provisiones ? "Reemplazar Provisiones" : "Cargar Provisiones"}
        </Button>
      </>
    );
  }

  return (
    <div className="surface bg-white px-5 py-4">
      <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.xls" className="hidden" onChange={onChange} />
      <div className="flex items-center gap-4">
        <div
          className={`size-10 rounded-xl grid place-items-center shrink-0 ${
            provisiones ? "bg-[--color-success-dim]" : "bg-[--color-bg-elev-2]"
          }`}
        >
          {provisiones ? (
            <CheckCircle2 className="size-5 text-[--color-success]" />
          ) : (
            <FileSpreadsheet className="size-5 text-[--color-fg-muted]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-[--color-fg]">
            Provisiones <span className="text-[--color-fg-dim]">(opcional)</span>
          </div>
          {provisiones ? (
            <div className="text-[12px] text-[--color-fg-muted] mt-0.5 truncate">
              {provisiones.report.archivoNombre} · {fmtNum(provisiones.registros.length)} registros
            </div>
          ) : (
            <div className="text-[12px] text-[--color-fg-muted] mt-0.5">
              Fuente oficial de capital de trabajo provisionado sin facturar.
            </div>
          )}
          {provisionesError && <div className="text-[12px] text-[--color-danger] mt-1">{provisionesError}</div>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="outline" size="sm" onClick={onPick} disabled={provisionesLoading}>
            {provisionesLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {provisionesLoading ? "Procesando…" : provisiones ? "Reemplazar" : "Cargar"}
          </Button>
          {provisiones && (
            <Button variant="ghost" size="sm" onClick={resetProvisiones} aria-label="Quitar archivo Provisiones">
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
