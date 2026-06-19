#!/usr/bin/env python3
"""
JOB AMAZON · Snapshot diario con Provisiones/FNE EN VIVO desde ROMA.

╔══════════════════════════════════════════════════════════════════════════╗
║  DESPLEGAR EN AMAZON / VPC (con acceso a ROMA MySQL).                     ║
║  NO desplegar en Railway: Railway NO alcanza ROMA (ver memoria proyecto). ║
╚══════════════════════════════════════════════════════════════════════════╝

Flujo (PR 2):
  20:00 Chile (EventBridge / crontab)
    → consulta ROMA: Provisiones >90d Venta + FNE operativo (Reporte Actas)
    → POST {VELOCIDAD_URL}/api/snapshots/daily  con body {"roma": {...}} + Bearer
    → Velocidad combina con carry-forward de Stock / Saldos / CP (snapshots activos)
      y persiste la foto del día en DailyCapitalSnapshot (idempotente, upsert).

IMPORTANTE — una sola fuente de disparo:
  El agente César (Railway) ya tiene un job 20:00 que postea SIN body (usa los
  snapshots Excel activos, fuente validada equivalente a ROMA). Cuando ESTE job
  Amazon esté activo, deshabilitar el del agente para no disparar dos veces:
  poner DAILY_SNAPSHOT_TOKEN="" en el servicio `velocidad-agent`. (Ambos hacen
  upsert sobre [fecha, scope] → la última corrida gana; aun así conviene una
  sola fuente para que Provisiones/FNE sean ROMA-vivo.)

Env requeridas:
  ROMA_DB_HOST, ROMA_DB_PORT (3306), ROMA_DB_USER, ROMA_DB_PASSWORD, ROMA_DB_NAME
  VELOCIDAD_URL            (ej. https://velocidadoperacional.pompeyo.cl)
  DAILY_SNAPSHOT_TOKEN     (MISMO valor que el servicio web de Velocidad)

Deps:  pip install pymysql httpx
"""
from __future__ import annotations

import os
import sys
import pymysql
import httpx


def _roma_conn():
    return pymysql.connect(
        host=os.environ["ROMA_DB_HOST"],
        port=int(os.environ.get("ROMA_DB_PORT", "3306")),
        user=os.environ["ROMA_DB_USER"],
        password=os.environ["ROMA_DB_PASSWORD"],
        database=os.environ["ROMA_DB_NAME"],
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=30,
        read_timeout=120,
    )


# ── FNE operativo (validado EXACTO en la auditoría FNE) ───────────────────────
# Reporte Actas → Acta Entrega = NO (EstadoActaEntregaID IN (0,1)) ∧ FechaFactura
# >= 2026-01-01. Universo reproducido: 515 reg / 514 VIN / $8.412,7M.
FNE_SQL = """
SELECT Vin, ValorFactura
FROM VT_Ventas
WHERE EstadoActaEntregaID IN (0, 1)
  AND FechaFactura >= '2026-01-01'
"""

# ── Provisiones >90d Venta (base Venta validada al 99,995% en la auditoría) ───
# AreaNegocioID = 1 (Venta) ∧ estado IN (1,2,3). saldo = GREATEST(0, monto −
# monto_factura − monto_rebaja). El filtro >90d se mide desde la fecha de
# creación de la provisión.
#   ⚠️ CONFIRMAR con el equipo ROMA el nombre exacto del campo de fecha de
#   creación (las provisiones de ROMA NO historizan el aging — ver Doc A). Si el
#   campo difiere, ajustar `fecha_creacion` abajo. Mientras tanto, el job del
#   agente (snapshots activos) cubre Provisiones con la fuente validada.
PROV_SQL = """
SELECT p.id AS id,
       GREATEST(0, p.monto - COALESCE(p.monto_factura, 0) - COALESCE(p.monto_rebaja, 0)) AS saldo,
       DATEDIFF(CURDATE(), p.fecha_creacion) AS aging_dias
FROM VT_Provisiones p
JOIN VT_ProvisionesConcepto c ON p.provision = c.ID
WHERE c.AreaNegocioID = 1
  AND p.estado IN (1, 2, 3)
"""


def consultar_roma() -> dict:
    conn = _roma_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(FNE_SQL)
            fne_rows = cur.fetchall()
            cur.execute(PROV_SQL)
            prov_rows = cur.fetchall()
    finally:
        conn.close()

    # FNE: unidades = VIN distintos; monto = Σ ValorFactura.
    vins = {r["Vin"] for r in fne_rows if r.get("Vin")}
    fne = {
        "unidades": len(vins),
        "monto": float(sum((r["ValorFactura"] or 0) for r in fne_rows)),
    }

    # Provisiones >90d: saldo ≠ 0 ∧ aging > 90.
    prov90 = [r for r in prov_rows if (r["saldo"] or 0) != 0 and (r["aging_dias"] or 0) > 90]
    provisiones = {
        "casos": len(prov90),
        "monto": float(sum(r["saldo"] for r in prov90)),
        "agingMax": max((r["aging_dias"] for r in prov90), default=None),
    }
    return {"provisiones": provisiones, "fne": fne}


def main() -> int:
    roma = consultar_roma()
    url = os.environ["VELOCIDAD_URL"].rstrip("/") + "/api/snapshots/daily"
    resp = httpx.post(
        url,
        headers={"Authorization": f"Bearer {os.environ['DAILY_SNAPSHOT_TOKEN']}"},
        json={"roma": roma},
        timeout=120,
    )
    print("ROMA →", roma, file=sys.stderr)
    if resp.status_code != 200:
        print(f"ERROR HTTP {resp.status_code}: {resp.text[:300]}", file=sys.stderr)
        return 1
    print("OK", resp.json())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
