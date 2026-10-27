import { describe, expect, it } from "vitest";
import { addMonths, describeStatementStatus, monthToSkip, statementStatus, type StatementHistory } from "../lib/statementReminders";

// A card used every few days from `from` to `to`, with statements closing on the 25th.
function days(from: string, to: string, every = 3): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + every)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const card = (over: Partial<StatementHistory>): StatementHistory => ({
  accountId: 1,
  accountName: "Chase Sapphire",
  transactionDates: days("2026-06-26", "2026-09-25"),
  statementDates: ["2026-07-25", "2026-08-25", "2026-09-25"],
  skippedMonths: [],
  remindersOn: true,
  ...over,
});

describe("addMonths", () => {
  it("keeps the day inside short months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-25", 1)).toBe("2027-01-25");
    expect(addMonths("2026-03-15", -2)).toBe("2026-01-15");
  });
});

describe("statementStatus", () => {
  it("expects the next statement a month after the last and calls it ready 5 days later", () => {
    expect(statementStatus(card({}), "2026-10-29")).toMatchObject({ nextExpected: "2026-10-25", readyMonths: [], missingMonths: [] });
    expect(statementStatus(card({}), "2026-10-30").readyMonths).toEqual(["2026-10"]);
    expect(statementStatus(card({}), "2026-12-31").readyMonths).toEqual(["2026-10", "2026-11", "2026-12"]);
  });

  it("works from the last transaction when no closing date was saved", () => {
    const s = statementStatus(card({ statementDates: [], transactionDates: ["2026-09-02", "2026-09-30"] }), "2026-11-05");
    expect(s.nextExpected).toBe("2026-10-30");
    expect(s.readyMonths).toEqual(["2026-10"]);
  });

  it("finds a month with no transactions at all", () => {
    const dates = [...days("2026-06-01", "2026-07-31"), ...days("2026-09-01", "2026-09-30")];
    expect(statementStatus(card({ statementDates: [], transactionDates: dates }), "2026-10-05").missingMonths).toEqual(["2026-08"]);
  });

  it("finds a skipped statement between two that were uploaded", () => {
    // August's statement (Jul 26 - Aug 25) never uploaded.
    const dates = [...days("2026-06-26", "2026-07-25"), ...days("2026-08-26", "2026-09-25")];
    const s = statementStatus(card({ transactionDates: dates, statementDates: ["2026-07-25", "2026-09-25"] }), "2026-10-01");
    expect(s.missingMonths).toEqual(["2026-08"]);
  });

  it("doesn't call a gap missing when its transactions came another way", () => {
    const s = statementStatus(card({ statementDates: ["2026-07-25", "2026-09-25"] }), "2026-10-01");
    expect(s.missingMonths).toEqual([]);
  });

  it("treats a 'No statement this month' month as uploaded", () => {
    const dates = [...days("2026-06-01", "2026-07-31"), ...days("2026-09-01", "2026-09-30")];
    const s = statementStatus(card({ statementDates: [], transactionDates: dates, skippedMonths: ["2026-08", "2026-10"] }), "2026-11-10");
    expect(s.missingMonths).toEqual([]);
    expect(s.readyMonths).toEqual([]);
    expect(s.nextExpected).toBe("2026-11-28"); // last transaction Sep 28; October skipped
  });

  it("stays quiet when reminders are off or nothing was uploaded", () => {
    expect(statementStatus(card({ remindersOn: false }), "2026-12-31")).toMatchObject({ readyMonths: [], missingMonths: [] });
    expect(statementStatus(card({ transactionDates: [], statementDates: [] }), "2026-12-31").nextExpected).toBeNull();
  });
});

describe("describeStatementStatus", () => {
  it("says what to upload", () => {
    const one = statementStatus(card({}), "2026-11-01");
    expect(describeStatementStatus(one, "2026-11-01")).toBe("October statement is probably ready");
    expect(monthToSkip(one)).toBe("2026-10");
    const dates = [...days("2026-06-26", "2026-07-25"), ...days("2026-08-26", "2026-09-25")];
    const both = statementStatus(card({ transactionDates: dates, statementDates: ["2026-07-25", "2026-09-25"] }), "2026-12-01");
    expect(describeStatementStatus(both, "2026-12-01")).toBe("2 statements to catch up on (October–November) · August is missing");
    expect(monthToSkip(both)).toBe("2026-08");
    expect(describeStatementStatus(statementStatus(card({}), "2026-10-01"), "2026-10-01")).toBeNull();
  });
});
