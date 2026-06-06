/**
 * GET  /api/snapshot          → lista todos los snapshots (más reciente primero)
 * POST /api/snapshot          → guarda un snapshot nuevo y lo marca activo
 *
 * El payload puede ser grande (Excel parseado completo).
 * Requiere autenticación — solo ADMIN o GERENTE_GENERAL pueden crear snapshots.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Fuente } from "@prisma/client";
import { persistirHistorico } from "@/lib/historico/persistir";

// El Stock master puede pesar varios MB y tomar tiempo en serializarse a JSONB.
// Subimos el timeout y forzamos Node runtime (DecompressionStream necesita Node).
export const runtime = "nodejs";
export const maxDuration = 60;

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
  if (rol !== "ADMIN" && rol !== "GERENTE_GENERAL") {
    return NextResponse.json(
      { error: "Solo ADMIN o GERENTE_GENERAL pueden subir datos" },
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

  // Acepta payload comprimido con gzip (header Content-Encoding: gzip).
  // El cliente comprime el JSON con CompressionStream para que el Stock master
  // (~10 MB sin comprimir) baje a ~1.5 MB y no choque con el body size limit.
  try {
    const enc = req.headers.get("content-encoding");
    if (enc === "gzip" && req.body) {
      const decompressed = req.body.pipeThrough(new DecompressionStream("gzip"));
      const text = await new Response(decompressed).text();
      console.log(`[snapshot] POST gzip recibido, ${text.length} bytes descomprimidos`);
      body = JSON.parse(text);
    } else {
      const text = await req.text();
      console.log(`[snapshot] POST plain recibido, ${text.length} bytes`);
      body = JSON.parse(text);
    }
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    console.error("[snapshot] error al parsear body:", detalle);
    return NextResponse.json({ error: `Body inválido: ${detalle}` }, { status: 400 });
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

  // ── Motor histórico (Fase 1a) ──────────────────────────────────────────
  // Persistencia paralela del snapshot histórico mensual. Nunca bloquea la
  // respuesta principal: si falla, se loguea y se sigue. El snapshot vivo
  // que el cliente espera ya quedó persistido arriba.
  let historico: {
    ok: boolean;
    snapshotPeriod: string | null;
    archivoCreado: boolean;
    snapshotActualizado: boolean;
    warnings: string[];
    error?: string;
  } = {
    ok: true,
    snapshotPeriod: null,
    archivoCreado: false,
    snapshotActualizado: false,
    warnings: [],
  };
  try {
    const res = await persistirHistorico({
      fuente: fuente as Fuente,
      payload,
      nombreArchivo: nombre,
      tamano: tamano ?? 0,
      fechaCorteArchivo: fechaCorte ? new Date(fechaCorte) : null,
      userId: session.user.id,
    });
    historico = { ok: true, ...res };
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    console.error("[snapshot/historico] falló persistirHistorico:", detalle);
    historico = {
      ok: false,
      snapshotPeriod: null,
      archivoCreado: false,
      snapshotActualizado: false,
      warnings: [],
      error: detalle,
    };
  }

  return NextResponse.json({ ...snapshot, historico }, { status: 201 });
}
