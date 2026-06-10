/**
 * GET /api/notificaciones → lista AlertaLog (cola de notificaciones).
 *
 * Por defecto devuelve TODOS los tipos (briefings de César incluidos) —
 * el panel /notificaciones gana visibilidad web sobre lo que hoy solo
 * vive en WhatsApp. Filtros: ?tipo=TAREA_ASIGNADA · ?enviado=false ·
 * ?mias=asignadas (soy el destinatario) · ?mias=creadas (yo asigné).
 *
 * La asignación interna es la obligatoria: el asignado ve su tarea acá
 * aunque nunca se haya enviado WhatsApp/email (canal externo opcional).
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
  const mias = searchParams.get("mias"); // "asignadas" | "creadas"

  // Resolver el usuario actual solo si el filtro lo necesita.
  let yo: { id: string } | null = null;
  if (mias === "asignadas" || mias === "creadas") {
    yo = await prisma.user.findUnique({
      where: { email: session.user.email ?? "" },
      select: { id: true },
    });
    if (!yo) return NextResponse.json([]);
  }

  const alertas = await prisma.alertaLog.findMany({
    where: {
      ...(tipo ? { tipo: tipo as never } : {}),
      ...(enviado != null ? { enviado: enviado === "true" } : {}),
      ...(mias === "asignadas" && yo ? { userId: yo.id } : {}),
      ...(mias === "creadas" && yo ? { tarea: { creadorId: yo.id } } : {}),
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
