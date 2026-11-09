import { describe, expect, it } from "vitest";
import { accountMonthState, checkInMonth, checkInStreak, monthEndStatementNeeded, statementsDone, upcomingStatements } from "../lib/checkIn";
import { statementStatus, type StatementStatus } from "../lib/statementReminders";

const status = (readyMonths: string[], missingMonths: string[] = [], over: Partial<StatementStatus> = {}): StatementStatus => ({
  accountId: 1,
  accountName: "Card",
  remindersOn: true,
  statementDay: null,
  statementDates: [],
  firstDate: "2026-01-01",
  lastStatementDate: null,
  coveredThrough: null,
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

describe("upcomingStatements", () => {
  it("lists when a future month's statements come out", () => {
    const card = status([], [], { statementDay: 15, lastStatementDate: "2026-10-15", nextExpected: "2026-11-15" });
    expect(upcomingStatements(card, "2026-11", "2026-11-04")).toEqual({
      kind: "waiting",
      line: "Nov 15 statement · out around Nov 20\nDec 15 statement (has the rest of November) · out around Dec 20",
    });
    const monthEnd = status([], [], { statementDay: 31, lastStatementDate: "2026-10-31", nextExpected: "2026-11-30" });
    expect(upcomingStatements(monthEnd, "2026-11", "2026-11-04")?.line).toBe("Nov 30 statement · out around Dec 5");
  });

  it("marks statements already in, and guesses by month without a day", () => {
    const both = status([], [], { statementDay: 15, lastStatementDate: "2026-11-15", nextExpected: "2026-12-15" });
    expect(upcomingStatements(both, "2026-11", "2026-11-25")?.line).toBe(
      "✅ Nov 15 statement in\nDec 15 statement (has the rest of November) · out around Dec 20"
    );
    const noDay = status([], [], { lastStatementDate: "2026-10-20", nextExpected: "2026-11-20" });
    expect(upcomingStatements(noDay, "2026-11", "2026-11-04")?.line).toBe("Nov 20 statement · out around Nov 25");
  });
});

describe("mid-month statements without a closing day", () => {
  const card = (coveredThrough: string, nextExpected: string) => status([], [], { coveredThrough, nextExpected });
  it("waits for the next statement when uploads stop mid-month", () => {
    const s = card("2026-10-14", "2026-11-14");
    expect(monthEndStatementNeeded(s, "2026-10")).toBe("2026-11-14");
    expect(statementsDone([s], "2026-10")).toBe(false);
    const state = accountMonthState(s, "2026-10", "2026-11-05");
    expect(state?.kind).toBe("waiting");
    expect(state?.line).toContain("Uploaded through Oct 14");
    expect(state?.line).toContain("out around Nov 19");
  });
  it("counts uploads reaching the last week as the whole month", () => {
    expect(monthEndStatementNeeded(card("2026-10-27", "2026-11-27"), "2026-10")).toBeNull();
    expect(accountMonthState(card("2026-10-27", "2026-11-27"), "2026-10", "2026-11-05")?.kind).toBe("upToDate");
  });
  it("is done once the next statement is in", () => {
    expect(monthEndStatementNeeded(card("2026-11-14", "2026-12-14"), "2026-10")).toBeNull();
  });
  it("respects a skipped next month", () => {
    expect(monthEndStatementNeeded(card("2026-10-14", "2026-12-14"), "2026-10")).toBeNull();
  });
});

describe("closing dates that move around", () => {
  const TODAY = "2026-11-09";
  const history = (statementDates: string[], day: number, over = {}) => ({
    accountId: 1,
    accountName: "Wells Fargo Checking",
    transactionDates: ["2026-10-02", "2026-11-01"],
    statementDates,
    skippedMonths: [],
    remindersOn: true,
    statementDay: day,
    ...over,
  });

  it("counts a statement that closed a day or two before the usual day", () => {
    for (const closed of ["2026-11-05", "2026-11-04", "2026-11-01"]) {
      const s = statementStatus(history(["2026-10-06", closed], 6), TODAY);
      expect(s.nextExpected).toBe("2026-12-06");
      expect(s.readyMonths).toEqual([]);
      expect(monthEndStatementNeeded(s, "2026-10")).toBeNull();
      expect(statementsDone([s], "2026-10")).toBe(true);
    }
  });
  it("shows it as in when looking ahead", () => {
    const s = statementStatus(history(["2026-11-05"], 6), TODAY);
    expect(upcomingStatements(s, "2026-11", TODAY)?.line).toContain("Nov 6 statement in");
  });
  it("still waits when the last statement is too far before the usual day", () => {
    const s = statementStatus(history(["2026-10-30"], 6), TODAY);
    expect(s.nextExpected).toBe("2026-11-06");
    expect(monthEndStatementNeeded(s, "2026-10")).toBe("2026-11-06");
  });
  it("doesn't count a balance typed in by hand as that statement", () => {
    const s = statementStatus(history(["2026-11-04"], 6, { uploadedClosings: [] }), TODAY);
    expect(s.nextExpected).toBe("2026-11-06");
  });
  it("leaves a statement on or after the usual day alone", () => {
    expect(statementStatus(history(["2026-11-06"], 6), TODAY).nextExpected).toBe("2026-12-06");
    expect(statementStatus(history(["2026-11-08"], 6), TODAY).nextExpected).toBe("2026-12-06");
  });
  it("handles the end of a month", () => {
    expect(statementStatus(history(["2026-11-28"], 31), "2026-12-02").nextExpected).toBe("2026-12-31");
  });
});
