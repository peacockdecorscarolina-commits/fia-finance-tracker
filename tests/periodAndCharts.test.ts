import { describe, expect, it } from "vitest";
import { visibleLabelIndexes } from "../lib/chartAxis";
import { monthsBetween, periodRange } from "../lib/period";

describe("period helpers", () => {
  it("turns a year into its full date range", () => {
    expect(periodRange("2026")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    expect(periodRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("lists every month between two, gaps included", () => {
    expect(monthsBetween("2026-02", "2025-11")).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
  });
});

describe("chart labels", () => {
  const labelsAt = (labels: string[], width: number) => {
    const xs = labels.map((_, i) => (i * width) / (labels.length - 1));
    const shown = visibleLabelIndexes(labels, xs, null, 40);
    return labels.map((l, i) => (shown.has(i) ? l : "·"));
  };

  it("never repeats a label or lets two touch, and keeps the last", () => {
    expect(labelsAt(["Oct", "Oct"], 280)).toEqual(["Oct", "·"]);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"];
    const shown = labelsAt(months, 280);
    expect(shown[shown.length - 1]).toBe("Oct");
    shown.forEach((l, i) => {
      if (l !== "·" && i > 0) expect(shown[i - 1]).toBe("·");
    });
  });
});
