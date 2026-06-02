/**
 * POST /api/admin/users/[id]/reset-password → hashea y guarda nueva clave (ADMIN)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { rol } = session.user;
  if (rol !== "ADMIN" && rol !== "GERENTE_GENERAL") {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
  }

  const { id } = await params;
  const body: { password?: string } = await req.json();

  if (!body.password || body.password.length < 6) {
    return NextResponse.json(
      { error: "La contraseña debe tener al menos 6 caracteres" },
      { status: 400 },
    );
  }

  const passwordHash = await bcrypt.hash(body.password, 12);

  await prisma.user.update({
    where: { id },
    data: { passwordHash },
  });

  return NextResponse.json({ ok: true });
}
