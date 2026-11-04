import { describe, expect, it } from "vitest";
import { accountMonthState, checkInMonth, checkInStreak, monthEndStatementNeeded, statementsDone } from "../lib/checkIn";
import type { StatementStatus } from "../lib/statementReminders";

const status = (readyMonths: string[], missingMonths: string[] = [], over: Partial<StatementStatus> = {}): StatementStatus => ({
  accountId: 1,
  accountName: "Card",
  remindersOn: true,
  statementDay: null,
  statementDates: [],
  firstDate: "2026-01-01",
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

describe("accountMonthState", () => {
  const today = "2026-11-04";
  it("says where each account stands for the month", () => {
    const closed = status([], [], { statementDates: ["2026-09-15", "2026-10-15"], nextExpected: "2026-11-15" });
    expect(accountMonthState(closed, "2026-10", today)).toEqual({ kind: "closed", line: "Statement closed Oct 15" });
    expect(accountMonthState(status([], ["2026-10"]), "2026-10", today)?.kind).toBe("missing");
    expect(accountMonthState(status(["2026-10"]), "2026-10", today)?.line).toBe("October statement is ready to upload");
    const split = status([], [], { statementDay: 15, statementDates: ["2026-10-15"], nextExpected: "2026-11-15" });
    expect(accountMonthState(split, "2026-10", today)).toEqual({
      kind: "waiting",
      line: "Waiting for the Nov 15 statement (has the rest of October) · out around Nov 20",
    });
    expect(accountMonthState(status([], [], { nextExpected: "2026-11-20" }), "2026-10", today)?.kind).toBe("upToDate");
  });

  it("leaves out accounts that started later or have reminders off", () => {
    expect(accountMonthState(status([], [], { firstDate: "2026-11-01" }), "2026-10", today)).toBeNull();
    expect(accountMonthState(status([], [], { remindersOn: false }), "2026-10", today)).toBeNull();
  });
});
