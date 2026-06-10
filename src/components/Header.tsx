"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { Calendar, ChevronDown, Check, Loader2, Menu } from "lucide-react";
import { MarcaFilterSelect } from "@/components/MarcaFilterSelect";
import { SucursalFilterSelect } from "@/components/SucursalFilterSelect";
import { useExcelStore } from "@/lib/store";
import {
  fetchActiveSnapshot,
  deserializeStockPayload,
  type SnapshotMeta,
} from "@/lib/snapshot-client";
import { fmtDate } from "@/lib/format";

function CorteSelector() {
  const { data } = useExcelStore();
  const [options, setOptions] = useState<SnapshotMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/snapshot?fuente=BASE_STOCK", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((snaps: SnapshotMeta[]) => {
        setOptions(snaps);
        const active = snaps.find((s) => s.activo);
        if (active) setSelectedId(active.id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  async function selectSnapshot(snap: SnapshotMeta) {
    setOpen(false);
    if (snap.id === selectedId) return;
    setLoading(true);
    try {
      const result = await fetchActiveSnapshot("BASE_STOCK", snap.id);
      if (result) {
        useExcelStore.getState().setData(deserializeStockPayload(result.payload));
        setSelectedId(snap.id);
      }
    } catch (err) {
      console.error("[CorteSelector] error cargando snapshot:", err);
    } finally {
      setLoading(false);
    }
  }

  if (!data?.report.fechaCorteExcel) return null;

  return (
    <div ref={ref} className="relative hidden md:flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        className="inline-flex items-center gap-2 text-[13px] text-white/80 hover:text-white disabled:opacity-60 transition"
      >
        {loading ? (
          <Loader2 className="size-3.5 animate-spin text-white/60" />
        ) : (
          <Calendar className="size-3.5 text-white/60" strokeWidth={1.75} />
        )}
        <span>Corte</span>
        <span className="font-mono text-white">{fmtDate(data.report.fechaCorteExcel)}</span>
        {options.length > 1 && (
          <ChevronDown
            className={`size-3 text-white/60 transition-transform ${open ? "rotate-180" : ""}`}
            strokeWidth={2}
          />
        )}
      </button>

      {open && options.length > 1 && (
        <div className="absolute top-full left-0 mt-2 z-50 w-64 rounded-xl border border-[--color-border] bg-white shadow-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-[--color-border]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[--color-fg-dim]">
              Cortes disponibles
            </p>
          </div>
          <div className="py-1 max-h-72 overflow-y-auto">
            {options.map((snap) => {
              const fecha = snap.fechaCorte
                ? new Date(snap.fechaCorte)
                : new Date(snap.createdAt);
              const isSelected = snap.id === selectedId;
              return (
                <button
                  key={snap.id}
                  type="button"
                  onClick={() => selectSnapshot(snap)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-left transition hover:bg-[--color-bg-elev-2] ${
                    isSelected ? "bg-[#3358e8]/5" : ""
                  }`}
                >
                  <div>
                    <p
                      className={`text-[13px] ${isSelected ? "font-medium text-[#3358e8]" : "text-[--color-fg]"}`}
                    >
                      {fmtDate(fecha)}
                    </p>
                    <p className="text-[11px] text-[--color-fg-dim]">
                      {snap.registros.toLocaleString("es-CL")} vehículos
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {snap.activo && (
                      <span className="text-[10px] uppercase tracking-wide text-[#3358e8]/70 font-medium">
                        activo
                      </span>
                    )}
                    {isSelected && (
                      <Check className="size-3.5 text-[#3358e8]" strokeWidth={2.5} />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function Header({ onMenuClick }: { onMenuClick?: () => void } = {}) {
  return (
    <header className="flex h-18 w-full shrink-0 items-center gap-3 border-b border-[#2a4bc4] bg-[#3358e8] px-4 sm:gap-6 sm:px-6">
      {/* Hamburger · solo mobile/tablet (sidebar es drawer abajo de lg) */}
      {onMenuClick && (
        <button
          type="button"
          onClick={onMenuClick}
          className="grid size-10 shrink-0 place-items-center rounded-md text-white/90 hover:bg-white/10 lg:hidden"
          aria-label="Abrir menú"
        >
          <Menu className="size-6" strokeWidth={2} />
        </button>
      )}

      <Link href="/" className="flex shrink-0 items-center gap-3 transition hover:opacity-90">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white shadow-sm">
          <Image
            src="/pompeyo-menu-icon.png"
            alt="Pompeyo Carrasco"
            width={40}
            height={40}
            priority
            className="size-8"
          />
        </div>
        <div className="hidden leading-tight sm:block">
          <div className="text-[14px] font-semibold tracking-tight text-white">Stock Command</div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-white/70">
            Pompeyo Carrasco
          </div>
        </div>
      </Link>

      <div className="hidden h-8 w-px shrink-0 bg-white/25 sm:block" />

      <div className="flex min-w-0 flex-1 items-center gap-5">
        <CorteSelector />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3.5">
        <MarcaFilterSelect onHeader />
        <SucursalFilterSelect onHeader />
      </div>
    </header>
  );
}
