/**
 * GET /api/snapshot/active?fuente=BASE_STOCK
 *
 * Devuelve el snapshot ACTIVO de una fuente con su `payload` completo (a
 * diferencia de `GET /api/snapshot` que devuelve solo metadata sin payload).
 * Lo usa el hidratador del cliente al arrancar la app para repoblar el store
 * sin que el usuario tenga que re-subir el Excel.
 *
 *   200 → snapshot completo
 *   404 → no hay snapshot activo de esa fuente
 *   400 → fuente inválida
 *   401 → no autenticado
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Fuente } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const fuenteRaw = searchParams.get("fuente");
  if (!fuenteRaw) {
    return NextResponse.json({ error: "Falta param 'fuente'" }, { status: 400 });
  }
  if (!Object.values(Fuente).includes(fuenteRaw as Fuente)) {
    return NextResponse.json(
      { error: `Fuente inválida: ${fuenteRaw}` },
      { status: 400 },
    );
  }

  const snapshot = await prisma.snapshot.findFirst({
    where: { fuente: fuenteRaw as Fuente, activo: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      nombre: true,
      fechaCorte: true,
      fuente: true,
      payload: true,
      registros: true,
      activo: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
  });

  if (!snapshot) {
    return NextResponse.json(
      { error: `Sin snapshot activo para fuente ${fuenteRaw}` },
      { status: 404 },
    );
  }

  return NextResponse.json(snapshot);
}
