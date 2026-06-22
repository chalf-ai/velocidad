import type { NextConfig } from "next";

/**
 * Velocidad Comercial — app INDEPENDIENTE (separada de Velocidad Operacional).
 * Vive en su propia carpeta del repo; se integra con su propio ECS aparte.
 */
const nextConfig: NextConfig = {
  // Sin ESLint config propio en esta primera versión; no bloquea el build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
