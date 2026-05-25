import * as React from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-[--color-accent] text-white hover:bg-[--color-accent-hi] border border-transparent shadow-[0_1px_2px_rgba(46,92,246,0.2),0_4px_12px_-4px_rgba(46,92,246,0.3)]",
  secondary:
    "bg-[--color-bg-elev-1] text-[--color-fg] border border-[--color-border-strong] hover:bg-[--color-bg-elev-3] hover:border-[--color-border-strong]",
  outline:
    "bg-transparent text-[--color-fg-muted] border border-[--color-border-strong] hover:text-[--color-fg] hover:bg-[--color-bg-elev-1]",
  ghost:
    "bg-transparent text-[--color-fg-muted] hover:text-[--color-fg] hover:bg-[--color-bg-elev-3] border border-transparent",
  danger:
    "bg-[--color-danger] text-white hover:brightness-110 border border-transparent",
};

const SIZE: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[12px] gap-1.5",
  md: "h-9 px-3.5 text-[13px] gap-2",
  lg: "h-11 px-5 text-[14px] gap-2",
};

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
>(function Button({ className, variant = "secondary", size = "md", ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...props}
    />
  );
});
