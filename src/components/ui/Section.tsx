import * as React from "react";
import { cn } from "@/lib/cn";

interface SectionProps {
  kicker?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}

export function Section({ kicker, title, description, right, className }: SectionProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4 flex-wrap", className)}>
      <div>
        {kicker && (
          <div className="text-[10px] uppercase tracking-[0.18em] text-[--color-accent] font-semibold mb-2">
            {kicker}
          </div>
        )}
        <h2 className="text-[18px] font-semibold tracking-tight text-[--color-fg]">{title}</h2>
        {description && (
          <p className="text-[13px] text-[--color-fg-muted] mt-1 leading-relaxed max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
