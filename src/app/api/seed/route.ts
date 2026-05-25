/**
 * POST /api/seed — crea el primer usuario ADMIN si no existe ninguno.
 * Solo funciona cuando no hay usuarios en la DB (primera instalación).
 * Desactivar en producción después del setup inicial.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  // Solo disponible si ALLOW_SEED=true (variable de entorno)
  if (process.env.ALLOW_SEED !== "true") {
    return NextResponse.json({ error: "Seed desactivado" }, { status: 403 });
  }

  const count = await prisma.user.count();
  if (count > 0) {
    return NextResponse.json(
      { error: "Ya existen usuarios. Usa /api/users para crear más (requiere ADMIN)." },
      { status: 409 },
    );
  }

  let body: { email: string; name?: string; password: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { email, name, password } = body;
  if (!email || !password) {
    return NextResponse.json({ error: "email y password son requeridos" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      name: name ?? email,
      passwordHash,
      rol: "ADMIN",
    },
    select: { id: true, email: true, name: true, rol: true },
  });

  return NextResponse.json({ ok: true, user }, { status: 201 });
}
