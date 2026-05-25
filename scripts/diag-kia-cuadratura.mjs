// Cuadratura KIA — FNE (por sucursal) y Saldos (por marca) contra los Excel reales.
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const DIR = "/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/";
const up = (v) => (v == null ? "" : String(v)).toUpperCase().trim();
const num = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
const fmt = (n) => "$" + Math.round(n).toLocaleString("es-CL");

// inferirMarcaOriginadoraDesdeSucursal (copia de normalize.ts)
const MARCAS = [["KIA", "KIA MOTORS"], ["MG", "MG"], ["PEUGEOT", "PEUGEOT"], ["GEELY", "GEELY"], ["DFSK", "DFSK"], ["SUBARU", "SUBARU"], ["NISSAN", "NISSAN"], ["CITROEN", "CITROEN"], ["OPEL", "OPEL"], ["LANDKING", "LANDKING"], ["NAMMI", "NAMMI"], ["LEAP MOTOR", "LEAPMOTOR"]];
const NO_INFER = ["LOGISTICA POMPEYO", "SEMINUEVOS", "AUTOSHOPPING", "TEST CARS", "VN CON PATENTE", "CPD"];
const inferSuc = (suc) => {
  const u = up(suc); if (!u) return null;
  if (NO_INFER.some((n) => u.includes(n))) return null;
  for (const [n, c] of MARCAS) if (u.includes(n)) return c;
  return null;
};
const inc = (m, k, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
const tally = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);

// ───────────────────────── FNE ─────────────────────────
console.log("\n████ FNE KIA (Autos no entregados / ROMA) ████");
{
  const wb = XLSX.read(readFileSync(DIR + "Autos no entregados.xlsx"), { type: "buffer", cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["ROMA"], { defval: null, raw: true });
  const hoy = new Date("2026-05-20");
  let n = 0, valor = 0;
  const suc = new Map(), etapa = new Map();
  const ages = { "0-15": 0, "16-30": 0, "31-60": 0, "61+": 0, sinFecha: 0 };
  // "listo aprox" = patente recibida + autorización + solicitud entrega
  let listoAprox = 0;
  for (const r of rows) {
    if (!r.Vin) continue;
    if (inferSuc(r.Sucursal) !== "KIA MOTORS") continue;
    n++; valor += num(r.ValorFactura);
    inc(suc, r.Sucursal ?? "(s/suc)");
    inc(etapa, r.etapa ?? "(s/etapa)");
    const lista = r.autorizacion_entrega != null && r.sol_entrega != null && r.fecha_patente_recibida != null;
    if (lista) listoAprox++;
    if (!r.FechaFactura) ages.sinFecha++;
    else {
      const d = Math.floor((hoy - new Date(r.FechaFactura)) / 86400000);
      if (d <= 15) ages["0-15"]++; else if (d <= 30) ages["16-30"]++; else if (d <= 60) ages["31-60"]++; else ages["61+"]++;
    }
  }
  console.log(`Total FNE (todas sucursales): ${rows.filter((r) => r.Vin).length}`);
  console.log(`FNE KIA (sucursal infiere KIA): ${n}  ·  ${fmt(valor)}`);
  console.log(`Listos aprox (autoriz+sol+patente recibida): ${listoAprox}  ·  Bloqueados aprox: ${n - listoAprox}`);
  console.log(`Aging:`, ages);
  console.log(`Sucursales KIA en FNE:`); for (const [k, v] of tally(suc)) console.log(`   ${String(k).padEnd(28)} ${v}`);
  console.log(`Etapas:`); for (const [k, v] of tally(etapa)) console.log(`   ${String(k).padEnd(28)} ${v}`);
}

// ───────────────────────── SALDOS ─────────────────────────
console.log("\n████ SALDOS KIA (Reportes Saldos 2.0 / FUSION BD 3.0) ████");
{
  const wb = XLSX.read(readFileSync(DIR + "Reportes Saldos 2.0 18-05-2026_.xlsx"), { type: "buffer", cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["FUSION BD 3.0"], { defval: null, raw: true });
  const categorizar = (rc, rt) => {
    const c = up(rc), t = up(rt);
    if (c.includes("VEHICULO") || c.startsWith("1 ")) return "vehiculo";
    if (c.includes("BONO") || c.includes("INCENTIVO") || c.includes("COMISION") || c.startsWith("2 ")) return "bono_comision";
    if (c.includes("SERVICIO") || c.startsWith("3 ")) return "servicio";
    if (/^1\./.test(t)) return "vehiculo";
    if (/^2\./.test(t)) return "bono_comision";
    if (/^3\./.test(t)) return "servicio";
    return "desconocido";
  };
  const subPrefix = { "1.6": "credito_pompeyo", "1.7": "judicial" };
  const subTipo = (t) => { const m = (t ?? "").match(/^\s*(\d+\.\d+)/); return m ? (subPrefix[m[1]] ?? m[1]) : up(t); };
  const marcaKia = (m) => up(m).includes("KIA");

  // marcas presentes (para confirmar glosa)
  const marcas = new Map();
  for (const r of rows) if (marcaKia(r["Marca"])) inc(marcas, up(r["Marca"]));
  console.log("Glosas de marca KIA en saldos:", [...marcas.keys()]);

  const cat = { vehiculo: { n: 0, $: 0 }, bono_comision: { n: 0, $: 0 }, servicio: { n: 0, $: 0 }, desconocido: { n: 0, $: 0 } };
  let cp = 0, cpN = 0, jud = 0, judN = 0;
  const subDist = new Map();
  for (const r of rows) {
    if (!marcaKia(r["Marca"])) continue;
    const c = categorizar(r["CATEGORIA"], r["Tipo"]);
    const monto = num(r["Saldo x Documentar"]);
    cat[c].n++; cat[c].$ += monto;
    if (c === "vehiculo") {
      const st = subTipo(r["Tipo"]);
      inc(subDist, st, monto);
      if (st === "credito_pompeyo") { cp += monto; cpN++; }
      if (st === "judicial") { jud += monto; judN++; }
    }
  }
  console.log(`\nVEHÍCULO (saldo cliente):  ${cat.vehiculo.n} reg  ·  ${fmt(cat.vehiculo.$)}`);
  console.log(`   incl. Crédito Pompeyo:  ${cpN} reg  ·  ${fmt(cp)}`);
  console.log(`   incl. Judicial:         ${judN} reg  ·  ${fmt(jud)}`);
  console.log(`   vehículo SIN judicial:  ${fmt(cat.vehiculo.$ - jud)}`);
  console.log(`BONO/COMISIÓN/INCENTIVO:   ${cat.bono_comision.n} reg  ·  ${fmt(cat.bono_comision.$)}`);
  console.log(`SERVICIO (excluido):       ${cat.servicio.n} reg  ·  ${fmt(cat.servicio.$)}`);
  console.log(`DESCONOCIDO:               ${cat.desconocido.n} reg  ·  ${fmt(cat.desconocido.$)}`);
  console.log(`\nSubtipos vehículo KIA:`); for (const [k, v] of tally(subDist)) console.log(`   ${String(k).padEnd(20)} ${fmt(v)}`);
}
