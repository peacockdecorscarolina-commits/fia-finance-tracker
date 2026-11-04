import { describe, expect, it } from "vitest";
import { checkInMonth, checkInStreak, monthEndStatementNeeded, statementsDone } from "../lib/checkIn";
import type { StatementStatus } from "../lib/statementReminders";

const status = (readyMonths: string[], missingMonths: string[] = [], over: Partial<StatementStatus> = {}): StatementStatus => ({
  accountId: 1,
  accountName: "Card",
  remindersOn: true,
  statementDay: null,
  lastStatementDate: null,
  nextExpected: null,
  readyMonths,
  missingMonths,
  ...over,
});

describe("checkInMonth", () => {
  it("opens last month's check-in on the 2nd", () => {
    expect(checkInMonth("2026-11-01")).toBe("2026-09");
    expect(checkInMonth("2026-11-02")).toBe("2026-10");
    expect(checkInMonth("2027-01-20")).toBe("2026-12");
    expect(checkInMonth("2027-01-01")).toBe("2026-11");
  });
});

describe("statementsDone", () => {
  it("is done when nothing from that month or earlier is waiting", () => {
    expect(statementsDone([status([]), status(["2026-11"])], "2026-10")).toBe(true);
    expect(statementsDone([status(["2026-10"])], "2026-10")).toBe(false);
    expect(statementsDone([status([], ["2026-08"])], "2026-10")).toBe(false);
  });
});

describe("checkInStreak", () => {
  it("counts months in a row", () => {
    expect(checkInStreak(["2026-08", "2026-09", "2026-10"], "2026-10")).toBe(3);
    expect(checkInStreak(["2026-07", "2026-09", "2026-10"], "2026-10")).toBe(2);
  });

  it("keeps last month's streak while the new one is still open", () => {
    expect(checkInStreak(["2026-08", "2026-09"], "2026-10")).toBe(2);
    expect(checkInStreak(["2026-08"], "2026-10")).toBe(0);
    expect(checkInStreak(["2026-11", "2026-12"], "2027-01")).toBe(2);
  });
});

describe("statements closing mid-month", () => {
  it("waits for the statement holding the month's last days", () => {
    // Closes on the 15th; October's statement (Oct 15) is in, November's (Nov 15) has Oct 16-31.
    const octoberOnly = status([], [], { statementDay: 15, lastStatementDate: "2026-10-15", nextExpected: "2026-11-15" });
    expect(monthEndStatementNeeded(octoberOnly, "2026-10")).toBe("2026-11-15");
    expect(statementsDone([octoberOnly], "2026-10")).toBe(false);
    const both = status([], [], { statementDay: 15, lastStatementDate: "2026-11-15", nextExpected: "2026-12-15" });
    expect(statementsDone([both], "2026-10")).toBe(true);
  });

  it("needs nothing more when statements close at month end", () => {
    const monthEnd = status([], [], { statementDay: 31, lastStatementDate: "2026-10-31", nextExpected: "2026-11-30" });
    expect(statementsDone([monthEnd], "2026-10")).toBe(true);
  });

  it("goes by months when the statement day isn't known", () => {
    expect(statementsDone([status([], [], { nextExpected: "2026-11-15" })], "2026-10")).toBe(true);
  });
});
