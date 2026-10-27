// Vercel serverless function. Checks a feedback message from the app and
// passes it to the owner's Google Sheet through its Apps Script web app
// (scripts/feedback-sheet.gs), which adds a row and emails the owner.
// FEEDBACK_SCRIPT_URL and FEEDBACK_SECRET live only in Vercel's settings, so
// nobody can write to the Sheet without coming through here.
const TYPES = ["suggestion", "problem", "card", "bank"];
const LIMITS = {
  message: 2000,
  email: 200,
  cardName: 120,
  issuer: 80,
  link: 500,
  bankName: 120,
  bankProblem: 80,
  statementText: 40000,
  screen: 80,
  appVersion: 30,
  browser: 300,
};

// Best effort only: each running copy of this function keeps its own count,
// so it slows down a flood rather than stopping it exactly.
const HOURLY_LIMIT = 10;
const recent = new Map();

function tooMany(ip) {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const times = (recent.get(ip) || []).filter((t) => t > hourAgo);
  times.push(Date.now());
  recent.set(ip, times);
  return times.length > HOURLY_LIMIT;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const scriptUrl = process.env.FEEDBACK_SCRIPT_URL;
  const secret = process.env.FEEDBACK_SECRET;
  if (!scriptUrl || !secret) {
    res.status(500).json({ error: "Feedback isn't set up yet." });
    return;
  }

  const body = req.body || {};
  if (!TYPES.includes(body.type)) {
    res.status(400).json({ error: "Unknown feedback type." });
    return;
  }
  const fields = {};
  for (const [key, max] of Object.entries(LIMITS)) {
    const value = typeof body[key] === "string" ? body[key].trim() : "";
    if (value.length > max) {
      res.status(400).json({ error: `That's too long (${key}).` });
      return;
    }
    fields[key] = value;
  }
  const needs = { suggestion: "message", problem: "message", card: "cardName", bank: "bankName" }[body.type];
  if (!fields[needs]) {
    res.status(400).json({ error: "Something's missing from that message." });
    return;
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (tooMany(ip)) {
    res.status(429).json({ error: "That's a lot of messages. Try again in an hour." });
    return;
  }

  try {
    const sheetRes = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, type: body.type, ...fields }),
    });
    const data = await sheetRes.json().catch(() => ({}));
    if (!sheetRes.ok || !data.ok) throw new Error(data.error || `Sheet answered ${sheetRes.status}`);
  } catch (err) {
    console.error("feedback: couldn't reach the Sheet", err);
    res.status(502).json({ error: "Couldn't send it right now. Try again in a bit." });
    return;
  }
  res.status(200).json({ ok: true });
};
