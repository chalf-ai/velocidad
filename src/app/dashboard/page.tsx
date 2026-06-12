"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Car,
  Clock,
  Coins,
  CreditCard,
  Gauge,
  Gavel,
  Layers,
  Lock,
  Send,
  Snowflake,
  TestTube2,
  Truck,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Landing } from "@/components/Landing";
import { VentaPonderadaBlock } from "@/components/VentaPonderadaBlock";
import { useDatosFiltrados, useMarcaFilter } from "@/lib/marca-filtro";
import { fmtCLP, fmtCLPCompact, fmtDate, fmtNum, fmtPct } from "@/lib/format";
import {
  capitalPorMarcaOriginadora,
  composicionPorMarca,
  distribucionNaturaleza,
  NATURALEZA_LABEL,
  NATURALEZA_TONE,
} from "@/lib/selectors/capital-taxonomia";
import {
  getMarcaOperacional,
  normalizarMarcaOperacional,
  getCategoriaOperacional,
  getMarcaOriginadora,
  MARCA_USADOS,
  duenaCapitalPuente,
  vehiculosCapitalDeMarca,
} from "@/lib/selectors/owner-operacional";
import { esStockB } from "@/lib/selectors/segmentos-caja";
import { ventaMensualPromedio } from "@/lib/ventas-q1";
import {
  calcularEficienciaCapital,
  MOS_IDEAL,
  MOS_CRITICO,
  CV_IDEAL,
  CV_CRITICO,
  EFICIENCIA_PESOS,
  type EficienciaCapital,
} from "@/lib/selectors/eficiencia-capital";
import { Badge } from "@/components/ui/Badge";
import { Sheet } from "@/components/ui/Sheet";
import { ArrowRight as ArrowRightIcon } from "lucide-react";
import {
  computeDashboardKPIs,
  generarAlertas,
  lineasPorFinanciera,
  type DashboardKPIs,
  type LineaFinanciera,
} from "@/lib/selectors/kpis";
import { detectarFNE, mapaFechaFacturaPorVin, statsFNE } from "@/lib/selectors/fne";
import { cruzarFNEConStock, statsFNEReal } from "@/lib/selectors/fne-real";
import {
  statsValidacionFinanciera,
  validarFinancieras,
  type EstadoValidacion,
} from "@/lib/selectors/financieras-master";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { AbrirCasoButton } from "@/components/AbrirCasoButton";
import { BotonesCasoPuente } from "@/components/BotonesCasoPuente";
import { indexarFNEPorOrigen } from "@/lib/selectors/vu-en-fne";
import { deriveHeroOperacional } from "@/lib/selectors/hero-operacional";
import { calcularScoreGerencial } from "@/lib/selectors/score-gerencial";
import { buildVehiculosUnificados } from "@/lib/selectors/vehiculo-unificado";
import { tescarStats } from "@/lib/selectors/tescar-operacional";
import { limpiarVIN } from "@/lib/parser/venta-apc";
import { useExcelStore } from "@/lib/store";
import { useGestionStore } from "@/lib/gestion/store";
import type {
  LineaCredito,
  ProvisionRegistro,
  SaldoRegistro,
  Vehiculo,
} from "@/lib/types";

const NATURALEZA_COLOR: Record<string, string> = {
  puente: "#d97706",
  operativo: "#2e5cf6",
  atrapado: "#dc2626",
  judicial: "#7c2d12",
  transito: "#8b94a3",
  retail: "#15a87b",
  indefinido: "#b4bcc7",
};

/** Acción sugerida por tipo de alerta — lenguaje gerencial accionable. */
const ACCION_ALERTA: Record<string, string> = {
  linea_sobregirada: "Frenar ingresos / renegociar línea",
  linea_sobre_90: "Priorizar entregas para liberar línea",
  linea_entre_80_90: "Vigilar ocupación de línea",
  venc_vencido: "Gestionar pago o renovación urgente",
  venc_proximo_30d: "Agendar pago o renovación",
  vehiculo_mas_180: "Evaluar descuento o castigo de precio",
  pagado_sin_rotacion: "Activar venta — caja inmovilizada",
  stock_judicial: "Seguimiento legal",
  stock_b: "Revisar reacondicionamiento",
  vpp_comprometido: "Cerrar y monetizar el VPP",
};

export default function DashboardPage() {
  const { data } = useDatosFiltrados();
  if (!data) return <Landing />;
  return <DashboardInner />;
}

function DashboardInner() {
  const { data, fne, saldos, provisiones } = useDatosFiltrados();
  const parsed = data!;
  const marcaActiva = useMarcaFilter((s) => s.marca);
  const router = useRouter();
  // Gestión persistente por VIN — hidratar desde localStorage al montar.
  useEffect(() => {
    useGestionStore.getState().hydrate();
  }, []);
  const [selectedMarca, setSelectedMarca] = useState<string | null>(null);

  // ── CAPITAL DE TRABAJO UTILIZADO (métrica operacional, no contable) ──
  // Caja/capital realmente comprometido por el universo ACTUAL (respeta el
  // filtro global de marca, porque parsed/fne/saldos/provisiones ya vienen
  // filtrados). NO suma stock financiado por terceros.
  const ct = useMemo(() => {
    const stockPagadoV = uniqVinPorTipo(parsed.vehiculos, new Set(["Propio", "FinPropio"]));
    const seen = new Set<string>();
    const puenteV: Vehiculo[] = [];
    // El capital puente se atribuye a su marca DUEÑA (quién consumió la caja/línea):
    //   • VU en Nuevos → la marca nueva originadora (KIA/MG/…). Es SU capital de
    //     trabajo; USADOS solo lo gestiona, no lo financia.
    //   • VU en Usados (BU) → USADOS (lo originó la propia unidad de usados).
    // Con filtro de marca activo, solo suma el puente cuya dueña == filtro: así
    // USADOS deja de DUPLICAR los $2.285B (216 u) que ya cuentan las marcas
    // originadoras y conserva solo su BU propio ($152M / 17 u). Sin filtro
    // ("Todas") suma todo una sola vez. Las marcas nuevas no cambian: el puente
    // de su universo filtrado ya tiene dueña == esa marca.
    const objetivo = marcaActiva ? normalizarMarcaOperacional(marcaActiva) : null;
    for (const v of parsed.vehiculos) {
      if (!v.esVPPComprometido || seen.has(v.vin)) continue;
      seen.add(v.vin);
      if (objetivo) {
        const esNuevos = (v.marcaPompeyo ?? "").toUpperCase().includes("NUEVO");
        const duena = esNuevos ? getMarcaOriginadora(v) : MARCA_USADOS;
        if (duena !== objetivo) continue;
      }
      puenteV.push(v);
    }
    const saldosVehReg = saldos?.registros.filter((r) => r.categoria === "vehiculo") ?? [];
    const bonosReg = saldos?.registros.filter((r) => r.categoria === "bono_comision") ?? [];
    // Provisiones que consumen capital de trabajo HOY: área "ventas" con saldo > 0.
    // Postventa va aparte (otro scope operacional). Saldo negativo es ajuste contable,
    // no caja viva — no entra al total comprometido.
    const provReg = provisiones?.registros.filter((r) => r.area === "ventas" && r.saldo > 0) ?? [];
    const sum = <T,>(arr: T[], f: (x: T) => number) => arr.reduce((s, x) => s + (f(x) || 0), 0);
    const mStock = sum(stockPagadoV, (v) => v.costoNeto);
    const mPuente = sum(puenteV, (v) => v.costoNeto);
    const mSaldos = sum(saldosVehReg, (r) => r.saldoXDocumentar);
    const mBonos = sum(bonosReg, (r) => r.saldoXDocumentar);
    const mProv = sum(provReg, (r) => r.saldo);
    // NO se incluye FNE: los facturados no entregados ya están dentro de "saldos"
    // (sería doble conteo). FNE se gestiona aparte para velocidad de cobro.
    return {
      stockPagadoV,
      puenteV,
      saldosVehReg,
      bonosReg,
      provReg,
      mStock,
      mPuente,
      mSaldos,
      mBonos,
      mProv,
      total: mStock + mPuente + mSaldos + mBonos + mProv,
    };
  }, [parsed.vehiculos, saldos, provisiones, marcaActiva]);

  const composicion = useMemo(
    () => (selectedMarca ? composicionPorMarca(parsed.vehiculos, selectedMarca) : null),
    [parsed.vehiculos, selectedMarca],
  );

  const kpis = useMemo(() => computeDashboardKPIs(parsed.vehiculos), [parsed.vehiculos]);
  // ORIGEN DEL CAPITAL (Bloque A) — atribución financiera: el capital puente se
  // cuenta en su marca DUEÑA. En el lente de una marca, excluye el VU en nuevos
  // ajeno (su caja es de la marca originadora). Así "caja Pompeyo / tránsito" no
  // suma capital que ya cuenta otra marca, y la partición sigue cuadrando al 100%.
  const vehiculosCapital = useMemo(
    () => vehiculosCapitalDeMarca(parsed.vehiculos, marcaActiva),
    [parsed.vehiculos, marcaActiva],
  );
  const kpisCapital = useMemo(() => computeDashboardKPIs(vehiculosCapital), [vehiculosCapital]);
  // VU en nuevos ajeno excluido del Bloque A (visible como nota, no suma).
  const vuNuevosExcluido = useMemo(() => {
    if (!marcaActiva) return { u: 0, cap: 0 };
    const objetivo = normalizarMarcaOperacional(marcaActiva);
    const seen = new Set<string>();
    let u = 0;
    let cap = 0;
    for (const v of parsed.vehiculos) {
      if (!v.esVPPComprometido || seen.has(v.vin)) continue;
      seen.add(v.vin);
      if (duenaCapitalPuente(v) !== objetivo) {
        u++;
        cap += v.costoNeto || 0;
      }
    }
    return { u, cap };
  }, [parsed.vehiculos, marcaActiva]);
  const naturaleza = useMemo(() => distribucionNaturaleza(parsed.vehiculos), [parsed.vehiculos]);
  const porMarca = useMemo(
    () => capitalPorMarcaOriginadora(parsed.vehiculos),
    [parsed.vehiculos],
  );
  // Aging FNE desde FECHA FACTURA: P2 vía VIN → archivo FNE oficial cuando
  // Base_Stock no trae Fecha Facturación; fallback a venta queda marcado.
  const fnes = useMemo(
    () => detectarFNE(parsed.vehiculos, new Date(), mapaFechaFacturaPorVin(fne)),
    [parsed.vehiculos, fne],
  );
  const fneStats = useMemo(() => statsFNE(fnes), [fnes]);
  // FNE real desde archivo "Autos no entregados.xlsx" — solo si está cargado.
  const fneRealCruzado = useMemo(
    () =>
      fne
        ? cruzarFNEConStock(fne.registros, parsed.vehiculos, parsed.vinsExtra ?? null)
        : null,
    [fne, parsed.vehiculos, parsed.vinsExtra],
  );
  const fneReal = useMemo(
    () => (fneRealCruzado ? statsFNEReal(fneRealCruzado) : null),
    [fneRealCruzado],
  );

  // ── EFICIENCIA DE CAPITAL (ventas Q1 mensualizadas) ──
  // Respeta el filtro global: KIA usa ventas KIA, Todas usa total Pompeyo.
  // Venta MENSUAL PONDERADA (N-1 50% · N-2 30% · N-3 20%) — base de eficiencia.
  // Comparable contra el capital (foto mensual actual). MOS = capital / venta
  // mensual; % = MOS·100; score 0-100. Ver `ventas-q1.ts` para la ventana actual.
  const eficiencia = useMemo<EficienciaCapital>(() => {
    const venta = ventaMensualPromedio(marcaActiva);
    const total = ct.total || 0;

    // Stock = el mismo conteo del Stock Explorer: con marca activa, solo stock
    // retail (ej. KIA 514); sin filtro, todo el stock. Es el numerador del MOS.
    // Aging = % de ESE stock con +180 días (antigüedad real del inventario).
    let stockUnidades = 0;
    let agingUnidades = 0;
    const seenStock = new Set<string>();
    for (const v of parsed.vehiculos) {
      if (!v.vin || seenStock.has(v.vin)) continue;
      seenStock.add(v.vin);
      if (marcaActiva && getCategoriaOperacional(v) !== "stock_retail") continue;
      stockUnidades++;
      if ((v.diasStock ?? 0) > 180) agingUnidades++;
    }

    // FNE detenido >15d (sobre el valor FNE total).
    let fneTotal = 0;
    let fneDet = 0;
    if (fneRealCruzado) {
      for (const c of fneRealCruzado) {
        const val = c.fne.valorFactura || 0;
        fneTotal += val;
        if (!c.listoParaEntregar && (c.diasEnEstado ?? 0) > 15) fneDet += val;
      }
    }
    // Saldos vencidos (>90d en archivo).
    let saldosVenc = 0;
    for (const r of ct.saldosVehReg) {
      if ((r.diasArchivo ?? 0) > 90) saldosVenc += r.saldoXDocumentar || 0;
    }

    return calcularEficienciaCapital({
      capitalUtilizado: total,
      ventaMensualMonto: venta?.monto ?? null,
      ventaMensualUnidades: venta?.unidades ?? null,
      stockUnidades,
      agingShare: stockUnidades > 0 ? agingUnidades / stockUnidades : 0,
      fneDetenidoShare: fneTotal > 0 ? fneDet / fneTotal : 0,
      saldosVencidosShare: ct.mSaldos > 0 ? saldosVenc / ct.mSaldos : 0,
      provisionShare: total > 0 ? ct.mProv / total : 0,
    });
  }, [ct, marcaActiva, fneRealCruzado, parsed.vehiculos]);

  const alertas = useMemo(
    () => generarAlertas(parsed.vehiculos, parsed.lineas),
    [parsed.vehiculos, parsed.lineas],
  );

  // Score Gerencial — fuente PRIMARIA de severidad del Hero (decisión 2026-06).
  // Reusa la misma lógica de /score-gerencial para garantizar congruencia.
  const scoreGerencial = useMemo<number | null>(() => {
    if (!data) return null;
    const map = buildVehiculosUnificados({ data, fne, saldos });
    const vusAll = Array.from(map.values());
    const sg = calcularScoreGerencial({
      marca: marcaActiva ?? "Todas las marcas",
      vus: vusAll,
      saldos: saldos?.registros ?? [],
      provisiones: provisiones?.registros ?? [],
    });
    return sg.score;
  }, [data, fne, saldos, provisiones, marcaActiva]);

  // Radar operacional del hero — lectura ejecutiva determinística (no recalcula
  // score ni cálculos financieros; solo interpreta los KPIs ya derivados).
  const hero = useMemo(
    () => deriveHeroOperacional({ efic: eficiencia, ct, marca: marcaActiva, scoreGerencial }),
    [eficiencia, ct, marcaActiva, scoreGerencial],
  );

  const lineas = parsed.lineas;
  const financieras = useMemo(() => lineasPorFinanciera(parsed.lineas), [parsed.lineas]);
  const financierasAlLimite = useMemo(
    () => financieras.filter((f) => f.pctOcupacion >= 0.9 || f.sobregiro > 0),
    [financieras],
  );
  const lineasOrdenadas = [...lineas].sort(
    (a, b) => b.porcentajeOcupacion - a.porcentajeOcupacion,
  );
  const lineasCriticas = lineas.filter(
    (l) => l.semaforo === "sobregirada" || l.semaforo === "rojo",
  );
  const lineaAutorizada = lineas.reduce((s, l) => s + l.lineaAutorizada, 0);
  const lineaOcupada = lineas.reduce((s, l) => s + l.lineaOcupada, 0);
  const lineaLibre = lineas.reduce((s, l) => s + l.lineaLibre, 0);
  const pctOcup = lineaAutorizada > 0 ? lineaOcupada / lineaAutorizada : 0;

  const alertasCriticas = alertas.filter((a) => a.severidad === "critica");
  const alertasAltas = alertas.filter((a) => a.severidad === "alta");

  // Top alertas deduplicadas (colapsa vencimientos/eventos idénticos repetidos).
  const alertasMostradas = useMemo(() => {
    const orden = [...alertasCriticas, ...alertasAltas];
    const map = new Map<
      string,
      { alerta: (typeof orden)[number]; count: number; impacto: number }
    >();
    for (const a of orden) {
      const key = `${a.tipo}|${a.titulo}|${a.detalle}`;
      const e = map.get(key);
      if (e) {
        e.count += 1;
        e.impacto += a.valorImpacto ?? 0;
      } else {
        map.set(key, { alerta: a, count: 1, impacto: a.valorImpacto ?? 0 });
      }
    }
    return [...map.values()].slice(0, 8);
  }, [alertasCriticas, alertasAltas]);

  const nat = (k: string) => naturaleza.find((n) => n.naturaleza === k);
  const puente = nat("puente");
  const operativo = nat("operativo");
  const atrapado = nat("atrapado");
  const judicial = nat("judicial");

  // Stock B — vehículos parados por reacondicionamiento / servicio técnico,
  // no se pueden vender hasta resolver. Capital inmovilizado en taller.
  const stockB = useMemo(() => {
    const seen = new Set<string>();
    let capital = 0;
    let unidades = 0;
    for (const v of parsed.vehiculos) {
      if (!esStockB(v) || seen.has(v.vin)) continue;
      seen.add(v.vin);
      unidades++;
      capital += v.costoNeto;
    }
    return { capital, unidades };
  }, [parsed.vehiculos]);

  const naturalezaChart = naturaleza
    .filter((n) => n.capital > 0)
    .map((n) => ({
      naturaleza: NATURALEZA_LABEL[n.naturaleza],
      key: n.naturaleza,
      capital: Math.round(n.capital / 1_000_000),
      unidades: n.unidades,
    }));

  // Visualización ejecutiva: consolidar marcas ajenas al grupo Pompeyo en
  // "OTRAS MARCAS" (USADOS y marcas del grupo quedan individuales). Se vuelve a
  // sumar capital/unidades sobre el bucket operacional para no fragmentar.
  const topMarcas = (() => {
    const m = new Map<string, { marca: string; capitalCLP: number; unidades: number }>();
    for (const row of porMarca) {
      if (row.marca === null) continue;
      const marca = normalizarMarcaOperacional(row.marca);
      const prev = m.get(marca) ?? { marca, capitalCLP: 0, unidades: 0 };
      prev.capitalCLP += row.capitalTotal;
      prev.unidades += row.unidades;
      m.set(marca, prev);
    }
    return [...m.values()]
      .map((r) => ({ marca: r.marca, capital: Math.round(r.capitalCLP / 1_000_000), unidades: r.unidades }))
      .sort((a, b) => b.capital - a.capital);
  })();

  return (
    <div className="max-w-[1400px] mx-auto px-10 py-10 space-y-12 fade-in">
      {/* Hero — RADAR OPERACIONAL: lectura ejecutiva viva (color por severidad) */}
      <div
        className="relative overflow-hidden rounded-3xl border px-10 py-6 transition-colors"
        style={{ background: hero.tone.bg, borderColor: hero.tone.border }}
      >
        <div
          className="absolute -top-20 -right-20 size-72 rounded-full opacity-[0.10] blur-3xl pointer-events-none"
          style={{ background: hero.tone.accent }}
        />
        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="min-w-0">
            <div
              className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] font-semibold"
              style={{ color: hero.tone.accent }}
            >
              <span className="inline-block size-1.5 rounded-full" style={{ background: hero.tone.accent }} />
              Sistema de Velocidad Operacional
              <span
                className="ml-1 inline-flex items-center rounded-md px-1.5 py-0.5 text-[9.5px] tracking-[0.1em]"
                style={{ background: `${hero.tone.accent}1a`, color: hero.tone.accent }}
              >
                {hero.estadoLabel}
                {marcaActiva ? ` · ${marcaActiva}` : ""}
              </span>
            </div>
            <h1 className="text-[26px] sm:text-[30px] font-semibold tracking-tight mt-2 leading-[1.1] text-[--color-fg] max-w-2xl text-balance">
              {hero.headline}
            </h1>
            <p className="text-[13.5px] text-[--color-fg-muted] mt-1.5 max-w-2xl leading-relaxed">
              {hero.subtitulo}
              {parsed.report.fechaCorteExcel && (
                <span className="text-[--color-fg-dim]">
                  {" "}· corte {fmtDate(parsed.report.fechaCorteExcel)}
                </span>
              )}
            </p>
          </div>
          <CapitalTrabajoCard ct={ct} efic={eficiencia} marca={marcaActiva} />
        </div>
      </div>

      {/* Venta ponderada · base contextual de eficiencia (50/30/20) */}
      <VentaPonderadaBlock
        marca={marcaActiva}
        stockPropioMonto={ct.mStock}
        capitalUtilizadoMonto={ct.total}
        withBottomMargin={false}
      />

      {/* ════════════════════════════════════════════════════════════ */}
      {/* BLOQUE A · Origen del capital · partición disjunta · CUADRA  */}
      {/* ════════════════════════════════════════════════════════════ */}
      <BloqueOrigenCapital
        kpis={kpisCapital}
        vehiculos={vehiculosCapital}
        financieras={financieras}
        lineas={parsed.lineas}
        vuNuevosExcluido={vuNuevosExcluido}
      />

      {/* ════════════════════════════════════════════════════════════ */}
      {/* BLOQUE B · Estado operacional del capital · NO disjunto       */}
      {/* ════════════════════════════════════════════════════════════ */}
      <div className="surface top-strip strip-warning bg-white px-8 pt-8 pb-7 space-y-5">
        <div>
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-warning] font-semibold">
            B · Estado operacional del capital
          </div>
          <h2 className="text-[14px] font-medium text-[--color-fg-muted] mt-1">
            Lectura de velocidad operacional · puede solaparse con A · no es contable
          </h2>
        </div>

        <div className="bg-[--color-bg-elev-1] rounded-md px-3 py-2 text-[11.5px] text-[--color-fg-muted] border border-[--color-border-soft] leading-relaxed">
          ⚠ <span className="text-[--color-fg-muted] font-medium">No sumar al total.</span>{" "}
          Estas métricas pueden solaparse con el bloque A (un FloorPlan puede estar a la vez
          en estado operativo). Sirven para gestión y velocidad operacional, no para
          cuadratura contable.
        </div>

        <BloqueOperacional vehiculos={parsed.vehiculos} />
      </div>

      {/* KPIs secundarios — operación viva */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <HeroKPI
          label="Línea ocupada"
          value={fmtPct(pctOcup)}
          sub={`${fmtCLPCompact(lineaLibre)} disponible`}
          tone={pctOcup > 0.9 ? "danger" : pctOcup > 0.8 ? "warning" : "default"}
          href="/lineas"
        />
        {fneReal ? (
          <>
            <HeroKPI
              label="Facturados no entregados"
              value={fmtNum(fneReal.total)}
              sub={`${fmtCLPCompact(fneReal.valorTotal)} · fuente oficial`}
              href="/facturados-no-entregados"
            />
            <HeroKPI
              label="Listo para entregar"
              value={fmtNum(fneReal.listoParaEntregar)}
              sub={`${fmtCLPCompact(fneReal.valorListoParaEntregar)} · patente + sol + autorización`}
              tone={fneReal.listoParaEntregar > 0 ? "success" : "default"}
              href="/facturados-no-entregados"
            />
          </>
        ) : (
          <HeroKPI
            label="Facturados no entregados"
            value={fmtNum(fneStats.total)}
            sub={`${fmtCLPCompact(fneStats.valorTotal)} · estimado · falta archivo oficial`}
            href="/facturados-no-entregados"
          />
        )}
        <HeroKPI
          label="Alertas críticas"
          value={fmtNum(alertasCriticas.length)}
          sub={`${alertasAltas.length} altas adicionales`}
          tone={alertasCriticas.length > 0 ? "danger" : "default"}
          href="/alertas"
        />
      </div>

      {/* Insights — storytelling */}
      <InsightsSection
        atrapadoUnits={atrapado?.unidades ?? 0}
        judicialCap={judicial?.capital ?? 0}
        judicialUnits={judicial?.unidades ?? 0}
        puenteCap={puente?.capital ?? 0}
        puenteUnits={puente?.unidades ?? 0}
        stockBCap={stockB.capital}
        stockBUnits={stockB.unidades}
        fneFloorPlan={fneStats.porTipoStock.floorPlan.capital}
        fneFloorPlanUnits={fneStats.porTipoStock.floorPlan.unidades}
        financierasAlLimite={financierasAlLimite}
      />

      {/* Capital agrupado por estado operacional — 5 grupos */}
      <div>
        <SectionHeader
          title="Capital de trabajo"
          sub="Capital agrupado por estado operacional. Clic en un grupo para ver el detalle."
        />
        <div className="mt-5 grid grid-cols-2 lg:grid-cols-5 gap-4">
          <NaturalezaCard
            index={1}
            href={naturalezaHref("retail", marcaActiva)}
            label="En línea"
            description="En línea de crédito y disponible operacionalmente."
            capital={nat("retail")?.capital ?? 0}
            unidades={nat("retail")?.unidades ?? 0}
            tone="success"
            icon={<Wallet className="size-3.5" strokeWidth={1.75} />}
          />
          <NaturalezaCard
            index={2}
            href={naturalezaHref("operativo", marcaActiva)}
            label="Facturados no entregados"
            description="VN + VU facturados pero todavía no entregados al cliente."
            capital={operativo?.capital ?? 0}
            unidades={operativo?.unidades ?? 0}
            tone="info"
            icon={<Truck className="size-3.5" strokeWidth={1.75} />}
          />
          <NaturalezaCard
            index={3}
            href={naturalezaHref("puente", marcaActiva)}
            label="Capital puente"
            description="VPP recibido + CPD usados fuera de línea, todavía no pagados."
            capital={puente?.capital ?? 0}
            unidades={puente?.unidades ?? 0}
            tone="warning"
            icon={<Layers className="size-3.5" strokeWidth={1.75} />}
          />
          <NaturalezaCard
            index={4}
            href={naturalezaHref("atrapado", marcaActiva)}
            label="Capital pagado"
            description="Caja propia desembolsada esperando rotar. Sin judiciales."
            capital={atrapado?.capital ?? 0}
            unidades={atrapado?.unidades ?? 0}
            tone="danger"
            icon={<Snowflake className="size-3.5" strokeWidth={1.75} />}
          />
          <NaturalezaCard
            index={5}
            href={naturalezaHref("judicial", marcaActiva)}
            label="Judiciales"
            description="Stock en proceso judicial — situación legal distinta."
            capital={judicial?.capital ?? 0}
            unidades={judicial?.unidades ?? 0}
            tone="judicial"
            icon={<Snowflake className="size-3.5" strokeWidth={1.75} />}
          />
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Distribución del capital</CardTitle>
            <CardDescription>En millones de pesos · por estado operacional</CardDescription>
          </CardHeader>
          <CardBody>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={naturalezaChart} layout="vertical" margin={{ left: 0, right: 16, top: 8, bottom: 4 }}>
                  <XAxis
                    type="number"
                    tick={{ fill: "#8b94a3", fontSize: 11 }}
                    tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}B` : `${v}M`)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="naturaleza"
                    tick={{ fill: "#5e6772", fontSize: 12 }}
                    width={130}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(46, 92, 246, 0.04)" }}
                    contentStyle={{
                      backgroundColor: "#ffffff",
                      border: "1px solid #d4d9e0",
                      borderRadius: 10,
                      fontSize: 12,
                      padding: "8px 12px",
                      boxShadow: "0 12px 32px -8px rgba(15,23,42,0.15)",
                      color: "#1a1f2e",
                    }}
                    formatter={(v, _name, item) => {
                      const value = typeof v === "number" ? v : 0;
                      const unidades = item?.payload?.unidades ?? 0;
                      return [`$${value.toLocaleString("es-CL")}M · ${unidades} u`, "Capital"];
                    }}
                  />
                  <Bar dataKey="capital" radius={[0, 6, 6, 0]} barSize={22}>
                    {naturalezaChart.map((entry, i) => (
                      <Cell key={i} fill={NATURALEZA_COLOR[entry.key] ?? "#3a3e48"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top marcas por capital</CardTitle>
            <CardDescription>
              Atribuido a la marca originadora (no a la marca del vehículo). Click en una barra
              para abrir el drilldown.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <div style={{ height: Math.max(260, topMarcas.length * 30 + 30) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topMarcas}
                  layout="vertical"
                  margin={{ left: 0, right: 16, top: 8, bottom: 4 }}
                >
                  <XAxis
                    type="number"
                    tick={{ fill: "#8b94a3", fontSize: 11 }}
                    tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}B` : `${v}M`)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="marca"
                    tick={{ fill: "#5e6772", fontSize: 11 }}
                    width={130}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(46, 92, 246, 0.06)" }}
                    contentStyle={{
                      backgroundColor: "#ffffff",
                      border: "1px solid #d4d9e0",
                      borderRadius: 10,
                      fontSize: 12,
                      padding: "8px 12px",
                      boxShadow: "0 12px 32px -8px rgba(15,23,42,0.15)",
                      color: "#1a1f2e",
                    }}
                    formatter={(v, _name, item) => {
                      const value = typeof v === "number" ? v : 0;
                      const u = item?.payload?.unidades ?? 0;
                      return [`$${value.toLocaleString("es-CL")}M · ${u} u`, "Capital"];
                    }}
                  />
                  <Bar
                    dataKey="capital"
                    radius={[0, 6, 6, 0]}
                    fill="#2e5cf6"
                    barSize={20}
                    style={{ cursor: "pointer" }}
                    onClick={(d) => {
                      const marca = (d as { payload?: { marca?: string } })?.payload?.marca;
                      if (marca) setSelectedMarca(marca);
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Líneas de crédito — tabla ejecutiva */}
      <div>
        <SectionHeader
          title="Líneas de crédito"
          sub={`${fmtNum(lineas.length)} líneas · ${fmtCLPCompact(lineaLibre)} libres${lineasCriticas.length > 0 ? ` · ${lineasCriticas.length} al límite (>90%)` : ""}`}
          right={
            <Link href="/lineas">
              <Button variant="outline" size="sm">
                Detalle <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          }
        />
        <div className="mt-5 surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[780px]">
              <thead className="text-[10px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1] border-b border-[--color-border]">
                <tr>
                  <th className="text-left font-semibold px-4 py-2.5">Marca</th>
                  <th className="text-left font-semibold px-4 py-2.5">Financiera</th>
                  <th className="text-right font-semibold px-4 py-2.5">Autorizado</th>
                  <th className="text-right font-semibold px-4 py-2.5">Utilizado</th>
                  <th className="text-right font-semibold px-4 py-2.5">Libre</th>
                  <th className="text-left font-semibold px-4 py-2.5 w-[160px]">% Usado</th>
                  <th className="text-left font-semibold px-4 py-2.5">Estado</th>
                </tr>
              </thead>
              <tbody>
                {lineasOrdenadas.map((l, idx) => {
                  const est = estadoLinea(l.semaforo);
                  return (
                    <tr
                      key={l.marca}
                      onClick={() =>
                        router.push(
                          `/stock?marcaOriginadora=${encodeURIComponent(l.marcaPompeyo ?? l.marca)}&tipoStock=FloorPlan`,
                        )
                      }
                      className={cn(
                        "border-b border-[--color-border-soft] last:border-0 cursor-pointer transition",
                        idx % 2 === 0
                          ? "bg-white hover:bg-[--color-bg-elev-1]"
                          : "bg-[--color-bg-elev-1]/40 hover:bg-[--color-bg-elev-1]",
                      )}
                    >
                      <td className="px-4 py-2.5 font-medium text-[12.5px] text-[--color-fg]">
                        {l.marca}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] text-[--color-fg-muted]">
                        {l.financiera ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right mono text-[12px] text-[--color-fg-muted]">
                        {fmtCLPCompact(l.lineaAutorizada)}
                      </td>
                      <td className="px-4 py-2.5 text-right mono text-[12px] text-[--color-fg]">
                        {fmtCLPCompact(l.lineaOcupada)}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-2.5 text-right mono text-[12px]",
                          l.lineaLibre < 0 ? "text-[--color-danger]" : "text-[--color-fg-muted]",
                        )}
                      >
                        {fmtCLPCompact(l.lineaLibre)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 min-w-[60px] rounded-full bg-[--color-bg-elev-3] overflow-hidden">
                            <div
                              className={cn("h-full rounded-full", est.bar)}
                              style={{ width: `${Math.min(100, l.porcentajeOcupacion * 100)}%` }}
                            />
                          </div>
                          <span className={cn("text-[12px] mono font-semibold w-11 text-right", est.text)}>
                            {(l.porcentajeOcupacion * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide",
                            est.bg,
                            est.text,
                          )}
                        >
                          {est.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Alertas + Atajos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Alertas críticas y altas</CardTitle>
                <CardDescription>Top 8 por severidad e impacto financiero</CardDescription>
              </div>
              <Link
                href="/alertas"
                className="text-[12px] text-[--color-accent] hover:underline inline-flex items-center gap-1"
              >
                Ver todas <ArrowRight className="size-3" />
              </Link>
            </div>
          </CardHeader>
          <CardBody className="px-0 pb-0">
            {alertasMostradas.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <div className="text-sm text-[--color-fg-muted]">
                  Sin alertas críticas en este momento.
                </div>
              </div>
            ) : (
              <ul>
                {alertasMostradas.map(({ alerta: a, count, impacto }) => {
                  const esCritica = a.severidad === "critica";
                  const accion = ACCION_ALERTA[a.tipo];
                  return (
                    <li
                      key={a.id}
                      className="flex items-start gap-3 px-6 py-3 border-t border-[--color-border-soft] hover:bg-[--color-bg-elev-1] transition"
                    >
                      <span
                        className={cn(
                          "mt-1.5 size-2 rounded-full shrink-0 ring-4",
                          esCritica
                            ? "bg-[--color-critical] ring-[--color-critical]/10"
                            : "bg-[--color-danger] ring-[--color-danger]/10",
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-medium text-[--color-fg]">
                            {a.titulo}
                          </span>
                          {count > 1 && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[--color-bg-elev-3] text-[--color-fg-muted]">
                              ×{count}
                            </span>
                          )}
                          {a.marca && (
                            <span className="text-[11px] text-[--color-fg-dim]">{a.marca}</span>
                          )}
                        </div>
                        <div className="text-[12px] text-[--color-fg-muted] mt-0.5 leading-relaxed line-clamp-1">
                          {a.detalle}
                        </div>
                        {accion && (
                          <div className="text-[11px] text-[--color-accent] mt-1 inline-flex items-center gap-1">
                            <ArrowRight className="size-3" />
                            {accion}
                          </div>
                        )}
                      </div>
                      {impacto > 0 && (
                        <div className="text-right shrink-0">
                          <div className="text-[12.5px] mono font-semibold text-[--color-fg]">
                            {fmtCLPCompact(impacto)}
                          </div>
                          <div className="text-[9.5px] uppercase tracking-wide text-[--color-fg-dim]">
                            impacto
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Atajos rápidos</CardTitle>
            <CardDescription>Vistas pre-filtradas del stock</CardDescription>
          </CardHeader>
          <CardBody className="space-y-1">
            <Shortcut
              href="/stock?estadoCapital=FNE_EN_OPERACION"
              label="FNE en operación"
              count={fneStats.total}
              icon={<Truck className="size-3.5" strokeWidth={1.75} />}
              tone="info"
            />
            <Shortcut
              href="/stock?estadoCapital=VPP_EXPLICITO"
              label="VPP comprometidos"
              count={kpis.unidadesVPPComprometido}
              icon={<ArrowLeftRight className="size-3.5" strokeWidth={1.75} />}
              tone="teal"
            />
            <Shortcut
              href="/stock?dias=180"
              label="Stock ≥ 180 días"
              count={kpis.unidadesMas180}
              icon={<Clock className="size-3.5" strokeWidth={1.75} />}
              tone="warning"
            />
            <Shortcut
              href="/stock?flags=pagado&dias=60"
              label="Pagados sin rotación ≥60d"
              icon={<CreditCard className="size-3.5" strokeWidth={1.75} />}
              tone="danger"
            />
            <Shortcut
              href="/stock?flags=judicial"
              label="Stock judicial"
              count={kpis.unidadesJudicial}
              icon={<Gavel className="size-3.5" strokeWidth={1.75} />}
              tone="judicial"
            />
            <Shortcut
              href="/stock?destino=demo"
              label="TESCAR · demo puro"
              count={kpis.unidadesTescar}
              icon={<Car className="size-3.5" strokeWidth={1.75} />}
              tone="muted"
            />
          </CardBody>
        </Card>
      </div>

      {/* Panel de composición por marca */}
      <Sheet
        open={!!selectedMarca}
        onClose={() => setSelectedMarca(null)}
        title={selectedMarca ?? ""}
        description="Composición del capital atribuido a esta marca originadora"
        width={480}
        footer={
          selectedMarca && (
            <>
              <button
                onClick={() => setSelectedMarca(null)}
                className="text-[12px] text-[--color-fg-muted] hover:text-[--color-fg]"
              >
                Cerrar
              </button>
              <button
                onClick={() => {
                  router.push(`/stock?marcaOriginadora=${encodeURIComponent(selectedMarca)}`);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-[--color-accent] text-white hover:bg-[--color-accent-hi] transition"
              >
                Ver todos los autos
                <ArrowRightIcon className="size-3.5" />
              </button>
            </>
          )
        }
      >
        {composicion && <ComposicionPanel composicion={composicion} router={router} />}
      </Sheet>
    </div>
  );
}

function ComposicionPanel({
  composicion,
  router,
}: {
  composicion: NonNullable<ReturnType<typeof composicionPorMarca>>;
  router: ReturnType<typeof useRouter>;
}) {
  const naturalezaColor: Record<string, string> = {
    puente: "#d97706",
    operativo: "#2e5cf6",
    atrapado: "#dc2626",
    judicial: "#7c2d12",
    transito: "#8b94a3",
    retail: "#15a87b",
    indefinido: "#b4bcc7",
  };

  return (
    <div className="space-y-6">
      {/* Total */}
      <div>
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-semibold">
          Capital total atribuido
        </div>
        <div className="display text-[36px] mt-2 leading-none text-[--color-fg]">
          {fmtCLPCompact(composicion.capitalTotal)}
        </div>
        <div className="text-[13px] text-[--color-fg-muted] mt-2">
          {fmtNum(composicion.unidadesTotal)} unidades · {fmtCLP(composicion.capitalTotal)}
        </div>
      </div>

      {/* Stacked bar — visual de composición */}
      <div>
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-semibold mb-3">
          Distribución
        </div>
        <div className="flex h-3 rounded-full overflow-hidden bg-[--color-bg-elev-3]">
          {composicion.buckets.map((b) => (
            <div
              key={b.naturaleza}
              className="h-full transition-all"
              style={{
                width: `${b.pct * 100}%`,
                backgroundColor: naturalezaColor[b.naturaleza],
              }}
              title={`${NATURALEZA_LABEL[b.naturaleza]}: ${(b.pct * 100).toFixed(1)}%`}
            />
          ))}
        </div>
      </div>

      {/* Detail per bucket */}
      <div className="space-y-2">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-semibold">
          Por naturaleza
        </div>
        {composicion.buckets.map((b) => (
          <button
            key={b.naturaleza}
            onClick={() => {
              router.push(
                `/stock?marcaOriginadora=${encodeURIComponent(composicion.marca)}&naturaleza=${b.naturaleza}`,
              );
            }}
            className="group w-full text-left px-3 py-3 rounded-lg border border-[--color-border] bg-white hover:border-[--color-border-strong] hover:bg-[--color-bg-elev-2] transition"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="size-2 rounded-full shrink-0"
                  style={{ backgroundColor: naturalezaColor[b.naturaleza] }}
                />
                <span className="text-[13px] font-medium text-[--color-fg] truncate">
                  {NATURALEZA_LABEL[b.naturaleza]}
                </span>
              </div>
              <div className="text-right shrink-0">
                <div className="mono text-[13px] font-semibold text-[--color-fg]">
                  {fmtCLPCompact(b.capital)}
                </div>
                <div className="text-[11px] text-[--color-fg-muted] mt-0.5">
                  {(b.pct * 100).toFixed(1)}% · {fmtNum(b.unidades)} u
                </div>
              </div>
              <ArrowRightIcon className="size-3.5 text-[--color-fg-dim] group-hover:text-[--color-accent] transition shrink-0" />
            </div>
            {/* Progress inline */}
            <div className="mt-2 h-1 rounded-full bg-[--color-bg-elev-3] overflow-hidden">
              <div
                className="h-full transition-all"
                style={{
                  width: `${b.pct * 100}%`,
                  backgroundColor: naturalezaColor[b.naturaleza],
                }}
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers compartidos por los drills inline de Bloque A y Bloque B
// ──────────────────────────────────────────────────────────────────────

/** Severidad de utilización de una línea financiera (foco: cuánto está usado). */
function sevLinea(pct: number, sobregiro: number) {
  if (sobregiro > 0)
    return { bar: "bg-[#7f1d1d]", text: "text-[#7f1d1d]", etiqueta: "sobregiro" };
  if (pct >= 0.9)
    return { bar: "bg-[--color-danger]", text: "text-[--color-danger]", etiqueta: "línea usada" };
  if (pct >= 0.8)
    return { bar: "bg-[--color-warning]", text: "text-[--color-warning]", etiqueta: "línea usada" };
  return { bar: "bg-[--color-success]", text: "text-[--color-success]", etiqueta: "línea usada" };
}

/** Estado visual de una línea de crédito según su semáforo. */
function estadoLinea(semaforo: string) {
  switch (semaforo) {
    case "sobregirada":
      return {
        label: "Sobregirada",
        text: "text-[--color-critical]",
        bg: "bg-[--color-critical]/10",
        bar: "bg-[#7f1d1d]",
      };
    case "rojo":
      return {
        label: "Al límite",
        text: "text-[--color-danger]",
        bg: "bg-[--color-danger]/10",
        bar: "bg-[--color-danger]",
      };
    case "amarillo":
      return {
        label: "Alerta",
        text: "text-[--color-warning]",
        bg: "bg-[--color-warning]/12",
        bar: "bg-[--color-warning]",
      };
    default:
      return {
        label: "Normal",
        text: "text-[--color-success]",
        bg: "bg-[--color-success]/10",
        bar: "bg-[--color-success]",
      };
  }
}

/** Dedup por VIN filtrando por conjunto de tipoStock. */
function uniqVinPorTipo(vehiculos: Vehiculo[], tipos: Set<string>): Vehiculo[] {
  const seen = new Set<string>();
  const out: Vehiculo[] = [];
  for (const v of vehiculos) {
    if (!tipos.has(v.tipoStock)) continue;
    if (seen.has(v.vin)) continue;
    seen.add(v.vin);
    out.push(v);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// CAPITAL DE TRABAJO UTILIZADO — tarjeta del hero + drill por categoría
// ──────────────────────────────────────────────────────────────────────

interface CapitalTrabajoData {
  stockPagadoV: Vehiculo[];
  puenteV: Vehiculo[];
  saldosVehReg: SaldoRegistro[];
  bonosReg: SaldoRegistro[];
  provReg: ProvisionRegistro[];
  mStock: number;
  mPuente: number;
  mSaldos: number;
  mBonos: number;
  mProv: number;
  total: number;
}

function CapitalTrabajoCard({
  ct,
  efic,
  marca,
}: {
  ct: CapitalTrabajoData;
  efic: EficienciaCapital;
  marca: string | null;
}) {
  const [verScore, setVerScore] = useState(false);
  const lineas = [
    { label: "Stock pagado", monto: ct.mStock, unidades: ct.stockPagadoV.length },
    { label: "Capital puente *", monto: ct.mPuente, unidades: ct.puenteV.length },
    { label: "Saldos", monto: ct.mSaldos, unidades: ct.saldosVehReg.length },
    { label: "Bonos/comis.", monto: ct.mBonos, unidades: ct.bonosReg.length },
    { label: "Provisiones", monto: ct.mProv, unidades: ct.provReg.length },
  ];
  const ventaPond = ventaMensualPromedio(marca);
  const r = (n: number) => Math.round(n);
  // Colores dinámicos como valores CSS (inline style) — los arbitrary classes
  // de Tailwind no se generan de forma fiable cuando vienen de variables.
  const COL = {
    verde: "#0f7a59",
    amarillo: "var(--color-warning)",
    rojo: "var(--color-danger)",
    dim: "var(--color-fg-dim)",
  };
  // Score: verde ≥90 · amarillo 80-90 · rojo <80.
  const scoreColor =
    efic.score == null
      ? COL.dim
      : efic.score >= 90
        ? COL.verde
        : efic.score >= 80
          ? COL.amarillo
          : COL.rojo;
  // MOS: verde ≤1.2 (ideal) · amarillo ≤1.7 · rojo >1.7.
  const mosColor =
    efic.mos == null
      ? COL.dim
      : efic.mos <= MOS_IDEAL
        ? COL.verde
        : efic.mos <= MOS_CRITICO
          ? COL.amarillo
          : COL.rojo;
  // Capital/Venta %: verde ≤80 · amarillo ≤100 · rojo >100.
  const cvColor =
    efic.capitalVentaPct == null
      ? COL.dim
      : efic.capitalVentaPct <= CV_IDEAL
        ? COL.verde
        : efic.capitalVentaPct <= CV_CRITICO
          ? COL.amarillo
          : COL.rojo;
  // 3 métricas con tooltip simple + el score (4ª) que es clickable y explica.
  const metricas = [
    {
      label: "Capital utilizado",
      value: fmtCLPCompact(efic.capital),
      color: "var(--color-fg)", // monto, no índice → siempre negro
      tip: "Caja propia comprometida (stock pagado + puente + saldos + bonos + provisiones). No incluye stock financiado por terceros.",
    },
    {
      label: "Capital / venta $",
      value: efic.capitalVentaPct != null ? `${Math.round(efic.capitalVentaPct)}%` : "—",
      color: cvColor,
      tip: `Capital utilizado ($) ÷ venta mensual promedio ($). Verde ≤${CV_IDEAL}% · amarillo ≤${CV_CRITICO}% · rojo >${CV_CRITICO}%.`,
    },
    {
      label: "MOS · unidades",
      value: efic.mos != null ? efic.mos.toFixed(1) : "—",
      color: mosColor,
      tip: `Unidades en stock ÷ venta mensual promedio (unidades). Meses de inventario. Verde ≤${MOS_IDEAL} · amarillo ≤${MOS_CRITICO} · rojo >${MOS_CRITICO}.`,
    },
  ];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const penal = efic.componentes
    ? [
        {
          label: "Capital / venta",
          base: `${efic.capitalVentaPct != null ? Math.round(efic.capitalVentaPct) : "—"}% · ideal ≤${CV_IDEAL}% · peso ${EFICIENCIA_PESOS.capitalVenta}`,
          val: r(efic.componentes.capitalVenta),
        },
        {
          label: "Inventario (MOS)",
          base: `${efic.mos?.toFixed(1)} meses · ideal ≤${MOS_IDEAL} · crítico >${MOS_CRITICO} · peso ${EFICIENCIA_PESOS.mos}`,
          val: r(efic.componentes.mos),
        },
        {
          label: "Antigüedad +180d",
          base: `${pct(efic.bases.agingShare)} del stock con +180 días · peso ${EFICIENCIA_PESOS.aging}`,
          val: r(efic.componentes.aging),
        },
        {
          label: "FNE detenido +15d",
          base: `${pct(efic.bases.fneDetenidoShare)} del valor FNE trabado · peso ${EFICIENCIA_PESOS.fne}`,
          val: r(efic.componentes.fne),
        },
        {
          label: "Saldos vencidos +90d",
          base: `${pct(efic.bases.saldosVencidosShare)} de los saldos · peso ${EFICIENCIA_PESOS.saldos}`,
          val: r(efic.componentes.saldos),
        },
        {
          label: "Provisiones",
          base: `${pct(efic.bases.provisionShare)} del capital · peso ${EFICIENCIA_PESOS.prov}`,
          val: r(efic.componentes.prov),
        },
      ]
    : [];
  return (
    <div className="relative shrink-0 w-full lg:w-[540px] rounded-xl border border-[--color-danger]/35 bg-white/75 backdrop-blur px-5 py-3.5">
      <div className="flex items-start justify-between gap-3">
        {/* Título ejecutivo */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="grid place-items-center size-7 rounded-lg bg-gradient-to-br from-[--color-danger] to-[#fb7185] text-white shadow-sm shrink-0">
            <Gauge className="size-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-bold tracking-tight text-[--color-fg] leading-none">
              Eficiencia de capital
            </div>
            <div className="text-[9px] uppercase tracking-[0.14em] text-[--color-fg-muted] mt-1 truncate">
              Capital de trabajo ·{" "}
              <span className="text-[--color-danger] font-semibold">{marca ?? "Todas las marcas"}</span>
            </div>
          </div>
        </div>
        {/* Esquina: stock + venta mensual promedio (plata + unidades) */}
        <div className="text-right shrink-0 leading-tight">
          <div className="whitespace-nowrap">
            <span className="text-[8px] uppercase tracking-wide text-[--color-fg-muted]">Stock </span>
            <span className="text-[10.5px] text-[--color-fg] font-semibold">
              {fmtNum(efic.stockUnidades)} u
            </span>
          </div>
          <div className="whitespace-nowrap mt-0.5">
            <span className="text-[8px] uppercase tracking-wide text-[--color-fg-muted]">
              Venta/mes prom{" "}
            </span>
            {efic.ventaMensualMonto != null ? (
              <span className="text-[10.5px] text-[--color-fg] font-semibold">
                {fmtCLPCompact(efic.ventaMensualMonto)} ·{" "}
                {fmtNum(Math.round(efic.ventaMensualUnidades ?? 0))} u
              </span>
            ) : (
              <span className="text-[10.5px] text-[--color-fg-dim]">sin ventas</span>
            )}
          </div>
        </div>
      </div>

      {/* 4 métricas ejecutivas grandes */}
      <div className="mt-2 grid grid-cols-4 gap-2">
        {metricas.map((m) => (
          <div key={m.label} className="min-w-0 cursor-help" title={m.tip}>
            <div className="display text-[22px] leading-none" style={{ color: m.color }}>
              {m.value}
            </div>
            <div className="text-[8.5px] uppercase tracking-wide text-[--color-fg-muted] leading-[1.15] mt-1">
              {m.label}
            </div>
          </div>
        ))}
        {/* Score eficiencia — clickable: abre el desglose de cómo se calcula. */}
        <button
          type="button"
          onClick={() => setVerScore((v) => !v)}
          className="min-w-0 text-left group"
          title="Click para ver cómo se calcula"
        >
          <div className="flex items-baseline gap-0.5">
            <span className="display text-[22px] leading-none" style={{ color: scoreColor }}>
              {efic.score != null ? efic.score : "—"}
            </span>
            {efic.score != null && <span className="text-[10px] text-[--color-fg-dim]">/100</span>}
          </div>
          <div className="text-[8.5px] uppercase tracking-wide text-[--color-fg-muted] leading-[1.15] mt-1 group-hover:text-[--color-accent] flex items-center gap-0.5">
            Score eficiencia <span className="text-[--color-accent]">{verScore ? "▾" : "ⓘ"}</span>
          </div>
        </button>
      </div>

      {/* Explicación del score (al pinchar) */}
      {verScore && (
        <div className="mt-2 rounded-lg border border-[--color-border-soft] bg-[--color-bg-elev-1] p-2.5">
          <div className="text-[10.5px] text-[--color-fg] font-semibold">
            Score de eficiencia · 0-100 (mayor = mejor)
          </div>
          <div className="text-[9.5px] text-[--color-fg-muted] leading-snug mt-0.5">
            Qué tan bien {marca ?? "Pompeyo"} convierte capital en ventas. Parte de 100 y resta
            penalización por cada ineficiencia:
          </div>
          {penal.length > 0 ? (
            <div className="mt-1.5 space-y-1">
              {penal.map((p) => (
                <div key={p.label} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] text-[--color-fg] font-medium">{p.label}</div>
                    <div className="text-[8.5px] text-[--color-fg-dim] leading-tight">{p.base}</div>
                  </div>
                  <span
                    className="mono text-[10.5px] shrink-0"
                    style={{ color: p.val > 0 ? COL.rojo : COL.dim }}
                  >
                    {p.val > 0 ? `−${p.val}` : "0"}
                  </span>
                </div>
              ))}
              <div className="flex justify-between text-[10.5px] font-semibold border-t border-[--color-border-soft] pt-1 mt-1">
                <span className="text-[--color-fg]">100 − penalizaciones = Score</span>
                <span className="mono" style={{ color: scoreColor }}>
                  {efic.score}/100
                </span>
              </div>
            </div>
          ) : (
            <div className="text-[10px] text-[--color-fg-dim] mt-1">
              Sin ventas Q1 para esta marca — no se puede calcular.
            </div>
          )}
        </div>
      )}

      {/* Breakdown del capital utilizado */}
      <div className="mt-2.5 pt-2.5 border-t border-[--color-border-soft] flex gap-3">
        {lineas.map((l) => (
          <div key={l.label} className="flex-1 min-w-0">
            <div className="text-[9px] uppercase tracking-wide text-[--color-fg-muted] leading-[1.1]">
              {l.label}
            </div>
            <div className="mono text-[12px] text-[--color-fg] mt-0.5">{fmtCLPCompact(l.monto)}</div>
            <div className="text-[9px] text-[--color-fg-dim] mt-0.5">{fmtNum(l.unidades)} u</div>
          </div>
        ))}
      </div>

      {/* Footer: venta mensual ponderada (N-1 50% · N-2 30% · N-3 20%), base del MOS y Capital/Venta */}
      <div className="text-[8.5px] text-[--color-fg-dim] mt-2 leading-snug">
        {ventaPond ? (
          <>
            Venta ponderada:{" "}
            <span className="text-[--color-fg-muted] font-medium">
              {fmtCLPCompact(ventaPond.monto)} · {fmtNum(Math.round(ventaPond.unidades))} u
            </span>{" "}
            (N-1 50% · N-2 30% · N-3 20%).{" "}
          </>
        ) : (
          <>Sin ventas en la ventana ponderada para esta marca. </>
        )}
        {marca && normalizarMarcaOperacional(marca) === MARCA_USADOS
          ? "* Capital puente = BU propio recibido por usados. El VU en ventas de autos nuevos se atribuye a su marca originadora (no suma acá)."
          : "* Capital puente = VU/BU recibido en parte de pago, atribuido a la marca que lo originó."}
      </div>
    </div>
  );
}

/** Panel de drill inline reutilizable — se abre debajo de las cards. */
function DrillPanel({
  titulo,
  subtitulo,
  onClose,
  children,
}: {
  titulo: string;
  subtitulo: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[--color-accent]/40 bg-white overflow-hidden ring-1 ring-[--color-accent]/20">
      <div className="px-5 py-3 border-b border-[--color-border-soft] flex items-center justify-between gap-3 flex-wrap bg-[--color-bg-elev-1]">
        <div>
          <span className="text-[13px] font-semibold text-[--color-fg]">{titulo}</span>
          <span className="text-[12px] text-[--color-fg-muted] ml-2">{subtitulo}</span>
        </div>
        <button
          onClick={onClose}
          className="text-[--color-fg-muted] hover:text-[--color-fg] p-1 rounded-md hover:bg-[--color-bg-elev-2] transition"
          aria-label="Cerrar"
        >
          <X className="size-4" />
        </button>
      </div>
      {children}
    </div>
  );
}

/** Chip de gestión por VIN — muestra el estado actual o invita a gestionar. */
/** Tabla de VINs para los drills. Cada VIN abre la Ficha Operacional Unificada
 *  (CasoModal) — gestión persistente por VIN, misma que el resto del sistema. */
function DrillTablaVINs({
  vins,
  financieraDe,
  verTodosHref,
}: {
  vins: Vehiculo[];
  financieraDe?: (v: Vehiculo) => string;
  verTodosHref?: string;
}) {
  // Capital puente: el caso a gestionar es la operación nueva originadora, no el
  // VU/BU recibido. Índice FNE (PatenteVpp/folio) para resolver el VIN origen.
  const fne = useExcelStore((s) => s.fne);
  const fneIndex = useMemo(() => indexarFNEPorOrigen(fne?.registros ?? []), [fne]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[860px]">
        <thead className="text-[10.5px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1]">
          <tr>
            <th className="text-left font-semibold px-4 py-2.5">Marca / Modelo</th>
            <th className="text-left font-semibold px-4 py-2.5">VIN</th>
            <th className="text-left font-semibold px-4 py-2.5">Sucursal</th>
            {financieraDe && (
              <th className="text-left font-semibold px-4 py-2.5">Financiera</th>
            )}
            <th className="text-right font-semibold px-4 py-2.5">Días</th>
            <th className="text-right font-semibold px-4 py-2.5">Monto</th>
            <th className="text-left font-semibold px-4 py-2.5">Tipo</th>
            <th className="text-left font-semibold px-4 py-2.5">Gestión</th>
          </tr>
        </thead>
        <tbody>
          {vins.slice(0, 100).map((v, idx) => {
            const dias = v.diasStock ?? 0;
            const diasColor =
              dias >= 180
                ? "text-[--color-danger]"
                : dias >= 60
                  ? "text-[--color-warning]"
                  : "text-[--color-fg]";
            return (
              <tr
                key={`${v.vin}-${v.rowIndex}`}
                className={cn(
                  "border-b border-[--color-border-soft]",
                  idx % 2 === 0
                    ? "bg-white hover:bg-[--color-bg-elev-1]"
                    : "bg-[--color-bg-elev-1]/40",
                )}
              >
                <td className="px-4 py-2.5">
                  <div className="font-medium text-[12.5px] text-[--color-fg]">
                    {v.marca || v.marcaPompeyo || "—"}
                  </div>
                  <div className="text-[11px] text-[--color-fg-muted] truncate max-w-[220px]">
                    {[v.modelo, v.version].filter(Boolean).join(" · ")}
                  </div>
                </td>
                <td className="px-4 py-2.5 mono text-[11px] text-[--color-fg-muted]">{v.vin}</td>
                <td className="px-4 py-2.5 text-[12px] text-[--color-fg-muted]">
                  {v.sucursal ?? "—"}
                </td>
                {financieraDe && (
                  <td className="px-4 py-2.5 text-[12px] text-[--color-fg-muted]">
                    {financieraDe(v)}
                  </td>
                )}
                <td className={cn("px-4 py-2.5 text-right mono text-[12.5px]", diasColor)}>
                  {dias}
                </td>
                <td className="px-4 py-2.5 text-right mono text-[12.5px] text-[--color-fg]">
                  {fmtCLP(v.costoNeto)}
                </td>
                <td className="px-4 py-2.5">
                  {getCategoriaOperacional(v) === "no_retail" ? (
                    <Badge tone="muted" size="xs">Demo / no retail</Badge>
                  ) : (
                    <Badge tone={NATURALEZA_TONE[v.naturalezaCapital]} size="xs">
                      {NATURALEZA_LABEL[v.naturalezaCapital]}
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {v.esVPPComprometido || v.naturalezaCapital === "puente" ? (
                    <BotonesCasoPuente usado={v} fneIndex={fneIndex} />
                  ) : (
                    <AbrirCasoButton vin={limpiarVIN(v.vin)} origen="Sistema de Velocidad Operacional" />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {vins.length > 100 && (
        <div className="px-4 py-3 text-[11.5px] text-[--color-fg-muted] border-t border-[--color-border-soft] bg-[--color-bg-elev-1]">
          Mostrando primeros 100 de {fmtNum(vins.length)}
          {verTodosHref && (
            <>
              {" "}·{" "}
              <Link href={verTodosHref} className="text-[--color-accent] hover:underline">
                ver todos en el explorador
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// BLOQUE A · Origen del capital — cards clickables con drill inline
// ──────────────────────────────────────────────────────────────────────

function BloqueOrigenCapital({
  kpis,
  vehiculos,
  financieras,
  lineas,
  vuNuevosExcluido,
}: {
  kpis: DashboardKPIs;
  vehiculos: Vehiculo[];
  financieras: LineaFinanciera[];
  lineas: LineaCredito[];
  vuNuevosExcluido: { u: number; cap: number };
}) {
  const [abierto, setAbierto] = useState<"caja" | "financiado" | "pagados" | null>(null);

  const cajaPompeyo = kpis.capitalCajaPompeyo;
  const financiado = kpis.capitalFinanciadoTerceros;
  const sumaOrigen = cajaPompeyo + financiado;
  const cuadra = Math.abs(sumaOrigen - kpis.capitalBruto) < 1;
  const pctCaja = kpis.capitalBruto > 0 ? cajaPompeyo / kpis.capitalBruto : 0;
  const pctFin = kpis.capitalBruto > 0 ? financiado / kpis.capitalBruto : 0;

  // marca → financiera (para mostrar la financiera de cada VIN en el drill)
  const marcaFin = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of lineas) {
      const key = (l.marcaPompeyo ?? l.marca ?? "").toUpperCase();
      if (key && l.financiera) m.set(key, l.financiera);
    }
    return m;
  }, [lineas]);
  const financieraDe = (v: Vehiculo) =>
    marcaFin.get((v.marcaPompeyo || v.marca || "").toUpperCase()) ?? "—";

  // Validación financiera (sistema vs maestro oficial) — capa visible.
  const valFin = useMemo(() => {
    const vals = validarFinancieras(lineas);
    const stats = statsValidacionFinanciera(vals);
    const estadoPorMarca = new Map<string, EstadoValidacion>();
    for (const v of vals) estadoPorMarca.set(v.marca.toUpperCase(), v.estado);
    return { stats, estadoPorMarca };
  }, [lineas]);
  const finPorValidar = valFin.stats.diferencias + valFin.stats.enConciliacion;
  const grupoNoValidado = (marcas: string[]) =>
    marcas.some(
      (m) => (valFin.estadoPorMarca.get(m.toUpperCase()) ?? "en_conciliacion") !== "validado",
    );

  const cajaVins = useMemo(
    () =>
      uniqVinPorTipo(
        vehiculos,
        new Set(["Propio", "FinPropio", "VuPorRecibir", "Desconocido"]),
      ).sort((a, b) => (b.costoNeto || 0) - (a.costoNeto || 0)),
    [vehiculos],
  );
  const finVins = useMemo(
    () =>
      uniqVinPorTipo(vehiculos, new Set(["FloorPlan", "Financiado"])).sort(
        (a, b) => (b.costoNeto || 0) - (a.costoNeto || 0),
      ),
    [vehiculos],
  );
  // Autos pagados = stock propio (tipoStock Propio/FinPropio) — caja ya desembolsada.
  const pagadosVins = useMemo(
    () =>
      uniqVinPorTipo(vehiculos, new Set(["Propio", "FinPropio"])).sort(
        (a, b) => (b.costoNeto || 0) - (a.costoNeto || 0),
      ),
    [vehiculos],
  );

  const donutData = [
    { name: "Caja Pompeyo", value: cajaPompeyo, color: "#15a87b" },
    { name: "Financiado terceros", value: financiado, color: "#d97706" },
  ];

  return (
    <div className="surface top-strip strip-operativo bg-white px-8 pt-7 pb-7 space-y-5">
      <div>
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-accent] font-semibold">
          A · Origen del capital gestionado
        </div>
        <h2 className="text-[14px] font-medium text-[--color-fg-muted] mt-1">
          ¿Cuánto puso Pompeyo y cuánto financian terceros? · cuadra al 100%
        </h2>
      </div>

      {/* Total destacado | Caja | Financiado (tabla) | Composición (donut) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1.05fr_1.1fr_1.55fr_1.15fr] gap-3.5 items-stretch">
        {/* TOTAL — KPI principal, gradient corporativo */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#3358e8] via-[#4f5ff0] to-[#6366f1] px-5 py-5 flex flex-col">
          <div className="absolute -top-10 -right-10 size-36 rounded-full bg-white/10 blur-2xl pointer-events-none" />
          <div className="absolute -bottom-12 -left-8 size-32 rounded-full bg-black/10 blur-2xl pointer-events-none" />
          <div className="relative flex items-start justify-between">
            <div className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-white/85">
              Capital total gestionado
            </div>
            <div className="size-8 rounded-lg bg-white/15 grid place-items-center backdrop-blur-sm">
              <Coins className="size-4 text-white" strokeWidth={1.75} />
            </div>
          </div>
          <div className="relative display text-[40px] mt-4 leading-none text-white">
            {fmtCLPCompact(kpis.capitalBruto)}
          </div>
          <div className="relative text-[12px] text-white/85 mt-2.5">
            {fmtNum(kpis.unidadesTotal)} vehículos ·{" "}
            {vuNuevosExcluido.cap > 0 ? "capital propio de la unidad" : "todo el stock gestionado"}
          </div>
          {vuNuevosExcluido.cap > 0 && (
            <div className="relative text-[10.5px] text-white/70 mt-2 leading-snug border-t border-white/15 pt-2">
              + {fmtNum(vuNuevosExcluido.u)} VU en nuevos ({fmtCLPCompact(vuNuevosExcluido.cap)})
              gestionados — capital atribuido a la marca originadora, no suma acá.
            </div>
          )}
        </div>

        {/* CAJA POMPEYO */}
        <div
          className={cn(
            "rounded-2xl border bg-[--color-success]/[0.05] px-4 py-4 flex flex-col transition",
            abierto === "caja"
              ? "border-[--color-success] ring-2 ring-[--color-success]/25"
              : "border-[--color-success]/35",
          )}
        >
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-lg bg-[--color-success]/12 grid place-items-center">
              <Wallet className="size-3.5 text-[--color-success]" strokeWidth={1.75} />
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.13em] text-[--color-success] font-semibold">
              Caja / capital Pompeyo
            </div>
          </div>
          <div className="display text-[28px] mt-2.5 leading-none text-[--color-fg]">
            {fmtCLPCompact(cajaPompeyo)}
          </div>
          <div className="text-[11.5px] text-[--color-fg-muted] mt-1.5">
            {fmtNum(kpis.unidadesCajaPompeyo)} u · {fmtPct(pctCaja)} del total
          </div>
          <div className="mt-3 pt-3 border-t border-[--color-success]/20 space-y-1.5 flex-1">
            <button
              onClick={() => setAbierto(abierto === "pagados" ? null : "pagados")}
              title="Ver el detalle de los autos pagados (stock propio)"
              className={cn(
                "w-full flex items-baseline justify-between text-[11.5px] rounded-md px-1.5 py-1 -mx-1.5 transition",
                abierto === "pagados"
                  ? "bg-[--color-success]/12"
                  : "hover:bg-[--color-success]/8",
              )}
            >
              <span className="text-[--color-fg-muted] inline-flex items-center gap-1">
                Stock propio (pagados)
                <ArrowUpRight className="size-3 text-[--color-success]" />
              </span>
              <span className="mono text-[--color-fg]">
                {fmtCLPCompact(kpis.capitalPropioPuro)}{" "}
                <span className="text-[--color-fg-dim]">· {fmtNum(kpis.unidadesPropioPuro)}u</span>
              </span>
            </button>
            <div className="flex items-baseline justify-between text-[11.5px]">
              <span className="text-[--color-fg-muted]">Capital en tránsito</span>
              <span className="mono text-[--color-fg]">
                {fmtCLPCompact(kpis.capitalTransito)}{" "}
                <span className="text-[--color-fg-dim]">· {fmtNum(kpis.unidadesTransito)}u</span>
              </span>
            </div>
            <div className="text-[10px] text-[--color-fg-dim] pt-0.5 leading-snug">
              Tránsito = vehículos por recibir y operaciones aún sin clasificar. Sigue siendo
              caja Pompeyo.
            </div>
          </div>
          <button
            onClick={() => setAbierto(abierto === "caja" ? null : "caja")}
            className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[--color-success]/10 hover:bg-[--color-success]/16 text-[--color-success] text-[12px] font-medium py-1.5 transition"
          >
            {abierto === "caja" ? "Ocultar detalle" : "Ver detalle"}
            <ArrowRight className="size-3.5" />
          </button>
        </div>

        {/* FINANCIADO TERCEROS — tabla por financiera */}
        <div
          className={cn(
            "rounded-2xl border bg-[--color-warning]/[0.04] px-4 py-4 flex flex-col transition",
            abierto === "financiado"
              ? "border-[--color-warning] ring-2 ring-[--color-warning]/25"
              : "border-[--color-warning]/35",
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="size-7 rounded-lg bg-[--color-warning]/12 grid place-items-center">
                <Building2 className="size-3.5 text-[--color-warning]" strokeWidth={1.75} />
              </div>
              <div className="text-[10.5px] uppercase tracking-[0.13em] text-[--color-warning] font-semibold">
                Financiado terceros
              </div>
            </div>
            <div className="text-right">
              <div className="display text-[22px] leading-none text-[--color-fg]">
                {fmtCLPCompact(financiado)}
              </div>
              <div className="text-[10.5px] text-[--color-fg-muted] mt-1">
                {fmtNum(kpis.unidadesFinanciadoTerceros)} u · {fmtPct(pctFin)}
              </div>
            </div>
          </div>

          {/* Tabla utilización de líneas */}
          <div className="mt-3 pt-1 flex-1">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="text-[9.5px] uppercase tracking-wider text-[--color-fg-dim]">
                Utilización de líneas
              </div>
              {finPorValidar > 0 ? (
                <Link
                  href="/lineas"
                  className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[--color-warning]/12 text-[--color-warning]"
                  title="Hay marcas con financiera distinta entre el sistema y el maestro oficial. Validar con Tesorería."
                >
                  ⚠ {fmtNum(finPorValidar)} por validar
                </Link>
              ) : (
                <span className="text-[9px] text-[--color-success] font-medium">
                  ✓ validada vs maestro
                </span>
              )}
            </div>
            <div className="grid grid-cols-[1.2fr_0.85fr_0.85fr_0.85fr_1fr] gap-x-2 gap-y-1.5 items-center text-[10.5px]">
              <div className="text-[--color-fg-dim] font-medium">Financiera</div>
              <div className="text-[--color-fg-dim] font-medium text-right">Autoriz.</div>
              <div className="text-[--color-fg-dim] font-medium text-right">Utilizado</div>
              <div className="text-[--color-fg-dim] font-medium text-right">Libre</div>
              <div className="text-[--color-fg-dim] font-medium text-right">% Usado</div>
              {financieras.slice(0, 6).map((f) => {
                const sev = sevLinea(f.pctOcupacion, f.sobregiro);
                return (
                  <Fragment key={f.financiera}>
                    <div
                      className="text-[--color-fg] font-medium truncate"
                      title={
                        grupoNoValidado(f.marcas)
                          ? `${f.financiera} · incluye marcas con financiera por validar contra el maestro`
                          : f.financiera
                      }
                    >
                      {f.financiera}
                      {grupoNoValidado(f.marcas) && (
                        <span className="text-[--color-warning] font-bold"> *</span>
                      )}
                    </div>
                    <div className="mono text-[--color-fg-muted] text-right">
                      {fmtCLPCompact(f.autorizada)}
                    </div>
                    <div className="mono text-[--color-fg] text-right">
                      {fmtCLPCompact(f.ocupada)}
                    </div>
                    <div
                      className={cn(
                        "mono text-right",
                        f.libre < 0 ? "text-[--color-danger]" : "text-[--color-fg-muted]",
                      )}
                    >
                      {fmtCLPCompact(f.libre)}
                    </div>
                    <div className="flex items-center gap-1.5 justify-end">
                      <div className="h-1.5 w-9 rounded-full bg-[--color-bg-elev-3] overflow-hidden shrink-0">
                        <div
                          className={cn("h-full rounded-full", sev.bar)}
                          style={{ width: `${Math.min(100, f.pctOcupacion * 100)}%` }}
                        />
                      </div>
                      <span className={cn("font-semibold tabular w-8 text-right", sev.text)}>
                        {Math.round(f.pctOcupacion * 100)}%
                      </span>
                    </div>
                  </Fragment>
                );
              })}
            </div>
            <div className="text-[9.5px] text-[--color-fg-dim] mt-2 leading-snug">
              &ldquo;Otras financieras&rdquo; incluye participaciones menores o sin clasificación
              específica.{" "}
              {finPorValidar > 0 && (
                <span className="text-[--color-warning]">
                  * financiera por validar vs maestro oficial — ver Líneas.
                </span>
              )}
            </div>
          </div>

          <button
            onClick={() => setAbierto(abierto === "financiado" ? null : "financiado")}
            className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[--color-warning]/10 hover:bg-[--color-warning]/16 text-[--color-warning] text-[12px] font-medium py-1.5 transition"
          >
            {abierto === "financiado" ? "Ocultar detalle" : "Ver detalle"}
            <ArrowRight className="size-3.5" />
          </button>
        </div>

        {/* COMPOSICIÓN — donut + cuadratura */}
        <div className="rounded-2xl border border-[--color-border] bg-[--color-bg-elev-2] px-4 py-4 flex flex-col">
          <div className="text-[10.5px] uppercase tracking-[0.13em] text-[--color-fg-muted] font-semibold">
            Composición del capital
          </div>
          <div className="text-[10px] text-[--color-fg-dim]">(en $ y % del total)</div>
          <div className="flex items-center gap-3 mt-2 flex-1">
            <div className="relative size-[112px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={36}
                    outerRadius={54}
                    paddingAngle={2}
                    strokeWidth={0}
                    startAngle={90}
                    endAngle={-270}
                  >
                    {donutData.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#ffffff",
                      border: "1px solid #d4d9e0",
                      borderRadius: 10,
                      fontSize: 11,
                      padding: "6px 10px",
                      boxShadow: "0 12px 32px -8px rgba(15,23,42,0.15)",
                      color: "#1a1f2e",
                    }}
                    formatter={(v) => {
                      const value = typeof v === "number" ? v : 0;
                      const pct = kpis.capitalBruto > 0 ? value / kpis.capitalBruto : 0;
                      return [`${fmtCLPCompact(value)} · ${fmtPct(pct)}`, ""];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 grid place-items-center pointer-events-none">
                <div className="text-center">
                  <div className="display text-[14px] leading-none text-[--color-fg]">
                    {fmtCLPCompact(kpis.capitalBruto)}
                  </div>
                  <div className="text-[9px] text-[--color-fg-dim] mt-0.5">100%</div>
                </div>
              </div>
            </div>
            <div className="space-y-2.5 min-w-0">
              <div>
                <div className="flex items-center gap-1.5 text-[11px] text-[--color-fg-muted]">
                  <span className="inline-block size-2 rounded-sm bg-[--color-success]" />
                  Caja Pompeyo
                </div>
                <div className="text-[11.5px] mono text-[--color-fg] ml-3.5">
                  {fmtCLPCompact(cajaPompeyo)}{" "}
                  <span className="text-[--color-fg-dim]">({fmtPct(pctCaja)})</span>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-[11px] text-[--color-fg-muted]">
                  <span className="inline-block size-2 rounded-sm bg-[--color-warning]" />
                  Financiado terceros
                </div>
                <div className="text-[11.5px] mono text-[--color-fg] ml-3.5">
                  {fmtCLPCompact(financiado)}{" "}
                  <span className="text-[--color-fg-dim]">({fmtPct(pctFin)})</span>
                </div>
              </div>
            </div>
          </div>
          <div
            className={cn(
              "mt-3 rounded-lg px-3 py-2 flex items-center gap-2 text-[11px]",
              cuadra
                ? "bg-[--color-success]/8 text-[--color-success]"
                : "bg-[--color-danger]/8 text-[--color-danger]",
            )}
          >
            <span
              className={cn(
                "inline-block size-1.5 rounded-full",
                cuadra ? "bg-[--color-success]" : "bg-[--color-danger]",
              )}
            />
            {cuadra ? (
              <span className="font-medium">
                Cuadra 100% ·{" "}
                <span className="text-[--color-fg-muted] font-normal">
                  Suma = {fmtCLPCompact(sumaOrigen)}
                </span>
              </span>
            ) : (
              <span className="font-medium">
                Δ {fmtCLPCompact(Math.abs(sumaOrigen - kpis.capitalBruto))} · revisar
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Frase de cierre ejecutiva */}
      <div className="text-[11.5px] text-[--color-fg-dim] leading-relaxed border-t border-[--color-border-soft] pt-3">
        <span className="text-[--color-fg-muted] font-medium">Lectura:</span> Del total
        gestionado,{" "}
        <span className="text-[--color-success] font-medium">{fmtCLPCompact(cajaPompeyo)}</span>{" "}
        ({fmtPct(pctCaja)}) corresponden a caja Pompeyo y{" "}
        <span className="text-[--color-warning] font-medium">{fmtCLPCompact(financiado)}</span>{" "}
        ({fmtPct(pctFin)}) a financiamiento externo. El capital en tránsito sigue siendo
        exposición propia de Pompeyo, no una financiera aparte.
      </div>

      {/* Drill inline */}
      {abierto === "caja" && (
        <DrillPanel
          titulo="Caja / capital Pompeyo"
          subtitulo={`${fmtNum(cajaVins.length)} unidades · ${fmtCLPCompact(cajaPompeyo)} · stock propio + tránsito`}
          onClose={() => setAbierto(null)}
        >
          <DrillTablaVINs vins={cajaVins} verTodosHref="/stock?tipoStock=Propio" />
        </DrillPanel>
      )}
      {abierto === "pagados" && (
        <DrillPanel
          titulo="Autos pagados (stock propio)"
          subtitulo={`${fmtNum(pagadosVins.length)} unidades · ${fmtCLPCompact(kpis.capitalPropioPuro)} · caja propia ya desembolsada`}
          onClose={() => setAbierto(null)}
        >
          <DrillTablaVINs vins={pagadosVins} verTodosHref="/stock?tipoStock=Propio" />
        </DrillPanel>
      )}
      {abierto === "financiado" && (
        <DrillPanel
          titulo="Financiado terceros"
          subtitulo={`${fmtNum(finVins.length)} unidades · ${fmtCLPCompact(financiado)} · en línea de financieras`}
          onClose={() => setAbierto(null)}
        >
          <DrillTablaVINs
            vins={finVins}
            financieraDe={financieraDe}
            verTodosHref="/stock?tipoStock=FloorPlan"
          />
        </DrillPanel>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// BLOQUE B · Estado operacional — 4 cards clickables con drill inline
// ──────────────────────────────────────────────────────────────────────

type BloqueBTone = "caja" | "info" | "orange" | "teal" | "tescar";

const BLOQUE_B_TONE: Record<
  BloqueBTone,
  {
    strip: string;
    text: string;
    iconBg: string;
    btn: string;
    btnActive: string;
    icon: React.ReactNode;
  }
> = {
  caja: {
    strip: "strip-caja",
    text: "text-[#334155]",
    iconBg: "bg-[#334155]/10",
    btn: "bg-[#334155]/8 text-[#334155] hover:bg-[#334155]/16",
    btnActive: "bg-[#334155] text-white",
    icon: <Wallet className="size-3.5" strokeWidth={1.75} />,
  },
  info: {
    strip: "strip-operativo",
    text: "text-[--color-accent]",
    iconBg: "bg-[--color-accent]/10",
    btn: "bg-[--color-accent]/8 text-[--color-accent] hover:bg-[--color-accent]/16",
    btnActive: "bg-[--color-accent] text-white",
    icon: <Send className="size-3.5" strokeWidth={1.75} />,
  },
  orange: {
    strip: "strip-orange",
    text: "text-[#ea580c]",
    iconBg: "bg-[#ea580c]/10",
    btn: "bg-[#ea580c]/8 text-[#ea580c] hover:bg-[#ea580c]/16",
    btnActive: "bg-[#ea580c] text-white",
    icon: <Lock className="size-3.5" strokeWidth={1.75} />,
  },
  teal: {
    strip: "strip-teal",
    text: "text-[#0d9488]",
    iconBg: "bg-[#0d9488]/10",
    btn: "bg-[#0d9488]/8 text-[#0d9488] hover:bg-[#0d9488]/16",
    btnActive: "bg-[#0d9488] text-white",
    icon: <ArrowLeftRight className="size-3.5" strokeWidth={1.75} />,
  },
  tescar: {
    strip: "strip-violet",
    text: "text-[#7c3aed]",
    iconBg: "bg-[#7c3aed]/10",
    btn: "bg-[#7c3aed]/8 text-[#7c3aed] hover:bg-[#7c3aed]/16",
    btnActive: "bg-[#7c3aed] text-white",
    icon: <TestTube2 className="size-3.5" strokeWidth={1.75} />,
  },
};

/**
 * Capital inmovilizado = capital con PROBLEMA / sin operación viva.
 * Judicial + Stock B + pagado sin rotación (+180d) + CPD estancado.
 * EXCLUYE TESCAR (demos = uso operacional, no problema). Incluye propio y
 * financiado por terceros (un FloorPlan en Stock B también está inmovilizado).
 * Sobregiro es un problema de LÍNEA (marca), se ve en el módulo Líneas.
 */
function esInmovilizadoProblema(v: Vehiculo): boolean {
  if (v.esTescar) return false;
  if (v.esJudicial || v.esStockB) return true;
  const pagadoViejo =
    (v.tipoStock === "Propio" || v.tipoStock === "FinPropio") && (v.diasStock ?? 0) > 180;
  if (pagadoViejo) return true;
  const cpdEstancado = v.estadoFlujoVO === "Proceso CPD" && (v.diasStock ?? 0) > 60;
  if (cpdEstancado) return true;
  return false;
}

type SubFiltroB = "all" | "edad" | "mas180" | "topMarca";

function BloqueOperacional({ vehiculos }: { vehiculos: Vehiculo[] }) {
  const [sel, setSel] = useState<{ catId: string; sub: SubFiltroB } | null>(null);

  const categorias = useMemo(() => {
    const defs: {
      id: string;
      label: string;
      desc: string;
      match: (v: Vehiculo) => boolean;
      href: string;
      tone: BloqueBTone;
    }[] = [
      {
        id: "pagado",
        label: "Stock pagado retail",
        desc: "Caja propia desembolsada en stock RETAIL vendible (Propio / FinPropio). Exposición directa que debe rotar. Excluye demos, company y test cars (van a su card). Una marca no debería superar ~2% pagado.",
        match: (v) =>
          (v.tipoStock === "Propio" || v.tipoStock === "FinPropio") &&
          getCategoriaOperacional(v) === "stock_retail",
        href: "/stock?tipoStock=Propio",
        tone: "caja",
      },
      {
        id: "inmovilizado",
        label: "Capital detenido / lento",
        desc: "Capital estructuralmente lento: judicial, stock B, CPD estancado y pagado sin rotación (+180d). Activos que no se mueven a velocidad operacional. (TESCAR va aparte.)",
        match: esInmovilizadoProblema,
        href: "/stock?flags=judicial",
        tone: "orange",
      },
      {
        id: "puente",
        label: "Capital puente",
        desc: "Usados recibidos en parte de pago y operaciones nuevas todavía no cerradas o ingresadas a línea. Consume caja y capacidad operacional.",
        match: (v) => v.naturalezaCapital === "puente",
        href: "/stock?naturaleza=puente",
        tone: "teal",
      },
    ];
    // Dedup VIN por categoría + métricas (aging, >180d, top marcas)
    return defs.map((d) => {
      const seen = new Set<string>();
      const vins: Vehiculo[] = [];
      let capital = 0;
      let sumaDias = 0;
      let conDias = 0;
      let mas180 = 0;
      let capitalMas180 = 0;
      const porMarca = new Map<string, number>();
      for (const v of vehiculos) {
        if (!d.match(v)) continue;
        if (seen.has(v.vin)) continue;
        seen.add(v.vin);
        vins.push(v);
        const c = v.costoNeto || 0;
        capital += c;
        const dias = v.diasStock ?? null;
        if (dias != null) {
          sumaDias += dias;
          conDias++;
          if (dias >= 180) {
            mas180++;
            capitalMas180 += c;
          }
        }
        const marca = getMarcaOperacional(v);
        porMarca.set(marca, (porMarca.get(marca) ?? 0) + c);
      }
      vins.sort((a, b) => (b.diasStock ?? 0) - (a.diasStock ?? 0));
      const topMarcas = [...porMarca.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([m]) => m);
      return {
        ...d,
        vins,
        capital,
        unidades: vins.length,
        agingProm: conDias > 0 ? Math.round(sumaDias / conDias) : 0,
        mas180,
        capitalMas180,
        topMarcas,
      };
    });
  }, [vehiculos]);

  // Lectura SECUNDARIA (composición, no foco): capital en movimiento operacional
  // (FNE / puente / tránsito). 186u no es accionable — el foco es Stock pagado.
  const movimiento = useMemo(() => {
    const seen = new Set<string>();
    let capital = 0;
    let unidades = 0;
    for (const v of vehiculos) {
      const n = v.naturalezaCapital;
      if (n !== "operativo" && n !== "puente" && n !== "transito") continue;
      if (seen.has(v.vin)) continue;
      seen.add(v.vin);
      unidades++;
      capital += v.costoNeto || 0;
    }
    return { capital, unidades };
  }, [vehiculos]);

  // TESCAR oficial (Control TestCars: Test Cars + BDR), por marca y filtro global.
  const tescarControl = useExcelStore((s) => s.data?.tescarControl ?? []);
  const marcaFiltro = useMarcaFilter((s) => s.marca);
  const tescar = useMemo(() => tescarStats(tescarControl, marcaFiltro), [tescarControl, marcaFiltro]);

  const isSel = (catId: string, sub: SubFiltroB) =>
    sel?.catId === catId && sel?.sub === sub;
  const toggle = (catId: string, sub: SubFiltroB) =>
    setSel((s) => (s && s.catId === catId && s.sub === sub ? null : { catId, sub }));

  // Clases compartidas para mini-cards clickables
  const miniBase =
    "rounded-lg border px-2 py-1.5 text-left transition w-full focus:outline-none";
  const miniSel = "border-[--color-accent] ring-2 ring-[--color-accent]/30 bg-[--color-accent]/[0.04]";
  const miniIdle =
    "bg-[--color-bg-elev-2] border-[--color-border-soft] hover:border-[--color-accent]/50 hover:bg-[--color-bg-elev-3]";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {categorias.map((c) => {
          const cfg = BLOQUE_B_TONE[c.tone];
          const cardSel = sel?.catId === c.id;
          return (
            <div
              key={c.id}
              className={cn(
                "surface top-strip transition flex flex-col px-4 pt-5 pb-4 bg-white",
                cfg.strip,
                cardSel ? "border-[--color-accent]" : "",
              )}
            >
              <div className="flex items-center gap-2">
                <div className={cn("size-7 rounded-lg grid place-items-center", cfg.iconBg)}>
                  <span className={cfg.text}>{cfg.icon}</span>
                </div>
                <div
                  className={cn(
                    "text-[10.5px] uppercase tracking-[0.11em] font-semibold leading-tight",
                    cfg.text,
                  )}
                >
                  {c.label}
                </div>
              </div>

              <div className="flex items-baseline gap-2 mt-3">
                <div className="display text-[26px] leading-none text-[--color-fg]">
                  {fmtCLPCompact(c.capital)}
                </div>
                <div className="text-[11px] text-[--color-fg-muted]">{fmtNum(c.unidades)} u</div>
              </div>

              <div className="text-[11px] text-[--color-fg-dim] mt-2 leading-snug min-h-[44px]">
                {c.desc}
              </div>

              {/* Mini-KPIs clickables → cada uno abre su subconjunto de VINs */}
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                <button
                  onClick={() => toggle(c.id, "edad")}
                  title="Ver VINs ordenados por antigüedad"
                  className={cn(miniBase, isSel(c.id, "edad") ? miniSel : miniIdle)}
                >
                  <div className="text-[9px] uppercase tracking-wide text-[--color-fg-dim]">
                    Edad prom
                  </div>
                  <div className="text-[12px] mono text-[--color-fg] mt-0.5">{c.agingProm}d</div>
                </button>
                <button
                  onClick={() => toggle(c.id, "mas180")}
                  title="Ver VINs sobre 180 días"
                  className={cn(miniBase, isSel(c.id, "mas180") ? miniSel : miniIdle)}
                >
                  <div className="text-[9px] uppercase tracking-wide text-[--color-fg-dim]">
                    &gt;180 días
                  </div>
                  <div
                    className={cn(
                      "text-[12px] mono mt-0.5",
                      c.mas180 > 0 ? "text-[--color-danger]" : "text-[--color-fg]",
                    )}
                  >
                    {fmtNum(c.mas180)} u
                    {c.mas180 > 0 && (
                      <span className="text-[9.5px] text-[--color-fg-dim] block leading-tight">
                        {fmtCLPCompact(c.capitalMas180)}
                      </span>
                    )}
                  </div>
                </button>
                <button
                  onClick={() => toggle(c.id, "topMarca")}
                  disabled={c.topMarcas.length === 0}
                  title={
                    c.topMarcas[0]
                      ? `Ver VINs de ${c.topMarcas[0]}`
                      : "Sin marcas"
                  }
                  className={cn(
                    miniBase,
                    "min-w-0",
                    isSel(c.id, "topMarca") ? miniSel : miniIdle,
                    c.topMarcas.length === 0 && "opacity-60 cursor-default",
                  )}
                >
                  <div className="text-[9px] uppercase tracking-wide text-[--color-fg-dim]">
                    Top marcas
                  </div>
                  <div
                    className="text-[11px] text-[--color-fg] mt-0.5 truncate"
                    title={c.topMarcas.join(" · ")}
                  >
                    {c.topMarcas.length > 0 ? c.topMarcas.join(" · ") : "—"}
                  </div>
                </button>
              </div>

              {/* Ver detalle (todos) */}
              <button
                onClick={() => toggle(c.id, "all")}
                className={cn(
                  "mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg text-[12px] font-medium py-1.5 transition",
                  isSel(c.id, "all") ? cfg.btnActive : cfg.btn,
                )}
              >
                {isSel(c.id, "all") ? "Ocultar detalle" : "Ver detalle"} ({fmtNum(c.unidades)} u)
                <ArrowRight className="size-3.5" />
              </button>
            </div>
          );
        })}

        {/* 4ª card · TESCAR oficial (Control TestCars: Test Cars + BDR) */}
        {(() => {
          const cfg = BLOQUE_B_TONE.tescar;
          return (
            <div className={cn("surface top-strip transition flex flex-col px-4 pt-5 pb-4 bg-white", cfg.strip)}>
              <div className="flex items-center gap-2">
                <div className={cn("size-7 rounded-lg grid place-items-center", cfg.iconBg)}>
                  <span className={cfg.text}>{cfg.icon}</span>
                </div>
                <div className={cn("text-[10.5px] uppercase tracking-[0.11em] font-semibold leading-tight", cfg.text)}>
                  TESCAR · Test Cars + BDR
                </div>
              </div>
              <div className="flex items-baseline gap-2 mt-3">
                <div className="display text-[26px] leading-none text-[--color-fg]">
                  {fmtCLPCompact(tescar.capitalTotal)}
                </div>
                <div className="text-[11px] text-[--color-fg-muted]">{fmtNum(tescar.totalUnidades)} u</div>
              </div>
              <div className="text-[11px] text-[--color-fg-dim] mt-2 leading-snug min-h-[44px]">
                Demos comerciales (fuente oficial Control TestCars). Consume capital de trabajo aunque
                esté financiado. Renting y company van aparte.
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                <div className="rounded-lg border border-[--color-border-soft] bg-[--color-bg-elev-2] px-2 py-1.5">
                  <div className="text-[9px] uppercase tracking-wide text-[--color-fg-dim]">Edad prom</div>
                  <div className="text-[12px] mono text-[--color-fg] mt-0.5">{tescar.agingPromedio}d</div>
                </div>
                <div className="rounded-lg border border-[--color-border-soft] bg-[--color-bg-elev-2] px-2 py-1.5">
                  <div className="text-[9px] uppercase tracking-wide text-[--color-fg-dim]">&gt;180 días</div>
                  <div className={cn("text-[12px] mono mt-0.5", tescar.mas180 > 0 ? "text-[--color-danger]" : "text-[--color-fg]")}>
                    {fmtNum(tescar.mas180)} u
                  </div>
                </div>
                <div className="rounded-lg border border-[--color-border-soft] bg-[--color-bg-elev-2] px-2 py-1.5 min-w-0">
                  <div className="text-[9px] uppercase tracking-wide text-[--color-fg-dim]">Top marcas</div>
                  <div className="text-[11px] text-[--color-fg] mt-0.5 truncate" title={tescar.porMarca.map((m) => m.marca).join(" · ")}>
                    {tescar.porMarca.slice(0, 3).map((m) => m.marca).join(" · ") || "—"}
                  </div>
                </div>
              </div>
              <Link
                href="/tescar"
                className={cn("mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg text-[12px] font-medium py-1.5 transition", cfg.btn)}
              >
                Ver detalle en TESCAR ({fmtNum(tescar.totalUnidades)} u)
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
          );
        })()}
      </div>

      {/* Lectura secundaria — composición (no foco de acción) */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[11px] text-[--color-fg-muted]">
        <span className="text-[9.5px] uppercase tracking-[0.12em] text-[--color-fg-dim] font-semibold">
          Lectura secundaria
        </span>
        <Link href="/stock?naturaleza=operativo" className="hover:text-[--color-accent] transition">
          Capital en movimiento operacional:{" "}
          <span className="font-semibold text-[--color-fg]">{fmtCLPCompact(movimiento.capital)}</span>
          {" · "}
          {fmtNum(movimiento.unidades)} u
        </Link>
        <span className="text-[--color-fg-dim]">
          (FNE, puente y tránsito — composición del flujo, no foco de acción)
        </span>
      </div>

      {/* Drill inline — debajo de las cards, filtrado por la mini-card elegida */}
      {sel &&
        (() => {
          const cat = categorias.find((c) => c.id === sel.catId);
          if (!cat) return null;
          const topMarca = cat.topMarcas[0] ?? null;
          const vinsF =
            sel.sub === "mas180"
              ? cat.vins.filter((v) => (v.diasStock ?? 0) >= 180)
              : sel.sub === "topMarca" && topMarca
                ? cat.vins.filter((v) => getMarcaOperacional(v) === topMarca)
                : cat.vins;
          const subLabel =
            sel.sub === "mas180"
              ? "sobre 180 días"
              : sel.sub === "topMarca"
                ? `marca ${topMarca ?? "—"}`
                : sel.sub === "edad"
                  ? "ordenado por antigüedad"
                  : "todos los VINs";
          const capF = vinsF.reduce((s, v) => s + (v.costoNeto || 0), 0);
          return (
            <DrillPanel
              titulo={cat.label}
              subtitulo={`${fmtNum(vinsF.length)} unidades · ${fmtCLPCompact(capF)} · ${subLabel}`}
              onClose={() => setSel(null)}
            >
              <DrillTablaVINs vins={vinsF} verTodosHref={cat.href} />
            </DrillPanel>
          );
        })()}
    </div>
  );
}


function HeroKPI({
  label,
  value,
  sub,
  tone = "default",
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "danger" | "warning" | "success" | "accent";
  /** Si se entrega, la tarjeta se vuelve un enlace clickeable a esa ruta. */
  href?: string;
}) {
  const stripClass =
    tone === "danger"
      ? "strip-danger"
      : tone === "warning"
        ? "strip-warning"
        : tone === "success"
          ? "strip-success"
          : tone === "accent"
            ? "strip-operativo"
            : "strip-operativo";

  const toneClass =
    tone === "danger"
      ? "text-[--color-danger]"
      : tone === "warning"
        ? "text-[--color-warning]"
        : tone === "success"
          ? "text-[--color-success]"
          : tone === "accent"
            ? "text-[--color-fg]"
            : "text-[--color-fg]";

  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-muted] font-medium">
          {label}
        </div>
        {href && (
          <ArrowUpRight className="size-4 text-[--color-fg-dim] group-hover:text-[--color-accent] transition shrink-0" />
        )}
      </div>
      <div className={cn("display text-[40px] mt-3 leading-none", toneClass)}>{value}</div>
      {sub && (
        <div className="text-[12.5px] text-[--color-fg-muted] mt-3 leading-relaxed">{sub}</div>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          "surface top-strip bg-white px-6 pt-7 pb-6 block group transition surface-hover hover:border-[--color-accent]/40 cursor-pointer",
          stripClass,
        )}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className={cn("surface top-strip bg-white px-6 pt-7 pb-6", stripClass)}>{inner}</div>
  );
}

/**
 * Construye el href de una NaturalezaCard preservando el filtro global de
 * marca operacional activo. Sin marca activa devuelve el href "limpio".
 *
 * Fix del bug donde el universo del Stock Explorer no respetaba el filtro
 * de marca al navegar desde una NaturalezaCard del Bloque B.
 */
function naturalezaHref(naturaleza: string, marca: string | null): string {
  const params = new URLSearchParams({ naturaleza });
  if (marca) params.set("marcaOriginadora", marca);
  return `/stock?${params.toString()}`;
}

function NaturalezaCard({
  href,
  label,
  description,
  capital,
  unidades,
  tone,
  icon,
  index,
}: {
  href: string;
  label: string;
  description?: string;
  capital: number;
  unidades: number;
  tone: "success" | "info" | "warning" | "danger" | "judicial";
  icon: React.ReactNode;
  index: number;
}) {
  const stripClass =
    tone === "success"
      ? "strip-retail"
      : tone === "info"
        ? "strip-operativo"
        : tone === "warning"
          ? "strip-puente"
          : tone === "judicial"
            ? "strip-judicial"
            : "strip-atrapado";

  const accentText =
    tone === "success"
      ? "text-[--color-success]"
      : tone === "info"
        ? "text-[--color-info]"
        : tone === "warning"
          ? "text-[--color-warning]"
          : tone === "judicial"
            ? "text-[#7c2d12]"
            : "text-[--color-danger]";

  return (
    <Link
      href={href}
      className={cn(
        "surface surface-hover top-strip group block px-6 pt-6 pb-5 bg-white",
        stripClass,
      )}
      title={description}
    >
      {/* Numbered kicker */}
      <div className="flex items-center justify-between">
        <div className={cn("text-[10.5px] uppercase tracking-[0.14em] font-semibold flex items-center gap-2 min-w-0", accentText)}>
          <span className="opacity-70 mono shrink-0">{String(index).padStart(2, "0")}</span>
          <span className="text-[--color-fg-dim] font-normal shrink-0">·</span>
          <span className="truncate">{label}</span>
        </div>
        <ArrowUpRight className="size-3.5 text-[--color-fg-dim] group-hover:text-[--color-accent] transition shrink-0" />
      </div>

      {/* Big display value */}
      <div className="display text-[32px] mt-5 leading-none text-[--color-fg]">
        {fmtCLPCompact(capital)}
      </div>

      {/* Subtitle with icon */}
      <div className="flex items-center gap-1.5 text-[12.5px] text-[--color-fg-muted] mt-3">
        <span className={cn("opacity-80", accentText)}>{icon}</span>
        {fmtNum(unidades)} unidades
      </div>

      {description && (
        <div className="text-[11.5px] text-[--color-fg-dim] mt-2 leading-snug line-clamp-2">
          {description}
        </div>
      )}
    </Link>
  );
}

function SectionHeader({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h2 className="text-[18px] font-semibold tracking-tight text-[--color-fg]">{title}</h2>
        {sub && <p className="text-[13px] text-[--color-fg-muted] mt-1">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

function InsightsSection({
  atrapadoUnits,
  judicialCap,
  judicialUnits,
  puenteCap,
  puenteUnits,
  stockBCap,
  stockBUnits,
  fneFloorPlan,
  fneFloorPlanUnits,
  financierasAlLimite,
}: {
  atrapadoUnits: number;
  judicialCap: number;
  judicialUnits: number;
  puenteCap: number;
  puenteUnits: number;
  stockBCap: number;
  stockBUnits: number;
  fneFloorPlan: number;
  fneFloorPlanUnits: number;
  financierasAlLimite: LineaFinanciera[];
}) {
  // Solo mostrar si hay algo relevante para contar
  const tieneAtrapado = atrapadoUnits > 0;
  const tieneJudicial = judicialUnits > 0;
  const tienePuente = puenteUnits > 0;
  const tieneStockB = stockBUnits > 0;
  const tieneFlot = fneFloorPlanUnits > 0;
  const tieneCriticas = financierasAlLimite.length > 0;
  const dispLineas = financierasAlLimite.reduce((s, f) => s + Math.max(0, f.libre), 0);

  if (!tieneAtrapado && !tieneJudicial && !tienePuente && !tieneStockB && !tieneFlot && !tieneCriticas)
    return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {tieneJudicial && (
        <InsightCard
          tone="judicial"
          icon={<Snowflake className="size-4" strokeWidth={1.75} />}
          title="Stock judicial"
          body={
            <>
              <span className="display text-[22px] text-[#7c2d12]">
                {fmtCLPCompact(judicialCap)}
              </span>{" "}
              en{" "}
              <span className="font-semibold text-[--color-fg]">
                {fmtNum(judicialUnits)} unidades
              </span>{" "}
              en proceso judicial — situación legal distinta, requiere seguimiento separado.
            </>
          }
          actionHref="/stock?naturaleza=judicial"
          actionLabel="Ver judiciales"
        />
      )}
      {tieneStockB && (
        <InsightCard
          tone="muted"
          icon={<Wrench className="size-4" strokeWidth={1.75} />}
          title="Stock B (taller / reacondicionamiento)"
          body={
            <>
              <span className="display text-[22px] text-[#475569]">
                {fmtCLPCompact(stockBCap)}
              </span>{" "}
              en{" "}
              <span className="font-semibold text-[--color-fg]">
                {fmtNum(stockBUnits)} unidades
              </span>{" "}
              detenidas en servicio técnico / reacondicionamiento — no se pueden vender hasta
              resolver. Capital parado en taller.
            </>
          }
          actionHref="/stock?flags=stockB"
          actionLabel="Ver Stock B"
        />
      )}
      {tienePuente && (
        <InsightCard
          tone="warning"
          icon={<Layers className="size-4" strokeWidth={1.75} />}
          title="Capital puente"
          body={
            <>
              <span className="display text-[22px] text-[--color-warning]">
                {fmtCLPCompact(puenteCap)}
              </span>{" "}
              en VPP recibido + CPD usados fuera de línea, todavía no pagados.{" "}
              <span className="text-[--color-fg]">{fmtNum(puenteUnits)}</span> vehículos.
            </>
          }
          actionHref="/vu-en-fne"
          actionLabel="Ver VU en FNE"
        />
      )}
      {tieneFlot && (
        <InsightCard
          tone="info"
          icon={<Truck className="size-4" strokeWidth={1.75} />}
          title="FNE en Floor Plan"
          body={
            <>
              <span className="display text-[22px] text-[--color-info]">
                {fmtCLPCompact(fneFloorPlan)}
              </span>{" "}
              en línea ocupada por vehículos vendidos pero no entregados —{" "}
              <span className="text-[--color-fg]">{fmtNum(fneFloorPlanUnits)} unidades</span>.
              Acelera entregas para liberar línea.
            </>
          }
          actionHref="/stock?estadoCapital=FNE_EN_OPERACION&tipoStock=FloorPlan"
          actionLabel="Ver FNE Floor Plan"
        />
      )}
      {tieneCriticas && (
        <InsightCard
          tone="danger"
          icon={<Layers className="size-4" strokeWidth={1.75} />}
          title="Líneas al límite (>90%)"
          body={
            <>
              <span className="font-semibold text-[--color-fg]">{financierasAlLimite.length}</span>{" "}
              financiera{financierasAlLimite.length > 1 ? "s" : ""} sobre 90% de uso:{" "}
              {financierasAlLimite.slice(0, 3).map((f, i) => (
                <span key={f.financiera}>
                  {i > 0 && " · "}
                  <span className="text-[--color-fg] font-medium">{f.financiera}</span>{" "}
                  {Math.round(f.pctOcupacion * 100)}%
                  {f.sobregiro > 0 && (
                    <span className="text-[--color-danger]"> (sobregiro)</span>
                  )}
                </span>
              ))}
              .{" "}
              {dispLineas > 0 && (
                <>
                  Solo <span className="text-[--color-fg]">{fmtCLPCompact(dispLineas)}</span> disponible.
                </>
              )}
            </>
          }
          actionHref="/lineas"
          actionLabel="Ver líneas"
        />
      )}
    </div>
  );
}

function InsightCard({
  tone,
  icon,
  title,
  body,
  actionHref,
  actionLabel,
}: {
  tone: "danger" | "warning" | "info" | "success" | "judicial" | "muted";
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  actionHref: string;
  actionLabel: string;
}) {
  const stripClass = `strip-${tone}`;
  const toneText =
    tone === "danger"
      ? "text-[--color-danger]"
      : tone === "warning"
        ? "text-[--color-warning]"
        : tone === "info"
          ? "text-[--color-info]"
          : tone === "judicial"
            ? "text-[#7c2d12]"
            : tone === "muted"
              ? "text-[#475569]"
              : "text-[--color-success]";
  const toneBg =
    tone === "danger"
      ? "bg-[--color-danger-dim]"
      : tone === "warning"
        ? "bg-[--color-warning-dim]"
        : tone === "info"
          ? "bg-[--color-info-dim]"
          : tone === "judicial"
            ? "bg-[#fef3c7]"
            : tone === "muted"
              ? "bg-[#f1f5f9]"
              : "bg-[--color-success-dim]";

  return (
    <Link
      href={actionHref}
      className={cn("surface surface-hover top-strip group block bg-white", stripClass)}
    >
      <div className="p-5 pt-6">
        <div className="flex items-center gap-2.5">
          <div className={cn("size-8 rounded-lg grid place-items-center", toneBg)}>
            <span className={toneText}>{icon}</span>
          </div>
          <span className="text-[13px] font-semibold text-[--color-fg]">{title}</span>
        </div>
        <div className="text-[13px] text-[--color-fg-muted] leading-relaxed mt-3">{body}</div>
        <div className="flex items-center gap-1 text-[12px] text-[--color-accent] mt-3 group-hover:gap-2 transition-all">
          {actionLabel}
          <ArrowRight className="size-3.5" />
        </div>
      </div>
    </Link>
  );
}

function Shortcut({
  href,
  label,
  count,
  icon,
  tone = "muted",
}: {
  href: string;
  label: string;
  count?: number;
  icon?: React.ReactNode;
  tone?: "info" | "teal" | "warning" | "danger" | "judicial" | "muted";
}) {
  const iconCfg =
    tone === "info"
      ? "bg-[--color-accent]/10 text-[--color-accent]"
      : tone === "teal"
        ? "bg-[#0d9488]/10 text-[#0d9488]"
        : tone === "warning"
          ? "bg-[--color-warning]/12 text-[--color-warning]"
          : tone === "danger"
            ? "bg-[--color-danger]/10 text-[--color-danger]"
            : tone === "judicial"
              ? "bg-[#7c2d12]/10 text-[#7c2d12]"
              : "bg-[--color-bg-elev-3] text-[--color-fg-muted]";
  return (
    <Link
      href={href}
      className="group flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[--color-bg-elev-1] transition"
    >
      <span className={cn("size-7 rounded-lg grid place-items-center shrink-0", iconCfg)}>
        {icon ?? <span className="size-1.5 rounded-full bg-current opacity-70" />}
      </span>
      <span className="text-[13px] text-[--color-fg] flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className="text-[11px] mono font-semibold px-1.5 py-0.5 rounded-md bg-[--color-bg-elev-3] text-[--color-fg-muted] group-hover:bg-[--color-accent]/10 group-hover:text-[--color-accent] transition">
          {fmtNum(count)}
        </span>
      )}
      <ArrowRight className="size-3.5 text-[--color-fg-dim] group-hover:text-[--color-accent] group-hover:translate-x-0.5 transition" />
    </Link>
  );
}

