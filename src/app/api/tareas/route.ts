/**
 * POST /api/tareas → crea TareaOperacional + AlertaLog(TAREA_ASIGNADA,
 *                    enviado=false) en UNA transacción.
 * GET  /api/tareas → lista tareas (filtros: asignadoId, estado, claveCaso).
 *
 * F1: la alerta queda PENDIENTE y se gestiona manualmente desde
 * /notificaciones. F2: César la procesará vía su cron + whatsapp.py.
 * Este endpoint NO envía WhatsApp.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  linkCaso,
  primerNombre,
  renderMensajeTarea,
} from "@/lib/notificaciones/render";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const asignadoId = searchParams.get("asignadoId");
  const estado = searchParams.get("estado");
  const claveCaso = searchParams.get("claveCaso");

  const tareas = await prisma.tareaOperacional.findMany({
    where: {
      ...(asignadoId ? { asignadoId } : {}),
      ...(estado ? { estado: estado as never } : {}),
      ...(claveCaso ? { claveCaso } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      asignado: { select: { name: true, email: true, telefono: true } },
      creador: { select: { name: true, email: true } },
      alertas: { select: { id: true, enviado: true, createdAt: true } },
    },
    take: 200,
  });

  return NextResponse.json(tareas);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  let body: {
    claveCaso: string;
    tipoCaso?: string;
    mensaje: string;
    motivo?: string | null;
    /** Cliente del caso — solo enriquece el mensaje renderizado (no se
     *  persiste en TareaOperacional; queda congelado en AlertaLog.mensaje). */
    cliente?: string | null;
    /** Canal simulado elegido en el modal. Se VALIDA pero NO se persiste:
     *  AlertaLog no tiene campo canal (waMsgId es del envío real WhatsApp).
     *  Agregar columna requiere decisión de schema — reportado en PR #26. */
    canal?: "WHATSAPP" | "EMAIL" | null;
    vin?: string | null;
    patente?: string | null;
    marca?: string | null;
    modelo?: string | null;
    asignadoId: string;
    fechaCompromiso?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (!body.claveCaso || !body.asignadoId || !body.mensaje?.trim()) {
    return NextResponse.json(
      { error: "Faltan campos: claveCaso, asignadoId, mensaje" },
      { status: 400 },
    );
  }

  const [asignado, creador] = await Promise.all([
    prisma.user.findUnique({
      where: { id: body.asignadoId },
      select: { id: true, name: true, email: true, telefono: true, activo: true },
    }),
    prisma.user.findUnique({
      where: { email: session.user.email ?? "" },
      select: { id: true, name: true, email: true },
    }),
  ]);

  if (!asignado || !asignado.activo) {
    return NextResponse.json({ error: "Usuario asignado no existe o está inactivo" }, { status: 400 });
  }
  if (!creador) {
    return NextResponse.json({ error: "Usuario creador no resuelto" }, { status: 400 });
  }

  // Canal: Email exige email del asignado (bloquea). WhatsApp sin teléfono
  // solo advierte — la notificación queda pendiente para copia manual.
  const canal = body.canal ?? "WHATSAPP";
  if (canal !== "WHATSAPP" && canal !== "EMAIL") {
    return NextResponse.json({ error: "Canal inválido (WHATSAPP | EMAIL)" }, { status: 400 });
  }
  if (canal === "EMAIL" && !asignado.email) {
    return NextResponse.json(
      { error: "El usuario asignado no tiene email — canal Email no disponible" },
      { status: 400 },
    );
  }

  const fechaCompromiso = body.fechaCompromiso ? new Date(body.fechaCompromiso) : null;
  if (fechaCompromiso && Number.isNaN(fechaCompromiso.getTime())) {
    return NextResponse.json({ error: "fechaCompromiso inválida" }, { status: 400 });
  }

  const link = linkCaso(body.vin ?? null, body.claveCaso);
  const mensajeRender = renderMensajeTarea({
    nombreAsignado: primerNombre(asignado.name),
    cliente: body.cliente ?? null,
    vin: body.vin ?? null,
    patente: body.patente ?? null,
    marca: body.marca ?? null,
    modelo: body.modelo ?? null,
    motivo: body.motivo ?? null,
    mensaje: body.mensaje,
    nombreCreador: primerNombre(creador.name),
    fechaCompromiso,
    link,
  });

  // Transacción: tarea + alerta pendiente. Si una falla, ninguna persiste.
  const [tarea, alerta] = await prisma.$transaction(async (tx) => {
    const t = await tx.tareaOperacional.create({
      data: {
        claveCaso: body.claveCaso,
        tipoCaso: body.tipoCaso ?? "vin",
        mensaje: body.mensaje.trim(),
        motivo: body.motivo ?? null,
        vin: body.vin ?? null,
        patente: body.patente ?? null,
        marca: body.marca ?? null,
        modelo: body.modelo ?? null,
        asignadoId: asignado.id,
        creadorId: creador.id,
        fechaCompromiso,
      },
    });
    const a = await tx.alertaLog.create({
      data: {
        userId: asignado.id,
        tipo: "TAREA_ASIGNADA",
        vin: body.vin ?? null,
        mensaje: mensajeRender,
        enviado: false,
        tareaId: t.id,
      },
    });
    return [t, a];
  });

  return NextResponse.json(
    {
      tarea,
      alerta: { id: alerta.id, enviado: alerta.enviado },
      canal,
      // Aviso para la UI: sin teléfono → solo copia manual posible.
      asignadoSinTelefono: !asignado.telefono,
    },
    { status: 201 },
  );
}
