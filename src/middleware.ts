/**
 * Middleware de autenticación — NextAuth v5.
 *
 * IMPORTANTE: usar `auth` de @/lib/auth (v5 API), NO `getToken` de next-auth/jwt.
 * NextAuth v5 escribe la cookie `authjs.session-token` (o `__Secure-authjs.session-token`
 * en producción HTTPS). getToken/next-auth/jwt busca `next-auth.session-token` (v4),
 * por eso siempre fallaba aunque el login fuera correcto.
 */

import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth",
  "/api/seed",
  "/api/health",
  // Server-to-server (job diario del agent): el handler valida su propio
  // Bearer DAILY_SNAPSHOT_TOKEN o sesión con rol — no redirigir a /login.
  "/api/snapshots/daily",
];

export default auth(function middleware(req) {
  const { pathname } = req.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  if (isPublic) return NextResponse.next();

  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", `${pathname}${req.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
