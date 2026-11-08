import type { SQLiteDatabase } from "expo-sqlite";

// Public identifier -- safe to embed client-side. The matching Client
// Secret lives only in the Vercel serverless function (api/google-token.js),
// never in this bundle.
export const GOOGLE_CLIENT_ID =
  "596041897163-iq2nvao144gtjk6tnitvobge939su08t.apps.googleusercontent.com";

// Drive's "app data" scope: a hidden folder only this app can see or write
// to, invisible in the user's regular Drive. Plus the email address, so
// the owner knows who uses Fia (see api/access.js) -- both non-sensitive.
const SCOPE = "openid email https://www.googleapis.com/auth/drive.appdata";
// Where public/auth-callback.html sends the user after signing in.
const AFTER_SIGN_IN_KEY = "fia_after_sign_in";

const TOKENS_KEY = "fia_google_tokens";

type StoredTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
};

function loadTokens(): StoredTokens | null {
  const raw = localStorage.getItem(TOKENS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

function saveTokens(tokens: StoredTokens) {
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

export function isSignedIn(): boolean {
  return loadTokens() !== null;
}

export function signOut() {
  localStorage.removeItem(TOKENS_KEY);
}

async function exchangeToken(body: Record<string, string>): Promise<StoredTokens> {
  const res = await fetch("/api/google-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || "Google sign-in failed");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? loadTokens()?.refreshToken ?? "",
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

// Navigates the whole page to Google's consent screen. The redirect target
// is public/auth-callback.html -- a plain static page outside the app that
// completes the token exchange and only then hands off to /sync. See that
// file for why the extra hop exists (a SQLite OPFS lock race between the
// old and new page, hit by earlier approaches: a same-app popup, and a
// redirect straight back into the app).
//
// Even with that extra hop, the same lock error kept happening -- 100% of
// the time, even in a brand new private window with zero prior state. That
// pointed at something other than leftover state: modern Chrome can put a
// navigated-away-from page into the back/forward cache (bfcache) instead of
// actually unloading it, which would leave this page's SQLite worker (and
// its OPFS lock) alive and suspended for as long as the user is on Google's
// site, still holding the file open when the app tries to reopen it
// afterward. Registering an `unload` listener is the standard way to opt a
// page out of bfcache -- browsers won't cache a page that has one, forcing
// a real teardown instead of a suspend. Combined with explicitly closing
// the database first, this should leave nothing to race against.
// Proves a sign-in coming back to auth-callback.html started on this
// device: without it, a link carrying someone else's Google code could sign
// this device into their account, and its backups would go to their Drive.
const OAUTH_STATE_KEY = "fia_oauth_state";

function randomState(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signIn(db: SQLiteDatabase, returnTo = "/sync"): Promise<void> {
  localStorage.setItem(AFTER_SIGN_IN_KEY, returnTo);
  const state = randomState();
  localStorage.setItem(OAUTH_STATE_KEY, state);
  const params = new URLSearchParams({
    state,
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${window.location.origin}/auth-callback.html`,
    response_type: "code",
    scope: SCOPE,
    // Required to get a refresh_token back, not just a short-lived access
    // token; prompt=consent ensures one is (re-)issued on every sign-in,
    // since Google only issues it on a user's first-ever consent otherwise.
    access_type: "offline",
    prompt: "consent",
  });

  window.addEventListener("unload", () => {});
  await db.closeAsync();
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// Returns a valid access token, refreshing it first if it's expired.
// Throws if the user isn't signed in.
export async function getValidAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) throw new Error("Not signed in to Google");

  if (Date.now() < tokens.expiresAt - 60_000) {
    return tokens.accessToken;
  }

  const refreshed = await exchangeToken({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });
  saveTokens(refreshed);
  return refreshed.accessToken;
}
