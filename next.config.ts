import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-side rendering habilitado para API routes, NextAuth y Prisma.
  // Deploy en Railway (Node.js server), no static export.
  experimental: {
    // Turbopack en dev ya está activado via `next dev --turbopack`
  },
};

export default nextConfig;
