import { describe, expect, it } from "vitest";
import { matchRefunds, refundCandidates, type RefundTx } from "../lib/refunds";

let next = 1;
const t = (date: string, merchant: string, amount: number, accountId = 1): RefundTx => ({ id: next++, accountId, date, merchant, amount });
const key = (m: string) => m.toLowerCase().replace(/\s*(return|refund|credit)\s*/g, "").trim() || m.toLowerCase();
const match = (refunds: RefundTx[], purchases: RefundTx[], taken = new Set<number>(), ruledOut: (refundId: number, purchaseId: number) => boolean = () => false) =>
  matchRefunds(refunds, purchases, key, taken, ruledOut);

describe("matchRefunds", () => {
  it("matches the same store and amount", () => {
    const parking = t("2026-10-03", "PARKING", -15.24);
    const lunch = t("2026-10-04", "CAFE", -15.24);
    const refund = t("2026-10-10", "PARKING REFUND", 15.24);
    expect(match([refund], [lunch, parking]).get(refund.id)).toBe(parking.id);
  });
  it("matches a nameless return to the only purchase of exactly that amount", () => {
    const shoes = t("2026-10-01", "SHOE STORE", -89.99);
    const other = t("2026-10-02", "GAS", -40);
    const refund = t("2026-10-12", "MERCHANT RETURN", 89.99);
    expect(match([refund], [shoes, other]).get(refund.id)).toBe(shoes.id);
  });
  it("leaves a nameless return alone when two purchases have that amount", () => {
    const a = t("2026-10-01", "SHOE STORE", -20);
    const b = t("2026-10-02", "BOOKS", -20);
    const refund = t("2026-10-12", "MERCHANT RETURN", 20);
    expect(match([refund], [a, b]).size).toBe(0);
  });
  it("matches a partial refund to the only purchase from that store", () => {
    const order = t("2026-10-01", "AMAZON", -120);
    const refund = t("2026-10-15", "AMAZON", 30);
    expect(match([refund], [order]).get(refund.id)).toBe(order.id);
  });
  it("leaves a partial refund alone when the store has several purchases", () => {
    const a = t("2026-10-01", "AMAZON", -120);
    const b = t("2026-10-05", "AMAZON", -60);
    expect(match([t("2026-10-15", "AMAZON", 30)], [a, b]).size).toBe(0);
  });
  it("doesn't cross cards, go back too far, or use a later or smaller purchase", () => {
    const refund = t("2026-10-10", "PARKING", 15.24);
    expect(match([refund], [t("2026-10-03", "PARKING", -15.24, 2)]).size).toBe(0);
    expect(match([refund], [t("2026-05-01", "PARKING", -15.24)]).size).toBe(0);
    expect(match([refund], [t("2026-10-11", "PARKING", -15.24)]).size).toBe(0);
    expect(match([refund], [t("2026-10-03", "PARKING", -10)]).size).toBe(0);
  });
  it("uses each purchase once", () => {
    const p = t("2026-10-03", "PARKING", -15.24);
    const r1 = t("2026-10-10", "PARKING", 15.24);
    const r2 = t("2026-10-11", "PARKING", 15.24);
    const out = match([r1, r2], [p]);
    expect(out.get(r1.id)).toBe(p.id);
    expect(out.has(r2.id)).toBe(false);
  });
  it("skips purchases already matched and pairs ruled out", () => {
    const p = t("2026-10-03", "PARKING", -15.24);
    const r = t("2026-10-10", "PARKING", 15.24);
    expect(match([r], [p], new Set([p.id])).size).toBe(0);
    expect(match([r], [p], new Set(), (rid, pid) => rid === r.id && pid === p.id).size).toBe(0);
  });
});

describe("refundCandidates", () => {
  it("puts the closest purchases first", () => {
    const exactSame = t("2026-10-01", "PARKING", -15.24);
    const exactOther = t("2026-10-05", "CAFE", -15.24);
    const sameStore = t("2026-10-06", "PARKING", -40);
    const refund = t("2026-10-10", "PARKING", 15.24);
    expect(refundCandidates(refund, [sameStore, exactOther, exactSame], key).map((p) => p.id)).toEqual([exactSame.id, exactOther.id, sameStore.id]);
  });
});
