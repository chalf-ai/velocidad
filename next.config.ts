import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export — la app es 100% client-side (parsing Excel + localStorage),
  // no necesitamos servidor Node. Netlify / Cloudflare Pages / S3 / Vercel pueden
  // servir el resultado directamente desde la carpeta `out/`.
  output: "export",
  // Servidores estáticos sirven mejor con trailing slashes (cada ruta como carpeta).
  trailingSlash: true,
  // Required for static export — sin el optimizador de imágenes de Next runtime.
  images: { unoptimized: true },
};

export default nextConfig;
