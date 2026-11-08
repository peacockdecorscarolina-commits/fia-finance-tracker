// Google Apps Script for the Fia Sheet. Two jobs:
// - Feedback: each message from the app becomes a row on the first tab, and
//   an email goes to the Sheet's owner (whoever deploys this) -- no email
//   address is written anywhere in the app.
// - Users: each person who opens Fia gets a row on the "Users" tab (email,
//   first and last seen). Type "revoked" in their Status to stop them
//   saving anything new; clear it (or type "active") to let them back in.
//   "Paid until" is for later, when Fia is paid for: a date in the past
//   counts as revoked, an empty one doesn't.
//
// One-time setup:
// 1. Make a new Google Sheet (e.g. "Fia feedback").
// 2. In it: Extensions > Apps Script. Replace everything there with this
//    file, and change SECRET below to a long random password.
// 3. Deploy > New deployment > type "Web app". Execute as: Me.
//    Who has access: Anyone. Deploy, allow the permissions it asks for,
//    and copy the web app URL.
// 4. In Vercel: Project > Settings > Environment Variables, add
//    FEEDBACK_SCRIPT_URL = that URL, and FEEDBACK_SECRET = the same
//    password as SECRET. Then redeploy.
// If you edit this script later: Deploy > Manage deployments > edit >
// Version: New version, so the same URL keeps working.

const SECRET = "change-me-to-a-long-random-password";

const COLUMNS = [
  ["Received", (d) => new Date()],
  ["Type", (d) => d.type],
  ["Message", (d) => d.message],
  ["Card", (d) => d.cardName],
  ["Issuer", (d) => d.issuer],
  ["Link", (d) => d.link],
  ["Bank", (d) => d.bankName],
  ["What went wrong", (d) => d.bankProblem],
  ["Reply to", (d) => d.email],
  ["Screen", (d) => d.screen],
  ["App version", (d) => d.appVersion],
  ["Browser", (d) => d.browser],
  ["Statement text", (d) => d.statementText],
];

const TYPE_LABEL = {
  suggestion: "Suggestion",
  problem: "Problem",
  card: "Card request",
  bank: "Statement not read",
};

// A cell starting with = + - @ would run as a formula; a leading ' keeps it text.
function asText(value) {
  const text = value == null ? "" : String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function reply(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: "Not JSON" });
  }
  if (data.secret !== SECRET) return reply({ ok: false, error: "Wrong secret" });
  if (data.action === "checkin") return checkIn(String(data.email || "").toLowerCase());

  const book = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = book.getSheets().find((s) => s.getName() !== USERS_TAB) || book.insertSheet("Feedback", 0);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS.map((c) => c[0]));
    sheet.setFrozenRows(1);
  }
  sheet.appendRow(COLUMNS.map(([name, get]) => (name === "Received" ? get(data) : asText(get(data)))));

  const label = TYPE_LABEL[data.type] || data.type;
  const about = [data.issuer, data.cardName, data.bankName, data.bankProblem].filter(String).join(" · ");
  const lines = [
    label + (about ? ": " + about : ""),
    "",
    data.message || "(no message)",
    "",
    data.email ? "Reply to: " + data.email : "No reply email given.",
    "From screen: " + (data.screen || "?") + " · Fia " + (data.appVersion || "?"),
    data.statementText ? "Statement text included -- see the Sheet." : "",
    "",
    SpreadsheetApp.getActiveSpreadsheet().getUrl(),
  ];
  const mail = {
    to: Session.getEffectiveUser().getEmail(),
    subject: "Fia feedback: " + label + (about ? " (" + about + ")" : ""),
    body: lines.join("\n"),
  };
  // Hitting Reply in the email then answers the person directly.
  if (data.email) mail.replyTo = data.email;
  MailApp.sendEmail(mail);
  return reply({ ok: true });
}

const USERS_TAB = "Users";
const USER_COLUMNS = ["Email", "Status", "First seen", "Last seen", "Opens", "Paid until", "Notes"];

// Records that this email opened Fia and says whether they may use it.
function checkIn(email) {
  if (!email) return reply({ ok: false, error: "No email" });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const book = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = book.getSheetByName(USERS_TAB) || book.insertSheet(USERS_TAB);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(USER_COLUMNS);
      sheet.setFrozenRows(1);
    }
    const now = new Date();
    const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, USER_COLUMNS.length).getValues() : [];
    const index = rows.findIndex((r) => String(r[0]).toLowerCase() === email);
    if (index === -1) {
      sheet.appendRow([asText(email), "active", now, now, 1, "", ""]);
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), "New Fia user: " + email, email + " just started using Fia.\n\n" + book.getUrl());
      return reply({ ok: true, status: "active" });
    }
    const row = rows[index];
    const rowNumber = index + 2;
    sheet.getRange(rowNumber, 4).setValue(now);
    sheet.getRange(rowNumber, 5).setValue((Number(row[4]) || 0) + 1);
    const status = String(row[1]).trim().toLowerCase();
    const paidUntil = row[5] instanceof Date ? row[5] : null;
    const expired = paidUntil !== null && paidUntil.getTime() < now.getTime() - 24 * 60 * 60 * 1000;
    return reply({ ok: true, status: status === "revoked" || expired ? "revoked" : "active" });
  } finally {
    lock.releaseLock();
  }
}
