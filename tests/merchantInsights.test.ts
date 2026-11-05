import { describe, expect, it } from "vitest";
import { merchantHistory, monthInsights, topMerchants } from "../lib/merchantInsights";
import { formatMerchantName } from "../lib/formatMerchant";
import { tx } from "./helpers";

const key = (m: string) => m.toLowerCase().replace(/[^a-z]/g, "");
const name = (m: string) => m;

describe("merchantHistory", () => {
  it("totals visits, refunds, months and the usual day", () => {
    // Five Saturdays at a cafe, one refund, one paid back.
    const list = [
      tx("2026-09-05", "CAFE", -10),
      tx("2026-09-12", "CAFE", -12),
      tx("2026-09-19", "CAFE", -8, { reimbursed: 4 }),
      tx("2026-10-03", "CAFE", -10, { accountName: "Amex" }),
      tx("2026-10-10", "CAFE", -10),
      tx("2026-10-11", "CAFE", 5),
      tx("2026-10-17", "CAFE", -99, { ignored: true }),
    ];
    const h = merchantHistory(list, "2026-11-04");
    expect(h).toMatchObject({ spent: 46, refunded: 5, visits: 5, firstDate: "2026-09-05", lastDate: "2026-10-11", pattern: "Mostly on Saturdays" });
    expect(h.average).toBeCloseTo(9.2);
    expect(h.months.slice(-3)).toEqual([
      { month: "2026-09", total: 26 },
      { month: "2026-10", total: 20 },
      { month: "2026-11", total: 0 },
    ]);
    expect(h.byAccount).toEqual([
      { accountName: "Card", total: 36 },
      { accountName: "Amex", total: 10 },
    ]);
  });
});

describe("topMerchants", () => {
  it("ranks by spending, grouping the same merchant", () => {
    const top = topMerchants([tx("2026-10-01", "SHOP A", -50), tx("2026-10-02", "Shop-A", -30), tx("2026-10-03", "SHOP B", -60), tx("2026-10-04", "PAYROLL", 900)], key, name);
    expect(top.map((t) => [t.name, t.total, t.visits])).toEqual([["SHOP A", 80, 2], ["SHOP B", 60, 1]]);
  });
});

describe("monthInsights", () => {
  const usualMonth = [{ categoryName: "Dining", total: 200 }, { categoryName: "Shopping", total: 300 }];
  it("compares the month with the user's usual and points out what stood out", () => {
    const spending = [
      tx("2026-10-02", "NEW BISTRO", -120),
      tx("2026-10-05", "TACO PLACE", -30),
      tx("2026-10-12", "BEST BUY", -640),
      ...["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"].map((d) => tx(d, "STARBUCKS", -6)),
    ];
    const insights = monthInsights({
      categories: [{ categoryName: "Dining", total: 420 }, { categoryName: "Shopping", total: 180 }],
      earlier: [usualMonth, usualMonth, usualMonth],
      spending,
      seenBefore: new Set(["starbucks", "bestbuy"]),
      keyFor: key,
      displayName: name,
    }).map((i) => i.text);
    expect(insights).toEqual([
      "You spent $100 more than usual ($500).",
      "Dining was $220 more than usual ($200).",
      "Shopping was $120 less than usual ($300).",
      "You tried 2 new places, like NEW BISTRO and TACO PLACE.",
      "Biggest purchase: $640 at BEST BUY on Oct 12.",
      "Most visits: STARBUCKS, 4 times ($24).",
    ]);
  });

  it("doesn't repeat the total through one big category, or call out Other", () => {
    const month = (other: number, dining: number) => [{ categoryName: "Other", total: other }, { categoryName: "Dining", total: dining }];
    const insights = monthInsights({
      categories: month(1100, 20),
      earlier: [month(360, 15), month(360, 15), month(360, 15)],
      spending: [],
      seenBefore: new Set(),
      keyFor: key,
      displayName: name,
    }).map((i) => i.text);
    expect(insights).toEqual(["You spent $745 more than usual ($375)."]);
  });

  it("skips comparisons for a month still in progress", () => {
    const insights = monthInsights({
      categories: [{ categoryName: "Dining", total: 40 }],
      earlier: [usualMonth, usualMonth, usualMonth],
      spending: [tx("2026-11-02", "A", -40)],
      seenBefore: new Set(["a"]),
      keyFor: key,
      displayName: name,
      inProgress: true,
    }).map((i) => i.text);
    expect(insights).toEqual(["Biggest purchase: $40 at A on Nov 2."]);
  });

  it("stays quiet without enough history", () => {
    const insights = monthInsights({
      categories: [{ categoryName: "Dining", total: 420 }],
      earlier: [usualMonth],
      spending: [tx("2026-10-02", "A", -5), tx("2026-10-03", "B", -5)],
      seenBefore: new Set(),
      keyFor: key,
      displayName: name,
    }).map((i) => i.text);
    expect(insights).toEqual(["Biggest purchase: $5 at A on Oct 2."]);
  });
});

describe("one merchant per name shown", () => {
  it("adds up Starbucks and Amazon however their descriptions are worded", () => {
    const spending = [
      tx("2026-10-01", "STARBUCKS STORE 1234", -6),
      tx("2026-10-02", "SQ *STARBUCKS", -5),
      tx("2026-10-03", "STARBUCKS #05678 SEATTLE WA", -7),
      tx("2026-10-04", "AMAZON MKTPLACE PMTS", -20),
      tx("2026-10-05", "AMZN Mktp US*RT5YH6", -30),
    ];
    const top = topMerchants(spending, (m) => formatMerchantName(m).toLowerCase(), formatMerchantName);
    expect(top.map((t) => [t.name, t.total, t.visits])).toEqual([["Amazon", 50, 2], ["Starbucks", 18, 3]]);
  });
});
