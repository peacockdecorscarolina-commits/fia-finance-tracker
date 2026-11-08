import { describe, expect, it } from "vitest";
import { backupBadge, countBadge, parseMenuLayout } from "../lib/moreMenu";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3600e3;

describe("backupBadge", () => {
  it("says how long ago, green while recent", () => {
    expect(backupBadge(ago(10e3), NOW)).toEqual({ text: "Backed up just now", short: "✓", tone: "green" });
    expect(backupBadge(ago(25 * 60e3), NOW)).toEqual({ text: "Backed up 25m ago", short: "25m", tone: "green" });
    expect(backupBadge(ago(2 * H), NOW)).toEqual({ text: "Backed up 2h ago", short: "2h", tone: "green" });
    expect(backupBadge(ago(30 * H), NOW)).toEqual({ text: "Backed up 1d ago", short: "1d", tone: "green" });
  });
  it("turns red when old or never", () => {
    expect(backupBadge(ago(80 * H), NOW).tone).toBe("red");
    expect(backupBadge(null, NOW)).toEqual({ text: "Not backed up", short: "!", tone: "red" });
  });
});

describe("countBadge", () => {
  it("shows a count, or nothing for zero", () => {
    expect(countBadge(0)).toBeNull();
    expect(countBadge(6)).toEqual({ text: "6", short: "6", tone: "neutral" });
    expect(countBadge(120)?.short).toBe("99+");
  });
});

describe("parseMenuLayout", () => {
  it("falls back to tiles", () => {
    expect(parseMenuLayout("grid")).toBe("grid");
    expect(parseMenuLayout("list")).toBe("list");
    expect(parseMenuLayout(null)).toBe("tiles");
    expect(parseMenuLayout("weird")).toBe("tiles");
  });
});
