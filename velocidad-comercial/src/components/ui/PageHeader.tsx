import * as React from "react";
import { cn } from "@/lib/cn";

interface PageHeaderProps {
  kicker?: string;
  kickerIcon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ kicker, kickerIcon, title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4 flex-wrap", className)}>
      <div className="min-w-0">
        {kicker && (
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-[--color-accent] font-semibold">
            {kickerIcon}
            {kicker}
          </div>
        )}
        <h1 className="text-[26px] font-semibold tracking-tight mt-1.5 text-[--color-fg]">{title}</h1>
        {description && (
          <p className="text-[13.5px] text-[--color-fg-muted] mt-1.5 max-w-2xl leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
    </div>
  );
}
