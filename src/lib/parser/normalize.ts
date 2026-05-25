/**
 * Normalización de strings, fechas, números y catálogo de marcas.
 *
 * Las marcas aparecen escritas distinto en cada hoja:
 *   - Base_Stock col "Marca": "KIA MOTORS", "DFSK", "DONGFENG/NAMMI"
 *   - Base_Stock col "Marca Pompeyo": "KIA MOTORS", "VU en Nuevos", "USADOS"
 *   - 3.-Lineas de Credito: "KIA MOTORS", "DONGFENG/NAMMI", "NISSAN FLOTAS"
 *   - AUX Financiera: "KIA", "NISSAN", "DFM"
 *
 * Usamos "Marca Pompeyo" como canónico para dashboards, pero mantenemos
 * la marca de línea separada porque NISSAN ≠ NISSAN FLOTAS en líneas de crédito.
 */

export function clean(s: unknown): string | null {
  if (s === null || s === undefined) return null;
  const str = String(s).trim();
  if (str === "" || str === "#N/A" || str === "#REF!" || str === "NO") return null;
  return str;
}

export function cleanRequired(s: unknown, fallback = ""): string {
  return clean(s) ?? fallback;
}

export function toUpper(s: string | null): string | null {
  return s ? s.toUpperCase() : null;
}

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/\./g, "").replace(/,/g, ".").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function toNumberOrZero(v: unknown): number {
  return toNumber(v) ?? 0;
}

export function toBoolSiNo(v: unknown): boolean {
  const s = clean(v);
  if (!s) return false;
  const u = s.toUpperCase();
  return u === "SI" || u === "SÍ" || u === "YES" || u === "TRUE" || u === "1";
}

/**
 * Convierte casi cualquier representación de fecha del Excel a Date.
 * Soporta:
 *   - serial Excel numérico (45843)
 *   - Date nativo (xlsx con cellDates=true)
 *   - strings "01-02-2026", "2026-05-18", "2026/05/18", "18/5/2026"
 *   - placeholders "NO", "#N/A", "" → null
 */
export function parseDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    return Number.isFinite(v.getTime()) ? v : null;
  }
  if (typeof v === "number") {
    // serial Excel: días desde 1899-12-30
    if (v < 1 || v > 100000) return null;
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const s = String(v).trim();
  if (!s || s === "NO" || s === "#N/A" || s === "#REF!") return null;

  // ISO
  const iso = new Date(s);
  if (Number.isFinite(iso.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(s)) return iso;

  // dd-mm-yyyy o dd/mm/yyyy
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) {
    const [, dd, mm, yy] = m;
    let y = parseInt(yy, 10);
    if (y < 100) y = y < 70 ? 2000 + y : 1900 + y;
    const d = new Date(y, parseInt(mm, 10) - 1, parseInt(dd, 10));
    if (Number.isFinite(d.getTime())) return d;
  }

  // dd-mes-aaaa o similares — fallback a Date()
  if (Number.isFinite(iso.getTime())) return iso;
  return null;
}

// ───────────────────────────────────────────────────────────
// Catálogo de marcas: marca cruda → marca canónica
// Si una marca no está aquí, se reporta como "sin mapeo" en el ParseReport
// ───────────────────────────────────────────────────────────

const MARCA_CANON: Record<string, string> = {
  // Nuevas
  "KIA": "KIA MOTORS",
  "KIA MOTORS": "KIA MOTORS",
  "MG": "MG",
  "PEUGEOT": "PEUGEOT",
  "PEUGEOT LIVIANOS": "PEUGEOT",
  "GEELY": "GEELY",
  "GEELY LIVIANOS": "GEELY",
  "OPEL": "OPEL",
  "CITROEN": "CITROEN",
  "CITROËN": "CITROEN",
  "DFSK": "DFSK",
  "NISSAN": "NISSAN",
  "NISSAN FLOTAS": "NISSAN FLOTAS",
  "SUBARU": "SUBARU",
  "SUZUKI": "SUZUKI",
  "CHEVROLET": "CHEVROLET",
  "HYUNDAI": "HYUNDAI",
  "LEAPMOTOR": "LEAPMOTOR",
  "CHERY": "CHERY",
  "LANDKING": "LANDKING",
  "LANDKING CAMIONES": "LANDKING",
  "NAMMI": "NAMMI",
  "DFM": "DFM",
  "DONGFENG": "NAMMI",
  "DONGFENG/NAMMI": "NAMMI",
  "GREAT WALL": "GREAT WALL",
  // Usados / agrupaciones internas
  "USADOS": "USADOS",
  "VU EN NUEVOS": "VU EN NUEVOS",
  "VU EN USADOS": "VU EN USADOS",
};

export function canonicalMarca(raw: string | null | undefined): {
  canon: string | null;
  mapped: boolean;
} {
  if (!raw) return { canon: null, mapped: false };
  const key = raw.toString().trim().toUpperCase();
  const canon = MARCA_CANON[key];
  if (canon) return { canon, mapped: true };
  return { canon: key, mapped: false };
}

// Para conectar Vehiculo.marcaPompeyo ↔ LineaCredito.marca
// Algunas líneas separan "NISSAN" vs "NISSAN FLOTAS" — esos casos se respetan
export function marcaParaLinea(marcaPompeyo: string, unidadNegocio: string): string {
  const m = marcaPompeyo.toUpperCase();
  if (m === "NISSAN" && unidadNegocio === "Nuevos") return "NISSAN";
  // (regla a refinar cuando confirmemos detección de flota en Base_Stock)
  return m;
}

/**
 * Compara si la bodega física del vehículo corresponde a la sucursal de venta.
 *
 * En el Excel los nombres NO coinciden literalmente nunca (0/478 en mayo 2026):
 *   Sucursal "KIA REDCUBE"        ↔  Bodega "SERVICIO REDCUBE"        → SÍ (REDCUBE)
 *   Sucursal "OPEL MOVICENTER"    ↔  Bodega "STOCK OPEL MOVICENTER"   → SÍ (OPEL, MOVICENTER)
 *   Sucursal "LOGISTICA POMPEYO"  ↔  Bodega "KAR-LOGISTICS"           → NO
 *   Sucursal "LOGISTICA POMPEYO"  ↔  Bodega "SCHIAPPACASSE LONQUEN"   → NO
 *
 * Estrategia: tokenizar ambos, descartar palabras genéricas, buscar tokens en común.
 */
const STOPWORDS = new Set([
  "STOCK", "BODEGA", "SERVICIO", "VEHICULOS", "VEHÍCULOS", "VEHICULO", "VEHÍCULO",
  "DE", "DEL", "LA", "EL", "LOS", "LAS", "EN", "CON",
  "LOGISTICA", "LOGÍSTICA", "POMPEYO", "AUTOS",
  "MALL", "PLAZA", "CON", "SIN", "PATENTE",
]);

function tokenize(s: string): string[] {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remueve acentos
    .split(/[\s\-_./]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Inferir marca originadora desde el nombre de la sucursal.
 *
 * Sucursales son marca-específicas en ~90% de los casos para VPPs:
 *   "KIA REDCUBE", "MG MOVICENTER", "PEUGEOT MALL PLAZA SUR"  →  inferible
 *   "LOGISTICA POMPEYO", "SEMINUEVOS MAIPU", "AUTOSHOPPING"   →  no inferible
 *   "LEAP MOTOR MOVICENTER"                                    →  ambigua (espacio)
 *
 * Devuelve la marca canónica o null si no se puede inferir.
 */
const MARCAS_INFERIBLES: { needles: string[]; canon: string }[] = [
  { needles: ["KIA"], canon: "KIA MOTORS" },
  { needles: ["MG"], canon: "MG" },
  { needles: ["PEUGEOT"], canon: "PEUGEOT" },
  { needles: ["GEELY"], canon: "GEELY" },
  { needles: ["DFSK"], canon: "DFSK" },
  { needles: ["SUBARU"], canon: "SUBARU" },
  { needles: ["NISSAN"], canon: "NISSAN" },
  { needles: ["CITROEN", "CITROËN"], canon: "CITROEN" },
  { needles: ["OPEL"], canon: "OPEL" },
  { needles: ["LANDKING"], canon: "LANDKING" },
  { needles: ["NAMMI"], canon: "NAMMI" },
  { needles: ["LEAP MOTOR", "LEAPMOTOR"], canon: "LEAPMOTOR" },
];

const SUCURSAL_NO_INFERIBLE = [
  "LOGISTICA POMPEYO",
  "SEMINUEVOS",
  "AUTOSHOPPING",
  "TEST CARS",
  "VN CON PATENTE",
  "CPD",
];

export function inferirMarcaOriginadoraDesdeSucursal(
  sucursal: string | null | undefined,
): string | null {
  if (!sucursal) return null;
  const u = String(sucursal).toUpperCase();
  if (SUCURSAL_NO_INFERIBLE.some((n) => u.includes(n))) return null;
  for (const { needles, canon } of MARCAS_INFERIBLES) {
    if (needles.some((n) => u.includes(n))) return canon;
  }
  return null;
}

export function sucursalCoincideConBodega(
  sucursal: string | null | undefined,
  bodega: string | null | undefined,
): "si" | "no" | "por_validar" {
  if (!sucursal || !bodega) return "por_validar";
  const s = String(sucursal).trim();
  const b = String(bodega).trim();
  if (!s || !b) return "por_validar";
  if (s.toUpperCase() === b.toUpperCase()) return "si";
  const sucTokens = new Set(tokenize(s));
  const bodTokens = tokenize(b);
  for (const t of bodTokens) if (sucTokens.has(t)) return "si";
  return "no";
}
