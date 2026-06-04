/**
 * PUT /api/snapshot/[id]/activate
 * Activa un snapshot específico (desactiva los demás de la misma fuente).
 * Solo ADMIN o GERENTE_GENERAL.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PUT(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const rol = session.user.rol;
  if (rol !== "ADMIN" && rol !== "GERENTE_GENERAL") {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }

  const { id } = await params;

  const snapshot = await prisma.snapshot.findUnique({ where: { id } });
  if (!snapshot) {
    return NextResponse.json({ error: "Snapshot no encontrado" }, { status: 404 });
  }

  // Desactivar los demás de la misma fuente
  await prisma.snapshot.updateMany({
    where: { fuente: snapshot.fuente, activo: true },
    data: { activo: false },
  });

  const updated = await prisma.snapshot.update({
    where: { id },
    data: { activo: true },
  });

  return NextResponse.json(updated);
}
