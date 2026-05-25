import * as React from "react";
import { cn } from "@/lib/cn";

type Tone =
  | "default"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "critical"
  | "info"
  | "muted";

/** Subtle pill — Stripe/Linear style — minimal border, semi-transparent bg. */
const TONE: Record<Tone, string> = {
  default: "bg-[--color-bg-elev-3] text-[--color-fg] ring-1 ring-inset ring-[--color-border-strong]",
  accent: "bg-[--color-accent-dim] text-[--color-accent] ring-1 ring-inset ring-[--color-accent]/25",
  success: "bg-[--color-success-dim] text-[--color-success] ring-1 ring-inset ring-[--color-success]/20",
  warning: "bg-[--color-warning-dim] text-[--color-warning] ring-1 ring-inset ring-[--color-warning]/20",
  danger: "bg-[--color-danger-dim] text-[--color-danger] ring-1 ring-inset ring-[--color-danger]/20",
  critical: "bg-[--color-critical-dim] text-[#fca5a5] ring-1 ring-inset ring-[--color-critical]/30",
  info: "bg-[--color-info-dim] text-[--color-info] ring-1 ring-inset ring-[--color-info]/20",
  muted: "bg-[--color-bg-elev-2] text-[--color-fg-muted] ring-1 ring-inset ring-[--color-border]",
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
  size?: "xs" | "sm";
}

const SIZE: Record<NonNullable<BadgeProps["size"]>, string> = {
  xs: "px-1.5 py-0.5 text-[10px]",
  sm: "px-2 py-0.5 text-[11px]",
};

export function Badge({ tone = "default", dot, size = "sm", className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md font-medium whitespace-nowrap",
        SIZE[size],
        TONE[tone],
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            "size-1.5 rounded-full",
            tone === "default" || tone === "muted"
              ? "bg-[--color-fg-muted]"
              : tone === "accent"
                ? "bg-[--color-accent]"
                : tone === "success"
                  ? "bg-[--color-success]"
                  : tone === "warning"
                    ? "bg-[--color-warning]"
                    : tone === "danger"
                      ? "bg-[--color-danger]"
                      : tone === "critical"
                        ? "bg-[--color-critical]"
                        : "bg-[--color-info]",
          )}
        />
      )}
      {children}
    </span>
  );
}
