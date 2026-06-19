"use client";

import { useMemo, useRef, useState } from "react";
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Trash2,
  Warehouse,
  Truck,
  Receipt,
  ClipboardList,
  TestTube2,
  Loader2,
  PackageCheck,
  CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtNum, fmtDate, fmtBytes } from "@/lib/format";
import { useIngestaStore, type FuenteId, type IngestaMeta } from "@/lib/ingesta/store";
import {
  procesarArchivo,
  limpiarFuente,
  limpiarTodo,
  resumenCortes,
  type IngestaResultado,
} from "@/lib/ingesta/procesar";
import { FUENTE_LABEL } from "@/lib/parser/detectar-fuente";

interface CardDef {
  /** ID lógico de la card. Los agrupados ("logistica", "logistica_romia")
   *  no son FuenteId reales — se resuelven vía `subs`. */
  id: FuenteId | "logistica" | "logistica_romia";
  label: string;
  desc: string;
  icon: typeof Warehouse;
  subs?: FuenteId[];
}

const CARDS: CardDef[] = [
  { id: "stock", label: "Stock", desc: "Base_Stock + líneas + TestCars", icon: Warehouse },
  { id: "fne", label: "FNE", desc: "Facturados no entregados (ROMA)", icon: Truck },
  { id: "saldos", label: "Saldos / SALVING", desc: "FUSION BD 3.0", icon: Receipt },
  { id: "provisiones", label: "Provisiones", desc: "No facturadas / facturadas", icon: ClipboardList },
  { id: "logistica_romia", label: "Logística ROMIA", desc: "SCHIAPPACASSE + KAR-LOGISTICS (modelo nuevo)", icon: Truck, subs: ["romia_schiapp", "romia_kar"] },
  { id: "logistica", label: "Logística (legacy)", desc: "ROMA (agenda) + STLI (bodega) · fallback", icon: Truck, subs: ["logistica_roma", "logistica_stli"] },
  // Universo documental histórico — alimenta la Vista Histórica /velocidad-operacional.
  { id: "actas", label: "Actas (histórico)", desc: "Universo documental · alimenta Vista Histórica", icon: PackageCheck },
  { id: "tescar", label: "TESCAR", desc: "Demos TEST CARS + BDR (con Stock)", icon: TestTube2 },
];

export default function IngestaPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [resultados, setResultados] = useState<IngestaResultado[]>([]);
  const metas = useIngestaStore((s) => s.metas);

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setProcesando(true);
    const out: IngestaResultado[] = [];
    // Secuencial: los Excel grandes (stock ~22MB) no conviene parsearlos en paralelo.
    for (const f of arr) {
      out.push(await procesarArchivo(f));
    }
    setResultados(out);
    setProcesando(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) void handleFiles(e.dataTransfer.files);
  };
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) void handleFiles(e.target.files);
    if (inputRef.current) inputRef.current.value = "";
  };

  const cortes = useMemo(() => resumenCortes(metas), [metas]);
  const cargadas = Object.keys(metas).filter((k) => k !== "tescar").length;
  const faltantes = CARDS.filter((c) =>
    c.subs ? !c.subs.some((s) => metas[s]) : !metas[c.id as FuenteId],
  );

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-10 space-y-7 fade-in overflow-x-hidden lg:overflow-x-visible">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[--color-accent] font-semibold">
          <PackageCheck className="size-3.5" strokeWidth={2} />
          Hub maestro de ingesta operacional
        </div>
        <h1 className="text-[28px] font-semibold tracking-tight mt-2 leading-tight text-[--color-fg]">
          Ingesta Operacional
        </h1>
        <p className="text-[13px] text-[--color-fg-muted] mt-2 max-w-3xl leading-relaxed">
          Sube todos los Excel desde un solo lugar. El sistema detecta cada archivo por su
          estructura (hojas + columnas, no por el nombre), llama al parser correcto y actualiza la
          fuente correspondiente. Las fuentes que no reemplaces se mantienen cargadas.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-2xl border-2 border-dashed px-8 py-10 text-center transition",
          dragOver
            ? "border-[--color-accent] bg-[--color-accent]/[0.06]"
            : "border-[--color-border] bg-[--color-bg-elev-1]/40",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm,.xls"
          multiple
          className="hidden"
          onChange={onChange}
        />
        <div className="grid place-items-center size-12 rounded-xl bg-[--color-accent]/12 text-[--color-accent] mx-auto">
          {procesando ? <Loader2 className="size-6 animate-spin" /> : <UploadCloud className="size-6" strokeWidth={1.75} />}
        </div>
        <div className="text-[15px] font-semibold text-[--color-fg] mt-3">
          {procesando ? "Procesando archivos…" : "Arrastra tus Excel aquí"}
        </div>
        <div className="text-[12px] text-[--color-fg-muted] mt-1">
          Stock · FNE · Saldos · Provisiones · Logística (ROMA/STLI) · TESCAR (con Stock)
        </div>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={procesando}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[--color-accent] text-white text-[13px] font-medium px-4 py-2 hover:opacity-90 transition disabled:bg-[--color-accent-dim] disabled:text-[--color-accent] disabled:cursor-not-allowed disabled:ring-1 disabled:ring-inset disabled:ring-[--color-accent]/30"
        >
          <UploadCloud className="size-4" /> Subir archivos
        </button>
      </div>

      {/* Alerta: cortes no alineados (informativa, nunca bloquea) */}
      {!cortes.alineados && (
        <div className="rounded-xl border border-[--color-warning]/40 bg-[--color-warning]/[0.06] px-5 py-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-[#b45309]">
            <AlertTriangle className="size-4" /> Cortes no alineados ({cortes.spreadDias} días de diferencia)
          </div>
          <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-[12px] text-[--color-fg-muted]">
            {cortes.fechas
              .slice()
              .sort((a, b) => b.fecha.getTime() - a.fecha.getTime())
              .map((f) => (
                <div key={f.fuenteId} className="flex items-center justify-between gap-2">
                  <span>{FUENTE_LABEL[f.fuenteId]}</span>
                  <span className="mono text-[--color-fg]">{fmtDate(f.fecha)}</span>
                </div>
              ))}
          </div>
          <div className="text-[11.5px] text-[--color-fg-dim] mt-2 leading-snug">
            El sistema seguirá funcionando. Algunos cruces entre fuentes pueden quedar incompletos
            por la diferencia de fechas.
          </div>
        </div>
      )}

      {/* Resultado de la última ingesta */}
      {resultados.length > 0 && (
        <div className="surface bg-white px-5 py-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[--color-fg-muted] font-semibold mb-3">
            Resultado de la última carga · {resultados.length} archivo(s)
          </div>
          <div className="space-y-2">
            {resultados.map((r, i) => (
              <div key={`${r.archivoNombre}-${i}`} className="flex items-start gap-3 text-[12.5px]">
                {r.ok ? (
                  <CheckCircle2 className="size-4 text-[#0f7a59] mt-0.5 shrink-0" />
                ) : r.error ? (
                  <XCircle className="size-4 text-[--color-danger] mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle className="size-4 text-[--color-warning] mt-0.5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-[--color-fg] truncate">{r.archivoNombre}</span>
                    <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-[--color-bg-elev-1] text-[--color-fg-muted]">
                      {FUENTE_LABEL[r.tipo]}
                    </span>
                    {r.reemplazo && (
                      <span className="text-[10px] text-[--color-fg-dim]">· reemplazó carga anterior</span>
                    )}
                  </div>
                  <div className="text-[11px] text-[--color-fg-muted] mt-0.5">
                    {r.ok
                      ? `${fmtNum(r.registros)} registros${r.vins != null ? ` · ${fmtNum(r.vins)} VIN` : ""}${r.fechaCorte ? ` · corte ${fmtDate(r.fechaCorte)}` : ""}`
                      : r.error ?? r.advertencias.join(" · ")}
                  </div>
                  {r.ok && r.advertencias.length > 0 && (
                    <div className="text-[10.5px] text-[#b45309] mt-0.5">⚠ {r.advertencias.join(" · ")}</div>
                  )}
                  {!r.ok && r.motivoDeteccion && (
                    <div className="text-[10px] text-[--color-fg-dim] mt-0.5">{r.motivoDeteccion}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Estado por fuente */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-[16px] font-semibold tracking-tight text-[--color-fg]">
            Estado por fuente · {cargadas} cargada(s)
          </h2>
          {Object.keys(metas).length > 0 && (
            <button
              onClick={() => {
                limpiarTodo();
                setResultados([]);
              }}
              className="inline-flex items-center gap-1.5 text-[12px] text-[--color-danger] hover:underline"
            >
              <Trash2 className="size-3.5" /> Limpiar todo
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {CARDS.map((c) => (
            <FuenteCard key={c.id} def={c} metas={metas} onReemplazar={() => inputRef.current?.click()} />
          ))}
        </div>
      </div>

      {/* Fuentes faltantes (informativo) */}
      {faltantes.length > 0 && (
        <div className="text-[11.5px] text-[--color-fg-dim]">
          Fuentes sin cargar: {faltantes.map((f) => f.label).join(" · ")}. El sistema funciona igual
          con lo que esté disponible.
        </div>
      )}
    </div>
  );
}

function FuenteCard({
  def,
  metas,
  onReemplazar,
}: {
  def: CardDef;
  metas: Partial<Record<FuenteId, IngestaMeta>>;
  onReemplazar: () => void;
}) {
  const Icon = def.icon;
  // Logística combina dos sub-fuentes en una tarjeta.
  const subMetas: IngestaMeta[] = def.subs
    ? def.subs.map((s) => metas[s]).filter((m): m is IngestaMeta => !!m)
    : [];
  const meta = def.subs ? subMetas[0] : metas[def.id as FuenteId];
  const cargado = def.subs ? subMetas.length > 0 : !!meta;
  const advertencias = def.subs ? subMetas.flatMap((m) => m.advertencias) : meta?.advertencias ?? [];
  const hayAdv = advertencias.length > 0;

  const estadoColor = !cargado
    ? "var(--color-fg-dim)"
    : hayAdv
      ? "var(--color-warning)"
      : "#0f7a59";

  const limpiarId: FuenteId = def.subs ? def.subs[0] : (def.id as FuenteId);

  return (
    <div
      className={cn(
        "surface bg-white px-5 py-4 flex flex-col",
        cargado ? "border-l-2" : "opacity-90",
      )}
      style={cargado ? { borderLeftColor: estadoColor } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="grid place-items-center size-7 rounded-lg bg-[--color-bg-elev-1] text-[--color-fg-muted] shrink-0">
            <Icon className="size-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[--color-fg] leading-tight">{def.label}</div>
            <div className="text-[10px] text-[--color-fg-dim] leading-tight">{def.desc}</div>
          </div>
        </div>
        <span
          className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0"
          style={{ color: estadoColor, backgroundColor: `color-mix(in srgb, ${estadoColor} 12%, transparent)` }}
        >
          {cargado ? (hayAdv ? "Con avisos" : "Cargado") : "No cargado"}
        </span>
      </div>

      {/* Detalle */}
      <div className="mt-3 flex-1">
        {def.subs ? (
          <div className="space-y-1.5">
            {def.subs.map((s) => {
              const m = metas[s];
              return (
                <div key={s} className="flex items-center justify-between gap-2 text-[11.5px]">
                  <span className="text-[--color-fg-muted]">
                    {s === "logistica_roma"
                      ? "ROMA"
                      : s === "logistica_stli"
                        ? "STLI"
                        : s === "romia_schiapp"
                          ? "SCHIAPP"
                          : s === "romia_kar"
                            ? "KAR"
                            : s}
                  </span>
                  {m ? (
                    <span className="mono text-[--color-fg]">
                      {fmtNum(m.registros)} reg{m.fechaCorte ? ` · ${fmtDate(m.fechaCorte)}` : ""}
                    </span>
                  ) : (
                    <span className="text-[--color-fg-dim]">—</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : meta ? (
          <div className="space-y-1 text-[11.5px]">
            <div className="flex items-center gap-1.5 text-[--color-fg-muted] truncate">
              <FileSpreadsheet className="size-3.5 shrink-0" />
              <span className="truncate" title={meta.archivoNombre}>{meta.archivoNombre}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[--color-fg-muted]">Registros</span>
              <span className="mono text-[--color-fg]">{fmtNum(meta.registros)}</span>
            </div>
            {meta.vins != null && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[--color-fg-muted]">VIN únicos</span>
                <span className="mono text-[--color-fg]">{fmtNum(meta.vins)}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[--color-fg-muted] inline-flex items-center gap-1">
                <CalendarClock className="size-3" /> Corte
              </span>
              <span className="mono text-[--color-fg]">{meta.fechaCorte ? fmtDate(meta.fechaCorte) : "—"}</span>
            </div>
            <div className="text-[10px] text-[--color-fg-dim]">
              Cargado {fmtDate(meta.fechaCarga)} · {fmtBytes(meta.archivoSize)}
            </div>
          </div>
        ) : (
          <div className="text-[11.5px] text-[--color-fg-dim] py-2">
            {def.id === "tescar"
              ? "Se carga junto con el Excel de Stock."
              : "Sube el archivo de esta fuente."}
          </div>
        )}

        {hayAdv && (
          <div className="text-[10.5px] text-[#b45309] mt-2 leading-snug">⚠ {advertencias.join(" · ")}</div>
        )}
      </div>

      {/* Acciones */}
      {def.id !== "tescar" && (
        <div className="mt-3 pt-3 border-t border-[--color-border-soft] flex items-center gap-3">
          <button
            onClick={onReemplazar}
            className="text-[11.5px] text-[--color-accent] hover:underline inline-flex items-center gap-1"
          >
            <UploadCloud className="size-3.5" /> {cargado ? "Reemplazar" : "Subir"}
          </button>
          {cargado && (
            <button
              onClick={() => limpiarFuente(limpiarId)}
              className="text-[11.5px] text-[--color-danger] hover:underline inline-flex items-center gap-1"
            >
              <Trash2 className="size-3.5" /> Limpiar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
