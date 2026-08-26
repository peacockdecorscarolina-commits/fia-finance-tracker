export const PERIODS = ["Week", "Month", "Year"] as const;
export type Period = (typeof PERIODS)[number];

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function getPeriodRange(period: Period): { start: string; end: string } {
  const now = new Date();
  const end = toISODate(now);

  if (period === "Week") {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    return { start: toISODate(start), end };
  }
  if (period === "Month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: toISODate(start), end };
  }
  const start = new Date(now.getFullYear(), 0, 1);
  return { start: toISODate(start), end };
}

// Bounds for a "YYYY-MM" month string, e.g. "2026-08" -> { start: "2026-08-01", end: "2026-08-31" }.
export function monthRange(month: string): { start: string; end: string } {
  const [year, m] = month.split("-").map(Number);
  const start = new Date(year, m - 1, 1);
  const end = new Date(year, m, 0);
  return { start: toISODate(start), end: toISODate(end) };
}

export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(year, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function recentMonths(from: string, count: number): string[] {
  const list: string[] = [];
  let m = from;
  for (let i = 0; i < count; i++) {
    list.push(m);
    m = shiftMonth(m, -1);
  }
  return list;
}
