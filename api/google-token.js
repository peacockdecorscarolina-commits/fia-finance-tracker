// Vercel serverless function. The only place GOOGLE_CLIENT_SECRET is ever
// used -- it must never be shipped to the browser bundle, so the OAuth
// authorization-code exchange and refresh happen here instead of client-side.
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).json({ error: "Server is missing Google OAuth configuration" });
    return;
  }

  const { grant_type: grantType } = req.body || {};
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
  });

  if (grantType === "authorization_code") {
    const { code, code_verifier: codeVerifier, redirect_uri: redirectUri } = req.body;
    if (!code || !codeVerifier || !redirectUri) {
      res.status(400).json({ error: "Missing code, code_verifier, or redirect_uri" });
      return;
    }
    params.set("grant_type", "authorization_code");
    params.set("code", code);
    params.set("code_verifier", codeVerifier);
    params.set("redirect_uri", redirectUri);
  } else if (grantType === "refresh_token") {
    const { refresh_token: refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ error: "Missing refresh_token" });
      return;
    }
    params.set("grant_type", "refresh_token");
    params.set("refresh_token", refreshToken);
  } else {
    res.status(400).json({ error: "Invalid grant_type" });
    return;
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await tokenRes.json();

  if (!tokenRes.ok) {
    res.status(tokenRes.status).json(data);
    return;
  }
  res.status(200).json(data);
};
