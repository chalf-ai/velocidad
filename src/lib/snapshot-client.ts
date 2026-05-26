"use client";

/**
 * Cliente del módulo Snapshot — POST/GET hacia /api/snapshot.
 *
 * Sirve para subir el resultado parseado de un Excel a la DB compartida
 * (Postgres en Railway), de modo que todos los usuarios vean el mismo corte
 * sin tener que re-subir el archivo. La API ya valida que sólo ADMIN o
 * JEFE_STOCK puedan postear.
 *
 * Detalles delicados al serializar/deserializar el payload:
 *   · `Date` ⇄ string ISO 8601  (JSON.stringify lo hace solo al subir; al traer
 *     usamos `reviveDates` para reconstruir los `Date`).
 *   · `Map` no es serializable nativo. El único Map del payload del stock es
 *     `vinsExtra` — lo convertimos a array de entries al postear y lo
 *     reconstruimos al hidratar (`vinsExtraToArray` / `vinsExtraFromArray`).
 */

import type { ParsedExcel } from "./types";

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

/** Convierte recursivamente strings ISO 8601 → `Date`. Idempotente y safe. */
export function reviveDates<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    if (ISO_DATE_RE.test(obj)) {
      const d = new Date(obj);
      if (!isNaN(d.getTime())) return d as unknown as T;
    }
    return obj;
  }
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) {
    return obj.map((x) => reviveDates(x)) as unknown as T;
  }
  if (typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = reviveDates(v);
    }
    return out as T;
  }
  return obj;
}

/** Convierte el `vinsExtra: Map` del ParsedExcel a array de entries para JSON. */
export function serializeStockPayload(parsed: ParsedExcel): unknown {
  return {
    ...parsed,
    vinsExtra: parsed.vinsExtra instanceof Map ? [...parsed.vinsExtra.entries()] : parsed.vinsExtra,
  };
}

/** Al hidratar desde DB, reconstruye `vinsExtra` como Map (y revive Dates). */
export function deserializeStockPayload(payload: unknown): ParsedExcel {
  const revived = reviveDates(payload) as ParsedExcel & { vinsExtra: unknown };
  const ve = revived.vinsExtra;
  if (Array.isArray(ve)) {
    revived.vinsExtra = new Map(ve as Array<[string, unknown]>) as ParsedExcel["vinsExtra"];
  } else if (!(ve instanceof Map)) {
    revived.vinsExtra = new Map();
  }
  return revived as ParsedExcel;
}

/** Tipos de fuente que reconoce la DB (en sincronía con enum Prisma). */
export type FuenteSnapshot =
  | "BASE_STOCK"
  | "FNE"
  | "SALDOS"
  | "PROVISIONES"
  | "LOGISTICA_ROMA"
  | "LOGISTICA_STLI";

export interface PostSnapshotArgs {
  nombre: string;
  tamano: number;
  fechaCorte?: Date | string | null;
  fuente: FuenteSnapshot;
  payload: unknown;
  registros?: number;
}

export interface SnapshotMeta {
  id: string;
  nombre: string;
  fuente: FuenteSnapshot;
  registros: number;
  activo: boolean;
  createdAt: string;
}

/**
 * Comprime un string con gzip usando la CompressionStream API nativa del
 * navegador (disponible en todos los browsers modernos desde 2023). Reduce
 * ~85% el tamaño de JSON repetitivo — clave para el Stock master que sin
 * comprimir suele pasar el límite de body de Next.js / Railway.
 */
async function gzipString(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

/**
 * Sube un snapshot a la DB. Marca activo y desactiva los anteriores de la misma
 * fuente (lo hace la API). Si falla (401, 403, 413, 5xx), lanza Error con el
 * mensaje legible. El llamador decide si avisar al usuario.
 *
 * Comprime el payload con gzip cuando el navegador lo soporta (todos los
 * modernos). Fallback a JSON plano si no — útil en testing o navegadores viejos.
 */
export async function postSnapshot(args: PostSnapshotArgs): Promise<SnapshotMeta> {
  const body = {
    nombre: args.nombre,
    tamano: args.tamano,
    fechaCorte:
      args.fechaCorte instanceof Date ? args.fechaCorte.toISOString() : args.fechaCorte ?? null,
    fuente: args.fuente,
    payload: args.payload,
    registros: args.registros ?? 0,
  };
  const json = JSON.stringify(body);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let payload: BodyInit;
  if (typeof CompressionStream !== "undefined") {
    payload = await gzipString(json);
    headers["Content-Encoding"] = "gzip";
  } else {
    payload = json;
  }

  const res = await fetch("/api/snapshot", {
    method: "POST",
    headers,
    credentials: "include",
    body: payload,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = `POST /api/snapshot ${res.status}`;
    try {
      const j = JSON.parse(text);
      if (j.error) msg = `${msg}: ${j.error}`;
    } catch {
      if (text) msg = `${msg}: ${text.slice(0, 160)}`;
    }
    throw new Error(msg);
  }
  return (await res.json()) as SnapshotMeta;
}

export interface ActiveSnapshotResult<T = unknown> {
  id: string;
  nombre: string;
  fechaCorte: string | null;
  fuente: FuenteSnapshot;
  registros: number;
  createdAt: string;
  payload: T;
  user: { name: string | null; email: string } | null;
}

/**
 * Trae el snapshot ACTIVO de una fuente. 404 si no hay. NO revive Dates ni Maps
 * acá — eso lo hace el caller con la utility que corresponda al payload.
 */
export async function fetchActiveSnapshot<T = unknown>(
  fuente: FuenteSnapshot,
): Promise<ActiveSnapshotResult<T> | null> {
  const res = await fetch(`/api/snapshot/active?fuente=${fuente}`, {
    credentials: "include",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GET /api/snapshot/active ${res.status}`);
  }
  return (await res.json()) as ActiveSnapshotResult<T>;
}
