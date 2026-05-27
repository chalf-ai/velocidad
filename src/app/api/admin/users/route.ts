/**
 * GET  /api/admin/users  → lista todos los usuarios (ADMIN)
 * POST /api/admin/users  → crea un usuario nuevo (ADMIN)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Rol } from "@prisma/client";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";

async function requireAdmin() {
  const session = await auth();
  if (!session) return { error: "No autorizado", status: 401 } as const;
  if (session.user.rol !== "ADMIN") return { error: "Acceso denegado", status: 403 } as const;
  return { session } as const;
}

export async function GET() {
  const check = await requireAdmin();
  if ("error" in check) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      rol: true,
      activo: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const check = await requireAdmin();
  if ("error" in check) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const body: { email?: string; name?: string; password?: string; rol?: string } =
    await req.json();

  const { email, name, password, rol } = body;

  if (!email || !password) {
    return NextResponse.json({ error: "Email y contraseña son requeridos" }, { status: 400 });
  }

  if (!Object.values(Rol).includes(rol as Rol)) {
    return NextResponse.json({ error: `Rol inválido: ${rol}` }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Ya existe un usuario con ese email" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      name: name || null,
      passwordHash,
      rol: rol as Rol,
      activo: true,
    },
    select: {
      id: true,
      email: true,
      name: true,
      rol: true,
      activo: true,
      createdAt: true,
    },
  });

  return NextResponse.json(user, { status: 201 });
}
