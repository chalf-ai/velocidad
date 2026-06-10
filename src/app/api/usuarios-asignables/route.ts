/**
 * GET /api/usuarios-asignables → usuarios activos para el selector de
 * asignación de tareas (modal "Asignar / Notificar").
 *
 * Separado de /api/users (que es de ADMINISTRACIÓN y exige canManageUsers):
 * cualquier usuario autenticado puede asignar una tarea, así que este
 * endpoint solo expone lo mínimo: id, nombre, email, rol y si tiene
 * teléfono WhatsApp (para el warning de copia manual).
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const users = await prisma.user.findMany({
    where: { activo: true },
    select: { id: true, name: true, email: true, rol: true, telefono: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(
    users.map((u) => ({
      id: u.id,
      name: u.name ?? u.email,
      email: u.email,
      rol: u.rol,
      tieneTelefono: !!u.telefono,
    })),
  );
}
