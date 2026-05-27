/**
 * NextAuth v5 (Auth.js) — configuración central.
 *
 * Estrategia JWT (sin tabla de sesiones en DB).
 * Provider: Credentials (email + password con bcrypt).
 *
 * Export: { handlers, auth, signIn, signOut }
 *   handlers → app/api/auth/[...nextauth]/route.ts
 *   auth     → middleware + server components
 *   signIn/Out → acciones del formulario
 */

import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// ─── Extensión de tipos ───────────────────────────────────────────────────────
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      rol: string;
    } & DefaultSession["user"];
  }

  interface User {
    rol?: string;
  }
}

// En NextAuth v5, el JWT se extiende via el callback jwt retornando el token extendido.
// Los tipos se leen desde session.user que sí está augmentado arriba.

// ─── Config ──────────────────────────────────────────────────────────────────
export const { handlers, auth, signIn, signOut } = NextAuth({
  secret:
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    (process.env.NODE_ENV === "development" ? "local-dev-secret-change-me" : undefined),
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "tu@pompeyo.cl" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user || !user.passwordHash || !user.activo) return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash,
        );
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? user.email,
          rol: user.rol,
        };
      },
    }),
  ],

  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.rol = user.rol;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.rol = token.rol as string;
      return session;
    },
  },

  pages: {
    signIn: "/login",
    error: "/login",
  },

  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 días
  },
});
