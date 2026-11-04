import { closingOnOrAfter, type StatementStatus } from "./statementReminders";

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
