import { describe, expect, it } from "vitest";
import { getAccountCardColor } from "../lib/accountStyle";

describe("getAccountCardColor", () => {
  it("keeps a real card's color after it's renamed", () => {
    const before = getAccountCardColor("Amex Green", [{ id: 1, name: "Amex Green", cardProduct: null }]);
    const after = getAccountCardColor("Amex Classic Green", [{ id: 1, name: "Amex Classic Green", cardProduct: "amex-classic-green" }]);
    expect(after).toBe(before);
  });

  it("gives the first accounts different colors", () => {
    const accounts = [1, 2, 3, 4].map((id) => ({ id, name: `Card ${id}`, cardProduct: null }));
    expect(new Set(accounts.map((a) => getAccountCardColor(a.name, accounts))).size).toBe(4);
  });
});
