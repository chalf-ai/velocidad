"use client";

import { useRef } from "react";
import { CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { useExcelStore } from "@/lib/store";
import { parseSaldosFile } from "@/lib/parser/saldos";
import { postSnapshot } from "@/lib/snapshot-client";
import { fmtNum } from "@/lib/format";

const PUEDE_SUBIR = new Set(["ADMIN", "JEFE_STOCK"]);

export function UploadSaldosButton({ compact = false }: { compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { saldos, saldosLoading, saldosError, setSaldos, setSaldosLoading, setSaldosError, resetSaldos } =
    useExcelStore();
  const { data: session } = useSession();
  const rol = session?.user.rol;
  if (!rol || !PUEDE_SUBIR.has(rol)) return null;

  const onPick = () => inputRef.current?.click();

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaldosLoading(true);
    setSaldosError(null);
    try {
      const parsed = await parseSaldosFile(file);
      setSaldos(parsed);
      try {
        await postSnapshot({
          nombre: file.name,
          tamano: file.size,
          fechaCorte: null,
          fuente: "SALDOS",
          payload: parsed,
          registros: parsed.report.filasProcesadas,
        });
      } catch (snapErr) {
        const detalle = snapErr instanceof Error ? snapErr.message : String(snapErr);
        console.error("[snapshot] SALDOS persistencia falló:", detalle);
        setSaldosError(
          `⚠ Saldos cargados localmente, pero NO se persistieron al servidor. Otros usuarios NO verán este corte. Detalle: ${detalle}`,
        );
      }
    } catch (err) {
      console.error(err);
      setSaldosError(err instanceof Error ? err.message : "Error al leer Reportes Saldos");
    } finally {
      setSaldosLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  if (compact) {
    return (
      <>
        <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.xls" className="hidden" onChange={onChange} />
        <Button variant="outline" size="sm" onClick={onPick} disabled={saldosLoading}>
          {saldosLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          {saldosLoading ? "Procesando…" : saldos ? "Reemplazar Saldos" : "Cargar Reportes Saldos"}
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
            saldos ? "bg-[--color-success-dim]" : "bg-[--color-bg-elev-2]"
          }`}
        >
          {saldos ? (
            <CheckCircle2 className="size-5 text-[--color-success]" />
          ) : (
            <FileSpreadsheet className="size-5 text-[--color-fg-muted]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-[--color-fg]">
            Reportes Saldos 2.0 <span className="text-[--color-fg-dim]">(opcional)</span>
          </div>
          {saldos ? (
            <div className="text-[12px] text-[--color-fg-muted] mt-0.5 truncate">
              {saldos.report.archivoNombre} · {fmtNum(saldos.registros.length)} registros
            </div>
          ) : (
            <div className="text-[12px] text-[--color-fg-muted] mt-0.5">
              Fuente oficial de Saldos y Capital de Trabajo no-vehicular.
            </div>
          )}
          {saldosError && <div className="text-[12px] text-[--color-danger] mt-1">{saldosError}</div>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="outline" size="sm" onClick={onPick} disabled={saldosLoading}>
            {saldosLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {saldosLoading ? "Procesando…" : saldos ? "Reemplazar" : "Cargar"}
          </Button>
          {saldos && (
            <Button variant="ghost" size="sm" onClick={resetSaldos} aria-label="Quitar archivo Saldos">
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
