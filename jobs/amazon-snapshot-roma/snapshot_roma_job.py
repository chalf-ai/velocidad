#!/usr/bin/env python3
"""
JOB AMAZON · Snapshot diario con datos EN VIVO desde ROMA — FUENTE OFICIAL.

╔══════════════════════════════════════════════════════════════════════════╗
║  DESPLEGAR EN AMAZON / VPC (acceso directo a ROMA MySQL — ya existe).     ║
║  Es la FUENTE OFICIAL del snapshot diario. Railway solo recibe/persiste.  ║
╚══════════════════════════════════════════════════════════════════════════╝

Flujo Amazon-first (PR 2):
  20:00 Chile (EventBridge / crontab Amazon)
    → consulta ROMA vivo
    → POST {VELOCIDAD_URL}/api/snapshots/daily  body {"roma": {...}} + Bearer
    → Velocidad persiste (FNE = ROMA vivo; Caja/desglose/CP/Saldos desde sus
      snapshots Stock/Saldos activos — NO son ROMA, son carga propia de Velocidad).

Estado de las fuentes ROMA (validado en vivo 2026-06-19 vía conexión directa):
  · FNE operativo  → REPRODUCIBLE EXACTO desde ROMA. ACTIVO en este job.
      VT_Ventas · EstadoActaEntregaID IN (0,1) ∧ FechaFactura >= '2026-01-01'
      Vivo hoy: 514 reg / 513 VIN / $8.393,6M  (vs corte Excel 17-jun: 514 VIN/$8.4B).
  · Provisiones >90d Venta → PENDIENTE del SQL exacto del reporte ROMA
      "Provisiones de Ingreso". NO reproducible con query directa: 3 intentos en
      vivo dieron 4.831 / 1.940 (saldo −$9,5B) / 386·$574,9M — ninguno = el oficial
      de Velocidad (104 · $370,5M). Difieren la referencia de aging (718d vs 553d)
      y el tratamiento de saldo. Es la pregunta abierta de la auditoría (Doc A).
      MIENTRAS no se confirme: este job NO postea Provisiones → el endpoint usa el
      snapshot activo (el Excel "Provisiones de Ingreso" ES ese reporte ROMA,
      exportado a mano). Eso NO es "reconstruir ROMA": es el mismo reporte.
      Cuando el equipo ROMA confirme el SQL, poner PROVISIONES_ENABLED=1.

Env:  ROMA_DB_{HOST,PORT,USER,PASSWORD,NAME}, VELOCIDAD_URL, DAILY_SNAPSHOT_TOKEN
Deps: pip install pymysql httpx
"""
from __future__ import annotations

import os
import sys
import pymysql
import httpx

PROVISIONES_ENABLED = os.environ.get("PROVISIONES_ENABLED", "0") == "1"


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


# ── FNE operativo (VALIDADO EXACTO contra ROMA vivo) ──────────────────────────
# Reporte Actas → Acta Entrega = NO (EstadoActaEntregaID IN (0,1)) ∧ FechaFactura
# >= 2026-01-01. unidades = VIN distintos; monto = Σ ValorFactura.
FNE_SQL = """
SELECT COUNT(DISTINCT Vin) AS unidades,
       SUM(ValorFactura)   AS monto
FROM VT_Ventas
WHERE EstadoActaEntregaID IN (0, 1)
  AND FechaFactura >= '2026-01-01'
"""

# ── Provisiones >90d Venta — ⚠️ PENDIENTE confirmar con el equipo ROMA ────────
# Base Venta validada (AreaNegocioID=1 ∧ estado IN(1,2,3)), pero el filtro >90d
# del reporte "Provisiones de Ingreso" NO es reproducible con esta query (ver
# cabecera). NO usar en producción hasta confirmar referencia de aging + ventana
# de período + tratamiento de saldo. Placeholder para cuando se confirme:
PROV_SQL = """
SELECT COUNT(*) AS casos,
       SUM(GREATEST(0, p.monto - COALESCE(p.monto_factura,0) - COALESCE(p.monto_rebaja,0))) AS monto,
       MAX(DATEDIFF(CURDATE(), p.fecha)) AS aging_max
FROM VT_Provisiones p
JOIN VT_ProvisionesConcepto c ON p.provision = c.ID
WHERE c.AreaNegocioID = 1
  AND p.estado IN (1, 2, 3)
  -- TODO equipo ROMA: ventana de período + referencia de aging del reporte oficial
"""


def consultar_roma() -> dict:
    conn = _roma_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(FNE_SQL)
            fne_row = cur.fetchone()
            prov_row = None
            if PROVISIONES_ENABLED:
                cur.execute(PROV_SQL)
                prov_row = cur.fetchone()
    finally:
        conn.close()

    roma: dict = {
        "fne": {
            "unidades": int(fne_row["unidades"] or 0),
            "monto": float(fne_row["monto"] or 0),
        }
    }
    if prov_row is not None:
        roma["provisiones"] = {
            "casos": int(prov_row["casos"] or 0),
            "monto": float(prov_row["monto"] or 0),
            "agingMax": int(prov_row["aging_max"]) if prov_row["aging_max"] is not None else None,
        }
    return roma


def run() -> dict:
    """Consulta ROMA y postea a Velocidad. Devuelve el JSON de respuesta.
    Reutilizable por el CLI (main) y por el handler de Lambda."""
    roma = consultar_roma()
    url = os.environ["VELOCIDAD_URL"].rstrip("/") + "/api/snapshots/daily"
    print("ROMA →", roma, file=sys.stderr)
    resp = httpx.post(
        url,
        headers={"Authorization": f"Bearer {os.environ['DAILY_SNAPSHOT_TOKEN']}"},
        json={"roma": roma},
        timeout=120,
    )
    resp.raise_for_status()
    data = resp.json()
    print("OK", data)
    return data


def main() -> int:
    try:
        run()
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"ERROR: {e}", file=sys.stderr)
        return 1


# Handler para AWS Lambda (mismo código; ver lambda_handler.py para el entrypoint).
def lambda_handler(event=None, context=None):  # noqa: ANN001
    return {"ok": True, "result": run()}


if __name__ == "__main__":
    raise SystemExit(main())
