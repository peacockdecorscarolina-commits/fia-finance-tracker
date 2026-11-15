import { describe, expect, it } from "vitest";
import { merchantHistory, topMerchants } from "../lib/merchantInsights";
import { checkSplit, parseAmount, signedParts } from "../lib/splits";
import { tx } from "./helpers";

describe("parseAmount", () => {
  it("reads what people type", () => {
    expect(parseAmount("150")).toBe(150);
    expect(parseAmount("$1,050.25")).toBe(1050.25);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("checkSplit", () => {
  const part = (categoryId: number | null, amount: string) => ({ categoryId, amount });
  it("is ready when the parts add up exactly", () => {
    expect(checkSplit(-200, [part(1, "150"), part(2, "50")])).toEqual({ remaining: 0, problem: null });
    expect(checkSplit(-0.3, [part(1, "0.1"), part(2, "0.2")]).problem).toBeNull();
  });
  it("says what's left, or how much too much", () => {
    expect(checkSplit(-200, [part(1, "150"), part(2, "20")])).toEqual({ remaining: 30, problem: "$30.00 still needs a category." });
    expect(checkSplit(-200, [part(1, "150"), part(2, "60")]).problem).toBe("That's $10.00 more than the transaction.");
  });
  it("wants two parts, each with a category and an amount", () => {
    expect(checkSplit(-200, [part(1, "200")]).problem).toBe("Add at least two parts.");
    expect(checkSplit(-200, [part(1, "150"), part(null, "50")]).problem).toBe("Pick a category for each part.");
    expect(checkSplit(-200, [part(1, "200"), part(2, "")]).problem).toBe("Give each part an amount.");
  });
});

describe("signedParts", () => {
  it("keeps a charge negative and a credit positive", () => {
    expect(signedParts(-200, [{ categoryId: 1, amount: "150" }, { categoryId: 2, amount: "50" }])).toEqual([
      { categoryId: 1, amount: -150 },
      { categoryId: 2, amount: -50 },
    ]);
    expect(signedParts(40, [{ categoryId: 1, amount: "30" }, { categoryId: 2, amount: "10" }]).map((p) => p.amount)).toEqual([30, 10]);
  });
});

describe("a split counts as one visit", () => {
  const trip = [
    tx("2026-11-02", "COSTCO", -150, { splitGroup: "s1" }),
    tx("2026-11-02", "COSTCO", -50, { splitGroup: "s1" }),
    tx("2026-11-09", "COSTCO", -80),
  ];
  it("in top merchants", () => {
    expect(topMerchants(trip, (m) => m, (m) => m)[0]).toMatchObject({ total: 280, visits: 2 });
  });
  it("in a store's history", () => {
    expect(merchantHistory(trip, "2026-11-14")).toMatchObject({ spent: 280, visits: 2, average: 140 });
  });
});
