import { describe, expect, it } from "vitest";
import { notInFuture, parseStatement, yearEarlier } from "../lib/parseStatement";

const dates = (text: string, year?: number) => parseStatement(text, year).map((t) => t.date);

describe("parseStatement year handling", () => {
  const janStatementNoYear = "Date Description Amount\n12/28 STARBUCKS $5.25\n01/03 AMAZON $19.99\n";

  it("puts a January statement's December dates in the previous year", () => {
    expect(dates(janStatementNoYear, 2026)).toEqual(["2025-12-28", "2026-01-03"]);
    expect(dates(janStatementNoYear, 2027)).toEqual(["2026-12-28", "2027-01-03"]);
  });

  it("lets a printed statement period win over the picked year", () => {
    const text = "Statement Period 12/10/2025 to 01/09/2026\nDate Description Amount\n12/28 STARBUCKS $5.25\n01/03 AMAZON $19.99\n";
    expect(dates(text, 2027)).toEqual(["2025-12-28", "2026-01-03"]);
  });

  it("uses the picked year for an ordinary month", () => {
    expect(dates("Date Description Amount\n06/03 AMAZON $19.99\n", 2027)).toEqual(["2027-06-03"]);
  });
});

describe("dates that would be in the future", () => {
  it("moves a guessed date past today back a year", () => {
    expect(notInFuture("2026-12-05", "2026-11-18")).toBe("2025-12-05");
    expect(notInFuture("2026-11-19", "2026-11-18")).toBe("2026-11-19");
    expect(notInFuture("2026-11-21", "2026-11-18")).toBe("2025-11-21");
    expect(yearEarlier("2028-02-29")).toBe("2027-02-28");
  });
  it("fixes a statement whose year came from an unrelated date", () => {
    const text = "Offer ends Dec 31, 2026\nTrans Date Description Amount\nDec 05 STARBUCKS $5.25\nDec 08 SHELL $40.00\n";
    const rows = parseStatement(text, undefined, "2026-11-18");
    expect(rows.map((r) => r.date)).toEqual(["2025-12-05", "2025-12-08"]);
  });
  it("leaves a year the user picked alone", () => {
    const text = "Trans Date Description Amount\nDec 05 STARBUCKS $5.25\n";
    expect(parseStatement(text, 2026, "2026-11-18").map((r) => r.date)).toEqual(["2026-12-05"]);
  });
});
