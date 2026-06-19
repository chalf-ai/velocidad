/**
 * POST /api/snapshots/daily — "Generar snapshot de hoy".
 *
 * Toma la foto del estado vigente del sistema (Snapshot activos ya
 * ingestados) y la persiste en DailyCapitalSnapshot, una fila por scope
 * (TOTAL + cada marca). Idempotente: correr dos veces el mismo día
 * actualiza la foto, no duplica.
 *
 * Auth (cualquiera de las dos):
 *   · Sesión NextAuth con rol ADMIN o GERENTE_GENERAL (acción manual UI).
 *   · Authorization: Bearer <DAILY_SNAPSHOT_TOKEN> — para el job diario del
 *     agent. Si la env var no está configurada, esta vía queda deshabilitada.
 *
 * Body (opcional, JSON): `{ roma: { provisiones?, fne? } }` — el Job Amazon
 * postea Provisiones>90 Venta y FNE en VIVO desde ROMA (no alcanzable desde
 * Railway). Si no se entrega, se usan los snapshots activos (Excel validado).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  generarDailyCapitalSnapshot,
  type RomaPosted,
} from "@/lib/snapshots/daily-capital";

const ROLES_PERMITIDOS = new Set(["ADMIN", "GERENTE_GENERAL"]);

async function autorizado(req: NextRequest): Promise<boolean> {
  const token = process.env.DAILY_SNAPSHOT_TOKEN;
  const header = req.headers.get("authorization");
  if (token && header === `Bearer ${token}`) return true;

  const session = await auth();
  return session !== null && ROLES_PERMITIDOS.has(session.user.rol);
}

export async function POST(req: NextRequest) {
  if (!(await autorizado(req))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Body opcional con datos ROMA en vivo (Job Amazon). Sin body → snapshots activos.
  let roma: RomaPosted | undefined;
  const body = await req.json().catch(() => null);
  if (body && typeof body === "object" && body.roma && typeof body.roma === "object") {
    roma = body.roma as RomaPosted;
  }

  try {
    const resumen = await generarDailyCapitalSnapshot({ roma });
    return NextResponse.json({ ok: true, ...resumen });
  } catch (e) {
    console.error("[snapshots/daily] Error generando snapshot diario:", e);
    return NextResponse.json(
      { error: "Error generando el snapshot diario" },
      { status: 500 },
    );
  }
}
