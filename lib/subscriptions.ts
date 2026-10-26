import type { Transaction } from "./types";

// Spots subscriptions and recurring bills in the user's own transactions:
// the same merchant charging about the same amount on a steady rhythm.
// Two charges are enough to call it; the user can also mark a merchant as a
// subscription (counted even after one charge) or as not one (never
// counted), and that choice is remembered per merchant.

export type Frequency = "weekly" | "monthly" | "yearly";
export type RecurringOverride = "subscription" | "not";

export type Recurring = {
  merchantKey: string;
  merchant: string; // raw merchant text of the latest charge
  // Bills & Utilities (rent, phone, power) vs. everything else.
  kind: "subscription" | "bill";
  frequency: Frequency;
  amount: number; // latest charge, positive
  previousAmount: number | null; // set when the price changed on the latest charge
  monthlyCost: number;
  yearlyCost: number;
  lastDate: string;
  nextDate: string;
  accountName: string;
  categoryName: string;
  isNew: boolean;
  // No charge when one was due (with some slack) -- maybe cancelled.
  isStopped: boolean;
  markedByUser: boolean;
  charges: Transaction[]; // newest first
};

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGES: { frequency: Frequency; min: number; max: number; days: number }[] = [
  { frequency: "weekly", min: 6, max: 8, days: 7 },
  { frequency: "monthly", min: 26, max: 35, days: 30.44 },
  { frequency: "yearly", min: 350, max: 380, days: 365.25 },
];
const PER_YEAR: Record<Frequency, number> = { weekly: 52, monthly: 12, yearly: 1 };
// "New" means it started recently, whatever its billing cycle.
const NEW_WITHIN_DAYS = 45;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + Math.round(days) * DAY_MS).toISOString().slice(0, 10);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Same price give or take a little: 10% or $2, whichever is looser.
function similar(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(2, 0.1 * Math.max(a, b));
}

function classify(gaps: number[]): (typeof RANGES)[number] | null {
  if (gaps.length === 0) return null;
  const typical = median(gaps);
  const range = RANGES.find((r) => typical >= r.min && typical <= r.max);
  if (!range) return null;
  // Most gaps have to fit, so one skipped or doubled month doesn't break it
  // but a store visited at random intervals doesn't pass.
  const fitting = gaps.filter((g) => g >= range.min && g <= range.max).length;
  return fitting >= Math.ceil(gaps.length / 2) ? range : null;
}

export function detectRecurring(
  // Spending only: the caller leaves out income, card payments, loans,
  // transfers and ignored transactions.
  charges: Transaction[],
  keyFor: (merchant: string) => string,
  overrides: Map<string, RecurringOverride>,
  today: string
): Recurring[] {
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of charges) {
    if (t.amount >= 0) continue;
    const key = keyFor(t.merchant);
    byMerchant.set(key, [...(byMerchant.get(key) ?? []), t]);
  }

  const results: Recurring[] = [];
  for (const [merchantKey, list] of byMerchant) {
    const override = overrides.get(merchantKey);
    if (override === "not") continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    // Several charges on one day (a split order) count once for rhythm.
    const dates = [...new Set(sorted.map((t) => t.date))];
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
    const amounts = sorted.map((t) => Math.abs(t.amount));
    const latest = sorted[sorted.length - 1];
    const latestAmount = amounts[amounts.length - 1];

    let range = classify(gaps);
    if (!override) {
      if (!range) continue;
      // A price change on the latest charge is fine; otherwise the earlier
      // charges have to agree with each other.
      const earlier = amounts.slice(0, -1);
      const earlierTypical = median(earlier.length ? earlier : amounts);
      const steadyBefore = earlier.every((a) => similar(a, earlierTypical));
      if (!steadyBefore) continue;
    }
    // Marked by the user but no clear rhythm yet: assume monthly.
    range = range ?? RANGES[1];

    const previous = amounts.length >= 2 ? amounts[amounts.length - 2] : null;
    const priceChanged = previous !== null && Math.abs(previous - latestAmount) >= 0.01;
    const nextDate = addDays(latest.date, range.days);
    const yearlyCost = latestAmount * PER_YEAR[range.frequency];

    results.push({
      merchantKey,
      merchant: latest.merchant,
      kind: /bill|utilit/i.test(latest.categoryName) ? "bill" : "subscription",
      frequency: range.frequency,
      amount: latestAmount,
      previousAmount: priceChanged ? previous : null,
      monthlyCost: yearlyCost / 12,
      yearlyCost,
      lastDate: latest.date,
      nextDate,
      accountName: latest.accountName,
      categoryName: latest.categoryName,
      isNew: daysBetween(sorted[0].date, today) <= NEW_WITHIN_DAYS,
      isStopped: daysBetween(latest.date, today) > range.days * 1.5 + 5,
      markedByUser: override === "subscription",
      charges: [...sorted].reverse(),
    });
  }
  return results.sort((a, b) => b.monthlyCost - a.monthlyCost);
}
