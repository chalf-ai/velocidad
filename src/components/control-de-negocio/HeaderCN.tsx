"use client";

/**
 * Header del módulo Control de Negocio.
 * Brief §6 — copy literal.
 */

import { ScrollText } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";

export function HeaderCN() {
  return (
    <PageHeader
      kicker="Operaciones · Sistema de Velocidad Operacional"
      kickerIcon={<ScrollText className="size-3.5" />}
      title="Control de Negocio"
      description="Cómo está funcionando el departamento desde factura hasta entrega."
    />
  );
}
