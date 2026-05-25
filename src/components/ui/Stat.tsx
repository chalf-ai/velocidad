import * as React from "react";
import { cn } from "@/lib/cn";

interface StatProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "critical" | "info" | "accent";
  className?: string;
  title?: string;
  icon?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  onClick?: () => void;
  as?: "div" | "button";
}

const TONE_VALUE: Record<NonNullable<StatProps["tone"]>, string> = {
  default: "text-[--color-fg]",
  success: "text-[--color-success]",
  warning: "text-[--color-warning]",
  danger: "text-[--color-danger]",
  critical: "text-[--color-critical]",
  info: "text-[--color-info]",
  accent: "text-[--color-accent]",
};

const SIZE_VALUE: Record<NonNullable<StatProps["size"]>, string> = {
  sm: "text-[22px]",
  md: "text-[28px]",
  lg: "text-[34px]",
  xl: "text-[42px]",
};

const SIZE_PAD: Record<NonNullable<StatProps["size"]>, string> = {
  sm: "px-5 py-4",
  md: "px-6 py-5",
  lg: "px-6 py-6",
  xl: "px-7 py-7",
};

export function Stat({
  label,
  value,
  sub,
  tone = "default",
  className,
  title,
  icon,
  size = "md",
  onClick,
  as = "div",
}: StatProps) {
  const Component = as;
  const interactive = !!onClick;

  return (
    <Component
      onClick={onClick as React.MouseEventHandler<HTMLDivElement & HTMLButtonElement>}
      title={title}
      className={cn(
        "surface block text-left",
        SIZE_PAD[size],
        interactive && "surface-hover cursor-pointer",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.12em] text-[--color-fg-muted] font-medium">
        {icon && <span className="text-[--color-fg-dim]">{icon}</span>}
        {label}
      </div>
      <div className={cn("display mt-2.5 leading-none", SIZE_VALUE[size], TONE_VALUE[tone])}>
        {value}
      </div>
      {sub && (
        <div className="text-[12.5px] text-[--color-fg-muted] mt-2.5 leading-relaxed">{sub}</div>
      )}
    </Component>
  );
}
