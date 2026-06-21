import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-side rendering habilitado para API routes, NextAuth y Prisma.
  // Deploy en Railway (Node.js server), no static export.
  experimental: {
    // Turbopack en dev ya está activado via `next dev --turbopack`
  },
  // Velocidad Comercial pasó a ser módulo independiente en /velocity-comercial.
  // La ruta vieja /comercial redirige (permanente) para no romper enlaces.
  async redirects() {
    return [
      { source: "/comercial", destination: "/velocity-comercial", permanent: true },
      { source: "/comercial/:path*", destination: "/velocity-comercial/:path*", permanent: true },
    ];
  },
  /**
   * Resolver `.js` → `.ts/.tsx` para imports ESM-style entre módulos del motor
   * histórico (src/lib/historico). El motor escribe `from "./parser.js"` para
   * mantener compatibilidad con Node ESM en los tests y diagnósticos (node
   * --test bajo `nodenext`). Sin este alias webpack falla al bundlear esos
   * módulos para la página /velocidad-operacional. Cambio aditivo: imports
   * extensionless del resto del proyecto siguen funcionando.
   */
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
