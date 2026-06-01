"use client";

/**
 * /operaciones/control-de-negocio · Control de Negocio V2 (rework visual).
 *
 * Modelo operacional aprobado CN V1.0 REV.1 — IDÉNTICO. Lo que cambia es la
 * presentación visual: el protagonista ahora es el embudo de cobertura del
 * flujo (Operaciones), no los KPIs financieros (Tesorería).
 *
 * Orden de bloques (mockup V2):
 *   1. Header (subtítulo nuevo "Cómo está funcionando el departamento…")
 *   2. EstadoFuentesBanner
 *   3. FiltroMesFactura + headline "X facturas emitidas en MES" + línea ancla
 *   4. ◆ Estado del flujo — EmbudoVerticalCN (PROTAGONISTA)
 *   5. ◆ Dónde se rompió — ProcesosQuebradosGrid (cohorte madura)
 *   6. ◆ Velocidad por tramo — TablaVelocidadCN (compacta)
 *   7. Cola gestionable activa (cuando hay foco)
 *   8. Rankings (colapsado)
 *   9. ▼ FNE Atribuible (colapsado al final)
 */

import { useEffect, useMemo, useState } from "react";
import { ScrollText } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { EstadoFuentesBanner } from "@/components/historico/EstadoFuentesBanner";

import { HeaderCN } from "@/components/control-de-negocio/HeaderCN";
import { FiltroMesFactura } from "@/components/control-de-negocio/FiltroMesFactura";
import { SelectorPeriodo } from "@/components/control-de-negocio/SelectorPeriodo";
import { TiempoEntregaBanner } from "@/components/control-de-negocio/TiempoEntregaBanner";
import { TimelineCN } from "@/components/control-de-negocio/TimelineCN";
import { DistribucionDiasCN } from "@/components/control-de-negocio/DistribucionDiasCN";
import { TiemposPorProcesoCN } from "@/components/control-de-negocio/TiemposPorProcesoCN";
import { EmbudoVerticalCN } from "@/components/control-de-negocio/EmbudoVerticalCN";
import { ProcesosQuebradosGrid } from "@/components/control-de-negocio/ProcesosQuebradosGrid";
import { FNEAtribuibleSection } from "@/components/control-de-negocio/FNEAtribuibleSection";
import { RankingsSection } from "@/components/control-de-negocio/RankingsSection";
import { ColaGestionableCN } from "@/components/control-de-negocio/ColaGestionableCN";

import { useHistoricoStore } from "@/lib/historico/store-cliente";
import { useExcelStore } from "@/lib/store";
import { useMarcaFilter } from "@/lib/marca-filtro";
import { useSucursalFilter } from "@/lib/sucursal-filtro";
import {
  universoCN,
  universoEntregadosEnPeriodo,
  mesesDisponiblesCN,
  cohorteMadura,
  type MesFacturaKey,
} from "@/lib/control-de-negocio/cn-universo";
import {
  calcularCapaA,
  filasTramo,
  type TramoId,
} from "@/lib/control-de-negocio/cn-velocidad";
import { calcularCapaB } from "@/lib/control-de-negocio/cn-quebrados";
import { calcularCapaC } from "@/lib/control-de-negocio/cn-fne-atribuible";
import {
  calcularEmbudoCobertura,
  filasSinHito,
  LABEL_HITO_COBERTURA,
  type HitoCobertura,
} from "@/lib/control-de-negocio/cn-cobertura";
import {
  calcularMesesIncluidos,
  filtrarPorPeriodo,
  labelPeriodoActivo,
  type ModoPeriodo,
} from "@/lib/control-de-negocio/cn-periodo";
import { calcularDistribucionDias } from "@/lib/control-de-negocio/cn-participacion";
import {
  calcularRankings,
  type CriterioRanking,
} from "@/lib/control-de-negocio/cn-rankings";
import type { HitoFaltante } from "@/lib/control-de-negocio/cn-responsables";
import { fmtNum } from "@/lib/format";

type FocoDrill =
  | { tipo: "embudo"; id: HitoCobertura }
  | { tipo: "tramo"; id: TramoId }
  | { tipo: "quebrado"; id: HitoFaltante }
  | { tipo: "fne"; id: HitoFaltante }
  | null;

const MS_DIA = 86_400_000;

function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

export default function ControlDeNegocioPage() {
  const cruce = useHistoricoStore((s) => s.cruce);
  // Fecha de corte del Excel macro (visible en el Header) — usada como `hoy`
  // de referencia para la cohorte madura. Si el dataset es del "futuro"
  // respecto al reloj real del servidor (ej. Mayo 2026 cargado en 2025),
  // usar new Date() haría que toda la cohorte quede vacía.
  const fechaCorteExcel = useExcelStore((s) => s.data?.report?.fechaCorteExcel ?? null);
  const marcaGlobal = useMarcaFilter((s) => s.marca);
  const sucursalGlobal = useSucursalFilter((s) => s.sucursal);

  const [mes, setMes] = useState<MesFacturaKey | null>(null);
  const [modoPeriodo, setModoPeriodo] = useState<ModoPeriodo>("mes");
  const [foco, setFoco] = useState<FocoDrill>(null);
  const [criterio, setCriterio] = useState<CriterioRanking>(
    "mediana_fac_entrega",
  );

  const opcionesMes = useMemo(
    () =>
      cruce ? mesesDisponiblesCN(cruce, { marcaGlobal, sucursalGlobal }) : [],
    [cruce, marcaGlobal, sucursalGlobal],
  );

  // Default · último mes disponible
  useEffect(() => {
    if (mes === null && opcionesMes.length > 0) setMes(opcionesMes[0].key);
  }, [mes, opcionesMes]);

  // Reasignar si el mes deja de existir por cambio de filtros globales
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

  // Meses incluidos según el modo de período · cuando modo === "mes" es solo
  // [mes]; cuando es "3m"/"6m"/"12m" acumula N meses hacia atrás desde el mes
  // de referencia; cuando "todo" abarca todas las opciones disponibles.
  const mesesIncluidos = useMemo(
    () => calcularMesesIncluidos(opcionesMes, mes, modoPeriodo),
    [opcionesMes, mes, modoPeriodo],
  );

  const labelPeriodo = useMemo(
    () => labelPeriodoActivo(opcionesMes, mesesIncluidos, modoPeriodo),
    [opcionesMes, mesesIncluidos, modoPeriodo],
  );

  // Universo del módulo · R2 + R3 + filtro temporal. Cuando modo === "mes" se
  // usa el path corto del selector. Cuando es rango, se obtiene universo SIN
  // filtro de mes y se aplica el filtro de período encima.
  const universo = useMemo(() => {
    if (!cruce) return [];
    if (modoPeriodo === "mes") {
      return universoCN(cruce, { marcaGlobal, sucursalGlobal, mes });
    }
    const base = universoCN(cruce, { marcaGlobal, sucursalGlobal, mes: null });
    return filtrarPorPeriodo(base, mesesIncluidos);
  }, [cruce, marcaGlobal, sucursalGlobal, mes, modoPeriodo, mesesIncluidos]);

  // Cohorte madura para Capa B · `hoy` = fecha de corte del Excel (no reloj
  // real del servidor) y umbral dinámico según el modo de período:
  //   "mes" → 0d (ver TODO el universo del mes; sin filtro de madurez)
  //   "3m"  → 15d (filtra ruido del mes en curso, mantiene 2 meses previos)
  //   "6m"/"12m"/"todo" → 30d (calidad estadística estándar)
  const diasMadura = useMemo<number>(() => {
    switch (modoPeriodo) {
      case "mes":  return 0;
      case "3m":   return 15;
      case "6m":
      case "12m":
      case "todo": return 30;
    }
  }, [modoPeriodo]);

  const hoyRef = useMemo<Date>(
    () => fechaCorteExcel ?? new Date(),
    [fechaCorteExcel],
  );

  const cohorte = useMemo(
    () => cohorteMadura(universo, hoyRef, diasMadura),
    [universo, hoyRef, diasMadura],
  );

  // Datos por capa
  const embudo = useMemo(() => calcularEmbudoCobertura(universo), [universo]);
  const capaA = useMemo(() => calcularCapaA(universo), [universo]);
  const capaB = useMemo(
    () => calcularCapaB(cohorte, universo.length),
    [cohorte, universo],
  );
  const capaC = useMemo(() => calcularCapaC(universo), [universo]);

  // Mínimos dinámicos para rankings · más laxos en período "mes" (poco
  // volumen mensual), estrictos en 6M/12M/todo (calidad estadística).
  const minimosRanking = useMemo(() => {
    switch (modoPeriodo) {
      case "mes":  return { minFacturas: 10, minEntregasParaTiempo: 3 };
      case "3m":   return { minFacturas: 20, minEntregasParaTiempo: 5 };
      case "6m":   return { minFacturas: 30, minEntregasParaTiempo: 10 };
      case "12m":  return { minFacturas: 30, minEntregasParaTiempo: 10 };
      case "todo": return { minFacturas: 30, minEntregasParaTiempo: 10 };
    }
  }, [modoPeriodo]);

  const rankings = useMemo(
    () => calcularRankings(universo, criterio, 10, minimosRanking),
    [universo, criterio, minimosRanking],
  );

  // Stats del ciclo Factura → Entrega Real · mediana + promedio.
  // La mediana se usa en la línea ancla del filtro (lectura robusta);
  // el promedio se usa en "¿Quién consumió los días?" porque es lo que
  // refleja el tiempo total promedio del proceso.
  const ancla = useMemo(() => {
    let entregados = 0;
    let capitalRetenido = 0;
    const diasEntrega: number[] = [];
    for (const f of universo) {
      if (f.entregado) {
        entregados++;
        if (f.fFactura instanceof Date && f.fEntregaReal instanceof Date) {
          const d = (f.fEntregaReal.getTime() - f.fFactura.getTime()) / MS_DIA;
          if (d >= 0) diasEntrega.push(d);
        }
      } else {
        capitalRetenido += f.valorFactura ?? 0;
      }
    }
    const promedio = diasEntrega.length
      ? diasEntrega.reduce((a, b) => a + b, 0) / diasEntrega.length
      : null;
    return {
      entregados,
      sinEntregaReal: universo.length - entregados,
      capitalRetenidoFNE: capitalRetenido,
      medianaFacEntrega: mediana(diasEntrega),
      promedioFacEntrega: promedio,
    };
  }, [universo]);

  // Banner "Tiempo de entrega" — ventana POR FECHA DE ENTREGA (no por factura).
  // Responde la pregunta operacional del día a día: "en este período,
  // ¿cuántos días tardamos en entregar lo que efectivamente entregamos?".
  // Incluye autos facturados en meses previos pero entregados en el período
  // (ej. facturado en abril, entregado en mayo cuenta para "mayo").
  const tiempoEntrega = useMemo(() => {
    if (!cruce) {
      return {
        entregados: 0,
        promedio: null as number | null,
        mediana: null as number | null,
        mejor: null as number | null,
        peor: null as number | null,
        arrastreFacturasPrevias: 0,
        valorFacturado: 0,
      };
    }
    const setMeses = new Set(mesesIncluidos);
    const filas = universoEntregadosEnPeriodo(cruce, {
      marcaGlobal,
      sucursalGlobal,
      mesesIncluidos: setMeses,
    });
    const dias: number[] = [];
    let arrastre = 0;
    let valor = 0;
    for (const f of filas) {
      if (f.fFactura instanceof Date && f.fEntregaReal instanceof Date) {
        const d = (f.fEntregaReal.getTime() - f.fFactura.getTime()) / MS_DIA;
        if (d >= 0) dias.push(d);
        // ¿Factura fuera del período activo? → arrastre
        const yk = `${f.fFactura.getFullYear()}-${String(
          f.fFactura.getMonth() + 1,
        ).padStart(2, "0")}`;
        if (!setMeses.has(yk)) arrastre++;
      }
      valor += f.valorFactura ?? 0;
    }
    return {
      entregados: dias.length,
      promedio: dias.length
        ? dias.reduce((a, b) => a + b, 0) / dias.length
        : null,
      mediana: mediana(dias),
      mejor: dias.length ? Math.min(...dias) : null,
      peor: dias.length ? Math.max(...dias) : null,
      arrastreFacturasPrevias: arrastre,
      valorFacturado: valor,
    };
  }, [cruce, marcaGlobal, sucursalGlobal, mesesIncluidos]);

  // Distribución dinámica de días por área (¿Quién consumió los días?).
  // Métrica: PROMEDIO (no mediana). Se pasa el promedio del ciclo total
  // del período activo. Si el período no tiene datos, el selector cae a
  // valores oficiales (declarado en la UI con leyenda).
  const distribucion = useMemo(
    () => calcularDistribucionDias(capaA, ancla.promedioFacEntrega),
    [capaA, ancla.promedioFacEntrega],
  );

  // Cola activa por foco
  const cola = useMemo(() => {
    if (!foco) return null;

    if (foco.tipo === "embudo") {
      const filas = filasSinHito(universo, foco.id);
      const label = LABEL_HITO_COBERTURA[foco.id];
      return {
        titulo: `Estado del flujo · Sin ${label.toLowerCase()} · ${filas.length} casos`,
        subtitulo: `Universo: ${fmtNum(universo.length)} facturas del mes`,
        filas,
        origen: `/operaciones/control-de-negocio · embudo:${foco.id}`,
      };
    }

    if (foco.tipo === "tramo") {
      const tramoDef = capaA.tramos.find((t) => t.id === foco.id);
      const filas = filasTramo(universo, foco.id);
      return {
        titulo: `Velocidad · ${tramoDef?.label ?? "Tramo"} · ${filas.length} casos`,
        subtitulo: tramoDef
          ? `Responsable operativo: ${tramoDef.responsable.rol}`
          : undefined,
        filas,
        origen: `/operaciones/control-de-negocio · tramo:${foco.id}`,
      };
    }

    if (foco.tipo === "quebrado") {
      const card = capaB.cards.find((c) => c.hito === foco.id);
      const filas = card?.filas ?? [];
      return {
        titulo: `Dónde se rompió · ${card?.label ?? "Hito faltante"} · ${filas.length} casos`,
        subtitulo: `Cohorte madura · ${fmtNum(capaB.universo)} de ${fmtNum(capaB.universoTotal)} facturados`,
        filas,
        origen: `/operaciones/control-de-negocio · quebrado:${foco.id}`,
      };
    }

    // fne
    const grupo = capaC.grupos.find((g) => g.hito === foco.id);
    const filas = grupo?.filas ?? [];
    return {
      titulo: `FNE atribuible · ${grupo?.labelAlt ?? grupo?.label ?? "Grupo"} · ${filas.length} casos`,
      subtitulo: `Responsable operativo: ${grupo?.responsable.rol ?? "—"}`,
      filas,
      origen: `/operaciones/control-de-negocio · fne:${foco.id}`,
    };
  }, [foco, universo, capaA, capaB, capaC]);

  // Empty state
  if (!cruce) {
    return (
      <div className="space-y-4">
        <HeaderCN />
        <EstadoFuentesBanner />
        <EmptyState
          icon={<ScrollText className="size-5" />}
          title="Sin datos del cruce"
          description="Carga los archivos del histórico (ROMA + Actas + ROMIA) desde /ingesta."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <HeaderCN />
      <EstadoFuentesBanner />

      {/* 1 · Filtro + headline + línea ancla */}
      <FiltroMesFactura
        opciones={opcionesMes}
        valor={mes}
        onChange={setMes}
        mesLabel={mesLabel}
        facturados={universo.length}
        stats={ancla}
      />

      {/* 1.b · Selector temporal · acumula meses para análisis y para que los
            rankings tengan volumen suficiente. Default: "mes" (comportamiento
            actual). */}
      <SelectorPeriodo
        modo={modoPeriodo}
        onChange={setModoPeriodo}
        labelPeriodoActivo={labelPeriodo}
      />

      {/* 1.c · Banner protagonista "Tiempo de entrega" · ventana por fecha de
            entrega (no por factura). Responde: ¿cuánto estamos tardando hoy
            en entregar los autos que efectivamente salieron en este período? */}
      <TiempoEntregaBanner
        labelPeriodo={labelPeriodo}
        stats={tiempoEntrega}
      />

      {/* 2 · Timeline horizontal compacta · orientación rápida del flujo CN.
            Lee directo del `embudo` ya calculado, sin selector nuevo. Solo visual. */}
      <TimelineCN embudo={embudo} />

      {/* 3 · "¿Quién consumió los días del ciclo?" · distribución del tiempo
            por área responsable. Valores oficiales CN V1.0 REV.1 (cambiará a
            cálculo dinámico cuando los hitos 5-7 tengan timestamp). */}
      <DistribucionDiasCN resultado={distribucion} />

      {/* 4 · TIEMPOS POR PROCESO · protagonista. Drill INLINE: la cola aparece
            inmediatamente debajo del grid de cards cuando hay foco de tramo. */}
      <TiemposPorProcesoCN
        capa={capaA}
        tramoActivo={foco?.tipo === "tramo" ? foco.id : null}
        onTramoClick={(id) => setFoco(id ? { tipo: "tramo", id } : null)}
        colaInferior={
          cola && foco?.tipo === "tramo" ? (
            <ColaGestionableCN
              titulo={cola.titulo}
              subtitulo={cola.subtitulo}
              filas={cola.filas}
              origen={cola.origen}
            />
          ) : null
        }
      />

      {/* 3 · Estado del flujo · embudo de cobertura. Drill INLINE. */}
      <EmbudoVerticalCN
        embudo={embudo}
        hitoActivo={foco?.tipo === "embudo" ? foco.id : null}
        onHitoClick={(id) => setFoco(id ? { tipo: "embudo", id } : null)}
        colaInferior={
          cola && foco?.tipo === "embudo" ? (
            <ColaGestionableCN
              titulo={cola.titulo}
              subtitulo={cola.subtitulo}
              filas={cola.filas}
              origen={cola.origen}
            />
          ) : null
        }
      />

      {/* 4 · Procesos quebrados (cohorte madura). Drill INLINE. */}
      <ProcesosQuebradosGrid
        capa={capaB}
        activeId={foco?.tipo === "quebrado" ? foco.id : null}
        diasCohorte={diasMadura}
        onSelect={(id) => setFoco(id ? { tipo: "quebrado", id } : null)}
        colaInferior={
          cola && foco?.tipo === "quebrado" ? (
            <ColaGestionableCN
              titulo={cola.titulo}
              subtitulo={cola.subtitulo}
              filas={cola.filas}
              origen={cola.origen}
            />
          ) : null
        }
      />

      {/* 5 · FNE atribuible · colapsado por defecto. Drill INLINE (abre el
            collapse automáticamente si llega un foco fne). */}
      <FNEAtribuibleSection
        capa={capaC}
        activeId={foco?.tipo === "fne" ? foco.id : null}
        onSelect={(id) => setFoco(id ? { tipo: "fne", id } : null)}
        colaInferior={
          cola && foco?.tipo === "fne" ? (
            <ColaGestionableCN
              titulo={cola.titulo}
              subtitulo={cola.subtitulo}
              filas={cola.filas}
              origen={cola.origen}
            />
          ) : null
        }
      />

      {/* 6 · Rankings · colapsado por defecto */}
      <RankingsSection
        rankings={rankings}
        criterio={criterio}
        onCriterioChange={setCriterio}
      />
    </div>
  );
}
