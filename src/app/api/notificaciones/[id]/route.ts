/**
 * PATCH /api/notificaciones/[id] → marcar enviada manualmente (F1).
 *
 * Body: { enviado: true }
 * Registra el "envío manual" (el operador copió el mensaje y lo mandó por
 * WhatsApp Web a mano). waMsgId queda null — distingue manual de César.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;

  let body: { enviado?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (body.enviado !== true) {
    return NextResponse.json(
      { error: "Solo se soporta { enviado: true } (marcar enviada manual)" },
      { status: 400 },
    );
  }

  const existente = await prisma.alertaLog.findUnique({ where: { id } });
  if (!existente) {
    return NextResponse.json({ error: "Notificación no existe" }, { status: 404 });
  }
  if (existente.enviado) {
    return NextResponse.json({ error: "Ya está marcada como enviada" }, { status: 409 });
  }

  const actualizada = await prisma.alertaLog.update({
    where: { id },
    data: {
      enviado: true,
      // Trazabilidad del envío manual en errorMsg=null + sin waMsgId.
    },
  });

  return NextResponse.json(actualizada);
}
