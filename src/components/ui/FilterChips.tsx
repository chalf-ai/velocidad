"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

interface FilterChipsProps<T extends string> {
  label: string;
  options: { value: T; label?: string; count?: number }[];
  value: T[];
  onChange: (next: T[]) => void;
  /** Si excede este tamaño, agrega buscador interno. Default 12. */
  searchAfter?: number;
  className?: string;
}

export function FilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
  searchAfter = 12,
  className,
}: FilterChipsProps<T>) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    if (!q.trim()) return options;
    const needle = q.toLowerCase();
    return options.filter(
      (o) =>
        o.value.toString().toLowerCase().includes(needle) ||
        (o.label ?? "").toLowerCase().includes(needle),
    );
  }, [options, q]);

  const toggle = (v: T) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium">
          {label}
        </span>
        {value.length > 0 && (
          <button
            onClick={() => onChange([])}
            className="text-[10px] text-[--color-fg-dim] hover:text-[--color-fg-muted] inline-flex items-center gap-0.5"
          >
            <X className="size-2.5" /> limpiar
          </button>
        )}
      </div>
      {options.length > searchAfter && (
        <div className="relative">
          <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[--color-fg-dim]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filtrar…"
            className="w-full text-xs pl-7 pr-2 py-1 rounded-md bg-[--color-bg-elev-1] border border-[--color-border] focus:border-[--color-accent] outline-none"
          />
        </div>
      )}
      <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto pr-1">
        {filtered.map((o) => {
          const active = value.includes(o.value);
          return (
            <button
              key={o.value}
              onClick={() => toggle(o.value)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11.5px] border transition whitespace-nowrap font-medium",
                active
                  ? "bg-[--color-accent] border-[--color-accent] text-white shadow-sm"
                  : "bg-white border-[--color-border] text-[--color-fg-muted] hover:text-[--color-fg] hover:border-[--color-border-strong]",
              )}
            >
              {o.label ?? o.value}
              {o.count !== undefined && (
                <span
                  className={cn(
                    "ml-1 text-[10px]",
                    active ? "text-[--color-accent]" : "text-[--color-fg-dim]",
                  )}
                >
                  {o.count}
                </span>
              )}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <span className="text-[10px] text-[--color-fg-dim] italic px-1 py-0.5">
            sin opciones
          </span>
        )}
      </div>
    </div>
  );
}
