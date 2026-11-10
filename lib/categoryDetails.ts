import { spendOf } from "./merchantInsights";
import { periodRange, shiftMonth } from "./period";
import type { Transaction } from "./types";

// The "View all" categories page: each category's share of a period, how it
// moved from the period before, its charges and where most of it went.

export type Comparison = { start: string; end: string; label: string };

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// What a period ("YYYY-MM" or "YYYY") is measured against: the one before.
// While it's still going, only the same days of the one before, or a month
// nine days in would always look like a big drop from a whole month.
export function comparisonPeriod(key: string, today: string): Comparison {
  const current = periodRange(key);
  const inProgress = today >= current.start && today <= current.end;
  if (/^\d{4}$/.test(key)) {
    const year = String(Number(key) - 1);
    const whole = periodRange(year);
    return inProgress
      ? { start: whole.start, end: `${year}${today.slice(4)}`, label: `${year} so far` }
      : { ...whole, label: year };
  }
  const month = shiftMonth(key, -1);
  const whole = periodRange(month);
  const index = Number(month.slice(5, 7)) - 1;
  if (!inProgress) return { ...whole, label: LONG_MONTHS[index] };
  const day = Math.min(Number(today.slice(8, 10)), Number(whole.end.slice(8, 10)));
  return {
    start: whole.start,
    end: `${month}-${String(day).padStart(2, "0")}`,
    label: `${SHORT_MONTHS[index]} ${day === 1 ? "1" : `1–${day}`}`,
  };
}

export type CategoryDetail = {
  name: string;
  amount: number;
  // Share of the period's spending, 0 to 100.
  percent: number;
  // Bar length, 0 to 1 against the biggest category.
  bar: number;
  // Against the comparison period; null when there's nothing to compare with.
  change: number | null;
  isNew: boolean;
  charges: number;
  topStore: string | null;
};

export type CategoryDetails = { total: number; previousTotal: number; rows: CategoryDetail[] };

type Total = { categoryName: string; total: number };

export function buildCategoryDetails(input: {
  current: Total[];
  previous: Total[];
  spending: Transaction[];
  keyFor: (merchant: string) => string;
  displayName: (merchant: string) => string;
}): CategoryDetails {
  const previousBy = new Map(input.previous.map((p) => [p.categoryName, p.total]));
  const currentNames = new Set(input.current.map((c) => c.categoryName));
  // A category spent on last time but not this time is still a change.
  const all: Total[] = [
    ...input.current,
    ...input.previous.filter((p) => p.total > 0 && !currentNames.has(p.categoryName)).map((p) => ({ categoryName: p.categoryName, total: 0 })),
  ];
  const total = input.current.reduce((sum, c) => sum + c.total, 0);
  const previousTotal = input.previous.reduce((sum, p) => sum + p.total, 0);
  // A category that's net refunds can't take a slice of the pie.
  const positive = all.reduce((sum, c) => sum + Math.max(0, c.total), 0);
  const biggest = Math.max(0, ...all.map((c) => c.total));
  const hasComparison = previousTotal > 0;

  const stores = new Map<string, { charges: number; byStore: Map<string, { name: string; spent: number }> }>();
  for (const t of input.spending) {
    const entry = stores.get(t.categoryName) ?? { charges: 0, byStore: new Map() };
    entry.charges += 1;
    const key = input.keyFor(t.merchant);
    const store = entry.byStore.get(key) ?? { name: input.displayName(t.merchant), spent: 0 };
    store.spent += spendOf(t);
    entry.byStore.set(key, store);
    stores.set(t.categoryName, entry);
  }

  const rows = all.map((c) => {
    const before = previousBy.get(c.categoryName) ?? 0;
    const entry = stores.get(c.categoryName);
    const top = entry ? [...entry.byStore.values()].sort((a, b) => b.spent - a.spent)[0] : null;
    return {
      name: c.categoryName,
      amount: c.total,
      percent: positive > 0 ? (Math.max(0, c.total) / positive) * 100 : 0,
      bar: biggest > 0 ? Math.max(0, c.total) / biggest : 0,
      change: hasComparison ? c.total - before : null,
      isNew: hasComparison && before <= 0 && c.total > 0,
      charges: entry?.charges ?? 0,
      topStore: top?.name ?? null,
    };
  });
  return { total, previousTotal, rows: sortCategoryRows(rows, "amount") };
}

export type CategorySort = "amount" | "change";

export function sortCategoryRows(rows: CategoryDetail[], sort: CategorySort): CategoryDetail[] {
  return [...rows].sort((a, b) =>
    sort === "amount" ? b.amount - a.amount : Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0) || b.amount - a.amount
  );
}

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const SAME = 0.005;

export type ChangeTone = "up" | "down" | "same";

// "▲ $66.40 vs October", or null with nothing to compare with.
export function changeLine(row: CategoryDetail, label: string): { text: string; tone: ChangeTone } | null {
  if (row.change === null) return null;
  if (row.isNew) return { text: `New vs ${label}`, tone: "up" };
  if (Math.abs(row.change) < SAME) return { text: `Same as ${label}`, tone: "same" };
  return { text: `${row.change > 0 ? "▲" : "▼"} ${money(Math.abs(row.change))} vs ${label}`, tone: row.change > 0 ? "up" : "down" };
}

// "Up $82.55 from October (4.2%)", or null with nothing to compare with.
export function totalChangeLine(details: Pick<CategoryDetails, "total" | "previousTotal">, label: string): string | null {
  if (details.previousTotal <= 0) return null;
  const change = details.total - details.previousTotal;
  if (Math.abs(change) < SAME) return `Same as ${label}`;
  const percent = (Math.abs(change) / details.previousTotal) * 100;
  return `${change > 0 ? "Up" : "Down"} ${money(Math.abs(change))} from ${label} (${percent.toFixed(1)}%)`;
}
