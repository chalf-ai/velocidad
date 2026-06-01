"use client";

/**
 * "¿Quién consumió los días del ciclo?"
 *
 * Distribución del tiempo Factura → Entrega Real por área responsable
 * (PROMEDIO de días, no mediana). Recalcula dinámicamente con los datos
 * del período activo (Mes / 3M / 6M / 12M / Todo).
 *
 * Tres bloques principales (en orden temporal del ciclo):
 *   1. Comercial · pre-inscripción (Factura → Sol. inscripción)
 *   2. Control de Negocio + Registro Civil (con desglose visible)
 *   3. Comercial · auto listo para entrega (residuo post-patente)
 *
 * Ambos bloques "Comercial" pertenecen a la misma área (Comercial es el
 * dueño operativo) pero en momentos distintos del ciclo: antes de pedir
 * inscripción y después de tener patente lista para entregar al cliente.
 *
 * Para CN+RC se muestra la suma + el desglose interno debajo (CdN solo · RC solo),
 * porque conceptualmente son una sola responsabilidad funcional aunque RC sea
 * un ente externo.
 */

import { Clock4 } from "lucide-react";
import {
  consumidorPrincipal,
  type ResultadoDistribucion,
  type DistribucionDias,
  type SubdesgloseArea,
} from "@/lib/control-de-negocio/cn-participacion";

export function DistribucionDiasCN({
  resultado,
}: {
  resultado: ResultadoDistribucion;
}) {
  const { filas, cicloTotalDias, fuente } = resultado;
  const top = consumidorPrincipal(filas);
  const maxPct = Math.max(...filas.map((d) => d.pctParticipacion), 1);

  return (
    <div className="surface bg-white px-5 py-4">
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-[--color-fg] flex items-center gap-2">
            <Clock4 className="size-4 text-[--color-accent]" />
            ¿Quién consumió los días del ciclo?
          </h2>
          <p className="text-[12px] text-[--color-fg-muted] mt-0.5">
            Distribución del tiempo Factura → Entrega Real por área responsable
            · <b>promedio</b> · ciclo total {cicloTotalDias.toFixed(1)} d.
          </p>
        </div>
        <div className="text-[11px] text-[--color-fg-muted] bg-[--color-bg-elev-1] rounded-md px-3 py-1.5 border border-[--color-border]">
          <span className="text-[--color-fg-dim]">Consumidor principal:</span>{" "}
          <b style={{ color: top.color }}>{top.area}</b>{" "}
          <span className="text-[--color-fg-dim]">·</span>{" "}
          <b className="text-[--color-fg]">{top.pctParticipacion}%</b>
        </div>
      </div>

      <div className="space-y-2.5">
        {filas.map((d) => (
          <FilaDistribucion key={d.area} item={d} maxPct={maxPct} />
        ))}
      </div>

      <div className="mt-3 pt-2 border-t border-[--color-border] text-[10px] text-[--color-fg-dim] italic leading-snug space-y-1">
        {fuente === "dinamico" ? (
          <>
            <div>
              Métrica: <b>promedio</b> de días por tramo · <b>Comercial · auto
              listo para entrega</b> derivado del residuo del ciclo total.
            </div>
            <div>
              <b>Tramo Patente Recibida → Patente Entregada excluido de CN+RC</b>{" "}
              porque <code>fecha_patente_entregada</code> está contaminada en la
              captura (86,6% de casos con timestamp idéntico al de entrega al
              cliente, brief §4). Ese tiempo se absorbe en <b>Comercial · auto
              listo para entrega</b> hasta instrumentar el hito real.
            </div>
            <div>
              Ambos bloques <b>Comercial</b> son responsabilidad del área Comercial
              en momentos distintos del ciclo: <i>pre-inscripción</i> (después de
              facturar, antes de pedir inscripción) y <i>auto listo para entrega</i>{" "}
              (después de tener patente, coordinación con cliente para retiro).
            </div>
            <div>
              Control de Negocio y Registro Civil se presentan agrupados como
              responsabilidad funcional única · el desglose interno está visible
              debajo de la barra principal.
            </div>
          </>
        ) : (
          <>
            Valores aprobados en Control de Negocio V1.0 REV.1 · período sin
            datos suficientes para cálculo dinámico · suman &gt;100% por
            solapamiento entre tramos paralelos.
          </>
        )}
      </div>
    </div>
  );
}

function FilaDistribucion({
  item,
  maxPct,
}: {
  item: DistribucionDias;
  maxPct: number;
}) {
  const barWidth = (item.pctParticipacion / maxPct) * 100;
  return (
    <div>
      <div className="grid grid-cols-[260px_1fr_60px_60px] items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block size-2.5 rounded-sm shrink-0"
            style={{ backgroundColor: item.color }}
          />
          <div className="min-w-0">
            <div
              className="text-[12.5px] font-semibold text-[--color-fg] truncate flex items-center gap-1.5"
              title={item.area}
            >
              {item.area}
              {item.origen === "derivado" && (
                <span
                  className="text-[9px] text-[--color-fg-dim] font-normal italic"
                  title="Derivado del residuo del ciclo total · hitos no instrumentados"
                >
                  · residuo
                </span>
              )}
            </div>
            <div
              className="text-[10px] text-[--color-fg-dim] truncate"
              title={item.cubre}
            >
              {item.cubre}
            </div>
          </div>
        </div>

        <div className="h-5 bg-[--color-bg-elev-1] rounded-sm overflow-hidden">
          <div
            className="h-full rounded-sm transition-all"
            style={{
              width: `${barWidth}%`,
              backgroundColor: item.color,
              opacity: 0.9,
            }}
          />
        </div>

        <div
          className="text-[14px] font-bold text-right mono leading-none"
          style={{ color: item.color }}
        >
          {item.pctParticipacion}%
        </div>

        <div className="text-[11.5px] text-[--color-fg-muted] text-right mono whitespace-nowrap">
          {item.dias.toFixed(1)} d
        </div>
      </div>

      {/* Sub-desglose (CN+RC) */}
      {item.desglose && item.desglose.length > 0 && (
        <div className="mt-1 ml-7 space-y-0.5">
          {item.desglose.map((sd) => (
            <SubFila key={sd.sub} sub={sd} />
          ))}
        </div>
      )}
    </div>
  );
}

function SubFila({ sub }: { sub: SubdesgloseArea }) {
  return (
    <div className="grid grid-cols-[232px_1fr_60px_60px] items-center gap-3 text-[10.5px] text-[--color-fg-muted]">
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className="inline-block size-1.5 rounded-sm shrink-0"
          style={{ backgroundColor: sub.color }}
        />
        <span className="truncate" title={sub.sub}>
          └ {sub.sub}
        </span>
      </div>
      <div className="text-[--color-fg-dim] text-[10px]">desglose interno</div>
      <div />
      <div className="text-right mono text-[--color-fg-muted]">
        {sub.dias.toFixed(1)} d
      </div>
    </div>
  );
}
