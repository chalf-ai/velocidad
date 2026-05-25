/**
 * GET /api/gestion/[vin]   → obtiene el caso de gestión para un VIN
 * PUT /api/gestion/[vin]   → upsert del caso (crea o actualiza)
 *
 * El historial se guarda automáticamente en HistorialGestion.
 * Cualquier usuario autenticado puede gestionar casos.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EstadoGestion, PrioridadManual } from "@prisma/client";

// ─── GET ──────────────────────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ vin: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { vin } = await params;
  const vinNorm = vin.trim().toUpperCase();

  const gestion = await prisma.gestionVIN.findUnique({
    where: { vin: vinNorm },
    include: {
      historial: { orderBy: { createdAt: "desc" }, take: 50 },
      user: { select: { name: true, email: true } },
    },
  });

  if (!gestion) return NextResponse.json(null);
  return NextResponse.json(gestion);
}

// ─── PUT ──────────────────────────────────────────────────────────────────────
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ vin: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { vin } = await params;
  const vinNorm = vin.trim().toUpperCase();

  let body: Partial<{
    comentario: string | null;
    proximaAccion: string | null;
    responsable: string | null;
    responsableEmail: string | null;
    ownership: string | null;
    fechaCompromiso: string | null;
    estadoGestion: string;
    prioridadManual: string | null;
  }>;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Validar enums
  if (body.estadoGestion && !Object.values(EstadoGestion).includes(body.estadoGestion as EstadoGestion)) {
    return NextResponse.json({ error: `estadoGestion inválido: ${body.estadoGestion}` }, { status: 400 });
  }
  if (body.prioridadManual && !Object.values(PrioridadManual).includes(body.prioridadManual as PrioridadManual)) {
    return NextResponse.json({ error: `prioridadManual inválida: ${body.prioridadManual}` }, { status: 400 });
  }

  const prev = await prisma.gestionVIN.findUnique({ where: { vin: vinNorm } });

  // Calcular entradas de historial para campos que cambian
  const historialEntries: Array<{
    campo: string;
    valorAnterior: string | null;
    valorNuevo: string | null;
    usuario: string;
    userEmail: string;
  }> = [];

  const camposLabel: Record<string, string> = {
    comentario: "Contexto",
    proximaAccion: "Próxima acción",
    responsable: "Responsable",
    responsableEmail: "Email responsable",
    fechaCompromiso: "Fecha compromiso",
    estadoGestion: "Estado",
    prioridadManual: "Prioridad manual",
    ownership: "Ownership",
  };

  for (const [k, label] of Object.entries(camposLabel)) {
    const key = k as keyof typeof body;
    if (!(key in body)) continue;
    const valAnt = prev ? String(prev[key as keyof typeof prev] ?? "") : "";
    const valNuevo = String(body[key] ?? "");
    if (valAnt === valNuevo) continue;
    historialEntries.push({
      campo: label,
      valorAnterior: valAnt || null,
      valorNuevo: valNuevo || null,
      usuario: session.user.name ?? session.user.email ?? "Usuario",
      userEmail: session.user.email ?? "",
    });
  }

  const gestion = await prisma.gestionVIN.upsert({
    where: { vin: vinNorm },
    update: {
      ...body,
      estadoGestion: body.estadoGestion as EstadoGestion | undefined,
      prioridadManual: (body.prioridadManual as PrioridadManual | null | undefined),
      fechaCompromiso: body.fechaCompromiso ? new Date(body.fechaCompromiso) : body.fechaCompromiso === null ? null : undefined,
      userId: session.user.id,
      historial: historialEntries.length
        ? { create: historialEntries }
        : undefined,
    },
    create: {
      vin: vinNorm,
      comentario: body.comentario ?? null,
      proximaAccion: body.proximaAccion ?? null,
      responsable: body.responsable ?? null,
      responsableEmail: body.responsableEmail ?? null,
      ownership: body.ownership ?? session.user.name ?? null,
      fechaCompromiso: body.fechaCompromiso ? new Date(body.fechaCompromiso) : null,
      estadoGestion: (body.estadoGestion as EstadoGestion) ?? EstadoGestion.ABIERTO,
      prioridadManual: (body.prioridadManual as PrioridadManual | null) ?? null,
      userId: session.user.id,
      historial: historialEntries.length
        ? { create: historialEntries }
        : undefined,
    },
    include: {
      historial: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });

  // Purgar historial si supera 50 entradas
  const totalHistorial = await prisma.historialGestion.count({
    where: { gestionId: gestion.id },
  });
  if (totalHistorial > 50) {
    const oldest = await prisma.historialGestion.findMany({
      where: { gestionId: gestion.id },
      orderBy: { createdAt: "asc" },
      take: totalHistorial - 50,
      select: { id: true },
    });
    await prisma.historialGestion.deleteMany({
      where: { id: { in: oldest.map((e) => e.id) } },
    });
  }

  return NextResponse.json(gestion);
}
