"use client";

/**
 * Header del módulo Logística V1.
 *
 * Patrón paralelo al CN V2.1: PageHeader + kicker + título + descripción.
 * El filtro de mes + headline + ancla se renderizan en el bloque siguiente
 * (FiltroMesCompraMarca + headline en la page.tsx).
 */

import { Truck } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";

export function HeaderLog({
  actions,
}: {
  actions?: React.ReactNode;
}) {
  return (
    <PageHeader
      kicker="Operaciones · Flujo físico"
      kickerIcon={<Truck className="size-3.5" />}
      title="Logística"
      description="Cómo está funcionando el flujo físico del vehículo desde la marca hasta la sucursal."
      actions={actions}
    />
  );
}
