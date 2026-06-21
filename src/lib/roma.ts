/**
 * Pool de conexiones a la DB de Roma (MySQL Aurora) — SOLO LECTURA.
 * Usuario `velocidadOP`: SELECT + EXECUTE sobre `roma.*` (no puede escribir).
 *
 * Misma idea que prisma.ts: singleton en globalThis para sobrevivir el
 * hot-reload de dev. El pool se crea recién en la primera query (lazy) para
 * que `next build` no reviente en CI, donde ROMA_DATABASE_URL no existe.
 *
 * - Producción: ECS inyecta ROMA_DATABASE_URL como secret (ya configurado).
 * - Local: requiere túnel SSH al bastion (ver DEPLOY.md) y en .env.local
 *   la URL apuntando a localhost:3307. OJO: el `#` de la password va
 *   percent-encoded (%23) o la URL se corta en el fragmento.
 */

import mysql from "mysql2/promise";

const globalForRoma = globalThis as unknown as {
  romaPool: mysql.Pool | undefined;
};

function getRomaPool(): mysql.Pool {
  if (globalForRoma.romaPool) return globalForRoma.romaPool;

  const uri = process.env.ROMA_DATABASE_URL;
  if (!uri) {
    throw new Error(
      "ROMA_DATABASE_URL no está definida. En local: levantar el túnel SSH y revisar .env.local."
    );
  }

  const pool = mysql.createPool({
    uri,
    waitForConnections: true,
    connectionLimit: 5,
    maxIdle: 2,
    idleTimeout: 60_000,
    enableKeepAlive: true,
  });

  globalForRoma.romaPool = pool;
  return pool;
}

/** Ejecuta una query de SOLO LECTURA sobre Roma con placeholders `?`. */
export async function romaQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const [rows] = await getRomaPool().query(sql, params);
  return rows as T[];
}

// ── Ejemplo: cotizaciones de venta recientes ─────────────────────────────────

export type CotizacionRecienteRoma = {
  ID: number;
  FechaCreacion: Date;
  SucursalID: number;
  MarcaID: number;
  Anno: number;
  PrecioLista: number;
  Venta: number; // 1 = terminó en venta
  VinProb: string | null;
};

/**
 * Cotizaciones creadas en Roma en los últimos `dias` días (default 7).
 * Query validada contra roma.VT_Cotizaciones (~1.1M filas, usa índice por fecha).
 *
 * Uso en una API route / server component:
 *   const cotizaciones = await cotizacionesRecientesRoma(7);
 */
export async function cotizacionesRecientesRoma(
  dias = 7,
  limite = 100
): Promise<CotizacionRecienteRoma[]> {
  return romaQuery<CotizacionRecienteRoma>(
    `SELECT ID, FechaCreacion, SucursalID, MarcaID, Anno, PrecioLista, Venta, VinProb
     FROM VT_Cotizaciones
     WHERE FechaCreacion >= DATE_SUB(NOW(), INTERVAL ? DAY)
     ORDER BY FechaCreacion DESC
     LIMIT ?`,
    [dias, limite]
  );
}
