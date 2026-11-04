import { addDays, addMonths, closingOnOrAfter, onDay, READY_AFTER_DAYS, type StatementStatus } from "./statementReminders";

// The monthly check-in: once last month's statements are out, upload them,
// clear the review pile, see the month's recap. Month M's check-in opens on
// the 2nd of the month after -- early, so it's there while statements come
// in -- and stays the open one until the next opens.

export const CHECK_IN_DAY = 2;

function shift(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

// Which month's check-in is open on this date (YYYY-MM).
export function checkInMonth(today: string): string {
  const thisMonth = today.slice(0, 7);
  return shift(thisMonth, Number(today.slice(8, 10)) >= CHECK_IN_DAY ? -1 : -2);
}

function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// A statement closing mid-month splits the month: October's last days are on
// the statement closing in November. With the account's statement day
// known, this is that statement's closing date while it isn't in yet
// (uploaded, or its month marked "No statement"), else null.
export function monthEndStatementNeeded(s: StatementStatus, month: string): string | null {
  if (!s.remindersOn || s.statementDay === null || !s.nextExpected) return null;
  const needed = closingOnOrAfter(lastDayOf(month), s.statementDay);
  // The next statement expected comes after it, so it's covered.
  return s.nextExpected > needed ? null : needed;
}

// Statements for that month are in when no account is still waiting on one
// from it or before it, nor on the one holding the month's last days.
export function statementsDone(statuses: StatementStatus[], month: string): boolean {
  return statuses.every(
    (s) =>
      [...s.readyMonths, ...s.missingMonths].every((m) => m > month) && monthEndStatementNeeded(s, month) === null
  );
}

export type AccountMonthState = { kind: "closed" | "upToDate" | "waiting" | "missing" | "ready"; line: string };

function shortDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// Where one account's statements stand for a month, for the check-in's
// statements step. Null when the account has nothing that early (or
// reminders are off for it).
export function accountMonthState(s: StatementStatus, month: string, today: string): AccountMonthState | null {
  if (!s.remindersOn || !s.firstDate || s.firstDate.slice(0, 7) > month) return null;
  const name = new Date(`${month}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  if (s.missingMonths.includes(month)) return { kind: "missing", line: `${name} statement is missing` };
  if (s.readyMonths.includes(month)) return { kind: "ready", line: `${name} statement is ready to upload` };
  if (s.readyMonths.some((m) => m < month) || s.missingMonths.some((m) => m < month)) {
    return { kind: "missing", line: "An earlier statement is still missing" };
  }
  const needed = monthEndStatementNeeded(s, month);
  if (needed) {
    const out = addDays(needed, READY_AFTER_DAYS);
    const when = out <= today ? "should be out now" : `out around ${shortDate(out)}`;
    const which =
      needed.slice(0, 7) === month
        ? `Its ${name} statement closes ${shortDate(needed)}`
        : `Waiting for the ${shortDate(needed)} statement (has the rest of ${name})`;
    return { kind: "waiting", line: `${which} · ${when}` };
  }
  const closings = s.statementDates.filter((d) => d.slice(0, 7) === month);
  if (closings.length > 0) {
    return { kind: "closed", line: `Statement closed ${closings.map(shortDate).join(" and ")}` };
  }
  return { kind: "upToDate", line: "Up to date" };
}

// A month whose check-in hasn't opened yet: the statements that will make up
// its numbers and when each comes out -- the one closing in it and, when
// statements close mid-month, the next one holding its last days. Without a
// statement day, the expected closings that fall in the month.
export function upcomingStatements(s: StatementStatus, month: string, today: string): AccountMonthState | null {
  if (!s.remindersOn || !s.nextExpected) return null;
  const name = new Date(`${month}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  let closings: string[];
  if (s.statementDay !== null) {
    closings = [...new Set([onDay(month, s.statementDay), closingOnOrAfter(lastDayOf(month), s.statementDay)])];
  } else {
    closings = [];
    for (let d = s.nextExpected; d.slice(0, 7) <= month; d = addMonths(d, 1)) if (d.slice(0, 7) === month) closings.push(d);
  }
  if (closings.length === 0) return null;
  const uploaded = (d: string) => s.lastStatementDate !== null && d <= s.lastStatementDate;
  const parts = closings.map((d) => {
    const rest = d.slice(0, 7) !== month ? ` (has the rest of ${name})` : "";
    if (uploaded(d)) return `✅ ${shortDate(d)} statement in`;
    const out = addDays(d, READY_AFTER_DAYS);
    return `${shortDate(d)} statement${rest} · ${out <= today ? "should be out now" : `out around ${shortDate(out)}`}`;
  });
  return { kind: closings.every(uploaded) ? "closed" : "waiting", line: parts.join("\n") };
}

// Months in a row with a finished check-in, counting back from the open
// one -- or from the one before it while the open one isn't done yet, so
// the streak doesn't drop the moment a new month opens.
export function checkInStreak(doneMonths: string[], openMonth: string): number {
  const done = new Set(doneMonths);
  let month = done.has(openMonth) ? openMonth : shift(openMonth, -1);
  let streak = 0;
  while (done.has(month)) {
    streak++;
    month = shift(month, -1);
  }
  return streak;
}

export function previousMonth(month: string): string {
  return shift(month, -1);
}
