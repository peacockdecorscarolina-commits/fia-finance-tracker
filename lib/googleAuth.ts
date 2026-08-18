// Public identifier -- safe to embed client-side. The matching Client
// Secret lives only in the Vercel serverless function (api/google-token.js),
// never in this bundle.
export const GOOGLE_CLIENT_ID =
  "596041897163-iq2nvao144gtjk6tnitvobge939su08t.apps.googleusercontent.com";

// Drive's "app data" scope: a hidden folder only this app can see or write
// to, invisible in the user's regular Drive.
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";

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

// Google Identity Services (GIS): loaded once and reused. Its popup only
// ever shows Google's own consent UI and hands the result back via this JS
// callback in the current tab -- it never loads our app a second time, so
// there's no second SQLite connection racing the first one for the same
// OPFS-backed database file (which is what broke both the popup-via-our-app
// and full-page-redirect approaches tried before this).
let gisScriptPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (gisScriptPromise) return gisScriptPromise;
  gisScriptPromise = new Promise((resolve, reject) => {
    if ((window as any).google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(script);
  });
  return gisScriptPromise;
}

export async function signIn(): Promise<void> {
  await loadGisScript();

  const code = await new Promise<string>((resolve, reject) => {
    const client = (window as any).google.accounts.oauth2.initCodeClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      ux_mode: "popup",
      callback: (response: { code?: string; error?: string }) => {
        if (response.error || !response.code) {
          reject(new Error(response.error ?? "Google sign-in was cancelled"));
          return;
        }
        resolve(response.code);
      },
    });
    client.requestCode();
  });

  // "postmessage" is the literal redirect_uri Google expects for the
  // JS-SDK popup code flow (not an actual URL) -- see Google's docs for
  // google.accounts.oauth2.initCodeClient.
  const tokens = await exchangeToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: "postmessage",
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
