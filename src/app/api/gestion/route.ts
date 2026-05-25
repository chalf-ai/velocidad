/**
 * GET /api/gestion   → lista todos los casos de gestión
 * Útil para exportar o auditar el estado global.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const estado = searchParams.get("estado");
  const prioridad = searchParams.get("prioridad");

  const gestiones = await prisma.gestionVIN.findMany({
    where: {
      ...(estado ? { estadoGestion: estado as never } : {}),
      ...(prioridad ? { prioridadManual: prioridad as never } : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: {
      historial: { orderBy: { createdAt: "desc" }, take: 5 },
      user: { select: { name: true, email: true } },
    },
  });

  return NextResponse.json(gestiones);
}
