import { describe, expect, it } from "vitest";
import { csvLooksReversed, parseCsv } from "../lib/parseCsv";

describe("parseCsv", () => {
  it("reads a Chase-style export (Amount column, purchases negative)", () => {
    const rows = parseCsv(
      'Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n01/03/2026,01/04/2026,STARBUCKS #123,Food,Sale,-5.25,\n01/05/2026,01/05/2026,"AMAZON, INC",Shopping,Sale,-19.99,'
    );
    expect(rows.map((r) => [r.date, r.amount, r.merchant])).toEqual([
      ["2026-01-03", -5.25, "STARBUCKS #123"],
      ["2026-01-05", -19.99, "AMAZON, INC"],
    ]);
    expect(csvLooksReversed(rows)).toBe(false);
  });

  it("spots an Amex-style export that writes purchases as positive", () => {
    const rows = parseCsv("Date,Description,Amount\n12/28/2025,UBER TRIP,24.10\n01/02/2026,WHOLE FOODS,88.40\n01/04/2026,AUTOPAY,-300.00");
    expect(csvLooksReversed(rows)).toBe(true);
  });

  it("combines separate Debit and Credit columns", () => {
    const rows = parseCsv(
      "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n2026-01-03,2026-01-04,1234,SHELL OIL,Gas,40.00,\n2026-01-06,2026-01-06,1234,AUTOPAY,Payment,,250.00"
    );
    expect(rows.map((r) => r.amount)).toEqual([-40, 250]);
  });

  it("reads a header-less Wells Fargo export by cell shape", () => {
    const rows = parseCsv('"01/03/2026","-12.50","*","","CHIPOTLE 1234"\n"01/04/2026","1500.00","*","","PAYROLL DEPOSIT"');
    expect(rows.map((r) => [r.date, r.amount, r.merchant])).toEqual([
      ["2026-01-03", -12.5, "CHIPOTLE 1234"],
      ["2026-01-04", 1500, "PAYROLL DEPOSIT"],
    ]);
  });

  it("finds nothing in a file that isn't transactions", () => {
    expect(parseCsv("hello,world\nfoo,bar")).toEqual([]);
  });
});
