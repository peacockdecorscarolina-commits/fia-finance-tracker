import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackupWouldLoseDataError, backupWouldLoseData, type BackupSummary } from "../lib/backupSafety";

const summary = (transactions: number, accounts: number): BackupSummary => ({ transactions, accounts, exportedAt: "2026-10-26T12:00:00Z" });

describe("backupWouldLoseData", () => {
  it("stops an empty or mostly-empty device from replacing a backup", () => {
    expect(backupWouldLoseData(summary(0, 0), summary(6305, 7))).toBe(true);
    expect(backupWouldLoseData(summary(0, 3), summary(6305, 7))).toBe(true);
    expect(backupWouldLoseData(summary(3000, 7), summary(6305, 7))).toBe(true);
    expect(backupWouldLoseData(summary(5, 0), summary(0, 2))).toBe(true);
  });

  it("lets normal backups through", () => {
    expect(backupWouldLoseData(summary(6305, 7), summary(6305, 7))).toBe(false);
    expect(backupWouldLoseData(summary(6200, 7), summary(6305, 7))).toBe(false); // deleted a few on purpose
    expect(backupWouldLoseData(summary(7000, 8), summary(6305, 7))).toBe(false);
    expect(backupWouldLoseData(summary(0, 0), summary(0, 0))).toBe(false);
    expect(backupWouldLoseData(summary(0, 0), null)).toBe(false); // first backup ever
  });
});

// The real backupToDrive against a pretend Drive.
vi.mock("../lib/googleAuth", () => ({ getValidAccessToken: async () => "token" }));
const deviceData = { transactions: [] as unknown[], accounts: [] as unknown[] };
vi.mock("../lib/db", () => ({
  exportAllData: async () => ({ version: 1, exportedAt: "2026-10-27T09:00:00Z", ...deviceData }),
  replaceAllData: async () => {},
}));

describe("backupToDrive", () => {
  let drive: { appProperties?: Record<string, string>; content?: unknown } | null;
  const uploads: { method: string; body: string }[] = [];

  beforeEach(() => {
    uploads.length = 0;
    vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: string }) => {
      if (url.includes("/upload/")) {
        uploads.push({ method: init?.method ?? "GET", body: init?.body ?? "" });
        return new Response("{}", { status: 200 });
      }
      if (url.includes("alt=media")) return new Response(JSON.stringify(drive?.content), { status: 200 });
      return new Response(JSON.stringify({ files: drive ? [{ id: "file1", appProperties: drive.appProperties }] : [] }), { status: 200 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("refuses to upload an empty device over a full backup", async () => {
    const { backupToDrive } = await import("../lib/googleDrive");
    deviceData.transactions = [];
    deviceData.accounts = [];
    drive = { appProperties: { transactions: "6305", accounts: "7", exportedAt: "2026-10-26T12:00:00Z" } };
    await expect(backupToDrive({} as never)).rejects.toBeInstanceOf(BackupWouldLoseDataError);
    expect(uploads).toHaveLength(0);
  });

  it("counts an older backup that has no counts on it", async () => {
    const { backupToDrive } = await import("../lib/googleDrive");
    deviceData.transactions = [];
    deviceData.accounts = [];
    drive = { content: { exportedAt: "2026-10-01T00:00:00Z", transactions: [1, 2, 3], accounts: [1] } };
    await expect(backupToDrive({} as never)).rejects.toBeInstanceOf(BackupWouldLoseDataError);
    expect(uploads).toHaveLength(0);
  });

  it("uploads, with counts on the file, when told to replace or when nothing is lost", async () => {
    const { backupToDrive } = await import("../lib/googleDrive");
    deviceData.transactions = [];
    deviceData.accounts = [];
    drive = { appProperties: { transactions: "6305", accounts: "7" } };
    await backupToDrive({} as never, true);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].body).toContain('"appProperties":{"transactions":"0","accounts":"0"');

    deviceData.transactions = new Array(6310).fill(0);
    deviceData.accounts = new Array(7).fill(0);
    await backupToDrive({} as never);
    expect(uploads).toHaveLength(2);
    expect(uploads[1].method).toBe("PATCH");
  });

  it("creates the first backup when Drive has none", async () => {
    const { backupToDrive } = await import("../lib/googleDrive");
    drive = null;
    deviceData.transactions = [];
    await backupToDrive({} as never);
    expect(uploads[0].method).toBe("POST");
  });
});
