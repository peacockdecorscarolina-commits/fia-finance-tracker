import { describe, expect, it } from "vitest";
import { buildCategoryDetails, changeLine, comparisonPeriod, sortCategoryRows, totalChangeLine } from "../lib/categoryDetails";
import { tx } from "./helpers";

describe("comparisonPeriod", () => {
  it("uses the whole month before once a month is over", () => {
    expect(comparisonPeriod("2026-10", "2026-11-09")).toEqual({ start: "2026-09-01", end: "2026-09-30", label: "September" });
  });
  it("uses the same days while a month is going", () => {
    expect(comparisonPeriod("2026-11", "2026-11-09")).toEqual({ start: "2026-10-01", end: "2026-10-09", label: "Oct 1–9" });
    expect(comparisonPeriod("2026-11", "2026-11-01").label).toBe("Oct 1");
  });
  it("stops at the end of a shorter month", () => {
    expect(comparisonPeriod("2026-03", "2026-03-31")).toEqual({ start: "2026-02-01", end: "2026-02-28", label: "Feb 1–28" });
  });
  it("crosses into last year from January", () => {
    expect(comparisonPeriod("2026-01", "2026-03-02").label).toBe("December");
    expect(comparisonPeriod("2026-01", "2026-03-02").start).toBe("2025-12-01");
  });
  it("handles years, whole and so far", () => {
    expect(comparisonPeriod("2025", "2026-11-09")).toEqual({ start: "2024-01-01", end: "2024-12-31", label: "2024" });
    expect(comparisonPeriod("2026", "2026-11-09")).toEqual({ start: "2025-01-01", end: "2025-11-09", label: "2025 so far" });
  });
});

const build = (current: [string, number][], previous: [string, number][], spending = [] as ReturnType<typeof tx>[]) =>
  buildCategoryDetails({
    current: current.map(([categoryName, total]) => ({ categoryName, total })),
    previous: previous.map(([categoryName, total]) => ({ categoryName, total })),
    spending,
    keyFor: (m) => m.toLowerCase(),
    displayName: (m) => m,
  });

describe("buildCategoryDetails", () => {
  it("works out shares, bars and changes", () => {
    const d = build([["Dining", 300], ["Bills", 100]], [["Dining", 200], ["Bills", 100]]);
    expect(d.total).toBe(400);
    expect(d.previousTotal).toBe(300);
    expect(d.rows.map((r) => [r.name, r.percent, r.bar, r.change])).toEqual([["Dining", 75, 1, 100], ["Bills", 25, 1 / 3, 0]]);
  });
  it("counts charges and finds the store with the most spent", () => {
    const d = build([["Dining", 40]], [], [
      tx("2026-11-01", "Cafe", -5, { categoryName: "Dining" }),
      tx("2026-11-02", "Cafe", -5, { categoryName: "Dining" }),
      tx("2026-11-03", "Steakhouse", -30, { categoryName: "Dining" }),
    ]);
    expect(d.rows[0]).toMatchObject({ charges: 3, topStore: "Steakhouse" });
  });
  it("keeps a category spent on only last time", () => {
    const d = build([["Dining", 50]], [["Health", 20]]);
    expect(d.rows.map((r) => [r.name, r.amount, r.change])).toEqual([["Dining", 50, 50], ["Health", 0, -20]]);
    expect(d.rows[0].isNew).toBe(true);
  });
  it("compares nothing when last time is empty", () => {
    const d = build([["Dining", 50]], []);
    expect(d.rows[0].change).toBeNull();
    expect(d.rows[0].isNew).toBe(false);
    expect(totalChangeLine(d, "October")).toBeNull();
  });
  it("gives a net-refund category no share", () => {
    const d = build([["Shopping", -20], ["Dining", 100]], []);
    expect(d.total).toBe(80);
    expect(d.rows.find((r) => r.name === "Shopping")).toMatchObject({ percent: 0, bar: 0 });
    expect(d.rows.find((r) => r.name === "Dining")?.percent).toBe(100);
  });
});

describe("sorting", () => {
  it("sorts by the size of the change, up or down", () => {
    const d = build([["A", 300], ["B", 10], ["C", 100]], [["A", 290], ["B", 200], ["C", 60]]);
    expect(sortCategoryRows(d.rows, "amount").map((r) => r.name)).toEqual(["A", "C", "B"]);
    expect(sortCategoryRows(d.rows, "change").map((r) => r.name)).toEqual(["B", "C", "A"]);
  });
});

describe("the wording", () => {
  const row = (current: number, previous: number) => build([["A", current]], [["A", previous]]).rows[0];
  it("says which way and how much", () => {
    expect(changeLine(row(166.4, 100), "October")).toEqual({ text: "▲ $66.40 vs October", tone: "up" });
    expect(changeLine(row(90, 100), "Oct 1–9")).toEqual({ text: "▼ $10.00 vs Oct 1–9", tone: "down" });
    expect(changeLine(row(100, 100), "October")).toEqual({ text: "Same as October", tone: "same" });
  });
  it("sums up the total", () => {
    expect(totalChangeLine({ total: 2056.3, previousTotal: 1973.75 }, "October")).toBe("Up $82.55 from October (4.2%)");
    expect(totalChangeLine({ total: 50, previousTotal: 100 }, "2025")).toBe("Down $50.00 from 2025 (50.0%)");
    expect(totalChangeLine({ total: 100, previousTotal: 100 }, "October")).toBe("Same as October");
  });
});
