// Verificación del store de gestión — replica VERBATIM el reducer de
// src/lib/gestion/store.ts (setGestion / loadFromStorage / saveToStorage)
// y el limpiarVIN de src/lib/parser/venta-apc.ts + clean() de normalize.ts.
// Objetivo: probar persistencia por VIN, historial acumulado y roundtrip,
// y demostrar el split de llaves entre módulos.

// ── localStorage en memoria (shim) ──
const mem = new Map();
const localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, v),
};
const KEY = "stock-command-center:gestion:v1";

// ── Copias VERBATIM desde el código real ──
function limpiarVIN(raw) {
  if (raw === null || raw === undefined) return "";
  let v = String(raw);
  v = v
    .replace(/[ ​‌‍﻿⁠]/g, "")
    .replace(/[\r\n\t]/g, "")
    .replace(/\s+/g, "")
    .replace(/[-_./]/g, "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]/g, "");
  return v;
}
function clean(s) {
  if (s === null || s === undefined) return null;
  const str = String(s).trim();
  if (str === "" || str === "#N/A" || str === "#REF!" || str === "NO") return null;
  return str;
}

const MAX_HISTORIAL = 50;
const fmtCampo = (k) =>
  ({ comentario: "Comentario", responsable: "Responsable", fechaCompromiso: "Fecha compromiso", estadoGestion: "Estado", prioridadManual: "Prioridad manual" }[k] ?? String(k));
const fmtValor = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));

function loadFromStorage() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return {};
  try {
    const p = JSON.parse(raw);
    return typeof p === "object" && p ? p : {};
  } catch {
    return {};
  }
}
function saveToStorage(map) {
  localStorage.setItem(KEY, JSON.stringify(map));
}

// setGestion replicado del store (sobre un "byVin" que se carga/guarda)
function makeStore() {
  let byVin = loadFromStorage();
  return {
    get byVin() {
      return byVin;
    },
    getOne: (vin) => byVin[vin] ?? null,
    setGestion(vin, partial) {
      const now = new Date().toISOString();
      const prev =
        byVin[vin] ?? {
          vin,
          comentario: null,
          responsable: null,
          fechaCompromiso: null,
          estadoGestion: "abierto",
          prioridadManual: null,
          historial: [],
          ultimaActualizacion: now,
        };
      const nuevas = [];
      for (const k of Object.keys(partial)) {
        if (prev[k] === partial[k]) continue;
        nuevas.push({ fecha: now, campo: fmtCampo(k), valorAnterior: fmtValor(prev[k]), valorNuevo: fmtValor(partial[k]) });
      }
      const historial = [...(prev.historial ?? []), ...nuevas].slice(-MAX_HISTORIAL);
      const next = { ...prev, ...partial, vin, historial, ultimaActualizacion: now };
      byVin = { ...byVin, [vin]: next };
      saveToStorage(byVin);
      return next;
    },
  };
}

const ok = (c, m) => console.log(`${c ? "✅" : "❌"} ${m}`);
const VIN = "KMHL14JA5LA123456"; // VIN real-style limpio

console.log("\n── 1) Guardado de campos + persistencia localStorage ──");
let store = makeStore();
store.setGestion(VIN, {
  responsable: "Gerente Comercial",
  comentario: "Revisar bloqueo de inscripción",
  fechaCompromiso: "2026-06-15",
  prioridadManual: "alta",
  estadoGestion: "en_curso",
});
let g = store.getOne(VIN);
ok(g.responsable === "Gerente Comercial", `responsable = "${g.responsable}"`);
ok(g.comentario === "Revisar bloqueo de inscripción", `comentario = "${g.comentario}"`);
ok(g.fechaCompromiso === "2026-06-15", `fechaCompromiso = "${g.fechaCompromiso}"`);
ok(g.prioridadManual === "alta", `prioridadManual = "${g.prioridadManual}"`);
ok(g.estadoGestion === "en_curso", `estado = "${g.estadoGestion}"`);
ok(mem.has(KEY), `escrito en localStorage (key ${KEY})`);
ok(g.historial.length === 5, `historial tras 1er cambio = ${g.historial.length} entradas (1 por campo)`);

console.log("\n── 2) Roundtrip: 'recargar' (nuevo store lee localStorage) ──");
store = makeStore(); // simula recargar Excel / reabrir módulo
g = store.getOne(VIN);
ok(!!g, "el VIN se recuperó desde localStorage tras recargar");
ok(g.responsable === "Gerente Comercial", `responsable recuperado = "${g.responsable}"`);
ok(g.historial.length === 5, `historial recuperado = ${g.historial.length}`);

console.log("\n── 3) Segundo cambio: responsable → Finanzas + nuevo comentario ──");
store.setGestion(VIN, { responsable: "Finanzas", comentario: "Pasa a cobranza" });
g = store.getOne(VIN);
ok(g.responsable === "Finanzas", `responsable ahora = "${g.responsable}"`);
const cambiosResp = g.historial.filter((h) => h.campo === "Responsable");
ok(cambiosResp.length === 2, `historial conserva AMBOS cambios de responsable = ${cambiosResp.length}`);
const ultimoResp = cambiosResp[cambiosResp.length - 1];
ok(
  ultimoResp.valorAnterior === "Gerente Comercial" && ultimoResp.valorNuevo === "Finanzas",
  `último cambio responsable: "${ultimoResp.valorAnterior}" → "${ultimoResp.valorNuevo}"`,
);
ok(g.historial.length === 7, `historial total = ${g.historial.length} (5 + 2 nuevos)`);

console.log("\n── 4) Persistencia del historial tras otra 'recarga' ──");
store = makeStore();
g = store.getOne(VIN);
ok(g.historial.length === 7, `historial NO se borró al recargar = ${g.historial.length}`);

console.log("\n── 5) RIESGO · split de llaves entre módulos (mismo VIN físico) ──");
const raws = ["KMHL14JA5LA123456", " kmhl14ja5la123456 ", "KMHL14JA5-LA123456", "KMHL14JA5LA123456​"];
for (const r of raws) {
  const keyVinDrill = clean(r); // Dashboard / Recuperación / Capital Trabajo / Usados / FNE
  const keyUnificado = limpiarVIN(r); // Centro de Acción / Alertas / Saldos
  const igual = keyVinDrill === keyUnificado;
  console.log(
    `   raw="${r}"\n     clean()      → "${keyVinDrill}"\n     limpiarVIN() → "${keyUnificado}"   ${igual ? "✅ misma llave" : "❌ LLAVES DISTINTAS → gestión separada"}`,
  );
}
