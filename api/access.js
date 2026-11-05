// Vercel serverless function. Called when Fia opens: works out who the user
// is from their Google sign-in and whether they may use Fia, by checking in
// with the owner's Google Sheet (scripts/feedback-sheet.gs, "Users" tab),
// which records first/last seen and holds the Status the owner can set to
// "revoked" (and later, Paid until).
// The email comes from Google itself (the userinfo endpoint, with the
// user's own access token), so it can't be made up by the browser.
const USERINFO_URL = process.env.GOOGLE_USERINFO_URL || "https://openidconnect.googleapis.com/v1/userinfo";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const accessToken = (req.body || {}).accessToken;
  if (typeof accessToken !== "string" || !accessToken) {
    res.status(400).json({ error: "Missing accessToken" });
    return;
  }

  let email;
  try {
    const infoRes = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    // A sign-in from before Fia asked for the email address can't answer this.
    if (infoRes.status === 401 || infoRes.status === 403) {
      res.status(401).json({ error: "reauth" });
      return;
    }
    const info = await infoRes.json();
    if (!infoRes.ok || !info.email || info.email_verified === false) throw new Error("No verified email");
    email = String(info.email).toLowerCase();
  } catch (err) {
    console.error("access: couldn't read the Google account", err);
    res.status(502).json({ error: "Couldn't reach Google" });
    return;
  }

  const scriptUrl = process.env.FEEDBACK_SCRIPT_URL;
  const secret = process.env.FEEDBACK_SECRET;
  // Before the Sheet is set up, everyone signed in may use Fia.
  if (!scriptUrl || !secret) {
    res.status(200).json({ email, status: "active", tracked: false });
    return;
  }
  try {
    const sheetRes = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, action: "checkin", email }),
    });
    const data = await sheetRes.json();
    if (!sheetRes.ok || !data.ok) throw new Error(data.error || `Sheet answered ${sheetRes.status}`);
    res.status(200).json({ email, status: data.status === "revoked" ? "revoked" : "active", tracked: true });
  } catch (err) {
    console.error("access: couldn't reach the Sheet", err);
    res.status(502).json({ error: "Couldn't check access right now" });
  }
};
