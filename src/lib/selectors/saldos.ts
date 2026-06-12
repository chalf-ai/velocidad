/**
 * Selector del módulo Saldos. Hace dos cosas:
 *  1. Cruza cada saldo con stock + FNE por Cajón ↔ VIN (cuando aplique).
 *  2. Agrega estadísticas por categoría / sub-tipo / status / empresa.
 *
 * Regla clave: solo `categoria === "vehiculo"` se intenta cruzar con VIN.
 * Los bonos/comisiones y servicios NO se cruzan (son facturas administrativas).
 *
 * Excluimos los servicios de los KPIs principales: son post-venta, no son
 * venta. El usuario los puede mostrar opcionalmente pero por defecto no se
 * cuentan como "Capital de Trabajo".
 */

import type {
  AutoNoEntregado,
  CategoriaSaldo,
  EmpresaPompeyo,
  ParsedFNE,
  SaldoCruzado,
  SaldoRegistro,
  SaldosStats,
  StatusDPS,
  SubTipoSaldoVehiculo,
  Vehiculo,
  VINSupplementary,
} from "../types";
import { limpiarVIN } from "../parser/venta-apc";
import { pareceePatente } from "../parser/saldos";

/** Bridge Cajón → VIN consolidado desde stock activo, ventas históricas y FNE. */
function buildBridgeCajonToVIN(
  vehiculos: Vehiculo[],
  vinsExtra: Map<string, VINSupplementary> | null,
  fne: ParsedFNE | null,
): { cajonToVIN: Map<string, string>; patenteToVIN: Map<string, string> } {
  const cajonToVIN = new Map<string, string>();
  const patenteToVIN = new Map<string, string>();

  const addCajon = (cajon: string, vin: string) => {
    if (!cajonToVIN.has(cajon)) cajonToVIN.set(cajon, vin);
  };
  const addPatente = (patente: string | null, vin: string) => {
    if (!patente) return;
    const p = patente.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (p.length >= 6 && !patenteToVIN.has(p)) patenteToVIN.set(p, vin);
  };

  // Base_Stock: Cajón ≈ últimos 8 chars VIN
  for (const v of vehiculos) {
    const vinL = limpiarVIN(v.vin);
    if (vinL.length !== 17) continue;
    addCajon(vinL.slice(-8), vinL);
    addPatente(v.patente, vinL);
  }

  // Venta APC / Financiado (suplementario): mismo Cajón = últimos 8
  if (vinsExtra) {
    for (const [vinL, info] of vinsExtra) {
      addCajon(vinL.slice(-8), vinL);
      addPatente(info.patente, vinL);
    }
  }

  // FNE: tiene Cajón explícito + VIN
  if (fne) {
    for (const r of fne.registros) {
      const vinL = limpiarVIN(r.vin);
      if (vinL.length !== 17) continue;
      const cajonL = (r.cajon ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (cajonL.length >= 6) addCajon(cajonL, vinL);
      addCajon(vinL.slice(-8), vinL);
    }
  }

  return { cajonToVIN, patenteToVIN };
}

/**
 * ENRIQUECIMIENTO OFICIAL · resuelve y escribe `s.vinResuelto` en cada saldo
 * de categoría "vehiculo" vía bridge Cajón/Patente → VIN (stock + ventas
 * históricas + FNE).
 *
 * Es el ÚNICO punto del sistema que muta `vinResuelto` (deuda saldada
 * 2026-06: antes la mutación vivía escondida dentro del cruce que ejecutaba
 * el Score Gerencial, y el resultado de la atribución dependía del ORDEN de
 * ejecución). Reglas:
 *   · Determinista: SIEMPRE escribe (incluido null si el bridge no resuelve)
 *     — el estado final depende solo de los inputs del último llamado, no de
 *     qué corrió antes.
 *   · Idempotente con los mismos inputs.
 *   · Todo flujo que LEA `vinResuelto` debe llamar a esta función (o a
 *     `cruzarSaldosConStock`, que la invoca declaradamente) con el stock/FNE
 *     vigentes de su contexto.
 */
export function resolverVinsSaldos(
  saldos: SaldoRegistro[],
  vehiculos: Vehiculo[],
  vinsExtra: Map<string, VINSupplementary> | null,
  fne: ParsedFNE | null,
): { cajonToVIN: Map<string, string>; patenteToVIN: Map<string, string> } {
  const { cajonToVIN, patenteToVIN } = buildBridgeCajonToVIN(vehiculos, vinsExtra, fne);
  for (const s of saldos) {
    if (s.categoria !== "vehiculo") continue;
    const cajon = s.cajonLimpio ?? "";
    let vin: string | null = null;
    if (cajon) {
      if (pareceePatente(cajon) && patenteToVIN.has(cajon)) vin = patenteToVIN.get(cajon)!;
      else if (cajonToVIN.has(cajon)) vin = cajonToVIN.get(cajon)!;
    }
    s.vinResuelto = vin;
  }
  return { cajonToVIN, patenteToVIN };
}

/**
 * Cruza cada saldo con stock/FNE. Solo los de categoría "vehiculo" se
 * intentan cruzar; los demás quedan con tipoMatch="no_aplica".
 *
 * NOTA: invoca `resolverVinsSaldos` (enriquecimiento declarado de
 * `vinResuelto`) antes de construir los cruzados.
 */
export function cruzarSaldosConStock(
  saldos: SaldoRegistro[],
  vehiculos: Vehiculo[],
  vinsExtra: Map<string, VINSupplementary> | null,
  fne: ParsedFNE | null,
): SaldoCruzado[] {
  const { patenteToVIN } = resolverVinsSaldos(saldos, vehiculos, vinsExtra, fne);

  // Index VIN → Vehiculo y VIN → AutoNoEntregado
  const vehByVin = new Map<string, Vehiculo>();
  for (const v of vehiculos) {
    const k = limpiarVIN(v.vin);
    if (k && !vehByVin.has(k)) vehByVin.set(k, v);
  }
  const fneByVin = new Map<string, AutoNoEntregado>();
  if (fne) {
    for (const r of fne.registros) {
      const k = limpiarVIN(r.vin);
      if (k && !fneByVin.has(k)) fneByVin.set(k, r);
    }
  }

  return saldos.map<SaldoCruzado>((s) => {
    if (s.categoria !== "vehiculo") {
      return { saldo: s, vehiculo: null, vehiculoExtra: null, fne: null, tipoMatch: "no_aplica" };
    }
    // vinResuelto ya viene del enriquecimiento oficial (resolverVinsSaldos).
    const vin = s.vinResuelto;
    const cajon = s.cajonLimpio ?? "";
    const tipoMatch: SaldoCruzado["tipoMatch"] = !vin
      ? "no_match"
      : pareceePatente(cajon) && patenteToVIN.get(cajon) === vin
        ? "patente"
        : "exacto";

    const veh = vin ? vehByVin.get(vin) ?? null : null;
    const extra = vin && !veh ? vinsExtra?.get(vin) ?? null : null;
    const fneRec = vin ? fneByVin.get(vin) ?? null : null;

    return { saldo: s, vehiculo: veh, vehiculoExtra: extra, fne: fneRec, tipoMatch };
  });
}

const SUBTIPOS_VEHICULO: SubTipoSaldoVehiculo[] = [
  "financieras",
  "leasing",
  "seguros",
  "flotas",
  "traspasos_dealer",
  "credito_pompeyo",
  "judicial",
  "buy_back",
  "acuerdo_comercial",
  "oc_marca",
  "indefinido",
];

const STATUSES: StatusDPS[] = [
  "Por Vencer",
  "T1",
  "T2",
  "T3",
  "T4",
  "T5",
  "T6",
  "T7",
  "Desconocido",
];

const EMPRESAS: EmpresaPompeyo[] = ["PC Automoviles", "PC Spa", "Desconocido"];

export function statsSaldos(cruzados: SaldoCruzado[]): SaldosStats {
  const empty = () => ({ unidades: 0, saldoCLP: 0 });
  const porCategoria: SaldosStats["porCategoria"] = {
    vehiculo: empty(),
    bono_comision: empty(),
    servicio: empty(),
    desconocido: empty(),
  };
  const porSubTipoVehiculo: SaldosStats["porSubTipoVehiculo"] = Object.fromEntries(
    SUBTIPOS_VEHICULO.map((k) => [k, empty()]),
  ) as SaldosStats["porSubTipoVehiculo"];
  const porStatusDPS: SaldosStats["porStatusDPS"] = Object.fromEntries(
    STATUSES.map((k) => [k, empty()]),
  ) as SaldosStats["porStatusDPS"];
  const porEmpresa: SaldosStats["porEmpresa"] = Object.fromEntries(
    EMPRESAS.map((k) => [k, empty()]),
  ) as SaldosStats["porEmpresa"];

  let saldoTotalCLP = 0;
  let vehiculoCruzados = 0;
  let vehiculoSinCruce = 0;

  for (const c of cruzados) {
    const s = c.saldo;
    const cat = s.categoria;
    saldoTotalCLP += s.saldoXDocumentar;
    porCategoria[cat].unidades++;
    porCategoria[cat].saldoCLP += s.saldoXDocumentar;
    porStatusDPS[s.statusDPS].unidades++;
    porStatusDPS[s.statusDPS].saldoCLP += s.saldoXDocumentar;
    porEmpresa[s.empresa].unidades++;
    porEmpresa[s.empresa].saldoCLP += s.saldoXDocumentar;
    if (cat === "vehiculo") {
      const sub = s.subTipo as SubTipoSaldoVehiculo;
      const bucket = porSubTipoVehiculo[sub] ?? porSubTipoVehiculo["indefinido"];
      bucket.unidades++;
      bucket.saldoCLP += s.saldoXDocumentar;
      if (c.tipoMatch === "exacto" || c.tipoMatch === "patente") vehiculoCruzados++;
      else vehiculoSinCruce++;
    }
  }

  return {
    total: cruzados.length,
    saldoTotalCLP,
    porCategoria,
    porSubTipoVehiculo,
    porStatusDPS,
    porEmpresa,
    vehiculoCruzados,
    vehiculoSinCruce,
  };
}

// ── Selector único de filtrado ──────────────────────────────────────────
//
// FUENTE ÚNICA DE VERDAD para el módulo Saldos. KPI, count, tabla, drill,
// export y gestión deben pasar por aquí para que NUNCA haya "13 arriba y 14
// abajo". Si un KPI y su drill usan los mismos `FiltrosSaldos`, el universo
// es idéntico por construcción.

export interface FiltrosSaldos {
  /** Incluir servicios post-venta. Por defecto false (no son capital de venta). */
  incluirServicios?: boolean;
  /** Excluir judicial (universo de aging operacional / velocidad). */
  soloOperacional?: boolean;
  /** "todos" o nombre exacto de sucursal. */
  sucursal?: string;
  /** Restringir a estos status DPS (aging). null/[] = todos. */
  statuses?: StatusDPS[] | null;
  /** Restringir a una categoría macro. */
  categoria?: CategoriaSaldo | "todos";
  /** Restringir a un sub-tipo de vehículo. */
  subTipo?: SubTipoSaldoVehiculo | "todos";
  /** Familia: restringe a vehículo + estos sub-tipos. */
  familiaSubs?: SubTipoSaldoVehiculo[] | null;
  /** Familia servicios: restringe a categoría servicio. */
  familiaServicio?: boolean;
}

export function filtrarSaldos(cruzados: SaldoCruzado[], f: FiltrosSaldos): SaldoCruzado[] {
  const inclServ = f.incluirServicios ?? false;
  const suc = f.sucursal ?? "todos";
  return cruzados.filter((c) => {
    const s = c.saldo;
    if (!inclServ && s.categoria === "servicio") return false;
    if (f.soloOperacional && s.categoria === "vehiculo" && s.subTipo === "judicial") return false;
    if (suc !== "todos" && s.sucursal !== suc) return false;
    if (f.statuses && f.statuses.length > 0 && !f.statuses.includes(s.statusDPS)) return false;
    if (f.familiaServicio) return s.categoria === "servicio";
    if (f.familiaSubs && f.familiaSubs.length > 0) {
      return (
        s.categoria === "vehiculo" &&
        f.familiaSubs.includes(s.subTipo as SubTipoSaldoVehiculo)
      );
    }
    if (f.categoria && f.categoria !== "todos" && s.categoria !== f.categoria) return false;
    if (f.subTipo && f.subTipo !== "todos" && s.subTipo !== f.subTipo) return false;
    return true;
  });
}

/** Suma de saldoXDocumentar de un conjunto cruzado. */
export function sumSaldos(cruzados: SaldoCruzado[]): number {
  return cruzados.reduce((s, c) => s + c.saldo.saldoXDocumentar, 0);
}

// ── Labels y orden visual ───────────────────────────────────────────────

export const CATEGORIA_LABEL: Record<CategoriaSaldo, string> = {
  vehiculo: "Saldos de vehículos",
  bono_comision: "Bonos · incentivos · comisiones",
  servicio: "Servicios (post-venta)",
  desconocido: "Sin categoría",
};

export const CATEGORIA_DESC: Record<CategoriaSaldo, string> = {
  vehiculo: "Saldos por documentar asociados a un VIN específico. Cruzan con stock y FNE.",
  bono_comision:
    "Facturas administrativas (bonos, incentivos, comisiones) sin VIN/Cajón. Son uso de capital de trabajo pero no se atan a un auto.",
  servicio:
    "Post-venta (servicio técnico). NO entran al cálculo de capital de trabajo de ventas.",
  desconocido: "Saldos sin categoría reconocida.",
};

export const SUBTIPO_VEHICULO_LABEL: Record<SubTipoSaldoVehiculo, string> = {
  financieras: "Financieras",
  leasing: "Leasing",
  seguros: "Compañía de seguro",
  flotas: "Flotas",
  traspasos_dealer: "Traspasos Dealer",
  credito_pompeyo: "Crédito Pompeyo",
  judicial: "Judicial",
  buy_back: "Buy Back",
  acuerdo_comercial: "Acuerdo Comercial",
  oc_marca: "OC Marca",
  indefinido: "Indefinido",
};

export const STATUS_DPS_LABEL: Record<StatusDPS, string> = {
  "Por Vencer": "Por vencer (0-6d)",
  T1: "T1 · 7-13d",
  T2: "T2 · 14-29d",
  T3: "T3 · 30-60d",
  T4: "T4 · 61-90d",
  T5: "T5 · 91-120d",
  T6: "T6 · 121-364d",
  T7: "T7 · +364d",
  Desconocido: "Sin status",
};

export const STATUS_DPS_TONE: Record<
  StatusDPS,
  "success" | "info" | "warning" | "danger" | "muted"
> = {
  "Por Vencer": "info",
  T1: "info",
  T2: "warning",
  T3: "warning",
  T4: "danger",
  T5: "danger",
  T6: "danger",
  T7: "danger",
  Desconocido: "muted",
};

export const STATUS_DPS_ORDEN: StatusDPS[] = [
  "Por Vencer",
  "T1",
  "T2",
  "T3",
  "T4",
  "T5",
  "T6",
  "T7",
  "Desconocido",
];

export const SUBTIPO_VEHICULO_ORDEN: SubTipoSaldoVehiculo[] = [
  "financieras",
  "leasing",
  "seguros",
  "flotas",
  "credito_pompeyo",
  "buy_back",
  "acuerdo_comercial",
  "oc_marca",
  "traspasos_dealer",
  "judicial",
  "indefinido",
];
