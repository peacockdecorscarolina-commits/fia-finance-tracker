import type { Transaction } from "./types";

// What the user's own transactions say about where money goes: each
// merchant's history, the top merchants for a period, and a few
// plain-language notes comparing a month with the months before it.
// Spending here means charges (not income, card payments or ignored ones),
// less anything paid back.

export function spendOf(t: Transaction): number {
  return -t.amount - (t.reimbursed ?? 0);
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export type MerchantHistory = {
  spent: number;
  refunded: number;
  visits: number;
  average: number;
  firstDate: string | null;
  lastDate: string | null;
  // Spent per month for the last 12 months, oldest first.
  months: { month: string; total: number }[];
  byAccount: { accountName: string; total: number }[];
  // "Mostly weekends", "Mostly on Fridays" -- null without a clear pattern.
  pattern: string | null;
};

function lastMonths(today: string, count: number): string[] {
  const [y, m] = today.split("-").map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

// `transactions`: everything from one merchant (charges and refunds).
export function merchantHistory(transactions: Transaction[], today: string): MerchantHistory {
  const live = transactions.filter((t) => !t.ignored);
  const charges = live.filter((t) => t.amount < 0);
  const spent = charges.reduce((sum, t) => sum + spendOf(t), 0);
  const refunded = live.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
  const dates = live.map((t) => t.date).sort();

  const perMonth = new Map<string, number>();
  for (const t of charges) perMonth.set(t.date.slice(0, 7), (perMonth.get(t.date.slice(0, 7)) ?? 0) + spendOf(t));
  const perAccount = new Map<string, number>();
  for (const t of charges) perAccount.set(t.accountName, (perAccount.get(t.accountName) ?? 0) + spendOf(t));

  let pattern: string | null = null;
  if (charges.length >= 5) {
    const days = charges.map((t) => weekday(t.date));
    const weekend = days.filter((d) => d === 0 || d === 6).length;
    const counts = new Map<number, number>();
    for (const d of days) counts.set(d, (counts.get(d) ?? 0) + 1);
    const [topDay, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topCount / days.length >= 0.5) pattern = `Mostly on ${WEEKDAY[topDay]}s`;
    else if (weekend / days.length >= 0.7) pattern = "Mostly on weekends";
    else if (weekend / days.length <= 0.1) pattern = "Mostly on weekdays";
  }

  return {
    spent,
    refunded,
    visits: charges.length,
    average: charges.length ? spent / charges.length : 0,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    months: lastMonths(today, 12).map((month) => ({ month, total: perMonth.get(month) ?? 0 })),
    byAccount: [...perAccount.entries()].map(([accountName, total]) => ({ accountName, total })).sort((a, b) => b.total - a.total),
    pattern,
  };
}

export type TopMerchant = { key: string; merchant: string; name: string; total: number; visits: number };

// `spending`: charges for the period (already without income/payments).
export function topMerchants(
  spending: Transaction[],
  keyFor: (merchant: string) => string,
  displayName: (merchant: string) => string,
  limit = 5
): TopMerchant[] {
  const byKey = new Map<string, TopMerchant>();
  for (const t of spending) {
    if (t.ignored || t.amount >= 0) continue;
    const key = keyFor(t.merchant);
    const entry = byKey.get(key) ?? { key, merchant: t.merchant, name: displayName(t.merchant), total: 0, visits: 0 };
    entry.total += spendOf(t);
    entry.visits += 1;
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

export type Insight = { emoji: string; text: string };

function money(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

function shortDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// A few notes on a month, measured against the user's own usual: the
// average of the months before it that have any spending (up to 3).
export function monthInsights(input: {
  // Category totals for the month, and for each month before it (newest first).
  categories: { categoryName: string; total: number }[];
  earlier: { categoryName: string; total: number }[][];
  // The month's charges, and merchant keys seen before the month began.
  spending: Transaction[];
  seenBefore: Set<string>;
  keyFor: (merchant: string) => string;
  displayName: (merchant: string) => string;
  // A month still going: comparisons with the usual would always look low.
  inProgress?: boolean;
}): Insight[] {
  const insights: Insight[] = [];
  const total = input.categories.reduce((sum, c) => sum + c.total, 0);
  const earlier = input.earlier.filter((month) => month.some((c) => c.total > 0)).slice(0, 3);

  if (earlier.length >= 2 && !input.inProgress) {
    const usualTotal = earlier.reduce((sum, m) => sum + m.reduce((s, c) => s + c.total, 0), 0) / earlier.length;
    const diff = total - usualTotal;
    if (usualTotal > 0 && Math.abs(diff) / usualTotal >= 0.1) {
      insights.push({
        emoji: diff > 0 ? "📈" : "📉",
        text: `You spent ${money(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than usual (${money(usualTotal)}).`,
      });
    }
    const usual = (name: string) => earlier.reduce((sum, m) => sum + (m.find((c) => c.categoryName === name)?.total ?? 0), 0) / earlier.length;
    // "Other" is just "not sorted yet", and a category that's nearly all
    // the spending would only repeat the line above.
    const changes = input.categories
      .filter((c) => c.categoryName.toLowerCase() !== "other" && (total === 0 || c.total / total < 0.9))
      .map((c) => ({ name: c.categoryName, total: c.total, usual: usual(c.categoryName) }))
      .map((c) => ({ ...c, diff: c.total - c.usual }))
      .filter((c) => Math.abs(c.diff) >= 50 && c.usual > 0 && Math.abs(c.diff) / c.usual >= 0.25);
    const up = changes.filter((c) => c.diff > 0).sort((a, b) => b.diff - a.diff)[0];
    const down = changes.filter((c) => c.diff < 0).sort((a, b) => a.diff - b.diff)[0];
    if (up) insights.push({ emoji: "⬆️", text: `${up.name} was ${money(up.diff)} more than usual (${money(up.usual)}).` });
    if (down) insights.push({ emoji: "⬇️", text: `${down.name} was ${money(-down.diff)} less than usual (${money(down.usual)}).` });
  }

  const charges = input.spending.filter((t) => !t.ignored && t.amount < 0);
  const newPlaces = new Map<string, string>();
  for (const t of charges) {
    const key = input.keyFor(t.merchant);
    if (!input.seenBefore.has(key) && !newPlaces.has(key)) newPlaces.set(key, input.displayName(t.merchant));
  }
  // Only meaningful once there's history to be new against.
  if (input.seenBefore.size > 0 && newPlaces.size >= 2) {
    const names = [...newPlaces.values()].slice(0, 2).join(" and ");
    insights.push({ emoji: "🆕", text: `You tried ${newPlaces.size} new places, like ${names}.` });
  }

  const biggest = [...charges].sort((a, b) => spendOf(b) - spendOf(a))[0];
  if (biggest && spendOf(biggest) > 0) {
    insights.push({
      emoji: "💸",
      text: `Biggest purchase: ${money(spendOf(biggest))} at ${input.displayName(biggest.merchant)} on ${shortDate(biggest.date)}.`,
    });
  }

  const visits = new Map<string, { name: string; count: number; total: number }>();
  for (const t of charges) {
    const key = input.keyFor(t.merchant);
    const v = visits.get(key) ?? { name: input.displayName(t.merchant), count: 0, total: 0 };
    v.count += 1;
    v.total += spendOf(t);
    visits.set(key, v);
  }
  const regular = [...visits.values()].sort((a, b) => b.count - a.count)[0];
  if (regular && regular.count >= 4) {
    insights.push({ emoji: "🔁", text: `Most visits: ${regular.name}, ${regular.count} times (${money(regular.total)}).` });
  }
  return insights;
}
