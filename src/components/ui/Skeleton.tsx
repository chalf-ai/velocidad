import { cn } from "@/lib/cn";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("skeleton rounded-md", className)}
      {...props}
    />
  );
}

/** Skeleton para una fila de KPI Stat. */
export function StatSkeleton() {
  return (
    <div className="rounded-2xl border border-[--color-border] bg-[--color-bg-elev-2] px-5 py-4 card-inset">
      <Skeleton className="h-2.5 w-24" />
      <Skeleton className="h-7 w-32 mt-3" />
      <Skeleton className="h-3 w-40 mt-2" />
    </div>
  );
}

/** Skeleton genérico para tabla. */
export function TableRowSkeleton({ cols = 6 }: { cols?: number }) {
  return (
    <tr className="border-b border-[--color-border-soft]">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-3 w-full" />
        </td>
      ))}
    </tr>
  );
}
