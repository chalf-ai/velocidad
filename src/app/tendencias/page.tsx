/**
 * /tendencias — Evolución del capital de trabajo por FECHA DE CORTE.
 *
 * Rediseño completo (decisión usuario 2026-06): la pantalla ya NO se
 * construye alrededor de scores. La unidad básica de análisis es una fecha
 * de corte real (una carga en la base). El gerente debe responder en <15s:
 * ¿vamos mejor o peor? · ¿qué baja? · ¿qué sube? · ¿dónde está atrapado el
 * capital? · ¿qué cambió entre cortes?
 *
 * Indicadores (siempre unidades + monto + Δ vs corte anterior):
 *   1. Score Gerencial (línea 0-100 — un indicador más, no el centro)
 *   2. Stock Pagado          ← BASE_STOCK
 *   3. Saldos (vehículo)     ← SALDOS
 *   4. Bonos y Comisiones    ← SALDOS
 *   5. Provisiones (ventas)  ← PROVISIONES
 *
 * Reglas duras:
 *   · Solo fechas reales con cargas. Sin interpolación. Sin días inventados.
 *   · Prioridad 1: el mes actual corte a corte. Prioridad 2: tendencia
 *     mensual de largo plazo (último corte de cada mes).
 *   · El resumen "qué cambió" se calcula automáticamente del último corte
 *     vs el anterior.
 */

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  LineChart,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtCLPCompact, fmtNum } from "@/lib/format";
import {
  calcularSGLegacyPorDia,
  type PuntoDiario,
} from "@/lib/historico/calcular-scores-por-dia";
import type { ComponenteCapital } from "@/lib/historico/capital-por-corte";
import {
  GraficoIndicador,
  GraficoScore,
  LeyendaIndicador,
  type PuntoIndicador,
  type PuntoScore,
} from "@/components/tendencias/GraficosCapital";
import { MarcaUrlSync } from "./MarcaUrlSync";

export const dynamic = "force-dynamic";

const ROLES_PERMITIDOS = new Set(["ADMIN", "GERENTE_GENERAL", "DIRECTOR"]);

const MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/** "2026-06-07" → "07-jun" (label de corte). */
function labelCorte(dia: string): string {
  const [, m, d] = dia.split("-");
  return `${d}-${MESES[parseInt(m, 10) - 1] ?? "?"}`;
}

/** "2026-06" → "jun 2026". */
function labelPeriodo(periodo: string): string {
  const [y, m] = periodo.split("-");
  return `${MESES[parseInt(m, 10) - 1] ?? "?"} ${y}`;
}

// ────────────────────────────────────────────────────────────────────
// Indicadores · definición única
// ────────────────────────────────────────────────────────────────────

type IndicadorKey = "stockPagado" | "saldosVehiculo" | "bonos" | "provisiones";

const INDICADORES: { key: IndicadorKey; nombre: string; descripcion: string }[] = [
  { key: "stockPagado", nombre: "Stock Pagado", descripcion: "autos pagados con caja propia, sin rotar" },
  { key: "saldosVehiculo", nombre: "Saldos", descripcion: "saldos de vehículo por documentar" },
  { key: "bonos", nombre: "Bonos y Comisiones", descripcion: "bonos / comisiones por cobrar" },
  { key: "provisiones", nombre: "Provisiones", descripcion: "provisiones de ventas con saldo abierto" },
];

function comp(p: PuntoDiario, key: IndicadorKey): ComponenteCapital | null {
  return p.capital[key];
}

// ────────────────────────────────────────────────────────────────────
// Resumen automático · qué cambió entre los dos últimos cortes
// ────────────────────────────────────────────────────────────────────

interface LineaCambio {
  texto: string;
  /** baja capital atrapado o mejora score = bueno. */
  bueno: boolean;
  direccion: "sube" | "baja" | "igual";
}

function lineasDeCambio(prev: PuntoDiario, act: PuntoDiario): LineaCambio[] {
  const lineas: LineaCambio[] = [];

  for (const ind of INDICADORES) {
    const a = comp(prev, ind.key);
    const b = comp(act, ind.key);
    if (!a || !b) continue;

    const dU = b.unidades - a.unidades;
    if (dU !== 0) {
      lineas.push({
        texto: `${ind.nombre} ${dU < 0 ? "baja" : "sube"} ${fmtNum(Math.abs(dU))} unidades`,
        bueno: dU < 0,
        direccion: dU < 0 ? "baja" : "sube",
      });
    }
    const dM = b.monto - a.monto;
    if (Math.round(dM) !== 0) {
      lineas.push({
        texto: `${ind.nombre} ${dM < 0 ? "baja" : "sube"} ${fmtCLPCompact(Math.abs(dM))}`,
        bueno: dM < 0,
        direccion: dM < 0 ? "baja" : "sube",
      });
    }
    if (dU === 0 && Math.round(dM) === 0) {
      lineas.push({ texto: `${ind.nombre} sin cambios`, bueno: true, direccion: "igual" });
    }
  }

  const sPrev = prev.sgLegacy.score;
  const sAct = act.sgLegacy.score;
  if (sPrev !== null && sAct !== null) {
    const d = sAct - sPrev;
    lineas.push(
      d === 0
        ? { texto: "Score Gerencial sin cambios", bueno: true, direccion: "igual" }
        : {
            texto: `Score Gerencial ${d > 0 ? "mejora" : "empeora"} ${Math.abs(d)} puntos`,
            bueno: d > 0,
            direccion: d > 0 ? "sube" : "baja",
          },
    );
  }
  return lineas;
}

/** Δ total de capital atrapado entre dos cortes (solo componentes presentes en ambos). */
function deltaCapitalTotal(prev: PuntoDiario, act: PuntoDiario): number | null {
  let delta = 0;
  let alguno = false;
  for (const ind of INDICADORES) {
    const a = comp(prev, ind.key);
    const b = comp(act, ind.key);
    if (!a || !b) continue;
    delta += b.monto - a.monto;
    alguno = true;
  }
  return alguno ? delta : null;
}

// ────────────────────────────────────────────────────────────────────
// Página
// ────────────────────────────────────────────────────────────────────

export default async function TendenciasPage({
  searchParams,
}: {
  searchParams: Promise<{ marca?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!ROLES_PERMITIDOS.has(session.user.rol)) {
    return (
      <EstadoVacio
        titulo="Sin acceso"
        detalle="Esta vista es para ADMIN, GERENTE_GENERAL y DIRECTOR."
      />
    );
  }

  const params = await searchParams;
  const marca = params.marca && params.marca.trim() !== "" ? params.marca : null;

  // Períodos con cargas reales. Si la tabla histórica no existe en esta DB
  // (migrate deploy pendiente), mostrar estado controlado — no botar la página.
  let periodos: string[];
  try {
    const rows = await prisma.snapshotHistoricoArchivo.findMany({
      distinct: ["snapshotPeriod"],
      select: { snapshotPeriod: true },
      orderBy: { snapshotPeriod: "asc" },
    });
    periodos = rows.map((r) => r.snapshotPeriod);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "P2021" || code === "P2022") {
      return (
        <EstadoVacio
          titulo="Histórico no inicializado"
          detalle="La base de esta instancia aún no tiene el motor histórico aplicado (migraciones pendientes)."
        />
      );
    }
    throw e;
  }

  if (periodos.length === 0) {
    return (
      <EstadoVacio
        titulo="Sin cargas históricas"
        detalle="Todavía no hay snapshots registrados. Las tendencias aparecen solas con las próximas cargas de Excel."
      />
    );
  }

  // Prioridad 1 · el período más reciente, corte a corte.
  const periodoActual = periodos[periodos.length - 1];
  const puntos = await calcularSGLegacyPorDia({ snapshotPeriod: periodoActual, marca });

  // Prioridad 2 · largo plazo: último corte real de cada período (máx 6).
  const periodosLargo = periodos.slice(-6);
  const cierresMensuales: { periodo: string; punto: PuntoDiario }[] = [];
  for (const periodo of periodosLargo) {
    const pts =
      periodo === periodoActual
        ? puntos
        : await calcularSGLegacyPorDia({ snapshotPeriod: periodo, marca });
    if (pts.length > 0) cierresMensuales.push({ periodo, punto: pts[pts.length - 1] });
  }

  // Series para los gráficos del mes (solo cortes reales).
  const serieIndicador = (key: IndicadorKey): PuntoIndicador[] =>
    puntos.map((p) => ({
      corte: labelCorte(p.dia),
      unidades: comp(p, key)?.unidades ?? null,
      monto: comp(p, key)?.monto ?? null,
    }));
  const serieScore: PuntoScore[] = puntos.map((p) => ({
    corte: labelCorte(p.dia),
    score: p.sgLegacy.score,
  }));

  // Series mensuales (largo plazo).
  const serieIndicadorMensual = (key: IndicadorKey): PuntoIndicador[] =>
    cierresMensuales.map(({ periodo, punto }) => ({
      corte: labelPeriodo(periodo),
      unidades: comp(punto, key)?.unidades ?? null,
      monto: comp(punto, key)?.monto ?? null,
    }));
  const serieScoreMensual: PuntoScore[] = cierresMensuales.map(({ periodo, punto }) => ({
    corte: labelPeriodo(periodo),
    score: punto.sgLegacy.score,
  }));

  // Resumen automático: último corte vs anterior.
  const ultimo = puntos.length > 0 ? puntos[puntos.length - 1] : null;
  const anterior = puntos.length > 1 ? puntos[puntos.length - 2] : null;
  const cambios = ultimo && anterior ? lineasDeCambio(anterior, ultimo) : [];
  const deltaTotal = ultimo && anterior ? deltaCapitalTotal(anterior, ultimo) : null;

  const verdict =
    deltaTotal === null
      ? null
      : deltaTotal < 0
        ? {
            texto: `Liberando capital · ${fmtCLPCompact(Math.abs(deltaTotal))} menos atrapado`,
            bueno: true,
          }
        : deltaTotal > 0
          ? {
              texto: `Acumulando capital · ${fmtCLPCompact(deltaTotal)} más atrapado`,
              bueno: false,
            }
          : { texto: "Capital atrapado sin variación", bueno: true };

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-5 fade-in">
      <MarcaUrlSync marcaFromUrl={marca} />

      {/* ── Hero · veredicto + línea de cortes ─────────────────────── */}
      <section
        className={cn(
          "surface bg-white top-strip p-5",
          verdict === null ? "strip-info" : verdict.bueno ? "strip-success" : "strip-danger",
        )}
      >
        <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold">
          <LineChart className="size-3.5" strokeWidth={2} />
          Tendencias · capital de trabajo
        </div>
        <h1 className="text-[24px] font-semibold tracking-tight mt-1.5 leading-tight text-[--color-fg]">
          Cómo evoluciona el capital, corte a corte
        </h1>
        <p className="text-[13px] text-[--color-fg-muted] mt-1.5 max-w-3xl leading-snug">
          Cada punto es una carga real{marca ? ` · marca ${marca}` : ""}. Sin interpolación: si
          una fecha no existe en la base, no existe acá.
        </p>

        {/* Veredicto en una línea */}
        {verdict && ultimo && anterior ? (
          <div
            className={cn(
              "mt-3.5 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13.5px] font-semibold",
              verdict.bueno ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800",
            )}
          >
            {verdict.bueno ? (
              <ArrowDownRight className="size-4" />
            ) : (
              <ArrowUpRight className="size-4" />
            )}
            {verdict.texto}
            <span className="font-normal text-[12px] opacity-75">
              · {labelCorte(ultimo.dia)} vs {labelCorte(anterior.dia)}
            </span>
          </div>
        ) : (
          <div className="mt-3.5 inline-flex items-center gap-2 rounded-lg bg-[--color-bg-elev-2] px-3 py-2 text-[12.5px] text-[--color-fg-muted]">
            <Minus className="size-4" />
            Se necesita más de un corte en {labelPeriodo(periodoActual)} para comparar.
          </div>
        )}

        {/* Timeline de cortes reales */}
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[10.5px] uppercase tracking-wide text-[--color-fg-dim] font-semibold">
            <CalendarDays className="size-3.5" /> Cortes de {labelPeriodo(periodoActual)}
          </span>
          {puntos.map((p, i) => (
            <span
              key={p.dia}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11.5px] font-semibold mono",
                i === puntos.length - 1
                  ? "bg-[color:var(--color-accent)] text-white"
                  : "bg-[--color-bg-elev-2] text-[--color-fg-muted]",
              )}
            >
              {labelCorte(p.dia)}
            </span>
          ))}
        </div>
      </section>

      {/* ── Qué cambió · resumen automático ────────────────────────── */}
      {cambios.length > 0 && ultimo && anterior && (
        <section className="surface bg-white p-5">
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold">
            Qué cambió · {labelCorte(ultimo.dia)} vs {labelCorte(anterior.dia)}
          </div>
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
            {cambios.map((c) => (
              <li key={c.texto} className="flex items-center gap-2 text-[13px]">
                {c.direccion === "igual" ? (
                  <Minus className="size-3.5 text-[--color-fg-dim] shrink-0" />
                ) : c.direccion === "baja" ? (
                  <ArrowDownRight
                    className={cn(
                      "size-3.5 shrink-0",
                      c.bueno ? "text-emerald-600" : "text-red-600",
                    )}
                  />
                ) : (
                  <ArrowUpRight
                    className={cn(
                      "size-3.5 shrink-0",
                      c.bueno ? "text-emerald-600" : "text-red-600",
                    )}
                  />
                )}
                <span
                  className={cn(
                    c.direccion === "igual"
                      ? "text-[--color-fg-muted]"
                      : c.bueno
                        ? "text-emerald-800"
                        : "text-red-800",
                  )}
                >
                  {c.texto}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Prioridad 1 · el mes corte a corte ─────────────────────── */}
      <SeccionTitulo
        titulo={`${labelPeriodo(periodoActual)} · corte a corte`}
        detalle={`${puntos.length} ${puntos.length === 1 ? "corte real" : "cortes reales"}`}
      />

      <CardScore
        puntos={serieScore}
        actual={ultimo?.sgLegacy.score ?? null}
        delta={ultimo?.deltaSG ?? null}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {INDICADORES.map((ind) => (
          <CardIndicador
            key={ind.key}
            nombre={ind.nombre}
            descripcion={ind.descripcion}
            serie={serieIndicador(ind.key)}
            actual={ultimo ? comp(ultimo, ind.key) : null}
            previo={anterior ? comp(anterior, ind.key) : null}
            notaMarca={
              ind.key === "bonos" && marca
                ? "No atribuible por marca — quita el filtro para ver bonos."
                : null
            }
          />
        ))}
      </div>

      {/* ── Prioridad 2 · largo plazo mensual ──────────────────────── */}
      {cierresMensuales.length >= 2 && (
        <>
          <SeccionTitulo
            titulo="Tendencia de largo plazo"
            detalle={`último corte real de cada mes · ${cierresMensuales
              .map((c) => labelPeriodo(c.periodo))
              .join(" → ")}`}
          />
          <CardScore puntos={serieScoreMensual} actual={null} delta={null} compacto />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {INDICADORES.map((ind) => (
              <CardIndicador
                key={`m-${ind.key}`}
                nombre={ind.nombre}
                descripcion="cierre mensual"
                serie={serieIndicadorMensual(ind.key)}
                actual={null}
                previo={null}
                notaMarca={ind.key === "bonos" && marca ? "No atribuible por marca." : null}
              />
            ))}
          </div>
        </>
      )}

      <p className="text-[11.5px] text-[--color-fg-dim] pb-2">
        Cada punto corresponde a un snapshot real cargado en la base. Los huecos en una línea
        significan que esa fuente no se cargó en ese corte — no se interpola ni se inventa.
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Piezas de UI (server)
// ────────────────────────────────────────────────────────────────────

function SeccionTitulo({ titulo, detalle }: { titulo: string; detalle?: string }) {
  return (
    <div className="flex items-baseline gap-3 pt-2 flex-wrap">
      <h2 className="text-[16px] font-semibold text-[--color-fg]">{titulo}</h2>
      {detalle && <span className="text-[12px] text-[--color-fg-muted]">{detalle}</span>}
    </div>
  );
}

function DeltaChip({ delta, formato }: { delta: number; formato: "num" | "clp" }) {
  // Para componentes de capital: bajar = liberar capital = bueno.
  const bueno = delta < 0;
  const txt = formato === "clp" ? fmtCLPCompact(Math.abs(delta)) : fmtNum(Math.abs(delta));
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
        delta === 0
          ? "bg-[--color-bg-elev-2] text-[--color-fg-muted]"
          : bueno
            ? "bg-emerald-50 text-emerald-700"
            : "bg-red-50 text-red-700",
      )}
    >
      {delta === 0 ? (
        <Minus className="size-3" />
      ) : delta < 0 ? (
        <ArrowDownRight className="size-3" />
      ) : (
        <ArrowUpRight className="size-3" />
      )}
      {txt}
    </span>
  );
}

function CardScore({
  puntos,
  actual,
  delta,
  compacto,
}: {
  puntos: PuntoScore[];
  actual: number | null;
  delta: number | null;
  compacto?: boolean;
}) {
  return (
    <section className="surface bg-white p-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <div>
          <div className="text-[13.5px] font-semibold text-[--color-fg]">Score Gerencial</div>
          {!compacto && (
            <div className="text-[11.5px] text-[--color-fg-muted]">
              salud gerencial del capital · 0 a 100
            </div>
          )}
        </div>
        {actual !== null && (
          <div className="flex items-center gap-2">
            <span className="display text-[26px] leading-none text-[--color-fg]">{actual}</span>
            {delta !== null && delta !== 0 && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                  delta > 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
                )}
              >
                {delta > 0 ? (
                  <ArrowUpRight className="size-3" />
                ) : (
                  <ArrowDownRight className="size-3" />
                )}
                {Math.abs(delta)} pts
              </span>
            )}
          </div>
        )}
      </div>
      <GraficoScore puntos={puntos} />
    </section>
  );
}

function CardIndicador({
  nombre,
  descripcion,
  serie,
  actual,
  previo,
  notaMarca,
}: {
  nombre: string;
  descripcion: string;
  serie: PuntoIndicador[];
  actual: ComponenteCapital | null;
  previo: ComponenteCapital | null;
  notaMarca: string | null;
}) {
  const sinDatos = serie.every((p) => p.unidades === null && p.monto === null);
  return (
    <section className="surface bg-white p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <div className="text-[13.5px] font-semibold text-[--color-fg]">{nombre}</div>
          <div className="text-[11.5px] text-[--color-fg-muted]">{descripcion}</div>
        </div>
        {actual && (
          <div className="text-right">
            <div className="flex items-center justify-end gap-1.5">
              <span className="display text-[20px] leading-none text-[--color-fg]">
                {fmtNum(actual.unidades)}
              </span>
              <span className="text-[11px] text-[--color-fg-muted]">u.</span>
              {previo && <DeltaChip delta={actual.unidades - previo.unidades} formato="num" />}
            </div>
            <div className="flex items-center justify-end gap-1.5 mt-0.5">
              <span className="mono text-[13px] text-[--color-fg-muted]">
                {fmtCLPCompact(actual.monto)}
              </span>
              {previo && <DeltaChip delta={actual.monto - previo.monto} formato="clp" />}
            </div>
          </div>
        )}
      </div>
      {notaMarca ? (
        <div className="h-[230px] grid place-items-center text-[12.5px] text-[--color-fg-muted] italic px-6 text-center">
          {notaMarca}
        </div>
      ) : sinDatos ? (
        <div className="h-[230px] grid place-items-center text-[12.5px] text-[--color-fg-muted] italic">
          Sin cargas de esta fuente en los cortes del período.
        </div>
      ) : (
        <>
          <GraficoIndicador puntos={serie} />
          <div className="mt-1.5">
            <LeyendaIndicador />
          </div>
        </>
      )}
    </section>
  );
}

function EstadoVacio({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-16">
      <div className="surface bg-white top-strip strip-info p-8 text-center">
        <LineChart className="size-8 text-[--color-fg-dim] mx-auto mb-3" strokeWidth={1.5} />
        <div className="text-[16px] font-semibold text-[--color-fg]">{titulo}</div>
        <p className="text-[13px] text-[--color-fg-muted] mt-2 leading-relaxed">{detalle}</p>
      </div>
    </div>
  );
}
