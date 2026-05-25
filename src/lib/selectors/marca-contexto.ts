/**
 * Contexto por OWNER OPERACIONAL — primitiva de las vistas por marca.
 *
 * ⚠ CONCEPTO CRÍTICO (corregido): una vista por marca NO es "todos los autos
 * cuya marca física sea X". Es "todas las operaciones cuyo DUEÑO OPERACIONAL es
 * X". Son dos dimensiones distintas:
 *
 *   1) Marca física del vehículo  → marca/marcaPompeyo. Sirve para identificar
 *      el auto (modelo, versión, mix). NO define a quién pertenece la operación.
 *   2) Owner operacional / originador → quién gestiona el capital, la línea, el
 *      FNE, los saldos, las provisiones. ESTO es lo que usa una vista por marca.
 *
 * Ejemplos que esta lógica resuelve:
 *   - KIA físico vendido por USADOS            → owner USADOS  (NO KIA)
 *   - KIA físico tomado por GEELY (parte pago) → owner GEELY   (NO KIA)
 *   - Toyota tomado por KIA (parte de pago)    → owner KIA     (aunque sea Toyota)
 *   - KIA en seminuevos / renting / company    → owner USADOS/RENTING/COMPANY
 *   - VN KIA nuevo en stock                     → owner KIA
 *
 * Fuente de verdad del owner: campos OPERACIONALES de Base_Stock ya derivados
 * por el parser (marcaOriginadora, naturalezaCapital, destinoOperacional,
 * tipoDeStock, condicionDeStock, esVPPComprometido). Este módulo NO toca el
 * parser: solo decide el owner a partir de lo ya parseado.
 *
 * Módulo PURO: sin estado, sin React, sin side effects.
 */

import type { LineaCredito, Vehiculo } from "../types";
import { limpiarVIN } from "../parser/venta-apc";
import { inferirMarcaOriginadoraDesdeSucursal } from "../parser/normalize";

// ── Owners operacionales canónicos ────────────────────────────────────────
export const OWNER_KIA = "KIA MOTORS";
export const OWNER_USADOS = "USADOS";
export const OWNER_RENTING = "RENTING";
export const OWNER_COMPANY = "COMPANY CAR";
export const OWNER_TESCAR = "TEST CARS";
export const OWNER_VDR = "VDR";
export const OWNER_INTERNO = "USO INTERNO";
export const OWNER_SIN = "SIN OWNER OPERACIONAL";

export const SIN_SUCURSAL = "(sin sucursal)";

function up(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().trim();
}

/**
 * Resuelve el OWNER OPERACIONAL de un vehículo de Base_Stock.
 *
 * Orden de decisión (importa): primero se separan los destinos/usos que NO
 * pertenecen a la marca física (usados, renting, company, test, VPP), y solo
 * después se atribuye a la marca del VN. Si no, un usado KIA caería como KIA.
 */
export function obtenerOwnerOperacional(v: Vehiculo): string {
  const cond = up(v.condicionDeStock);
  const tipo = up(v.tipoDeStock);
  const condV = up(v.condicionVehiculo);
  const suc = up(v.sucursal);

  // 1) Capital puente / VPP: owner = marca que TOMÓ el usado en parte de pago.
  //    Se infiere desde la sucursal marca-específica (KIA REDCUBE → KIA MOTORS).
  //    Cubre "Toyota tomado por KIA → KIA". Si no es atribuible a una marca,
  //    queda en USADOS (no se atribuye a la marca física del usado).
  if (v.esVPPComprometido || v.naturalezaCapital === "puente") {
    if (
      v.marcaOriginadora &&
      (v.marcaOriginadoraFuente === "sucursal_marca_especifica" ||
        v.marcaOriginadoraFuente === "venta_apc_link")
    ) {
      return up(v.marcaOriginadora);
    }
    return OWNER_USADOS;
  }

  // 2) Destinos NO retail — por CLASIFICACIÓN del vehículo y por sucursal de
  //    destino especial (renting/company/test). NO se excluye un KIA vendible
  //    por estar en bodega logística; sí se excluye lo marcado no-vendible.
  if (v.destinoOperacional === "renting" || cond.includes("RENTING") || suc.includes("RENTING")) {
    return OWNER_RENTING;
  }
  if (
    v.destinoOperacional === "company" ||
    cond.includes("COMPANY") ||
    suc.includes("COMPANY") ||
    tipo.includes("COMPAÑ") ||
    tipo.includes("COMPAN")
  ) {
    return OWNER_COMPANY;
  }
  if (v.destinoOperacional === "vdr") return OWNER_VDR;
  if (v.destinoOperacional === "interno") return OWNER_INTERNO;
  // Test car NO vendible: stock TEST CARS, demo EN USO, o sucursal TEST CARS.
  // Los demo vendibles (floor plan nuevo, VN con patente) NO se excluyen.
  if (cond.includes("TEST CAR") || condV.includes("TEST CAR EN USO") || suc.includes("TEST CAR")) {
    return OWNER_TESCAR;
  }

  // 3) Usados (no VPP) → USADOS. Seminuevos/Autoshopping son universos de
  //    usados inequívocos (no hay sucursal de marca llamada así).
  if (
    tipo.includes("USADO") ||
    cond.includes("USADO") ||
    cond.startsWith("VU") ||
    suc.includes("SEMINUEVO") ||
    suc.includes("AUTOSHOPPING")
  ) {
    return OWNER_USADOS;
  }

  // 4) VN de marca. La SUCURSAL marca-específica define el owner operacional:
  //    un KIA en "GEELY PLAZA OESTE" es operación Geely, no KIA. Si la sucursal
  //    NO es marca-específica (logística, casa matriz, bodega, VN con patente),
  //    se usa la marca del VN.
  const sucMarca = inferirMarcaOriginadoraDesdeSucursal(v.sucursal);
  if (sucMarca) return sucMarca;
  if (v.marcaOriginadora && v.confianzaMarcaOriginadora !== "ninguna") {
    return up(v.marcaOriginadora);
  }
  if (v.marcaLinea) return up(v.marcaLinea);
  if (tipo.includes("NUEVO") && v.marcaPompeyo) return up(v.marcaPompeyo);
  return OWNER_SIN;
}

/** ¿El vehículo pertenece operacionalmente a este owner? */
export function esOwner(v: Vehiculo, owner: string): boolean {
  return obtenerOwnerOperacional(v) === up(owner);
}

/**
 * Owner operacional inferido SOLO desde la sucursal (marca-específica).
 * Útil para fuentes que no tienen marca/VIN confiable pero sí sucursal de
 * negocio: FNE (Autos no entregados) y bonos/comisiones de Saldos.
 * Devuelve la marca canónica ("KIA MOTORS", "GEELY", …) o null.
 */
export function ownerPorSucursal(sucursal: string | null | undefined): string | null {
  return inferirMarcaOriginadoraDesdeSucursal(sucursal ?? null);
}

/** ¿La glosa de marca corresponde al owner? (para Saldos vehículo / Provisiones,
 *  que traen marca/origen propios). Match por token canónico, no substring. */
export function marcaGlosaEsOwner(marca: string | null | undefined, owner: string): boolean {
  const o = up(owner);
  const m = up(marca);
  if (!m) return false;
  if (m === o) return true;
  const token = o.split(" ")[0];
  return m.split(/[ /\-]+/).filter(Boolean).includes(token);
}

/** Vehículos de Base_Stock cuyo owner operacional == owner. */
export function filtrarVehiculosPorOwner(vehiculos: Vehiculo[], owner: string): Vehiculo[] {
  const o = up(owner);
  return vehiculos.filter((v) => obtenerOwnerOperacional(v) === o);
}

/**
 * Set de vinLimpio cuyo owner operacional == owner. Es el puente para filtrar el
 * universo unificado (VehiculoUnificado), que se indexa por vinLimpio y no
 * carga la dimensión de owner.
 */
export function vinsPorOwner(vehiculos: Vehiculo[], owner: string): Set<string> {
  const o = up(owner);
  const set = new Set<string>();
  for (const v of vehiculos) {
    if (obtenerOwnerOperacional(v) !== o) continue;
    const vl = limpiarVIN(v.vin);
    if (vl) set.add(vl);
  }
  return set;
}

/**
 * Línea de crédito del owner — la línea ES, por definición, de la marca
 * operacional. Aquí el match por glosa de marca SÍ es válido (la línea no es un
 * vehículo físico). "KIA" y "KIA MOTORS" se consideran la misma línea.
 */
export function filtrarLineasOwner(lineas: LineaCredito[], owner: string): LineaCredito[] {
  const o = up(owner);
  const token = o.split(" ")[0];
  const tk = (s: string) => s.split(/[ /\-]+/).filter(Boolean);
  return lineas.filter((l) => {
    const mp = up(l.marcaPompeyo);
    const m = up(l.marca);
    if (mp === o || m === o) return true;
    if (token.length >= 2 && (tk(mp).includes(token) || tk(m).includes(token))) return true;
    return false;
  });
}
