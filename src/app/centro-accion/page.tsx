"use client";

import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { limpiarVIN } from "@/lib/parser/venta-apc";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Banknote,
  ChevronDown,
  ChevronRight,
  Clock,
  Flame,
  Gauge,
  Gavel,
  MapPin,
  Tag,
  Target,
  TrendingDown,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScoreChip } from "@/components/ScoreBadge";
import { SeguimientoBadge } from "@/components/SeguimientoBadge";
import { normalizarMarcaOperacional } from "@/lib/selectors/owner-operacional";
import { useDatosFiltrados, useMarcaFilter } from "@/lib/marca-filtro";
import { useGestionStore } from "@/lib/gestion/store";
import { type GestionVIN } from "@/lib/gestion/types";
import {
  construirCaso,
  diasDesdeFacturaDe,
  diasMaxCreditoPompeyo,
  esMaximaAlertaDe,
  esVinGestionableHoy,
  evalCompromiso,
  factoresCriticosDe,
  resumirLogistica,
  type LogisticaCasoResumen,
} from "@/lib/gestion/caso";
import { useExcelStore } from "@/lib/store";
import { FichaGestionDocumental } from "@/components/FichaGestionDocumental";
import { UploadLogisticaButton } from "@/components/UploadLogisticaButton";
import { FichaOperacionalVIN } from "@/components/FichaOperacionalVIN";
import {
  CapitalPropioComprometidoBlock,
  esCapitalPropioComprometido,
} from "@/components/centro-accion/CapitalPropioComprometidoBlock";
import {
  BLOQUEO_LOGISTICO_LABEL,
  BLOQUEO_OWNER,
  type BloqueoLogistico,
  type LogisticaOperacionVIN,
} from "@/lib/logistica/modelo";
import { cn } from "@/lib/cn";
import { fmtCLP, fmtCLPCompact, fmtNum } from "@/lib/format";
import {
  FUENTE_CAPITAL_LABEL,
  buildVehiculosUnificados,
  type VehiculoUnificado,
} from "@/lib/selectors/vehiculo-unificado";
import {
  calcularScore,
  type ScoreVIN,
  type Severidad,
} from "@/lib/selectors/score";
import { STATUS_DPS_LABEL } from "@/lib/selectors/saldos";

/** Tramos T3+ (>30 días) según `StatusDPS` — para alertas de saldos viejos. */
const TRAMOS_T3PLUS = new Set(["T3", "T4", "T5", "T6", "T7"]);

type TabId =
  | "criticos"
  | "fne_detenidos"
  | "aging180"
  | "cp_todos"
  | "judicial"
  | "fne_listos"
  | "vu_puente"
  | "tescar"
  | "linea"
  | "logistica"
  | "capital_propio"
  | "por_marca";

type CmdTone = "danger" | "warning" | "info" | "muted";

interface TabDef {
  id: TabId;
  label: string;
  desc: string;
  icon: React.ReactNode;
  tone: CmdTone;
  /** Filtro sobre VINs (con score). */
  filter: (vu: VehiculoUnificado, s: ScoreVIN) => boolean;
  /** Orden (mayor es prioritario). */
  sortKey: (vu: VehiculoUnificado, s: ScoreVIN) => number;
  /** Monto operacional del comando (capital atrapado / CP / valor FNE). */
  monto: (vu: VehiculoUnificado) => number;
}

const maxAging = (vu: VehiculoUnificado) =>
  Math.max(
    vu.fneDiasFactura ?? 0,
    vu.diasStock ?? 0,
    vu.fneDiasEnEstado ?? 0,
    vu.diasTescar ?? 0,
  );

/** Comandos operacionales — cada uno es una palanca clickeable. */
const COMMANDS: TabDef[] = [
  {
    id: "criticos",
    label: "Máxima alerta",
    desc: "Varios problemas críticos a la vez en el mismo VIN (o judicial) — atacar primero.",
    icon: <Target className="size-4" />,
    tone: "danger",
    filter: (vu) => esMaximaAlertaDe(vu),
    // Orden: más factores críticos coincidentes → mayor presión → más capital.
    sortKey: (vu, s) => factoresCriticosDe(vu).length * 1e12 + s.total * 1e6 + vu.capitalComprometido,
    monto: (vu) => vu.capitalComprometido,
  },
  {
    id: "fne_detenidos",
    label: "FNE estancados >15d",
    desc: "Estancados >15d en un mismo paso del flujo (CP, logística, inscripción) · atascamiento operacional.",
    icon: <AlertOctagon className="size-4" />,
    tone: "danger",
    filter: (vu) =>
      vu.enFNE && vu.fneEstado !== "listo_para_entregar" && (vu.fneDiasEnEstado ?? 0) > 15,
    sortKey: (vu) => vu.fneDiasEnEstado ?? 0,
    monto: (vu) => vu.fneValorFactura,
  },
  {
    id: "aging180",
    label: "Capital >180 días",
    desc: "Operaciones con más de 180 días sin moverse — caja congelada.",
    icon: <Clock className="size-4" />,
    tone: "danger",
    filter: (vu) => maxAging(vu) > 180,
    sortKey: (vu) => maxAging(vu),
    monto: (vu) => vu.capitalComprometido,
  },
  {
    id: "cp_todos",
    label: "Crédito Pompeyo",
    desc: "Operaciones con Crédito Pompeyo por cobrar — bloqueo financiero.",
    icon: <Banknote className="size-4" />,
    tone: "warning",
    filter: (vu) => vu.creditoPompeyo > 0,
    sortKey: (vu) => vu.creditoPompeyo,
    monto: (vu) => vu.creditoPompeyo,
  },
  {
    id: "judicial",
    label: "Judicial",
    desc: "Stock en proceso judicial — capital bloqueado legalmente.",
    icon: <Gavel className="size-4" />,
    tone: "danger",
    filter: (vu) => vu.esJudicial,
    sortKey: (vu) => vu.capitalComprometido,
    monto: (vu) => vu.capitalComprometido,
  },
  {
    id: "fne_listos",
    label: "FNE listos retenidos",
    desc: "Con los 3 Sí del archivo pero el cliente no retira. Llamar a coordinar.",
    icon: <Target className="size-4" />,
    tone: "warning",
    filter: (vu) => vu.fneEstado === "listo_para_entregar" && (vu.fneDiasEnEstado ?? 0) > 3,
    sortKey: (vu) => vu.fneDiasEnEstado ?? 0,
    monto: (vu) => vu.fneValorFactura,
  },
  {
    id: "vu_puente",
    label: "VU puente >60d",
    desc: "Usados en parte de pago sin liquidar por más de 60 días.",
    icon: <Clock className="size-4" />,
    tone: "warning",
    filter: (vu) => vu.esVPP && (vu.diasVPP ?? 0) > 60,
    sortKey: (vu) => vu.diasVPP ?? 0,
    monto: (vu) => vu.capitalComprometido,
  },
  {
    id: "tescar",
    label: "TESCAR >180d",
    desc: "Demos / test cars con más de 180 días.",
    icon: <Clock className="size-4" />,
    tone: "warning",
    filter: (vu) => vu.esTescar && (vu.diasTescar ?? 0) > 180,
    sortKey: (vu) => vu.diasTescar ?? 0,
    monto: (vu) => vu.capitalComprometido,
  },
  {
    id: "linea",
    label: "Línea por vencer <30d",
    desc: "Marcas con línea de crédito que vence en menos de 30 días.",
    icon: <TrendingDown className="size-4" />,
    tone: "warning",
    filter: (vu) =>
      vu.lineaDiasParaVencer !== null &&
      vu.lineaDiasParaVencer >= 0 &&
      vu.lineaDiasParaVencer < 30,
    sortKey: (vu) => -1 * (vu.lineaDiasParaVencer ?? 999),
    monto: (vu) => vu.capitalComprometido,
  },
  {
    id: "logistica",
    label: "Bloqueo logístico",
    desc: "VIN vivos detenidos por logística: ETA vencida, despacho incumplido, sin solicitud, tránsito prolongado, inscripción o jefe de sucursal.",
    icon: <Truck className="size-4" />,
    tone: "warning",
    // Filtro real es por cruce logístico (necesita logisticaPorVin) → se resuelve
    // en el componente (logisticaCriticos). Acá placeholder para el sistema de tabs.
    filter: () => false,
    sortKey: () => 0,
    monto: (vu) => vu.capitalComprometido,
  },
  {
    id: "capital_propio",
    label: "Capital Propio Comprometido",
    desc: "Todos los VINs cuya caja propia está inmovilizada (Propio / FinPropio / Pagado).",
    icon: <Wallet className="size-4" />,
    tone: "info",
    filter: (vu) => esCapitalPropioComprometido(vu),
    // Capital desc → días stock desc (decisión usuario 2026-06).
    sortKey: (vu) => vu.capitalComprometido * 1e6 + (vu.diasStock ?? 0),
    monto: (vu) => vu.capitalComprometido,
  },
  {
    id: "por_marca",
    label: "Por marca",
    desc: "Agregado por marca · dónde se concentra la máxima alerta.",
    icon: <Gauge className="size-4" />,
    tone: "muted",
    filter: () => true,
    sortKey: (vu, s) => s.total,
    monto: (vu) => vu.capitalComprometido,
  },
];

/** Define qué VINs cuentan como "caja atrapada" (unión dedup para el total). */
function esAtrapado(vu: VehiculoUnificado): boolean {
  return (
    (vu.enFNE && vu.fneEstado !== "listo_para_entregar" && (vu.fneDiasEnEstado ?? 0) > 15) ||
    maxAging(vu) > 180 ||
    vu.creditoPompeyo > 0 ||
    vu.esJudicial ||
    vu.esStockPagadoViejo ||
    (vu.esVPP && (vu.diasVPP ?? 0) > 60) ||
    (vu.esTescar && (vu.diasTescar ?? 0) > 180)
  );
}

export default function CentroAccionPage() {
  const { data } = useDatosFiltrados();
  useEffect(() => {
    useGestionStore.getState().hydrate();
  }, []);

  if (!data) {
    return (
      <div className="max-w-3xl mx-auto px-10 py-16 fade-in">
        <Card variant="glass">
          <CardBody className="p-10">
            <EmptyState
              icon={<Gauge className="size-7" />}
              title="Centro de Acción"
              description="Sistema de Velocidad Operacional · Priorización automática de VIN críticos. Carga primero el Excel maestro de stock."
              action={
                <Link href="/" className="text-[--color-accent] text-sm hover:underline">
                  Ir al inicio →
                </Link>
              }
            />
          </CardBody>
        </Card>
      </div>
    );
  }
  return (
    <Suspense fallback={<div className="p-10 text-sm text-[--color-fg-muted]">Cargando…</div>}>
      <CentroAccionInner />
    </Suspense>
  );
}

function CentroAccionInner() {
  const { data, fne, saldos, provisiones } = useDatosFiltrados();
  const [tab, setTab] = useState<TabId>("criticos");
  // Ref al TOP de la página · destino del botón "Volver al Centro de Acción".
  // OJO: el scroll real vive en <main className="overflow-auto"> del AppShell,
  // por eso usamos scrollIntoView (no window.scrollTo, que sería no-op).
  const pageTopRef = useRef<HTMLDivElement>(null);
  // Toggles de secciones inline gestionables del hero ejecutivo (cards 1–8).
  const [showCajaAtrapada, setShowCajaAtrapada] = useState(false);
  const cajaAtrapadaRef = useRef<HTMLDivElement>(null);
  // Máxima alerta · sin state ni ref propios (Opción A · P2 2026-06-09):
  // la cola vive solo en el comando "criticos", la card del hero es atajo.
  const [showCp7d, setShowCp7d] = useState(false);
  const cp7dRef = useRef<HTMLDivElement>(null);
  const [showSeguimientos, setShowSeguimientos] = useState(false);
  const seguimientosRef = useRef<HTMLDivElement>(null);
  const [showFne7d, setShowFne7d] = useState(false);
  const fne7dRef = useRef<HTMLDivElement>(null);
  const [showSaldosAutos, setShowSaldosAutos] = useState(false);
  const saldosAutosRef = useRef<HTMLDivElement>(null);
  const [showBonos, setShowBonos] = useState(false);
  const bonosRef = useRef<HTMLDivElement>(null);
  const [showProvNoFact, setShowProvNoFact] = useState(false);
  const provNoFactRef = useRef<HTMLDivElement>(null);
  const [vinExpanded, setVinExpanded] = useState<string | null>(null);
  const gestionMap = useGestionStore((s) => s.byVin);
  const marcaActiva = useMarcaFilter((s) => s.marca);

  // Construcción del universo unificado + scoring
  const universo = useMemo(
    () => buildVehiculosUnificados({ data, fne, saldos }),
    [data, fne, saldos],
  );

  // Universo operacional ACTIVO solamente — excluye históricos APC ya entregados.
  const activos = useMemo(() => {
    const arr: VehiculoUnificado[] = [];
    for (const vu of universo.values()) {
      if (vu.esOperacionalActivo) arr.push(vu);
    }
    return arr;
  }, [universo]);

  // Score para TODOS los activos — base única de la mesa de trabajo.
  const conScore = useMemo(
    () => activos.map((vu) => ({ vu, score: calcularScore(vu) })),
    [activos],
  );
  const scored = useMemo(() => conScore.filter((x) => x.score.total > 0), [conScore]);

  // Caja atrapada TOTAL (unión dedup) — distinto de la máxima alerta.
  const atrapados = useMemo(() => activos.filter(esAtrapado), [activos]);
  const totalAtrapado = atrapados.reduce((s, vu) => s + vu.capitalComprometido, 0);

  // MÁXIMA ALERTA = coincidencia de factores críticos (no umbral de score).
  // Es la cola que lidera el Centro de Acción.
  const urgentes = useMemo(
    () => conScore.filter((x) => esMaximaAlertaDe(x.vu)),
    [conScore],
  );
  const capitalUrgente = urgentes.reduce((s, x) => s + x.vu.capitalComprometido, 0);

  // ── LOGÍSTICA · VIN vivos con bloqueo logístico (cola dedicada) ──────────
  // Solo VIN VIVOS GESTIONABLES HOY (esVinGestionableHoy = enStockActivo || enFNE).
  // No incluye VINs que solo aparecen en saldos pendientes (ej. entregados con
  // cobranza histórica): un bloqueo logístico sobre un auto ya entregado es
  // cumplimiento histórico, no gestión viva.
  //
  // Filtro quirúrgico adicional: el bloqueo "auto_listo_no_solicitado" (card
  // "Auto en bodega sin solicitud de despacho") SOLO aplica si el auto ya
  // está vendido/facturado/FNE. Un auto en bodega disponible — sin venta —
  // NO es bloqueo de caja hoy: es stock comercial normal. Por eso filtramos
  // ese tipo de bloqueo del array `resumen.bloqueos` cuando no hay venta.
  // Esto cascada automáticamente a `logStats` (que itera bloqueos), a las
  // 6 cards de Bloqueos Logísticos y al comando "BLOQUEO LOGÍSTICO".
  const logisticaPorVin = useExcelStore((s) => s.logisticaPorVin);
  const logCasos = useMemo(() => {
    const out: { x: (typeof conScore)[number]; op: LogisticaOperacionVIN; resumen: LogisticaCasoResumen }[] = [];
    if (!logisticaPorVin) return out;
    for (const x of conScore) {
      if (!esVinGestionableHoy(x.vu)) continue; // ← excluye saldos sin stock ni FNE
      const op = logisticaPorVin.get(x.vu.vinLimpio);
      if (!op) continue;
      const resumen = resumirLogistica(op);
      // "vendido o FNE": tiene venta registrada (APC) o está facturado no
      // entregado. Cubre los dos escenarios donde "auto en bodega sin
      // solicitud" es legítimamente un bloqueo de caja.
      const vendidoOFNE = x.vu.enFNE || x.vu.enHistoricoVenta;
      // Filtros contextuales sobre los bloqueos que la regla pura no puede
      // resolver (necesita el VU, no solo la operación logística):
      //   · auto_listo_no_solicitado → SOLO si está vendido o en FNE (auto
      //     en bodega disponible sin venta es stock comercial normal).
      //   · transito_prolongado → NO aplica si el auto ya está en FNE. Un
      //     auto facturado físicamente ya tiene que estar en la sucursal
      //     (se factura contra recepción). Si aparece "en tránsito" es
      //     higiene de datos (falta cerrar fLlegadaSucursal), no tránsito
      //     real. El bloqueo real de esos casos es otro (llegado_no_entregado
      //     o inscripcion_pendiente).
      const bloqueosFiltrados = resumen.bloqueos.filter((b) => {
        if (b === "auto_listo_no_solicitado" && !vendidoOFNE) return false;
        if (b === "transito_prolongado" && x.vu.enFNE) return false;
        return true;
      });
      if (bloqueosFiltrados.length === 0) continue;
      out.push({
        x,
        op,
        resumen:
          bloqueosFiltrados.length === resumen.bloqueos.length
            ? resumen
            : { ...resumen, bloqueos: bloqueosFiltrados },
      });
    }
    out.sort((a, b) => a.resumen.score - b.resumen.score); // peor score primero
    return out;
  }, [conScore, logisticaPorVin]);
  const logisticaCriticos = useMemo(() => logCasos.map((c) => c.x), [logCasos]);

  // ── CRÉDITOS POMPEYO > 7d (card ejecutiva del hero) ───────────────────────
  //
  // Regla correcta (Junio 2026): un VIN entra si tiene al menos un saldo
  // CP con `fechaVenta` > 7 días atrás. La fecha viene de SaldoRegistro
  // (subTipo "credito_pompeyo"). NO se usa `maxAging(vu)` porque ese es
  // aging operacional del VIN, no edad del crédito.
  const creditosPompeyo7d = useMemo(
    () =>
      conScore.filter((x) => {
        if (x.vu.creditoPompeyo <= 0) return false;
        const dias = diasMaxCreditoPompeyo(x.vu);
        return dias !== null && dias > 7;
      }),
    [conScore],
  );
  const montoCreditosPompeyo7d = creditosPompeyo7d.reduce(
    (s, x) => s + x.vu.creditoPompeyo,
    0,
  );

  // ── FNE > 7d ──────────────────────────────────────────────────────────────
  // Facturados no entregados con más de 7 días desde fFactura.
  // `enFNE === true` implica facturado no entregado por construcción del FNE.
  const fne7d = useMemo(
    () =>
      conScore.filter(
        (x) => x.vu.enFNE && (x.vu.fneDiasFactura ?? 0) > 7,
      ),
    [conScore],
  );
  const montoFne7d = fne7d.reduce((s, x) => s + x.vu.capitalComprometido, 0);

  // ── Saldos autos > 30 d (T3+) ─────────────────────────────────────────────
  // Sobre los SaldoRegistro raw del store. categoria=vehiculo + statusDPS T3..T7.
  const saldosAutos30d = useMemo(() => {
    const regs = saldos?.registros ?? [];
    return regs.filter(
      (r) => r.categoria === "vehiculo" && TRAMOS_T3PLUS.has(r.statusDPS),
    );
  }, [saldos]);
  const montoSaldosAutos30d = saldosAutos30d.reduce(
    (s, r) => s + r.saldoXDocumentar,
    0,
  );

  // ── Bonos / comisiones > 30 d (T3+) ───────────────────────────────────────
  const bonos30d = useMemo(() => {
    const regs = saldos?.registros ?? [];
    return regs.filter(
      (r) => r.categoria === "bono_comision" && TRAMOS_T3PLUS.has(r.statusDPS),
    );
  }, [saldos]);
  const montoBonos30d = bonos30d.reduce((s, r) => s + r.saldoXDocumentar, 0);

  // ── Provisiones no facturadas > 30 d ──────────────────────────────────────
  const provNoFact30d = useMemo(() => {
    const regs = provisiones?.registros ?? [];
    return regs.filter(
      (p) => p.estado === "no_facturada" && (p.agingDias ?? 0) > 30,
    );
  }, [provisiones]);
  const montoProvNoFact30d = provNoFact30d.reduce(
    (s, p) => s + p.montoProvision,
    0,
  );

  // ── SEGUIMIENTOS ATRASADOS (card ejecutiva del hero) ──────────────────────
  //
  // Casos con `gestion.fechaCompromiso` ya pasada y `estadoGestion` ≠ resuelto/cancelado.
  // Usa `evalCompromiso()` que parsea YYYY-MM-DD vs hoy.
  const seguimientosAtrasados = useMemo(() => {
    const out: (typeof conScore)[number][] = [];
    for (const x of conScore) {
      const g = gestionMap[x.vu.vinLimpio];
      if (!g) continue;
      const estado = g.estadoGestion;
      if (estado === "resuelto" || estado === "cancelado") continue;
      const c = evalCompromiso(g.fechaCompromiso);
      if (c.estado === "vencido") out.push(x);
    }
    return out;
  }, [conScore, gestionMap]);
  const montoSeguimientosAtrasados = seguimientosAtrasados.reduce(
    (s, x) => s + x.vu.capitalComprometido,
    0,
  );

  // Stats por tipo de bloqueo (para las cards del bloque "Bloqueos logísticos").
  const logStats = useMemo(() => {
    const m = new Map<
      BloqueoLogistico,
      { count: number; capital: number; agingSum: number; agingN: number; scoreSum: number; slaRoto: number }
    >();
    for (const c of logCasos) {
      for (const b of c.resumen.bloqueos) {
        const e =
          m.get(b) ?? { count: 0, capital: 0, agingSum: 0, agingN: 0, scoreSum: 0, slaRoto: 0 };
        e.count++;
        e.capital += c.x.vu.capitalComprometido;
        e.scoreSum += c.resumen.score;
        if (c.resumen.aging != null) {
          e.agingSum += c.resumen.aging;
          e.agingN++;
        }
        if (c.resumen.slaRoto) e.slaRoto++;
        m.set(b, e);
      }
    }
    return m;
  }, [logCasos]);
  const [logBloqueoFilter, setLogBloqueoFilter] = useState<BloqueoLogistico | null>(null);

  // Stats por comando (count + monto) — base conScore.
  const cmdStats = useMemo(() => {
    const m = new Map<TabId, { count: number; monto: number }>();
    for (const cmd of COMMANDS) {
      if (cmd.id === "logistica") {
        m.set(cmd.id, {
          count: logisticaCriticos.length,
          monto: logisticaCriticos.reduce((s, x) => s + x.vu.capitalComprometido, 0),
        });
        continue;
      }
      if (cmd.id === "por_marca") {
        // "Por marca" muestra VIN EN ALERTA (no todos los scored): el conteo
        // honesto de riesgo, no toda la marca.
        m.set(cmd.id, { count: urgentes.length, monto: 0 });
        continue;
      }
      let count = 0;
      let monto = 0;
      for (const { vu, score } of conScore) {
        if (cmd.filter(vu, score)) {
          count++;
          monto += cmd.monto(vu);
        }
      }
      m.set(cmd.id, { count, monto });
    }
    return m;
  }, [conScore, urgentes, logisticaCriticos]);

  const tabDef = COMMANDS.find((t) => t.id === tab)!;
  const filtrados = useMemo(() => {
    if (tab === "logistica") {
      const base = logBloqueoFilter
        ? logCasos.filter((c) => c.resumen.bloqueos.includes(logBloqueoFilter))
        : logCasos;
      return base.map((c) => c.x);
    }
    return conScore
      .filter((x) => tabDef.filter(x.vu, x.score))
      .sort((a, b) => tabDef.sortKey(b.vu, b.score) - tabDef.sortKey(a.vu, a.score));
  }, [conScore, tabDef, tab, logCasos, logBloqueoFilter]);

  // CAPA ÚNICA DE CASO: divide la cola del comando en lo que requiere acción
  // AHORA (cola activa, top principal) vs lo que ya tiene seguimiento activo
  // vigente ("En seguimiento", no desaparece). Resueltos salen de la mesa.
  // Preserva el orden propio del comando dentro de cada bucket.
  const { activa, seguimiento } = useMemo(() => {
    const act: typeof filtrados = [];
    const seg: typeof filtrados = [];
    for (const x of filtrados) {
      const caso = construirCaso(x.vu, x.score, gestionMap[x.vu.vinLimpio] ?? null);
      if (caso.estado === "resuelto") continue;
      if (caso.enSeguimiento) seg.push(x);
      else act.push(x);
    }
    return { activa: act, seguimiento: seg };
  }, [filtrados, gestionMap]);
  const impactoTab = activa.reduce((s, x) => s + x.vu.capitalComprometido, 0);

  const listaRef = useRef<HTMLDivElement>(null);
  const irALista = () =>
    requestAnimationFrame(() =>
      listaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  const selCmd = (id: TabId) => {
    setTab(id);
    setVinExpanded(null);
    if (id !== "logistica") setLogBloqueoFilter(null);
    irALista();
  };
  /** Selección de una card de bloqueo logístico → cola logística filtrada. */
  const selBloqueoLog = (b: BloqueoLogistico | null) => {
    setTab("logistica");
    setVinExpanded(null);
    setLogBloqueoFilter(b);
    irALista();
  };

  // Navegación contextual: "Volver al caso" (?vin=) abre el VIN expandido en el
  // tab que lo contiene. Se aplica una vez por VIN para no pelear con el usuario.
  const searchParams = useSearchParams();
  const vinParam = useMemo(() => {
    const v = searchParams.get("vin");
    return v ? limpiarVIN(v) : null;
  }, [searchParams]);
  const vinAplicadoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!vinParam || conScore.length === 0) return;
    if (vinAplicadoRef.current === vinParam) return;
    const item = conScore.find((x) => x.vu.vinLimpio === vinParam);
    if (!item) return;
    const cmd = COMMANDS.find(
      (c) => c.id !== "por_marca" && c.id !== "logistica" && c.filter(item.vu, item.score),
    );
    if (cmd) setTab(cmd.id);
    setVinExpanded(vinParam);
    vinAplicadoRef.current = vinParam;
    // Doble rAF + timeout: el scroll recién cuando la cola del tab ya montó la
    // fila expandida (fix race de hidratación — el efecto re-corre vía deps
    // [vinParam, conScore] cuando el snapshot hidrata después del mount).
    const t = setTimeout(() => {
      requestAnimationFrame(() =>
        listaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }, 150);
    return () => clearTimeout(t);
  }, [vinParam, conScore]);

  // Deep-link documental: ?clave=SALDO-… / BONO-… / PROV-… abre la sección
  // correspondiente con la fila destacada y su gestión expandida. Re-corre
  // cuando los datasets hidratan (mismo patrón retry que ?vin=).
  const claveParam = useMemo(() => searchParams.get("clave"), [searchParams]);
  const claveAplicadaRef = useRef<string | null>(null);
  useEffect(() => {
    if (!claveParam || claveAplicadaRef.current === claveParam) return;
    let ref: React.RefObject<HTMLDivElement | null> | null = null;
    if (claveParam.startsWith("SALDO-") && saldosAutos30d.length > 0) {
      setShowSaldosAutos(true);
      ref = saldosAutosRef;
    } else if (claveParam.startsWith("BONO-") && bonos30d.length > 0) {
      setShowBonos(true);
      ref = bonosRef;
    } else if (claveParam.startsWith("PROV-") && provNoFact30d.length > 0) {
      setShowProvNoFact(true);
      ref = provNoFactRef;
    }
    if (!ref) return;
    claveAplicadaRef.current = claveParam;
    const target = ref;
    const t = setTimeout(() => {
      requestAnimationFrame(() =>
        target.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }, 150);
    return () => clearTimeout(t);
  }, [claveParam, saldosAutos30d, bonos30d, provNoFact30d]);

  // ¿El VIN del contexto cae en algún comando (cola activa)? Si NO, mostramos el
  // fallback "Caso" para que todo VIN con contexto tenga su casa.
  const vinEnCola = useMemo(
    () => !!vinParam && conScore.some((x) => x.vu.vinLimpio === vinParam),
    [vinParam, conScore],
  );

  const insights = useMemo(() => computeInsights(atrapados, gestionMap), [atrapados, gestionMap]);

  return (
    <div ref={pageTopRef} className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-10 space-y-6 fade-in scroll-mt-2">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-[--color-border] bg-gradient-to-br from-[#fef2f2] via-[#fff7ed] to-white px-5 sm:px-8 lg:px-10 py-6 lg:py-8">
        <div className="absolute -top-12 -right-12 size-56 rounded-full bg-[--color-danger] opacity-[0.10] blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[--color-danger] font-semibold">
            <Gauge className="size-3.5" strokeWidth={2} />
            Sistema de Velocidad Operacional · Centro de Operación
          </div>
          <h1 className="text-[28px] font-semibold tracking-tight mt-2 leading-tight text-[--color-fg]">
            Qué desbloquea más caja hoy
          </h1>
          <p className="text-[14px] text-[--color-fg-muted] mt-2 max-w-3xl leading-relaxed">
            {fmtNum(activos.length)} operaciones activas · mesa de trabajo operacional. Cada comando
            abre su cola de casos con gestión y responsable.
          </p>
        </div>
      </div>

      {/* Fallback "Caso": el VIN del contexto no cae en ningún comando → su casa. */}
      {vinParam && !vinEnCola && (
        <div className="surface bg-white p-5 space-y-4 top-strip strip-operativo">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[13px] font-semibold text-[--color-fg]">
              Caso · VIN <span className="mono">{vinParam}</span>{" "}
              <span className="text-[11px] text-[--color-fg-muted] font-normal">
                (fuera de los comandos actuales — ficha completa)
              </span>
            </div>
            <Link href="/centro-accion" className="text-[12px] text-[--color-accent] hover:underline">
              Ver todo
            </Link>
          </div>
          <FichaOperacionalVIN vin={vinParam} />
        </div>
      )}

      {/* Grilla ejecutiva — 8 cards (2 filas de 4), todas clickables al detalle */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* 1 · Caja atrapada hoy → cola gestionable inline (los 44 atrapados) */}
        <button
          type="button"
          onClick={() => {
            setShowCajaAtrapada(true);
            requestAnimationFrame(() =>
              cajaAtrapadaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
            );
          }}
          className="surface surface-hover top-strip strip-danger bg-white px-6 py-5 text-left"
        >
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-danger] font-semibold">
            Caja atrapada hoy
          </div>
          <div className="display text-[36px] mt-2 leading-none text-[--color-danger]">
            {fmtCLPCompact(totalAtrapado)}
          </div>
          <div className="text-[13px] text-[--color-fg-muted] mt-2">
            <span className="text-[--color-fg] font-semibold">
              {fmtNum(atrapados.length)} operaciones
            </span>{" "}
            con capital detenido
          </div>
          <div className="inline-flex items-center gap-1 text-[12px] text-[--color-danger] font-medium mt-3">
            Ver cola <ArrowRight className="size-3.5" />
          </div>
        </button>

        {/* 2 · Máxima alerta → atajo al tab "criticos" (cola real vive UNA sola vez ahí).
                Antes esta card abría una <ColaGestionableInline> propia, duplicando el universo
                que ya muestra el comando. Opción A aprobada (P2 · 2026-06-09): card queda como
                termómetro ejecutivo; el click activa el tab y scrollea a la cola principal. */}
        <button
          type="button"
          onClick={() => selCmd("criticos")}
          className="surface surface-hover top-strip strip-operativo bg-white px-6 py-5 text-left"
        >
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-accent] font-semibold">
            Máxima alerta
          </div>
          <div className="display text-[36px] mt-2 leading-none text-[--color-fg]">
            {fmtNum(urgentes.length)} casos
          </div>
          <div className="text-[13px] text-[--color-fg-muted] mt-2">
            2+ problemas críticos ·{" "}
            <span className="text-[--color-accent] font-semibold">
              {fmtCLPCompact(capitalUrgente)}
            </span>{" "}
            en juego
          </div>
          <div className="inline-flex items-center gap-1 text-[12px] text-[--color-accent] font-medium mt-3">
            Ir al comando <ArrowRight className="size-3.5" />
          </div>
        </button>

        {/* 3 · Créditos Pompeyo >7d → cola gestionable inline (con factura >7d) */}
        <button
          type="button"
          onClick={() => {
            setShowCp7d(true);
            requestAnimationFrame(() =>
              cp7dRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
            );
          }}
          className="surface surface-hover top-strip strip-danger bg-white px-6 py-5 text-left"
        >
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-danger] font-semibold">
            Créditos Pompeyo &gt;7d
          </div>
          <div className="display text-[36px] mt-2 leading-none text-[--color-fg]">
            {fmtNum(creditosPompeyo7d.length)} casos
          </div>
          <div className="text-[13px] text-[--color-fg-muted] mt-2">
            <span className="text-[--color-danger] font-semibold">
              {fmtCLPCompact(montoCreditosPompeyo7d)}
            </span>{" "}
            en juego
          </div>
          <div className="inline-flex items-center gap-1 text-[12px] text-[--color-danger] font-medium mt-3">
            Ver cola CP <ArrowRight className="size-3.5" />
          </div>
        </button>

        {/* 4 · Seguimientos atrasados → toggle de sección inline debajo */}
        <button
          type="button"
          onClick={() => {
            setShowSeguimientos(true);
            requestAnimationFrame(() =>
              seguimientosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
            );
          }}
          className="surface surface-hover top-strip strip-warning bg-white px-6 py-5 text-left"
        >
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-warning] font-semibold">
            Seguimientos atrasados
          </div>
          <div className="display text-[36px] mt-2 leading-none text-[--color-fg]">
            {fmtNum(seguimientosAtrasados.length)} casos
          </div>
          <div className="text-[13px] text-[--color-fg-muted] mt-2">
            fecha compromiso vencida ·{" "}
            <span className="text-[--color-warning] font-semibold">
              {fmtCLPCompact(montoSeguimientosAtrasados)}
            </span>{" "}
            en juego
          </div>
          <div className="inline-flex items-center gap-1 text-[12px] text-[--color-warning] font-medium mt-3">
            Ver cola <ArrowRight className="size-3.5" />
          </div>
        </button>
      </div>

      {/* Segunda fila ejecutiva — 4 alertas adicionales (FNE, saldos, bonos, prov). */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* 5 · FNE >7d → toggle inline */}
        <button
          type="button"
          onClick={() => {
            setShowFne7d(true);
            requestAnimationFrame(() =>
              fne7dRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
            );
          }}
          className="surface surface-hover top-strip strip-danger bg-white px-6 py-5 text-left"
        >
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-danger] font-semibold">
            FNE sin entregar &gt;7d
          </div>
          <div className="display text-[36px] mt-2 leading-none text-[--color-fg]">
            {fmtNum(fne7d.length)} casos
          </div>
          <div className="text-[13px] text-[--color-fg-muted] mt-2">
            tiempo desde la factura · presión sobre el cliente ·{" "}
            <span className="text-[--color-danger] font-semibold">
              {fmtCLPCompact(montoFne7d)}
            </span>
          </div>
          <div className="inline-flex items-center gap-1 text-[12px] text-[--color-danger] font-medium mt-3">
            Ver cola <ArrowRight className="size-3.5" />
          </div>
        </button>

        {/* 6 · Saldos autos >30d (T3+) → toggle inline */}
        <button
          type="button"
          onClick={() => {
            setShowSaldosAutos(true);
            requestAnimationFrame(() =>
              saldosAutosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
            );
          }}
          className="surface surface-hover top-strip strip-warning bg-white px-6 py-5 text-left"
        >
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-warning] font-semibold">
            Saldos autos &gt;30d
          </div>
          <div className="display text-[36px] mt-2 leading-none text-[--color-fg]">
            {fmtNum(saldosAutos30d.length)} saldos
          </div>
          <div className="text-[13px] text-[--color-fg-muted] mt-2">
            30 días o más ·{" "}
            <span className="text-[--color-warning] font-semibold">
              {fmtCLPCompact(montoSaldosAutos30d)}
            </span>
          </div>
          <div className="inline-flex items-center gap-1 text-[12px] text-[--color-warning] font-medium mt-3">
            Ver detalle <ArrowRight className="size-3.5" />
          </div>
        </button>

        {/* 7 · Bonos / comisiones >30d → toggle inline */}
        <button
          type="button"
          onClick={() => {
            setShowBonos(true);
            requestAnimationFrame(() =>
              bonosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
            );
          }}
          className="surface surface-hover top-strip strip-warning bg-white px-6 py-5 text-left"
        >
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-warning] font-semibold">
            Bonos / comis. &gt;30d
          </div>
          <div className="display text-[36px] mt-2 leading-none text-[--color-fg]">
            {fmtNum(bonos30d.length)} saldos
          </div>
          <div className="text-[13px] text-[--color-fg-muted] mt-2">
            30 días o más ·{" "}
            <span className="text-[--color-warning] font-semibold">
              {fmtCLPCompact(montoBonos30d)}
            </span>
          </div>
          <div className="inline-flex items-center gap-1 text-[12px] text-[--color-warning] font-medium mt-3">
            Ver detalle <ArrowRight className="size-3.5" />
          </div>
        </button>

        {/* 8 · Provisiones no facturadas >30d → toggle inline */}
        <button
          type="button"
          onClick={() => {
            setShowProvNoFact(true);
            requestAnimationFrame(() =>
              provNoFactRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
            );
          }}
          className="surface surface-hover top-strip strip-warning bg-white px-6 py-5 text-left"
        >
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-warning] font-semibold">
            Prov. no fact. &gt;30d
          </div>
          <div className="display text-[36px] mt-2 leading-none text-[--color-fg]">
            {fmtNum(provNoFact30d.length)} casos
          </div>
          <div className="text-[13px] text-[--color-fg-muted] mt-2">
            sin facturar ·{" "}
            <span className="text-[--color-warning] font-semibold">
              {fmtCLPCompact(montoProvNoFact30d)}
            </span>
          </div>
          <div className="inline-flex items-center gap-1 text-[12px] text-[--color-warning] font-medium mt-3">
            Ver detalle <ArrowRight className="size-3.5" />
          </div>
        </button>
      </div>

      {/* Secciones inline gestionables · FNE >7d, Saldos autos, Bonos, Provisiones
          Cada fila reusa GestionInline con la clave estándar:
          - VIN limpio para autos
          - SALDO-{cajón|nota|rowIndex} para saldos autos
          - BONO-{factura|nota|rowIndex} para bonos/comisiones
          - claveGestion (PROV-{id}) para provisiones */}
      {showFne7d && (
        <ColaGestionableInline
          titulo="FNE sin entregar >7d"
          subtitulo="tiempo desde la factura · presión sobre el cliente"
          tono="danger"
          refContainer={fne7dRef}
          onClose={() => setShowFne7d(false)}
          filas={[...fne7d]
            .sort((a, b) => b.vu.capitalComprometido - a.vu.capitalComprometido)
            .map<FilaCola>((x) => ({
              clave: x.vu.vinLimpio,
              vin: x.vu.vinLimpio,
              cliente: x.vu.cliente,
              vendedor: x.vu.vendedor,
              sucursal: x.vu.sucursal,
              patente: x.vu.patente,
              marca: x.vu.marca,
              modelo: x.vu.modelo,
              diasRetenido: x.vu.fneDiasFactura ?? null,
              diasSublabel: "desde factura",
              monto: x.vu.capitalComprometido,
              tieneCp: x.vu.creditoPompeyo > 0,
              montoCp: x.vu.creditoPompeyo,
            }))}
        />
      )}

      {showSaldosAutos && (
        <ColaGestionableInline
          titulo="Saldos autos >30d"
          subtitulo="con 30+ días sin cobrar"
          tono="warning"
          refContainer={saldosAutosRef}
          onClose={() => setShowSaldosAutos(false)}
          claveDestacada={claveParam}
          filas={[...saldosAutos30d]
            .sort((a, b) => b.saldoXDocumentar - a.saldoXDocumentar)
            .map<FilaCola>((r) => {
              const claveDoc =
                r.vinResuelto ??
                `SALDO-${r.cajonLimpio ?? r.cajon ?? r.numNota ?? r.rowIndex}`;
              return {
                clave: claveDoc,
                vin: r.vinResuelto ?? null,
                cliente: r.cliente,
                vendedor: r.vendedor,
                sucursal: r.sucursal,
                patente: r.patente,
                marca: r.marca,
                modelo: r.modelo,
                primario: r.cajonLimpio ?? r.cajon ?? `Fila ${r.rowIndex}`,
                diasRetenido: r.diasArchivo ?? null,
                diasSublabel: STATUS_DPS_LABEL[r.statusDPS],
                monto: r.saldoXDocumentar,
                tieneCp: r.cPompeyoCLP > 0,
                montoCp: r.cPompeyoCLP,
              };
            })}
        />
      )}

      {showBonos && (
        <ColaGestionableInline
          titulo="Bonos / comisiones >30d"
          subtitulo="bonos / comisiones con 30+ días sin cobrar"
          tono="warning"
          refContainer={bonosRef}
          onClose={() => setShowBonos(false)}
          claveDestacada={claveParam}
          filas={[...bonos30d]
            .sort((a, b) => b.saldoXDocumentar - a.saldoXDocumentar)
            .map<FilaCola>((r) => {
              const id = r.numeroFactura ?? r.numNota ?? r.rowIndex;
              return {
                clave: `BONO-${id}`,
                vin: null,
                cliente: r.cliente,
                vendedor: r.vendedor,
                sucursal: r.sucursal,
                patente: null,
                marca: r.marca,
                modelo: r.subTipo,
                primario: String(r.numeroFactura ?? r.numNota ?? `Fila ${r.rowIndex}`),
                diasRetenido: r.diasArchivo ?? null,
                diasSublabel: STATUS_DPS_LABEL[r.statusDPS],
                monto: r.saldoXDocumentar,
                tieneCp: false,
              };
            })}
        />
      )}

      {showProvNoFact && (
        <ColaGestionableInline
          titulo="Provisiones no facturadas >30d"
          subtitulo="provisiones operacionales sin facturar"
          tono="warning"
          refContainer={provNoFactRef}
          onClose={() => setShowProvNoFact(false)}
          claveDestacada={claveParam}
          filas={[...provNoFact30d]
            .sort((a, b) => (b.agingDias ?? 0) - (a.agingDias ?? 0))
            .map<FilaCola>((p) => ({
              clave: p.claveGestion, // ya viene del parser: "PROV-{id}"
              vin: null,
              cliente: p.solicitante ?? p.razonSocial,
              vendedor: p.solicitante,
              sucursal: p.razonSocial,
              patente: null,
              marca: p.origen,
              modelo: p.concepto,
              primario: p.concepto ?? `Provisión ${p.id ?? p.rowIndex}`,
              diasRetenido: p.agingDias ?? null,
              diasSublabel: "sin facturar",
              monto: p.montoProvision,
              tieneCp: false,
            }))}
        />
      )}

      {/* Secciones inline gestionables · Cards 1, 2, 3 del hero. */}
      {showCajaAtrapada && (
        <ColaGestionableInline
          titulo="Caja atrapada hoy"
          subtitulo="capital detenido operacionalmente (universo dedupeado)"
          tono="danger"
          refContainer={cajaAtrapadaRef}
          onClose={() => setShowCajaAtrapada(false)}
          filas={[...atrapados]
            .sort((a, b) => b.capitalComprometido - a.capitalComprometido)
            .map<FilaCola>((vu) => ({
              clave: vu.vinLimpio,
              vin: vu.vinLimpio,
              cliente: vu.cliente,
              vendedor: vu.vendedor,
              sucursal: vu.sucursal,
              patente: vu.patente,
              marca: vu.marca,
              modelo: vu.modelo,
              diasRetenido: diasDesdeFacturaDe(vu),
              diasSublabel: "desde factura",
              monto: vu.capitalComprometido,
              tieneCp: vu.creditoPompeyo > 0,
              montoCp: vu.creditoPompeyo,
            }))}
        />
      )}

      {/* Sección inline "Máxima alerta" eliminada (P2 · 2026-06-09).
          La cola real vive solo en el comando "criticos" abajo · cero duplicación. */}

      {showCp7d && (
        <ColaGestionableInline
          titulo="Créditos Pompeyo >7d"
          subtitulo="CP con factura > 7 días"
          tono="danger"
          refContainer={cp7dRef}
          onClose={() => setShowCp7d(false)}
          filas={[...creditosPompeyo7d]
            .sort((a, b) => b.vu.creditoPompeyo - a.vu.creditoPompeyo)
            .map<FilaCola>((x) => ({
              clave: x.vu.vinLimpio,
              vin: x.vu.vinLimpio,
              cliente: x.vu.cliente,
              vendedor: x.vu.vendedor,
              sucursal: x.vu.sucursal,
              patente: x.vu.patente,
              marca: x.vu.marca,
              modelo: x.vu.modelo,
              diasRetenido: diasMaxCreditoPompeyo(x.vu),
              diasSublabel: "desde factura CP",
              monto: x.vu.creditoPompeyo,
              tieneCp: true,
              montoCp: x.vu.creditoPompeyo,
            }))}
        />
      )}

      {/* Sección inline · Seguimientos atrasados (cola gestionable estándar). */}
      {showSeguimientos && (
        <ColaGestionableInline
          titulo="Seguimientos atrasados"
          subtitulo="fecha compromiso vencida · gestión no resuelta"
          tono="warning"
          refContainer={seguimientosRef}
          onClose={() => setShowSeguimientos(false)}
          filas={[...seguimientosAtrasados]
            .sort((a, b) => {
              const da = evalCompromiso(gestionMap[a.vu.vinLimpio]?.fechaCompromiso ?? null).dias;
              const db = evalCompromiso(gestionMap[b.vu.vinLimpio]?.fechaCompromiso ?? null).dias;
              return db - da;
            })
            .map<FilaCola>((x) => {
              const g = gestionMap[x.vu.vinLimpio];
              const c = evalCompromiso(g?.fechaCompromiso ?? null);
              return {
                clave: x.vu.vinLimpio,
                vin: x.vu.vinLimpio,
                cliente: x.vu.cliente,
                vendedor: g?.responsable ?? x.vu.vendedor,
                sucursal: x.vu.sucursal,
                patente: x.vu.patente,
                marca: x.vu.marca,
                modelo: x.vu.modelo,
                diasRetenido: c.dias,
                diasSublabel: "vencido hace",
                monto: x.vu.capitalComprometido,
                tieneCp: x.vu.creditoPompeyo > 0,
                montoCp: x.vu.creditoPompeyo,
              };
            })}
        />
      )}

      {/* Ingesta logística — opcional, enriquece la cola con cruce por VIN */}
      <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-[--color-border] bg-[--color-bg-elev-1]/40 px-4 py-2.5">
        <div className="text-[12px] text-[--color-fg-muted]">
          {logisticaPorVin ? (
            <>
              Logística cargada ·{" "}
              <span className="text-[--color-fg] font-medium">
                {fmtNum(logisticaCriticos.length)} VIN vivos con bloqueo logístico
              </span>{" "}
              en la cola.
            </>
          ) : (
            <>Carga Logistica.xlsx + Diciembre-Mayo ROMA para sumar la dimensión logística a la cola.</>
          )}
        </div>
        <UploadLogisticaButton compact />
      </div>

      {/* BLOQUEOS LOGÍSTICOS — capa logística visible */}
      {logisticaPorVin && logCasos.length > 0 && (
        <BloqueosLogisticosSection
          stats={logStats}
          total={logCasos.length}
          activeFilter={tab === "logistica" ? logBloqueoFilter : null}
          onSelect={selBloqueoLog}
        />
      )}

      {/* Capital Propio Comprometido — lectura ejecutiva de caja inmovilizada.
          Va ANTES de los comandos: KPI conceptual primero, palancas operativas después. */}
      <CapitalPropioComprometidoBlock
        vus={activos}
        marca={marcaActiva}
        onVerVins={() => selCmd("capital_propio")}
      />

      {/* Comandos operacionales */}
      <div>
        <SectionHeaderCA
          title="Comandos operacionales"
          sub="Cada palanca abre su cola de trabajo abajo. Clic para gestionar."
        />
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mt-3">
          {COMMANDS.map((cmd) => (
            <ComandoCard
              key={cmd.id}
              cmd={cmd}
              stat={cmdStats.get(cmd.id) ?? { count: 0, monto: 0 }}
              active={tab === cmd.id}
              onClick={() => selCmd(cmd.id)}
            />
          ))}
        </div>
      </div>

      {/* Cola del comando activo */}
      <div ref={listaRef} className="space-y-3 scroll-mt-6">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <button
              type="button"
              onClick={() =>
                pageTopRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                })
              }
              className="inline-flex items-center gap-1.5 text-[11.5px] text-[--color-info] hover:underline mb-1 font-medium"
            >
              <ArrowLeft className="size-3.5" strokeWidth={2} />
              Volver al Centro de Acción
            </button>
            <h2 className="text-[16px] font-semibold tracking-tight text-[--color-fg]">
              {tabDef.label}
              {tab === "logistica" && logBloqueoFilter && (
                <span className="text-[--color-warning]"> · {BLOQUEO_LOGISTICO_LABEL[logBloqueoFilter]}</span>
              )}
            </h2>
            <p className="text-[12.5px] text-[--color-fg-muted] mt-0.5">
              {tabDef.desc} Solo cola activa — lo que requiere acción ahora.
            </p>
          </div>
          {tab !== "por_marca" && (activa.length > 0 || seguimiento.length > 0) && (
            <span className="text-[12.5px] text-[--color-fg] font-medium shrink-0">
              {fmtNum(activa.length)} por gestionar · {fmtCLPCompact(impactoTab)}
              {seguimiento.length > 0 && (
                <span className="text-[--color-fg-muted] font-normal">
                  {" "}
                  · {fmtNum(seguimiento.length)} en seguimiento
                </span>
              )}
            </span>
          )}
        </div>
        {tab === "por_marca" ? (
          <PorMarcaView scored={scored} />
        ) : (
          <>
            <ListaVIN
              items={activa}
              vinExpanded={vinExpanded}
              onExpand={(v) => setVinExpanded(vinExpanded === v ? null : v)}
            />
            <EnSeguimientoSection
              items={seguimiento}
              vinExpanded={vinExpanded}
              onExpand={(v) => setVinExpanded(vinExpanded === v ? null : v)}
            />
          </>
        )}
      </div>

      {/* Insights operacionales */}
      <InsightsOperacionales insights={insights} onMarca={() => selCmd("por_marca")} />
    </div>
  );
}

function SectionHeaderCA({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h2 className="text-[16px] font-semibold tracking-tight text-[--color-fg]">{title}</h2>
      <p className="text-[12.5px] text-[--color-fg-muted] mt-0.5">{sub}</p>
    </div>
  );
}

const CMD_TONE: Record<CmdTone, { strip: string; text: string }> = {
  danger: { strip: "strip-danger", text: "text-[--color-danger]" },
  warning: { strip: "strip-warning", text: "text-[--color-warning]" },
  info: { strip: "strip-info", text: "text-[--color-info]" },
  muted: { strip: "strip-muted", text: "text-[--color-fg-muted]" },
};

// ── Bloque visible "Bloqueos logísticos" ─────────────────────────────────────
type LogStat = {
  count: number;
  capital: number;
  agingSum: number;
  agingN: number;
  scoreSum: number;
  slaRoto: number;
};

const LOG_CARD_DEFS: { id: BloqueoLogistico; tone: "danger" | "warning" }[] = [
  { id: "eta_vencida", tone: "danger" },
  { id: "despacho_incumplido", tone: "danger" },
  { id: "pendiente_estancado", tone: "warning" },
  { id: "auto_listo_no_solicitado", tone: "warning" },
  { id: "transito_prolongado", tone: "warning" },
  { id: "inscripcion_pendiente", tone: "warning" },
];

function BloqueosLogisticosSection({
  stats,
  total,
  activeFilter,
  onSelect,
}: {
  stats: Map<BloqueoLogistico, LogStat>;
  total: number;
  activeFilter: BloqueoLogistico | null;
  onSelect: (b: BloqueoLogistico | null) => void;
}) {
  const cards = LOG_CARD_DEFS.filter((d) => (stats.get(d.id)?.count ?? 0) > 0);
  return (
    <div className="surface bg-white px-5 py-4 top-strip strip-warning">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight text-[--color-fg] flex items-center gap-2">
            <Truck className="size-4 text-[--color-warning]" /> Bloqueos logísticos
          </h2>
          <p className="text-[12.5px] text-[--color-fg-muted] mt-0.5">
            VIN vivos detenidos por logística. Clic en una card para ver los VIN afectados abajo.
          </p>
        </div>
        <button
          onClick={() => onSelect(null)}
          className={cn(
            "text-[12px] px-2.5 py-1 rounded-md border transition shrink-0",
            activeFilter === null
              ? "border-[--color-warning] text-[--color-warning] bg-[--color-warning]/8"
              : "border-[--color-border] text-[--color-fg-muted] hover:text-[--color-fg]",
          )}
        >
          Ver todos · {fmtNum(total)}
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {cards.map((d) => (
          <BloqueoLogCard
            key={d.id}
            id={d.id}
            tone={d.tone}
            s={stats.get(d.id)!}
            active={activeFilter === d.id}
            onClick={() => onSelect(activeFilter === d.id ? null : d.id)}
          />
        ))}
      </div>
    </div>
  );
}

function BloqueoLogCard({
  id,
  tone,
  s,
  active,
  onClick,
}: {
  id: BloqueoLogistico;
  tone: "danger" | "warning";
  s: LogStat;
  active: boolean;
  onClick: () => void;
}) {
  const color = tone === "danger" ? "var(--color-danger)" : "var(--color-warning)";
  const agingProm = s.agingN > 0 ? Math.round(s.agingSum / s.agingN) : 0;
  const scoreProm = s.count > 0 ? Math.round(s.scoreSum / s.count) : 0;
  return (
    <button
      onClick={onClick}
      className={cn(
        "surface top-strip bg-white px-4 pt-3.5 pb-3 text-left w-full block surface-hover",
        tone === "danger" ? "strip-danger" : "strip-warning",
        active && "ring-2 ring-[--color-accent]/30 border-[--color-accent]",
      )}
    >
      <div className="text-[10.5px] font-semibold leading-tight min-h-[26px]" style={{ color }}>
        {BLOQUEO_LOGISTICO_LABEL[id]}
      </div>
      <div className="display text-[22px] mt-1 leading-none text-[--color-fg]">{fmtNum(s.count)}</div>
      <div className="text-[10.5px] text-[--color-fg-muted]">VIN · {fmtCLPCompact(s.capital)}</div>
      <div className="mt-2 pt-2 border-t border-[--color-border-soft] text-[10px] text-[--color-fg-dim] space-y-0.5">
        <div>aging {agingProm}d · score {scoreProm}/100</div>
        <div className="truncate">
          {BLOQUEO_OWNER[id]}
          {s.slaRoto > 0 ? ` · SLA roto ${s.slaRoto}` : ""}
        </div>
      </div>
    </button>
  );
}

function ComandoCard({
  cmd,
  stat,
  active,
  onClick,
}: {
  cmd: TabDef;
  stat: { count: number; monto: number };
  active: boolean;
  onClick: () => void;
}) {
  const cfg = CMD_TONE[cmd.tone];
  const vacio = stat.count === 0;
  return (
    <button
      onClick={onClick}
      className={cn(
        "surface top-strip bg-white px-4 pt-4 pb-3.5 text-left transition flex flex-col",
        cfg.strip,
        active
          ? "ring-2 ring-[--color-accent]/30 border-[--color-accent]"
          : vacio
            ? "opacity-60 hover:opacity-100"
            : "surface-hover",
      )}
    >
      <div className={cn("flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.1em] font-semibold", cfg.text)}>
        {cmd.icon}
        <span className="truncate">{cmd.label}</span>
      </div>
      <div className="display text-[24px] mt-2 leading-none text-[--color-fg]">
        {fmtNum(stat.count)}
      </div>
      <div className="text-[11px] text-[--color-fg-muted] mt-1.5">
        {cmd.id === "por_marca"
          ? "VIN en alerta"
          : stat.monto > 0
            ? fmtCLPCompact(stat.monto)
            : "casos"}
      </div>
    </button>
  );
}

// ── Insights operacionales ─────────────────────────────────────────────

interface InsightsData {
  sucursalMasLenta: { nombre: string; count: number; capital: number; agingProm: number } | null;
  marcaPeorAging: { nombre: string; count: number; capital: number; agingProm: number } | null;
  top5Cap: number;
  totalCap: number;
  pctTop5: number;
  topResponsables: { responsable: string; count: number; capital: number }[];
}

function computeInsights(
  atrapados: VehiculoUnificado[],
  gestionMap: Record<string, GestionVIN>,
): InsightsData {
  const agg = (sel: (vu: VehiculoUnificado) => string) => {
    const m = new Map<string, { count: number; capital: number; sumDias: number; conDias: number }>();
    for (const vu of atrapados) {
      const k = sel(vu);
      const e = m.get(k) ?? { count: 0, capital: 0, sumDias: 0, conDias: 0 };
      e.count++;
      e.capital += vu.capitalComprometido;
      const d = maxAging(vu);
      if (d > 0) {
        e.sumDias += d;
        e.conDias++;
      }
      m.set(k, e);
    }
    return m;
  };

  const sucM = agg((vu) => vu.sucursal ?? "(sin sucursal)");
  const sucursalMasLenta =
    [...sucM.entries()]
      .map(([nombre, e]) => ({
        nombre,
        count: e.count,
        capital: e.capital,
        agingProm: e.conDias > 0 ? Math.round(e.sumDias / e.conDias) : 0,
      }))
      .sort((a, b) => b.capital - a.capital)[0] ?? null;

  const marcaM = agg((vu) => vu.marca ?? "(sin marca)");
  const marcaPeorAging =
    [...marcaM.entries()]
      .map(([nombre, e]) => ({
        nombre,
        count: e.count,
        capital: e.capital,
        agingProm: e.conDias > 0 ? Math.round(e.sumDias / e.conDias) : 0,
      }))
      .filter((m) => m.count >= 2)
      .sort((a, b) => b.agingProm - a.agingProm)[0] ?? null;

  const sorted = [...atrapados].sort((a, b) => b.capitalComprometido - a.capitalComprometido);
  const totalCap = atrapados.reduce((s, vu) => s + vu.capitalComprometido, 0);
  const top5Cap = sorted.slice(0, 5).reduce((s, vu) => s + vu.capitalComprometido, 0);
  const pctTop5 = totalCap > 0 ? top5Cap / totalCap : 0;

  const capByVin = new Map(atrapados.map((vu) => [vu.vinLimpio, vu.capitalComprometido]));
  const respM = new Map<string, { count: number; capital: number }>();
  for (const [vin, g] of Object.entries(gestionMap)) {
    if (!g.responsable) continue;
    if (g.estadoGestion === "resuelto" || g.estadoGestion === "cancelado") continue;
    const e = respM.get(g.responsable) ?? { count: 0, capital: 0 };
    e.count++;
    e.capital += capByVin.get(vin) ?? 0;
    respM.set(g.responsable, e);
  }
  const topResponsables = [...respM.entries()]
    .map(([responsable, e]) => ({ responsable, ...e }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { sucursalMasLenta, marcaPeorAging, top5Cap, totalCap, pctTop5, topResponsables };
}

function InsightsOperacionales({
  insights,
  onMarca,
}: {
  insights: InsightsData;
  onMarca: () => void;
}) {
  const { sucursalMasLenta, marcaPeorAging, pctTop5, top5Cap, topResponsables } = insights;
  return (
    <div>
      <SectionHeaderCA
        title="Dónde está muriendo la velocidad"
        sub="Concentración del problema · dónde y quién."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-3">
        {sucursalMasLenta && (
          <InsightCard
            icon={<MapPin className="size-4" strokeWidth={1.75} />}
            tone="danger"
            titulo="Sucursal con más caja atrapada"
            valor={sucursalMasLenta.nombre}
            detalle={`${fmtNum(sucursalMasLenta.count)} casos · ${fmtCLPCompact(sucursalMasLenta.capital)} · aging prom ${sucursalMasLenta.agingProm}d`}
          />
        )}
        {marcaPeorAging && (
          <InsightCard
            icon={<Tag className="size-4" strokeWidth={1.75} />}
            tone="warning"
            titulo="Marca con peor aging"
            valor={marcaPeorAging.nombre}
            detalle={`aging prom ${marcaPeorAging.agingProm}d · ${fmtNum(marcaPeorAging.count)} casos · ${fmtCLPCompact(marcaPeorAging.capital)}`}
            onClick={onMarca}
          />
        )}
        <InsightCard
          icon={<Flame className="size-4" strokeWidth={1.75} />}
          tone="danger"
          titulo="Concentración del riesgo"
          valor={`5 VIN = ${Math.round(pctTop5 * 100)}%`}
          detalle={`Los 5 VIN más pesados concentran ${fmtCLPCompact(top5Cap)} de la caja atrapada.`}
        />
        <InsightCard
          icon={<Users className="size-4" strokeWidth={1.75} />}
          tone="info"
          titulo="Backlog por responsable"
          valor={
            topResponsables.length > 0
              ? `${topResponsables[0].responsable}`
              : "Sin asignar"
          }
          detalle={
            topResponsables.length > 0
              ? topResponsables
                  .slice(0, 3)
                  .map((r) => `${r.responsable}: ${r.count}`)
                  .join(" · ")
              : "Asigna responsables en los casos para ver backlog."
          }
        />
      </div>
    </div>
  );
}

function InsightCard({
  icon,
  tone,
  titulo,
  valor,
  detalle,
  onClick,
}: {
  icon: React.ReactNode;
  tone: CmdTone;
  titulo: string;
  valor: string;
  detalle: string;
  onClick?: () => void;
}) {
  const cfg = CMD_TONE[tone];
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "surface top-strip bg-white px-4 pt-4 pb-3.5 text-left w-full block",
        cfg.strip,
        onClick && "surface-hover cursor-pointer",
      )}
    >
      <div className={cn("flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.1em] font-semibold", cfg.text)}>
        {icon}
        <span className="truncate">{titulo}</span>
      </div>
      <div className="text-[17px] font-semibold tracking-tight text-[--color-fg] mt-2 truncate">
        {valor}
      </div>
      <div className="text-[11px] text-[--color-fg-muted] mt-1.5 leading-snug">{detalle}</div>
    </Comp>
  );
}

// ── Lista VIN priorizada ───────────────────────────────────────────────

function ListaVIN({
  items,
  vinExpanded,
  onExpand,
}: {
  items: { vu: VehiculoUnificado; score: ScoreVIN }[];
  vinExpanded: string | null;
  onExpand: (vin: string) => void;
}) {
  if (items.length === 0) {
    return (
      <Card>
        <CardBody className="p-10 text-center text-[13px] text-[--color-fg-muted]">
          Sin casos en este filtro.
        </CardBody>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {items.slice(0, 100).map((x) => (
        <VINCard
          key={x.vu.vinLimpio}
          vu={x.vu}
          score={x.score}
          expanded={vinExpanded === x.vu.vinLimpio}
          onExpand={() => onExpand(x.vu.vinLimpio)}
        />
      ))}
      {items.length > 100 && (
        <div className="text-[11.5px] text-[--color-fg-muted] text-center mt-3">
          Mostrando primeros 100 de {fmtNum(items.length)} · refina con otros tabs.
        </div>
      )}
    </div>
  );
}

/**
 * Sección "En seguimiento" — casos que YA tienen responsable + compromiso
 * vigente + seguimiento activo. Salen del top principal (no requieren acción
 * ahora) pero NO desaparecen: quedan acá, colapsados por defecto.
 */
function EnSeguimientoSection({
  items,
  vinExpanded,
  onExpand,
}: {
  items: { vu: VehiculoUnificado; score: ScoreVIN }[];
  vinExpanded: string | null;
  onExpand: (vin: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="surface bg-[--color-bg-elev-1]/40 overflow-hidden">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-center gap-2.5 px-5 py-3 text-left hover:bg-[--color-bg-elev-1]/70 transition"
      >
        {abierto ? (
          <ChevronDown className="size-4 text-[--color-fg-muted]" />
        ) : (
          <ChevronRight className="size-4 text-[--color-fg-muted]" />
        )}
        <span className="inline-flex items-center justify-center size-5 rounded-full bg-[#15a87b]/12">
          <span className="size-1.5 rounded-full bg-[#15a87b]" />
        </span>
        <span className="text-[13px] font-semibold text-[--color-fg]">En seguimiento</span>
        <span className="text-[12px] text-[--color-fg-muted]">
          {fmtNum(items.length)} caso{items.length === 1 ? "" : "s"} con responsable y compromiso
          vigente
        </span>
        <span className="ml-auto text-[11px] text-[--color-fg-dim]">
          {abierto ? "Ocultar" : "Ver"}
        </span>
      </button>
      {abierto && (
        <div className="px-3 pb-3 space-y-2">
          {items.slice(0, 100).map((x) => (
            <VINCard
              key={x.vu.vinLimpio}
              vu={x.vu}
              score={x.score}
              expanded={vinExpanded === x.vu.vinLimpio}
              onExpand={() => onExpand(x.vu.vinLimpio)}
            />
          ))}
          {items.length > 100 && (
            <div className="text-[11.5px] text-[--color-fg-muted] text-center mt-2">
              Mostrando primeros 100 de {fmtNum(items.length)}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Chip de aging — muestra el aging más relevante con color por severidad. */
function ChipAging({ vu }: { vu: VehiculoUnificado }) {
  const dias = Math.max(
    vu.fneDiasFactura ?? 0,
    vu.diasStock ?? 0,
    vu.fneDiasEnEstado ?? 0,
    vu.diasTescar ?? 0,
  );
  if (dias <= 0) return null;
  const tone = dias > 180 ? "danger" : dias > 90 ? "danger" : dias > 60 ? "warning" : "muted";
  const fuente = vu.enFNE ? "en estado" : "stock";
  return (
    <Badge tone={tone} size="xs">
      {dias}d {fuente}
    </Badge>
  );
}

/** Etiqueta de urgencia en lenguaje de negocio (no "score"). */
function UrgenciaBadge({ severidad }: { severidad: Severidad }) {
  const label =
    severidad === "critica"
      ? "Urgente"
      : severidad === "alta"
        ? "Prioritario"
        : severidad === "media"
          ? "Atención"
          : "Seguimiento";
  const cls =
    severidad === "critica" || severidad === "alta"
      ? "text-[--color-danger]"
      : severidad === "media"
        ? "text-[--color-warning]"
        : "text-[--color-fg-muted]";
  return (
    <div className={cn("text-[10.5px] uppercase tracking-[0.1em] font-bold", cls)}>{label}</div>
  );
}

// ── Helpers de presentación (UX · sin tocar lógica) ─────────────────────

/** Iniciales para avatar de responsable. */
function iniciales(nombre: string): string {
  const parts = nombre.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_COLORS = [
  "#3358e8",
  "#15a87b",
  "#d97706",
  "#7c3aed",
  "#0d9488",
  "#db2777",
  "#2e90fa",
  "#b45309",
];
/** Color estable por nombre (hash) — mismo responsable, mismo color. */
function colorResponsable(nombre: string): string {
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function Avatar({ nombre, size = "md" }: { nombre: string; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "size-6 text-[9.5px]" : "size-8 text-[11px]";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full text-white font-bold shrink-0 shadow-sm",
        dim,
      )}
      style={{ background: colorResponsable(nombre) }}
      title={nombre}
    >
      {iniciales(nombre)}
    </span>
  );
}

/** Fila logística visible dentro de la VIN card (colapsada). Color por severidad. */
function LogisticaRowCard({ r, vu }: { r: LogisticaCasoResumen; vu: VehiculoUnificado }) {
  const critico =
    r.etaVencida || r.bloqueos.includes("despacho_incumplido") || r.higiene === "abandonado";
  const color = critico ? "var(--color-danger)" : "var(--color-warning)";
  return (
    <div
      className="mt-2 rounded-md border px-3 py-2"
      style={{ borderColor: `${color}55`, background: `${color}0f` }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold" style={{ color }}>
          <Truck className="size-3.5" /> {r.estadoLabel}
        </span>
        {r.bloqueos.map((b) => (
          <Badge key={b} tone={critico ? "danger" : "warning"} size="xs">
            {BLOQUEO_LOGISTICO_LABEL[b]}
          </Badge>
        ))}
        {r.aging != null && (
          <span className="text-[11px] text-[--color-fg-muted]">{r.aging}d detenido</span>
        )}
        {r.ownerLogistico && (
          <span className="text-[11px] text-[--color-fg-muted]">
            owner <span className="text-[--color-fg] font-medium">{r.ownerLogistico}</span>
          </span>
        )}
        <span className="text-[11px] text-[--color-fg-muted]">
          score <span className="font-semibold" style={{ color }}>{r.score}</span>/100
        </span>
        {vu.enFNE && vu.fneValorFactura > 0 && (
          <span className="text-[11px] text-[--color-fg-muted]">
            FNE {fmtCLPCompact(vu.fneValorFactura)}
          </span>
        )}
      </div>
      {r.proximaAccion && (
        <div className="text-[12px] mt-1 font-medium flex items-center gap-1" style={{ color }}>
          → {r.proximaAccion}
        </div>
      )}
    </div>
  );
}

function VINCard({
  vu,
  score,
  expanded,
  onExpand,
}: {
  vu: VehiculoUnificado;
  score: ScoreVIN;
  expanded: boolean;
  onExpand: () => void;
}) {
  const logisticaOp = useExcelStore((s) => s.logisticaPorVin)?.get(vu.vinLimpio) ?? null;
  const logResumen = logisticaOp ? resumirLogistica(logisticaOp) : null;
  const sevBg =
    score.severidad === "critica"
      ? "bg-[--color-danger]/[0.04]"
      : score.severidad === "alta"
        ? "bg-[--color-danger]/[0.02]"
        : "bg-white";
  const sevBorder =
    score.severidad === "critica"
      ? "border-[--color-danger]/40"
      : score.severidad === "alta"
        ? "border-[--color-danger]/20"
        : "border-[--color-border]";
  return (
    <div
      className={cn(
        "surface border-2 transition",
        sevBg,
        sevBorder,
        score.severidad === "critica" && !expanded && "pulse-critical",
      )}
    >
      <button
        onClick={onExpand}
        className="w-full text-left px-4 py-3.5 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-stretch gap-3 sm:gap-5 hover:bg-[--color-bg-elev-1]/40 transition"
      >
        {/* Capital atrapado — protagonista a la izquierda (arriba en móvil) */}
        <div className="shrink-0 w-full sm:w-[150px] border-b sm:border-b-0 sm:border-r border-[--color-border-soft] pb-2.5 sm:pb-0 pr-0 sm:pr-5">
          <div className="text-[10px] uppercase tracking-[0.1em] text-[--color-fg-muted] font-medium">
            Capital atrapado
          </div>
          <div className="display text-[24px] mt-1 leading-none text-[--color-fg]">
            {vu.capitalComprometido > 0 ? fmtCLPCompact(vu.capitalComprometido) : "—"}
          </div>
          <div className="text-[10px] text-[--color-fg-dim] mt-1.5 leading-snug">
            {FUENTE_CAPITAL_LABEL[vu.capitalComprometidoFuente]}
          </div>
        </div>

        {/* Identificación + bloqueo + acción */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[14px] text-[--color-fg]">
              {vu.marca ?? "—"} {vu.modelo ? `· ${vu.modelo}` : ""}
            </span>
            <span className="mono text-[11px] text-[--color-fg-muted]">{vu.vinLimpio}</span>
            {vu.sucursal && (
              <span className="text-[11px] text-[--color-fg-muted]">· {vu.sucursal}</span>
            )}
          </div>
          <div className="text-[12.5px] text-[--color-fg-muted] mt-0.5 line-clamp-1">
            {vu.cliente ?? "—"}
          </div>

          {/* Chips de estado: aging + bloqueo principal + naturaleza */}
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {esMaximaAlertaDe(vu) && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-[--color-danger]/12 text-[--color-danger] border border-[--color-danger]/30"
                title={factoresCriticosDe(vu).map((f) => f.label).join(" · ")}
              >
                <Flame className="size-3" /> Máxima alerta · {factoresCriticosDe(vu).length} factores
              </span>
            )}
            <ChipAging vu={vu} />
            {vu.fneBloqueos.length > 0 && (
              <Badge tone="warning" size="xs" className="min-w-0 max-w-full sm:max-w-none">
                <span className="truncate">
                  {vu.fneBloqueos[0].responsable}: {vu.fneBloqueos[0].descripcion}
                </span>
              </Badge>
            )}
            {vu.creditoPompeyo > 0 && (
              <Badge tone="danger" size="xs">
                C. Pompeyo {fmtCLPCompact(vu.creditoPompeyo)}
              </Badge>
            )}
            {vu.esJudicial && <Badge tone="danger" size="xs">Judicial</Badge>}
            {vu.esStockPagadoViejo && <Badge tone="danger" size="xs">Pagado +180d</Badge>}
            {vu.esTescar && (vu.diasTescar ?? 0) > 180 && <Badge tone="warning" size="xs">TESCAR +180d</Badge>}
            <GestionEstadoMini vin={vu.vinLimpio} />
          </div>

          {/* Acción sugerida */}
          <div className="text-[12.5px] text-[--color-accent] mt-2 font-medium flex items-center gap-1">
            → {score.accionSugerida}
          </div>

          {/* Capa logística VISIBLE (no escondida en el score) */}
          {logResumen && <LogisticaRowCard r={logResumen} vu={vu} />}
        </div>

        {/* Urgencia + score secundario a la derecha (fila propia en móvil) */}
        <div className="shrink-0 self-stretch sm:self-center flex items-center justify-between sm:justify-end gap-3 border-t sm:border-t-0 border-[--color-border-soft] pt-2.5 sm:pt-0">
          <div className="text-right">
            <UrgenciaBadge severidad={score.severidad} />
            <div className="mt-1">
              <ScoreChip score={score} />
            </div>
          </div>
          {expanded ? (
            <ChevronDown className="size-4 text-[--color-fg-muted]" />
          ) : (
            <ChevronRight className="size-4 text-[--color-fg-muted]" />
          )}
        </div>
      </button>

      {expanded && <DrillVIN vu={vu} />}
    </div>
  );
}

function DrillVIN({ vu }: { vu: VehiculoUnificado }) {
  // La FICHA OPERACIONAL es la pantalla principal del caso: absorbe presión,
  // factores, componentes, verdad física, timeline, capas y la mesa de gestión.
  // El Centro de Acción es solo la cola para llegar a ella (sin duplicar nada).
  return (
    <div className="border-t border-[--color-border-soft] px-5 py-5 bg-[--color-bg-elev-1]/40 fade-in">
      <FichaOperacionalVIN vin={vu.vinLimpio} />
    </div>
  );
}

// ── Vista Por marca ────────────────────────────────────────────────────

function PorMarcaView({
  scored,
}: {
  scored: { vu: VehiculoUnificado; score: ScoreVIN }[];
}) {
  // Consistente con la máxima alerta: la columna protagonista es "VIN en alerta"
  // (coincidencia de factores), NO el total de scored. El total operacional
  // queda como contexto neutro, no como "riesgo".
  const porMarca = useMemo(() => {
    const map = new Map<
      string,
      { marca: string; enAlerta: number; capitalAlerta: number; total: number; presionMax: number }
    >();
    for (const { vu, score } of scored) {
      const marca = normalizarMarcaOperacional(vu.marca);
      let e = map.get(marca);
      if (!e) {
        e = { marca, enAlerta: 0, capitalAlerta: 0, total: 0, presionMax: 0 };
        map.set(marca, e);
      }
      e.total++;
      if (score.total > e.presionMax) e.presionMax = score.total;
      if (esMaximaAlertaDe(vu)) {
        e.enAlerta++;
        e.capitalAlerta += vu.capitalComprometido;
      }
    }
    return [...map.values()].sort(
      (a, b) => b.enAlerta - a.enAlerta || b.capitalAlerta - a.capitalAlerta,
    );
  }, [scored]);

  return (
    <Card>
      <CardBody className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10.5px] text-[--color-fg-muted] uppercase tracking-[0.08em] bg-[--color-bg-elev-1]">
            <tr>
              <th className="text-left font-semibold px-4 py-3">Marca</th>
              <th className="text-right font-semibold px-4 py-3">VIN en alerta</th>
              <th className="text-right font-semibold px-4 py-3">Capital en alerta</th>
              <th className="text-right font-semibold px-4 py-3">Operación total</th>
              <th className="text-right font-semibold px-4 py-3">Presión máx</th>
            </tr>
          </thead>
          <tbody>
            {porMarca.map((m) => (
              <tr key={m.marca} className="border-b border-[--color-border-soft] last:border-0">
                <td className="px-4 py-3 text-[13px] font-medium">{m.marca}</td>
                <td className="px-4 py-3 text-right mono">
                  {m.enAlerta > 0 ? (
                    <span className="text-[--color-danger] font-semibold">{m.enAlerta}</span>
                  ) : (
                    <span className="text-[--color-fg-dim]">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right mono font-semibold">
                  {m.capitalAlerta > 0 ? fmtCLPCompact(m.capitalAlerta) : "—"}
                </td>
                <td className="px-4 py-3 text-right mono text-[--color-fg-muted]">{m.total}</td>
                <td className="px-4 py-3 text-right mono">
                  <span
                    className={cn(
                      "font-semibold",
                      m.presionMax >= 80
                        ? "text-[--color-danger]"
                        : m.presionMax >= 60
                          ? "text-[--color-warning]"
                          : "text-[--color-fg-muted]",
                    )}
                  >
                    {m.presionMax}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}

// ── Badge de gestión visible en la fila (sin expandir) ──────────────────

function GestionEstadoMini({ vin }: { vin: string }) {
  const gestion = useGestionStore((s) => s.byVin[vin]);
  if (!gestion) return null;
  const tieneNota = !!(
    gestion.comentario ||
    gestion.proximaAccion ||
    gestion.responsable ||
    gestion.fechaCompromiso ||
    gestion.prioridadManual
  );
  if (!tieneNota) return null;
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[--color-accent]/8 border border-[--color-accent]/25">
      <SeguimientoBadge vin={vin} />
      {gestion.responsable && (
        <span className="inline-flex items-center gap-1">
          <Avatar nombre={gestion.responsable} size="sm" />
          <span className="text-[10.5px] text-[--color-fg-muted]">{gestion.responsable}</span>
        </span>
      )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cola gestionable inline — mismo patrón visual que /facturados-no-entregados
// ─────────────────────────────────────────────────────────────────────────────
//
// Tabla rica con columnas estándar del sistema:
//   CLIENTE · SUCURSAL (con vendedor) | VIN · PATENTE | MARCA · MODELO |
//   DÍAS RETENIDO (con sublabel) | VALOR (formato $X.XXX) | ALERTA |
//   C. POMPEYO | GESTIÓN (inline persistente)
//
// + Filtros temporales (Todos / ≤3d / 4-7d / 8-15d / 16-30d / >30d)
// + Franja lateral roja para críticos (>30d)
// + Click en fila expande FichaOperacionalVIN inline (cuando hay VIN real)
//
// Para colas sin VIN (saldos / bonos / provisiones), las columnas VIN/marca/
// modelo se rellenan con la mejor info doc disponible. La gestión se persiste
// con la clave estándar (`SALDO-…`, `BONO-…`, `PROV-…`).

type TramoDias = "all" | "t0_3" | "t4_7" | "t8_15" | "t16_30" | "t30";

const TRAMO_LABEL: Record<TramoDias, string> = {
  all: "Todos",
  t0_3: "≤3 días",
  t4_7: "4-7 días",
  t8_15: "8-15 días",
  t16_30: "16-30 días",
  t30: "Más de 30 días",
};

interface FilaCola {
  clave: string;          // gestionKey — VIN o "PREFIJO-ID"
  vin?: string | null;    // VIN limpio para expandir FichaOperacionalVIN (si aplica)
  cliente?: string | null;
  vendedor?: string | null;
  sucursal?: string | null;
  patente?: string | null;
  marca?: string | null;
  modelo?: string | null;
  /** Texto principal cuando la cola es no-VIN (saldos/bonos/prov). */
  primario?: string;
  diasRetenido?: number | null;
  /** Sub-label debajo de los días — ej. "desde factura", "compromiso vencido". */
  diasSublabel?: string;
  monto: number;
  /** ¿Tiene crédito Pompeyo? Para badge C.P. */
  tieneCp?: boolean;
  /** Monto del CP (si aplica) — solo para mostrar en el badge. */
  montoCp?: number;
}

function clasificarTramo(d: number | null | undefined): TramoDias {
  if (d == null) return "all";
  if (d <= 3) return "t0_3";
  if (d <= 7) return "t4_7";
  if (d <= 15) return "t8_15";
  if (d <= 30) return "t16_30";
  return "t30";
}

function alertaPorDias(d: number | null | undefined): {
  texto: string | null;
  tono: "danger" | "warning" | "muted" | null;
} {
  if (d == null) return { texto: null, tono: null };
  if (d > 30) return { texto: "Crítico · >30d", tono: "danger" };
  if (d > 15) return { texto: "Atrasado · >15d", tono: "warning" };
  if (d > 7) return { texto: "Atención · >7d", tono: "muted" };
  return { texto: null, tono: null };
}

function ColaGestionableInline({
  titulo,
  subtitulo,
  tono,
  filas,
  refContainer,
  onClose,
  claveDestacada,
}: {
  titulo: string;
  subtitulo?: string;
  tono: "danger" | "warning" | "accent";
  /** El monto total se computa internamente sumando `filas[].monto`. */
  filas: FilaCola[];
  refContainer: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  /** Deep-link ?clave= → fila resaltada con su gestión abierta. */
  claveDestacada?: string | null;
}) {
  const [tramo, setTramo] = useState<TramoDias>("all");
  const [vinExpandido, setVinExpandido] = useState<string | null>(null);
  // Caso documental abierto (sin VIN: SALDO-/BONO-/PROV-) — uno a la vez, como vinExpandido.
  const [claveDocExpandida, setClaveDocExpandida] = useState<string | null>(null);

  const stripClass =
    tono === "danger" ? "strip-danger" : tono === "warning" ? "strip-warning" : "strip-operativo";
  const colorClass =
    tono === "danger"
      ? "text-[--color-danger]"
      : tono === "warning"
        ? "text-[--color-warning]"
        : "text-[--color-accent]";

  // Filtro temporal
  const filtradas = useMemo(() => {
    if (tramo === "all") return filas;
    return filas.filter((f) => clasificarTramo(f.diasRetenido) === tramo);
  }, [filas, tramo]);

  // Counts por tramo
  const counts = useMemo(() => {
    const c: Record<TramoDias, number> = {
      all: filas.length, t0_3: 0, t4_7: 0, t8_15: 0, t16_30: 0, t30: 0,
    };
    for (const f of filas) {
      const t = clasificarTramo(f.diasRetenido);
      if (t !== "all") c[t]++;
    }
    return c;
  }, [filas]);

  const montoFiltrado = useMemo(
    () => filtradas.reduce((s, f) => s + f.monto, 0),
    [filtradas],
  );

  // Top-50 por monto. Si llega una clave destacada (deep-link) que el corte
  // o el filtro temporal dejarían fuera, se antepone para que siempre aterrice.
  const slice = useMemo(() => {
    const base = filtradas.slice(0, 50);
    if (!claveDestacada || base.some((f) => f.clave === claveDestacada)) return base;
    const extra = filas.find((f) => f.clave === claveDestacada);
    return extra ? [extra, ...base] : base;
  }, [filtradas, filas, claveDestacada]);

  // Scroll a la fila destacada una vez montada.
  useEffect(() => {
    if (!claveDestacada) return;
    if (!slice.some((f) => f.clave === claveDestacada)) return;
    const t = setTimeout(() => {
      document
        .getElementById(`caso-${claveDestacada}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    return () => clearTimeout(t);
  }, [claveDestacada, slice]);

  return (
    <div ref={refContainer} className={cn("surface bg-white px-6 py-5 top-strip space-y-3", stripClass)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className={cn("text-[10.5px] uppercase tracking-[0.14em] font-semibold", colorClass)}>
            {titulo}
          </div>
          <div className="text-[14px] font-semibold text-[--color-fg] mt-0.5">
            {fmtNum(filtradas.length)} {filtradas.length === 1 ? "caso" : "casos"}
            {tramo !== "all" && (
              <span className="text-[12px] text-[--color-fg-muted] font-normal">
                {" "}de {fmtNum(filas.length)}
              </span>
            )}
            {montoFiltrado > 0 && (
              <>
                {" · "}
                <span className={colorClass}>{fmtCLP(montoFiltrado)}</span>
              </>
            )}
            {subtitulo && (
              <span className="text-[12px] text-[--color-fg-muted] font-normal"> · {subtitulo}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[12px] text-[--color-fg-muted] hover:text-[--color-fg] underline"
        >
          Cerrar
        </button>
      </div>

      {/* Filtros temporales */}
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(TRAMO_LABEL) as TramoDias[]).map((t) => {
          const n = counts[t];
          const activo = tramo === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTramo(t)}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium ring-1 ring-inset transition",
                activo
                  ? "bg-[--color-accent-dim] text-[--color-accent] ring-[--color-accent]"
                  : "ring-[--color-border] text-[--color-fg-muted] hover:text-[--color-fg] hover:bg-[--color-bg-elev-1]",
              )}
            >
              {TRAMO_LABEL[t]}
              <span
                className={cn(
                  "text-[10.5px] tabular-nums rounded px-1",
                  activo
                    ? "bg-white text-[--color-accent]"
                    : "bg-[--color-bg-elev-2] text-[--color-fg-muted]",
                )}
              >
                {fmtNum(n)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tabla rica */}
      {filtradas.length === 0 ? (
        <div className="text-[12.5px] text-[--color-fg-muted] italic py-4">
          No hay casos en este tramo.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="text-[10.5px] uppercase tracking-wider text-[--color-fg-muted]">
              <tr className="border-b border-[--color-border]">
                <th className="text-left py-2 font-semibold">Cliente · Sucursal</th>
                <th className="text-left py-2 font-semibold">VIN · Patente</th>
                <th className="text-left py-2 font-semibold">Marca · Modelo</th>
                <th className="text-right py-2 font-semibold">Días retenido</th>
                <th className="text-right py-2 font-semibold">Valor</th>
                <th className="text-left py-2 font-semibold">Alerta</th>
                <th className="text-left py-2 font-semibold">C. Pompeyo</th>
                <th className="text-left py-2 font-semibold pl-3">Gestión</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[--color-border-soft]">
              {slice.map((f) => {
                const al = alertaPorDias(f.diasRetenido);
                const sevClass =
                  al.tono === "danger"
                    ? "shadow-[inset_3px_0_0_var(--color-danger)]"
                    : al.tono === "warning"
                      ? "shadow-[inset_3px_0_0_var(--color-warning)]"
                      : "";
                const expandido = !!f.vin && vinExpandido === f.vin;
                const puedeExpandir = !!f.vin;
                const destacada = claveDestacada === f.clave;
                // Caso documental (sin VIN): SALDO-/BONO-/PROV- → ficha grande inline.
                const esDoc = !f.vin && /^(SALDO|BONO|PROV)-/.test(f.clave);
                const docExpandido = claveDocExpandida === f.clave;
                return (
                  <Fragment key={f.clave}>
                    <tr
                      id={`caso-${f.clave}`}
                      className={cn(
                        "align-top hover:bg-[--color-bg-elev-1] transition",
                        sevClass,
                        puedeExpandir && "cursor-pointer",
                        destacada && "bg-[--color-accent-dim] ring-2 ring-inset ring-[--color-accent]/40",
                      )}
                      onClick={() => {
                        if (puedeExpandir && f.vin) {
                          setVinExpandido(expandido ? null : f.vin);
                        }
                      }}
                    >
                      {/* Cliente · Sucursal (+ vendedor abajo) */}
                      <td className="py-2 pl-3">
                        <div className="font-medium text-[--color-fg] truncate max-w-[260px]" title={f.cliente ?? ""}>
                          {f.cliente ?? f.primario ?? "—"}
                        </div>
                        <div className="text-[10.5px] text-[--color-fg-muted] mt-0.5 truncate max-w-[260px]">
                          {f.sucursal ?? "—"}
                          {f.vendedor && (
                            <span className="text-[--color-fg-dim]"> · {f.vendedor}</span>
                          )}
                        </div>
                      </td>
                      {/* VIN · Patente */}
                      <td className="py-2">
                        <div className="mono whitespace-nowrap">{f.vin ?? f.primario ?? "—"}</div>
                        <div className="text-[10.5px] text-[--color-fg-dim] mt-0.5">{f.patente ?? "—"}</div>
                      </td>
                      {/* Marca · Modelo */}
                      <td className="py-2">
                        <div className="font-medium">{f.marca ?? "—"}</div>
                        <div className="text-[10.5px] text-[--color-fg-muted] mt-0.5 truncate max-w-[200px]">
                          {f.modelo ?? ""}
                        </div>
                      </td>
                      {/* Días retenido */}
                      <td className="py-2 text-right">
                        {f.diasRetenido == null ? (
                          <span className="text-[--color-fg-muted] text-[12px]">—</span>
                        ) : (
                          <>
                            <div
                              className={cn(
                                "font-semibold tabular-nums text-[14px]",
                                al.tono === "danger"
                                  ? "text-[--color-danger]"
                                  : al.tono === "warning"
                                    ? "text-[--color-warning]"
                                    : "text-[--color-fg]",
                              )}
                            >
                              {f.diasRetenido}d
                            </div>
                            {f.diasSublabel && (
                              <div className="text-[10.5px] text-[--color-fg-dim] mt-0.5">
                                {f.diasSublabel}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      {/* Valor */}
                      <td className="py-2 text-right tabular-nums font-medium">
                        {fmtCLP(f.monto)}
                      </td>
                      {/* Alerta */}
                      <td className="py-2">
                        {al.texto ? (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset",
                              al.tono === "danger"
                                ? "bg-[--color-danger]/10 text-[--color-danger] ring-[--color-danger]/30"
                                : al.tono === "warning"
                                  ? "bg-[--color-warning]/10 text-[--color-warning] ring-[--color-warning]/30"
                                  : "bg-[--color-bg-elev-2] text-[--color-fg-muted] ring-[--color-border]",
                            )}
                          >
                            <AlertTriangle className="size-3" />
                            {al.texto}
                          </span>
                        ) : (
                          <span className="text-[--color-fg-dim] text-[11px]">—</span>
                        )}
                      </td>
                      {/* C. Pompeyo */}
                      <td className="py-2">
                        {f.tieneCp ? (
                          <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset bg-[--color-danger]/10 text-[--color-danger] ring-[--color-danger]/30">
                            Con C.P.
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset bg-[--color-success]/10 text-[--color-success] ring-[--color-success]/30">
                            Sin C.P.
                          </span>
                        )}
                      </td>
                      {/* Gestión — regla "VIN con V corta":
                          - HAY VIN  → botón que abre/cierra la FichaOperacionalVIN
                                       completa (mismo lugar transversal de gestión).
                          - NO VIN   → popover GestionInline con la clave doc
                                       (SALDO-/BONO-/PROV-) como fallback. */}
                      <td className="py-2 pl-3">
                        {puedeExpandir && f.vin ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setVinExpandido(expandido ? null : f.vin!);
                            }}
                            className={cn(
                              "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] font-semibold ring-1 ring-inset transition",
                              expandido
                                ? "bg-[--color-accent-dim] text-[--color-accent] ring-[--color-accent]"
                                : "bg-white text-[--color-accent] ring-[--color-accent]/30 hover:bg-[--color-accent-dim]",
                            )}
                          >
                            {expandido ? "Cerrar caso" : "Abrir caso"}
                            {expandido ? (
                              <ChevronDown className="size-3" />
                            ) : (
                              <ChevronRight className="size-3" />
                            )}
                          </button>
                        ) : esDoc ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setClaveDocExpandida(docExpandido ? null : f.clave);
                            }}
                            className={cn(
                              "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] font-semibold ring-1 ring-inset transition",
                              docExpandido
                                ? "bg-[--color-accent-dim] text-[--color-accent] ring-[--color-accent]"
                                : "bg-white text-[--color-accent] ring-[--color-accent]/30 hover:bg-[--color-accent-dim]",
                            )}
                          >
                            {docExpandido ? "Cerrar caso" : "Gestionar"}
                            {docExpandido ? (
                              <ChevronDown className="size-3" />
                            ) : (
                              <ChevronRight className="size-3" />
                            )}
                          </button>
                        ) : (
                          <span className="text-[--color-fg-dim] text-[11px]">—</span>
                        )}
                      </td>
                    </tr>
                    {expandido && f.vin && (
                      <tr>
                        <td colSpan={8} className="bg-[--color-bg-elev-1] px-3 py-3">
                          <FichaOperacionalVIN vin={f.vin} />
                        </td>
                      </tr>
                    )}
                    {docExpandido && esDoc && (
                      <tr>
                        <td colSpan={8} className="bg-[--color-bg-elev-1] px-3 py-3">
                          <FichaGestionDocumental
                            clave={f.clave}
                            titulo={`${f.clave.startsWith("BONO") ? "Bono" : f.clave.startsWith("SALDO") ? "Saldo" : "Caso"} · ${f.cliente ?? f.primario ?? "—"}`}
                            subtitulo={f.diasSublabel ?? null}
                            descripcionCaso={f.primario ?? ([f.marca, f.modelo].filter(Boolean).join(" ") || null)}
                            datos={[
                              { label: "Monto", valor: fmtCLP(f.monto) },
                              { label: "Días retenido", valor: f.diasRetenido != null ? `${f.diasRetenido}d` : "—" },
                              { label: "Cliente", valor: f.cliente ?? "—" },
                              { label: "Sucursal", valor: f.sucursal ?? "—" },
                              { label: "Marca", valor: f.marca ?? "—" },
                              { label: "Referencia", valor: f.primario ?? "—" },
                            ]}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {filtradas.length > 50 && (
            <div className="text-[11px] text-[--color-fg-muted] mt-2 italic">
              Mostrando 50 de {fmtNum(filtradas.length)} · ordenados por monto desc
            </div>
          )}
        </div>
      )}
    </div>
  );
}
