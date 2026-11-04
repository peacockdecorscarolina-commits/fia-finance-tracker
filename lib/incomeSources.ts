import type { Transaction } from "./types";

// Income broken down by who paid it -- each employer, side gig or tenant is
// a "source", grouped by the same merchant key that categorizing uses. The
// user can give a source a nickname ("Main job") and a type, and a steady
// rhythm of deposits becomes a paycheck schedule with the next one expected.

export type IncomeKind = "salary" | "sideGig" | "rental" | "benefits" | "other";

export const INCOME_KINDS: { value: IncomeKind; label: string; emoji: string }[] = [
  { value: "salary", label: "Salary", emoji: "💼" },
  { value: "sideGig", label: "Side gig", emoji: "🚗" },
  { value: "rental", label: "Rental", emoji: "🏠" },
  { value: "benefits", label: "Benefits", emoji: "🏛️" },
  { value: "other", label: "Other", emoji: "💵" },
];

export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

export type PaySchedule = {
  frequency: PayFrequency;
  // Twice-a-month pay days, or the monthly one (day of month); null otherwise.
  payDays: number[];
  lastDate: string;
  nextDate: string;
  // Due more than LATE_AFTER_DAYS ago, with statements uploaded past that
  // date, and nothing came -- so it really didn't arrive (not just "not
  // uploaded yet").
  late: boolean;
};

export type IncomeSource = {
  key: string;
  name: string;
  nickname: string | null;
  kind: IncomeKind | null;
  accountName: string;
  total: number;
  deposits: Transaction[]; // in the range, newest first
  schedule: PaySchedule | null;
};

export type IncomeLabel = { name: string | null; kind: IncomeKind | null };

const DAY_MS = 24 * 60 * 60 * 1000;
// Weekends and holidays move pay days by a day or two.
const LATE_AFTER_DAYS = 4;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function onDay(year: number, month: number, day: number): string {
  const y = month > 12 ? year + 1 : year;
  const m = month > 12 ? month - 12 : month;
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(day, daysInMonth(y, m))).padStart(2, "0")}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Days of the month the deposits land on, merged when within 3 days of each
// other (a 15th that moves to the 14th for a weekend); the month's last few
// days all count as its end (31).
function payDayClusters(dates: string[]): number[] {
  const days = dates
    .map((d) => {
      const [y, m, day] = d.split("-").map(Number);
      return day > daysInMonth(y, m) - 3 ? 31 : day;
    })
    .sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const day of days) {
    const last = clusters[clusters.length - 1];
    if (last && day - last[last.length - 1] <= 3) last.push(day);
    else clusters.push([day]);
  }
  // The usual day in each: the latest, since early deposits are the weekend shifts.
  return clusters.map((c) => Math.max(...c));
}

// A steady rhythm in a source's deposit dates (distinct, sorted), or null.
// Three deposits are needed before calling it.
export function detectPaySchedule(dates: string[], coveredThrough: string | null, today: string): PaySchedule | null {
  if (dates.length < 3) return null;
  const recent = dates.slice(-8);
  const gaps = recent.slice(1).map((d, i) => daysBetween(recent[i], d));
  const typical = median(gaps);
  const fits = (min: number, max: number) => gaps.filter((g) => g >= min && g <= max).length >= Math.ceil(gaps.length * 0.6);
  const last = recent[recent.length - 1];
  const [ly, lm] = last.split("-").map(Number);
  const lastDay = (() => {
    const day = Number(last.slice(8, 10));
    return day > daysInMonth(ly, lm) - 3 ? 31 : day;
  })();

  let frequency: PayFrequency;
  let payDays: number[] = [];
  let nextDate: string;
  if (typical >= 6 && typical <= 8 && fits(5, 9)) {
    frequency = "weekly";
    nextDate = addDays(last, 7);
  } else if (typical >= 12 && typical <= 17 && fits(11, 18)) {
    // Every two weeks is 14 days apart nearly every time (a holiday can
    // shift one). Twice a month alternates 14 and 16-17 days, landing on
    // the same two days each month.
    const fourteens = gaps.filter((g) => g === 14).length;
    const clusters = payDayClusters(recent);
    if (fourteens >= Math.ceil(gaps.length * 0.75)) {
      frequency = "biweekly";
      nextDate = addDays(last, 14);
    } else if (clusters.length === 2 && recent.length >= 4) {
      frequency = "semimonthly";
      payDays = clusters;
      const later = clusters.find((d) => d > lastDay + 3);
      nextDate = later !== undefined ? onDay(ly, lm, later) : onDay(ly, lm + 1, clusters[0]);
    } else if (fits(13, 15)) {
      frequency = "biweekly";
      nextDate = addDays(last, 14);
    } else return null;
  } else if (typical >= 26 && typical <= 35 && fits(24, 37)) {
    frequency = "monthly";
    const clusters = payDayClusters(recent);
    payDays = [clusters.length === 1 ? clusters[0] : Number(last.slice(8, 10))];
    nextDate = onDay(ly, lm + 1, payDays[0]);
  } else return null;

  const overdue = addDays(nextDate, LATE_AFTER_DAYS);
  const late = overdue < today && coveredThrough !== null && coveredThrough > overdue;
  return { frequency, payDays, lastDate: last, nextDate, late };
}

function ordinal(n: number): string {
  if (n === 31) return "last day";
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

// "Every 2 weeks", "Twice a month (1st & 15th)", "Every month on the 1st".
export function describePaySchedule(s: PaySchedule): string {
  if (s.frequency === "weekly") return "Every week";
  if (s.frequency === "biweekly") return "Every 2 weeks";
  if (s.frequency === "semimonthly") return `Twice a month (${s.payDays.map(ordinal).join(" & ")})`;
  return `Every month on the ${ordinal(s.payDays[0])}`;
}

// Groups income transactions (every date, so schedules have history) into
// sources, with totals for start..end. Sources with nothing in the range
// still show when a paycheck from them is late.
export function groupIncomeSources(
  income: Transaction[],
  range: { start: string; end: string },
  keyFor: (merchant: string) => string,
  displayName: (merchant: string) => string,
  labels: Map<string, IncomeLabel>,
  coveredThrough: Map<number, string>,
  today: string
): IncomeSource[] {
  const byKey = new Map<string, Transaction[]>();
  for (const t of income) {
    if (t.ignored || t.amount <= 0) continue;
    const key = keyFor(t.merchant);
    byKey.set(key, [...(byKey.get(key) ?? []), t]);
  }
  const sources: IncomeSource[] = [];
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    const inRange = sorted.filter((t) => t.date >= range.start && t.date <= range.end);
    const schedule = detectPaySchedule(
      [...new Set(sorted.map((t) => t.date))],
      coveredThrough.get(latest.accountId) ?? null,
      today
    );
    if (inRange.length === 0 && !schedule?.late) continue;
    const label = labels.get(key);
    sources.push({
      key,
      name: label?.name || displayName(latest.merchant),
      nickname: label?.name ?? null,
      kind: label?.kind ?? null,
      accountName: latest.accountName,
      total: inRange.reduce((sum, t) => sum + t.amount, 0),
      deposits: [...inRange].reverse(),
      schedule,
    });
  }
  return sources.sort((a, b) => b.total - a.total);
}
