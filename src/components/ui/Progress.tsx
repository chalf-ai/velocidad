import { cn } from "@/lib/cn";

type Tone = "accent" | "success" | "warning" | "danger" | "critical" | "info";

const FILL: Record<Tone, string> = {
  accent: "bg-[--color-accent]",
  success: "bg-[--color-success]",
  warning: "bg-[--color-warning]",
  danger: "bg-[--color-danger]",
  critical: "bg-[--color-critical]",
  info: "bg-[--color-info]",
};

export function Progress({
  value,
  tone = "accent",
  size = "md",
  className,
}: {
  /** 0-1 */
  value: number;
  tone?: Tone;
  size?: "sm" | "md";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(value, 1.5)) * 100;
  return (
    <div className={cn("progress-track", size === "sm" ? "h-1.5" : "h-2", className)}>
      <div
        className={cn("progress-fill rounded-full", FILL[tone])}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
      {pct > 100 && (
        <div
          className="absolute top-0 bottom-0 right-0 bg-[--color-critical] opacity-60"
          style={{ width: `${pct - 100}%` }}
        />
      )}
    </div>
  );
}
