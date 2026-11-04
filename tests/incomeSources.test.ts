import { describe, expect, it } from "vitest";
import { describePaySchedule, detectPaySchedule, groupIncomeSources, looksLikePaycheck } from "../lib/incomeSources";
import { tx } from "./helpers";

describe("detectPaySchedule", () => {
  it("spots every two weeks", () => {
    const s = detectPaySchedule(["2026-09-04", "2026-09-18", "2026-10-02", "2026-10-16", "2026-10-30"], null, "2026-11-04");
    expect(s).toMatchObject({ frequency: "biweekly", nextDate: "2026-11-13", late: false });
    expect(describePaySchedule(s!)).toBe("Every 2 weeks");
  });

  it("spots twice a month on the same days, even when a weekend moves one", () => {
    // Aug 15 2026 is a Saturday, paid Friday the 14th.
    const s = detectPaySchedule(["2026-08-01", "2026-08-14", "2026-09-01", "2026-09-15", "2026-10-01", "2026-10-15"], null, "2026-10-20");
    expect(s).toMatchObject({ frequency: "semimonthly", payDays: [1, 15], nextDate: "2026-11-01" });
    expect(describePaySchedule(s!)).toBe("Twice a month (1st & 15th)");
  });

  it("spots monthly and weekly", () => {
    const monthly = detectPaySchedule(["2026-07-30", "2026-08-31", "2026-09-30", "2026-10-30"], null, "2026-11-04");
    expect(monthly).toMatchObject({ frequency: "monthly", nextDate: "2026-11-30" });
    expect(describePaySchedule(monthly!)).toBe("Every month on the last day");
    expect(detectPaySchedule(["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23"], null, "2026-10-25")?.frequency).toBe("weekly");
  });

  it("needs three deposits and a steady rhythm", () => {
    expect(detectPaySchedule(["2026-10-01", "2026-10-15"], null, "2026-10-20")).toBeNull();
    expect(detectPaySchedule(["2026-07-03", "2026-07-30", "2026-08-02", "2026-10-11"], null, "2026-10-20")).toBeNull();
  });

  it("calls a paycheck late only once statements past its date are uploaded", () => {
    const dates = ["2026-09-04", "2026-09-18", "2026-10-02", "2026-10-16"];
    // Next was Oct 30. Uploaded only through Oct 20: can't tell yet.
    expect(detectPaySchedule(dates, "2026-10-20", "2026-11-10")?.late).toBe(false);
    // Uploaded through Nov 8 and still nothing: late.
    expect(detectPaySchedule(dates, "2026-11-08", "2026-11-10")?.late).toBe(true);
  });
});

describe("groupIncomeSources", () => {
  const key = (m: string) => m.toLowerCase().replace(/[^a-z]/g, "");
  const name = (m: string) => m;
  const income = [
    tx("2026-09-04", "ACME PAYROLL", 2100),
    tx("2026-09-18", "ACME PAYROLL", 2100),
    tx("2026-10-02", "ACME PAYROLL", 2100),
    tx("2026-10-16", "ACME PAYROLL", 2100),
    tx("2026-10-30", "ACME PAYROLL", 2100),
    tx("2026-10-12", "UBER EARNINGS", 320),
    tx("2026-10-26", "UBER EARNINGS", 330),
    tx("2026-10-05", "ZELLE FROM TENANT", 1200),
  ];

  it("totals each source for the range, biggest first, with nicknames", () => {
    const labels = new Map([["acmepayroll", { name: "Main job", kind: "salary" as const }]]);
    const sources = groupIncomeSources(income, { start: "2026-10-01", end: "2026-10-31" }, key, name, labels, new Map(), "2026-11-04");
    expect(sources.map((s) => [s.name, s.total, s.deposits.length])).toEqual([
      ["Main job", 6300, 3],
      ["ZELLE FROM TENANT", 1200, 1],
      ["UBER EARNINGS", 650, 2],
    ]);
    expect(sources[0].kind).toBe("salary");
    expect(sources[0].schedule?.frequency).toBe("biweekly");
  });

  it("still lists a source whose paycheck is late", () => {
    const covered = new Map([[1, "2026-11-25"]]);
    const sources = groupIncomeSources(income, { start: "2026-11-01", end: "2026-11-30" }, key, name, new Map(), covered, "2026-11-30");
    expect(sources.map((s) => [s.name, s.total, s.schedule?.late])).toEqual([["ACME PAYROLL", 0, true]]);
  });
});

describe("looksLikePaycheck", () => {
  it("spots pay, and leaves money that might be a payback alone", () => {
    for (const m of ["ACME CORP PAYROLL PPD ID 123", "DIRECT DEP GUSTO", "Dir Dep Walmart", "STATE OF NY SALARY", "WAGES ACME"]) {
      expect(looksLikePaycheck(m)).toBe(true);
    }
    for (const m of ["ZELLE FROM JOHN", "VENMO CASHOUT", "TRANSFER FROM SAVINGS", "AMAZON REFUND", "ONLINE DEPOSIT", "PAYPAL"]) {
      expect(looksLikePaycheck(m)).toBe(false);
    }
  });
});
