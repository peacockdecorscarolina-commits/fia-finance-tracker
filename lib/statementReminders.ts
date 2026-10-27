// Works out, per account, whether a statement is waiting to be uploaded:
// - "ready": the next statement has probably come out. Statements close
//   about a month apart, so the next one is expected a month after the
//   last one (its closing date, or the last transaction when no closing
//   date is known), and counted as out READY_AFTER_DAYS after that.
// - "missing": a month in the middle that never got uploaded -- either no
//   transactions at all that month, or two statements more than a month
//   apart with nothing in the gap where the one between them belongs.
// Months the user marked "No statement this month" count as uploaded.

export const READY_AFTER_DAYS = 5;
// Only look this far back for skipped months; older gaps aren't worth a nag.
const MISSING_LOOKBACK_MONTHS = 24;

export type StatementHistory = {
  accountId: number;
  accountName: string;
  // Distinct dates with a transaction, sorted (YYYY-MM-DD).
  transactionDates: string[];
  // Statement closing dates (the dates statement balances were saved for), sorted.
  statementDates: string[];
  skippedMonths: string[];
  remindersOn: boolean;
};

export type StatementStatus = {
  accountId: number;
  accountName: string;
  remindersOn: boolean;
  lastStatementDate: string | null;
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
  const empty = { accountId: h.accountId, accountName: h.accountName, remindersOn: h.remindersOn, lastStatementDate, readyMonths: [], missingMonths: [] };
  const base = [lastStatementDate, lastTransaction].filter((d): d is string => d !== null).sort().pop();
  if (!base) return { ...empty, nextExpected: null };

  const skipped = new Set(h.skippedMonths);
  let nextExpected = addMonths(base, 1);
  while (skipped.has(nextExpected.slice(0, 7))) nextExpected = addMonths(nextExpected, 1);
  if (!h.remindersOn) return { ...empty, nextExpected };

  const readyMonths: string[] = [];
  for (let k = 1; k <= 12; k++) {
    const closing = addMonths(base, k);
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
  return { ...empty, nextExpected, readyMonths, missingMonths };
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
