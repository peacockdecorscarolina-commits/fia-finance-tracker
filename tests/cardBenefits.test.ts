import { describe, expect, it } from "vitest";
import { benefitStatus, CARD_CATALOG, currentWindow, findAnnualFeeCharge, findCard, usedLast12Months } from "../lib/cardBenefits";
import { tx } from "./helpers";

const TODAY = "2026-10-26";

describe("currentWindow", () => {
  it("covers each kind of reset", () => {
    expect(currentWindow("monthly", TODAY, null).key).toBe("2026-10");
    expect(currentWindow("quarterly", TODAY, null)).toEqual({ key: "2026-Q4", start: "2026-10-01", end: "2026-12-31" });
    expect(currentWindow("semiannual", TODAY, null).key).toBe("2026-H2");
    expect(currentWindow("cardYear", TODAY, 3)).toEqual({ key: "cy-2026-03", start: "2026-03-01", end: "2027-02-28" });
    expect(currentWindow("cardYear", TODAY, null).key).toBe("2026");
  });
});

describe("benefitStatus", () => {
  const bce = findCard("amex-blue-cash-everyday")!;
  const disney = bce.benefits.find((b) => b.id === "disney-streaming")!;
  const homeChef = bce.benefits.find((b) => b.id === "home-chef")!;
  const charges = [tx("2026-10-04", "DISNEY PLUS 888-905-7888", -15.99), tx("2026-10-05", "AMEX DISNEY STREAMING CREDIT", 7)];

  it("detects a use from the issuer's credit line", () => {
    const s = benefitStatus(disney, charges, new Map(), TODAY, null);
    expect([s.used, s.left, s.detectedDate]).toEqual([7, 0, "2026-10-05"]);
  });

  it("counts a partial use the user marked", () => {
    const s = benefitStatus(homeChef, charges, new Map([["home-chef|2026-10", 6]]), TODAY, null);
    expect([s.used, s.left, s.daysLeft]).toEqual([6, 9, 5]);
  });

  it("only counts the current quarter", () => {
    const lulu = findCard("amex-platinum")!.benefits.find((b) => b.id === "lululemon")!;
    const s = benefitStatus(lulu, [tx("2026-08-15", "LULULEMON", -98), tx("2026-10-03", "LULULEMON", -60)], new Map(), TODAY, null);
    expect([s.used, s.left]).toEqual([60, 15]);
  });

  it("adds up a monthly credit over the last 12 months", () => {
    const monthly = [tx("2026-08-05", "AMEX DISNEY CREDIT", 7), tx("2026-09-05", "AMEX DISNEY CREDIT", 7), ...charges];
    expect(usedLast12Months(disney, monthly, new Map(), TODAY, null)).toBe(21);
  });
});

describe("annual fee and catalog", () => {
  it("finds the fee on a statement", () => {
    expect(findAnnualFeeCharge([tx("2026-03-04", "ANNUAL MEMBERSHIP FEE", -150), tx("2026-03-05", "UBER", -12)])?.date).toBe("2026-03-04");
  });

  it("has unique card and benefit ids and sane amounts", () => {
    const ids = CARD_CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const card of CARD_CATALOG) {
      expect(card.annualFee).toBeGreaterThanOrEqual(0);
      const benefitIds = card.benefits.map((b) => b.id);
      expect(new Set(benefitIds).size).toBe(benefitIds.length);
      for (const b of card.benefits) expect(b.amount).toBeGreaterThan(0);
    }
  });
});

describe("a benefit the user added", () => {
  const custom = { id: "custom-1", name: "Uber credit", detail: "Added by you.", amount: 10, period: "monthly" as const, matchAny: ["UBER"], customId: 1 };

  it("is detected like a catalog one", () => {
    const s = benefitStatus(custom, [tx("2026-10-14", "UBER TRIP", -24.1)], new Map(), TODAY, null);
    expect([s.used, s.left]).toEqual([10, 0]);
  });

  it("with no statement word, waits for the user to mark it", () => {
    const s = benefitStatus({ ...custom, matchAny: [] }, [tx("2026-10-14", "UBER TRIP", -24.1)], new Map(), TODAY, null);
    expect(s.used).toBe(0);
  });
});

describe("credits used inside an app (Uber Cash)", () => {
  const uberCash = findCard("amex-gold")!.benefits.find((b) => b.id === "uber-cash")!;

  it("is marked as in-app in the catalog", () => {
    expect(uberCash.appliedAs).toBe("inApp");
  });

  it("counts any Uber charge as the full credit, since Uber uses it first", () => {
    // A $10.99 ride with $10 Uber Cash only charges the card $0.99.
    const s = benefitStatus(uberCash, [tx("2026-10-14", "UBER TRIP", -0.99)], new Map(), TODAY, null);
    expect([s.used, s.left]).toEqual([10, 0]);
  });

  it("can't see a fully covered ride, so it waits for the user", () => {
    const s = benefitStatus(uberCash, [], new Map(), TODAY, null);
    expect(s.used).toBe(0);
    expect(benefitStatus(uberCash, [], new Map([["uber-cash|2026-10", 10]]), TODAY, null).used).toBe(10);
  });

  it("leaves statement credits counting what was spent", () => {
    const dunkin = findCard("amex-gold")!.benefits.find((b) => b.id === "dunkin")!;
    expect(benefitStatus(dunkin, [tx("2026-10-02", "DUNKIN #1234", -3.5)], new Map(), TODAY, null).used).toBe(3.5);
  });
});

describe("the user's word over detection", () => {
  const bce = findCard("amex-blue-cash-everyday")!;
  const disney = bce.benefits.find((b) => b.id === "disney-streaming")!;
  const found = [tx("2026-10-05", "AMEX DISNEY STREAMING CREDIT", 7)];

  it("can mark a detected use as unused", () => {
    const s = benefitStatus(disney, found, new Map([["disney-streaming|2026-10", 0]]), TODAY, null);
    expect([s.used, s.left, s.detectedAmount]).toEqual([0, 7, 7]);
  });

  it("can lower a detected amount", () => {
    expect(benefitStatus(disney, found, new Map([["disney-streaming|2026-10", 3]]), TODAY, null).used).toBe(3);
  });

  it("goes back to detection when the mark is undone", () => {
    expect(benefitStatus(disney, found, new Map(), TODAY, null).used).toBe(7);
  });
});

describe("card colors", () => {
  // White text sits on these, so each needs enough contrast (WCAG ~3:1 for large text).
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  it.each(CARD_CATALOG.map((c) => [c.name, c.color]))("%s is dark enough for white text", (_name, color) => {
    expect(1.05 / (luminance(color) + 0.05)).toBeGreaterThanOrEqual(3);
  });
});
