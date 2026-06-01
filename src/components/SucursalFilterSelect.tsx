"use client";

import { useEffect, useMemo } from "react";
import { MapPin } from "lucide-react";
import { useExcelStore } from "@/lib/store";
import { useMarcaFilter } from "@/lib/marca-filtro";
import { useSucursalFilter, sucursalesDisponibles } from "@/lib/sucursal-filtro";
import { filtrarPorMarcaOwnerUOriginador } from "@/lib/selectors/owner-operacional";

/**
 * Selector GLOBAL de sucursal (en el Header). Persiste la selección.
 * "Todas las sucursales" = sin filtro (macro). Visible en todas las pantallas.
 *
 * Espejo conceptual de `MarcaFilterSelect`. ACOTA el universo de sucursales
 * por la marca operacional activa: si hay marca seleccionada (ej. GEELY) solo
 * lista sucursales que pertenecen a esa marca; sin marca lista todas.
 *
 * Además: si cambias la marca y la sucursal previa ya no pertenece al nuevo
 * universo, la sucursal se limpia automáticamente para evitar combinaciones
 * vacías (ej. GEELY + sucursal Kia).
 */
export function SucursalFilterSelect() {
  const data = useExcelStore((s) => s.data);
  const marca = useMarcaFilter((s) => s.marca);
  const sucursal = useSucursalFilter((s) => s.sucursal);
  const setSucursal = useSucursalFilter((s) => s.setSucursal);

  useEffect(() => {
    useSucursalFilter.getState().hydrate();
  }, []);

  // Sucursales del universo acotado por marca (cuando hay marca activa).
  // Vacío sin data — el componente se oculta abajo.
  const sucursales = useMemo(() => {
    if (!data) return [];
    const vehiculos = marca
      ? filtrarPorMarcaOwnerUOriginador(data.vehiculos, marca)
      : data.vehiculos;
    return sucursalesDisponibles(vehiculos);
  }, [data, marca]);

  // Si la sucursal seleccionada deja de pertenecer al universo (porque cambió
  // la marca), limpiarla. Sin esto, el filtro daría 0 resultados en cascada.
  useEffect(() => {
    if (sucursal && sucursales.length > 0 && !sucursales.includes(sucursal)) {
      setSucursal(null);
    }
  }, [sucursal, sucursales, setSucursal]);

  if (!data) return null;
  if (sucursales.length === 0) return null;

  return (
    <div className="hidden sm:flex items-center gap-1.5">
      <MapPin
        className={sucursal ? "size-3.5 text-[--color-accent]" : "size-3.5 text-[--color-fg-dim]"}
        strokeWidth={1.75}
      />
      <select
        value={sucursal ?? ""}
        onChange={(e) => setSucursal(e.target.value || null)}
        className={
          sucursal
            ? "text-[12px] rounded-md border border-[--color-accent]/40 bg-[--color-accent]/[0.06] text-[--color-fg] font-medium px-2 py-1 focus:border-[--color-accent] outline-none"
            : "text-[12px] rounded-md border border-[--color-border] bg-white text-[--color-fg-muted] px-2 py-1 focus:border-[--color-accent] outline-none"
        }
        title={
          marca
            ? `Filtrar por sucursal (dentro de ${marca})`
            : "Filtrar todo el sistema por sucursal"
        }
      >
        <option value="">Todas las sucursales</option>
        {sucursales.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}
