/**
 * GET /api/health — healthcheck para Railway
 */
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}
