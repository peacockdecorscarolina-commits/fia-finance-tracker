import { describe, expect, it } from "vitest";
import { amountMatches, describeWatch, matchesWatch, nameMatches, noteWithWatch, watchTitle } from "../lib/watches";

const watch = (lookFor: string, over: { amount?: number | null; direction?: "in" | "out" | null } = {}) => ({
  lookFor,
  amount: over.amount ?? null,
  direction: over.direction ?? null,
});

describe("nameMatches", () => {
  it("finds every typed word at the start of a merchant word", () => {
    expect(nameMatches("amazon", "AMAZON MKTPLACE PMTS")).toBe(true);
    expect(nameMatches("Uber eats", "UBER   EATS PENDING")).toBe(true);
    expect(nameMatches("venmo john", "VENMO CASHOUT")).toBe(false);
    expect(nameMatches("ber", "UBER EATS")).toBe(false);
  });
  it("also matches the name Fia shows", () => {
    expect(nameMatches("amazon", "AMZN Mktp US*2K4L19")).toBe(true);
  });
  it("ignores punctuation and empty text", () => {
    expect(nameMatches("best-buy", "BEST BUY 00123")).toBe(true);
    expect(nameMatches("  ", "ANYTHING")).toBe(false);
  });
});

describe("amountMatches", () => {
  it("allows 10% or $2, whichever is more", () => {
    expect(amountMatches(45, 45.12)).toBe(true);
    expect(amountMatches(45, -46.9)).toBe(true);
    expect(amountMatches(10, 11.9)).toBe(true);
    expect(amountMatches(10, 12.5)).toBe(false);
    expect(amountMatches(500, 545)).toBe(true);
    expect(amountMatches(500, 560)).toBe(false);
  });
});

describe("matchesWatch", () => {
  it("checks direction, amount and name", () => {
    const refund = watch("amazon", { amount: 45, direction: "in" });
    expect(matchesWatch(refund, { merchant: "AMAZON MKTPLACE", amount: 45.12 })).toBe(true);
    expect(matchesWatch(refund, { merchant: "AMAZON MKTPLACE", amount: -45.12 })).toBe(false);
    expect(matchesWatch(refund, { merchant: "AMAZON MKTPLACE", amount: 19.99 })).toBe(false);
    expect(matchesWatch(refund, { merchant: "TARGET", amount: 45 })).toBe(false);
    expect(matchesWatch(watch("netflix", { direction: "out" }), { merchant: "NETFLIX.COM", amount: -15.49 })).toBe(true);
    expect(matchesWatch(watch("netflix"), { merchant: "NETFLIX.COM", amount: 15.49 })).toBe(true);
  });
});

describe("noteWithWatch", () => {
  it("adds the watch's note under an existing one, once", () => {
    expect(noteWithWatch(null, "Shoe refund")).toBe("Shoe refund");
    expect(noteWithWatch("Returned in store", "Shoe refund")).toBe("Returned in store\nShoe refund");
    expect(noteWithWatch("Shoe refund", "Shoe refund")).toBe("Shoe refund");
  });
});

describe("describeWatch", () => {
  it("sums up the details", () => {
    expect(describeWatch({ amount: 45, direction: "in", keepWatching: false })).toBe("Money in · about $45.00");
    expect(describeWatch({ amount: null, direction: null, keepWatching: true })).toBe("every time");
  });
});

describe("amount-only watches", () => {
  it("match any vendor close to the amount", () => {
    const w = watch("", { amount: 45 });
    expect(matchesWatch(w, { merchant: "TARGET", amount: -45.12 })).toBe(true);
    expect(matchesWatch(w, { merchant: "VENMO", amount: 47 })).toBe(true);
    expect(matchesWatch(w, { merchant: "TARGET", amount: -60 })).toBe(false);
  });
  it("need an amount when there's no vendor", () => {
    expect(matchesWatch(watch(""), { merchant: "TARGET", amount: -45 })).toBe(false);
  });
  it("are titled by the amount", () => {
    expect(watchTitle({ lookFor: "", amount: 45 })).toBe("Any vendor, about $45.00");
    expect(watchTitle({ lookFor: " Amazon ", amount: 45 })).toBe("Amazon");
  });
});
