import { describe, expect, it } from "vitest";
import { findStatementCardBalance, findStatementClosingDate } from "../lib/parseStatement";

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

describe("findStatementClosingDate", () => {
  it("reads closing dates however they're printed", () => {
    expect(findStatementClosingDate("Opening/Closing Date 09/26/26 - 10/25/26")).toBe("2026-10-25");
    expect(findStatementClosingDate("Closing Date 10/15/2026")).toBe("2026-10-15");
    expect(findStatementClosingDate("Statement Date: Oct 18, 2026")).toBe("2026-10-18");
    expect(findStatementClosingDate("Ending balance on 10/31 $1,234.56", 2026)).toBe("2026-10-31");
  });
  it("isn't fooled by a bank statement's monthly fee period", () => {
    const text = "Beginning balance on 9/9 $1,000.00\nEnding balance on 10/7 $900.00\nMonthly service fee summary\nFee period 09/01/2026 - 09/30/2026\nStandard monthly service fee $10.00";
    expect(findStatementClosingDate(text, 2026)).toBe("2026-10-07");
    expect(findStatementClosingDate("Fee period 09/01/2026 - 09/30/2026\n10/02 STARBUCKS 4.50")).toBeNull();
  });

  it("returns null when the statement prints none", () => {
    expect(findStatementClosingDate("10/02 STARBUCKS 4.50\n10/05 SHELL 30.00")).toBeNull();
  });
});
