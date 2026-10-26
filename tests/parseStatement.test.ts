import { describe, expect, it } from "vitest";
import { parseStatement } from "../lib/parseStatement";

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
