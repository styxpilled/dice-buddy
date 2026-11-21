export function formatPercent(p: number): string {
  if (p === 0) return "0%";
  const x = p * 100;
  if (x < 0.01) return x >= 1e-6 ? `${Number(x.toPrecision(2))}%` : "<0.000001%";
  return `${Number(x.toFixed(x >= 10 ? 1 : 2))}%`;
}

export function formatNumber(x: number): string {
  return String(Number(x.toFixed(2)));
}

export interface ChartSeries {
  name: string;
  color: string;
  values: Map<number, number>;
}

/** The smallest 1, 2 or 5 times a power of ten that is at least `raw`. */
export function niceStep(raw: number): number {
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw)!;
}

export type Scale = "auto" | "linear" | "log";
