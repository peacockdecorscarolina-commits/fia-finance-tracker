import * as AuthSession from "expo-auth-session";

// Public identifier -- safe to embed client-side. The matching Client
// Secret lives only in the Vercel serverless function (api/google-token.js),
// never in this bundle.
export const GOOGLE_CLIENT_ID =
  "596041897163-iq2nvao144gtjk6tnitvobge939su08t.apps.googleusercontent.com";

// Drive's "app data" scope: a hidden folder only this app can see or write
// to, invisible in the user's regular Drive.
const SCOPES = ["https://www.googleapis.com/auth/drive.appdata"];

const discovery = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
};

const TOKENS_KEY = "fia_google_tokens";
const PKCE_VERIFIER_KEY = "fia_google_pkce_verifier";

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

// Sending users back to the Sync screen specifically (rather than the bare
// origin) means the redirect lands them back where they started, instead
// of on whatever the app's default tab happens to be.
function redirectUri(): string {
  return `${window.location.origin}/sync`;
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

// Navigates the whole page to Google's consent screen. Deliberately not a
// popup: a popup needs `window.opener` to hand control back to the tab that
// opened it, and this site's Cross-Origin-Opener-Policy: same-origin header
// (required for SQLite's SharedArrayBuffer usage) severs that reference,
// which left the popup with no way to signal completion.
export async function signIn(): Promise<void> {
  const request = new AuthSession.AuthRequest({
    clientId: GOOGLE_CLIENT_ID,
    scopes: SCOPES,
    redirectUri: redirectUri(),
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
  });
  const url = await request.makeAuthUrlAsync(discovery);
  if (request.codeVerifier) {
    localStorage.setItem(PKCE_VERIFIER_KEY, request.codeVerifier);
  }
  window.location.href = url;
}

// Call once at app startup (root layout). If the page just loaded from
// Google's redirect (a `code` query param is present), completes the token
// exchange and cleans the code out of the visible URL either way.
export async function completePendingSignIn(): Promise<void> {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) return;

  window.history.replaceState({}, "", url.origin + url.pathname);

  const codeVerifier = localStorage.getItem(PKCE_VERIFIER_KEY);
  localStorage.removeItem(PKCE_VERIFIER_KEY);
  if (!codeVerifier) return;

  const tokens = await exchangeToken({
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri(),
  });
  saveTokens(tokens);
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
