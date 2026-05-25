"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Info,
  ShieldAlert,
  Upload,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { UploadButton } from "@/components/UploadButton";
import { useExcelStore } from "@/lib/store";
import { fmtCLP, fmtCLPCompact, fmtNum, fmtPct } from "@/lib/format";
import {
  compararResumen,
  computeDashboardKPIs,
  computeResumenAppEstimado,
} from "@/lib/selectors/kpis";
import { detectarFNE, statsFNE } from "@/lib/selectors/fne";
import {
  ESTADO_DESC,
  ESTADO_LABEL,
  ESTADO_TONE,
  NATURALEZA_DESC,
  NATURALEZA_LABEL,
  NATURALEZA_TONE,
  capitalPorMarcaOriginadora,
  coberturaMarcaOriginadora,
  distribucionEstadoCapital,
  distribucionNaturaleza,
} from "@/lib/selectors/capital-taxonomia";
import { cn } from "@/lib/cn";

export default function ValidacionPage() {
  const { data, error } = useExcelStore();

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardBody>
            <div className="flex items-start gap-3">
              <XCircle className="size-5 text-[--color-danger] mt-0.5" />
              <div>
                <div className="font-medium text-[--color-danger]">
                  Error al procesar el archivo
                </div>
                <div className="text-sm text-[--color-fg-muted] mt-1">{error}</div>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (!data) {
    return <EmptyState />;
  }

  return <ValidationReport />;
}

function EmptyState() {
  return (
    <div className="p-8 max-w-3xl mx-auto">
      <Card variant="glass" className="relative overflow-hidden">
        <div className="absolute -top-24 -right-24 size-64 rounded-full bg-[--color-accent] opacity-[0.08] blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-32 size-72 rounded-full bg-[--color-info] opacity-[0.06] blur-3xl pointer-events-none" />
        <CardBody className="relative py-16 text-center">
          <div className="mx-auto size-14 rounded-2xl bg-gradient-to-br from-[--color-accent] to-[--color-info] grid place-items-center mb-5 shadow-[0_8px_30px_-8px_var(--color-accent-glow)]">
            <Upload className="size-6 text-[#001a14]" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <span className="gradient-text">Stock Command Center</span>
          </h1>
          <p className="text-[13px] text-[--color-fg-muted] mt-2 max-w-md mx-auto leading-relaxed">
            Carga el reporte de stock y líneas de crédito (.xlsx). El archivo se procesa
            localmente en tu navegador — nada se sube a un servidor.
          </p>
          <div className="mt-6">
            <UploadButton variant="primary" />
          </div>
          <div className="text-[10px] text-[--color-fg-dim] mt-8 uppercase tracking-[0.14em]">
            Hojas que se leen
          </div>
          <div className="flex flex-wrap justify-center gap-1.5 mt-2">
            {[
              "Base_Stock",
              "3.-Lineas de Credito",
              "AUX Financiera Linea Autorizada",
              "Resumen Stock Propio",
              "TC CONTROL",
            ].map((h) => (
              <Badge key={h} tone="muted" size="xs" className="font-mono">
                {h}
              </Badge>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function ValidationReport() {
  const { data } = useExcelStore();
  const parsed = data!;

  const kpis = useMemo(() => computeDashboardKPIs(parsed.vehiculos), [parsed.vehiculos]);
  const appResumen = useMemo(
    () => computeResumenAppEstimado(parsed.vehiculos),
    [parsed.vehiculos],
  );
  const diffs = useMemo(
    () => compararResumen(parsed.resumenOficial, appResumen),
    [parsed.resumenOficial, appResumen],
  );

  const lineasSobre = parsed.lineas.filter(
    (l) => l.semaforo === "sobregirada" || l.semaforo === "rojo",
  );

  const sheetsOk = parsed.report.hojas.filter((h) => h.estado === "ok").length;
  const sheetsTotal = parsed.report.hojas.length;

  const allGood =
    sheetsOk === sheetsTotal &&
    parsed.report.fechasInvalidas === 0 &&
    parsed.report.vinsDuplicados.length === 0;

  return (
    <div className="p-8 space-y-6 max-w-[1500px] mx-auto fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[--color-accent] font-semibold">
            <ShieldAlert className="size-3" />
            Validación técnica
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">
            Diagnóstico de lectura del Excel
          </h1>
          <p className="text-[13px] text-[--color-fg-muted] mt-1 max-w-2xl">
            Consistencia, duplicados y diferencias contra la vista oficial antes de habilitar los
            dashboards ejecutivos.
          </p>
        </div>
        <Badge tone={allGood ? "success" : "warning"} dot>
          {allGood ? "Lectura sin observaciones" : "Lectura con observaciones"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat
          label="Hojas procesadas"
          value={`${sheetsOk} / ${sheetsTotal}`}
          sub={`en ${parsed.report.durMs} ms`}
          tone={sheetsOk === sheetsTotal ? "success" : "warning"}
        />
        <Stat
          label="Vehículos leídos"
          value={fmtNum(parsed.report.totalVehiculos)}
          sub={`${fmtNum(parsed.report.totalVinsUnicos)} VIN únicos`}
          tone="accent"
        />
        <Stat
          label="Líneas de crédito"
          value={fmtNum(parsed.lineas.length)}
          sub={
            lineasSobre.length
              ? `${lineasSobre.length} sobre 90% o sobregiradas`
              : "todas dentro de rango"
          }
          tone={lineasSobre.length ? "warning" : "success"}
        />
        <Stat
          label="Issues detectados"
          value={fmtNum(parsed.report.issues.length)}
          sub={`${fmtNum(parsed.report.fechasInvalidas)} fechas inválidas · ${fmtNum(parsed.report.vinsDuplicados.length)} VIN dup.`}
          tone={parsed.report.issues.length === 0 ? "success" : "warning"}
        />
      </div>

      <SheetsSection />
      <ComparisonSection diffs={diffs} kpis={kpis} />
      <NaturalezaCapitalSection />
      <CapitalSection kpis={kpis} />
      <TaxonomiaCapitalSection />
      <MarcaOriginadoraSection />
      <FNESection />
      <LineasCard />

      {/* Debug avanzado colapsable */}
      <details className="rounded-2xl border border-[--color-border] bg-[--color-bg-elev-1]">
        <summary className="cursor-pointer px-5 py-3 text-[13px] font-medium flex items-center justify-between hover:bg-[--color-bg-elev-2] transition rounded-2xl">
          <span className="flex items-center gap-2">
            <Database className="size-4 text-[--color-fg-muted]" />
            Detalle técnico (debug avanzado)
          </span>
          <span className="text-[11px] text-[--color-fg-muted]">
            duplicados · fechas · marcas · estados · issues
          </span>
        </summary>
        <div className="px-5 pb-5 pt-2 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DuplicadosCard />
            <FechasCard />
            <MarcasCard />
            <EstadosDealerCard />
          </div>
          <IssuesCard />
        </div>
      </details>

      <NextStepsCard />
    </div>
  );
}

function SheetsSection() {
  const { data } = useExcelStore();
  const parsed = data!;

  const iconFor = (estado: string) =>
    estado === "ok" ? (
      <CheckCircle2 className="size-4 text-[--color-success]" />
    ) : estado === "parcial" ? (
      <AlertTriangle className="size-4 text-[--color-warning]" />
    ) : estado === "no_encontrada" ? (
      <Info className="size-4 text-[--color-fg-muted]" />
    ) : (
      <XCircle className="size-4 text-[--color-danger]" />
    );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="size-4 text-[--color-fg-muted]" />
          <CardTitle>Hojas leídas</CardTitle>
        </div>
        <CardDescription>
          Solo procesamos las 4 hojas que alimentan el MVP. Las hojas históricas grandes
          (Venta APC Fact VN, brand sheets, etc.) están deliberadamente ignoradas para que la carga
          sea rápida.
        </CardDescription>
      </CardHeader>
      <CardBody className="p-0">
        <table className="w-full text-sm">
          <thead className="text-xs text-[--color-fg-muted] uppercase tracking-wider">
            <tr className="border-b border-[--color-border]">
              <th className="text-left font-medium px-5 py-2.5">Hoja</th>
              <th className="text-left font-medium px-5 py-2.5">Estado</th>
              <th className="text-right font-medium px-5 py-2.5">Total</th>
              <th className="text-right font-medium px-5 py-2.5">Procesadas</th>
              <th className="text-right font-medium px-5 py-2.5">Omitidas</th>
              <th className="text-left font-medium px-5 py-2.5">Notas</th>
            </tr>
          </thead>
          <tbody>
            {parsed.report.hojas.map((h) => (
              <tr key={h.nombre} className="border-b border-[--color-border] last:border-0">
                <td className="px-5 py-2.5 font-medium mono">{h.nombre}</td>
                <td className="px-5 py-2.5">
                  <div className="flex items-center gap-1.5">
                    {iconFor(h.estado)}
                    <span className="capitalize text-xs">{h.estado.replace("_", " ")}</span>
                  </div>
                </td>
                <td className="px-5 py-2.5 text-right mono">{fmtNum(h.filasTotales)}</td>
                <td className="px-5 py-2.5 text-right mono text-[--color-fg]">
                  {fmtNum(h.filasProcesadas)}
                </td>
                <td className="px-5 py-2.5 text-right mono text-[--color-fg-muted]">
                  {fmtNum(h.filasOmitidas)}
                </td>
                <td className="px-5 py-2.5 text-xs text-[--color-fg-muted] max-w-md truncate">
                  {h.mensaje ??
                    (h.columnasFaltantes.length
                      ? `${h.columnasFaltantes.length} columnas esperadas faltantes`
                      : "—")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}

function ComparisonSection({
  diffs,
  kpis,
}: {
  diffs: ReturnType<typeof compararResumen>;
  kpis: ReturnType<typeof computeDashboardKPIs>;
}) {
  const { data } = useExcelStore();
  if (!data?.resumenOficial) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Comparación contra &ldquo;Resumen Stock Propio&rdquo;</CardTitle>
          <CardDescription>
            No se pudo leer la hoja oficial — no hay base de comparación. Abre{" "}
            <a href="/debug/resumen" className="text-[--color-accent] underline">
              Debug · Resumen
            </a>{" "}
            para ver por qué.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const someBig = diffs.some((d) => Math.abs(d.diferenciaPct) > 0.05);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comparación vs &ldquo;Resumen Stock Propio&rdquo; oficial</CardTitle>
        <CardDescription>
          Validamos que la lectura de la app reproduzca los valores oficiales. Diferencias mayores
          al 5 % indican que la heurística debe ajustarse.
        </CardDescription>
      </CardHeader>
      <CardBody className="p-0">
        <table className="w-full text-sm">
          <thead className="text-xs text-[--color-fg-muted] uppercase tracking-wider">
            <tr className="border-b border-[--color-border]">
              <th className="text-left font-medium px-5 py-2.5">Campo</th>
              <th className="text-right font-medium px-5 py-2.5">Oficial (Excel)</th>
              <th className="text-right font-medium px-5 py-2.5">App (calculado)</th>
              <th className="text-right font-medium px-5 py-2.5">Δ</th>
              <th className="text-right font-medium px-5 py-2.5">Δ %</th>
            </tr>
          </thead>
          <tbody>
            {diffs.map((d) => {
              const big = Math.abs(d.diferenciaPct) > 0.05;
              return (
                <tr key={d.campo} className="border-b border-[--color-border] last:border-0">
                  <td className="px-5 py-2.5">{d.campo}</td>
                  <td className="px-5 py-2.5 text-right mono">{fmtCLP(d.oficial)}</td>
                  <td className="px-5 py-2.5 text-right mono">{fmtCLP(d.app)}</td>
                  <td
                    className={cn(
                      "px-5 py-2.5 text-right mono",
                      big ? "text-[--color-warning]" : "text-[--color-fg-muted]",
                    )}
                  >
                    {d.diferencia > 0 ? "+" : ""}
                    {fmtCLP(d.diferencia)}
                  </td>
                  <td
                    className={cn(
                      "px-5 py-2.5 text-right mono",
                      big ? "text-[--color-warning]" : "text-[--color-fg-muted]",
                    )}
                  >
                    {d.diferencia > 0 ? "+" : ""}
                    {fmtPct(d.diferenciaPct)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {someBig && (
          <div className="px-5 py-3 border-t border-[--color-border] text-xs text-[--color-warning] flex items-start gap-2">
            <Info className="size-3.5 mt-0.5 shrink-0" />
            <span>
              Hay diferencias relevantes. Esto se espera mientras refinamos la heurística para
              distinguir &ldquo;Stock A vitrinas&rdquo; vs &ldquo;por facturar&rdquo;. Heurística
              actual: vehículos con <span className="mono">Por llegar = Pre-Inscrito</span> se
              consideran &ldquo;por facturar&rdquo;. Confirmar con Pompeyo si la regla es otra.
            </span>
          </div>
        )}
        <div className="px-5 py-3 border-t border-[--color-border] text-xs text-[--color-fg-muted]">
          Referencia: capital bruto total de la app (todo Costo Neto, sin filtrar) ={" "}
          <span className="mono text-[--color-fg]">{fmtCLPCompact(kpis.capitalBruto)}</span>.
        </div>
      </CardBody>
    </Card>
  );
}

function NaturalezaCapitalSection() {
  const { data } = useExcelStore();
  const dist = useMemo(
    () => (data ? distribucionNaturaleza(data.vehiculos) : []),
    [data],
  );
  const totalCap = dist.reduce((s, d) => s + d.capital, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Naturaleza del capital (agrupación superior)</CardTitle>
        <CardDescription>
          5 buckets que separan claramente puente / operativo / atrapado / tránsito / retail. NO
          se mezclan en una sola métrica.
        </CardDescription>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {dist.map((d) => (
            <div
              key={d.naturaleza}
              className="rounded-xl border border-[--color-border] bg-[--color-bg-elev-2] px-4 py-3"
              title={NATURALEZA_DESC[d.naturaleza]}
            >
              <Badge tone={NATURALEZA_TONE[d.naturaleza]}>{NATURALEZA_LABEL[d.naturaleza]}</Badge>
              <div className="mono text-xl font-semibold mt-2">{fmtCLPCompact(d.capital)}</div>
              <div className="text-xs text-[--color-fg-muted] mt-1">
                {fmtNum(d.unidades)} u ·{" "}
                {totalCap > 0 ? `${((d.capital / totalCap) * 100).toFixed(1)}%` : "—"}
              </div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function TaxonomiaCapitalSection() {
  const { data } = useExcelStore();
  const dist = useMemo(
    () => (data ? distribucionEstadoCapital(data.vehiculos) : []),
    [data],
  );
  const totalUnidades = dist.reduce((s, d) => s + d.unidades, 0);
  const totalCap = dist.reduce((s, d) => s + d.capital, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Taxonomía de capital operacional (modelo nuevo · sin consolidar)</CardTitle>
        <CardDescription>
          Clasificación mutuamente excluyente. Aún <strong>no</strong> calculamos &ldquo;capital
          total por marca incluyendo todo&rdquo; — eso será módulo futuro. Aquí solo exponemos las
          primitivas para construirlo.
        </CardDescription>
      </CardHeader>
      <CardBody className="p-0">
        <table className="w-full text-sm">
          <thead className="text-xs text-[--color-fg-muted] uppercase tracking-wider">
            <tr className="border-b border-[--color-border]">
              <th className="text-left font-medium px-5 py-2.5">Estado</th>
              <th className="text-left font-medium px-5 py-2.5">Definición</th>
              <th className="text-right font-medium px-5 py-2.5">Unidades</th>
              <th className="text-right font-medium px-5 py-2.5">% un.</th>
              <th className="text-right font-medium px-5 py-2.5">Capital</th>
              <th className="text-right font-medium px-5 py-2.5">% cap.</th>
            </tr>
          </thead>
          <tbody>
            {dist.map((d) => {
              const tone = ESTADO_TONE[d.estado];
              return (
                <tr
                  key={d.estado}
                  className="border-b border-[--color-border] last:border-0"
                >
                  <td className="px-5 py-2.5">
                    <Badge tone={tone}>{ESTADO_LABEL[d.estado]}</Badge>
                  </td>
                  <td className="px-5 py-2.5 text-xs text-[--color-fg-muted]">
                    {ESTADO_DESC[d.estado]}
                  </td>
                  <td className="px-5 py-2.5 text-right mono">{fmtNum(d.unidades)}</td>
                  <td className="px-5 py-2.5 text-right mono text-[--color-fg-muted]">
                    {totalUnidades > 0
                      ? `${((d.unidades / totalUnidades) * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="px-5 py-2.5 text-right mono">{fmtCLPCompact(d.capital)}</td>
                  <td className="px-5 py-2.5 text-right mono text-[--color-fg-muted]">
                    {totalCap > 0 ? `${((d.capital / totalCap) * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-[--color-border-strong] bg-[--color-bg-elev-1]">
              <td className="px-5 py-2.5 font-medium" colSpan={2}>
                Total (VIN único)
              </td>
              <td className="px-5 py-2.5 text-right mono font-semibold">{fmtNum(totalUnidades)}</td>
              <td />
              <td className="px-5 py-2.5 text-right mono font-semibold">
                {fmtCLPCompact(totalCap)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}

function MarcaOriginadoraSection() {
  const { data } = useExcelStore();
  const cobertura = useMemo(
    () => (data ? coberturaMarcaOriginadora(data.vehiculos) : []),
    [data],
  );
  const porMarca = useMemo(
    () => (data ? capitalPorMarcaOriginadora(data.vehiculos) : []),
    [data],
  );

  const FUENTE_LABEL: Record<string, string> = {
    marca_vehiculo: "Marca del vehículo (FNE / Retail)",
    sucursal_marca_especifica: "Sucursal marca-específica (VPP)",
    venta_apc_link: "Cruce con Venta APC (Fase 2)",
    no_inferible: "No inferible (multi-marca / logística)",
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Marca originadora — cobertura de atribución</CardTitle>
          <CardDescription>
            Un VPP usado <span className="mono">MAZDA</span> dejado en{" "}
            <span className="mono">KIA REDCUBE</span> consume capital de <strong>KIA</strong>, no
            de Mazda. Aquí trazamos cómo se infiere cada caso.
          </CardDescription>
        </CardHeader>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead className="text-xs text-[--color-fg-muted] uppercase tracking-wider">
              <tr className="border-b border-[--color-border]">
                <th className="text-left font-medium px-5 py-2.5">Fuente de atribución</th>
                <th className="text-right font-medium px-5 py-2.5">Unidades</th>
                <th className="text-right font-medium px-5 py-2.5">%</th>
                <th className="text-right font-medium px-5 py-2.5">Capital</th>
              </tr>
            </thead>
            <tbody>
              {cobertura
                .sort((a, b) => b.unidades - a.unidades)
                .map((c) => (
                  <tr
                    key={c.fuente}
                    className="border-b border-[--color-border] last:border-0"
                  >
                    <td className="px-5 py-2.5">
                      <Badge tone={c.fuente === "no_inferible" ? "warning" : "info"}>
                        {FUENTE_LABEL[c.fuente] ?? c.fuente}
                      </Badge>
                    </td>
                    <td className="px-5 py-2.5 text-right mono">{fmtNum(c.unidades)}</td>
                    <td className="px-5 py-2.5 text-right mono text-[--color-fg-muted]">
                      {(c.pctSobreTotal * 100).toFixed(1)}%
                    </td>
                    <td className="px-5 py-2.5 text-right mono">{fmtCLPCompact(c.capital)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Capital atribuido a marca originadora (sin consolidar)</CardTitle>
          <CardDescription>
            Suma de <span className="mono">Costo Neto</span> agrupada por la marca que originó el
            capital, no por la marca del vehículo. La columna &ldquo;Capital VU otra marca&rdquo;
            es lo que estaba mal atribuido en el modelo anterior.{" "}
            <strong>Esto NO es el capital total por marca</strong> — falta sumar líneas, créditos
            y saldos. Eso es módulo futuro.
          </CardDescription>
        </CardHeader>
        <CardBody className="p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="text-xs text-[--color-fg-muted] uppercase tracking-wider">
              <tr className="border-b border-[--color-border]">
                <th className="text-left font-medium px-5 py-2.5">Marca originadora</th>
                <th className="text-right font-medium px-5 py-2.5">Unidades</th>
                <th className="text-right font-medium px-5 py-2.5">Capital total</th>
                <th className="text-right font-medium px-5 py-2.5">VPP</th>
                <th className="text-right font-medium px-5 py-2.5">FNE</th>
                <th className="text-right font-medium px-5 py-2.5">En proceso CPD/Venta</th>
                <th className="text-right font-medium px-5 py-2.5">Retail</th>
                <th className="text-right font-medium px-5 py-2.5">Cap. VU otra marca</th>
              </tr>
            </thead>
            <tbody>
              {porMarca.slice(0, 18).map((m) => (
                <tr
                  key={m.marca ?? "(none)"}
                  className="border-b border-[--color-border] last:border-0"
                >
                  <td className="px-5 py-2 font-medium">
                    {m.marca ?? <span className="text-[--color-warning]">(no inferible)</span>}
                  </td>
                  <td className="px-5 py-2 text-right mono">{fmtNum(m.unidades)}</td>
                  <td className="px-5 py-2 text-right mono">{fmtCLPCompact(m.capitalTotal)}</td>
                  <td className="px-5 py-2 text-right mono text-[--color-fg-muted]">
                    {fmtCLPCompact(m.porEstado.VPP_EXPLICITO?.capital ?? 0)}
                  </td>
                  <td className="px-5 py-2 text-right mono text-[--color-fg-muted]">
                    {fmtCLPCompact(m.porEstado.FNE_EN_OPERACION?.capital ?? 0)}
                  </td>
                  <td className="px-5 py-2 text-right mono text-[--color-fg-muted]">
                    {fmtCLPCompact(
                      (m.porEstado.PROCESO_CPD?.capital ?? 0) +
                      (m.porEstado.PROCESO_VENTA?.capital ?? 0)
                    )}
                  </td>
                  <td className="px-5 py-2 text-right mono text-[--color-fg-muted]">
                    {fmtCLPCompact(m.porEstado.RETAIL_DISPONIBLE?.capital ?? 0)}
                  </td>
                  <td
                    className={cn(
                      "px-5 py-2 text-right mono",
                      m.capitalDeVUOtraMarca > 0 && "text-[--color-warning]",
                    )}
                  >
                    {m.capitalDeVUOtraMarca > 0 ? (
                      <>
                        {fmtCLPCompact(m.capitalDeVUOtraMarca)}{" "}
                        <span className="text-[--color-fg-dim] text-xs">
                          ({m.unidadesDeVUOtraMarca}u)
                        </span>
                      </>
                    ) : (
                      <span className="text-[--color-fg-dim]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}

function FNESection() {
  const { data } = useExcelStore();
  const fnes = useMemo(() => (data ? detectarFNE(data.vehiculos) : []), [data]);
  const stats = useMemo(() => statsFNE(fnes), [fnes]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Facturados No Entregados (FNE)</CardTitle>
            <CardDescription>
              Vehículos con venta firmada/aprobada pendientes de entrega. Detalle completo en{" "}
              <a href="/facturados-no-entregados" className="text-[--color-accent] underline">
                Facturados no entregados
              </a>
              .
            </CardDescription>
          </div>
          <a
            href="/facturados-no-entregados"
            className="text-xs text-[--color-accent] hover:underline"
          >
            Abrir módulo →
          </a>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat label="FNE total" value={fmtNum(stats.total)} sub="unidades" tone="info" />
          <Stat
            label="Valor total"
            value={fmtCLPCompact(stats.valorTotal)}
            sub="Costo Neto"
          />
          <Stat
            label="Con VPP"
            value={fmtNum(stats.conVPP)}
            sub={`${(stats.pctConVPP * 100).toFixed(0)}% · ${fmtCLPCompact(stats.valorConVPP)}`}
            tone={stats.conVPP > 0 ? "warning" : "default"}
          />
          <Stat
            label="> 7 días"
            value={fmtNum(stats.mas7d)}
            sub={`> 15 días: ${fmtNum(stats.mas15d)}`}
            tone={stats.mas7d > 0 ? "warning" : "success"}
          />
          <Stat
            label="Fuera sucursal venta"
            value={fmtNum(stats.fueraDeSucursal)}
            sub={`Por validar: ${fmtNum(stats.porValidar)}`}
            tone={stats.fueraDeSucursal > 0 ? "warning" : "default"}
          />
          <Stat
            label="Sin fecha aging"
            value={fmtNum(stats.sinFechaAging)}
            sub="Fecha Facturación vacía en este Excel"
            tone={stats.sinFechaAging > 0 ? "warning" : "default"}
          />
        </div>

        {/* Dimensión financiera: ¿de dónde sale el capital de cada FNE? */}
        <div>
          <div className="text-xs text-[--color-fg-muted] uppercase tracking-wider mb-2">
            Dimensión financiera — ¿dónde está parado el capital de cada FNE?
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat
              label="Floor Plan"
              value={fmtCLPCompact(stats.porTipoStock.floorPlan.capital)}
              sub={`${fmtNum(stats.porTipoStock.floorPlan.unidades)} u · línea ocupada`}
              tone={stats.porTipoStock.floorPlan.unidades > 0 ? "warning" : "default"}
            />
            <Stat
              label="Propio"
              value={fmtCLPCompact(stats.porTipoStock.propio.capital)}
              sub={`${fmtNum(stats.porTipoStock.propio.unidades)} u · caja propia`}
              tone={stats.porTipoStock.propio.unidades > 0 ? "info" : "default"}
            />
            <Stat
              label="Financiado"
              value={fmtCLPCompact(stats.porTipoStock.financiado.capital)}
              sub={`${fmtNum(stats.porTipoStock.financiado.unidades)} u · financiamiento`}
            />
            <Stat
              label="Fin Propio"
              value={fmtCLPCompact(stats.porTipoStock.finPropio.capital)}
              sub={`${fmtNum(stats.porTipoStock.finPropio.unidades)} u · cap. financiero propio`}
            />
            <Stat
              label="VU por Recibir"
              value={fmtCLPCompact(stats.porTipoStock.vuPorRecibir.capital)}
              sub={`${fmtNum(stats.porTipoStock.vuPorRecibir.unidades)} u`}
            />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function CapitalSection({ kpis }: { kpis: ReturnType<typeof computeDashboardKPIs> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Capital — 4 visiones separadas</CardTitle>
        <CardDescription>
          Por instrucción explícita, no se mezclan en una sola métrica. Cada card responde a una
          pregunta distinta.
        </CardDescription>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat
            label="Capital propio (caja atrapada)"
            value={fmtCLPCompact(kpis.capitalPropio)}
            sub="Tipo Stock = Propio + Fin Propio"
            tone="info"
          />
          <Stat
            label="Capital financiero"
            value={fmtCLPCompact(kpis.capitalFinanciero)}
            sub="Tipo Stock = Financiado"
          />
          <Stat
            label="Capital VPP Comprometido"
            value={fmtCLPCompact(kpis.capitalVPPComprometido)}
            sub={`${fmtNum(kpis.unidadesVPPComprometido)} vehículos puente`}
            tone={kpis.capitalVPPComprometido > 0 ? "warning" : "default"}
            title="Vehículos en parte de pago (VPP) que ya consumieron línea pero no se monetizan aún"
          />
          <Stat
            label="Capital bruto stock"
            value={fmtCLPCompact(kpis.capitalBruto)}
            sub="Todo Costo Neto — solo referencia"
            tone="default"
            title="Incluye Floor Plan (capital del importador, no de Pompeyo)."
          />
          <Stat
            label="Floor Plan"
            value={fmtCLPCompact(kpis.capitalFloorPlan)}
            sub="En manos del financista"
          />
          <Stat
            label="Pagado"
            value={fmtCLPCompact(kpis.capitalPagado)}
            sub={`No pagado: ${fmtCLPCompact(kpis.capitalNoPagado)}`}
            tone="success"
          />
          <Stat
            label="Capital ≥ 60 días"
            value={fmtCLPCompact(kpis.capitalMas60)}
            sub={`${fmtNum(kpis.unidadesMas60)} vehículos`}
            tone="warning"
          />
          <Stat
            label="Capital ≥ 180 días"
            value={fmtCLPCompact(kpis.capitalMas180)}
            sub={`${fmtNum(kpis.unidadesMas180)} vehículos críticos`}
            tone="danger"
          />
        </div>
      </CardBody>
    </Card>
  );
}

function DuplicadosCard() {
  const { data } = useExcelStore();
  const dups = data!.report.vinsDuplicados;
  return (
    <Card>
      <CardHeader>
        <CardTitle>VIN duplicados</CardTitle>
        <CardDescription>
          Se mantienen todas las filas para auditoría; en KPIs ejecutivos se cuenta VIN único.
        </CardDescription>
      </CardHeader>
      <CardBody>
        {dups.length === 0 ? (
          <div className="text-sm text-[--color-success] flex items-center gap-2">
            <CheckCircle2 className="size-4" /> Sin VIN duplicados.
          </div>
        ) : (
          <div className="space-y-2">
            <Badge tone="warning">{dups.length} VIN duplicados</Badge>
            <div className="text-xs text-[--color-fg-muted] mono max-h-32 overflow-y-auto space-y-0.5">
              {dups.slice(0, 30).map((v) => (
                <div key={v}>{v}</div>
              ))}
              {dups.length > 30 && (
                <div className="italic">… +{dups.length - 30} más</div>
              )}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function FechasCard() {
  const { data } = useExcelStore();
  const n = data!.report.fechasInvalidas;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fechas de vencimiento inválidas</CardTitle>
        <CardDescription>
          Prioridad: <span className="mono">Fecha Vencimiento Fin</span> →{" "}
          <span className="mono">Fecha vencimiento</span>. &quot;NO&quot;, &quot;#N/A&quot; y vacío
          se tratan como sin vencimiento.
        </CardDescription>
      </CardHeader>
      <CardBody>
        {n === 0 ? (
          <div className="text-sm text-[--color-success] flex items-center gap-2">
            <CheckCircle2 className="size-4" /> Sin fechas no parseables.
          </div>
        ) : (
          <Badge tone="warning">{n} fechas no parseables</Badge>
        )}
      </CardBody>
    </Card>
  );
}

function MarcasCard() {
  const { data } = useExcelStore();
  const sm = data!.report.marcasSinMapeo;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Marcas sin mapeo canónico</CardTitle>
        <CardDescription>
          Marcas en <span className="mono">Marca Pompeyo</span> que no están en el catálogo
          interno. Si aparece algo aquí, agregar a <span className="mono">normalize.ts</span>.
        </CardDescription>
      </CardHeader>
      <CardBody>
        {sm.length === 0 ? (
          <div className="text-sm text-[--color-success] flex items-center gap-2">
            <CheckCircle2 className="size-4" /> Todas mapeadas.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {sm.map((m) => (
              <Badge key={m} tone="warning">
                {m}
              </Badge>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function EstadosDealerCard() {
  const { data } = useExcelStore();
  const ed = data!.report.estadosDealerDetectados;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Estados Dealer detectados</CardTitle>
        <CardDescription>
          Valores únicos en la columna <span className="mono">Estado Dealer</span>.
        </CardDescription>
      </CardHeader>
      <CardBody>
        <div className="flex flex-wrap gap-1.5">
          {ed.map((s) => (
            <Badge
              key={s}
              tone={
                s === "TEST CAR"
                  ? "info"
                  : s === "JUDICIAL" || s === "STOCK B"
                    ? "danger"
                    : s === "TRASPASO A 3RO"
                      ? "warning"
                      : "muted"
              }
            >
              {s}
            </Badge>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function LineasCard() {
  const { data } = useExcelStore();
  const lineas = data!.lineas;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Líneas de crédito leídas — semáforo</CardTitle>
        <CardDescription>
          Verde {"<80%"} · Amarillo 80-90% · Rojo {">90%"} · Sobregirada (línea libre {"<0"}).
        </CardDescription>
      </CardHeader>
      <CardBody className="p-0">
        <table className="w-full text-sm">
          <thead className="text-xs text-[--color-fg-muted] uppercase tracking-wider">
            <tr className="border-b border-[--color-border]">
              <th className="text-left font-medium px-5 py-2.5">Marca</th>
              <th className="text-left font-medium px-5 py-2.5">Financiera</th>
              <th className="text-right font-medium px-5 py-2.5">Autorizada</th>
              <th className="text-right font-medium px-5 py-2.5">Ocupada</th>
              <th className="text-right font-medium px-5 py-2.5">Libre</th>
              <th className="text-right font-medium px-5 py-2.5">% Ocup.</th>
              <th className="text-left font-medium px-5 py-2.5">Semáforo</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => (
              <tr
                key={l.marca + l.rowIndex}
                className="border-b border-[--color-border] last:border-0"
              >
                <td className="px-5 py-2 font-medium">{l.marca}</td>
                <td className="px-5 py-2 text-xs text-[--color-fg-muted]">
                  {l.financiera ?? "—"}
                </td>
                <td className="px-5 py-2 text-right mono">{fmtCLP(l.lineaAutorizada)}</td>
                <td className="px-5 py-2 text-right mono">{fmtCLP(l.lineaOcupada)}</td>
                <td
                  className={cn(
                    "px-5 py-2 text-right mono",
                    l.lineaLibre < 0 && "text-[--color-danger] font-medium",
                  )}
                >
                  {fmtCLP(l.lineaLibre)}
                </td>
                <td className="px-5 py-2 text-right mono">{fmtPct(l.porcentajeOcupacion)}</td>
                <td className="px-5 py-2">
                  <Badge
                    tone={
                      l.semaforo === "sobregirada"
                        ? "critical"
                        : l.semaforo === "rojo"
                          ? "danger"
                          : l.semaforo === "amarillo"
                            ? "warning"
                            : "success"
                    }
                  >
                    {l.semaforo}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}

function IssuesCard() {
  const { data } = useExcelStore();
  const issues = data!.report.issues;
  if (issues.length === 0) return null;
  const top = issues.slice(0, 20);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Detalle de issues (primeros 20)</CardTitle>
        <CardDescription>
          Eventos detectados durante el parseo. La columna &quot;Origen&quot; permite saltar a la
          celda exacta del Excel.
        </CardDescription>
      </CardHeader>
      <CardBody className="p-0">
        <table className="w-full text-sm">
          <thead className="text-xs text-[--color-fg-muted] uppercase tracking-wider">
            <tr className="border-b border-[--color-border]">
              <th className="text-left font-medium px-5 py-2.5">Tipo</th>
              <th className="text-left font-medium px-5 py-2.5">Origen</th>
              <th className="text-left font-medium px-5 py-2.5">Mensaje</th>
            </tr>
          </thead>
          <tbody>
            {top.map((i, idx) => (
              <tr key={idx} className="border-b border-[--color-border] last:border-0">
                <td className="px-5 py-2">
                  <Badge tone={i.tipo === "vin_duplicado" ? "warning" : "muted"}>{i.tipo}</Badge>
                </td>
                <td className="px-5 py-2 mono text-xs text-[--color-fg-muted]">
                  {i.hoja}
                  {i.fila ? `:r${i.fila}` : ""}
                  {i.columna ? `:${i.columna}` : ""}
                </td>
                <td className="px-5 py-2 text-xs">{i.mensaje}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {issues.length > 20 && (
          <div className="px-5 py-2 text-xs text-[--color-fg-muted] border-t border-[--color-border]">
            … +{issues.length - 20} issues más
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function NextStepsCard() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Database className="size-4 text-[--color-fg-muted]" />
          <CardTitle>¿Listo para habilitar dashboards?</CardTitle>
        </div>
      </CardHeader>
      <CardBody>
        <div className="text-sm text-[--color-fg-muted]">
          Las vistas ejecutivas (Dashboard, Líneas, Stock Explorer, Capital de Trabajo, TESCAR,
          Alertas) ya están conectadas al dataset, pero recomendamos validar primero los puntos
          de arriba. Si las diferencias contra el resumen oficial son aceptables, avanza a las
          vistas ejecutivas desde el menú lateral.
        </div>
      </CardBody>
    </Card>
  );
}
