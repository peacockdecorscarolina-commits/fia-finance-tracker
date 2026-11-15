import { describe, expect, it } from "vitest";
import { findDuplicates, guessAccount, readCsvText, saveOrder, summarize } from "../lib/batchUpload";
import type { ExtractedTransaction } from "../lib/types";

const row = (date: string, amount: number, merchant = "STORE"): ExtractedTransaction => ({ date, merchant, amount, category: "Other", needsReview: true });

describe("summarize", () => {
  it("counts, spans and totals", () => {
    expect(summarize([row("2026-10-08", -40), row("2026-11-02", 500), row("2026-10-20", -10.5)])).toEqual({
      count: 3,
      first: "2026-10-08",
      last: "2026-11-02",
      out: 50.5,
      in: 500,
    });
    expect(summarize([])).toEqual({ count: 0, first: null, last: null, out: 0, in: 0 });
  });
});

describe("findDuplicates", () => {
  const savedOn = (keys: Record<number, string[]>) => (id: number) => new Set(keys[id] ?? []);
  it("spots rows already saved on the account", () => {
    const out = findDuplicates([{ accountId: 1, rows: [row("2026-10-01", -5), row("2026-10-02", -6)] }], savedOn({ 1: ["2026-10-01|-5.00"] }));
    expect(out).toEqual([{ duplicates: 1, allDuplicates: false }]);
  });
  it("spots the same statement picked twice", () => {
    const rows = [row("2026-10-01", -5), row("2026-10-02", -6)];
    const out = findDuplicates([{ accountId: 1, rows }, { accountId: 1, rows }], savedOn({}));
    expect(out).toEqual([{ duplicates: 0, allDuplicates: false }, { duplicates: 2, allDuplicates: true }]);
  });
  it("keeps accounts apart", () => {
    const rows = [row("2026-10-01", -5)];
    const out = findDuplicates([{ accountId: 1, rows }, { accountId: 2, rows }], savedOn({}));
    expect(out.map((o) => o.duplicates)).toEqual([0, 0]);
  });
  it("leaves a file with no account or no rows alone", () => {
    expect(findDuplicates([{ accountId: null, rows: [row("2026-10-01", -5)] }, { accountId: 1, rows: [] }], savedOn({}))).toEqual([
      { duplicates: 0, allDuplicates: false },
      { duplicates: 0, allDuplicates: false },
    ]);
  });
});

describe("guessAccount", () => {
  const accounts = [{ id: 1, name: "Chase" }, { id: 2, name: "Chase Sapphire" }, { id: 3, name: "Wells Fargo Checking" }, { id: 4, name: "Bo" }];
  it("finds the account named in the file name, the longest name winning", () => {
    expect(guessAccount("Chase_Statement_Oct.pdf", accounts)).toBe(1);
    expect(guessAccount("chase-sapphire-2026-10.pdf", accounts)).toBe(2);
    expect(guessAccount("Wells Fargo Checking Nov.pdf", accounts)).toBe(3);
  });
  it("needs whole words and a real name", () => {
    expect(guessAccount("purchases.pdf", accounts)).toBeNull();
    expect(guessAccount("bo-statement.pdf", accounts)).toBeNull();
  });
});

describe("saveOrder", () => {
  it("saves the oldest statement first", () => {
    const f = (name: string, closing: string | null, last: string) => ({ name, read: { rows: [row(last, -1)], balance: null, closing } });
    expect(saveOrder([f("nov", "2026-11-06", "2026-11-05"), f("sep", null, "2026-09-07"), f("oct", "2026-10-07", "2026-10-06")]).map((x) => x.name)).toEqual(["sep", "oct", "nov"]);
  });
});

describe("readCsvText", () => {
  it("puts purchases negative and has no balance", () => {
    const read = readCsvText("Date,Description,Amount\n2026-10-01,STARBUCKS,-4.50\n2026-10-02,PAYCHECK,1500.00\n");
    expect(read.rows.map((r) => r.amount).sort((a, b) => a - b)).toEqual([-4.5, 1500]);
    expect(read.balance).toBeNull();
    expect(read.closing).toBeNull();
  });
});
