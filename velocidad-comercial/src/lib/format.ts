const numFormatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return numFormatter.format(n);
}
