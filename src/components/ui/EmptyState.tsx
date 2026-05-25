import * as React from "react";
import { cn } from "@/lib/cn";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  variant?: "default" | "compact" | "celebrate";
}

/** Empty state premium reutilizable para toda la app. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  variant = "default",
}: EmptyStateProps) {
  if (variant === "compact") {
    return (
      <div
        className={cn(
          "py-10 text-center text-[--color-fg-muted] fade-in",
          className,
        )}
      >
        {icon && (
          <div className="mx-auto mb-3 size-9 rounded-full bg-[--color-bg-elev-3] grid place-items-center text-[--color-fg-muted]">
            {icon}
          </div>
        )}
        <div className="text-sm">{title}</div>
        {description && (
          <div className="text-xs text-[--color-fg-dim] mt-1">{description}</div>
        )}
        {action && <div className="mt-3">{action}</div>}
      </div>
    );
  }

  if (variant === "celebrate") {
    return (
      <div
        className={cn(
          "py-12 text-center fade-in",
          className,
        )}
      >
        <div className="mx-auto mb-4 size-12 rounded-full bg-[--color-success-dim] grid place-items-center text-[--color-success]">
          {icon}
        </div>
        <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
        {description && (
          <p className="text-[13px] text-[--color-fg-muted] mt-1.5 max-w-md mx-auto leading-relaxed">
            {description}
          </p>
        )}
        {action && <div className="mt-5">{action}</div>}
      </div>
    );
  }

  return (
    <div className={cn("py-16 text-center fade-in", className)}>
      <div className="mx-auto mb-5 size-14 rounded-2xl bg-[--color-bg-elev-3] grid place-items-center text-[--color-fg-muted]">
        {icon}
      </div>
      <h3 className="text-base font-semibold tracking-tight text-[--color-fg]">{title}</h3>
      {description && (
        <p className="text-[13px] text-[--color-fg-muted] mt-2 max-w-md mx-auto leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
