"use client";

import { Filter } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtNum } from "@/lib/format";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type {
  FiltrosVista,
  OpcionesFiltro,
} from "@/lib/historico/vista-derivados";

interface Props {
  opciones: OpcionesFiltro;
  filtros: FiltrosVista;
  onChange: (f: FiltrosVista) => void;
  onReset: () => void;
  totalUniverso: number;
  totalFiltrado: number;
}

function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  placeholder = "Todas",
}: {
  label: string;
  value: T | null;
  onChange: (v: T | null) => void;
  options: { value: T; label?: string }[];
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-[--color-fg-muted] font-medium">
        {label}
      </span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || null) as T | null)}
        className={cn(
          "h-8 px-2 rounded-md text-[12.5px] bg-white border border-[--color-border]",
          "focus:border-[--color-accent] outline-none min-w-[140px]",
        )}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label ?? o.value}
          </option>
        ))}
      </select>
    </label>
  );
}

const CUELLO_OPTIONS = [
  { value: "Logística" as const },
  { value: "Control de Negocio" as const },
  { value: "Comercial" as const },
  { value: "Cliente" as const },
  { value: "Mixto" as const },
  { value: "Sin información suficiente" as const },
];

const CALIDAD_OPTIONS = [
  { value: "correcto" as const, label: "Correcto" },
  { value: "huerfano" as const, label: "Huérfano" },
  { value: "inconsistente" as const, label: "Inconsistente" },
  { value: "no_evaluable" as const, label: "No evaluable" },
];

const ENTREGADO_OPTIONS = [
  { value: "si" as const, label: "Sí" },
  { value: "no" as const, label: "No" },
];

export function FiltrosHistoricoBar({
  opciones,
  filtros,
  onChange,
  onReset,
  totalUniverso,
  totalFiltrado,
}: Props) {
  const algunFiltroActivo =
    filtros.marca !== null ||
    filtros.sucursal !== null ||
    filtros.vendedor !== null ||
    filtros.entregado !== "todos" ||
    filtros.calidadCierre !== "todas" ||
    filtros.cuelloPrincipal !== "todos";

  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Filter className="size-3.5 text-[--color-fg-muted]" />
            <span className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium">
              Filtros
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={algunFiltroActivo ? "accent" : "muted"} size="sm">
              Universo: {fmtNum(totalFiltrado)} / {fmtNum(totalUniverso)}
            </Badge>
            {algunFiltroActivo && (
              <Button variant="ghost" size="sm" onClick={onReset}>
                Limpiar filtros
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <Select
            label="Marca"
            value={filtros.marca}
            onChange={(v) => onChange({ ...filtros, marca: v })}
            options={opciones.marcas.map((m) => ({ value: m }))}
          />
          <Select
            label="Sucursal"
            value={filtros.sucursal}
            onChange={(v) => onChange({ ...filtros, sucursal: v })}
            options={opciones.sucursales.map((s) => ({ value: s }))}
          />
          <Select
            label="Vendedor"
            value={filtros.vendedor}
            onChange={(v) => onChange({ ...filtros, vendedor: v })}
            options={opciones.vendedores.map((v) => ({ value: v }))}
          />
          <Select
            label="Entregado"
            value={filtros.entregado === "todos" ? null : filtros.entregado}
            onChange={(v) =>
              onChange({ ...filtros, entregado: (v ?? "todos") as FiltrosVista["entregado"] })
            }
            options={ENTREGADO_OPTIONS}
          />
          <Select
            label="Calidad cierre"
            value={filtros.calidadCierre === "todas" ? null : filtros.calidadCierre}
            onChange={(v) =>
              onChange({
                ...filtros,
                calidadCierre: (v ?? "todas") as FiltrosVista["calidadCierre"],
              })
            }
            options={CALIDAD_OPTIONS}
          />
          <Select
            label="Cuello principal"
            value={filtros.cuelloPrincipal === "todos" ? null : filtros.cuelloPrincipal}
            onChange={(v) =>
              onChange({
                ...filtros,
                cuelloPrincipal: (v ?? "todos") as FiltrosVista["cuelloPrincipal"],
              })
            }
            options={CUELLO_OPTIONS}
          />
        </div>
      </CardBody>
    </Card>
  );
}
