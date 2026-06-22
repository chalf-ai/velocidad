import "server-only";
import { romaQuery } from "@/lib/roma";

/**
 * Velocidad Comercial · capa de datos de la COLA.
 * Verdad: cesar-core/04-velocity-comercial/V2-ontologia-y-principios.md.
 * Universo = núcleo gestionable: vigentes (VT_Ventas no facturadas ≤90d) CON señal
 * (VPP activa / crédito sin firmar / sin VIN). NO incluye aprobados de cotización.
 */

const WINDOW_DIAS = 90;

export type EstadoDominante = "VPP activa" | "crédito sin firmar" | "sin VIN";
export type EstadoVida = "vivo" | "agonizando" | "muerto operativo";

export type ColaItem = {
  negocioId: number;
  tipo: "vigente";
  cliente: string;
  pompeyo: boolean;
  modelo: string;
  vin: string | null;
  sinVin: boolean;
  rung: 5 | 4 | 3;
  estadoDominante: EstadoDominante;
  perecibilidad: number;
};

export type PortadaModelo = {
  modelo: string;
  total: number;
  vpp: number;
  sinFirmar: number;
  sinVin: number;
  perecMax: number;
};

export type NegocioDetalle = ColaItem & {
  estadoVida: EstadoVida;
  bloqueo: string;
  dueno: string;
  jugada: string;
};

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const WHERE_UNIVERSO =
  "v.FechaFactura IS NULL " +
  `AND v.FechaVenta >= CURDATE()-INTERVAL ${WINDOW_DIAS} DAY ` +
  "AND (vp.activa=1 OR v.CreditoFirmado=2 OR v.Vin IS NULL OR v.Vin IN ('','0'))";

const JOIN_VPP =
  "LEFT JOIN (SELECT VentaID, MAX(Activo) activa FROM VT_Vpp WHERE Activo=1 GROUP BY VentaID) vp ON vp.VentaID=v.ID";

const RUNG_SQL = "CASE WHEN vp.activa=1 THEN 5 WHEN v.CreditoFirmado=2 THEN 4 ELSE 3 END";

function estadoDominante(rung: number): EstadoDominante {
  return rung === 5 ? "VPP activa" : rung === 4 ? "crédito sin firmar" : "sin VIN";
}
function estadoVida(perec: number): EstadoVida {
  return perec <= 15 ? "vivo" : perec <= 30 ? "agonizando" : "muerto operativo";
}
function bloqueoDe(e: EstadoDominante): string {
  return e === "VPP activa"
    ? "Venta vigente con VPP pendiente de cierre / facturación"
    : e === "crédito sin firmar"
    ? "Crédito sin firmar"
    : "Falta asignación de VIN";
}
function duenoDe(e: EstadoDominante): string {
  return e === "VPP activa"
    ? "Responsable comercial / jefe de ventas"
    : e === "crédito sin firmar"
    ? "Crédito / cliente"
    : "Stock / logística";
}
function jugadaDe(e: EstadoDominante): string {
  return e === "VPP activa"
    ? "Destrabar cierre de vigente con VPP"
    : e === "crédito sin firmar"
    ? "Destrabar firma de crédito"
    : "Asignar VIN o reubicar stock";
}

/** PORTADA — modelos como puertas a colas. */
export async function getPortadaModelos(): Promise<PortadaModelo[]> {
  const rows = await romaQuery<Record<string, unknown>>(
    `SELECT modelo, COUNT(*) total,
            SUM(rung=5) vpp, SUM(rung=4) sin_firmar, SUM(rung=3) sin_vin,
            MAX(perec) perec_max
     FROM (
       SELECT UPPER(TRIM(m.Modelo)) modelo, ${RUNG_SQL} rung,
              DATEDIFF(CURDATE(), v.FechaVenta) perec
       FROM VT_Ventas v
       JOIN MA_Modelos m ON m.ID=v.ModeloID
       ${JOIN_VPP}
       WHERE ${WHERE_UNIVERSO}
     ) t
     GROUP BY modelo
     ORDER BY total DESC`,
  );
  return rows.map((r) => ({
    modelo: String(r.modelo),
    total: num(r.total),
    vpp: num(r.vpp),
    sinFirmar: num(r.sin_firmar),
    sinVin: num(r.sin_vin),
    perecMax: num(r.perec_max),
  }));
}

const _safeModelo = (m: string) => (m || "").replace(/[^A-Za-z0-9 ]/g, "").trim().toUpperCase().slice(0, 40);

function mapItem(r: Record<string, unknown>): ColaItem {
  const rung = num(r.rung) as 5 | 4 | 3;
  const nombre = `${String(r.nombre ?? "").trim()} ${String(r.apellido ?? "").trim()}`.trim() || "Cliente s/n";
  return {
    negocioId: num(r.negocio_id),
    tipo: "vigente",
    cliente: nombre,
    pompeyo: num(r.pompeyo) > 0,
    modelo: String(r.modelo),
    vin: r.vin ? String(r.vin) : null,
    sinVin: num(r.sin_vin) > 0,
    rung,
    estadoDominante: estadoDominante(rung),
    perecibilidad: num(r.perec),
  };
}

/** NIVEL 2 — cola de un modelo. Orden: rung desc, perecibilidad desc. */
export async function getCola(modelo: string): Promise<ColaItem[]> {
  const m = _safeModelo(modelo);
  if (!m) return [];
  const rows = await romaQuery<Record<string, unknown>>(
    `SELECT v.ID negocio_id, cl.Nombre nombre, cl.Apellido apellido,
            UPPER(TRIM(mo.Modelo)) modelo, v.Vin vin,
            (v.Vin IS NULL OR v.Vin IN ('','0')) sin_vin,
            ${RUNG_SQL} rung,
            DATEDIFF(CURDATE(), v.FechaVenta) perec,
            EXISTS(SELECT 1 FROM VT_Ventas v2 WHERE v2.ClienteID=v.ClienteID AND v2.FechaFactura IS NOT NULL AND v2.ID<>v.ID) pompeyo
     FROM VT_Ventas v
     JOIN MA_Modelos mo ON mo.ID=v.ModeloID
     LEFT JOIN MA_Clientes cl ON cl.ID=v.ClienteID
     ${JOIN_VPP}
     WHERE ${WHERE_UNIVERSO} AND UPPER(TRIM(mo.Modelo))=?
     ORDER BY rung DESC, perec DESC`,
    [m],
  );
  return rows.map(mapItem);
}

/** NIVEL 3 — un negocio reducido a su jugada. */
export async function getNegocio(tipo: string, id: number): Promise<NegocioDetalle | null> {
  if (tipo !== "vigente" || !Number.isFinite(id)) return null;
  const rows = await romaQuery<Record<string, unknown>>(
    `SELECT v.ID negocio_id, cl.Nombre nombre, cl.Apellido apellido,
            UPPER(TRIM(mo.Modelo)) modelo, v.Vin vin,
            (v.Vin IS NULL OR v.Vin IN ('','0')) sin_vin,
            ${RUNG_SQL} rung,
            DATEDIFF(CURDATE(), v.FechaVenta) perec,
            EXISTS(SELECT 1 FROM VT_Ventas v2 WHERE v2.ClienteID=v.ClienteID AND v2.FechaFactura IS NOT NULL AND v2.ID<>v.ID) pompeyo
     FROM VT_Ventas v
     JOIN MA_Modelos mo ON mo.ID=v.ModeloID
     LEFT JOIN MA_Clientes cl ON cl.ID=v.ClienteID
     ${JOIN_VPP}
     WHERE v.ID=? AND ${WHERE_UNIVERSO}`,
    [id],
  );
  if (rows.length === 0) return null;
  const item = mapItem(rows[0]);
  return {
    ...item,
    estadoVida: estadoVida(item.perecibilidad),
    bloqueo: bloqueoDe(item.estadoDominante),
    dueno: duenoDe(item.estadoDominante),
    jugada: jugadaDe(item.estadoDominante),
  };
}
