import type { SQLiteDatabase } from "expo-sqlite";
import { getValidAccessToken, isSignedIn } from "./googleAuth";

// Who may use Fia. Everyone signs in with Google; api/access.js checks the
// email against the owner's Sheet. Revoked (or, offline too long to check)
// means read-only: everything can still be looked at and exported, but
// nothing new is saved -- the database guard in db.ts refuses the writes.

export type Access =
  | { kind: "loading" }
  | { kind: "signedOut" }
  // Signed in before Fia asked for the email address: sign in once more.
  | { kind: "reauth" }
  | { kind: "active"; email: string }
  | { kind: "revoked"; email: string }
  // No answer from the server for over OFFLINE_GRACE_DAYS.
  | { kind: "offlineTooLong"; email: string };

export const OFFLINE_GRACE_DAYS = 14;
const CACHE_KEY = "access_cache";

type Cached = { email: string; status: "active" | "revoked"; checkedAt: string };

// What a check comes to, given the server's answer (or none) and the last
// one saved. Kept apart from the fetching so it can be tested.
export function decideAccess(
  answer: { email: string; status: "active" | "revoked" } | "reauth" | "unreachable",
  cached: Cached | null,
  now: Date
): Access {
  if (answer === "reauth") return { kind: "reauth" };
  if (answer !== "unreachable") return answer.status === "revoked" ? { kind: "revoked", email: answer.email } : { kind: "active", email: answer.email };
  // No answer: go by the last one while it's recent enough.
  if (!cached) return { kind: "active", email: "" };
  const ageDays = (now.getTime() - Date.parse(cached.checkedAt)) / (24 * 60 * 60 * 1000);
  if (cached.status === "revoked") return { kind: "revoked", email: cached.email };
  return ageDays <= OFFLINE_GRACE_DAYS ? { kind: "active", email: cached.email } : { kind: "offlineTooLong", email: cached.email };
}

export function isReadOnlyAccess(access: Access): boolean {
  return access.kind === "revoked" || access.kind === "offlineTooLong";
}

let readOnly = false;
const listeners = new Set<() => void>();

export function isReadOnly(): boolean {
  return readOnly;
}

export function setReadOnly(value: boolean) {
  readOnly = value;
}

// Something tried to save while read-only: the banner shows why.
export function notifyBlockedWrite() {
  listeners.forEach((l) => l());
}

export function onBlockedWrite(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function readCache(db: SQLiteDatabase): Promise<Cached | null> {
  const row = await db.getFirstAsync<{ value: string | null }>("SELECT value FROM settings WHERE key = ?", CACHE_KEY);
  try {
    return row?.value ? (JSON.parse(row.value) as Cached) : null;
  } catch {
    return null;
  }
}

// The last answer, straight away (no network), so opening Fia doesn't wait
// on the server; checkAccess then refreshes it. "loading" when there's no
// answer yet to go by.
export async function cachedAccess(db: SQLiteDatabase): Promise<Access> {
  if (!isSignedIn()) return { kind: "signedOut" };
  const cached = await readCache(db);
  return cached ? decideAccess("unreachable", cached, new Date()) : { kind: "loading" };
}

// Signing out (or in) elsewhere asks the gate to look again.
const checkRequests = new Set<() => void>();
export function requestAccessCheck() {
  checkRequests.forEach((l) => l());
}
export function onAccessCheckRequested(listener: () => void): () => void {
  checkRequests.add(listener);
  return () => checkRequests.delete(listener);
}

export async function cachedEmail(db: SQLiteDatabase): Promise<string | null> {
  return (await readCache(db))?.email || null;
}

export async function checkAccess(db: SQLiteDatabase): Promise<Access> {
  if (!isSignedIn()) return { kind: "signedOut" };
  const cached = await readCache(db);
  let answer: Parameters<typeof decideAccess>[0];
  try {
    const accessToken = await getValidAccessToken();
    const res = await fetch("/api/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken }),
    });
    if (res.status === 401) answer = "reauth";
    else if (!res.ok) answer = "unreachable";
    else {
      const data = await res.json();
      answer = { email: String(data.email ?? ""), status: data.status === "revoked" ? "revoked" : "active" };
      const fresh: Cached = { email: answer.email, status: answer.status, checkedAt: new Date().toISOString() };
      await db.runAsync("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", CACHE_KEY, JSON.stringify(fresh));
    }
  } catch (err) {
    // A sign-in Google no longer accepts (revoked in their Google account)
    // needs a new one; anything else is just no connection.
    answer = err instanceof Error && /invalid_grant/i.test(err.message) ? "reauth" : "unreachable";
  }
  return decideAccess(answer, cached, new Date());
}
