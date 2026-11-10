// Works out, per account, whether a statement is waiting to be uploaded:
// - "ready": the next statement has probably come out. With the account's
//   statement day known (read off a statement, or given by the user), the
//   next one closes on that day; without it, a month after the last one
//   (its closing date, or the last transaction when no closing date is
//   known). Either way it counts as out READY_AFTER_DAYS after closing.
// - "missing": a month in the middle that never got uploaded -- either no
//   transactions at all that month, or two statements more than a month
//   apart with nothing in the gap where the one between them belongs.
// Months the user marked "No statement this month" count as uploaded.

export const READY_AFTER_DAYS = 5;
// Closing dates move around (Wells Fargo checking: the 6th, then the 8th,
// then the 5th). A statement that closed up to this many days before the
// usual day is that cycle's statement, not an early extra one.
export const CLOSING_DRIFT_DAYS = 5;
// Only look this far back for skipped months; older gaps aren't worth a nag.
const MISSING_LOOKBACK_MONTHS = 24;

export type StatementHistory = {
  accountId: number;
  accountName: string;
  // Distinct dates with a transaction, sorted (YYYY-MM-DD).
  transactionDates: string[];
  // Statement closing dates (the dates statement balances were saved for), sorted.
  statementDates: string[];
  // The closing dates that came from uploaded statements. statementDates
  // also holds balances typed in by hand, which can be on any day.
  uploadedClosings?: string[];
  skippedMonths: string[];
  remindersOn: boolean;
  // Day of the month statements close on, when known.
  statementDay: number | null;
};

export type StatementStatus = {
  accountId: number;
  accountName: string;
  remindersOn: boolean;
  statementDay: number | null;
  // Every closing date known, sorted, and the account's earliest date.
  statementDates: string[];
  firstDate: string | null;
  lastStatementDate: string | null;
  // The latest date uploads cover: the last closing or transaction.
  coveredThrough: string | null;
  // When the next statement should close.
  nextExpected: string | null;
  // Statements that have come out but aren't uploaded, oldest first (YYYY-MM).
  readyMonths: string[];
  missingMonths: string[];
};

function parse(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function format(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
}

// Same day n months later, kept inside the month (Jan 31 + 1 = Feb 28).
export function addMonths(date: string, months: number): string {
  const d = parse(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return format(d);
}

export function onDay(month: string, day: number): string {
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return `${month}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

// The first date after `date` falling on `day` (the month's last day when
// it's shorter -- a statement "on the 31st" closes Feb 28).
export function nextOnDay(date: string, day: number): string {
  const sameMonth = onDay(date.slice(0, 7), day);
  return sameMonth > date ? sameMonth : onDay(addMonths(`${date.slice(0, 7)}-01`, 1).slice(0, 7), day);
}

// The statement a transaction on `date` belongs to closes on this date.
export function closingOnOrAfter(date: string, day: number): string {
  return nextOnDay(addDays(date, -1), day);
}

function monthsBetweenExclusive(first: string, last: string): string[] {
  const out: string[] = [];
  let m = addMonths(`${first}-01`, 1).slice(0, 7);
  while (m < last) {
    out.push(m);
    m = addMonths(`${m}-01`, 1).slice(0, 7);
  }
  return out;
}

function hasDateBetween(sortedDates: string[], from: string, to: string): boolean {
  return sortedDates.some((d) => d > from && d <= to);
}

export function statementStatus(h: StatementHistory, today: string): StatementStatus {
  const lastStatementDate = h.statementDates[h.statementDates.length - 1] ?? null;
  const lastTransaction = h.transactionDates[h.transactionDates.length - 1] ?? null;
  const empty = { accountId: h.accountId, accountName: h.accountName, remindersOn: h.remindersOn, statementDay: h.statementDay, statementDates: h.statementDates, firstDate: [h.transactionDates[0], h.statementDates[0]].filter(Boolean).sort()[0] ?? null, lastStatementDate, readyMonths: [], missingMonths: [] };
  const base = [lastStatementDate, lastTransaction].filter((d): d is string => d !== null).sort().pop();
  if (!base) return { ...empty, coveredThrough: null, nextExpected: null };

  const skipped = new Set(h.skippedMonths);
  // The k-th statement closing after `base`.
  const day = h.statementDay;
  const closingAfter = (k: number) => {
    if (day === null) return addMonths(base, k);
    let d = nextOnDay(base, day);
    if ((h.uploadedClosings ?? h.statementDates).includes(base) && d <= addDays(base, CLOSING_DRIFT_DAYS)) {
      d = nextOnDay(d, day);
    }
    for (let i = 1; i < k; i++) d = nextOnDay(d, day);
    return d;
  };

  let k = 1;
  while (skipped.has(closingAfter(k).slice(0, 7)) && k < 24) k++;
  const nextExpected = closingAfter(k);
  if (!h.remindersOn) return { ...empty, coveredThrough: base, nextExpected };

  const readyMonths: string[] = [];
  for (let k = 1; k <= 12; k++) {
    const closing = closingAfter(k);
    if (addDays(closing, READY_AFTER_DAYS) > today) break;
    if (!skipped.has(closing.slice(0, 7))) readyMonths.push(closing.slice(0, 7));
  }

  const missing = new Set<string>();
  const months = new Set(h.transactionDates.map((d) => d.slice(0, 7)));
  const firstMonth = [h.transactionDates[0], h.statementDates[0]].filter(Boolean).sort()[0].slice(0, 7);
  for (const m of monthsBetweenExclusive(firstMonth, base.slice(0, 7))) {
    if (!months.has(m)) missing.add(m);
  }
  // Two statements more than a month apart: the one that should close in
  // between is missing unless transactions from its weeks are there anyway
  // (say, from a CSV covering that time).
  for (let i = 1; i < h.statementDates.length; i++) {
    const prev = h.statementDates[i - 1];
    const next = h.statementDates[i];
    for (let k = 1; addMonths(prev, k) < addDays(next, -10); k++) {
      const closing = addMonths(prev, k);
      if (!hasDateBetween(h.transactionDates, addDays(closing, -20), closing)) missing.add(closing.slice(0, 7));
    }
  }

  const oldest = addMonths(today, -MISSING_LOOKBACK_MONTHS).slice(0, 7);
  const missingMonths = [...missing].filter((m) => !skipped.has(m) && m >= oldest).sort();
  return { ...empty, coveredThrough: base, nextExpected, readyMonths, missingMonths };
}

// Repairs a bank account's dates saved when a statement's monthly fee period
// was misread as its closing date. Those are month-ends with no statement
// balance on them, followed within a month by the real one. Returns the dates
// to remove and the real closings to record in their place.
export function misreadClosings(closings: string[], balances: string[]): { remove: string[]; add: string[] } {
  const known = new Set(balances);
  const sorted = [...balances].sort();
  const remove: string[] = [];
  const add = new Set<string>();
  for (const closing of closings) {
    if (known.has(closing) || closing !== onDay(closing.slice(0, 7), 31)) continue;
    const limit = addDays(closing, 31);
    const real = sorted.find((b) => b > closing && b <= limit);
    if (!real) continue;
    remove.push(closing);
    add.add(real);
  }
  return { remove, add: [...add] };
}

export function monthName(month: string, withYear = false): string {
  const d = parse(`${month}-01`);
  return d.toLocaleString("en-US", { month: "long", timeZone: "UTC", ...(withYear ? { year: "numeric" } : {}) });
}

// One line for the reminder, e.g. "November statement is ready" or
// "September is missing".
export function describeStatementStatus(s: StatementStatus, today: string): string | null {
  const thisYear = today.slice(0, 4);
  const name = (m: string) => monthName(m, m.slice(0, 4) !== thisYear);
  const parts: string[] = [];
  if (s.readyMonths.length === 1) parts.push(`${name(s.readyMonths[0])} statement is probably ready`);
  else if (s.readyMonths.length > 1) {
    parts.push(`${s.readyMonths.length} statements to catch up on (${name(s.readyMonths[0])}–${name(s.readyMonths[s.readyMonths.length - 1])})`);
  }
  if (s.missingMonths.length === 1) parts.push(`${name(s.missingMonths[0])} is missing`);
  else if (s.missingMonths.length > 1) parts.push(`${s.missingMonths.length} months missing`);
  return parts.length ? parts.join(" · ") : null;
}

// The month "No statement this month" should mark: a skipped month in the
// middle first, then the oldest ready one.
export function monthToSkip(s: StatementStatus): string | null {
  return s.missingMonths[0] ?? s.readyMonths[0] ?? null;
}

// 1 -> "1st", 22 -> "22nd", 15 -> "15th".
export function ordinalDay(day: number): string {
  const tens = day % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  return `${day}${suffix}`;
}
