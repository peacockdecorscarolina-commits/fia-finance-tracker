// Walks a tracked loan forward from its known balance as a simple-interest
// loan (how most car loans work): interest builds up day by day on the
// principal only -- never on unpaid interest -- and each payment covers the
// interest owed so far before the rest comes off the principal. With no
// rate this is just "balance minus payments", the original behavior.
//
// Mortgage payments usually bundle in escrow (property tax, home insurance)
// that never touches the loan, so a fixed escrow amount is taken off each
// payment before it's applied.

export type LoanPayment = { date: string; amount: number };

export const LOAN_KINDS = ["Car", "House", "Other"] as const;
export type LoanKind = (typeof LOAN_KINDS)[number];
export const LOAN_KIND_ICON: Record<LoanKind, string> = { Car: "🚗", House: "🏠", Other: "💳" };

export type TrackedLoan = {
  name: string;
  loanAmount: number;
  loanAsOfDate: string;
  loanInterestRate: number | null;
  loanEscrow: number | null;
};

export type LoanStatus = {
  remaining: number;
  interestSoFar: number;
  // One entry per month from the as-of month through the current month,
  // each the balance at that month's end (or today, for the current month).
  history: { month: string; remaining: number }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(from: string, to: string): number {
  return Math.max(0, (Date.parse(to) - Date.parse(from)) / DAY_MS);
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function simulateLoan(loan: TrackedLoan, payments: LoanPayment[], today: string = localToday()): LoanStatus {
  const { loanAmount: startingBalance, loanAsOfDate: asOfDate, loanInterestRate, loanEscrow } = loan;
  const dailyRate = loanInterestRate ? loanInterestRate / 100 / 365 : 0;
  const escrow = loanEscrow ?? 0;
  const due = payments
    .filter((p) => p.date > asOfDate && p.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  let principal = startingBalance;
  let unpaidInterest = 0;
  let interestSoFar = 0;
  let cursor = asOfDate;
  let next = 0;

  // No interest on a paid-off (or overpaid) principal.
  function accrueTo(date: string) {
    if (dailyRate && principal > 0) {
      const interest = principal * dailyRate * daysBetween(cursor, date);
      unpaidInterest += interest;
      interestSoFar += interest;
    }
    if (date > cursor) cursor = date;
  }

  function pay(amount: number) {
    const toInterest = Math.min(amount, unpaidInterest);
    unpaidInterest -= toInterest;
    principal -= amount - toInterest;
  }

  const balance = () => Math.max(principal + unpaidInterest, 0);

  const history: LoanStatus["history"] = [];
  for (let month = asOfDate.slice(0, 7); month <= today.slice(0, 7); month = nextMonth(month)) {
    const monthEnd = lastDayOfMonth(month) < today ? lastDayOfMonth(month) : today;
    while (next < due.length && due[next].date <= monthEnd) {
      accrueTo(due[next].date);
      pay(Math.max(Math.abs(due[next].amount) - escrow, 0));
      next++;
    }
    accrueTo(monthEnd);
    history.push({ month, remaining: balance() });
  }

  return { remaining: balance(), interestSoFar, history };
}
