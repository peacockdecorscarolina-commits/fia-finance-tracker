import { describe, expect, it } from "vitest";
import { checkInMonth, checkInStreak, statementsDone } from "../lib/checkIn";
import type { StatementStatus } from "../lib/statementReminders";

const status = (readyMonths: string[], missingMonths: string[] = []): StatementStatus => ({
  accountId: 1,
  accountName: "Card",
  remindersOn: true,
  lastStatementDate: null,
  nextExpected: null,
  readyMonths,
  missingMonths,
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
