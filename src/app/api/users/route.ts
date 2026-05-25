/**
 * POST /api/users   → crea un usuario nuevo (solo ADMIN)
 * GET  /api/users   → lista usuarios (solo ADMIN)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { Rol } from "@prisma/client";

export async function GET() {
  const session = await auth();
  if (!session || session.user.rol !== "ADMIN") {
    return NextResponse.json({ error: "Solo ADMIN" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, rol: true, activo: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.rol !== "ADMIN") {
    return NextResponse.json({ error: "Solo ADMIN" }, { status: 403 });
  }

  let body: { email: string; name?: string; password: string; rol?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { email, name, password, rol } = body;
  if (!email || !password) {
    return NextResponse.json({ error: "email y password son requeridos" }, { status: 400 });
  }

  if (rol && !Object.values(Rol).includes(rol as Rol)) {
    return NextResponse.json({ error: `Rol inválido: ${rol}` }, { status: 400 });
  }

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    return NextResponse.json({ error: "Email ya existe" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      name: name ?? email,
      passwordHash,
      rol: (rol as Rol) ?? Rol.OPERACIONES,
    },
    select: { id: true, email: true, name: true, rol: true, createdAt: true },
  });

  return NextResponse.json(user, { status: 201 });
}
