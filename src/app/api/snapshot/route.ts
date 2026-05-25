/**
 * GET  /api/snapshot          → lista todos los snapshots (más reciente primero)
 * POST /api/snapshot          → guarda un snapshot nuevo y lo marca activo
 *
 * El payload puede ser grande (Excel parseado completo).
 * Requiere autenticación — solo JEFE_STOCK o ADMIN pueden crear snapshots.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Fuente } from "@prisma/client";

// ─── GET — listar snapshots ───────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const fuente = searchParams.get("fuente") as Fuente | null;

  const snapshots = await prisma.snapshot.findMany({
    where: fuente ? { fuente } : undefined,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      nombre: true,
      tamano: true,
      fechaCorte: true,
      fuente: true,
      registros: true,
      activo: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
  });

  return NextResponse.json(snapshots);
}

// ─── POST — crear snapshot ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const rol = session.user.rol;
  if (rol !== "ADMIN" && rol !== "JEFE_STOCK") {
    return NextResponse.json(
      { error: "Solo ADMIN o JEFE_STOCK pueden subir datos" },
      { status: 403 },
    );
  }

  let body: {
    nombre: string;
    tamano: number;
    fechaCorte?: string | null;
    fuente: string;
    payload: unknown;
    registros?: number;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { nombre, tamano, fechaCorte, fuente, payload, registros } = body;

  if (!nombre || !fuente || !payload) {
    return NextResponse.json(
      { error: "Faltan campos: nombre, fuente, payload" },
      { status: 400 },
    );
  }

  if (!Object.values(Fuente).includes(fuente as Fuente)) {
    return NextResponse.json(
      { error: `Fuente inválida: ${fuente}` },
      { status: 400 },
    );
  }

  // Desactivar snapshots anteriores de la misma fuente
  await prisma.snapshot.updateMany({
    where: { fuente: fuente as Fuente, activo: true },
    data: { activo: false },
  });

  const snapshot = await prisma.snapshot.create({
    data: {
      nombre,
      tamano: tamano ?? 0,
      fechaCorte: fechaCorte ? new Date(fechaCorte) : null,
      fuente: fuente as Fuente,
      payload: payload as object,
      registros: registros ?? 0,
      activo: true,
      userId: session.user.id,
    },
    select: {
      id: true,
      nombre: true,
      fuente: true,
      registros: true,
      activo: true,
      createdAt: true,
    },
  });

  return NextResponse.json(snapshot, { status: 201 });
}
