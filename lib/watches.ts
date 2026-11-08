import { formatMerchantName } from "./formatMerchant";

// The watch list: a note about a transaction the user expects ("Amazon
// refund for the shoes, about $45"). Statements come in later, so every
// upload is checked against open watches and a match gets flagged with the
// note, for the user to confirm ("That's it") or wave off ("Not this one").

export type WatchDirection = "in" | "out";

export type Watch = {
  id: number;
  // The vendor's name; empty for a watch on the amount alone.
  lookFor: string;
  note: string;
  // Roughly this much, either way (see amountMatches).
  amount: number | null;
  // "in": money coming in (a refund, a deposit). "out": a charge. null: either.
  direction: WatchDirection | null;
  // Flags every match instead of closing after the first one confirmed.
  keepWatching: boolean;
  createdAt: string;
  closedAt: string | null;
};

// Lowercase words, punctuation dropped: "AMZN Mktp US*2K4" -> ["amzn", "mktp", "us", "2k4"].
function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

// Every word typed shows up in the merchant -- as written on the statement
// or as Fia shows it ("AMZN" displays as "Amazon"), at the start of a word,
// so "uber" finds "UBER EATS" but "ber" doesn't.
export function nameMatches(lookFor: string, merchant: string): boolean {
  const wanted = words(lookFor);
  if (wanted.length === 0) return false;
  const have = [...words(merchant), ...words(formatMerchantName(merchant))];
  return wanted.every((w) => have.some((h) => h.startsWith(w)));
}

// Within 10% or $2 of what was typed, whichever is more: refunds and
// deposits rarely land to the cent of what was expected.
export function amountMatches(expected: number, actual: number): boolean {
  return Math.abs(Math.abs(actual) - Math.abs(expected)) <= Math.max(2, Math.abs(expected) * 0.1);
}

export function matchesWatch(
  watch: Pick<Watch, "lookFor" | "amount" | "direction">,
  t: { merchant: string; amount: number }
): boolean {
  if (watch.direction === "in" && t.amount <= 0) return false;
  if (watch.direction === "out" && t.amount >= 0) return false;
  if (watch.amount !== null && !amountMatches(watch.amount, t.amount)) return false;
  // No vendor: the amount alone decides (and a watch needs one or the other).
  if (!watch.lookFor.trim()) return watch.amount !== null;
  return nameMatches(watch.lookFor, t.merchant);
}

// The note a confirmed watch leaves on its transaction, added under any note
// already there.
export function noteWithWatch(existing: string | null, watchNote: string): string {
  const current = (existing ?? "").trim();
  if (!current) return watchNote;
  if (current.includes(watchNote)) return current;
  return `${current}\n${watchNote}`;
}

// What a watch is looking for, as its title: the vendor, or the amount.
export function watchTitle(w: Pick<Watch, "lookFor" | "amount">): string {
  if (w.lookFor.trim()) return w.lookFor.trim();
  return w.amount !== null ? `Any vendor, about $${w.amount.toFixed(2)}` : "";
}

// "Money in · about $45" for a watch's details line.
export function describeWatch(w: Pick<Watch, "amount" | "direction" | "keepWatching">): string {
  const parts: string[] = [];
  if (w.direction === "in") parts.push("Money in");
  if (w.direction === "out") parts.push("Charge");
  if (w.amount !== null) parts.push(`about $${w.amount.toFixed(2)}`);
  if (w.keepWatching) parts.push("every time");
  return parts.join(" · ");
}
