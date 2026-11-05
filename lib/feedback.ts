import type { SQLiteDatabase } from "expo-sqlite";
import appConfig from "../app.json";
import { getSetting, setSetting } from "./db";

// Feedback goes to /api/feedback, which adds it to the owner's Google Sheet
// (see scripts/feedback-sheet.gs). Only what the person typed plus the app
// version, browser and screen are sent -- never transactions or balances,
// unless they tick the box to include a statement's text.

export type FeedbackType = "suggestion" | "problem" | "card" | "bank";

export const FEEDBACK_TYPES: { value: FeedbackType; emoji: string; label: string }[] = [
  { value: "suggestion", emoji: "💡", label: "Suggestion" },
  { value: "problem", emoji: "🐞", label: "Report a problem" },
  { value: "card", emoji: "💳", label: "Request a card" },
  { value: "bank", emoji: "🏦", label: "Statement not read" },
];

export const BANK_PROBLEMS = ["No transactions found", "Wrong dates", "Wrong amounts", "Missing transactions", "Something else"];

export type FeedbackPayload = {
  type: FeedbackType;
  message: string;
  email: string;
  // Card requests: the card's name, issuer and an optional link to it.
  // Problems: the card the report is about, if it came from one.
  cardName: string;
  issuer: string;
  link: string;
  // Statement not read: the bank and what went wrong.
  bankName: string;
  bankProblem: string;
  statementText: string;
  screen: string;
  appVersion: string;
  browser: string;
};

export type FeedbackHistoryItem = {
  id: string;
  type: FeedbackType;
  summary: string;
  sentAt: string;
  // "failed": the server turned it down (too many, too long) -- not retried.
  status: "sent" | "waiting" | "failed";
};

const HISTORY_KEY = "feedback_history";
const PENDING_KEY = "feedback_pending";
export const DAILY_LIMIT = 5;
export const MESSAGE_MAX = 2000;
// Google Sheets cells hold 50,000 characters.
export const STATEMENT_MAX = 40000;

// Card and account numbers: a run of 8+ digits, possibly split by spaces or
// dashes ("4111 1111 1111 1234"). Only the last 4 are kept. Phone numbers
// get hidden too; amounts and dates are shorter and pass through.
export function hideAccountNumbers(text: string): string {
  return text.replace(/\d(?:[ -]?\d){7,}/g, (match) => {
    const digits = match.replace(/\D/g, "");
    return `••••${digits.slice(-4)}`;
  });
}

export function feedbackSummary(p: Pick<FeedbackPayload, "type" | "message" | "cardName" | "issuer" | "bankName" | "bankProblem">): string {
  if (p.type === "card") return [p.issuer, p.cardName].filter(Boolean).join(" ");
  if (p.type === "bank") return `${p.bankName}: ${p.bankProblem}`;
  const firstLine = p.message.trim().split("\n")[0];
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;
}

// What's missing before it can be sent, or null when it's ready.
export function feedbackProblem(p: FeedbackPayload): string | null {
  if (p.type === "card" && !p.cardName.trim()) return "Add the card's name.";
  if (p.type === "bank" && !p.bankName.trim()) return "Add the bank's name.";
  if (p.type === "bank" && !p.bankProblem) return "Pick what went wrong.";
  if ((p.type === "suggestion" || p.type === "problem") && !p.message.trim()) return "Write a message first.";
  if (p.message.length > MESSAGE_MAX) return `Keep the message under ${MESSAGE_MAX} characters.`;
  if (p.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())) return "That email doesn't look right.";
  return null;
}

export function appInfo(): { appVersion: string; browser: string } {
  return {
    appVersion: appConfig.expo.version,
    browser: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : "unknown",
  };
}

// The upload screen hands the statement text over here rather than through
// route params, which would put the whole statement in the address bar.
let statementForFeedback = "";
export function setStatementForFeedback(text: string) {
  statementForFeedback = text;
}
export function getStatementForFeedback(): string {
  return statementForFeedback;
}

async function readJson<T>(db: SQLiteDatabase, key: string, fallback: T): Promise<T> {
  const raw = await getSetting(db, key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getFeedbackHistory(db: SQLiteDatabase): Promise<FeedbackHistoryItem[]> {
  return readJson(db, HISTORY_KEY, []);
}

export function sentInLastDay(history: FeedbackHistoryItem[], now = new Date()): number {
  const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
  return history.filter((h) => new Date(h.sentAt).getTime() > dayAgo).length;
}

async function post(payload: FeedbackPayload): Promise<"sent" | "offline"> {
  let res: Response;
  try {
    res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return "offline";
  }
  if (res.ok) return "sent";
  // The server or the Sheet being down is worth another try later.
  if (res.status >= 500) return "offline";
  const data = await res.json().catch(() => ({}));
  throw new Error(data.error ?? "Couldn't send it. Try again in a bit.");
}

// Saves it to send -- straight away the screen can say thanks -- and the
// caller follows with sendWaitingFeedback, which does the actual sending
// (the Sheet can take several seconds to answer). Throws past the daily limit.
export async function queueFeedback(db: SQLiteDatabase, payload: FeedbackPayload): Promise<void> {
  const history = await getFeedbackHistory(db);
  if (sentInLastDay(history) >= DAILY_LIMIT) {
    throw new Error(`That's ${DAILY_LIMIT} messages today. Thanks! Try again tomorrow.`);
  }
  const item: FeedbackHistoryItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: payload.type,
    summary: feedbackSummary(payload),
    sentAt: new Date().toISOString(),
    status: "waiting",
  };
  const pending = await readJson<{ id: string; payload: FeedbackPayload }[]>(db, PENDING_KEY, []);
  await setSetting(db, PENDING_KEY, JSON.stringify([...pending, { id: item.id, payload }]));
  await setSetting(db, HISTORY_KEY, JSON.stringify([item, ...history].slice(0, 30)));
}

let sending: Promise<void> | null = null;

// Sends everything waiting: just queued, or saved while offline. One run at
// a time, so a message isn't sent twice.
export function sendWaitingFeedback(db: SQLiteDatabase): Promise<void> {
  if (!sending) {
    sending = sendAll(db).finally(() => {
      sending = null;
    });
  }
  return sending;
}

async function sendAll(db: SQLiteDatabase): Promise<void> {
  const pending = await readJson<{ id: string; payload: FeedbackPayload }[]>(db, PENDING_KEY, []);
  if (pending.length === 0) return;
  const stillWaiting: typeof pending = [];
  const outcome = new Map<string, "sent" | "failed">();
  for (const entry of pending) {
    try {
      if ((await post(entry.payload)) === "sent") outcome.set(entry.id, "sent");
      else stillWaiting.push(entry);
    } catch {
      // Turned down by the server -- sending again won't help.
      outcome.set(entry.id, "failed");
    }
  }
  // Anything queued while these were sending stays queued.
  const latest = await readJson<{ id: string; payload: FeedbackPayload }[]>(db, PENDING_KEY, []);
  const handled = new Set(pending.map((p) => p.id));
  await setSetting(db, PENDING_KEY, JSON.stringify([...stillWaiting, ...latest.filter((p) => !handled.has(p.id))]));
  const history = await getFeedbackHistory(db);
  await setSetting(
    db,
    HISTORY_KEY,
    JSON.stringify(history.map((h) => (outcome.has(h.id) ? { ...h, status: outcome.get(h.id)! } : h)))
  );
}
