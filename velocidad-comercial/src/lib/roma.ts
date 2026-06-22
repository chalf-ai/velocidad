/**
 * Pool de conexiones a la DB de Roma (MySQL) — SOLO LECTURA. App Velocidad Comercial.
 * Singleton lazy en globalThis. Producción: ECS inyecta ROMA_DATABASE_URL como secret.
 * Local: túnel SSH al bastión + ROMA_DATABASE_URL en .env.local.
 */
import "server-only";
import mysql from "mysql2/promise";

const globalForRoma = globalThis as unknown as { romaPool: mysql.Pool | undefined };

function getRomaPool(): mysql.Pool {
  if (globalForRoma.romaPool) return globalForRoma.romaPool;
  const uri = process.env.ROMA_DATABASE_URL;
  if (!uri) {
    throw new Error(
      "ROMA_DATABASE_URL no está definida. En local: levantar el túnel SSH y revisar .env.local.",
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
  params: unknown[] = [],
): Promise<T[]> {
  const [rows] = await getRomaPool().query(sql, params);
  return rows as T[];
}
