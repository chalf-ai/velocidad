"use client";

/**
 * Acción manual "Generar snapshot de hoy" — visible solo para roles con
 * permiso (decide el server al renderizarlo). Llama al endpoint y refresca
 * la página para que /tendencias muestre el punto del día.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2 } from "lucide-react";

export function GenerarSnapshotHoy() {
  const router = useRouter();
  const [estado, setEstado] = useState<"idle" | "corriendo" | "error">("idle");

  async function generar() {
    setEstado("corriendo");
    try {
      const res = await fetch("/api/snapshots/daily", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEstado("idle");
      router.refresh();
    } catch {
      setEstado("error");
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        onClick={generar}
        disabled={estado === "corriendo"}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[--color-border] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[--color-fg] hover:bg-[--color-bg-elev-2] disabled:opacity-60 transition-colors"
      >
        {estado === "corriendo" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Camera className="size-3.5" />
        )}
        Generar snapshot de hoy
      </button>
      {estado === "error" && (
        <span className="text-[12px] text-red-600">No se pudo generar — reintenta.</span>
      )}
    </div>
  );
}
