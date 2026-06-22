/** Health check para el ALB / ECS. Responde 200 sin tocar ROMA. */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, app: "velocidad-comercial", ts: new Date().toISOString() });
}
