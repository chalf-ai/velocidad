"use client";

import { Lock, Sparkles, Upload } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { UploadButton } from "@/components/UploadButton";
import { useExcelStore } from "@/lib/store";

export function Landing() {
  const { error } = useExcelStore();

  return (
    <div className="min-h-[calc(100vh-3.5rem)] grid place-items-center px-8 py-16">
      <div className="w-full max-w-2xl">
        {/* Glow ambient */}
        <div className="relative">
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 size-[480px] rounded-full bg-[--color-accent] opacity-[0.08] blur-[120px] pointer-events-none" />
          <div className="absolute top-20 -right-20 size-[280px] rounded-full bg-[--color-info] opacity-[0.06] blur-[100px] pointer-events-none" />

          {/* Card hero */}
          <div className="relative glass rounded-3xl border border-[--color-border] p-12 text-center card-inset">
            <div className="mx-auto size-16 rounded-2xl bg-gradient-to-br from-[--color-accent] to-[--color-info] grid place-items-center mb-6 shadow-[0_12px_40px_-12px_var(--color-accent-glow)] animate-[fadeInUp_400ms_ease-out]">
              <Sparkles className="size-7 text-[#001a14]" strokeWidth={2.5} />
            </div>

            <div className="text-[10px] uppercase tracking-[0.22em] text-[--color-accent] font-semibold mb-2 animate-[fadeInUp_500ms_ease-out_60ms_backwards]">
              Pompeyo Carrasco · Stock Command Center
            </div>

            <h1 className="text-4xl font-semibold tracking-tight animate-[fadeInUp_500ms_ease-out_120ms_backwards]">
              <span className="gradient-text">Cockpit ejecutivo</span>
              <br />
              <span className="text-[--color-fg]">de tu operación</span>
            </h1>

            <p className="text-[15px] text-[--color-fg-muted] mt-4 max-w-md mx-auto leading-relaxed animate-[fadeInUp_500ms_ease-out_180ms_backwards]">
              Capital, líneas, FNE, VPP, TESCAR y alertas — todo lo que pasa con tu stock,
              en una sola vista clara.
            </p>

            <div className="mt-8 flex flex-col items-center gap-3 animate-[fadeInUp_500ms_ease-out_240ms_backwards]">
              <UploadButton variant="primary" />
              <div className="text-[11px] text-[--color-fg-dim] flex items-center gap-1.5">
                <Lock className="size-3" />
                Procesamiento local en tu navegador — nada se sube a un servidor
              </div>
            </div>

            {error && (
              <div className="mt-6 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[--color-danger-dim] text-[--color-danger] text-sm border border-[--color-danger]/30">
                {error}
              </div>
            )}
          </div>

          {/* Hojas que se leen */}
          <div className="text-center mt-8 animate-[fadeInUp_500ms_ease-out_320ms_backwards]">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[--color-fg-dim] mb-3">
              Hojas que se leen del reporte
            </div>
            <div className="flex flex-wrap justify-center gap-1.5">
              {[
                "Base_Stock",
                "3.-Lineas de Credito",
                "AUX Financiera Linea Autorizada",
                "Resumen Stock Propio",
                "TC CONTROL",
              ].map((h) => (
                <Badge key={h} tone="muted" size="xs" className="font-mono">
                  {h}
                </Badge>
              ))}
            </div>
            <div className="text-[11px] text-[--color-fg-dim] mt-5 max-w-md mx-auto leading-relaxed">
              Para activar el módulo{" "}
              <span className="text-[--color-fg-muted] font-medium">Facturados no entregados</span>
              {" "}también necesitas el archivo aparte{" "}
              <span className="font-mono text-[--color-fg-muted]">Autos no entregados.xlsx</span>{" "}
              — lo cargas desde dentro del módulo cuando entres.
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
