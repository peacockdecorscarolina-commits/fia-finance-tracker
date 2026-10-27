// Vercel serverless function. Serves a repeating "Fia monthly check-in"
// calendar event. Opening a real link to a text/calendar file is what makes
// iPhone offer "Add to Calendar" -- a file made in the browser just
// downloads. Fia has no server-side reminders, so the person's own
// calendar does the reminding.
const DAY = 2;

function pad(n) {
  return String(n).padStart(2, "0");
}

module.exports = function handler(req, res) {
  const now = new Date();
  // The next 2nd from today.
  let start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), DAY));
  if (start <= now) start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, DAY));
  const date = `${start.getUTCFullYear()}${pad(start.getUTCMonth() + 1)}${pad(start.getUTCDate())}`;
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "fia-finance-tracker.vercel.app";
  const link = `https://${host}/check-in`;

  // No time zone on DTSTART: 9 AM wherever the person's calendar is.
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fia//Monthly check-in//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:fia-monthly-check-in@${host}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${date}T090000`,
    "DURATION:PT15M",
    `RRULE:FREQ=MONTHLY;BYMONTHDAY=${DAY}`,
    "SUMMARY:Fia monthly check-in",
    `DESCRIPTION:Upload last month's statements and see your recap.\\n${link}`,
    `URL:${link}`,
    "BEGIN:VALARM",
    "TRIGGER:PT0M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Fia monthly check-in",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'inline; filename="fia-check-in.ics"');
  res.status(200).send(lines.join("\r\n") + "\r\n");
};
