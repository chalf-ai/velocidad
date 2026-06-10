/**
 * GET /api/notificaciones → lista AlertaLog (cola de notificaciones).
 *
 * Por defecto devuelve TODOS los tipos (briefings de César incluidos) —
 * el panel /notificaciones gana visibilidad web sobre lo que hoy solo
 * vive en WhatsApp. Filtros: ?tipo=TAREA_ASIGNADA · ?enviado=false.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const tipo = searchParams.get("tipo");
  const enviado = searchParams.get("enviado");

  const alertas = await prisma.alertaLog.findMany({
    where: {
      ...(tipo ? { tipo: tipo as never } : {}),
      ...(enviado != null ? { enviado: enviado === "true" } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { name: true, email: true, telefono: true } },
      tarea: {
        select: {
          id: true,
          claveCaso: true,
          vin: true,
          marca: true,
          modelo: true,
          motivo: true,
          estado: true,
          fechaCompromiso: true,
          creador: { select: { name: true } },
        },
      },
    },
    take: 200,
  });

  return NextResponse.json(alertas);
}
