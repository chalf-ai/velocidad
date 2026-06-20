/**
 * GET /api/snapshots/daily/score?marca=<m>
 *
 * Score Gerencial OFICIAL = último DailyCapitalSnapshot persistido para el scope
 * (TOTAL si no hay marca; si hay, la marca canónica). FUENTE ÚNICA: /score-gerencial
 * consume este endpoint para su número principal y sus componentes; /tendencias
 * muestra la serie del MISMO campo. Por construcción, el valor que devuelve acá =
 * el último punto de /tendencias para el mismo scope.
 *
 * Read-only. Requiere sesión. No recalcula nada: lee la foto canónica.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizarMarcaOperacional } from "@/lib/selectors/owner-operacional";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const marcaParam = req.nextUrl.searchParams.get("marca");
  const marca = marcaParam && marcaParam.trim() !== "" ? marcaParam : null;
  const marcaCanonica = marca ? normalizarMarcaOperacional(marca) : null;

  // Mismo criterio de scope que /tendencias (server component).
  const fila = await prisma.dailyCapitalSnapshot.findFirst({
    where: marcaCanonica
      ? { scopeTipo: "MARCA", marca: marcaCanonica }
      : { scopeTipo: "TOTAL" },
    orderBy: { fecha: "desc" },
    select: {
      fecha: true,
      scopeTipo: true,
      marca: true,
      scoreGerencial: true,
      scoreComponentes: true,
      cajaComercialUnidades: true,
      cajaComercialMonto: true,
      provisionesUnidades: true,
      provisionesMonto: true,
      provisionesAgingMax: true,
      cpUnidades: true,
      cpMonto: true,
      saldosUnidades: true,
      saldosMonto: true,
      stockPagadoUnidades: true,
      stockPagadoMonto: true,
      fneUnidades: true,
      fneMonto: true,
      capitalTrabajoTotal: true,
    },
  });

  if (!fila) {
    return NextResponse.json({ ok: true, fila: null, marca: marcaCanonica });
  }

  return NextResponse.json({
    ok: true,
    marca: marcaCanonica,
    fila: { ...fila, fecha: fila.fecha.toISOString().slice(0, 10) },
  });
}
