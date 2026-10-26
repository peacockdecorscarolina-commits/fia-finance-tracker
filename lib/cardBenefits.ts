import catalog from "./cardCatalog.json";
import type { Transaction } from "./types";

// Card benefits (monthly/yearly credits) and annual fees for the card
// products in cardCatalog.json. A benefit's use is detected from the card's
// own transactions -- the issuer's statement-credit line, or a qualifying
// purchase -- and the user can mark a use themselves when it can't be.

export type BenefitPeriod = "monthly" | "semiannual" | "yearly" | "cardYear" | "every4Years";

export type CatalogBenefit = {
  id: string;
  name: string;
  detail: string;
  amount: number;
  period: BenefitPeriod;
  matchAny: string[];
};

export type CatalogCard = {
  id: string;
  name: string;
  issuer: string;
  annualFee: number;
  benefits: CatalogBenefit[];
};

export const CARD_CATALOG = catalog.cards as CatalogCard[];
export const CATALOG_CHECKED_ON: string = catalog.checkedOn;

export function findCard(productId: string | null): CatalogCard | null {
  return CARD_CATALOG.find((c) => c.id === productId) ?? null;
}

// A benefit's current window: its key (what manual marks are stored under)
// and the dates it covers.
export type PeriodWindow = { key: string; start: string; end: string };

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// `anniversaryMonth` (1-12) is the month the card's annual fee posts, when
// known; cardYear benefits reset then, and on January 1 until it's known.
export function currentWindow(period: BenefitPeriod, today: string, anniversaryMonth: number | null): PeriodWindow {
  const [y, m] = today.split("-").map(Number);
  switch (period) {
    case "monthly":
      return { key: iso(y, m, 1).slice(0, 7), start: iso(y, m, 1), end: iso(y, m, lastDay(y, m)) };
    case "semiannual":
      return m <= 6
        ? { key: `${y}-H1`, start: iso(y, 1, 1), end: iso(y, 6, 30) }
        : { key: `${y}-H2`, start: iso(y, 7, 1), end: iso(y, 12, 31) };
    case "cardYear": {
      if (!anniversaryMonth) return { key: `${y}`, start: iso(y, 1, 1), end: iso(y, 12, 31) };
      const startYear = m >= anniversaryMonth ? y : y - 1;
      const endMonth = anniversaryMonth === 1 ? 12 : anniversaryMonth - 1;
      const endYear = anniversaryMonth === 1 ? startYear : startYear + 1;
      return {
        key: `cy-${startYear}-${String(anniversaryMonth).padStart(2, "0")}`,
        start: iso(startYear, anniversaryMonth, 1),
        end: iso(endYear, endMonth, lastDay(endYear, endMonth)),
      };
    }
    case "every4Years":
      // One window covering the last four years: used if any charge in it.
      return { key: "4y", start: iso(y - 4, m, 1), end: today };
    case "yearly":
    default:
      return { key: `${y}`, start: iso(y, 1, 1), end: iso(y, 12, 31) };
  }
}

export type BenefitStatus = {
  benefit: CatalogBenefit;
  window: PeriodWindow;
  detectedAmount: number;
  detectedDate: string | null;
  markedAmount: number | null; // what the user said they used, if anything
  used: number; // capped at the benefit's amount
  left: number;
  daysLeft: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Uses found on this card in the window: an issuer credit line (money back)
// or a qualifying purchase, by the benefit's match words.
export function detectUse(benefit: CatalogBenefit, cardTransactions: Transaction[], window: PeriodWindow) {
  if (benefit.matchAny.length === 0) return { amount: 0, date: null as string | null };
  const words = benefit.matchAny.map((w) => w.toUpperCase());
  const hits = cardTransactions.filter(
    (t) =>
      t.date >= window.start &&
      t.date <= window.end &&
      !t.ignored &&
      words.some((w) => t.merchant.toUpperCase().includes(w))
  );
  // A credit line is the clearest signal of the amount actually applied;
  // otherwise count the qualifying purchases.
  const credits = hits.filter((t) => t.amount > 0);
  const counted = credits.length > 0 ? credits : hits.filter((t) => t.amount < 0);
  const amount = counted.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const latest = counted.map((t) => t.date).sort().pop() ?? null;
  return { amount, date: latest };
}

export function benefitStatus(
  benefit: CatalogBenefit,
  cardTransactions: Transaction[],
  marks: Map<string, number>, // `${benefitId}|${periodKey}` -> amount the user marked
  today: string,
  anniversaryMonth: number | null
): BenefitStatus {
  const window = currentWindow(benefit.period, today, anniversaryMonth);
  const detected = detectUse(benefit, cardTransactions, window);
  const marked = marks.get(`${benefit.id}|${window.key}`) ?? null;
  const used = Math.min(benefit.amount, Math.max(detected.amount, marked ?? 0));
  const end = benefit.period === "every4Years" ? null : window.end;
  return {
    benefit,
    window,
    detectedAmount: detected.amount,
    detectedDate: detected.date,
    markedAmount: marked,
    used,
    left: Math.max(benefit.amount - used, 0),
    daysLeft: end ? Math.max(0, Math.round((Date.parse(end) - Date.parse(today)) / DAY_MS)) : Infinity,
  };
}

// The card's annual fee as found on its statements -- "ANNUAL FEE",
// "MEMBERSHIP FEE" -- which also gives its anniversary month.
export function findAnnualFeeCharge(cardTransactions: Transaction[]): Transaction | null {
  const fees = cardTransactions
    .filter((t) => t.amount < 0 && /ANNUAL\s*(MEMBERSHIP\s*)?FEE|MEMBERSHIP\s*FEE/i.test(t.merchant))
    .sort((a, b) => b.date.localeCompare(a.date));
  return fees[0] ?? null;
}

function shiftMonthStart(date: string, months: number): string {
  const [y, m] = date.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 10);
}

// How much of a benefit was used over the last 12 months, across however
// many windows that spans (twelve monthly credits, two half-year ones...),
// for the annual fee box's "credits used vs. fee".
export function usedLast12Months(
  benefit: CatalogBenefit,
  cardTransactions: Transaction[],
  marks: Map<string, number>,
  today: string,
  anniversaryMonth: number | null
): number {
  const yearAgo = shiftMonthStart(today, -11);
  const seen = new Set<string>();
  let total = 0;
  for (let i = 0; i < 12; i++) {
    const day = shiftMonthStart(yearAgo, i);
    const window = currentWindow(benefit.period, i === 11 ? today : day, anniversaryMonth);
    if (seen.has(window.key)) continue;
    seen.add(window.key);
    const clipped = { ...window, start: window.start < yearAgo ? yearAgo : window.start };
    const detected = detectUse(benefit, cardTransactions, clipped).amount;
    const marked = marks.get(`${benefit.id}|${window.key}`) ?? 0;
    total += Math.min(benefit.amount, Math.max(detected, marked));
  }
  return total;
}

export const PERIOD_LABEL: Record<BenefitPeriod, string> = {
  monthly: "month",
  semiannual: "half year",
  yearly: "year",
  cardYear: "card year",
  every4Years: "4 years",
};
