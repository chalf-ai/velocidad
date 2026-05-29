"use client";

/**
 * FICHA OPERACIONAL VIVA DEL VIN — vista unificada del caso dentro del drill.
 *
 * Consume la capa madre (CasoOperacionalUnificado) + el VehiculoUnificado que ya
 * trae el drill. NO duplica lógica ni crea otra fuente de verdad: arma 4 bloques
 * (resumen ejecutivo · línea de tiempo · capas · diagnóstico del quiebre) leyendo
 * lo que YA existe (stock, FNE, inscripción, logística, saldos, gestión, score).
 *
 * Tolerante a capas faltantes: cada bloque muestra "sin datos" si no aplica, sin
 * inventar nada. NO toca score, detecciones, filtros ni gestión persistente.
 */

import { useMemo } from "react";
import Link from "next/link";
import {
  Activity,
  Banknote,
  Car,
  ClipboardCheck,
  Clock,
  ExternalLink,
  FileText,
  MapPin,
  Truck,
  User,
} from "lucide-react";
import { Flame } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { fmtCLPCompact } from "@/lib/format";
import { useExcelStore } from "@/lib/store";
import { useGestionStore } from "@/lib/gestion/store";
import {
  resolverCasoVIN,
  explicarCasoOperacional,
  ESTADO_FISICO_LABEL,
  type EstadoFisicoVIN,
  type VerdadFisicaVIN,
} from "@/lib/caso-unificado";
import { calcularScore } from "@/lib/selectors/score";
import { construirCaso, esMaximaAlertaDe, factoresCriticosDe } from "@/lib/gestion/caso";
import { PresionOperacional, NivelPill } from "@/components/PresionOperacional";
import { RazonesScore, ComponentesBars } from "@/components/RazonesScore";
import { MesaGestionCaso } from "@/components/MesaGestionCaso";
import {
  resolverOrigenPuente,
  indexarFNEPorOrigen,
  type OrigenPuente,
} from "@/lib/selectors/vu-en-fne";
import { limpiarVIN } from "@/lib/parser/venta-apc";
import { useCasoModal } from "@/lib/caso-modal";
import { BLOQUEO_LOGISTICO_LABEL, explicarCasoLogistico } from "@/lib/logistica/modelo";
import { ESTADO_GESTION_LABEL } from "@/lib/gestion/types";

const fechaTxt = (d: Date | null | undefined): string =>
  d instanceof Date && !isNaN(d.getTime())
    ? d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "sin dato";

/** Autocontenida: resuelve el caso + su VehiculoUnificado desde el VIN. */
export function FichaOperacionalVIN({ vin }: { vin: string }) {
  const data = useExcelStore((s) => s.data);
  const fne = useExcelStore((s) => s.fne);
  const saldos = useExcelStore((s) => s.saldos);
  const provisiones = useExcelStore((s) => s.provisiones);
  const logisticaPorVin = useExcelStore((s) => s.logisticaPorVin);
  const gestion = useGestionStore((s) => s.byVin[vin]);

  // Resuelve caso + vu en UNA construcción (sin depender de gestión: se lee viva).
  const resuelto = useMemo(
    () =>
      data
        ? resolverCasoVIN(vin, { data, fne, saldos, provisiones, logisticaPorVin, gestionMap: {} })
        : null,
    [vin, data, fne, saldos, provisiones, logisticaPorVin],
  );
  const op = logisticaPorVin?.get(vin) ?? null;

  // Capital puente: estado del ORIGEN (operación nueva). Cola de higiene, no error.
  const puenteOrigen = useMemo<OrigenPuente | null>(() => {
    if (!resuelto || !resuelto.vu.esVPP || !data) return null;
    const rawV = data.vehiculos.find((v) => limpiarVIN(v.vin) === resuelto.vu.vinLimpio);
    if (!rawV) return null;
    return resolverOrigenPuente(rawV, indexarFNEPorOrigen(fne?.registros ?? []));
  }, [resuelto, data, fne]);

  // VIN no encontrado en stock/FNE/saldos → mensaje claro (no queda en blanco).
  if (!resuelto) {
    const enLog = !!op;
    return (
      <div className="rounded-2xl border border-[--color-border] bg-white p-5">
        <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.16em] text-[--color-fg-muted] font-semibold">
          <FileText className="size-4" strokeWidth={2} /> Ficha operacional del VIN
        </div>
        <div className="mt-3 text-[13px] text-[--color-fg]">
          <span className="mono font-semibold">{vin}</span> — VIN no encontrado en las fuentes
          cargadas (stock / FNE / saldos).
        </div>
        {enLog && (
          <div className="text-[12px] text-[--color-fg-muted] mt-1">
            Existe en el histórico logístico (dic–may), fuera del universo vivo actual.
          </div>
        )}
        {gestion && (
          <div className="text-[12px] text-[--color-fg-muted] mt-1">
            Tiene gestión registrada (responsable / notas) — se conserva por VIN.
          </div>
        )}
      </div>
    );
  }
  const { caso, vu } = resuelto;

  // ── SCORE / CASO VIVO — la MISMA inteligencia que usa el Centro de Acción.
  // calcularScore + construirCaso son puros y baratos; se reevalúan con la
  // gestión viva (próxima acción, prioridad) SIN reconstruir el universo. Esta
  // es la ÚNICA fuente de presión/score/factores/acción del VIN (no paralela).
  const ahora = new Date();
  const scoreVivo = calcularScore(vu);
  const casoVivo = construirCaso(vu, scoreVivo, gestion ?? null, ahora, op);
  const factoresCriticos = factoresCriticosDe(vu);
  const maximaAlerta = esMaximaAlertaDe(vu) || casoVivo.esMaximaAlerta;

  const { identidad: id, comercial: com, financiero: fin, inscripcion: ins, operacional: ope } = caso;
  const log = caso.logistica?.resumen ?? null;
  const proximaAccion = casoVivo.proximaAccion ?? "—";
  const ownerDom = log?.ownerLogistico ?? null;

  // ── Línea de tiempo (hitos reales, sin inventar fechas) ──────────────────
  // La fuente se lee desde `op.fuentesPorHito` (modelo ROMIA): cuando ROMIA
  // aportó el dato, muestra KAR/SCHIAPP; si fue fallback legacy, muestra ROMA/STLI;
  // los hitos FNE mantienen su etiqueta "FNE" (la fecha viene del archivo Actas).
  type ConfianzaUI = "alta" | "media" | "baja" | "ninguna";
  const labelFuente = (f: import("@/lib/logistica/romia-tipos").FuenteHito | undefined): string => {
    switch (f) {
      case "ROMIA_KAR": return "KAR";
      case "ROMIA_SCHIAPP": return "SCHIAPP";
      case "LEGACY_ROMA": return "ROMA";
      case "LEGACY_STLI": return "STLI";
      case "FNE": return "FNE";
      default: return "—";
    }
  };
  const fuenteDe = (key: import("@/lib/logistica/modelo").HitoLogistico) => {
    const m = op?.fuentesPorHito?.[key];
    return { label: labelFuente(m?.fuente), confianza: (m?.confianza ?? "ninguna") as ConfianzaUI };
  };
  const hitoOp = (
    label: string,
    key: import("@/lib/logistica/modelo").HitoLogistico,
    fecha: Date | null,
    extra?: { compromiso?: boolean },
  ) => {
    const meta = fuenteDe(key);
    return { label, fecha, fuente: meta.label, confianza: meta.confianza, ...extra };
  };

  const hitos: { label: string; fecha: Date | null; fuente: string; confianza?: ConfianzaUI; compromiso?: boolean }[] = [
    hitoOp("Ingreso APC / preparación", "ingreso_apc", op?.fIngresoApc ?? null),
    hitoOp("Solicitud del vendedor", "solicitud_vendedor", op?.fSolicitudVendedor ?? null),
    hitoOp("Respuesta de logística", "respuesta_logistica", op?.fRespuestaLogistica ?? null),
    hitoOp("Solicitud a bodega", "solicitud_bodega", op?.fSolicitudBodega ?? null),
    hitoOp("Despacho a sucursal", "despacho", op?.fDespacho ?? null),
    hitoOp("Llegada a sucursal", "llegada_sucursal", op?.fLlegadaSucursal ?? null),
    { label: "Factura a cliente", fecha: com.fechaFactura, fuente: "FNE", confianza: "alta" },
    { label: "Inscripción", fecha: ins.fechaInscripcion, fuente: "FNE", confianza: "alta" },
    hitoOp("Entrega comprometida", "entrega_comprometida", com.fechaEntregaComprometida, { compromiso: true }),
    { label: "Entrega real", fecha: com.fechaEntregaReal, fuente: "—", confianza: "ninguna" },
  ];
  const hoy = Date.now();
  const estadoHito = (h: (typeof hitos)[number]): "ok" | "vencido" | "sin" => {
    if (!h.fecha) return "sin";
    if (h.compromiso && h.fecha.getTime() < hoy && !com.entregado) return "vencido";
    return "ok";
  };

  return (
    <div className="rounded-2xl border border-[--color-border] bg-white p-5 space-y-5">
      <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.16em] text-[--color-accent] font-semibold">
        <FileText className="size-4" strokeWidth={2} /> Ficha operacional del VIN
      </div>

      {/* ── 1 · Identidad ── */}
      <div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[16px] font-semibold text-[--color-fg]">
            {id.marcaOperacional} {id.modelo ? `· ${id.modelo}` : ""}
          </span>
          <span className="mono text-[11px] text-[--color-fg-muted]">{id.vin}</span>
          {id.patente && <Badge tone="muted" size="xs">{id.patente}</Badge>}
          <NivelPill severidad={scoreVivo.severidad} />
          {maximaAlerta && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-[--color-danger]/12 text-[--color-danger] border border-[--color-danger]/30"
              title={factoresCriticos.map((f) => f.label).join(" · ")}
            >
              <Flame className="size-3" /> Máxima alerta · {factoresCriticos.length} factores
            </span>
          )}
        </div>
        <div className="text-[12px] text-[--color-fg-muted] mt-1">
          {id.sucursal ?? "—"}
          {id.cliente ? ` · ${id.cliente}` : ""}
          {id.vendedor ? ` · vendedor ${id.vendedor}` : ""}
        </div>
      </div>

      {/* ── 2 · PRESIÓN OPERACIONAL (bloque principal del caso) ── */}
      <div>
        <PresionOperacional score={scoreVivo} />
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <ResumenKpi label="Capital retenido" valor={fin.capitalRetenido > 0 ? fmtCLPCompact(fin.capitalRetenido) : "—"} tono={fin.capitalRetenido > 0 ? "danger" : "muted"} />
          <ResumenKpi label="Días detenido" valor={casoVivo.aging > 0 ? `${casoVivo.aging}d` : "—"} tono={casoVivo.aging > 180 ? "danger" : undefined} />
          <ResumenKpi label="Owner" valor={ownerDom ?? "—"} />
          <ResumenKpi label="Score logístico" valor={casoVivo.logistica != null ? `${casoVivo.logistica.score}/100` : "s/d"} />
        </div>
        <div className="mt-2 text-[12.5px] text-[--color-accent] font-medium flex items-center gap-1">
          → {proximaAccion}
        </div>
      </div>

      {/* ── 3 · POR QUÉ PESA ESTE CASO (factores del score vivo) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <SectionTitle icon={<Activity className="size-3.5" />}>Por qué pesa este caso</SectionTitle>
          <div className="mt-2">
            <RazonesScore score={scoreVivo} />
          </div>
        </div>
        <div>
          <SectionTitle icon={<Activity className="size-3.5" />}>Componentes de presión</SectionTitle>
          <div className="mt-2">
            <ComponentesBars score={scoreVivo} />
          </div>
        </div>
      </div>

      {/* ── CAPITAL PUENTE · estado del origen (cola de higiene, no error) ── */}
      {ope.esCapitalPuente && puenteOrigen && (
        <PuenteOrigenBlock
          origen={puenteOrigen}
          ownerSecundario={[vu.vendedor, vu.sucursal].filter(Boolean).join(" · ") || null}
        />
      )}

      {/* ── VERDAD FÍSICA DEL VIN (señal única consolidada) ── */}
      <VerdadFisicaBlock vf={caso.verdadFisica} />

      {/* ── 4 · Diagnóstico del quiebre (arriba: lo más importante) ── */}
      <div className="rounded-lg border border-[--color-warning]/30 bg-[--color-warning]/[0.05] px-4 py-3">
        <div className="text-[10px] uppercase tracking-[0.14em] text-[--color-warning] font-semibold mb-1">
          Diagnóstico del quiebre
        </div>
        {/* ANOMALÍA: patente recibida en sucursal + auto sin despacho físico = el
            sistema dice "listo para entregar" pero el auto no salió de bodega. */}
        {ins.patenteEnSucursal && op?.tieneSinSalida && !op.fSalidaPatio && (
          <div className="rounded-md border border-[--color-danger]/40 bg-[--color-danger]/[0.08] px-3 py-2 mb-2">
            <div className="text-[12.5px] font-semibold text-[--color-danger] flex items-center gap-1.5">
              <Flame className="size-3.5" /> Anomalía documento ≠ físico
            </div>
            <div className="text-[11.5px] text-[--color-fg] mt-1 leading-relaxed">
              La patente fue recibida en sucursal, pero el auto sigue en patio bodega ({op.bodegaOrigen ?? "—"})
              marcado &ldquo;SIN SALIDA&rdquo;. El sistema lo trata como &ldquo;listo para entregar&rdquo;
              pero <strong>físicamente no está en la sucursal</strong>.
            </div>
          </div>
        )}
        {log && explicarCasoLogistico(op!) ? (
          <div className="text-[12.5px] text-[--color-fg] leading-relaxed">{explicarCasoLogistico(op!)}</div>
        ) : ope.bloqueado ? (
          <div className="text-[12.5px] text-[--color-fg] leading-relaxed">
            Detenido en: {ope.causaBloqueo ?? "—"} · aging {ope.agingEtapa}d.
          </div>
        ) : (
          <div className="text-[12.5px] text-[--color-fg-muted]">Sin bloqueo operacional detectado.</div>
        )}
        <div className="text-[11.5px] text-[--color-fg-muted] mt-1.5">
          Capital retenido <span className="font-semibold text-[--color-fg]">{fin.capitalRetenido > 0 ? fmtCLPCompact(fin.capitalRetenido) : "—"}</span>
          {" · "}detenido <span className="font-semibold text-[--color-fg]">{ope.agingEtapa}d</span>
          {ownerDom ? <> · responsable <span className="font-semibold text-[--color-fg]">{ownerDom}</span></> : null}
        </div>
        <div className="text-[10.5px] text-[--color-fg-dim] mt-1.5 italic">{explicarCasoOperacional(caso)}</div>
      </div>

      {/* ── 2 · Línea de tiempo ── */}
      <div>
        <SectionTitle icon={<Clock className="size-3.5" />}>Línea de tiempo operacional</SectionTitle>
        <ol className="mt-2 space-y-1">
          {hitos.map((h) => {
            const e = estadoHito(h);
            const color = e === "vencido" ? "var(--color-danger)" : e === "ok" ? "#0f7a59" : "var(--color-fg-dim)";
            // Caso especial: despacho con "SIN SALIDA" — auto declarado sin salida.
            const esDespachoSinSalida = h.label === "Despacho a sucursal" && !h.fecha && op?.tieneSinSalida;
            return (
              <li key={h.label} className="flex items-center gap-2.5 text-[12px]">
                <span className="size-2 rounded-full shrink-0" style={{ background: esDespachoSinSalida ? "var(--color-warning)" : color }} />
                <span className="w-52 shrink-0 text-[--color-fg]">{h.label}</span>
                <span className="w-24 shrink-0 mono text-[--color-fg-muted]">{fechaTxt(h.fecha)}</span>
                <span
                  className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-[--color-fg-dim]"
                  title={h.confianza === "ninguna" ? "Sin dato" : `Confianza ${h.confianza}`}
                >
                  {h.fuente}
                </span>
                {h.confianza === "media" && h.fecha && (
                  <Badge tone="info" size="xs">proxy</Badge>
                )}
                {h.confianza === "baja" && h.fecha && (
                  <Badge tone="warning" size="xs">inferido</Badge>
                )}
                {e === "vencido" && <Badge tone="danger" size="xs">vencido</Badge>}
                {esDespachoSinSalida && <Badge tone="warning" size="xs">SIN SALIDA</Badge>}
                {e === "sin" && !esDespachoSinSalida && <span className="text-[10.5px] text-[--color-fg-dim]">pendiente / sin dato</span>}
              </li>
            );
          })}
        </ol>
      </div>

      {/* ── 3 · Capas del caso ── */}
      <div>
        <SectionTitle icon={<Activity className="size-3.5" />}>Capas del caso</SectionTitle>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
          <CapaCard icon={<Car className="size-3.5" />} titulo="Stock" presente={caso.capas.includes("stock")}>
            <Linea k="Ubicación" v={vu.sucursal ?? "—"} />
            {vu.bodega && vu.bodega !== vu.sucursal && <Linea k="Bodega" v={vu.bodega} />}
            <Linea k="Días stock" v={vu.diasStock != null ? `${vu.diasStock}d` : "—"} />
            <Linea k="Tipo" v={fin.stockPagado ? "Pagado" : fin.financiado ? "Financiado" : (vu.tipoStock ?? "—")} />
            <Linea k="Costo" v={vu.costoNeto > 0 ? fmtCLPCompact(vu.costoNeto) : "—"} />
            {fin.lineaMarca && <Linea k="Línea" v={`${fin.lineaMarca}${fin.lineaDiasParaVencer != null ? ` · vence ${fin.lineaDiasParaVencer}d` : ""}`} />}
          </CapaCard>

          <CapaCard icon={<Truck className="size-3.5" />} titulo="FNE / entrega" presente={com.enFNE}>
            <Linea k="Estado FNE" v={vu.fneEstado ? vu.fneEstado.replaceAll("_", " ") : "—"} />
            <Linea k="Días en estado" v={vu.fneDiasEnEstado != null ? `${vu.fneDiasEnEstado}d` : "—"} />
            <Linea k="Listo entregar" v={ope.listoParaEntregar ? "Sí" : "No"} />
            <Linea k="Factura" v={fechaTxt(com.fechaFactura)} />
            <Linea k="Entrega comprom." v={fechaTxt(com.fechaEntregaComprometida)} />
            <Linea k="Valor factura" v={vu.fneValorFactura > 0 ? fmtCLPCompact(vu.fneValorFactura) : "—"} />
          </CapaCard>

          <CapaCard icon={<ClipboardCheck className="size-3.5" />} titulo="Inscripción / patente" presente={com.enFNE}>
            <Linea k="Solicitud inscr." v={ins.solicitarInscripcion == null ? "—" : ins.solicitarInscripcion ? "Sí" : "No"} />
            <Linea k="Inscripción" v={fechaTxt(ins.fechaInscripcion)} />
            <Linea k="Patente en tránsito" v={ins.patenteEnTransito ? "Sí" : "No"} />
            <Linea k="Patente en sucursal" v={ins.patenteEnSucursal ? "Sí" : "No"} />
            <Linea k="Falta autorización" v={ins.faltaAutorizacion ? "Sí" : "No"} tono={ins.faltaAutorizacion ? "danger" : undefined} />
          </CapaCard>

          <CapaCard icon={<Truck className="size-3.5" />} titulo="Logística" presente={!!log}>
            {log ? (
              <>
                <Linea k="Estado" v={log.estadoLabel} />
                <Linea k="Higiene" v={log.higiene} />
                <Linea k="Score log." v={`${log.score}/100`} />
                <Linea k="Aging etapa" v={log.aging != null ? `${log.aging}d` : "—"} />
                <Linea k="Owner" v={log.ownerLogistico ?? "—"} />
                {log.bloqueos.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {log.bloqueos.map((b) => (
                      <Badge key={b} tone="warning" size="xs">{BLOQUEO_LOGISTICO_LABEL[b]}</Badge>
                    ))}
                  </div>
                )}
              </>
            ) : null}
          </CapaCard>

          {/* ── Bodega ROMIA (modelo nuevo SCHIAPP/KAR) ── */}
          {op?.bodegaOrigen && (
            <CapaCard
              icon={<Truck className="size-3.5" />}
              titulo={`Bodega · ${op.bodegaOrigen}`}
              presente
            >
              {op.estadoBodega && <Linea k="Estado bodega" v={op.estadoBodega} />}
              {op.patio && <Linea k="Patio" v={op.patio} />}
              {op.puntoEntrega && <Linea k="Punto entrega" v={op.puntoEntrega} />}
              {op.fEntradaPatio && <Linea k="Entrada al patio" v={fechaTxt(op.fEntradaPatio)} />}
              {op.fSalidaPatio && <Linea k="Salida del patio" v={fechaTxt(op.fSalidaPatio)} />}
              {op.fechaLimite && <Linea k="Fecha límite" v={fechaTxt(op.fechaLimite)} />}
              {op.cumplimientoDespacho && (
                <Linea
                  k="Cumplimiento"
                  v={op.cumplimientoDespacho}
                  tono={/no\s*cumplido/i.test(op.cumplimientoDespacho) ? "danger" : undefined}
                />
              )}
              {op.numTraslados != null && op.numTraslados > 1 && (
                <Linea k="Traslados" v={`${op.numTraslados} (reasignado)`} tono="warning" />
              )}
              {op.transportistaSalida && <Linea k="Transportista" v={op.transportistaSalida} />}
              {op.tieneSinSalida && (
                <div className="text-[11px] text-[--color-warning] font-medium pt-1">
                  ⚠ Marcado &ldquo;SIN SALIDA&rdquo; — auto físico aún en patio.
                </div>
              )}
            </CapaCard>
          )}

          <CapaCard icon={<Banknote className="size-3.5" />} titulo="Saldos" presente={caso.capas.includes("saldos")}>
            <Linea k="Saldo cliente" v={fin.saldoCliente > 0 ? fmtCLPCompact(fin.saldoCliente) : "—"} tono={fin.saldoCliente > 0 ? "warning" : undefined} />
            <Linea k="Crédito Pompeyo" v={fin.creditoPompeyo > 0 ? fmtCLPCompact(fin.creditoPompeyo) : "—"} tono={fin.creditoPompeyo > 0 ? "danger" : undefined} />
          </CapaCard>

          <CapaCard icon={<Car className="size-3.5" />} titulo="Capital puente / usados" presente={ope.esCapitalPuente || ope.esUsado}>
            <Linea k="Capital puente (VPP)" v={ope.esCapitalPuente ? "Sí" : "No"} />
            <Linea k="Usado" v={ope.esUsado ? "Sí" : "No"} />
            {ope.categoriaUsado && <Linea k="Categoría" v={ope.categoriaUsado.replace("USADOS_", "").replaceAll("_", " ")} />}
            {ope.esCapitalPuente && (
              <>
                <Linea k="Owner operacional" v="USADOS (gestiona el activo)" />
                <Linea k="Originador (consumió caja)" v={vu.marcaOriginadora ?? id.marcaOperacional} />
              </>
            )}
          </CapaCard>

          <CapaCard icon={<User className="size-3.5" />} titulo="Gestión" presente={!!gestion}>
            {gestion ? (
              <>
                <Linea k="Responsable" v={gestion.responsable ?? "—"} />
                <Linea k="Estado" v={ESTADO_GESTION_LABEL[gestion.estadoGestion ?? "abierto"]} />
                <Linea k="Compromiso" v={gestion.fechaCompromiso ?? "—"} />
                <Linea k="Prioridad" v={gestion.prioridadManual ?? "Auto"} />
                {gestion.comentario && <Linea k="Comentario" v={gestion.comentario} />}
              </>
            ) : (
              <div className="text-[11.5px] text-[--color-fg-dim]">Sin gestión registrada (editá abajo en la mesa de control).</div>
            )}
          </CapaCard>
        </div>
      </div>

      {/* ── MESA DE GESTIÓN DEL CASO (gestión viva, editable, persistente) ── */}
      <div className="rounded-2xl border border-[--color-border] bg-gradient-to-b from-white to-[--color-bg-elev-2] p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3.5">
          <span className="inline-flex items-center justify-center size-6 rounded-lg bg-[--color-accent]/10 text-[--color-accent]">
            <Activity className="size-3.5" />
          </span>
          <div>
            <div className="text-[12px] font-semibold text-[--color-fg] leading-none">
              Mesa de gestión del caso
            </div>
            <div className="text-[10px] text-[--color-fg-dim] mt-0.5">
              Responsable · prioridad · compromiso · próxima acción · bitácora — se guarda por VIN
            </div>
          </div>
        </div>
        <MesaGestionCaso vin={id.vin} score={scoreVivo} />
      </div>

      {/* Navegación contextual: abrir el MISMO VIN en otros módulos (secundario). */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="text-[10px] uppercase tracking-[0.12em] text-[--color-fg-dim] font-semibold mr-1">
          Abrir en módulo
        </span>
        <NavVin href={`/stock?q=${enc(id.vin)}&dup=1&vin=${enc(id.vin)}`} label="Stock" />
        {com.enFNE && <NavVin href={`/facturados-no-entregados?vin=${enc(id.vin)}`} label="FNE" />}
        {caso.capas.includes("saldos") && <NavVin href={`/saldos?vin=${enc(id.vin)}`} label="Saldos" />}
        {ope.esUsado && <NavVin href={`/usados?vin=${enc(id.vin)}`} label="Usados" />}
        {ope.esCapitalPuente && <NavVin href={`/vu-en-fne?vin=${enc(id.vin)}`} label="Capital puente" />}
        <NavVin href={`/provisiones?vin=${enc(id.vin)}`} label="Provisiones (marca)" />
      </div>
    </div>
  );
}

const enc = (s: string) => encodeURIComponent(s);

function NavVin({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[--color-border] text-[11.5px] text-[--color-fg-muted] hover:text-[--color-accent] hover:border-[--color-accent]/40 transition"
    >
      {label} <ExternalLink className="size-3" />
    </Link>
  );
}

const FISICO_TONE: Record<EstadoFisicoVIN, "success" | "info" | "warning" | "danger" | "muted"> = {
  en_sucursal: "success",
  entregado: "success",
  en_transito: "info",
  en_bodega: "muted",
  despachado_no_recepcionado: "danger",
  inconsistente: "danger",
  desconocido: "muted",
};

/** Bloque de estado del ORIGEN del capital puente — cola de higiene, no error. */
function PuenteOrigenBlock({
  origen,
  ownerSecundario,
}: {
  origen: OrigenPuente;
  ownerSecundario: string | null;
}) {
  const abrir = useCasoModal((s) => s.abrir);

  if (origen.estado === "origen_enriquecido" && origen.nuevoVin) {
    const color = "#0d9488";
    return (
      <div className="rounded-lg border px-4 py-3" style={{ borderColor: `${color}40`, background: `${color}0d` }}>
        <div className="text-[10px] uppercase tracking-[0.14em] font-semibold" style={{ color }}>
          Capital puente · origen operacional vinculado
        </div>
        <div className="text-[12.5px] text-[--color-fg] mt-1 leading-relaxed">
          VU/BU recibido en una operación nueva. El caso a gestionar es la operación originadora —
          VIN nuevo <span className="mono">{origen.nuevoVin}</span>
          {origen.fne?.cliente ? ` · ${origen.fne.cliente}` : ""}.
        </div>
        <div className="text-[11.5px] text-[--color-fg-muted] mt-1">
          Owner: <span className="text-[--color-fg]">USADOS</span> (gestiona el activo)
          {ownerSecundario ? <> · <span className="text-[--color-fg]">{ownerSecundario}</span></> : null}
        </div>
        <button
          onClick={() => abrir(origen.nuevoVin as string, "Operación origen · capital puente")}
          className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium"
          style={{ color }}
        >
          → Abrir caso origen
        </button>
      </div>
    );
  }

  if (origen.estado === "origen_pendiente_regularizar") {
    return (
      <div
        className="rounded-lg border px-4 py-3"
        style={{ borderColor: "rgba(180,83,9,0.30)", background: "rgba(180,83,9,0.06)" }}
      >
        <div className="text-[10px] uppercase tracking-[0.14em] font-semibold" style={{ color: "#b45309" }}>
          Capital puente válido · origen pendiente de regularizar
        </div>
        <div className="text-[12.5px] text-[--color-fg] mt-1 leading-relaxed">
          VU/BU validado por Base_Stock (retoma, patente, monto, marca originadora). Falta vincular la
          operación nueva: probable BPP/VPP no ingresado en la venta, facturación con Crédito Pompeyo
          en vez de BPP, nota de venta sin el VU recibido, o sin PatenteVpp en FNE. No es un error de
          capital — es trabajo de regularización.
        </div>
        <div className="text-[11.5px] text-[--color-fg-muted] mt-1">
          Responsable: <span className="text-[--color-fg]">USADOS</span>
          {ownerSecundario ? (
            <> + <span className="text-[--color-fg]">{ownerSecundario}</span></>
          ) : (
            <> + vendedor / jefe local</>
          )}
        </div>
        <div className="text-[12px] mt-1.5 font-medium" style={{ color: "#b45309" }}>
          → Revisar nota de venta / BPP ingresado / PatenteVpp en FNE y regularizar el origen.
        </div>
      </div>
    );
  }

  // conciliacion_real (excepción): faltan señales base.
  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{ borderColor: "rgba(220,38,38,0.30)", background: "rgba(220,38,38,0.05)" }}
    >
      <div className="text-[10px] uppercase tracking-[0.14em] font-semibold" style={{ color: "var(--color-danger)" }}>
        Capital puente · conciliación técnica
      </div>
      <div className="text-[12.5px] text-[--color-fg] mt-1 leading-relaxed">
        Faltan señales base (fecha/folio retoma, patente o tipo BU). Revisar la integridad del
        registro antes de gestionar el activo.
      </div>
    </div>
  );
}

function VerdadFisicaBlock({ vf }: { vf: VerdadFisicaVIN }) {
  const danger = vf.estado === "inconsistente" || vf.estado === "despachado_no_recepcionado";
  const color = danger
    ? "var(--color-danger)"
    : vf.estado === "en_sucursal" || vf.estado === "entregado"
      ? "#0f7a59"
      : "var(--color-warning)";
  return (
    <div className="rounded-lg border px-4 py-3" style={{ borderColor: `${color}55`, background: `${color}0d` }}>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
        <div className="flex items-center gap-2">
          <MapPin className="size-3.5" style={{ color }} />
          <span className="text-[10px] uppercase tracking-[0.14em] font-semibold" style={{ color }}>
            Verdad física del VIN
          </span>
        </div>
        <Badge tone={FISICO_TONE[vf.estado]} size="xs">{ESTADO_FISICO_LABEL[vf.estado]}</Badge>
      </div>
      <div className="text-[12.5px] text-[--color-fg] leading-relaxed">{vf.detalle}</div>
      <div className="text-[11.5px] text-[--color-fg-muted] mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {vf.fuentes.length > 0 && <span>Fuentes: {vf.fuentes.join(", ")}</span>}
        <span>Confianza: <span className="text-[--color-fg]">{vf.confianza}</span></span>
        {vf.owner && <span>Responsable: <span className="text-[--color-fg]">{vf.owner}</span></span>}
      </div>
      {vf.contradicciones.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {vf.contradicciones.map((c, i) => (
            <li key={i} className="text-[11px]" style={{ color: "var(--color-danger)" }}>⚠ {c}</li>
          ))}
        </ul>
      )}
      <div className="text-[12px] mt-1.5 font-medium" style={{ color }}>→ {vf.accion}</div>
    </div>
  );
}

function ResumenKpi({ label, valor, tono }: { label: string; valor: string; tono?: "danger" | "muted" }) {
  const color = tono === "danger" ? "var(--color-danger)" : "var(--color-fg)";
  return (
    <div className="rounded-lg border border-[--color-border-soft] bg-[--color-bg-elev-1]/40 px-3 py-2">
      <div className="text-[9.5px] uppercase tracking-wide text-[--color-fg-muted] font-medium leading-[1.2]">{label}</div>
      <div className="text-[14px] font-semibold mt-1 leading-none truncate" style={{ color }}>{valor}</div>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-[--color-fg-muted] font-semibold">
      {icon} {children}
    </div>
  );
}

function CapaCard({
  icon,
  titulo,
  presente,
  children,
}: {
  icon: React.ReactNode;
  titulo: string;
  presente: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-lg border px-3 py-2.5", presente ? "border-[--color-border] bg-white" : "border-[--color-border-soft] bg-[--color-bg-elev-1]/30")}>
      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[--color-fg] mb-1.5">
        <span className="text-[--color-fg-muted]">{icon}</span>
        {titulo}
        {!presente && <span className="ml-auto text-[10px] text-[--color-fg-dim] font-normal">sin datos</span>}
      </div>
      {presente ? <div className="space-y-0.5">{children}</div> : null}
    </div>
  );
}

function Linea({ k, v, tono }: { k: string; v: string; tono?: "danger" | "warning" }) {
  const color = tono === "danger" ? "var(--color-danger)" : tono === "warning" ? "var(--color-warning)" : "var(--color-fg)";
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
      <span className="text-[--color-fg-muted] shrink-0">{k}</span>
      <span className="text-right truncate" style={{ color }}>{v}</span>
    </div>
  );
}
