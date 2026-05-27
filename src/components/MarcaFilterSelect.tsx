"use client";

import { useEffect } from "react";
import { Tag } from "lucide-react";
import { useExcelStore } from "@/lib/store";
import { useMarcaFilter } from "@/lib/marca-filtro";
import { marcasOperacionalesDisponibles } from "@/lib/selectors/owner-operacional";

/**
 * Selector GLOBAL de marca operacional (en el Header). Persiste la selección.
 * "Todas las marcas" = sin filtro (macro). Visible en todas las pantallas.
 */
export function MarcaFilterSelect({ onHeader = false }: { onHeader?: boolean }) {
  const data = useExcelStore((s) => s.data);
  const marca = useMarcaFilter((s) => s.marca);
  const setMarca = useMarcaFilter((s) => s.setMarca);

  useEffect(() => {
    useMarcaFilter.getState().hydrate();
  }, []);

  if (!data) return null;
  const marcas = marcasOperacionalesDisponibles(data.vehiculos);

  return (
    <div className="hidden sm:flex items-center gap-1.5">
      <Tag
        className={
          onHeader
            ? "size-3.5 text-white/70"
            : marca
              ? "size-3.5 text-[--color-accent]"
              : "size-3.5 text-[--color-fg-dim]"
        }
        strokeWidth={1.75}
      />
      <select
        value={marca ?? ""}
        onChange={(e) => setMarca(e.target.value || null)}
        className={
          onHeader
            ? marca
              ? "rounded-md border border-white/50 bg-white/15 px-2 py-1 text-[12px] font-medium text-white outline-none focus:border-white"
              : "rounded-md border border-white/30 bg-transparent px-2 py-1 text-[12px] text-white/80 outline-none focus:border-white"
            : marca
              ? "rounded-md border border-[--color-accent]/40 bg-[--color-accent]/[0.06] px-2 py-1 text-[12px] font-medium text-[--color-fg] outline-none focus:border-[--color-accent]"
              : "rounded-md border border-[--color-border] bg-white px-2 py-1 text-[12px] text-[--color-fg-muted] outline-none focus:border-[--color-accent]"
        }
        title="Filtrar todo el sistema por marca operacional"
      >
        <option value="">Todas las marcas</option>
        {marcas.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}
