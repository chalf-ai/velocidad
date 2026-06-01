"use client";

import { Search, X } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { fmtNum } from "@/lib/format";
import type { EntradaConsolidada } from "@/lib/historico/cruce-roma-actas";
import { DrillHistoricoTable } from "@/components/historico/DrillHistoricoTable";

interface Props {
  titulo: string;
  filas: EntradaConsolidada[];
  /** Callback para cerrar el drill (resetea el foco que lo abrió). */
  onClose: () => void;
  /**
   * Prefijo opcional para la columna "Conflicto / Razón" — pasa a la tabla.
   * Útil cuando la razón viene del contexto del foco (ej. cobertura por hito
   * faltante: "Hito faltante: Sin patente recibida").
   */
  prefijoRazon?: string;
}

/**
 * Wrapper visual del drill compartido. Envuelve la tabla existente con
 * encabezado consistente, badge de N casos y botón cerrar. En Fase 2 puede
 * sumarse filtros secundarios (días, solo críticos) sin tocar el motor.
 */
export function DrillPanel({ titulo, filas, onClose, prefijoRazon }: Props) {
  return (
    <Card variant="elevated">
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Search className="size-3.5 text-[--color-accent]" />
            <span className="text-[11px] uppercase tracking-wider text-[--color-fg-muted] font-medium">
              Panel de casos
            </span>
            <span className="text-[13.5px] text-[--color-fg] font-medium">{titulo}</span>
            <Badge tone="accent" size="sm">
              {fmtNum(filas.length)} casos
            </Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="size-3.5" />
            Cerrar
          </Button>
        </div>
        {/* Reusamos la tabla compacta validada — su CSV export + ordenamiento + paginación. */}
        <DrillHistoricoTable titulo={titulo} filas={filas} prefijoRazon={prefijoRazon} />
      </CardBody>
    </Card>
  );
}
