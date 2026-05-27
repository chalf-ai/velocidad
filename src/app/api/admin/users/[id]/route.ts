/**
 * PATCH /api/admin/users/[id] → actualiza activo y/o rol (ADMIN)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Rol } from "@prisma/client";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (session.user.rol !== "ADMIN") {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const { id } = await params;

  if (id === session.user.id) {
    return NextResponse.json(
      { error: "No puedes modificar tu propio usuario" },
      { status: 400 },
    );
  }

  const body: { activo?: boolean; rol?: string } = await req.json();

  const data: { activo?: boolean; rol?: Rol } = {};
  if (typeof body.activo === "boolean") data.activo = body.activo;
  if (body.rol) {
    if (!Object.values(Rol).includes(body.rol as Rol)) {
      return NextResponse.json({ error: `Rol inválido: ${body.rol}` }, { status: 400 });
    }
    data.rol = body.rol as Rol;
  }

  if (!Object.keys(data).length) {
    return NextResponse.json({ error: "Sin campos para actualizar" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      email: true,
      name: true,
      rol: true,
      activo: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(user);
}
