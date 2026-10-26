import { describe, expect, it } from "vitest";
import { simulateLoan } from "../lib/loan";

const loan = (amount: number, asOf: string, rate: number | null, escrow: number | null = null) => ({
  name: "Loan", loanAmount: amount, loanAsOfDate: asOf, loanInterestRate: rate, loanEscrow: escrow,
});
const monthlyPayments = (count: number, amount: number) =>
  Array.from({ length: count }, (_, i) => {
    const m = i + 2;
    const y = 2025 + Math.floor((m - 1) / 12);
    return { date: `${y}-${String(((m - 1) % 12) + 1).padStart(2, "0")}-01`, amount: -amount };
  });

describe("simulateLoan", () => {
  it("with no rate, is just the balance minus payments", () => {
    expect(simulateLoan(loan(20000, "2025-01-01", null), monthlyPayments(12, 386.66), "2026-01-01").remaining).toBeCloseTo(15360.08, 2);
  });

  it("matches a standard amortization within a dollar", () => {
    // $20,000 at 6% for 60 months -> $16,463.91 left after 12 payments of $386.66.
    // Interest is counted by the day rather than the month, so it lands within a dollar, not to the cent.
    const remaining = simulateLoan(loan(20000, "2025-01-01", 6), monthlyPayments(12, 386.66), "2026-01-01").remaining;
    expect(Math.abs(remaining - 16463.91)).toBeLessThan(1);
  });

  it("charges simple interest, never interest on interest", () => {
    const status = simulateLoan(loan(20000, "2026-01-01", 6), [], "2026-10-25");
    expect(status.interestSoFar).toBeCloseTo((20000 * 0.06 * 297) / 365, 2);
  });

  it("takes mortgage escrow off each payment", () => {
    // $300k at 6.5%, $2,496.20/month including $600 escrow -> ~$296,647 after a year.
    const remaining = simulateLoan(loan(300000, "2025-01-01", 6.5, 600), monthlyPayments(12, 2496.2), "2026-01-01").remaining;
    expect(Math.abs(remaining - 296647)).toBeLessThan(10);
  });
});
