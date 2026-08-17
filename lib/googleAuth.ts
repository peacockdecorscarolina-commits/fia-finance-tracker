import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";

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

function redirectUri(): string {
  return window.location.origin;
}

// Must be called once, early, so that when this page reloads inside the
// OAuth popup it can hand results back to the opener window and close.
export function completePendingAuthSession() {
  WebBrowser.maybeCompleteAuthSession();
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

// Opens the Google sign-in popup and completes the token exchange. Call
// from a button press (needs a user gesture to open the popup reliably).
export async function signIn(): Promise<void> {
  const request = new AuthSession.AuthRequest({
    clientId: GOOGLE_CLIENT_ID,
    scopes: SCOPES,
    redirectUri: redirectUri(),
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
  });
  await request.makeAuthUrlAsync(discovery);
  const result = await request.promptAsync(discovery);

  if (result.type !== "success") {
    if (result.type === "error") throw new Error(result.error?.message ?? "Google sign-in failed");
    return; // user cancelled
  }

  const tokens = await exchangeToken({
    grant_type: "authorization_code",
    code: result.params.code,
    code_verifier: request.codeVerifier ?? "",
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
