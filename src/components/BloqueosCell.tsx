"use client";

import { Badge } from "@/components/ui/Badge";
import type { Bloqueo } from "@/lib/selectors/razones-bloqueo";
import { RESPONSABLE_TONE } from "@/lib/selectors/razones-bloqueo";

/** Render compacto de la lista de bloqueos de un FNE para una celda de tabla. */
export function BloqueosCell({ bloqueos }: { bloqueos: Bloqueo[] }) {
  if (bloqueos.length === 0) {
    return (
      <Badge tone="success" size="xs">
        Listo
      </Badge>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {bloqueos.map((b) => (
        <span
          key={b.tipo}
          title={`${b.descripcion}${b.detalle ? ` · ${b.detalle}` : ""} — ${b.accionSugerida}`}
          className="inline-flex items-center"
        >
          <Badge tone={RESPONSABLE_TONE[b.responsable]} size="xs">
            {b.responsable}
          </Badge>
        </span>
      ))}
    </div>
  );
}
