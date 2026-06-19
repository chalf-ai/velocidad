/**
 * Caja Inmovilizada · composición ACTUAL (panel en vivo de /tendencias).
 *
 * Verdad financiera completa = Caja Inmovilizada Total (Pagado ∪ Propio ∪
 * FinPropio), desglosada en sus 4 categorías de gestión. No esconder caja, no
 * mezclar responsabilidades:
 *   · Comercial Gestionable → MISMO número que el Score Gerencial (lo que el
 *     gerente controla).
 *   · Test Cars / Autos Compañía / Judicial → caja real que NO carga al gerente.
 *
 * Read-only: recomputado en vivo desde los snapshots vigentes (no persiste).
 */

import { fmtCLPCompact, fmtNum } from "@/lib/format";
import type { DesgloseCajaCorte } from "@/lib/historico/capital-por-corte";

interface Fila {
  key: keyof DesgloseCajaCorte;
  nombre: string;
  responsable: string;
  color: string;
}

// Orden ejecutivo: lo gestionable primero (es el score), luego los bloques
// segregados. "Otros" solo aparece si tiene unidades (debe ser 0).
const FILAS: Fila[] = [
  { key: "comercial", nombre: "Comercial Gestionable", responsable: "Score Gerencial · responsabilidad de marca", color: "#1F2A44" },
  { key: "testCars", nombre: "Test Cars", responsable: "Bloque aparte · la marca los ve", color: "#E67E22" },
  { key: "autosCompania", nombre: "Autos Compañía", responsable: "Responsable: Empresa / Corporativo", color: "#8E44AD" },
  { key: "judicial", nombre: "Judicial", responsable: "Responsable: Legal / Recuperación", color: "#B83B6A" },
  { key: "otros", nombre: "Otros especiales", responsable: "Sin categoría — revisar", color: "#6B7280" },
];

export function CajaInmovilizadaPanel({
  desglose,
  fechaCorte,
  marca,
}: {
  desglose: DesgloseCajaCorte;
  fechaCorte: string | null;
  marca: string | null;
}) {
  const total = desglose.total;
  const pct = (m: number) => (total.monto > 0 ? (m / total.monto) * 100 : 0);
  const filas = FILAS.filter((f) => f.key === "comercial" || desglose[f.key].unidades > 0);
  const corte = fechaCorte
    ? new Date(fechaCorte).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" })
    : null;

  return (
    <div className="surface bg-white top-strip strip-info p-5">
      {/* Encabezado + total */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[--color-fg-muted]">
            Caja Inmovilizada · composición actual
            {marca ? ` · ${marca}` : ""}
          </div>
          <div className="text-[12px] text-[--color-fg-muted] mt-0.5">
            Verdad financiera completa = Pagado ∪ Propio ∪ FinPropio
            {corte ? ` · stock al ${corte}` : ""}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[22px] font-bold tracking-tight text-[--color-fg] mono leading-none">
            {fmtCLPCompact(total.monto)}
          </div>
          <div className="text-[11px] text-[--color-fg-muted] mt-1">
            {fmtNum(total.unidades)} VIN inmovilizados
          </div>
        </div>
      </div>

      {/* Barra apilada proporcional */}
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[--color-bg-subtle] mb-4">
        {filas.map((f) => {
          const p = pct(desglose[f.key].monto);
          return p > 0 ? (
            <div
              key={f.key}
              style={{ width: `${p}%`, backgroundColor: f.color }}
              title={`${f.nombre} · ${p.toFixed(0)}%`}
            />
          ) : null;
        })}
      </div>

      {/* Filas del desglose */}
      <div className="space-y-1.5">
        {filas.map((f) => {
          const v = desglose[f.key];
          const esComercial = f.key === "comercial";
          return (
            <div
              key={f.key}
              className={
                "flex items-center justify-between gap-3 rounded-md px-3 py-2 " +
                (esComercial ? "bg-[--color-bg-subtle]" : "")
              }
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="size-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: f.color }}
                />
                <div className="min-w-0">
                  <div className={"text-[13px] truncate " + (esComercial ? "font-semibold text-[--color-fg]" : "text-[--color-fg]")}>
                    {f.nombre}
                  </div>
                  <div className="text-[10.5px] text-[--color-fg-dim] truncate">
                    {f.responsable}
                  </div>
                </div>
              </div>
              <div className="flex items-baseline gap-3 shrink-0">
                <span className="text-[11px] text-[--color-fg-muted] tabular-nums w-9 text-right">
                  {pct(v.monto).toFixed(0)}%
                </span>
                <span className="text-[11px] text-[--color-fg-muted] tabular-nums w-14 text-right">
                  {fmtNum(v.unidades)} VIN
                </span>
                <span className="text-[13px] font-semibold text-[--color-fg] mono tabular-nums w-20 text-right">
                  {fmtCLPCompact(v.monto)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Nota de cuadratura */}
      <div className="text-[10.5px] text-[--color-fg-dim] italic leading-snug mt-3 px-1">
        Comercial Gestionable es exactamente el indicador #1 del Score Gerencial
        (lo que el gerente controla). El resto es caja inmovilizada real que no se
        le carga — se gestiona aparte. La suma de las categorías cuadra VIN a VIN
        con el total. Composición de hoy; la serie histórica diaria se persiste en
        una etapa posterior.
      </div>
    </div>
  );
}
