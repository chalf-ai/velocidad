"use client";

import { useRef } from "react";
import { CheckCircle2, Loader2, Truck, Upload, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { useExcelStore } from "@/lib/store";
import { parseLogisticaFile } from "@/lib/parser/logistica";
import { parseRomiaFile } from "@/lib/parser/romia-logistica";
import { postSnapshot } from "@/lib/snapshot-client";
import { fmtNum } from "@/lib/format";

const PUEDE_SUBIR = new Set(["ADMIN", "GERENTE_GENERAL"]);

/**
 * Uploader de archivos logísticos. Detecta automáticamente el tipo:
 *   - SCHIAPPACASSE / KAR-LOGISTICS  → modelo NUEVO ROMIA (prioridad)
 *   - Logistica.xlsx                  → modelo VIEJO STLI (fallback)
 *   - Diciembre-Mayo ROMA.xlsx        → modelo VIEJO ROMA (fallback)
 * Multi-file: aceptable subir varios en una sola operación.
 * Sin ninguno, el Centro de Acción funciona igual (sin dimensión logística).
 */
export function UploadLogisticaButton({ compact = false }: { compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    logisticaRoma,
    logisticaSTLI,
    romiaSchiapp,
    romiaKar,
    logisticaLoading,
    logisticaError,
    setLogisticaRoma,
    setLogisticaSTLI,
    setRomiaSchiapp,
    setRomiaKar,
    setLogisticaLoading,
    setLogisticaError,
    clearLogistica,
  } = useExcelStore();
  const { data: session } = useSession();
  const rol = session?.user.rol;
  if (!rol || !PUEDE_SUBIR.has(rol)) return null;

  const onPick = () => inputRef.current?.click();

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setLogisticaLoading(true);
    setLogisticaError(null);
    try {
      for (const file of files) {
        // 1) Intentar ROMIA primero (modelo nuevo). Si el archivo no es SCHIAPP
        // ni KAR, parseRomiaFile lanza — cae al catch interno para probar legacy.
        let manejadoComoRomia = false;
        try {
          const r = await parseRomiaFile(file);
          if (r.bodega === "SCHIAPP") setRomiaSchiapp(r.filas);
          else if (r.bodega === "KAR") setRomiaKar(r.filas);
          manejadoComoRomia = true;
          // No persistimos snapshots ROMIA aún (enum DB no soporta) — se hará en
          // próxima iteración cuando agreguemos ROMIA_SCHIAPP/ROMIA_KAR al schema.
          console.info(
            `[romia] ${r.bodega} cargado · ${r.filas.length} VINs · hojas: ${r.report.hojasProcesadas.join(", ")}`,
          );
        } catch {
          // No es ROMIA — caemos a legacy.
        }

        if (manejadoComoRomia) continue;

        // 2) Fallback legacy (Logistica.xlsx / Diciembre-Mayo ROMA)
        const parsed = await parseLogisticaFile(file);
        if (parsed.kind === "ROMA" && parsed.roma) {
          setLogisticaRoma(parsed.roma);
          try {
            await postSnapshot({
              nombre: file.name,
              tamano: file.size,
              fechaCorte: null,
              fuente: "LOGISTICA_ROMA",
              payload: parsed.roma,
              registros: parsed.roma.length,
            });
          } catch (snapErr) {
            const detalle = snapErr instanceof Error ? snapErr.message : String(snapErr);
            console.error("[snapshot] LOGISTICA_ROMA persistencia falló:", detalle);
            setLogisticaError(
              `⚠ Logística ROMA cargada localmente, pero NO se persistió al servidor. Otros usuarios NO verán este corte. Detalle: ${detalle}`,
            );
          }
        } else if (parsed.kind === "STLI" && parsed.stli) {
          setLogisticaSTLI(parsed.stli);
          try {
            await postSnapshot({
              nombre: file.name,
              tamano: file.size,
              fechaCorte: null,
              fuente: "LOGISTICA_STLI",
              payload: parsed.stli,
              registros: parsed.stli.length,
            });
          } catch (snapErr) {
            const detalle = snapErr instanceof Error ? snapErr.message : String(snapErr);
            console.error("[snapshot] LOGISTICA_STLI persistencia falló:", detalle);
            setLogisticaError(
              `⚠ Logística STLI cargada localmente, pero NO se persistió al servidor. Otros usuarios NO verán este corte. Detalle: ${detalle}`,
            );
          }
        }
      }
    } catch (err) {
      console.error(err);
      setLogisticaError(err instanceof Error ? err.message : "Error al leer archivo logístico");
    } finally {
      setLogisticaLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const cargados =
    (logisticaRoma ? 1 : 0) +
    (logisticaSTLI ? 1 : 0) +
    (romiaSchiapp ? 1 : 0) +
    (romiaKar ? 1 : 0);
  const resumen =
    cargados > 0
      ? [
          romiaSchiapp ? `SCHIAPP ${fmtNum(romiaSchiapp.length)}` : null,
          romiaKar ? `KAR ${fmtNum(romiaKar.length)}` : null,
          logisticaSTLI ? `STLI ${fmtNum(logisticaSTLI.length)} (legacy)` : null,
          logisticaRoma ? `ROMA ${fmtNum(logisticaRoma.length)} (legacy)` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;
  const tieneRomia = !!(romiaSchiapp || romiaKar);

  if (compact) {
    return (
      <>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm,.xls"
          multiple
          className="hidden"
          onChange={onChange}
        />
        <Button variant="outline" size="sm" onClick={onPick} disabled={logisticaLoading}>
          {logisticaLoading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Truck className="size-3.5" />
          )}
          {logisticaLoading
            ? "Procesando…"
            : cargados > 0
              ? `Logística · ${resumen}`
              : "Cargar logística"}
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
        multiple
        className="hidden"
        onChange={onChange}
      />
      <div className="flex items-center gap-4">
        <div
          className={`size-10 rounded-xl grid place-items-center shrink-0 ${
            tieneRomia ? "bg-[--color-success-dim]" : "bg-[--color-bg-elev-2]"
          }`}
        >
          {tieneRomia ? (
            <CheckCircle2 className="size-5 text-[--color-success]" />
          ) : (
            <Truck className="size-5 text-[--color-fg-muted]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-[--color-fg]">
            Logística <span className="text-[--color-fg-dim]">(SCHIAPP + KAR · nuevo · legacy opcional)</span>
          </div>
          <div className="text-[12px] text-[--color-fg-muted] mt-0.5 truncate">
            {resumen
              ? `Cargado: ${resumen}`
              : "Subí SCHIAPPCASSE y/o KAR-LOGISTICS. Los archivos viejos (Logistica.xlsx + Diciembre-Mayo ROMA) siguen aceptándose como fallback temporal."}
          </div>
          {logisticaError && (
            <div className="text-[12px] text-[--color-danger] mt-1">{logisticaError}</div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="outline" size="sm" onClick={onPick} disabled={logisticaLoading}>
            {logisticaLoading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            {logisticaLoading ? "Procesando…" : cargados > 0 ? "Agregar/Reemplazar" : "Cargar"}
          </Button>
          {cargados > 0 && (
            <Button variant="ghost" size="sm" onClick={clearLogistica} aria-label="Quitar logística">
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
