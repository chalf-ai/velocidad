"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtCLPCompact } from "@/lib/format";

export function CreditoPompeyoBadge({
  tiene,
  monto = 0,
  compact = false,
}: {
  tiene: boolean;
  monto?: number;
  compact?: boolean;
}) {
  if (tiene) {
    return (
      <span
        title={`Crédito Pompeyo activo · ${fmtCLPCompact(monto)}`}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border font-medium",
          "bg-[--color-danger]/12 text-[--color-danger] border-[--color-danger]/30",
          compact ? "px-1.5 py-0.5 text-[10.5px]" : "px-2 py-1 text-[11px]",
        )}
      >
        <AlertCircle className="size-3" strokeWidth={2.5} />
        C. Pompeyo {fmtCLPCompact(monto)}
      </span>
    );
  }
  return (
    <span
      title="Sin Crédito Pompeyo — financieramente listo"
      className={cn(
        "inline-flex items-center gap-1 rounded-md border font-medium",
        "bg-[--color-success]/10 text-[--color-success] border-[--color-success]/25",
        compact ? "px-1.5 py-0.5 text-[10.5px]" : "px-2 py-1 text-[11px]",
      )}
    >
      <CheckCircle2 className="size-3" strokeWidth={2.5} />
      Sin C.P.
    </span>
  );
}
