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
