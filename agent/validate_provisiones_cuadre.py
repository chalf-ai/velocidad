"""
Validador de cuadre · Provisiones de Ingreso (Camino A).

Corre `consultar_provisiones_gateway()` contra el gateway ROMA Amazon e imprime
los KPIs. Sirve como verificación operacional repetible (en el entorno del agente,
con el gateway configurado).

Uso:  python -m agent.validate_provisiones_cuadre

Cuadre de REFERENCIA — validado AL PESO contra el export real de la pantalla
"Gestión de Provisiones de Ingreso" (Registros-Provisiones-20-06-2026_129.xlsx),
corte 2026-06-20:

    vigentes_unidades  = 290
    vigentes_monto     = 5.121.714.234
    mas90_unidades     = 90
    mas90_monto        = 547.858.850
    saldo_neto (Σcol)  = 5.076.055.956
    aging_max          = 497

(>90 días depende de la fecha de corte → drift diario esperado; vigentes es
estable salvo nuevas provisiones / facturación. Las cifras de arriba son la foto
del 2026-06-20, no asserts fijos.)
"""
from __future__ import annotations

import asyncio

REFERENCIA_20JUN2026 = {
    "vigentes_unidades": 290,
    "vigentes_monto": 5_121_714_234,
    "mas90_unidades": 90,
    "mas90_monto": 547_858_850,
    "saldo_neto": 5_076_055_956,
    "aging_max": 497,
}


async def main() -> None:
    from .roma_gateway import consultar_provisiones_gateway

    try:
        kpis = await consultar_provisiones_gateway()
    except Exception as e:  # noqa: BLE001
        print(f"Gateway no disponible / no configurado: {e}")
        return

    print("Provisiones de Ingreso · KPIs en vivo desde ROMA:")
    print(f"  Vigentes (saldo>0) : {kpis['vigentes_unidades']} · ${kpis['vigentes_monto']:,.0f}")
    print(f"  >90 días           : {kpis['mas90_unidades']} · ${kpis['mas90_monto']:,.0f}")
    print(f"  Σ columna saldo     : ${kpis['saldo_neto']:,.0f}")
    print(f"  Aging máx (días)   : {kpis['aging_max']}")
    print("\nReferencia 2026-06-20 (export):")
    for k, v in REFERENCIA_20JUN2026.items():
        print(f"  {k:18s} = {v:,}")


if __name__ == "__main__":
    asyncio.run(main())
