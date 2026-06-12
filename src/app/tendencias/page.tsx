/**
 * /tendencias — Panel ejecutivo de evolución del capital de trabajo,
 * basado en SNAPSHOTS DIARIOS PERSISTENTES (DailyCapitalSnapshot).
 *
 * Fuente de verdad (decisión usuario 2026-06): cada punto es la foto diaria
 * del ESTADO VIGENTE del sistema — "cómo estaba el sistema ese día", no "qué
 * archivo se cargó ese día". La genera el job diario del agent (o la acción
 * manual "Generar snapshot de hoy") leyendo los Snapshot vigentes ya
 * ingestados. Esta página NO lee cargas históricas ni Excel.
 *
 * · Si no se cargaron archivos nuevos, la línea queda plana: el sistema no
 *   cambió. Eso es información, no un error.
 * · La lógica de agrupación por fecha de corte (calcular-scores-por-dia)
 *   se mantiene intacta como módulo — esta vista no la mezcla.
 *
 * Jerarquía (<10s para responder "¿mejor o peor?"): Hero Capital · Score con
 * explicación automática · tabla día vs día · timeline · gráficos técnicos.
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
import type { ComponenteCapital } from "@/lib/historico/capital-por-corte";
import type { CoberturaVigente } from "@/lib/snapshots/daily-capital";
import { normalizarMarcaOperacional } from "@/lib/selectors/owner-operacional";
import {
  GraficoIndicador,
  GraficoScore,
  LeyendaIndicador,
  type MetaCorte,
  type PuntoIndicador,
  type PuntoScore,
} from "@/components/tendencias/GraficosCapital";
import { MarcaUrlSync } from "./MarcaUrlSync";
import { GenerarSnapshotHoy } from "./GenerarSnapshotHoy";

export const dynamic = "force-dynamic";

const ROLES_PERMITIDOS = new Set(["ADMIN", "GERENTE_GENERAL", "DIRECTOR"]);
const ROLES_GENERAR = new Set(["ADMIN", "GERENTE_GENERAL"]);

const MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/** "2026-06-11" → "11-jun". */
function labelDia(dia: string): string {
  const [, m, d] = dia.split("-");
  return `${d}-${MESES[parseInt(m, 10) - 1] ?? "?"}`;
}

/** "2026-06-11" → "11 jun 2026". */
function labelDiaLargo(dia: string): string {
  const [y, m, d] = dia.split("-");
  return `${d} ${MESES[parseInt(m, 10) - 1] ?? "?"} ${y}`;
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

// ────────────────────────────────────────────────────────────────────
// Punto diario · fila de DailyCapitalSnapshot lista para la UI
// ────────────────────────────────────────────────────────────────────

interface PuntoDiarioCapital {
  /** YYYY-MM-DD (día Chile de la foto). */
  dia: string;
  capital: Record<IndicadorKey, ComponenteCapital | null>;
  score: number | null;
  capitalTotal: number | null;
  cobertura: CoberturaVigente[];
  coberturaIncompleta: boolean;
}

function comp(p: PuntoDiarioCapital, key: IndicadorKey): ComponenteCapital | null {
  return p.capital[key];
}

function componente(unidades: number | null, monto: number | null): ComponenteCapital | null {
  return unidades !== null && monto !== null ? { unidades, monto } : null;
}

// ────────────────────────────────────────────────────────────────────
// Comparación ejecutiva día vs día · cada indicador entre SUS dos
// últimos días con datos (si una fuente desaparece un día, no se
// confunde "fuente ausente" con "capital liberado").
// ────────────────────────────────────────────────────────────────────

interface ValorDia {
  punto: PuntoDiarioCapital;
  valor: ComponenteCapital;
}

interface ComparacionIndicador {
  key: IndicadorKey;
  nombre: string;
  actual: ValorDia | null;
  previo: ValorDia | null;
  deltaMonto: number | null;
  deltaUnidades: number | null;
}

function compararIndicadores(puntos: PuntoDiarioCapital[]): ComparacionIndicador[] {
  return INDICADORES.map((ind) => {
    const conDato: ValorDia[] = puntos.flatMap((p) => {
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
  const alineados = movers
    .filter((c) => (deltaScore > 0 ? c.deltaMonto < 0 : c.deltaMonto > 0))
    .sort((a, b) => Math.abs(b.deltaMonto) - Math.abs(a.deltaMonto))
    .slice(0, 2);
  if (alineados.length === 0) {
    return deltaScore > 0
      ? `Mejora de ${deltaScore} puntos vs el día anterior.`
      : `Deterioro de ${Math.abs(deltaScore)} puntos vs el día anterior.`;
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
  const puedeGenerar = ROLES_GENERAR.has(session.user.rol);

  const params = await searchParams;
  const marca = params.marca && params.marca.trim() !== "" ? params.marca : null;
  const marcaCanonica = marca ? normalizarMarcaOperacional(marca) : null;

  // ── Lectura: snapshots diarios persistentes del scope ───────────────
  let filas;
  try {
    filas = await prisma.dailyCapitalSnapshot.findMany({
      where: marcaCanonica
        ? { scopeTipo: "MARCA", marca: marcaCanonica }
        : { scopeTipo: "TOTAL" },
      orderBy: { fecha: "asc" },
    });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "P2021" || code === "P2022") {
      return (
        <EstadoVacio
          titulo="Tendencias no inicializadas"
          detalle="La base de esta instancia aún no tiene la tabla de snapshots diarios (migraciones pendientes)."
        />
      );
    }
    throw e;
  }

  const puntos: PuntoDiarioCapital[] = filas.map((f) => {
    const cobertura = (f.cobertura ?? []) as unknown as CoberturaVigente[];
    return {
      dia: f.fecha.toISOString().slice(0, 10),
      capital: {
        stockPagado: componente(f.stockPagadoUnidades, f.stockPagadoMonto),
        saldosVehiculo: componente(f.saldosUnidades, f.saldosMonto),
        bonos: componente(f.bonosUnidades, f.bonosMonto),
        provisiones: componente(f.provisionesUnidades, f.provisionesMonto),
      },
      score: f.scoreGerencial,
      capitalTotal: f.capitalTrabajoTotal,
      cobertura,
      coberturaIncompleta: cobertura.some((c) => !c.presente),
    };
  });

  // ── Estado vacío: aún no hay fotos diarias ──────────────────────────
  if (puntos.length === 0) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-16">
        <MarcaUrlSync marcaFromUrl={marca} />
        <div className="surface bg-white top-strip strip-info p-8">
          <LineChart className="size-8 text-[--color-fg-dim] mb-3" strokeWidth={1.5} />
          <div className="text-[18px] font-semibold text-[--color-fg]">
            Sin snapshots diarios aún{marcaCanonica ? ` para ${marcaCanonica}` : ""}
          </div>
          <p className="text-[13px] text-[--color-fg-muted] mt-2 leading-relaxed max-w-2xl">
            Las tendencias se construyen hacia adelante con una foto diaria del estado vigente
            del sistema: los Excel se cargan por el flujo normal, el sistema normaliza y calcula,
            y un job diario guarda la foto. Desde la primera foto, esta página muestra la
            evolución real día a día — si el sistema no cambia, la línea queda plana.
          </p>
          {puedeGenerar && (
            <div className="mt-4">
              <GenerarSnapshotHoy />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Comparación ejecutiva día vs día ────────────────────────────────
  const comparaciones = compararIndicadores(puntos);
  const conActual = comparaciones.filter(
    (c): c is ComparacionIndicador & { actual: ValorDia } => c.actual !== null,
  );
  const comparables = comparaciones.filter(
    (c): c is ComparacionIndicador & {
      actual: ValorDia;
      previo: ValorDia;
      deltaMonto: number;
    } => c.actual !== null && c.previo !== null,
  );

  const ultimo = puntos[puntos.length - 1];
  const capitalActual = ultimo.capitalTotal ?? null;
  const variacionTotal =
    comparables.length > 0 ? comparables.reduce((acc, c) => acc + c.deltaMonto, 0) : null;

  const diasPrevios = comparables.map((c) => c.previo.punto.dia).sort();
  const diaDesde = diasPrevios.length > 0 ? diasPrevios[0] : null;
  const diaHasta = ultimo.dia;
  const variacionParcial = comparables.length > 0 && comparables.length < conActual.length;

  // ── Score · indicador principal de tendencia ────────────────────────
  const puntosConScore = puntos.filter((p) => p.score !== null);
  const scoreActual =
    puntosConScore.length > 0 ? puntosConScore[puntosConScore.length - 1] : null;
  const scorePrevio = puntosConScore.length > 1 ? puntosConScore[puntosConScore.length - 2] : null;
  const deltaScore = scoreActual && scorePrevio ? scoreActual.score! - scorePrevio.score! : null;

  // ── Series para los gráficos técnicos ───────────────────────────────
  const metaDe = (p: PuntoDiarioCapital): MetaCorte => ({
    fechaCorte: labelDiaLargo(p.dia),
    fechasCarga: Array.from(
      new Set(
        p.cobertura
          .filter((c) => c.presente && c.cargadoEl)
          .map((c) => labelDia(c.cargadoEl!.slice(0, 10))),
      ),
    ),
    cobertura: p.cobertura.map((c) => ({
      etiqueta: c.etiqueta,
      archivo: c.presente ? c.nombre : null,
    })),
  });

  const serieIndicador = (key: IndicadorKey): PuntoIndicador[] =>
    puntos.map((p) => ({
      corte: labelDia(p.dia),
      unidades: comp(p, key)?.unidades ?? null,
      monto: comp(p, key)?.monto ?? null,
      meta: metaDe(p),
    }));
  const serieScore: PuntoScore[] = puntos.map((p) => ({
    corte: labelDia(p.dia),
    score: p.score,
    meta: metaDe(p),
  }));

  const liberando = variacionTotal !== null && variacionTotal < 0;
  const sinCambio = variacionTotal !== null && Math.round(variacionTotal) === 0;

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-5 fade-in">
      <MarcaUrlSync marcaFromUrl={marca} />

      {/* ── 1 · Hero Ejecutivo · ¿mejor o peor? ───────────────────────── */}
      <section
        className={cn(
          "surface bg-white top-strip p-6",
          variacionTotal === null || sinCambio
            ? "strip-info"
            : liberando
              ? "strip-success"
              : "strip-danger",
        )}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold">
            <LineChart className="size-3.5" strokeWidth={2} />
            Tendencias · evolución diaria
            {marcaCanonica ? ` · ${marcaCanonica}` : ""}
          </div>
          {puedeGenerar && <GenerarSnapshotHoy />}
        </div>
        <h1 className="text-[24px] font-semibold tracking-tight mt-1.5 leading-tight text-[--color-fg]">
          Capital de Trabajo
        </h1>

        <div className="mt-4 flex flex-wrap items-end gap-x-10 gap-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-[--color-fg-dim] font-semibold">
              Capital actual · {labelDia(ultimo.dia)}
            </div>
            <div className="display text-[40px] leading-none text-[--color-fg] mt-1">
              {capitalActual !== null ? fmtCLPCompact(capitalActual) : "—"}
            </div>
          </div>

          {variacionTotal !== null && diaDesde ? (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[--color-fg-dim] font-semibold">
                Variación
              </div>
              <div
                className={cn(
                  "mt-1 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[16px] font-semibold",
                  sinCambio
                    ? "bg-[--color-bg-elev-2] text-[--color-fg-muted]"
                    : liberando
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-red-50 text-red-800",
                )}
              >
                <span
                  className={cn(
                    "inline-block size-2.5 rounded-full",
                    sinCambio ? "bg-[color:var(--color-fg-dim)]" : liberando ? "bg-emerald-500" : "bg-red-500",
                  )}
                />
                {sinCambio ? "Sin variación" : liberando ? "Liberando capital" : "Capturando más capital"}
                <span className="display text-[18px]">
                  {sinCambio
                    ? "$0"
                    : `${variacionTotal < 0 ? "−" : "+"}${fmtCLPCompact(Math.abs(variacionTotal))}`}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[--color-fg-muted] mono">
                {labelDia(diaDesde)}
                <ArrowRight className="size-3" />
                {labelDia(diaHasta)}
              </div>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-lg bg-[--color-bg-elev-2] px-3 py-2 text-[12.5px] text-[--color-fg-muted]">
              <Minus className="size-4" />
              Se necesita más de un día con datos para comparar — la tendencia se construye con
              cada foto diaria.
            </div>
          )}
        </div>

        {variacionTotal !== null && (
          <p className="mt-3.5 text-[14px] text-[--color-fg-muted] leading-snug">
            {variacionTotal === 0
              ? "El sistema no registra cambios de capital desde la foto anterior."
              : liberando
                ? `Desde el día anterior se liberaron ${fmtCLPCompact(Math.abs(variacionTotal))} de capital de trabajo.`
                : `Desde el día anterior se atraparon ${fmtCLPCompact(variacionTotal)} adicionales de capital de trabajo.`}
          </p>
        )}

        {variacionParcial && (
          <p className="mt-2 text-[11.5px] text-[--color-fg-dim] leading-snug">
            La variación considera solo los indicadores con dos días comparables (
            {comparables.map((c) => c.nombre).join(", ")}) — una fuente que deja de estar vigente
            no se cuenta como capital liberado.
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
                      {scorePrevio.score}
                    </span>
                    <ArrowRight className="size-5 text-[--color-fg-dim]" />
                  </>
                )}
                <span className="display text-[44px] leading-none text-[--color-fg]">
                  {scoreActual.score}
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
                  {labelDia(scorePrevio.dia)} → {labelDia(scoreActual.dia)}
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
              Para calcular el Score Gerencial se requieren las cuatro fuentes vigentes al
              momento de la foto diaria.
            </p>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {ultimo.cobertura.map((c) => (
                <div
                  key={c.fuente}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-[12px] font-medium inline-flex items-center gap-1.5",
                    c.presente ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700",
                  )}
                >
                  <span>{c.presente ? "✓" : "✗"}</span>
                  {c.etiqueta}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-[--color-fg-muted]">
              Cobertura de la última foto ({labelDia(ultimo.dia)}):{" "}
              {ultimo.cobertura.filter((c) => c.presente).length} de 4 fuentes vigentes.
            </p>
          </div>
        )}
      </section>

      {/* ── 3 · Resumen día vs día ────────────────────────────────────── */}
      <section className="surface bg-white p-5">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold mb-3">
          Resumen día vs día
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[--color-fg-dim]">
                <th className="py-2 pr-4 font-semibold">Indicador</th>
                <th className="py-2 pr-4 font-semibold">Día anterior</th>
                <th className="py-2 pr-4 font-semibold">Último día</th>
                <th className="py-2 font-semibold">Variación</th>
              </tr>
            </thead>
            <tbody>
              {comparaciones.map((c) => (
                <tr key={c.key} className="border-t border-[--color-border]">
                  <td className="py-2.5 pr-4 font-medium text-[--color-fg]">{c.nombre}</td>
                  <td className="py-2.5 pr-4">
                    {c.previo ? (
                      <CeldaValor valor={c.previo.valor} dia={labelDia(c.previo.punto.dia)} />
                    ) : (
                      <span className="text-[--color-fg-dim] italic text-[12px]">
                        {c.actual ? "solo un día con datos" : "—"}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    {c.actual ? (
                      <CeldaValor valor={c.actual.valor} dia={labelDia(c.actual.punto.dia)} />
                    ) : (
                      <span className="text-[--color-fg-dim] italic text-[12px]">
                        fuente no vigente
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
                    <span className="mono">
                      {capitalActual !== null ? fmtCLPCompact(capitalActual) : "—"}
                    </span>
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
            La fila Capital Total compara solo los indicadores con dos días comparables (
            {comparables.map((c) => c.nombre).join(", ")}); el capital actual completo (
            {capitalActual !== null ? fmtCLPCompact(capitalActual) : "—"}) está arriba.
          </p>
        )}
      </section>

      {/* ── 4 · Timeline de días ──────────────────────────────────────── */}
      <section className="surface bg-white p-5">
        <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em] text-[--color-fg-dim] font-semibold mb-4">
          <CalendarDays className="size-3.5" />
          Fotos diarias · {puntos.length} {puntos.length === 1 ? "día" : "días"}
        </div>
        <div className="flex items-center px-2 overflow-x-auto">
          {puntos.slice(-14).map((p, i, visibles) => (
            <Fragment key={p.dia}>
              {i > 0 && <div className="h-px flex-1 bg-[--color-border] min-w-6 mx-2" />}
              <div
                className="flex flex-col items-center gap-1.5 shrink-0"
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
                    i === visibles.length - 1
                      ? "size-3.5 bg-[color:var(--color-accent)] ring-4 ring-[color:var(--color-accent)]/15"
                      : "size-2.5 bg-[color:var(--color-fg-dim)]",
                  )}
                />
                <span
                  className={cn(
                    "text-[11.5px] mono",
                    i === visibles.length - 1
                      ? "font-semibold text-[--color-fg]"
                      : "text-[--color-fg-muted]",
                  )}
                >
                  {labelDia(p.dia)}
                  {p.coberturaIncompleta && <span className="text-amber-600 ml-0.5">⚠</span>}
                </span>
              </div>
            </Fragment>
          ))}
        </div>
        {puntos.length > 14 && (
          <p className="mt-2 text-[11.5px] text-[--color-fg-dim]">
            Mostrando los últimos 14 días — los gráficos técnicos incluyen la serie completa.
          </p>
        )}
        {ultimo.coberturaIncompleta && (
          <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-900">
            <span className="font-semibold mono">{labelDia(ultimo.dia)}</span> · sin{" "}
            {ultimo.cobertura
              .filter((c) => !c.presente)
              .map((c) => c.etiqueta)
              .join(", ")}{" "}
            vigente al momento de la foto — sus indicadores se calculan solo con lo disponible.
          </div>
        )}
      </section>

      {/* ── 5 · Componentes Técnicos (Beta) ───────────────────────────── */}
      <SeccionTitulo
        titulo="Componentes Técnicos (Beta)"
        detalle="evolución diaria por componente · auditoría de fuentes en cada tooltip"
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
            />
          );
        })}
      </div>

      <p className="text-[11.5px] text-[--color-fg-dim] pb-2">
        Cada punto es una foto diaria del estado vigente del sistema (datos ya ingestados y
        normalizados) — no una carga de archivo. Una línea plana significa que el sistema no
        cambió ese día. Los huecos indican que esa fuente no estaba vigente al momento de la
        foto. Las fuentes y archivos considerados están en el tooltip de cada gráfico.
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

/** Valor de un indicador en un día: monto protagonista + unidades + día. */
function CeldaValor({ valor, dia }: { valor: ComponenteCapital; dia: string }) {
  return (
    <div className="leading-tight">
      <span className="mono text-[13px] text-[--color-fg]">{fmtCLPCompact(valor.monto)}</span>
      <div className="text-[11px] text-[--color-fg-muted]">
        {fmtNum(valor.unidades)} u. · <span className="mono">{dia}</span>
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

function CardIndicador({
  nombre,
  descripcion,
  serie,
  actual,
  previo,
}: {
  nombre: string;
  descripcion: string;
  serie: PuntoIndicador[];
  actual: ComponenteCapital | null;
  previo: ComponenteCapital | null;
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
      {sinDatos ? (
        <div className="h-[230px] grid place-items-center text-[12.5px] text-[--color-fg-muted] italic">
          Sin datos de esta fuente en las fotos diarias del período.
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
