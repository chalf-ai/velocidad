#!/usr/bin/env node
/**
 * INVENTARIO COMPLETO de un libro Excel logístico.
 *
 * Para cada hoja reporta:
 *  - nombre
 *  - rango usado
 *  - cantidad de filas (incluyendo header)
 *  - columnas detectadas (con índice y muestras del valor en primera fila no-header)
 *  - tipos predominantes por columna (string/number/date/empty)
 *  - % de llenado por columna (cobertura de datos)
 *  - candidatos a llave: columnas con valores únicos y % alto de llenado
 *  - duplicados sobre VIN (si la columna existe)
 *  - top valores distintos en columnas categóricas (≤25 distintos)
 */
import XLSX from "xlsx";
import path from "node:path";

const FILE = process.argv[2];
if (!FILE) {
  console.error("Uso: node inventario-logistica.mjs <archivo.xlsx>");
  process.exit(1);
}

const wb = XLSX.readFile(FILE, { cellDates: true });
const fileLabel = path.basename(FILE);

console.log("════════════════════════════════════════════════════════════════════════════════");
console.log(`  INVENTARIO — ${fileLabel}`);
console.log("════════════════════════════════════════════════════════════════════════════════");
console.log(`  Total hojas: ${wb.SheetNames.length}`);
console.log(`  Hojas: ${wb.SheetNames.join(" | ")}`);
console.log("");

function detectType(v) {
  if (v === null || v === undefined || v === "") return "empty";
  if (v instanceof Date) return "date";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "string";
}

function isVinLike(s) {
  if (typeof s !== "string") return false;
  // VIN reglas: 17 chars, alfanum, sin I O Q. Aceptamos con/sin filtros estrictos.
  if (s.length < 11 || s.length > 17) return false;
  return /^[A-HJ-NPR-Z0-9]+$/i.test(s);
}

function isPlateLike(s) {
  if (typeof s !== "string") return false;
  // Chile: 4 letras + 2 dígitos / 2 letras + 4 dígitos
  return /^[A-Z]{4}\d{2}$/i.test(s) || /^[A-Z]{2}\d{4}$/i.test(s);
}

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const ref = ws["!ref"] ?? "(vacía)";
  const range = ref === "(vacía)" ? null : XLSX.utils.decode_range(ref);

  console.log(`────────────────────────────────────────────────────────────────────────────────`);
  console.log(`  HOJA: "${sheetName}"`);
  console.log(`  Rango: ${ref}`);
  if (!range) {
    console.log(`  (hoja vacía o sin datos)\n`);
    continue;
  }
  console.log(`  Dimensiones: ${range.e.r - range.s.r + 1} filas × ${range.e.c - range.s.c + 1} columnas`);

  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
  const filasDatos = rows.length;
  console.log(`  Filas con datos (sin header): ${filasDatos.toLocaleString("es-CL")}`);

  if (filasDatos === 0) {
    console.log(`  (sin filas de datos)\n`);
    continue;
  }

  // ── Columnas detectadas (raw del header — sheet_to_json usa fila 1 como header)
  // Para columnas con header duplicado o multi-row header XLSX numera A,B,C...
  // Hacemos header=1 para ver el header CRUDO y detectar headers multi-fila.
  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true, header: 1 });
  const headerRaw = rawRows[0] ?? [];
  const header2 = rawRows[1] ?? [];

  // Detectar si la fila 1 es un título/banda y la fila 2 son headers reales.
  // Heurística: si fila 1 tiene <50% de celdas no-null y fila 2 tiene >70%, fila 2 es header.
  const fr1Cov = headerRaw.filter((x) => x !== null && x !== "").length / Math.max(headerRaw.length, 1);
  const fr2Cov = header2.filter((x) => x !== null && x !== "").length / Math.max(header2.length, 1);
  let realHeaderIdx = 0;
  let headerUsado = headerRaw;
  if (fr1Cov < 0.5 && fr2Cov > 0.7) {
    realHeaderIdx = 1;
    headerUsado = header2;
  }

  // Si hubo header offset, re-extraer rows usando ese header
  let dataRows = rows;
  if (realHeaderIdx > 0) {
    const slice = rawRows.slice(realHeaderIdx);
    dataRows = slice.slice(1).map((arr) => {
      const obj = {};
      headerUsado.forEach((h, i) => {
        const key = h === null || h === undefined ? `__col${i}` : String(h);
        obj[key] = arr[i] ?? null;
      });
      return obj;
    });
    console.log(`  ⚠ Header detectado en fila ${realHeaderIdx + 1} (fila 1 parece título)`);
    console.log(`  Re-extraídas ${dataRows.length} filas de datos`);
  }

  const cols = headerUsado.map((h, i) => h === null || h === undefined ? `__col${i}` : String(h));
  console.log(`  Columnas (${cols.length}):`);
  for (let i = 0; i < cols.length; i++) {
    console.log(`    [${String(i).padStart(2)}] ${cols[i]}`);
  }

  // ── Cobertura y tipos por columna
  console.log(`\n  Cobertura + tipo dominante por columna (sobre ${dataRows.length} filas):`);
  const colStats = [];
  for (const col of cols) {
    const vals = dataRows.map((r) => r[col]);
    const filled = vals.filter((v) => v !== null && v !== undefined && v !== "").length;
    const types = { string: 0, number: 0, date: 0, boolean: 0, empty: 0 };
    for (const v of vals) types[detectType(v)]++;
    const distinct = new Set(vals.filter((v) => v !== null && v !== undefined && v !== "").map((v) => v instanceof Date ? v.toISOString() : String(v).trim())).size;
    const cov = (filled / dataRows.length * 100).toFixed(1);
    const dom = Object.entries(types).filter(([k]) => k !== "empty").sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
    colStats.push({ col, filled, distinct, cov, dom });
    console.log(`    ${col.padEnd(36)} cov=${cov.padStart(5)}%  distintos=${String(distinct).padStart(5)}  tipo=${dom}`);
  }

  // ── Candidatos a llave: columnas con distincion ≥ 95% sobre filledRows
  console.log(`\n  Candidatos a llave (distintos/filled ≥ 95%):`);
  const llaves = colStats.filter((s) => s.filled > 0 && (s.distinct / s.filled) >= 0.95);
  if (llaves.length === 0) {
    console.log(`    (ninguna)`);
  } else {
    for (const s of llaves) {
      console.log(`    ${s.col.padEnd(36)} filled=${s.filled}  distintos=${s.distinct}  cov=${s.cov}%`);
    }
  }

  // ── Detección heurística de VIN / Patente / Fecha en columnas
  console.log(`\n  Heurísticas semánticas:`);
  for (const col of cols) {
    const vals = dataRows.map((r) => r[col]).filter((v) => v !== null && v !== undefined && v !== "").slice(0, 100);
    if (vals.length === 0) continue;
    const vinHits = vals.filter((v) => isVinLike(String(v))).length;
    const plateHits = vals.filter((v) => isPlateLike(String(v))).length;
    if (vinHits / vals.length > 0.5) {
      console.log(`    "${col}" — parece VIN (${((vinHits / vals.length) * 100).toFixed(0)}% match)`);
    } else if (plateHits / vals.length > 0.5) {
      console.log(`    "${col}" — parece PATENTE (${((plateHits / vals.length) * 100).toFixed(0)}% match)`);
    }
  }

  // ── Top distintos en columnas categóricas (≤25)
  console.log(`\n  Distribución columnas categóricas (≤25 distintos):`);
  const catCols = colStats.filter((s) => s.distinct > 1 && s.distinct <= 25);
  for (const s of catCols) {
    const counts = new Map();
    for (const r of dataRows) {
      const v = r[s.col];
      const k = v === null || v === undefined ? "(null)" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`    "${s.col}":`);
    for (const [k, n] of top) {
      console.log(`         ${String(n).padStart(6)}  ${k}`);
    }
  }

  // ── Duplicados sobre VIN si la columna se llama así
  const vinCol = cols.find((c) => /^vin$/i.test(c) || /vin$/i.test(c));
  if (vinCol) {
    const counts = new Map();
    for (const r of dataRows) {
      const v = r[vinCol];
      if (v === null || v === undefined || v === "") continue;
      const k = String(v).trim().toUpperCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const dupes = [...counts.entries()].filter(([, n]) => n > 1);
    console.log(`\n  Duplicados por "${vinCol}": ${dupes.length} VINs aparecen >1 vez`);
    if (dupes.length > 0 && dupes.length <= 15) {
      for (const [vin, n] of dupes) console.log(`    ${vin} × ${n}`);
    } else if (dupes.length > 15) {
      console.log(`    (mostrando primeros 5)`);
      for (const [vin, n] of dupes.slice(0, 5)) console.log(`    ${vin} × ${n}`);
    }
  }

  console.log("");
}

console.log("════════════════════════════════════════════════════════════════════════════════");
