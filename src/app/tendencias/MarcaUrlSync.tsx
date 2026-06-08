"use client";

/**
 * Sincronización marca ↔ URL para /tendencias.
 *
 * Reglas refinadas (decisión usuario 2026-06):
 *
 *   (A) URL trae ?marca=X explícito → URL gana (deep link / bookmark
 *       compartido). Actualiza Zustand para que el header refleje la marca.
 *
 *   (B) URL sin marca pero Zustand tiene una marca persistida (porque el
 *       usuario venía filtrando desde /score-gerencial, /dashboard, etc.) →
 *       reflejar la marca de Zustand en la URL. PRESERVA el filtro al
 *       navegar entre pantallas. NO borra Zustand.
 *
 *   (C) Ambos null o ambos iguales → nada.
 *
 * Mientras el usuario está en /tendencias y cambia marca desde el header
 * (Zustand cambia) → reescribir la URL para que el server re-renderice con
 * la nueva marca.
 *
 * Componente client sin UI. Server-friendly: el resto de /tendencias sigue
 * siendo SSR puro.
 */

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMarcaFilter } from "@/lib/marca-filtro";

interface Props {
  /** Marca leída por el server desde searchParams. null = sin filtro en URL. */
  marcaFromUrl: string | null;
}

export function MarcaUrlSync({ marcaFromUrl }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const marcaZustand = useMarcaFilter((s) => s.marca);
  const setMarca = useMarcaFilter((s) => s.setMarca);
  const initialSyncDone = useRef(false);

  // Sync inicial (combina deep link + filtro persistido).
  useEffect(() => {
    if (initialSyncDone.current) return;
    initialSyncDone.current = true;

    // (A) URL gana cuando trae marca explícita y difiere del store
    if (marcaFromUrl !== null && marcaFromUrl !== marcaZustand) {
      setMarca(marcaFromUrl);
      return;
    }

    // (B) URL sin marca pero el store tiene una → reflejarla en URL.
    //     Esto preserva el filtro al venir de otra pantalla.
    if (marcaFromUrl === null && marcaZustand !== null) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("marca", marcaZustand);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      return;
    }
    // (C) Ya en sync → nada.
  }, [marcaFromUrl, marcaZustand, setMarca, pathname, router, searchParams]);

  // Cambios post-sync: Zustand → URL (usuario toca el selector del header)
  useEffect(() => {
    if (!initialSyncDone.current) return;
    if (marcaZustand === marcaFromUrl) return;

    const params = new URLSearchParams(searchParams.toString());
    if (marcaZustand) {
      params.set("marca", marcaZustand);
    } else {
      params.delete("marca");
    }
    const qs = params.toString();
    const newUrl = qs ? `${pathname}?${qs}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [marcaZustand, marcaFromUrl, pathname, router, searchParams]);

  return null;
}
