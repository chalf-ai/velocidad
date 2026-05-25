"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Acciones en el footer del sheet. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  side?: "right" | "left";
  /** Ancho en px. Default 440. */
  width?: number;
}

/** Drawer lateral premium para filtros, detalles, etc. */
export function Sheet({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  side = "right",
  width = 440,
}: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || typeof window === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      {/* Overlay */}
      <button
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-sm overlay-in cursor-default"
      />

      {/* Panel */}
      <div
        className={cn(
          "absolute top-0 bottom-0 bg-[--color-bg-elev-1] border-[--color-border] shadow-2xl flex flex-col slide-in-right",
          side === "right" ? "right-0 border-l" : "left-0 border-r",
        )}
        style={{ width: `${width}px`, maxWidth: "92vw" }}
      >
        {(title || description) && (
          <div className="px-6 pt-5 pb-4 border-b border-[--color-border]">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                {title && (
                  <h3 className="text-[15px] font-semibold tracking-tight text-[--color-fg]">
                    {title}
                  </h3>
                )}
                {description && (
                  <p className="text-[12.5px] text-[--color-fg-muted] mt-1 leading-relaxed">
                    {description}
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                className="size-7 rounded-md text-[--color-fg-muted] hover:text-[--color-fg] hover:bg-[--color-bg-elev-2] grid place-items-center shrink-0"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-[--color-border] flex items-center justify-end gap-2 bg-[--color-bg-elev-1]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
