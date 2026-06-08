/**
 * /tendencias V2 — Centro de Control Ejecutivo histórico (solo lectura).
 *
 * Rediseño 2026-06 (Velocity OS). Orden de lectura fijo:
 *   1. Qué pasó este período — Hero ejecutivo
 *   2. Cómo evolucionó — Sparklines por score
 *   3. Por qué pasó — Lectura automática + causa raíz consolidada
 *   4. Detalle técnico — Tabla histórica (colapsable)
 *   5. Calidad y confianza — Auditoría de cobertura (colapsable, oculta por default)
 *
 * Restricciones:
 *   · NO toca cálculos, snapshots, backend, schema, Railway
 *   · NO score único combinado — los 3 scores siempre separados
 *   · Sin filtro por marca (diagnóstico vivo en chat; soporte se construye después)
 *   · La key interna sigue siendo `scoreGerencial` (compat backend); visible
 *     se muestra como "Score Cumplimiento Operacional"
 */

import { redirect } from "next/navigation";
import {
  ChevronDown,
  ClipboardCheck,
  Coins,
  Gauge,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { atribuirVariacion } from "@/lib/historico/atribucion-delta";
import {
  calcularScoreGerencialHistorico,
  type ResultadoScoreGerencialHistorico,
} from "@/lib/historico/calcular-score-gerencial-historico";
import {
  calcularSGLegacyPorDia,
  type PuntoDiario,
} from "@/lib/historico/calcular-scores-por-dia";
import { MarcaUrlSync } from "./MarcaUrlSync";

const ROLES_PERMITIDOS = new Set(["ADMIN", "GERENTE_GENERAL", "DIRECTOR"]);

// ────────────────────────────────────────────────────────────────────
// Tipos (espejo del JSON persistido)
// ────────────────────────────────────────────────────────────────────

interface DriverPersistido {
  id: string;
  nombre: string;
  valor: number | null;
  unidad: string;
  peso: number;
  pesoEfectivo?: number;
  puntos: number;
  direccion: "positivo" | "negativo";
  inverso?: boolean;
}

interface ScoreResultPersistido {
  score: number | null;
  drivers: DriverPersistido[];
  driversFaltantes: string[];
  pesoCubierto: number;
  confianza: "alta" | "media" | "baja" | null;
  causaRaizPrincipal: string;
  accionSugerida: string;
  warnings: string[];
}

interface AtribucionDriverPersistido {
  id: string;
  nombre: string;
  puntosActual: number;
  puntosPrevio: number;
  deltaPuntos: number;
  direccion: "mejora" | "deterioro" | "neutro";
  contribucionPct: number;
  estado: "presente" | "cambio_de_cobertura";
}

interface AtribucionDeltaPersistida {
  delta: number;
  drivers: AtribucionDriverPersistido[];
  responsablePrincipal: string | null;
  narrativa: string;
}

type ScoreKey = "capital" | "gerencial" | "velocidad";

interface SnapshotFila {
  id: string;
  periodo: string;
  fecha: Date;
  scoreCapital: number | null;
  scoreGerencial: number | null;
  scoreVelocidad: number | null;
  fuentesUsadas: string[];
  fuentesEsperadas: string[];
  completionPct: number | null;
  warnings: string[];
  capitalGlobal: ScoreResultPersistido | null;
  gerencialGlobal: ScoreResultPersistido | null;
  velocidadGlobal: ScoreResultPersistido | null;
  atribucionCapital: AtribucionDeltaPersistida | null;
  atribucionGerencial: AtribucionDeltaPersistida | null;
  atribucionVelocidad: AtribucionDeltaPersistida | null;
  lastRecalculatedAt: Date | null;
}

// ────────────────────────────────────────────────────────────────────
// Helpers compartidos
// ────────────────────────────────────────────────────────────────────

const MESES_ES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

function nombrePeriodo(periodo: string, sc: unknown): string {
  const [yyyy, mm] = periodo.split("-");
  const m = parseInt(mm, 10);
  const base = `${MESES_ES[m - 1] ?? "?"} ${yyyy}`;
  const scObj = sc as Record<string, unknown> | null;
  const esParcialExplicito =
    typeof scObj?.parcialDeclarado === "boolean" && scObj.parcialDeclarado === true;
  return esParcialExplicito ? `${base} parcial` : base;
}

/**
 * Paleta de 5 zonas (alineada con la leyenda de interpretación):
 *   80-100 → Excelente   (emerald)
 *   60-79  → Bueno       (lime)
 *   40-59  → Atención    (amber)
 *   20-39  → Riesgo      (orange)
 *   0-19   → Crítico     (red)
 */
function zonaBgClass(score: number | null): string {
  if (score === null) return "bg-[--color-bg-elev-2] text-[--color-fg-muted]";
  if (score >= 80) return "bg-emerald-50 text-emerald-700";
  if (score >= 60) return "bg-lime-50 text-lime-700";
  if (score >= 40) return "bg-amber-50 text-amber-700";
  if (score >= 20) return "bg-orange-50 text-orange-700";
  return "bg-red-50 text-red-700";
}

function zonaColorHex(score: number | null): string {
  if (score === null) return "#8b94a3"; // fg-dim
  if (score >= 80) return "#15a87b"; // emerald (success)
  if (score >= 60) return "#65a30d"; // lime-600
  if (score >= 40) return "#d97706"; // amber-600 (warning)
  if (score >= 20) return "#ea580c"; // orange-600
  return "#dc2626"; // red-600 (danger)
}

function asScoreResult(x: unknown): ScoreResultPersistido | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (!("score" in r) || !("drivers" in r)) return null;
  return r as unknown as ScoreResultPersistido;
}

function asAtribucion(x: unknown): AtribucionDeltaPersistida | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (!("delta" in r) || !("narrativa" in r)) return null;
  return r as unknown as AtribucionDeltaPersistida;
}

function mapSnapshot(
  s: {
    id: string;
    snapshotPeriod: string;
    snapshotDate: Date;
    scoreCapital: number | null;
    scoreGerencial: number | null;
    scoreVelocidad: number | null;
    fuentesUsadas: string[];
    fuentesEsperadas: string[];
    completionPct: number | null;
    warnings: string[];
    scoreComponentes: unknown;
    lastRecalculatedAt: Date | null;
  },
  marca: string | null,
): SnapshotFila {
  const sc = s.scoreComponentes as Record<string, unknown> | null;
  const f1B = sc?.fase1bB as Record<string, unknown> | undefined;
  const f1C = sc?.fase1bC as Record<string, unknown> | undefined;

  // Helpers para extraer global o porMarca[marca] según el filtro
  function pick(
    bloque: Record<string, unknown> | undefined,
  ): ScoreResultPersistido | null {
    if (!bloque) return null;
    if (!marca) return asScoreResult(bloque.global);
    const porMarca = bloque.porMarca as Record<string, unknown> | undefined;
    return asScoreResult(porMarca?.[marca]);
  }

  const capG = pick(f1B?.scoreCapital as Record<string, unknown> | undefined);
  const gerG = pick(f1B?.scoreGerencial as Record<string, unknown> | undefined);
  const velG = pick(f1C?.scoreVelocidad as Record<string, unknown> | undefined);
  const atrib = f1C?.atribucionDelta as Record<string, unknown> | undefined;

  // Cuando hay marca, los valores top-level (columnas) son globales.
  // Para el render por marca usamos los `.score` de los objetos porMarca.
  const scoreCapital = marca ? (capG?.score ?? null) : s.scoreCapital;
  const scoreGerencial = marca ? (gerG?.score ?? null) : s.scoreGerencial;
  const scoreVelocidad = marca ? (velG?.score ?? null) : s.scoreVelocidad;

  return {
    id: s.id,
    periodo: s.snapshotPeriod,
    fecha: s.snapshotDate,
    scoreCapital,
    scoreGerencial,
    scoreVelocidad,
    fuentesUsadas: s.fuentesUsadas,
    fuentesEsperadas: s.fuentesEsperadas,
    completionPct: s.completionPct,
    warnings: s.warnings,
    capitalGlobal: capG,
    gerencialGlobal: gerG,
    velocidadGlobal: velG,
    // Con marca: atribución se recalcula on-the-fly en una pasada posterior
    // (necesitamos snapshot previo). Acá guardamos la global por default.
    atribucionCapital: marca ? null : asAtribucion(atrib?.capital),
    atribucionGerencial: marca ? null : asAtribucion(atrib?.gerencial),
    atribucionVelocidad: marca ? null : asAtribucion(atrib?.velocidad),
    lastRecalculatedAt: s.lastRecalculatedAt,
  };
}

/**
 * Cuando hay marca, recalcula atribución delta para cada período N usando
 * el ScoreResult `porMarca[marca]` del N y del N-1. La función
 * `atribuirVariacion` es pura y server-friendly.
 *
 * Si N-1 no existe o alguno de los scores es null → atribución queda null
 * (consistente con el comportamiento del orquestador histórico).
 */
function recalcularAtribucionPorMarca(filas: SnapshotFila[]): SnapshotFila[] {
  return filas.map((f, i) => {
    if (i === 0) return f; // primer período no tiene N-1
    const previo = filas[i - 1];
    return {
      ...f,
      atribucionCapital: atribuirVariacion(
        f.capitalGlobal as never,
        previo.capitalGlobal as never,
      ),
      atribucionGerencial: atribuirVariacion(
        f.gerencialGlobal as never,
        previo.gerencialGlobal as never,
      ),
      atribucionVelocidad: atribuirVariacion(
        f.velocidadGlobal as never,
        previo.velocidadGlobal as never,
      ),
    };
  });
}

function getScore(f: SnapshotFila, key: ScoreKey): number | null {
  return key === "capital"
    ? f.scoreCapital
    : key === "gerencial"
      ? f.scoreGerencial
      : f.scoreVelocidad;
}

function getScoreObj(f: SnapshotFila, key: ScoreKey): ScoreResultPersistido | null {
  return key === "capital"
    ? f.capitalGlobal
    : key === "gerencial"
      ? f.gerencialGlobal
      : f.velocidadGlobal;
}

// ────────────────────────────────────────────────────────────────────
// Página
// ────────────────────────────────────────────────────────────────────

export default async function TendenciasPage({
  searchParams,
}: {
  searchParams: Promise<{ marca?: string; vista?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!ROLES_PERMITIDOS.has(session.user.rol)) return <SinAcceso />;

  const params = await searchParams;
  const marca = params.marca && params.marca.trim() !== "" ? params.marca : null;
  // Default = diaria. Solo "mensual" es el otro válido.
  const vista: "diaria" | "mensual" =
    params.vista === "mensual" ? "mensual" : "diaria";

  const snapshotsDesc = await prisma.operationalSnapshot.findMany({
    where: { snapshotType: "monthly" },
    orderBy: { snapshotDate: "desc" },
    take: 4,
    select: {
      id: true,
      snapshotPeriod: true,
      snapshotDate: true,
      scoreCapital: true,
      scoreGerencial: true,
      scoreVelocidad: true,
      fuentesUsadas: true,
      fuentesEsperadas: true,
      completionPct: true,
      warnings: true,
      scoreComponentes: true,
      lastRecalculatedAt: true,
    },
  });

  let filas = [...snapshotsDesc].reverse().map((s) => mapSnapshot(s, marca));
  if (marca) filas = recalcularAtribucionPorMarca(filas);

  // ── Score Gerencial LEGACY mensual · solo si vista=mensual ──
  // Optimización: cuando vista=diaria, NO se necesita y NO se calcula.
  // Cada cálculo carga payloads + rehidrata + computa (~300-500 ms cada uno).
  // Saltarlo cuando no se renderiza es la diferencia entre cambio de tab
  // instantáneo vs ~2 s.
  const sgLegacyPorPeriodo: Record<string, ResultadoScoreGerencialHistorico> = {};
  if (vista === "mensual") {
    for (const f of filas) {
      sgLegacyPorPeriodo[f.periodo] = await calcularScoreGerencialHistorico({
        snapshotPeriod: f.periodo,
        marca,
      });
    }
  }

  // ── Cargas reales del período más reciente (para "Apertura por cargas") ──
  // Lee SnapshotHistoricoArchivo del último período cargado.
  const periodoApertura =
    filas.length > 0 ? filas[filas.length - 1].periodo : null;
  // Cargas solo si vista=mensual (en diaria las trae calcularSGLegacyPorDia).
  const cargasPeriodo =
    vista === "mensual" && periodoApertura
      ? await prisma.snapshotHistoricoArchivo.findMany({
          where: { snapshotPeriod: periodoApertura },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            fuente: true,
            nombreOriginal: true,
            prioridadCierre: true,
            esCierreMensual: true,
            createdAt: true,
            parseStatus: true,
          },
        })
      : [];

  // ── Puntos diarios para vista=diaria (solo SG legacy · Etapa A) ──
  const puntosDiarios: PuntoDiario[] =
    vista === "diaria" && periodoApertura
      ? await calcularSGLegacyPorDia({
          snapshotPeriod: periodoApertura,
          marca,
        })
      : [];

  // Diagnóstico de cobertura por marca: si todos los snapshots de esta marca
  // tienen score capital/gerencial/velocidad null, la marca no tiene data
  // suficiente para la vista.
  const todosNullPorMarca =
    marca !== null &&
    filas.every(
      (f) =>
        f.scoreCapital === null &&
        f.scoreGerencial === null &&
        f.scoreVelocidad === null,
    );

  return (
    <main className="px-6 py-8 max-w-[1300px] mx-auto">
      <MarcaUrlSync marcaFromUrl={marca} />
      <Header filas={filas} marca={marca} />
      <VistaTabs vistaActual={vista} marca={marca} />
      {filas.length === 0 ? (
        <SinDatos />
      ) : (
        <>
          {filas.length < 4 && <WarningCoberturaHistorica n={filas.length} />}
          {marca && <ContextoMarca marca={marca} todosNull={todosNullPorMarca} filas={filas} />}
          {!todosNullPorMarca && (
            <>
              {vista === "diaria" && (
                <>
                  <EvolucionDiariaJunio
                    puntos={puntosDiarios}
                    periodo={periodoApertura}
                    marca={marca}
                  />
                  <NotaScoresDiariosFuturos />
                  <QueSignificaCadaScore />
                  <LeyendaInterpretacion />
                  <MensajeEstrategico />
                </>
              )}

              {vista === "mensual" && (
                <>
                  <HeroScoreGerencialLegacy
                    filas={filas}
                    sgLegacyPorPeriodo={sgLegacyPorPeriodo}
                    marca={marca}
                  />
                  <HeroQuePaso
                    filas={filas}
                    sgLegacyPorPeriodo={sgLegacyPorPeriodo}
                  />
                  <Sparklines
                    filas={filas}
                    sgLegacyPorPeriodo={sgLegacyPorPeriodo}
                  />
                  <QueSignificaCadaScore />
                  <LeyendaInterpretacion />
                  <LecturaAutomatica filas={filas} />
                  <CausaRaizConsolidada filas={filas} />
                  {periodoApertura && (
                    <AperturaPorCargas
                      periodo={periodoApertura}
                      cargas={cargasPeriodo}
                      sgLegacyActual={sgLegacyPorPeriodo[periodoApertura]}
                      scoresActual={filas[filas.length - 1]}
                    />
                  )}
                  <MensajeEstrategico />
                </>
              )}

              <ColapsableTabla titulo="Detalle histórico — vista técnica">
                <TablaTecnica filas={filas} />
              </ColapsableTabla>
              <ColapsableTabla titulo="Calidad y confianza de datos">
                <CalidadDatos filas={filas} />
              </ColapsableTabla>
            </>
          )}
        </>
      )}
      <FooterDisclaimer />
    </main>
  );
}

// ────────────────────────────────────────────────────────────────────
// Header
// ────────────────────────────────────────────────────────────────────

function Header({
  filas,
  marca,
}: {
  filas: SnapshotFila[];
  marca: string | null;
}) {
  const primero = filas[0];
  const ultimo = filas[filas.length - 1];
  const rango =
    filas.length > 0
      ? `${nombrePeriodo(primero.periodo, null)} → ${nombrePeriodo(ultimo.periodo, null)}`
      : "Sin períodos disponibles";

  const ultimaConsolidacion = ultimo?.lastRecalculatedAt
    ? new Intl.DateTimeFormat("es-CL", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(ultimo.lastRecalculatedAt)
    : "—";

  return (
    <div className="mb-6">
      <PageHeader
        kicker="Histórico"
        kickerIcon={<TrendingUp className="size-3.5" />}
        title="Tendencias"
        description={
          <>
            Últimos {filas.length || 0} cierres mensuales disponibles{" "}
            <span className="text-[--color-fg-dim]">·</span>{" "}
            <span className="font-mono">{rango}</span>{" "}
            <span className="text-[--color-fg-dim]">·</span> última
            consolidación <span className="font-mono">{ultimaConsolidacion}</span>
          </>
        }
        actions={
          <div
            className={`text-[12px] px-3 py-1.5 rounded-md border ${
              marca
                ? "border-[--color-accent]/30 bg-[--color-accent-dim] text-[--color-accent]"
                : "border-[--color-border] bg-[--color-bg-elev-2] text-[--color-fg-muted]"
            }`}
          >
            {marca ? (
              <>
                Vista filtrada ·{" "}
                <span className="font-semibold">{marca}</span>
              </>
            ) : (
              <>Vista global · todas las marcas</>
            )}
          </div>
        }
      />
    </div>
  );
}

/**
 * Bloque contextual cuando hay marca activa: explica si la cobertura es alta,
 * si algún score quedó null por datos insuficientes de esa marca (caso típico
 * USADOS Capital), y deja constancia de que la fórmula no cambia, solo se
 * lee el sub-objeto `porMarca[marca]`.
 */
function ContextoMarca({
  marca,
  todosNull,
  filas,
}: {
  marca: string;
  todosNull: boolean;
  filas: SnapshotFila[];
}) {
  if (todosNull) {
    return (
      <div className="rounded-lg border border-[--color-warning]/30 bg-[--color-warning-dim] px-4 py-3 mb-6 text-[13px] text-[--color-warning]">
        Datos insuficientes para <span className="font-semibold">{marca}</span> en
        los {filas.length} períodos cargados. Los snapshots no contienen scores
        confiables para esta marca (puede ser un caso de definición pendiente
        como USADOS Capital, o una marca con cobertura mínima).
      </div>
    );
  }

  // Calcular cobertura promedio sobre los 3 scores y todos los períodos
  const ultimo = filas[filas.length - 1];
  const cobUlt = [
    ultimo.capitalGlobal?.pesoCubierto,
    ultimo.gerencialGlobal?.pesoCubierto,
    ultimo.velocidadGlobal?.pesoCubierto,
  ].filter((v): v is number => typeof v === "number");
  const cobMedia =
    cobUlt.length > 0
      ? Math.round(cobUlt.reduce((s, v) => s + v, 0) / cobUlt.length)
      : null;

  const scoresNullEnUltimo = [
    ultimo.scoreCapital,
    ultimo.scoreGerencial,
    ultimo.scoreVelocidad,
  ].filter((v) => v === null).length;

  return (
    <div className="rounded-lg border border-[--color-accent]/20 bg-[--color-accent-dim] px-4 py-3 mb-6 text-[13px] text-[--color-fg]">
      <span className="font-semibold">Vista filtrada por marca: {marca}.</span>{" "}
      Misma fórmula y umbrales que la vista global. Cobertura promedio del
      último período:{" "}
      <span className="font-mono font-semibold">{cobMedia ?? "—"}%</span>.
      {scoresNullEnUltimo > 0 && (
        <>
          {" "}
          <span className="text-[--color-warning]">
            ⚠ {scoresNullEnUltimo} score{scoresNullEnUltimo !== 1 ? "s" : ""} sin
            valor en el último período (datos insuficientes para esta marca).
          </span>
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Empty / warnings
// ────────────────────────────────────────────────────────────────────

function SinAcceso() {
  return (
    <main className="px-6 py-16 max-w-2xl mx-auto">
      <div className="surface bg-white p-8 text-center">
        <h1 className="text-[20px] font-semibold text-[--color-fg] mb-2">
          Acceso restringido
        </h1>
        <p className="text-[14px] text-[--color-fg-muted]">
          Esta vista está disponible solo para ADMIN, GERENTE_GENERAL y DIRECTOR.
        </p>
      </div>
    </main>
  );
}

function SinDatos() {
  return (
    <div className="surface bg-white p-8 mt-6 text-center">
      <p className="text-[14px] text-[--color-fg-muted]">
        Aún no hay snapshots históricos disponibles. La vista se llenará a
        medida que se consoliden cierres mensuales.
      </p>
    </div>
  );
}

function WarningCoberturaHistorica({ n }: { n: number }) {
  return (
    <div className="rounded-lg border border-[--color-warning]/30 bg-[--color-warning-dim] px-4 py-3 mb-6 text-[13px] text-[--color-warning]">
      Cobertura histórica insuficiente: {n} período{n !== 1 ? "s" : ""}{" "}
      disponible{n !== 1 ? "s" : ""} de 4 esperados.
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// 1 · HERO · ¿Qué pasó este período?
// ────────────────────────────────────────────────────────────────────

interface HeroCardProps {
  titulo: string;
  subtitulo: string;
  score: number | null;
  delta: number | null;
  causa: string | null;
  /** Texto a mostrar en lugar de la flecha cuando no hay comparable. */
  deltaTextoOverride?: string | null;
}

function HeroCard({
  titulo,
  subtitulo,
  score,
  delta,
  causa,
  deltaTextoOverride,
}: HeroCardProps) {
  const colorHex = zonaColorHex(score);
  const deltaText =
    deltaTextoOverride
      ? deltaTextoOverride
      : delta === null
        ? "—"
        : Math.abs(delta) < 2
          ? `→  ${delta > 0 ? "+" : ""}${delta}`
          : delta > 0
            ? `↑  +${delta}`
            : `↓  ${delta}`;
  const deltaColor =
    deltaTextoOverride
      ? "text-[--color-fg-muted] text-[12px] italic"
      : delta === null
        ? "text-[--color-fg-faint]"
        : Math.abs(delta) < 2
          ? "text-[--color-fg-muted]"
          : delta > 0
            ? "text-[--color-success]"
            : "text-[--color-danger]";

  return (
    <div className="surface bg-white p-5 flex flex-col gap-3 min-w-0">
      <div className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold">
        {titulo}
      </div>
      <div className="text-[12px] text-[--color-fg-muted] -mt-2">{subtitulo}</div>
      <div className="flex items-baseline gap-4 mt-1">
        <span
          className="text-[64px] leading-none font-semibold tracking-tight"
          style={{ color: colorHex }}
        >
          {score === null ? "—" : score}
        </span>
        <span className={`text-[20px] font-semibold leading-none ${deltaColor}`}>
          {deltaText}
        </span>
        {!deltaTextoOverride && (
          <span className="text-[11px] text-[--color-fg-dim] leading-none">vs N-1</span>
        )}
      </div>
      <div className="pt-2 border-t border-[--color-border-soft] mt-1">
        <div className="text-[10px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold">
          Causa
        </div>
        <div className="text-[14px] text-[--color-fg] mt-1 leading-snug">
          {score === null ? "Datos insuficientes" : causa ?? "—"}
        </div>
      </div>
    </div>
  );
}

function HeroQuePaso({
  filas,
  sgLegacyPorPeriodo,
}: {
  filas: SnapshotFila[];
  sgLegacyPorPeriodo: Record<string, ResultadoScoreGerencialHistorico>;
}) {
  const ultimo = filas[filas.length - 1];
  const previo = filas.length >= 2 ? filas[filas.length - 2] : null;
  const deltaSafe = (a: number | null, b: number | null) =>
    a === null || b === null ? null : a - b;

  const periodoLabel = nombrePeriodo(ultimo.periodo, ultimo);

  // Score Gerencial legacy: delta solo si AMBOS períodos son confiables.
  const sgUlt = sgLegacyPorPeriodo[ultimo.periodo];
  const sgPrev = previo ? sgLegacyPorPeriodo[previo.periodo] : null;
  const sgDelta =
    sgUlt?.esConfiable && sgPrev?.esConfiable && sgUlt.score !== null && sgPrev.score !== null
      ? sgUlt.score - sgPrev.score
      : null;
  const sgDeltaTexto =
    sgUlt?.esConfiable && !sgDelta && sgDelta !== 0
      ? "sin comparable confiable"
      : null;

  return (
    <section className="mb-8">
      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="text-[18px] font-semibold text-[--color-fg] tracking-tight">
          ¿Qué pasó este período?
        </h2>
        <span className="text-[13px] text-[--color-fg-muted]">
          {periodoLabel}
          {previo && (
            <>
              {" "}
              <span className="text-[--color-fg-dim]">vs</span>{" "}
              {nombrePeriodo(previo.periodo, previo)}
            </>
          )}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <HeroCard
          titulo="Score Gerencial"
          subtitulo="presión / higiene financiera (legacy)"
          score={sgUlt?.esConfiable ? sgUlt.score : null}
          delta={sgDelta}
          deltaTextoOverride={sgDeltaTexto}
          causa={sgUlt?.esConfiable ? sgUlt.causaRaizPrincipal : null}
        />
        <HeroCard
          titulo="Score Capital"
          subtitulo="presión financiera"
          score={ultimo.scoreCapital}
          delta={deltaSafe(ultimo.scoreCapital, previo?.scoreCapital ?? null)}
          causa={ultimo.capitalGlobal?.causaRaizPrincipal ?? null}
        />
        <HeroCard
          titulo="Score Cumplimiento Operacional"
          subtitulo="disciplina y ejecución operacional"
          score={ultimo.scoreGerencial}
          delta={deltaSafe(ultimo.scoreGerencial, previo?.scoreGerencial ?? null)}
          causa={ultimo.gerencialGlobal?.causaRaizPrincipal ?? null}
        />
        <HeroCard
          titulo="Score Velocidad"
          subtitulo="flujo / señal temprana"
          score={ultimo.scoreVelocidad}
          delta={deltaSafe(ultimo.scoreVelocidad, previo?.scoreVelocidad ?? null)}
          causa={ultimo.velocidadGlobal?.causaRaizPrincipal ?? null}
        />
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// 2 · SPARKLINES (SVG inline, sin librería)
// ────────────────────────────────────────────────────────────────────

interface SparklineProps {
  valores: (number | null)[];
  etiquetas: string[];
  ancho?: number;
  alto?: number;
}

function Sparkline({ valores, etiquetas, ancho = 360, alto = 110 }: SparklineProps) {
  const presentes = valores
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v !== null);
  if (presentes.length < 2) {
    return (
      <div className="text-[12px] text-[--color-fg-muted] italic px-2 py-6 text-center">
        Sin suficientes puntos para mostrar tendencia (mínimo 2 períodos).
      </div>
    );
  }

  const padX = 14;
  const padY = 16;
  const w = ancho - padX * 2;
  const h = alto - padY * 2;
  const todasVals = presentes.map((p) => p.v);
  // Anclar dominio entre 0 y 100 para que la escala sea comparable visualmente
  // pero ajustar si los valores son cercanos para no aplastar.
  const min = Math.min(0, Math.min(...todasVals) - 5);
  const max = Math.max(100, Math.max(...todasVals) + 5);
  const range = Math.max(1, max - min);

  const xPos = (i: number) =>
    padX + (valores.length === 1 ? w / 2 : (i / (valores.length - 1)) * w);
  const yPos = (v: number) => padY + h - ((v - min) / range) * h;

  const puntos = presentes.map((p) => ({
    x: xPos(p.i),
    y: yPos(p.v),
    val: p.v,
    label: etiquetas[p.i],
  }));

  const path = puntos
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  const ultimo = puntos[puntos.length - 1];
  const colorUlt = zonaColorHex(ultimo.val);

  // Línea horizontal de referencia (50)
  const y50 = yPos(50);

  return (
    <svg
      viewBox={`0 0 ${ancho} ${alto}`}
      className="w-full h-auto"
      preserveAspectRatio="none"
      aria-label="Tendencia"
    >
      {/* Referencia 50 */}
      <line
        x1={padX}
        x2={ancho - padX}
        y1={y50}
        y2={y50}
        stroke="#e1e5ee"
        strokeWidth={1}
        strokeDasharray="2 3"
      />
      <text
        x={ancho - padX}
        y={y50 - 3}
        fontSize={9}
        fill="#b4bcc7"
        textAnchor="end"
      >
        50
      </text>
      {/* Path principal */}
      <path
        d={path}
        fill="none"
        stroke={colorUlt}
        strokeWidth={2.2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Puntos + valores */}
      {puntos.map((p, i) => {
        const esUltimo = i === puntos.length - 1;
        return (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={esUltimo ? 4.5 : 3}
              fill={zonaColorHex(p.val)}
              stroke="#ffffff"
              strokeWidth={1.5}
            />
            <text
              x={p.x}
              y={p.y - 9}
              fontSize={10}
              fontWeight={esUltimo ? 700 : 500}
              fill={zonaColorHex(p.val)}
              textAnchor="middle"
            >
              {p.val}
            </text>
            <text
              x={p.x}
              y={alto - 3}
              fontSize={9}
              fill="#8b94a3"
              textAnchor="middle"
            >
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function SparklineCard({
  titulo,
  subtitulo,
  filas,
  scoreKey,
}: {
  titulo: string;
  subtitulo: string;
  filas: SnapshotFila[];
  scoreKey: ScoreKey;
}) {
  const valores = filas.map((f) => getScore(f, scoreKey));
  const etiquetas = filas.map((f) => {
    const m = parseInt(f.periodo.split("-")[1], 10);
    return MESES_ES[m - 1] ?? "?";
  });

  return (
    <div className="surface bg-white p-4">
      <div className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold">
        {titulo}
      </div>
      <div className="text-[12px] text-[--color-fg-muted] mt-0.5 mb-2">
        {subtitulo}
      </div>
      <Sparkline valores={valores} etiquetas={etiquetas} />
    </div>
  );
}

function Sparklines({
  filas,
  sgLegacyPorPeriodo,
}: {
  filas: SnapshotFila[];
  sgLegacyPorPeriodo: Record<string, ResultadoScoreGerencialHistorico>;
}) {
  // Puntos confiables del Score Gerencial legacy (sólo períodos con 4 fuentes).
  const sgPuntos = filas
    .map((f) => {
      const res = sgLegacyPorPeriodo[f.periodo];
      return res?.esConfiable && res.score !== null
        ? { periodo: f.periodo, score: res.score, fila: f }
        : null;
    })
    .filter((p): p is { periodo: string; score: number; fila: SnapshotFila } => p !== null);

  return (
    <section className="mb-8">
      <h2 className="text-[18px] font-semibold text-[--color-fg] tracking-tight mb-4">
        ¿Cómo evolucionó?
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SparklineSGLegacyCard puntos={sgPuntos} />
        <SparklineCard
          titulo="Score Capital"
          subtitulo="presión financiera"
          filas={filas}
          scoreKey="capital"
        />
        <SparklineCard
          titulo="Score Cumplimiento Operacional"
          subtitulo="disciplina y ejecución operacional"
          filas={filas}
          scoreKey="gerencial"
        />
        <SparklineCard
          titulo="Score Velocidad"
          subtitulo="flujo / señal temprana"
          filas={filas}
          scoreKey="velocidad"
        />
      </div>
    </section>
  );
}

/**
 * Tarjeta dedicada para Score Gerencial legacy.
 *
 * Política: sólo mostramos los puntos CONFIABLES (con las 4 fuentes). Si hay
 * < 2 puntos confiables NO dibujamos sparkline (sería engañoso) — mostramos
 * texto "Histórico insuficiente para tendencia" + score actual si existe.
 */
function SparklineSGLegacyCard({
  puntos,
}: {
  puntos: { periodo: string; score: number; fila: SnapshotFila }[];
}) {
  const tieneTendencia = puntos.length >= 2;
  const ultimoPunto = puntos.length > 0 ? puntos[puntos.length - 1] : null;
  const primerPunto = puntos.length > 0 ? puntos[0] : null;

  return (
    <div className="surface bg-white p-4">
      <div className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold">
        Score Gerencial · legacy
      </div>
      <div className="text-[12px] text-[--color-fg-muted] mt-0.5 mb-2">
        presión / higiene financiera
      </div>
      {tieneTendencia ? (
        <Sparkline
          valores={puntos.map((p) => p.score)}
          etiquetas={puntos.map((p) => {
            const m = parseInt(p.periodo.split("-")[1], 10);
            return MESES_ES[m - 1] ?? "?";
          })}
        />
      ) : ultimoPunto ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-[12px] text-neutral-800">
          <div className="font-bold mb-1.5 text-amber-900">
            Sin histórico mensual confiable antes de Junio.
          </div>
          <div className="text-neutral-700 leading-relaxed">
            Primer período confiable:{" "}
            <span className="font-bold">
              {nombrePeriodo(ultimoPunto.periodo, ultimoPunto.fila)}
            </span>{" "}
            con score{" "}
            <span
              className="font-bold"
              style={{ color: zonaColorHex(ultimoPunto.score) }}
            >
              {ultimoPunto.score}
            </span>
            .
          </div>
          <div className="text-[11px] text-neutral-600 mt-2 leading-relaxed">
            Los meses anteriores no tienen las 4 fuentes (BASE_STOCK + SALDOS +
            PROVISIONES + FNE) cargadas y por política no se inventan puntos
            mensuales. Capital, Cumplimiento y Velocidad sí tienen tendencia
            histórica (ver más abajo).
          </div>
          {primerPunto !== ultimoPunto && (
            <div className="text-[11px] text-[--color-fg-dim] mt-1.5 italic">
              Puntos disponibles: {puntos.length}.
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-[12px] text-neutral-800">
          <div className="font-bold mb-1 text-amber-900">
            Sin histórico mensual confiable.
          </div>
          <div className="text-neutral-700 leading-relaxed">
            Ningún cierre tiene las 4 fuentes cargadas (BASE_STOCK + SALDOS +
            PROVISIONES + FNE). El Score Gerencial legacy aparecerá apenas un
            período tenga cobertura completa.
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// 2.5 · ¿QUÉ SIGNIFICA CADA SCORE? (3 cards explicativas)
// ────────────────────────────────────────────────────────────────────

interface ExplicativaCardProps {
  icon: LucideIcon;
  iconColor: string;
  titulo: string;
  subtitulo: string;
  queMide: string;
  factores: string[];
  porQue: string;
  scoreBajo: string[];
  scoreAlto: string[];
  pregunta: string;
}

function ExplicativaCard(p: ExplicativaCardProps) {
  const Icon = p.icon;
  return (
    <div className="surface bg-white p-5 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div
          className="size-10 rounded-xl grid place-items-center shrink-0"
          style={{ background: `${p.iconColor}1a` }}
        >
          <Icon style={{ color: p.iconColor }} className="size-5" strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <div className="text-[12px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold">
            {p.titulo}
          </div>
          <div className="text-[12.5px] text-[--color-fg-muted] mt-0.5">
            {p.subtitulo}
          </div>
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold mb-1.5">
          ¿Qué mide?
        </div>
        <p className="text-[13px] text-[--color-fg] leading-relaxed mb-2">
          {p.queMide}
        </p>
        <ul className="text-[12.5px] text-[--color-fg-muted] space-y-0.5 ml-0.5">
          {p.factores.map((f) => (
            <li key={f}>· {f}</li>
          ))}
        </ul>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold mb-1.5">
          ¿Por qué lo medimos?
        </div>
        <p className="text-[13px] text-[--color-fg] leading-relaxed">{p.porQue}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="rounded-md border border-red-200 bg-red-50 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-red-700 font-semibold mb-1">
            Score bajo
          </div>
          <ul className="text-[11.5px] text-red-900/80 space-y-0.5">
            {p.scoreBajo.map((s) => (
              <li key={s}>· {s}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold mb-1">
            Score alto
          </div>
          <ul className="text-[11.5px] text-emerald-900/80 space-y-0.5">
            {p.scoreAlto.map((s) => (
              <li key={s}>· {s}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="pt-2 border-t border-[--color-border-soft]">
        <div className="text-[10px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold mb-1.5">
          Pregunta que responde
        </div>
        <p className="text-[13.5px] text-[--color-fg] italic leading-snug">
          &ldquo;{p.pregunta}&rdquo;
        </p>
      </div>
    </div>
  );
}

function QueSignificaCadaScore() {
  return (
    <section className="mb-8">
      <h2 className="text-[18px] font-semibold text-[--color-fg] tracking-tight mb-4">
        ¿Qué significa cada score?
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ExplicativaCard
          icon={ShieldAlert}
          iconColor="#dc2626"
          titulo="Score Gerencial · legacy"
          subtitulo="Presión / higiene financiera crítica"
          queMide="Mide la presión financiera crítica del gerente sobre las cuatro variables que históricamente más castigan la administración de capital en Pompeyo: stock propio, provisiones envejecidas, crédito Pompeyo vencido y saldos vehículo en tramos T3+."
          factores={[
            "Stock propio % (meta ≤ 5 %)",
            "Provisiones > 90 días (meta 0 casos)",
            "Crédito Pompeyo > 15 días (meta 0 casos)",
            "Saldos vehículo T3+ % (meta ≤ 15 %)",
          ]}
          porQue="Es la métrica legacy que ya está construida y refleja el dolor financiero concreto que el gerente puede gestionar directamente. No se reemplaza ni se combina con los otros scores."
          scoreBajo={[
            "Higiene financiera crítica",
            "Provisiones acumuladas sin facturar",
            "Capital propio sin rotación",
          ]}
          scoreAlto={[
            "Disciplina financiera consistente",
            "Capital limpio y rotando",
            "Sin atrasos en CP ni saldos",
          ]}
          pregunta="¿Qué tan limpia está la administración financiera crítica del gerente?"
        />
        <ExplicativaCard
          icon={Coins}
          iconColor="#15a87b"
          titulo="Score Capital"
          subtitulo="Presión financiera"
          queMide="Mide la presión financiera generada por el capital inmovilizado en la operación."
          factores={[
            "Capital atado",
            "Aging de stock",
            "Utilización de líneas",
            "Stock financiado vencido",
            "Riesgo financiero acumulado",
          ]}
          porQue="Porque cada peso inmovilizado es un peso que no se transforma en caja."
          scoreBajo={[
            "Más capital atrapado",
            "Más presión sobre caja",
            "Mayor riesgo financiero",
          ]}
          scoreAlto={[
            "Capital más saludable",
            "Menor presión financiera",
            "Mejor capacidad de crecimiento",
          ]}
          pregunta="¿Qué tan eficientemente estamos transformando capital en caja?"
        />
        <ExplicativaCard
          icon={ClipboardCheck}
          iconColor="#3358e8"
          titulo="Score Cumplimiento Operacional"
          subtitulo="Disciplina operacional"
          queMide="Mide el nivel de disciplina y cumplimiento de los procesos operacionales."
          factores={[
            "Alertas abiertas",
            "Casos vencidos",
            "Brechas operacionales",
            "Reincidencia",
            "Cumplimiento de hitos",
          ]}
          porQue="Porque una operación lenta normalmente comienza siendo una operación indisciplinada."
          scoreBajo={[
            "Procesos incumplidos",
            "Alertas acumuladas",
            "Mayor riesgo operacional",
          ]}
          scoreAlto={[
            "Ejecución consistente",
            "Menos excepciones",
            "Mejor control de la operación",
          ]}
          pregunta="¿Estamos ejecutando correctamente nuestros procesos?"
        />
        <ExplicativaCard
          icon={Gauge}
          iconColor="#d97706"
          titulo="Score Velocidad"
          subtitulo="Flujo operacional"
          queMide="Mide la velocidad con que los vehículos avanzan por el sistema."
          factores={[
            "Días en stock",
            "Días en FNE",
            "Tiempo entre hitos",
            "Tiempo de cierre",
            "Fluidez operacional",
          ]}
          porQue="Porque la velocidad operacional es el principal predictor futuro de la salud financiera."
          scoreBajo={[
            "Vehículos detenidos",
            "Procesos lentos",
            "Riesgo futuro para caja",
          ]}
          scoreAlto={[
            "Flujo rápido",
            "Menos fricción",
            "Mejor conversión de capital",
          ]}
          pregunta="¿Qué tan rápido estamos moviendo el inventario hacia la entrega y la generación de caja?"
        />
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// 2.6 · LEYENDA DE INTERPRETACIÓN (5 zonas)
// ────────────────────────────────────────────────────────────────────

function LeyendaInterpretacion() {
  const niveles = [
    {
      range: "80-100",
      label: "Excelente",
      classes: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    {
      range: "60-79",
      label: "Bueno",
      classes: "bg-lime-50 text-lime-700 border-lime-200",
    },
    {
      range: "40-59",
      label: "Atención",
      classes: "bg-amber-50 text-amber-700 border-amber-200",
    },
    {
      range: "20-39",
      label: "Riesgo",
      classes: "bg-orange-50 text-orange-700 border-orange-200",
    },
    {
      range: "0-19",
      label: "Crítico",
      classes: "bg-red-50 text-red-700 border-red-200",
    },
  ];

  return (
    <section className="mb-8">
      <div className="surface bg-white p-5">
        <div className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold mb-3">
          Cómo interpretar los scores
        </div>
        <div className="flex flex-wrap gap-2">
          {niveles.map((n) => (
            <div
              key={n.range}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border ${n.classes}`}
            >
              <span className="text-[12px] font-mono font-semibold">
                {n.range}
              </span>
              <span className="opacity-50">·</span>
              <span className="text-[12.5px] font-semibold">{n.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// 3 · LECTURA AUTOMÁTICA
// ────────────────────────────────────────────────────────────────────

/**
 * Genera narrativa ejecutiva para un score, combinando:
 *   · delta vs N-1 (mejora / deterioro / estable)
 *   · tendencia general (primero → último)
 *   · zona actual (saludable / atención / deteriorado / crítico)
 *   · causa raíz actual
 *
 * Lenguaje ejecutivo, declarativo. NO usa imperativos ni botones.
 */
function generarLectura(
  filas: SnapshotFila[],
  key: ScoreKey,
  naturaleza: string,
): string {
  const valores = filas
    .map((f) => getScore(f, key))
    .map((v) => v ?? null);
  const presentes = valores.filter((v): v is number => v !== null);
  if (presentes.length === 0)
    return "Sin datos suficientes para construir lectura ejecutiva.";

  const ultimo = filas[filas.length - 1];
  const ultimoScore = getScore(ultimo, key);
  if (ultimoScore === null)
    return "El último período no tiene score calculado. Lectura ejecutiva no aplicable.";

  const previo = filas.length >= 2 ? filas[filas.length - 2] : null;
  const previoScore = previo ? getScore(previo, key) : null;
  const delta = previoScore !== null ? ultimoScore - previoScore : null;
  const periodoUlt = nombrePeriodo(ultimo.periodo, ultimo);
  const periodoPrev = previo ? nombrePeriodo(previo.periodo, previo) : "—";

  // Tendencia general (primero → último)
  const primero = presentes[0];
  const deltaTotal = ultimoScore - primero;

  // Zona actual
  const zona =
    ultimoScore >= 80
      ? "zona saludable"
      : ultimoScore >= 60
        ? "zona de atención"
        : ultimoScore >= 40
          ? "zona deteriorada"
          : "zona crítica";

  // Frase de delta
  let fraseDelta = "";
  if (delta === null) {
    fraseDelta = `Primer período medido. Score ${ultimoScore}. `;
  } else if (delta >= 4) {
    fraseDelta = `Mejora de +${delta} puntos respecto a ${periodoPrev}. `;
  } else if (delta >= 2) {
    fraseDelta = `Mejora moderada de +${delta} puntos respecto a ${periodoPrev}. `;
  } else if (delta <= -10) {
    fraseDelta = `Deterioro fuerte de ${delta} puntos respecto a ${periodoPrev}. `;
  } else if (delta <= -4) {
    fraseDelta = `Deterioro importante de ${delta} puntos respecto a ${periodoPrev}. `;
  } else if (delta <= -2) {
    fraseDelta = `Deterioro leve de ${delta} puntos respecto a ${periodoPrev}. `;
  } else {
    fraseDelta = `Estable respecto a ${periodoPrev} (Δ ${delta > 0 ? "+" : ""}${delta}). `;
  }

  // Frase de zona / contexto
  let fraseZona = "";
  if (ultimoScore >= 80) {
    fraseZona = `${capitalizar(naturaleza)} se mantiene en ${zona}. `;
  } else if (ultimoScore >= 60) {
    fraseZona = `${capitalizar(naturaleza)} sigue en ${zona}. `;
  } else if (ultimoScore >= 40) {
    fraseZona = `${capitalizar(naturaleza)} continúa en ${zona}. `;
  } else {
    fraseZona = `${capitalizar(naturaleza)} permanece en ${zona}. `;
  }

  // Tendencia agregada
  let fraseTendencia = "";
  if (presentes.length >= 3) {
    if (delta !== null && delta > 0 && deltaTotal < 0) {
      fraseTendencia = `El deterioro acumulado en los meses anteriores comienza a estabilizarse. `;
    } else if (delta !== null && delta < 0 && deltaTotal < 0) {
      fraseTendencia = `Continúa la tendencia bajista vista desde ${nombrePeriodo(filas[0].periodo, null)}. `;
    } else if (delta !== null && delta > 0 && deltaTotal > 0) {
      fraseTendencia = `Se mantiene la mejora sostenida desde ${nombrePeriodo(filas[0].periodo, null)}. `;
    } else if (delta !== null && delta < 0 && deltaTotal > 0) {
      fraseTendencia = `Primer retroceso luego de meses de mejora. `;
    }
  }

  // Causa raíz
  const causa = getScoreObj(ultimo, key)?.causaRaizPrincipal ?? null;
  const fraseCausa = causa ? `Principal factor: ${causa}.` : "";

  void periodoUlt; // (futuro: dejar disponible para mensajes que lo requieran)
  return `${fraseDelta}${fraseZona}${fraseTendencia}${fraseCausa}`.trim();
}

function capitalizar(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function LecturaCard({
  titulo,
  subtitulo,
  texto,
}: {
  titulo: string;
  subtitulo: string;
  texto: string;
}) {
  return (
    <div className="surface bg-white p-5">
      <div className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold">
        {titulo}
      </div>
      <div className="text-[12px] text-[--color-fg-muted] mt-0.5 mb-3">
        {subtitulo}
      </div>
      <p className="text-[13.5px] text-[--color-fg] leading-relaxed">{texto}</p>
    </div>
  );
}

function LecturaAutomatica({ filas }: { filas: SnapshotFila[] }) {
  return (
    <section className="mb-8">
      <h2 className="text-[18px] font-semibold text-[--color-fg] tracking-tight mb-4">
        ¿Por qué pasó?
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <LecturaCard
          titulo="Capital"
          subtitulo="presión financiera"
          texto={generarLectura(filas, "capital", "la presión financiera")}
        />
        <LecturaCard
          titulo="Cumplimiento Operacional"
          subtitulo="disciplina y ejecución operacional"
          texto={generarLectura(filas, "gerencial", "la disciplina operacional")}
        />
        <LecturaCard
          titulo="Velocidad"
          subtitulo="flujo / señal temprana"
          texto={generarLectura(filas, "velocidad", "el flujo operacional")}
        />
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// 4 · CAUSA RAÍZ CONSOLIDADA
// ────────────────────────────────────────────────────────────────────

function CausaRaizConsolidada({ filas }: { filas: SnapshotFila[] }) {
  const ultimo = filas[filas.length - 1];
  const items: Array<{ score: string; causa: string }> = [
    {
      score: "Capital",
      causa:
        ultimo.capitalGlobal?.causaRaizPrincipal ??
        (ultimo.scoreCapital === null ? "Datos insuficientes" : "—"),
    },
    {
      score: "Cumplimiento Operacional",
      causa:
        ultimo.gerencialGlobal?.causaRaizPrincipal ??
        (ultimo.scoreGerencial === null ? "Datos insuficientes" : "—"),
    },
    {
      score: "Velocidad",
      causa:
        ultimo.velocidadGlobal?.causaRaizPrincipal ??
        (ultimo.scoreVelocidad === null ? "Datos insuficientes" : "—"),
    },
  ];

  return (
    <section className="mb-8">
      <h2 className="text-[13px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold mb-3">
        Causa raíz por score · período actual
      </h2>
      <div className="surface bg-white px-5 py-4">
        <ul className="divide-y divide-[--color-border-soft]">
          {items.map((it) => (
            <li
              key={it.score}
              className="flex items-baseline gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <span className="text-[13px] font-semibold text-[--color-fg] min-w-[200px]">
                {it.score}
              </span>
              <span className="text-[--color-fg-dim]">→</span>
              <span className="text-[13.5px] text-[--color-fg]">{it.causa}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Colapsable wrapper (usando <details>/<summary> nativo)
// ────────────────────────────────────────────────────────────────────

function ColapsableTabla({
  titulo,
  children,
  defaultOpen = false,
}: {
  titulo: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="surface bg-white mb-4 group overflow-hidden"
    >
      <summary className="cursor-pointer list-none flex items-center justify-between px-5 py-3 hover:bg-[--color-bg-elev-2] transition">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold">
          {titulo}
        </span>
        <ChevronDown
          className="size-4 text-[--color-fg-muted] transition group-open:rotate-180"
          strokeWidth={2}
        />
      </summary>
      <div className="px-5 pb-5 pt-2 border-t border-[--color-border-soft]">
        {children}
      </div>
    </details>
  );
}

// ────────────────────────────────────────────────────────────────────
// 5 · TABLA TÉCNICA (la tabla maestra de antes, ahora colapsable)
// ────────────────────────────────────────────────────────────────────

function ScoreCell({ score }: { score: number | null }) {
  return (
    <div
      className={`inline-flex items-center justify-center min-w-[44px] px-2 py-0.5 rounded font-semibold ${zonaBgClass(score)}`}
    >
      {score === null ? "—" : score}
    </div>
  );
}

function TablaTecnica({ filas }: { filas: SnapshotFila[] }) {
  function confianzaMasBaja(
    f: SnapshotFila,
  ): "alta" | "media" | "baja" | null {
    const cs = [
      f.capitalGlobal?.confianza,
      f.gerencialGlobal?.confianza,
      f.velocidadGlobal?.confianza,
    ];
    const orden: Array<"alta" | "media" | "baja" | null> = [
      "alta",
      "media",
      "baja",
      null,
    ];
    let peor: "alta" | "media" | "baja" | null = "alta";
    for (const c of cs) {
      const idxC = orden.indexOf(c ?? null);
      const idxPeor = orden.indexOf(peor);
      if (idxC > idxPeor) peor = c ?? null;
    }
    return peor;
  }

  function tendenciaCelda(act: number | null, prev: number | null): React.ReactNode {
    if (act === null || prev === null)
      return <span className="text-[--color-fg-faint]">—</span>;
    const d = act - prev;
    if (Math.abs(d) < 2) return <span className="text-[--color-fg-muted]">→</span>;
    if (d > 0) return <span className="text-[--color-success]">↑ +{d}</span>;
    return <span className="text-[--color-danger]">↓ {d}</span>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13.5px]">
        <thead className="text-[--color-fg-muted]">
          <tr className="text-left">
            <th className="px-3 py-2.5 font-medium">Período</th>
            <th className="px-3 py-2.5 font-medium text-center">Capital</th>
            <th className="px-3 py-2.5 font-medium text-center">
              Cumplimiento Op.
            </th>
            <th className="px-3 py-2.5 font-medium text-center">Velocidad</th>
            <th className="px-3 py-2.5 font-medium">Tendencia (Δ N-1)</th>
            <th className="px-3 py-2.5 font-medium">Confianza más baja</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => {
            const prev = i > 0 ? filas[i - 1] : null;
            return (
              <tr
                key={f.id}
                className="border-t border-[--color-border-soft]"
              >
                <td className="px-3 py-3 font-medium text-[--color-fg]">
                  {nombrePeriodo(f.periodo, f)}
                </td>
                <td className="px-3 py-3 text-center">
                  <ScoreCell score={f.scoreCapital} />
                </td>
                <td className="px-3 py-3 text-center">
                  <ScoreCell score={f.scoreGerencial} />
                </td>
                <td className="px-3 py-3 text-center">
                  <ScoreCell score={f.scoreVelocidad} />
                </td>
                <td className="px-3 py-3 text-[12.5px]">
                  {prev ? (
                    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>
                        Cap{" "}
                        {tendenciaCelda(f.scoreCapital, prev.scoreCapital)}
                      </span>
                      <span>
                        Cump{" "}
                        {tendenciaCelda(f.scoreGerencial, prev.scoreGerencial)}
                      </span>
                      <span>
                        Vel{" "}
                        {tendenciaCelda(f.scoreVelocidad, prev.scoreVelocidad)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[--color-fg-faint]">primer período</span>
                  )}
                </td>
                <td className="px-3 py-3 text-[12.5px] text-[--color-fg-muted]">
                  {(() => {
                    const c = confianzaMasBaja(f);
                    return c === null ? "datos insuficientes" : c;
                  })()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// 6 · CALIDAD / CONFIANZA DE DATOS (oculta por default)
// ────────────────────────────────────────────────────────────────────

function CalidadDatos({ filas }: { filas: SnapshotFila[] }) {
  function fuenteIcon(presente: boolean, viaParcial = false): string {
    if (presente) return viaParcial ? "△" : "✓";
    return "✗";
  }

  function fuentesParaPeriodo(f: SnapshotFila) {
    const warningsTexto = f.warnings.join(" | ");
    const saldosParcial =
      warningsTexto.includes("SALDOS") &&
      warningsTexto.includes("payload NO disponible");

    return {
      stock: f.fuentesUsadas.includes("BASE_STOCK"),
      saldos: f.fuentesUsadas.includes("SALDOS"),
      fne: f.fuentesUsadas.includes("FNE"),
      provisiones: f.fuentesUsadas.includes("PROVISIONES"),
      saldosParcial,
    };
  }

  const warningsAgregados = new Set<string>();
  for (const f of filas) {
    for (const w of f.warnings) {
      if (
        w.includes("Driver") ||
        w.includes("ausente") ||
        w.includes("payload NO disponible") ||
        w.includes("FNE ausente") ||
        w.includes("SALDOS ausentes") ||
        w.includes("PROVISIONES ausentes")
      ) {
        warningsAgregados.add(w);
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-[--color-fg-muted]">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Período</th>
              <th className="px-3 py-2 font-medium text-center">STOCK</th>
              <th className="px-3 py-2 font-medium text-center">SALDOS</th>
              <th className="px-3 py-2 font-medium text-center">FNE</th>
              <th className="px-3 py-2 font-medium text-center">PROV</th>
              <th className="px-3 py-2 font-medium">Drivers ausentes</th>
              <th className="px-3 py-2 font-medium text-right">SC</th>
              <th className="px-3 py-2 font-medium text-right">SCO</th>
              <th className="px-3 py-2 font-medium text-right">SV</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const fnt = fuentesParaPeriodo(f);
              const ausentes = [
                ...(f.capitalGlobal?.driversFaltantes ?? []),
                ...(f.gerencialGlobal?.driversFaltantes ?? []),
                ...(f.velocidadGlobal?.driversFaltantes ?? []),
              ];
              const ausentesUnicos = Array.from(new Set(ausentes));
              return (
                <tr key={f.id} className="border-t border-[--color-border-soft]">
                  <td className="px-3 py-2.5 font-medium text-[--color-fg]">
                    {nombrePeriodo(f.periodo, f)}
                  </td>
                  <td className="px-3 py-2.5 text-center text-[14px]">
                    {fuenteIcon(fnt.stock)}
                  </td>
                  <td className="px-3 py-2.5 text-center text-[14px]">
                    {fnt.saldos
                      ? fuenteIcon(true, fnt.saldosParcial)
                      : fuenteIcon(false)}
                  </td>
                  <td className="px-3 py-2.5 text-center text-[14px]">
                    {fuenteIcon(fnt.fne)}
                  </td>
                  <td className="px-3 py-2.5 text-center text-[14px]">
                    {fuenteIcon(fnt.provisiones)}
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-[--color-fg-muted]">
                    {ausentesUnicos.length === 0 ? "—" : ausentesUnicos.join(", ")}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[12px] text-[--color-fg-muted]">
                    {f.capitalGlobal?.pesoCubierto != null
                      ? `${f.capitalGlobal.pesoCubierto}%`
                      : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[12px] text-[--color-fg-muted]">
                    {f.gerencialGlobal?.pesoCubierto != null
                      ? `${f.gerencialGlobal.pesoCubierto}%`
                      : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[12px] text-[--color-fg-muted]">
                    {f.velocidadGlobal?.pesoCubierto != null
                      ? `${f.velocidadGlobal.pesoCubierto}%`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="text-[11px] text-[--color-fg-dim] mt-2">
          Leyenda · ✓ fuente con payload · △ cargada sin payload utilizable
          (warning re-subir) · ✗ ausente · SC Capital · SCO Cumplimiento Op. ·
          SV Velocidad
        </div>
      </div>

      {warningsAgregados.size > 0 && (
        <div className="rounded-md border border-[--color-border] bg-[--color-bg-elev-2] p-3">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold mb-2">
            Advertencias agregadas
          </div>
          <ul className="space-y-1 text-[12px] text-[--color-fg-muted]">
            {Array.from(warningsAgregados)
              .sort()
              .map((w) => (
                <li key={w} className="leading-relaxed">
                  ⚠ {w}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Footer
// ────────────────────────────────────────────────────────────────────

function FooterDisclaimer() {
  return (
    <div className="text-center text-[11px] text-[--color-fg-dim] mt-10 mb-4">
      Vista solo lectura · sin gestión por VIN · sin asignación de responsables
      · sin fechas compromiso · sin combinar los 3 scores en un valor único.
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// 0.3 · VISTA TABS · server-side (URL refleja la vista activa)
// ────────────────────────────────────────────────────────────────────

function VistaTabs({
  vistaActual,
  marca,
}: {
  vistaActual: "diaria" | "mensual";
  marca: string | null;
}) {
  function urlPara(v: "diaria" | "mensual"): string {
    const params = new URLSearchParams();
    if (v === "mensual") params.set("vista", "mensual");
    if (marca) params.set("marca", marca);
    const qs = params.toString();
    return qs ? `/tendencias?${qs}` : "/tendencias";
  }

  const Tab = ({
    v,
    titulo,
    subtitulo,
  }: {
    v: "diaria" | "mensual";
    titulo: string;
    subtitulo: string;
  }) => {
    const activa = vistaActual === v;
    return (
      <a
        href={urlPara(v)}
        className={`relative block rounded-lg border-2 px-5 py-3 transition ${
          activa
            ? "border-blue-600 bg-blue-600 shadow-md"
            : "border-neutral-200 bg-white hover:border-neutral-400 hover:bg-neutral-50"
        }`}
      >
        {activa && (
          <span className="absolute -top-1.5 left-3 inline-flex items-center gap-1 px-1.5 py-0.5 bg-white text-blue-700 text-[9px] uppercase tracking-[0.14em] font-bold rounded shadow-sm">
            Activo
          </span>
        )}
        <div
          className={`text-[14px] font-bold tracking-tight ${
            activa ? "text-white" : "text-neutral-900"
          }`}
        >
          {titulo}
        </div>
        <div
          className={`text-[11.5px] mt-0.5 ${
            activa ? "text-white/90" : "text-neutral-500"
          }`}
        >
          {subtitulo}
        </div>
      </a>
    );
  };

  return (
    <div className="flex flex-wrap gap-3 mb-6">
      <Tab
        v="diaria"
        titulo="Junio diario"
        subtitulo="evolución por carga del mes vivo"
      />
      <Tab
        v="mensual"
        titulo="Últimos 4 meses"
        subtitulo="comparación de cierres"
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// 0.4 · EVOLUCIÓN DIARIA · Score Gerencial legacy (Etapa A)
// ────────────────────────────────────────────────────────────────────

/** Formato corto "dd mmm" (sin año). */
function fmtCorto(d: Date): string {
  const day = d.getUTCDate().toString().padStart(2, "0");
  const m = MESES_CORTOS_TIMELINE[d.getUTCMonth()] ?? "?";
  return `${day} ${m}`;
}

const MESES_CORTOS_TIMELINE = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/** "Corte 04 jun" o "Corte 04 → 08 jun" según rango. */
function fmtRangoCorte(min: Date | null, max: Date | null): string {
  if (!min && !max) return "Corte: n/d";
  if (min && max && min.getTime() === max.getTime()) {
    return `Corte ${fmtCorto(min)}`;
  }
  if (min && max) {
    return `Corte ${fmtCorto(min)} → ${fmtCorto(max)}`;
  }
  return `Corte ${fmtCorto((min ?? max) as Date)}`;
}

function EvolucionDiariaJunio({
  puntos,
  periodo,
  marca,
}: {
  puntos: PuntoDiario[];
  periodo: string | null;
  marca: string | null;
}) {
  const periodoLabel = periodo
    ? `${MESES_ES[parseInt(periodo.split("-")[1], 10) - 1]} ${periodo.split("-")[0]}`
    : "—";

  return (
    <section className="mb-8">
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="text-[18px] font-semibold text-[--color-fg] tracking-tight">
          Evolución diaria · {periodoLabel}
        </h2>
        {marca && (
          <span className="text-[12px] text-[--color-fg-muted]">
            · filtrado por <span className="font-semibold">{marca}</span>
          </span>
        )}
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 mb-5 text-[12.5px] text-neutral-800 leading-relaxed">
        {periodoLabel} se muestra por día porque es un mes vivo. Cada hito
        muestra <span className="font-semibold">fecha de corte</span> del archivo
        y <span className="font-semibold">fecha de carga</span> al sistema.{" "}
        <span className="text-neutral-600">
          Política: sólo días con cargas reales; sin inventar puntos.
        </span>
      </div>

      {puntos.length === 0 ? (
        <div className="surface bg-white p-5 text-[13px] text-[--color-fg-muted]">
          Aún no hay cargas registradas para este período.
        </div>
      ) : (
        <>
          {/* Timeline horizontal de hitos · NO sparkline lineal */}
          <TimelineHitosSG puntos={puntos} />

          {/* Cards por día (detalle) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...puntos]
              .reverse()
              .map((p, idx) => (
                <CardDiaria key={p.dia} punto={p} esUltimo={idx === 0} />
              ))}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Timeline horizontal de hitos. Cada hito = 1 día de carga con su corte/score.
 * Pensada para 2-5 puntos. No es sparkline estadístico; es narrativa.
 */
function TimelineHitosSG({ puntos }: { puntos: PuntoDiario[] }) {
  const tienePuntos = puntos.length > 0;
  if (!tienePuntos) return null;

  // 1 punto → render simple, sin línea
  if (puntos.length === 1) {
    const p = puntos[0];
    return (
      <div className="surface bg-white p-5 mb-5">
        <div className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold mb-3">
          Score Gerencial · presión financiera crítica · evolución diaria
        </div>
        <div className="flex flex-col items-center gap-2 py-2">
          <HitoCircle punto={p} esUltimo />
          <div className="text-[12px] text-[--color-fg-muted] mt-2 italic">
            Primer hito disponible. Cuando se sume otra carga aparecerá un
            segundo hito y se verá la transición real.
          </div>
        </div>
      </div>
    );
  }

  // ≥ 2 puntos: timeline horizontal con conector
  return (
    <div className="surface bg-white p-5 mb-5">
      <div className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold mb-1">
        Score Gerencial · presión financiera crítica
      </div>
      <div className="text-[12px] text-[--color-fg-muted] mb-5">
        evolución diaria por hitos · {puntos.length} cargas
      </div>
      <div className="relative">
        {/* Línea horizontal conectora (más discreta que sparkline) */}
        <div
          className="absolute left-0 right-0 h-px bg-neutral-200"
          style={{ top: "1.75rem" }}
        />
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${puntos.length}, 1fr)` }}>
          {puntos.map((p, idx) => (
            <HitoCircle
              key={p.dia}
              punto={p}
              esUltimo={idx === puntos.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function HitoCircle({
  punto,
  esUltimo,
}: {
  punto: PuntoDiario;
  esUltimo: boolean;
}) {
  const { sgLegacy, fechaCorteMin, fechaCorteMax } = punto;
  const score = sgLegacy.esConfiable ? sgLegacy.score : null;
  const color = score !== null ? zonaColorHex(score) : "#a3a3a3";

  return (
    <div className="relative flex flex-col items-center">
      {/* Punto */}
      <div
        className="size-14 rounded-full grid place-items-center text-white font-bold text-[20px] shadow-md ring-4 ring-white relative z-10"
        style={{ background: color }}
      >
        {score !== null ? score : "—"}
      </div>
      {/* Fechas debajo */}
      <div className="mt-3 text-center">
        <div className="text-[11px] font-semibold text-neutral-700">
          {fmtRangoCorte(fechaCorteMin, fechaCorteMax)}
        </div>
        <div className="text-[11px] text-neutral-500 mt-0.5">
          Cargado {punto.diaLabel.slice(0, 6)}
        </div>
        {esUltimo && (
          <div className="text-[10px] uppercase tracking-wider text-blue-700 font-bold mt-1">
            última carga
          </div>
        )}
        {punto.deltaSG !== null && (
          <div
            className={`text-[11px] font-semibold mt-1 ${
              Math.abs(punto.deltaSG) < 2
                ? "text-neutral-500"
                : punto.deltaSG > 0
                  ? "text-emerald-700"
                  : "text-red-700"
            }`}
          >
            {punto.deltaSG > 0 ? "↑ +" : punto.deltaSG < 0 ? "↓ " : "→ "}
            {punto.deltaSG} vs hito previo
          </div>
        )}
      </div>
    </div>
  );
}

function CardDiaria({
  punto,
  esUltimo,
}: {
  punto: PuntoDiario;
  esUltimo: boolean;
}) {
  const { sgLegacy, deltaSG, diaLabel, cargasDelDia, fechaCorteMin, fechaCorteMax } = punto;
  const colorScore = zonaColorHex(sgLegacy.score);

  // Conjunto de fuentes que se subieron ese día
  const fuentesDelDia = Array.from(new Set(cargasDelDia.map((c) => c.fuente)));

  return (
    <div className="surface bg-white p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[--color-fg-dim] font-semibold">
            {fmtRangoCorte(fechaCorteMin, fechaCorteMax)}
          </div>
          <div className="text-[13px] font-semibold text-[--color-fg]">
            Cargado {diaLabel}
          </div>
          {esUltimo && (
            <div className="text-[10px] uppercase tracking-wider text-blue-700 font-bold mt-0.5">
              última carga
            </div>
          )}
        </div>
        <div className="text-right">
          {sgLegacy.esConfiable && sgLegacy.score !== null ? (
            <>
              <div
                className="text-[36px] font-bold leading-none tracking-tight"
                style={{ color: colorScore }}
              >
                {sgLegacy.score}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-[--color-fg-dim] mt-0.5">
                Score Ger.
              </div>
            </>
          ) : (
            <>
              <div className="text-[16px] font-semibold leading-none text-[--color-fg-muted]">
                —
              </div>
              <div className="text-[10px] uppercase tracking-wider text-[--color-fg-dim] mt-0.5">
                Datos insuf.
              </div>
            </>
          )}
        </div>
      </div>

      {/* Delta vs día anterior */}
      <div className="text-[12px]">
        {deltaSG !== null ? (
          <span
            className={
              Math.abs(deltaSG) < 2
                ? "text-[--color-fg-muted]"
                : deltaSG > 0
                  ? "text-[--color-success] font-semibold"
                  : "text-[--color-danger] font-semibold"
            }
          >
            {deltaSG > 0 ? "↑ +" : deltaSG < 0 ? "↓ " : "→ "}
            {deltaSG > 0 ? deltaSG : deltaSG}
            <span className="text-[--color-fg-muted] font-normal ml-1">
              vs día anterior
            </span>
          </span>
        ) : (
          <span className="text-[--color-fg-dim] italic">
            sin comparable confiable
          </span>
        )}
      </div>

      {/* Causa raíz */}
      {sgLegacy.esConfiable && sgLegacy.causaRaizPrincipal && (
        <div className="pt-2 border-t border-[--color-border-soft]">
          <div className="text-[10px] uppercase tracking-wider text-[--color-fg-dim] font-semibold">
            Causa raíz
          </div>
          <div className="text-[12.5px] text-[--color-fg] mt-0.5 leading-snug">
            {sgLegacy.causaRaizPrincipal}
          </div>
        </div>
      )}

      {/* Archivos cargados ese día */}
      <div className="pt-2 border-t border-[--color-border-soft]">
        <div className="text-[10px] uppercase tracking-wider text-[--color-fg-dim] font-semibold mb-1.5">
          Archivos cargados ({cargasDelDia.length})
        </div>
        <ul className="space-y-1">
          {cargasDelDia.map((c) => (
            <li
              key={c.id}
              className="text-[11.5px] text-[--color-fg-muted] leading-snug flex items-baseline gap-1.5"
            >
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[--color-bg-elev-2] text-[--color-fg-dim] font-semibold shrink-0">
                {c.fuente}
              </span>
              <span className="truncate">{c.nombreOriginal}</span>
            </li>
          ))}
        </ul>
        <div className="text-[10px] text-[--color-fg-dim] mt-1.5">
          Fuentes ese día: {fuentesDelDia.join(" · ")}
        </div>
      </div>

      {/* Confianza */}
      <div className="text-[11px] text-[--color-fg-dim]">
        Confianza:{" "}
        <span
          className={
            sgLegacy.esConfiable
              ? "text-[--color-success] font-semibold"
              : "text-[--color-warning] font-semibold"
          }
        >
          {sgLegacy.esConfiable
            ? "alta · 4 fuentes acumuladas hasta este día"
            : `incompleta · faltan ${sgLegacy.fuentesFaltantes.join(", ")}`}
        </span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// 0.45 · Nota sobre los otros 3 scores diarios (Etapa B futura)
// ────────────────────────────────────────────────────────────────────

function NotaScoresDiariosFuturos() {
  return (
    <section className="mb-8">
      <div className="rounded-xl border border-dashed border-[--color-border] bg-[--color-bg-elev-2] p-5">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold mb-2">
          Etapa futura · scores diarios complementarios
        </div>
        <p className="text-[13px] text-[--color-fg-muted] leading-relaxed">
          <span className="font-semibold text-[--color-fg]">
            Score Capital, Score Cumplimiento Operacional y Score Velocidad
          </span>{" "}
          por día están pendientes de persistencia. Hoy se computan a nivel
          mensual y se muestran en la vista{" "}
          <span className="font-mono">Últimos 4 meses</span>. Reconstruirlos por
          día requiere recálculo desde payloads o una nueva tabla
          <code className="font-mono text-[12px] mx-1 px-1 py-0.5 rounded bg-white border border-[--color-border]">
            SnapshotCargaScore
          </code>
          (fase futura, sin tocar schema todavía).
        </p>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// 0.5 · HERO SCORE GERENCIAL LEGACY (presión / higiene financiera)
//
// Mantiene el espíritu del Hero rojo de /score-gerencial pero embebido en
// /tendencias. NO combina con Capital/Cumplimiento/Velocidad. NO es promedio.
// ────────────────────────────────────────────────────────────────────

function HeroScoreGerencialLegacy({
  filas,
  sgLegacyPorPeriodo,
  marca,
}: {
  filas: SnapshotFila[];
  sgLegacyPorPeriodo: Record<string, ResultadoScoreGerencialHistorico>;
  marca: string | null;
}) {
  const ultimo = filas[filas.length - 1];
  const res = sgLegacyPorPeriodo[ultimo.periodo];

  // Estado visual del score legacy: 85+ bueno · 60+ riesgo · <60 crítico
  // (umbrales históricos del selector, ver score-gerencial.ts)
  const estado =
    res?.esConfiable && res.score !== null
      ? res.score >= 85
        ? "bueno"
        : res.score >= 60
          ? "riesgo"
          : "critico"
      : null;

  const gradiente =
    estado === "bueno"
      ? "linear-gradient(135deg, #047857 0%, #10b981 100%)"
      : estado === "riesgo"
        ? "linear-gradient(135deg, #b45309 0%, #d97706 100%)"
        : estado === "critico"
          ? "linear-gradient(135deg, #991b1b 0%, #dc2626 100%)"
          : "linear-gradient(135deg, #475569 0%, #64748b 100%)";

  return (
    <section className="mb-8">
      <div
        className="rounded-2xl text-white shadow-lg px-6 py-6 relative overflow-hidden"
        style={{ background: gradiente }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_280px] gap-6 items-center">
          {/* Score grande */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-85">
              Score Gerencial · presión financiera crítica
            </div>
            <div className="text-[12px] opacity-80 mt-0.5">
              fórmula legacy 40 / 40 / 10 / 10
              {marca && (
                <>
                  {" "}
                  ·{" "}
                  <span className="font-semibold">{marca}</span>
                </>
              )}
            </div>
            <div className="flex items-baseline gap-2 mt-3">
              <span className="text-[72px] font-bold tracking-tight leading-none mono">
                {res?.esConfiable && res.score !== null ? res.score : "—"}
              </span>
              <span className="text-[18px] font-semibold opacity-80">/ 100</span>
            </div>
            {estado && (
              <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/15 text-[11px] uppercase tracking-wider font-semibold">
                {estado === "bueno" ? "Bueno" : estado === "riesgo" ? "Atención" : "Crítico"}
              </div>
            )}
          </div>

          {/* Centro · estado */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-85 mb-1.5">
              Período · {nombrePeriodo(ultimo.periodo, ultimo)}
            </div>
            {res?.esConfiable ? (
              <>
                <p className="text-[13.5px] leading-relaxed opacity-90 max-w-xl">
                  {res.score !== null && res.score < 60 && (
                    <>
                      Presión financiera crítica concentrada en{" "}
                      <span className="font-semibold">{res.causaRaizPrincipal}</span>.
                    </>
                  )}
                  {res.score !== null && res.score >= 60 && res.score < 85 && (
                    <>
                      Presión financiera moderada · principal foco:{" "}
                      <span className="font-semibold">{res.causaRaizPrincipal}</span>.
                    </>
                  )}
                  {res.score !== null && res.score >= 85 && (
                    <>
                      Higiene financiera saludable · indicadores en meta.
                    </>
                  )}
                </p>
                <div className="text-[11px] opacity-75 mt-2">
                  Fuentes: {res.fuentesPresentes.join(" · ")} · {res.nVUs} VUs
                </div>
              </>
            ) : (
              <p className="text-[13px] opacity-90 leading-relaxed max-w-xl">
                Score Gerencial legacy no disponible para este período.
                Requiere las 4 fuentes (BASE_STOCK + SALDOS + PROVISIONES + FNE).
                {res?.fuentesFaltantes && res.fuentesFaltantes.length > 0 && (
                  <>
                    {" "}
                    <span className="font-semibold">
                      Faltan: {res.fuentesFaltantes.join(", ")}
                    </span>
                    .
                  </>
                )}
              </p>
            )}
          </div>

          {/* Derecha · indicadores legacy resumen */}
          <div className="space-y-1.5">
            {res?.esConfiable && res.indicadores ? (
              res.indicadores.map((ind) => (
                <div
                  key={ind.id}
                  className="flex items-center justify-between gap-3 text-[12px]"
                >
                  <span className="opacity-85 truncate">{ind.nombre}</span>
                  <span className="font-semibold tabular-nums">
                    {ind.puntos.toFixed(0)} / {ind.peso}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-[11px] opacity-70 italic">
                Sin desglose de indicadores
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// 3.5 · APERTURA POR CARGAS (timeline · sin scores intermedios)
// ────────────────────────────────────────────────────────────────────

interface CargaRow {
  id: string;
  fuente: string;
  nombreOriginal: string;
  prioridadCierre: number;
  esCierreMensual: boolean;
  createdAt: Date;
  parseStatus: string;
}

function AperturaPorCargas({
  periodo,
  cargas,
  sgLegacyActual,
  scoresActual,
}: {
  periodo: string;
  cargas: CargaRow[];
  sgLegacyActual: ResultadoScoreGerencialHistorico | undefined;
  scoresActual: SnapshotFila;
}) {
  const mes = parseInt(periodo.split("-")[1], 10);
  const mesNombre = MESES_ES[mes - 1] ?? "?";

  // Agrupar cargas por día para timeline ejecutiva
  const porDia = new Map<string, CargaRow[]>();
  for (const c of cargas) {
    const dia = c.createdAt.toISOString().slice(0, 10);
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia)!.push(c);
  }
  const dias = Array.from(porDia.keys()).sort().reverse();

  return (
    <section className="mb-8">
      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="text-[18px] font-semibold text-[--color-fg] tracking-tight">
          Apertura {mesNombre} {periodo.split("-")[0]} · evolución por carga
        </h2>
      </div>

      <div className="surface bg-white p-5 mb-4">
        <p className="text-[13px] text-[--color-fg] leading-relaxed">
          Esta sección muestra las cargas realizadas en{" "}
          <span className="font-semibold">
            {mesNombre} {periodo.split("-")[0]}
          </span>
          . Los scores por carga{" "}
          <span className="italic">no están persistidos todavía</span>; por
          ahora se muestra la trazabilidad de cargas y el score vigente de la
          última consolidación.
        </p>
      </div>

      {/* Resumen score vigente */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
        <div className="surface bg-white p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-[--color-fg-dim] font-semibold">
            Score Gerencial
          </div>
          <div
            className="text-[28px] font-bold tracking-tight mt-1 leading-none"
            style={{
              color: sgLegacyActual?.esConfiable && sgLegacyActual.score !== null
                ? zonaColorHex(sgLegacyActual.score)
                : "#8b94a3",
            }}
          >
            {sgLegacyActual?.esConfiable && sgLegacyActual.score !== null
              ? sgLegacyActual.score
              : "—"}
          </div>
          <div className="text-[10px] text-[--color-fg-muted] mt-1">vigente</div>
        </div>
        <div className="surface bg-white p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-[--color-fg-dim] font-semibold">
            Capital
          </div>
          <div
            className="text-[28px] font-bold tracking-tight mt-1 leading-none"
            style={{ color: zonaColorHex(scoresActual.scoreCapital) }}
          >
            {scoresActual.scoreCapital ?? "—"}
          </div>
          <div className="text-[10px] text-[--color-fg-muted] mt-1">vigente</div>
        </div>
        <div className="surface bg-white p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-[--color-fg-dim] font-semibold">
            Cumplimiento Op.
          </div>
          <div
            className="text-[28px] font-bold tracking-tight mt-1 leading-none"
            style={{ color: zonaColorHex(scoresActual.scoreGerencial) }}
          >
            {scoresActual.scoreGerencial ?? "—"}
          </div>
          <div className="text-[10px] text-[--color-fg-muted] mt-1">vigente</div>
        </div>
        <div className="surface bg-white p-3 text-center">
          <div className="text-[10px] uppercase tracking-wider text-[--color-fg-dim] font-semibold">
            Velocidad
          </div>
          <div
            className="text-[28px] font-bold tracking-tight mt-1 leading-none"
            style={{ color: zonaColorHex(scoresActual.scoreVelocidad) }}
          >
            {scoresActual.scoreVelocidad ?? "—"}
          </div>
          <div className="text-[10px] text-[--color-fg-muted] mt-1">vigente</div>
        </div>
      </div>

      {/* Timeline ejecutiva: día a día */}
      {cargas.length === 0 ? (
        <div className="surface bg-white p-5 text-[13px] text-[--color-fg-muted]">
          No hay cargas registradas para este período.
        </div>
      ) : (
        <div className="surface bg-white p-5">
          <div className="text-[11px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold mb-3">
            Línea de tiempo · {cargas.length} cargas en {dias.length} día(s)
          </div>
          <div className="space-y-4">
            {dias.map((dia, idx) => {
              const cargasDia = porDia.get(dia)!;
              const fechaLabel = new Intl.DateTimeFormat("es-CL", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              }).format(new Date(dia));
              return (
                <div key={dia} className="flex gap-3">
                  <div className="flex flex-col items-center shrink-0 pt-1">
                    <div
                      className={`size-2.5 rounded-full ${idx === 0 ? "bg-[--color-accent]" : "bg-[--color-fg-dim]"}`}
                    />
                    {idx < dias.length - 1 && (
                      <div className="w-px flex-1 bg-[--color-border] mt-1" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 pb-2">
                    <div className="text-[12.5px] font-semibold text-[--color-fg]">
                      {fechaLabel}
                      {idx === 0 && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-[--color-accent] font-semibold">
                          última carga
                        </span>
                      )}
                    </div>
                    <ul className="mt-1 space-y-1">
                      {cargasDia
                        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                        .map((c) => (
                          <li
                            key={c.id}
                            className="text-[12px] text-[--color-fg-muted] leading-relaxed"
                          >
                            <span className="font-mono text-[--color-fg-dim]">
                              {new Intl.DateTimeFormat("es-CL", {
                                hour: "2-digit",
                                minute: "2-digit",
                              }).format(c.createdAt)}
                            </span>{" "}
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[--color-bg-elev-2] text-[--color-fg-dim] font-semibold">
                              {c.fuente}
                            </span>{" "}
                            <span className="text-[--color-fg]">{c.nombreOriginal}</span>
                            {c.esCierreMensual && (
                              <span className="ml-1.5 text-[10px] uppercase tracking-wider text-[--color-success] font-semibold">
                                · cierre
                              </span>
                            )}
                          </li>
                        ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tabla técnica colapsable */}
      <ColapsableTabla titulo="Tabla técnica · cargas detalladas">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="text-[--color-fg-muted]">
              <tr className="text-left">
                <th className="px-2 py-2 font-medium">Fecha · hora</th>
                <th className="px-2 py-2 font-medium">Fuente</th>
                <th className="px-2 py-2 font-medium">Archivo</th>
                <th className="px-2 py-2 font-medium text-right">Prioridad</th>
                <th className="px-2 py-2 font-medium">Tipo</th>
                <th className="px-2 py-2 font-medium">Parse</th>
              </tr>
            </thead>
            <tbody>
              {cargas.map((c) => (
                <tr key={c.id} className="border-t border-[--color-border-soft]">
                  <td className="px-2 py-2 font-mono text-[--color-fg-muted]">
                    {new Intl.DateTimeFormat("es-CL", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(c.createdAt)}
                  </td>
                  <td className="px-2 py-2">
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[--color-bg-elev-2] text-[--color-fg-dim] font-semibold">
                      {c.fuente}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-[--color-fg] truncate max-w-[400px]">
                    {c.nombreOriginal}
                  </td>
                  <td className="px-2 py-2 text-right font-mono">
                    {c.prioridadCierre}
                  </td>
                  <td className="px-2 py-2 text-[--color-fg-muted]">
                    {c.esCierreMensual ? "cierre" : "intermedio"}
                  </td>
                  <td className="px-2 py-2 text-[--color-fg-muted]">
                    {c.parseStatus}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] text-[--color-fg-dim] mt-3 italic">
          Limitación actual: los scores intermedios entre cargas no se persisten.
          Fase futura: tabla `SnapshotCargaScore` con scoreGerencialLegacy +
          Capital + Cumplimiento + Velocidad por cada carga (requiere cambio de
          schema).
        </div>
      </ColapsableTabla>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// 4.5 · MENSAJE ESTRATÉGICO FINAL
// ────────────────────────────────────────────────────────────────────

function MensajeEstrategico() {
  return (
    <section className="mb-6">
      <div className="rounded-xl border border-[--color-accent]/20 bg-[--color-accent-dim] p-6 text-center">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[--color-accent] font-semibold mb-2">
          Marco estratégico
        </div>
        <p className="text-[14px] text-[--color-fg] leading-relaxed max-w-2xl mx-auto">
          El objetivo no es maximizar un score aislado. El objetivo es mejorar
          simultáneamente <span className="font-semibold">Capital</span>,{" "}
          <span className="font-semibold">Cumplimiento Operacional</span> y{" "}
          <span className="font-semibold">Velocidad</span> para construir una
          operación financieramente sana, disciplinada y rápida.
        </p>
      </div>
    </section>
  );
}
