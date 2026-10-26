import { describe, expect, it } from "vitest";
import { findStatementCardBalance } from "../lib/parseStatement";

describe("findStatementCardBalance", () => {
  it.each([
    ["Amex", "Previous Balance $812.40\nNew Balance $1,240.18\nMinimum Payment Due $40.00\nClosing Date 10/25/26", 1240.18, "2026-10-25"],
    ["Chase", "Opening/Closing Date 09/26/26 - 10/25/26\nPrevious Balance $500.00\nNew Balance $612.03", 612.03, "2026-10-25"],
    ["Capital One", "Dec 10, 2025 - Jan 09, 2026\nPrevious Balance $100.00\nNew Balance = $2,045.67", 2045.67, "2026-01-09"],
    ["Citi", "Statement Closing Date: 10/22/2026\nNew balance: $318.90", 318.9, "2026-10-22"],
    ["Statement Balance wording", "Statement Balance $95.12\nStatement Date October 20, 2026", 95.12, "2026-10-20"],
  ])("reads %s's balance and closing date", (_issuer, text, owed, date) => {
    expect(findStatementCardBalance(text, null)).toEqual({ owed, date });
  });

  it("reads a credit balance as a negative amount owed", () => {
    expect(findStatementCardBalance("New Balance -$25.00\nClosing Date 10/25/26", null)?.owed).toBe(-25);
    expect(findStatementCardBalance("New Balance $25.00 CR\nClosing Date 10/25/26", null)?.owed).toBe(-25);
  });

  it("ignores the previous balance", () => {
    expect(findStatementCardBalance("Previous Balance $900.00\nPayments -$900.00\nClosing Date 10/25/26", null)).toBeNull();
  });

  it("falls back to the given date when no closing date is printed", () => {
    expect(findStatementCardBalance("New Balance $50.00", "2026-10-19")).toEqual({ owed: 50, date: "2026-10-19" });
  });
});
