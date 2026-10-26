import { describe, expect, it } from "vitest";
import { getAccountCardColor } from "../lib/accountStyle";
import { CARD_CATALOG } from "../lib/cardBenefits";

describe("getAccountCardColor", () => {
  it("shows a real card in its own color, whatever it's named", () => {
    const asGold = (name: string) => getAccountCardColor(name, [{ id: 1, name, cardProduct: "amex-gold" }]);
    expect(asGold("Amex Gold")).toBe(asGold("My Gold"));
    expect(asGold("My Gold")).toBe(CARD_CATALOG.find((c) => c.id === "amex-gold")!.color);
  });

  it("keeps a hand-picked color for an account that isn't a real card", () => {
    expect(getAccountCardColor("Wells Fargo Checking", [{ id: 1, name: "Wells Fargo Checking", cardProduct: null }])).toBe("#D9605A");
  });

  it("gives the first accounts different colors", () => {
    const accounts = [1, 2, 3, 4].map((id) => ({ id, name: `Card ${id}`, cardProduct: null }));
    expect(new Set(accounts.map((a) => getAccountCardColor(a.name, accounts))).size).toBe(4);
  });
});
