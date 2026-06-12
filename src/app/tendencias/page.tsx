/**
 * /tendencias — Panel ejecutivo de evolución del capital de trabajo.
 *
 * Rediseño V2 (decisión usuario 2026-06): la pantalla deja de ser un visor
 * técnico de series y pasa a contar una historia en <10 segundos:
 *   1. Cómo íbamos en el corte anterior → 2. cómo vamos ahora →
 *   3. qué mejoró → 4. qué empeoró → 5. cuánto capital se liberó o atrapó.
 *
 * Jerarquía: Hero Capital (¿mejor o peor?) · Score con explicación automática
 * · tabla corte vs corte · timeline simple · gráficos al final como
 * "Componentes Técnicos (Beta)".
 *
 * Reglas duras (se mantienen de la corrección por corte — base definitiva):
 *   · El eje temporal es la FECHA DE CORTE real del archivo (fechaCorteDetectada
 *     ?? fechaCorteDeclarada). createdAt es solo auditoría (tooltip).
 *     Nunca se mezclan cortes distintos en un punto.
 *   · Solo fechas reales con cargas. Sin interpolación. Sin días inventados.
 *   · Con cobertura desigual, cada indicador se compara entre SUS dos últimos
 *     cortes con datos, y la página declara qué cortes usó — no se oculta.
 *   · Nunca un gráfico vacío: si faltan fuentes, se explica cuáles y por qué.
 */

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Fragment } from "react";
import {
  ArrowDownRight,
  ArrowRight,
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
  type MetaCorte,
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

/** "2026-06-04" → "04-jun" (label de corte). */
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
// Comparación ejecutiva · cada indicador entre SUS dos últimos cortes
// con datos. No se mezclan datos dentro de un punto; acá solo se decide
// QUÉ pares de cortes son comparables, con trazabilidad explícita.
// ────────────────────────────────────────────────────────────────────

interface ValorCorte {
  punto: PuntoDiario;
  valor: ComponenteCapital;
}

interface ComparacionIndicador {
  key: IndicadorKey;
  nombre: string;
  /** Último corte con datos de este indicador. null = sin datos en el período. */
  actual: ValorCorte | null;
  /** Corte anterior con datos de este indicador. null = solo un corte con datos. */
  previo: ValorCorte | null;
  deltaMonto: number | null;
  deltaUnidades: number | null;
}

function compararIndicadores(puntos: PuntoDiario[]): ComparacionIndicador[] {
  return INDICADORES.map((ind) => {
    const conDato: ValorCorte[] = puntos.flatMap((p) => {
      const v = comp(p, ind.key);
      return v ? [{ punto: p, valor: v }] : [];
    });
    const actual = conDato.length > 0 ? conDato[conDato.length - 1] : null;
    const previo = conDato.length > 1 ? conDato[conDato.length - 2] : null;
    return {
      key: ind.key,
      nombre: ind.nombre,
      actual,
      previo,
      deltaMonto: actual && previo ? actual.valor.monto - previo.valor.monto : null,
      deltaUnidades: actual && previo ? actual.valor.unidades - previo.valor.unidades : null,
    };
  });
}

/** Frase automática del score desde los componentes que más aportaron al cambio. */
function explicacionScore(
  deltaScore: number,
  comparaciones: ComparacionIndicador[],
): string {
  const movers = comparaciones.filter(
    (c): c is ComparacionIndicador & { deltaMonto: number } =>
      c.deltaMonto !== null && Math.round(c.deltaMonto) !== 0,
  );
  // Mejora del score ↔ capital que se libera (delta negativo). Deterioro ↔ se acumula.
  const alineados = movers
    .filter((c) => (deltaScore > 0 ? c.deltaMonto < 0 : c.deltaMonto > 0))
    .sort((a, b) => Math.abs(b.deltaMonto) - Math.abs(a.deltaMonto))
    .slice(0, 2);
  if (alineados.length === 0) {
    return deltaScore > 0
      ? `Mejora de ${deltaScore} puntos vs el corte anterior.`
      : `Deterioro de ${Math.abs(deltaScore)} puntos vs el corte anterior.`;
  }
  const partes = alineados.map((c) =>
    deltaScore > 0
      ? `reducción de ${c.nombre.toLowerCase()}`
      : `aumento de ${c.nombre.toLowerCase()}`,
  );
  return deltaScore > 0
    ? `Mejora impulsada por ${partes.join(" y ")}.`
    : `Deterioro impulsado por ${partes.join(" y ")}.`;
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

  // ── Comparación ejecutiva ───────────────────────────────────────────
  const comparaciones = compararIndicadores(puntos);
  const conActual = comparaciones.filter(
    (c): c is ComparacionIndicador & { actual: ValorCorte } => c.actual !== null,
  );
  const comparables = comparaciones.filter(
    (c): c is ComparacionIndicador & {
      actual: ValorCorte;
      previo: ValorCorte;
      deltaMonto: number;
    } => c.actual !== null && c.previo !== null,
  );

  const capitalActual = conActual.reduce((acc, c) => acc + c.actual.valor.monto, 0);
  const variacionTotal =
    comparables.length > 0 ? comparables.reduce((acc, c) => acc + c.deltaMonto, 0) : null;

  // Rango de comparación: del corte anterior más antiguo usado → al último.
  const diasPrevios = comparables.map((c) => c.previo.punto.dia).sort();
  const diasActuales = conActual.map((c) => c.actual.punto.dia).sort();
  const corteDesde = diasPrevios.length > 0 ? diasPrevios[0] : null;
  const corteHasta = diasActuales.length > 0 ? diasActuales[diasActuales.length - 1] : null;

  // ¿El "capital actual" combina cortes distintos? Declararlo.
  const cortesDelActual = Array.from(new Set(conActual.map((c) => c.actual.punto.dia))).sort();
  const variacionParcial = comparables.length > 0 && comparables.length < conActual.length;

  // ── Score · indicador principal de tendencia ────────────────────────
  const puntosConScore = puntos.filter((p) => p.sgLegacy.score !== null);
  const scoreActual =
    puntosConScore.length > 0 ? puntosConScore[puntosConScore.length - 1] : null;
  const scorePrevio = puntosConScore.length > 1 ? puntosConScore[puntosConScore.length - 2] : null;
  const deltaScore =
    scoreActual && scorePrevio ? scoreActual.sgLegacy.score! - scorePrevio.sgLegacy.score! : null;

  const ultimo = puntos.length > 0 ? puntos[puntos.length - 1] : null;

  // ── Series técnicas (sección Beta) ──────────────────────────────────
  const metaDe = (p: PuntoDiario): MetaCorte => ({
    fechaCorte: p.diaLabel,
    fechasCarga: p.fechasCarga.map(labelCorte),
    cobertura: p.cobertura.map((c) => ({
      etiqueta: c.etiqueta,
      archivo: c.nombreOriginal,
    })),
  });

  const serieIndicador = (key: IndicadorKey): PuntoIndicador[] =>
    puntos.map((p) => ({
      corte: labelCorte(p.dia),
      unidades: comp(p, key)?.unidades ?? null,
      monto: comp(p, key)?.monto ?? null,
      meta: metaDe(p),
    }));
  const serieScore: PuntoScore[] = puntos.map((p) => ({
    corte: labelCorte(p.dia),
    score: p.sgLegacy.score,
    meta: metaDe(p),
  }));

  const serieIndicadorMensual = (key: IndicadorKey): PuntoIndicador[] =>
    cierresMensuales.map(({ periodo, punto }) => ({
      corte: labelPeriodo(periodo),
      unidades: comp(punto, key)?.unidades ?? null,
      monto: comp(punto, key)?.monto ?? null,
      meta: metaDe(punto),
    }));
  const serieScoreMensual: PuntoScore[] = cierresMensuales.map(({ periodo, punto }) => ({
    corte: labelPeriodo(periodo),
    score: punto.sgLegacy.score,
    meta: metaDe(punto),
  }));
  const hayScoreMensual = serieScoreMensual.some((s) => s.score !== null);

  const liberando = variacionTotal !== null && variacionTotal < 0;

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-5 fade-in">
      <MarcaUrlSync marcaFromUrl={marca} />

      {/* ── 1 · Hero Ejecutivo · ¿mejor o peor? ───────────────────────── */}
      <section
        className={cn(
          "surface bg-white top-strip p-6",
          variacionTotal === null ? "strip-info" : liberando ? "strip-success" : "strip-danger",
        )}
      >
        <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold">
          <LineChart className="size-3.5" strokeWidth={2} />
          Tendencias · {labelPeriodo(periodoActual)}
          {marca ? ` · ${marca}` : ""}
        </div>
        <h1 className="text-[24px] font-semibold tracking-tight mt-1.5 leading-tight text-[--color-fg]">
          Capital de Trabajo
        </h1>

        <div className="mt-4 flex flex-wrap items-end gap-x-10 gap-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-[--color-fg-dim] font-semibold">
              Capital actual
            </div>
            <div className="display text-[40px] leading-none text-[--color-fg] mt-1">
              {fmtCLPCompact(capitalActual)}
            </div>
          </div>

          {variacionTotal !== null && corteDesde && corteHasta ? (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[--color-fg-dim] font-semibold">
                Variación
              </div>
              <div
                className={cn(
                  "mt-1 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[16px] font-semibold",
                  liberando ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800",
                )}
              >
                <span
                  className={cn(
                    "inline-block size-2.5 rounded-full",
                    liberando ? "bg-emerald-500" : "bg-red-500",
                  )}
                />
                {liberando ? "Liberando capital" : "Capturando más capital"}
                <span className="display text-[18px]">
                  {variacionTotal < 0 ? "−" : "+"}
                  {fmtCLPCompact(Math.abs(variacionTotal))}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[--color-fg-muted] mono">
                {labelCorte(corteDesde)}
                <ArrowRight className="size-3" />
                {labelCorte(corteHasta)}
              </div>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-lg bg-[--color-bg-elev-2] px-3 py-2 text-[12.5px] text-[--color-fg-muted]">
              <Minus className="size-4" />
              Se necesita más de un corte con datos en {labelPeriodo(periodoActual)} para comparar.
            </div>
          )}
        </div>

        {variacionTotal !== null && (
          <p className="mt-3.5 text-[14px] text-[--color-fg-muted] leading-snug">
            {liberando
              ? `Desde el último corte se liberaron ${fmtCLPCompact(Math.abs(variacionTotal))} de capital de trabajo.`
              : `Desde el último corte se atraparon ${fmtCLPCompact(variacionTotal)} adicionales de capital de trabajo.`}
          </p>
        )}

        {(cortesDelActual.length > 1 || variacionParcial) && (
          <p className="mt-2 text-[11.5px] text-[--color-fg-dim] leading-snug">
            {cortesDelActual.length > 1 &&
              `El capital actual combina el último dato disponible de cada componente (cortes ${cortesDelActual
                .map(labelCorte)
                .join(" y ")}). `}
            {variacionParcial &&
              `La variación considera solo los indicadores con dos cortes comparables (${comparables
                .map((c) => c.nombre)
                .join(", ")}).`}
          </p>
        )}
      </section>

      {/* ── 2 · Score · indicador principal de tendencia ──────────────── */}
      <section className="surface bg-white p-5">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold">
          Score Gerencial · salud del capital (0 a 100)
        </div>
        {scoreActual ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-3">
                {scorePrevio && (
                  <>
                    <span className="display text-[30px] leading-none text-[--color-fg-dim]">
                      {scorePrevio.sgLegacy.score}
                    </span>
                    <ArrowRight className="size-5 text-[--color-fg-dim]" />
                  </>
                )}
                <span className="display text-[44px] leading-none text-[--color-fg]">
                  {scoreActual.sgLegacy.score}
                </span>
                {deltaScore !== null && deltaScore !== 0 && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-semibold",
                      deltaScore > 0
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-red-50 text-red-700",
                    )}
                  >
                    {deltaScore > 0 ? (
                      <ArrowUpRight className="size-3.5" />
                    ) : (
                      <ArrowDownRight className="size-3.5" />
                    )}
                    {deltaScore > 0 ? "+" : "−"}
                    {Math.abs(deltaScore)} puntos
                  </span>
                )}
              </div>
              {scorePrevio && (
                <span className="text-[12px] text-[--color-fg-muted] mono">
                  {labelCorte(scorePrevio.dia)} → {labelCorte(scoreActual.dia)}
                </span>
              )}
            </div>
            {deltaScore !== null && deltaScore !== 0 && (
              <p className="mt-2 text-[13px] text-[--color-fg-muted]">
                {explicacionScore(deltaScore, comparaciones)}
              </p>
            )}
            {puntosConScore.length > 1 && (
              <div className="mt-3">
                <GraficoScore puntos={serieScore} />
              </div>
            )}
          </>
        ) : (
          <div className="mt-3 rounded-lg bg-[--color-bg-elev-2] p-4">
            <div className="text-[14px] font-semibold text-[--color-fg]">Datos insuficientes</div>
            <p className="text-[12.5px] text-[--color-fg-muted] mt-1 leading-snug">
              Para calcular el Score Gerencial se requieren las cuatro fuentes en un mismo corte.
              {!puntos.some((p) => p.sgLegacy.esConfiable) &&
                ` Ningún corte de ${labelPeriodo(periodoActual)} posee las cuatro fuentes completas.`}
            </p>
            {ultimo && (
              <>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {ultimo.cobertura.map((c) => (
                    <div
                      key={c.fuente}
                      className={cn(
                        "rounded-md px-2.5 py-1.5 text-[12px] font-medium inline-flex items-center gap-1.5",
                        c.presente
                          ? "bg-emerald-50 text-emerald-800"
                          : "bg-red-50 text-red-700",
                      )}
                    >
                      <span>{c.presente ? "✓" : "✗"}</span>
                      {c.etiqueta}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[12px] text-[--color-fg-muted]">
                  Cobertura del último corte ({labelCorte(ultimo.dia)}):{" "}
                  {ultimo.cobertura.filter((c) => c.presente).length} de 4 fuentes.
                </p>
              </>
            )}
          </div>
        )}
      </section>

      {/* ── 3 · Resumen Corte vs Corte ────────────────────────────────── */}
      <section className="surface bg-white p-5">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold mb-3">
          Resumen corte vs corte
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[--color-fg-dim]">
                <th className="py-2 pr-4 font-semibold">Indicador</th>
                <th className="py-2 pr-4 font-semibold">Corte anterior</th>
                <th className="py-2 pr-4 font-semibold">Último corte</th>
                <th className="py-2 font-semibold">Variación</th>
              </tr>
            </thead>
            <tbody>
              {comparaciones.map((c) => (
                <tr key={c.key} className="border-t border-[--color-border]">
                  <td className="py-2.5 pr-4 font-medium text-[--color-fg]">{c.nombre}</td>
                  <td className="py-2.5 pr-4">
                    {c.previo ? (
                      <CeldaValor valor={c.previo.valor} corte={labelCorte(c.previo.punto.dia)} />
                    ) : (
                      <span className="text-[--color-fg-dim] italic text-[12px]">
                        {c.actual ? "solo un corte con datos" : "—"}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    {c.actual ? (
                      <CeldaValor valor={c.actual.valor} corte={labelCorte(c.actual.punto.dia)} />
                    ) : (
                      <span className="text-[--color-fg-dim] italic text-[12px]">
                        {c.key === "bonos" && marca
                          ? "no atribuible por marca"
                          : "sin datos en el período"}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5">
                    {c.deltaMonto !== null && c.deltaUnidades !== null ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <DeltaChip delta={c.deltaMonto} formato="clp" />
                        <span className="text-[11.5px] text-[--color-fg-muted]">
                          {c.deltaUnidades === 0
                            ? "= unidades"
                            : `${c.deltaUnidades > 0 ? "+" : "−"}${fmtNum(Math.abs(c.deltaUnidades))} u.`}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[--color-fg-dim]">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {/* Capital Total — ambas celdas sobre el MISMO conjunto comparable,
                  para que anterior + variación = último siempre cuadre. */}
              <tr className="border-t-2 border-[--color-border] font-semibold">
                <td className="py-3 pr-4 text-[--color-fg]">Capital Total</td>
                <td className="py-3 pr-4">
                  {comparables.length > 0 ? (
                    <span className="mono">
                      {fmtCLPCompact(comparables.reduce((a, c) => a + c.previo.valor.monto, 0))}
                    </span>
                  ) : (
                    <span className="text-[--color-fg-dim]">—</span>
                  )}
                </td>
                <td className="py-3 pr-4">
                  {comparables.length > 0 ? (
                    <span className="mono">
                      {fmtCLPCompact(comparables.reduce((a, c) => a + c.actual.valor.monto, 0))}
                    </span>
                  ) : (
                    <span className="mono">{fmtCLPCompact(capitalActual)}</span>
                  )}
                </td>
                <td className="py-3">
                  {variacionTotal !== null ? (
                    <DeltaChip delta={variacionTotal} formato="clp" />
                  ) : (
                    <span className="text-[--color-fg-dim]">—</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {variacionParcial && (
          <p className="mt-2 text-[11.5px] text-[--color-fg-dim]">
            La fila Capital Total compara solo los indicadores con dos cortes comparables (
            {comparables.map((c) => c.nombre).join(", ")}); el capital actual completo (
            {fmtCLPCompact(capitalActual)}) está arriba. El corte de cada fila puede diferir
            cuando una fuente no se cargó en el corte más reciente.
          </p>
        )}
      </section>

      {/* ── 4 · Timeline de cortes ────────────────────────────────────── */}
      <section className="surface bg-white p-5">
        <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold mb-4">
          <CalendarDays className="size-3.5" />
          Cortes de {labelPeriodo(periodoActual)} · {puntos.length}{" "}
          {puntos.length === 1 ? "corte real" : "cortes reales"}
        </div>
        <div className="flex items-center px-2">
          {puntos.map((p, i) => (
            <Fragment key={p.dia}>
              {i > 0 && <div className="h-px flex-1 bg-[--color-border] min-w-6 mx-2" />}
              <div
                className="flex flex-col items-center gap-1.5"
                title={
                  p.coberturaIncompleta
                    ? `Cobertura incompleta — falta: ${p.cobertura
                        .filter((c) => !c.presente)
                        .map((c) => c.etiqueta)
                        .join(", ")}`
                    : "Cobertura completa"
                }
              >
                <span
                  className={cn(
                    "inline-block rounded-full",
                    i === puntos.length - 1
                      ? "size-3.5 bg-[color:var(--color-accent)] ring-4 ring-[color:var(--color-accent)]/15"
                      : "size-2.5 bg-[color:var(--color-fg-dim)]",
                  )}
                />
                <span
                  className={cn(
                    "text-[11.5px] mono",
                    i === puntos.length - 1
                      ? "font-semibold text-[--color-fg]"
                      : "text-[--color-fg-muted]",
                  )}
                >
                  {labelCorte(p.dia)}
                  {p.coberturaIncompleta && <span className="text-amber-600 ml-0.5">⚠</span>}
                </span>
              </div>
            </Fragment>
          ))}
        </div>
        {puntos.some((p) => p.coberturaIncompleta) && (
          <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-900 space-y-0.5">
            {puntos
              .filter((p) => p.coberturaIncompleta)
              .map((p) => (
                <div key={`cob-${p.dia}`}>
                  <span className="font-semibold mono">{labelCorte(p.dia)}</span> · sin{" "}
                  {p.cobertura
                    .filter((c) => !c.presente)
                    .map((c) => c.etiqueta)
                    .join(", ")}{" "}
                  en este corte — sus indicadores se calculan solo con lo disponible.
                </div>
              ))}
          </div>
        )}
      </section>

      {/* ── 5 · Componentes Técnicos (Beta) ───────────────────────────── */}
      <SeccionTitulo
        titulo="Componentes Técnicos (Beta)"
        detalle={`evolución por corte · ${labelPeriodo(periodoActual)} · auditoría en cada tooltip`}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {INDICADORES.map((ind) => {
          const c = comparaciones.find((x) => x.key === ind.key);
          return (
            <CardIndicador
              key={ind.key}
              nombre={ind.nombre}
              descripcion={ind.descripcion}
              serie={serieIndicador(ind.key)}
              actual={c?.actual?.valor ?? null}
              previo={c?.previo?.valor ?? null}
              notaMarca={
                ind.key === "bonos" && marca
                  ? "No atribuible por marca — quita el filtro para ver bonos."
                  : null
              }
            />
          );
        })}
      </div>

      {/* ── Largo plazo mensual ───────────────────────────────────────── */}
      {cierresMensuales.length >= 2 && (
        <>
          <SeccionTitulo
            titulo="Tendencia de largo plazo"
            detalle={`último corte real de cada mes · ${cierresMensuales
              .map((c) => labelPeriodo(c.periodo))
              .join(" → ")}`}
          />
          {hayScoreMensual ? (
            <CardScore puntos={serieScoreMensual} />
          ) : (
            <p className="text-[12px] text-[--color-fg-muted] -mt-1">
              Score Gerencial mensual sin datos suficientes — se requieren las cuatro fuentes en
              un mismo corte.
            </p>
          )}
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
        Cada punto corresponde a una fecha de corte real — la fecha que declara el archivo, no la
        fecha en que se subió. Los huecos en una línea significan que esa fuente no tiene archivo
        para ese corte; no se interpola ni se inventa. La fecha de carga y los archivos
        considerados están en el tooltip de cada gráfico.
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

/** Valor de un indicador en un corte: monto protagonista + unidades + corte. */
function CeldaValor({ valor, corte }: { valor: ComponenteCapital; corte: string }) {
  return (
    <div className="leading-tight">
      <span className="mono text-[13px] text-[--color-fg]">{fmtCLPCompact(valor.monto)}</span>
      <div className="text-[11px] text-[--color-fg-muted]">
        {fmtNum(valor.unidades)} u. · <span className="mono">{corte}</span>
      </div>
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
      {delta < 0 ? "−" : delta > 0 ? "+" : ""}
      {txt}
    </span>
  );
}

function CardScore({ puntos }: { puntos: PuntoScore[] }) {
  return (
    <section className="surface bg-white p-5">
      <div className="text-[13.5px] font-semibold text-[--color-fg] mb-1">Score Gerencial</div>
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
