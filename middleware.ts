/**
 * Middleware de autenticación — NextAuth v5.
 * Redirige a /login si no hay sesión activa.
 * Rutas públicas: /login, /api/auth/*, /api/seed
 */

import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth",
  "/api/seed",
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  if (isPublic) return NextResponse.next();

  // Si no hay sesión → redirigir a login
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Excluir archivos estáticos y _next internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)",
  ],
};
