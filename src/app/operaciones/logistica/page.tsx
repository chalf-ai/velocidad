"use client";

/**
 * /operaciones/logistica · Logística V1.
 *
 * Cómo está funcionando el flujo físico del vehículo desde la marca
 * hasta la sucursal. Tres motores como protagonistas:
 *
 *   M1 · Disponibilidad Comercial   (Sucursal + Comercial)
 *   M2 · Ejecución del Operador     (KAR / SCHIAPP)
 *   M3 · Cumplimiento del Operador  (KAR / SCHIAPP)
 *
 * Layout:
 *   1. HeaderLog
 *   2. EstadoFuentesBanner
 *   3. FiltroMesCompraMarca + headline + ancla
 *   4. ◆ Flujo logístico · 3 motores (PROTAGONISTA, drill INLINE)
 *   5. ◆ Stock crítico · 2 familias separadas (drill INLINE)
 *   6. ◆ Cumplimiento por operador
 *   7. ◆ Velocidad por tramo (tabla compacta)
 *   8. ▼ Rankings (colapsado)
 *   9. ▼ Marcas críticas (colapsado)
 *
 * Drill INLINE pattern (mismo que CN): foco unificado, cola aparece debajo
 * del bloque que la dispara.
 */

import { useEffect, useMemo, useState } from "react";
import { Truck } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { EstadoFuentesBanner } from "@/components/historico/EstadoFuentesBanner";

import { HeaderLog } from "@/components/logistica/HeaderLog";
import {
  FiltroMesCompraMarca,
  type AnclaLogStats,
} from "@/components/logistica/FiltroMesCompraMarca";
import { FlujoLogisticoTresMotores } from "@/components/logistica/FlujoLogisticoTresMotores";
import type { MotorCardData } from "@/components/logistica/MotorCard";
import {
  StockCriticoSection,
  type FocoBanda,
} from "@/components/logistica/StockCriticoSection";
import { CumplimientoOperadorSection } from "@/components/logistica/CumplimientoOperadorSection";
import {
  VelocidadTramoTabla,
  type TramoRow,
} from "@/components/logistica/VelocidadTramoTabla";
import { RankingsLog } from "@/components/logistica/RankingsLog";
import { MarcasCriticasCollapse } from "@/components/logistica/MarcasCriticasCollapse";
import { ColaGestionableLog } from "@/components/logistica/ColaGestionableLog";

import { useExcelStore } from "@/lib/store";
import { useHistoricoStore } from "@/lib/historico/store-cliente";
import { useMarcaFilter } from "@/lib/marca-filtro";
import { useSucursalFilter } from "@/lib/sucursal-filtro";
import { fmtDate } from "@/lib/format";

import {
  universoLog,
  mesesDisponiblesLog,
  type MesCompraMarcaKey,
} from "@/lib/logistica/log-universo";
import {
  calcularMotor1,
} from "@/lib/logistica/log-motor1-disponibilidad";
import { calcularMotor2 } from "@/lib/logistica/log-motor2-ejecucion";
import { calcularMotor3 } from "@/lib/logistica/log-motor3-cumplimiento";
import {
  calcularStockCritico,
  LABEL_FAMILIA,
} from "@/lib/logistica/log-stock-critico";
import {
  rankingSucursalesPeorM1,
  rankingMarcasCriticasM3,
} from "@/lib/logistica/log-rankings";
import { MOTORES, type MotorId } from "@/lib/logistica/log-responsables";
import { stats as statsFn } from "@/lib/logistica/log-motor1-disponibilidad";
import type { LogisticaOperacionVIN } from "@/lib/logistica/modelo";

type FocoDrill =
  | { tipo: "motor"; id: MotorId }
  | { tipo: "stock"; foco: NonNullable<FocoBanda> }
  | null;

const MS_DIA = 86_400_000;

export default function LogisticaPage() {
  const logisticaPorVin = useExcelStore((s) => s.logisticaPorVin);
  const cruce = useHistoricoStore((s) => s.cruce);
  const fechaCorteExcel = useExcelStore((s) => s.data?.report?.fechaCorteExcel ?? null);
  const marcaGlobal = useMarcaFilter((s) => s.marca);
  const sucursalGlobal = useSucursalFilter((s) => s.sucursal);

  const [mes, setMes] = useState<MesCompraMarcaKey | null>(null);
  const [foco, setFoco] = useState<FocoDrill>(null);

  const opcionesMes = useMemo(
    () =>
      mesesDisponiblesLog(logisticaPorVin ?? null, cruce ?? null, {
        marcaGlobal,
        sucursalGlobal,
      }),
    [logisticaPorVin, cruce, marcaGlobal, sucursalGlobal],
  );

  // Default · último mes disponible
  useEffect(() => {
    if (mes === null && opcionesMes.length > 0) setMes(opcionesMes[0].key);
  }, [mes, opcionesMes]);

  // Re-default cuando cambian filtros y el mes deja de existir
  useEffect(() => {
    if (
      mes !== null &&
      opcionesMes.length > 0 &&
      !opcionesMes.some((o) => o.key === mes)
    ) {
      setMes(opcionesMes[0].key);
    }
  }, [mes, opcionesMes]);

  const mesLabel = useMemo(() => {
    if (!mes) return "Todos los meses";
    return opcionesMes.find((o) => o.key === mes)?.label ?? mes;
  }, [mes, opcionesMes]);

  const universo = useMemo(
    () =>
      universoLog(logisticaPorVin ?? null, cruce ?? null, {
        marcaGlobal,
        sucursalGlobal,
        mes,
      }),
    [logisticaPorVin, cruce, marcaGlobal, sucursalGlobal, mes],
  );

  const hoyRef = useMemo<Date>(
    () => fechaCorteExcel ?? new Date(),
    [fechaCorteExcel],
  );

  const motor1 = useMemo(() => calcularMotor1(universo), [universo]);
  const motor2 = useMemo(() => calcularMotor2(universo), [universo]);
  const motor3 = useMemo(() => calcularMotor3(universo), [universo]);
  const stockCritico = useMemo(
    () => calcularStockCritico(universo, hoyRef),
    [universo, hoyRef],
  );
  const rankingSuc = useMemo(
    () => rankingSucursalesPeorM1(universo, { topN: 10, minN: 5 }),
    [universo],
  );
  const rankingMarcas = useMemo(
    () => rankingMarcasCriticasM3(universo, { topN: 10, minN: 5, umbralPct: 80 }),
    [universo],
  );

  // Stats del ancla
  const ancla = useMemo<AnclaLogStats>(() => {
    let enBodega = 0;
    let despachados = 0;
    for (const op of universo) {
      if (op.fDespacho instanceof Date) despachados++;
      else if (op.fIngresoApc instanceof Date) enBodega++;
    }
    const stockCriticoTotal =
      stockCritico.familias[0].bandas.find((b) => b.id === ">60")?.filas.length ??
      0;
    const stockCriticoTotal2 =
      stockCritico.familias[1].bandas.find((b) => b.id === ">60")?.filas.length ??
      0;
    return {
      enBodegaOperador: enBodega,
      despachados,
      cumplimientoPct: motor3.global.pct,
      stockCritico: stockCriticoTotal + stockCriticoTotal2,
    };
  }, [universo, stockCritico, motor3]);

  // Tramo "Compra → Almacén"
  const tramoCompraAlmacen = useMemo(() => {
    const dias: number[] = [];
    for (const op of universo) {
      if (op.fCompraMarca instanceof Date && op.fIngresoApc instanceof Date) {
        const d = (op.fIngresoApc.getTime() - op.fCompraMarca.getTime()) / MS_DIA;
        if (d >= 0) dias.push(d);
      }
    }
    return statsFn(dias);
  }, [universo]);

  // Cards de los 3 motores
  const cardsMotores = useMemo<[MotorCardData, MotorCardData, MotorCardData]>(() => {
    const m1: MotorCardData = {
      meta: MOTORES.m1,
      valorPrincipal:
        motor1.global.mediana != null ? `${motor1.global.mediana.toFixed(0)} d` : "—",
      valorLabel: "mediana",
      subStats:
        motor1.global.n > 0
          ? `avg ${motor1.global.avg!.toFixed(1)} d · P90 ${motor1.global.p90!.toFixed(0)} d · N ${motor1.global.n}`
          : "Sin tramo medible",
      breakdown: [
        {
          label: "Venta",
          valor:
            motor1.porTipo.VENTA.mediana != null
              ? `${motor1.porTipo.VENTA.mediana.toFixed(0)} d`
              : "—",
        },
        {
          label: "Vitrina",
          valor:
            motor1.porTipo.VITRINA.mediana != null
              ? `${motor1.porTipo.VITRINA.mediana.toFixed(0)} d`
              : "—",
        },
      ],
    };
    const m2: MotorCardData = {
      meta: MOTORES.m2,
      valorPrincipal:
        motor2.global.mediana != null ? `${motor2.global.mediana.toFixed(0)} d` : "—",
      valorLabel: "mediana",
      subStats:
        motor2.global.n > 0
          ? `avg ${motor2.global.avg!.toFixed(1)} d · P90 ${motor2.global.p90!.toFixed(0)} d · N ${motor2.global.n}`
          : "Sin tramo medible",
      breakdown: [
        {
          label: "KAR",
          valor:
            motor2.porOperador.KAR.mediana != null
              ? `${motor2.porOperador.KAR.mediana.toFixed(1)} d`
              : "—",
        },
        {
          label: "SCHIAPP",
          valor:
            motor2.porOperador.SCHIAPP.mediana != null
              ? `${motor2.porOperador.SCHIAPP.mediana.toFixed(1)} d`
              : "—",
        },
      ],
    };
    const brechaTone: "ok" | "warn" =
      motor3.brechaPp != null && Math.abs(motor3.brechaPp) >= 10 ? "warn" : "ok";
    const m3: MotorCardData = {
      meta: MOTORES.m3,
      valorPrincipal:
        motor3.global.pct != null ? `${motor3.global.pct.toFixed(1)}%` : "—",
      valorLabel: "global",
      subStats:
        motor3.global.total > 0 ? `${motor3.global.cumplidos} de ${motor3.global.total} cumplidos` : "Sin declaración",
      breakdown: [
        {
          label: "KAR",
          valor:
            motor3.porOperador.KAR.pct != null
              ? `${motor3.porOperador.KAR.pct.toFixed(1)}%`
              : "—",
          tone:
            motor3.porOperador.KAR.pct != null && motor3.porOperador.KAR.pct >= 85
              ? "ok"
              : "warn",
        },
        {
          label: "SCHIAPP",
          valor:
            motor3.porOperador.SCHIAPP.pct != null
              ? `${motor3.porOperador.SCHIAPP.pct.toFixed(1)}%`
              : "—",
          tone:
            motor3.porOperador.SCHIAPP.pct != null && motor3.porOperador.SCHIAPP.pct >= 85
              ? "ok"
              : "warn",
        },
      ],
      brecha:
        motor3.brechaPp != null
          ? {
              label: "Brecha KAR − SCHIAPP",
              valor: `${motor3.brechaPp.toFixed(1)} pp`,
              tone: brechaTone,
            }
          : undefined,
    };
    return [m1, m2, m3];
  }, [motor1, motor2, motor3]);

  // Tramos de la tabla velocidad
  const tramos = useMemo<TramoRow[]>(
    () => [
      {
        id: "compra_almacen",
        label: "Compra → Almacén",
        cubre: "fCompraMarca → fIngresoApc",
        owner: "MARCA_OPERADOR",
        stats: tramoCompraAlmacen,
      },
      {
        id: "almacen_solicitud",
        label: "Almacén → Solicitud (M1)",
        cubre: "fIngresoApc → fSolicitudBodega",
        owner: "SUCURSAL_COMERCIAL",
        stats: motor1.global,
      },
      {
        id: "solicitud_despacho",
        label: "Solicitud → Despacho (M2)",
        cubre: "fSolicitudBodega → fDespacho",
        owner: "OPERADOR",
        stats: motor2.global,
      },
    ],
    [tramoCompraAlmacen, motor1, motor2],
  );

  // Cola activa según foco
  const cola = useMemo(() => {
    if (!foco) return null;

    if (foco.tipo === "motor") {
      const meta = MOTORES[foco.id];
      let filas: LogisticaOperacionVIN[] = [];
      if (foco.id === "m1") {
        filas = universo.filter(
          (op) => op.fIngresoApc instanceof Date && op.fSolicitudBodega instanceof Date,
        );
      } else if (foco.id === "m2") {
        filas = universo.filter(
          (op) =>
            op.fSolicitudBodega instanceof Date && op.fDespacho instanceof Date,
        );
      } else {
        // M3 · solo NO CUMPLIDO para gestión
        filas = universo.filter(
          (op) => (op.cumplimientoDespacho ?? "").toUpperCase().trim() === "NO CUMPLIDO",
        );
      }
      return {
        titulo: `${meta.nombre} · ${filas.length} casos`,
        subtitulo: meta.cubre,
        filas,
        origen: `/operaciones/logistica · ${meta.id.toUpperCase()}`,
        contexto: { tipo: "motor" as const, tramo: foco.id },
      };
    }

    // stock
    const fam = stockCritico.familias.find((f) => f.familia === foco.foco.familia);
    const banda = fam?.bandas.find((b) => b.id === foco.foco.banda);
    return {
      titulo: `${LABEL_FAMILIA[foco.foco.familia]} · ${banda?.label} · ${banda?.filas.length ?? 0} casos`,
      subtitulo: fam?.cubre,
      filas: banda?.filas ?? [],
      origen: `/operaciones/logistica · stock:${foco.foco.familia}:${foco.foco.banda}`,
      contexto: {
        tipo: "stock" as const,
        ref:
          foco.foco.familia === "sin_solicitud"
            ? ("ingreso" as const)
            : ("solicitud" as const),
      },
    };
  }, [foco, universo, stockCritico]);

  // Empty state
  if (!logisticaPorVin || logisticaPorVin.size === 0) {
    return (
      <div className="space-y-4">
        <HeaderLog />
        <EstadoFuentesBanner />
        <EmptyState
          icon={<Truck className="size-5" />}
          title="Sin datos logísticos"
          description="Carga SCHIAPP y/o KAR desde /ingesta para activar el módulo."
        />
      </div>
    );
  }

  const totalVehiculosAfectados = rankingMarcas.reduce((s, m) => s + m.total - m.cumplidos, 0);

  return (
    <div className="space-y-4">
      <HeaderLog
        actions={
          fechaCorteExcel ? (
            <div className="text-[11px] text-[--color-fg-muted]">
              Datos al <b className="text-[--color-fg]">{fmtDate(fechaCorteExcel)}</b>
            </div>
          ) : null
        }
      />
      <EstadoFuentesBanner />

      <FiltroMesCompraMarca
        opciones={opcionesMes}
        valor={mes}
        onChange={setMes}
        mesLabel={mesLabel}
        totalVehiculos={universo.length}
        stats={ancla}
      />

      {/* 1 · PROTAGONISTA · 3 motores con drill inline */}
      <FlujoLogisticoTresMotores
        motores={cardsMotores}
        activo={foco?.tipo === "motor" ? foco.id : null}
        onClick={(id) => setFoco(id ? { tipo: "motor", id } : null)}
        colaInferior={
          cola && foco?.tipo === "motor" ? (
            <ColaGestionableLog
              titulo={cola.titulo}
              subtitulo={cola.subtitulo}
              filas={cola.filas}
              origen={cola.origen}
              contexto={cola.contexto}
              hoy={hoyRef}
            />
          ) : null
        }
      />

      {/* 2 · Stock crítico · DOS familias separadas */}
      <StockCriticoSection
        resultado={stockCritico}
        foco={foco?.tipo === "stock" ? foco.foco : null}
        onFoco={(f) => setFoco(f ? { tipo: "stock", foco: f } : null)}
        colaInferior={
          cola && foco?.tipo === "stock" ? (
            <ColaGestionableLog
              titulo={cola.titulo}
              subtitulo={cola.subtitulo}
              filas={cola.filas}
              origen={cola.origen}
              contexto={cola.contexto}
              hoy={hoyRef}
            />
          ) : null
        }
      />

      {/* 3 · Cumplimiento por operador */}
      <CumplimientoOperadorSection resultado={motor3} />

      {/* 4 · Velocidad por tramo */}
      <VelocidadTramoTabla tramos={tramos} />

      {/* 5 · Rankings colapsado */}
      <RankingsLog sucursales={rankingSuc} />

      {/* 6 · Marcas críticas colapsado */}
      <MarcasCriticasCollapse
        marcas={rankingMarcas}
        totalVehiculosAfectados={totalVehiculosAfectados}
      />

      {/* Nota al pie */}
      <div className="text-[10.5px] text-[--color-fg-dim] italic leading-snug px-1">
        Logística V1 · 3 motores con responsables distintos: M1 (Sucursal +
        Comercial) · M2 y M3 (Operador KAR / SCHIAPP). Los conceptos de Causa
        Raíz se entregan en sprint siguiente.
      </div>
    </div>
  );
}
