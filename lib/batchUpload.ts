import { csvLooksReversed, parseCsv } from "./parseCsv";
import { findStatementCardBalance, findStatementClosingDate, findStatementEndingBalance, parseStatement } from "./parseStatement";
import type { ExtractedTransaction } from "./types";

// Uploading several statements at once: each file is read the same way the
// single upload reads one, then they're all checked together and saved in
// date order (so the newest statement sets the closing day last).

export const MAX_FILES = 12;

export type ReadFile = {
  rows: ExtractedTransaction[];
  // Statement balance (owed, for a card) and its date; null when none printed.
  balance: { balance: number; date: string } | null;
  closing: string | null;
};

// What one PDF statement says, for an account of this kind.
export function readStatementText(text: string, isCard: boolean): ReadFile {
  const rows = parseStatement(text);
  let balance: ReadFile["balance"] = null;
  if (isCard) {
    const lastDate = rows.map((r) => r.date).sort().pop() ?? null;
    const card = findStatementCardBalance(text, lastDate);
    balance = card ? { balance: card.owed, date: card.date } : null;
  } else {
    balance = findStatementEndingBalance(text);
  }
  return { rows, balance, closing: findStatementClosingDate(text) };
}

// A bank's CSV export: transactions only, signs put the app's way round.
export function readCsvText(text: string): ReadFile {
  const parsed = parseCsv(text);
  const rows = csvLooksReversed(parsed) ? parsed.map((t) => ({ ...t, amount: -t.amount })) : parsed;
  return { rows, balance: null, closing: null };
}

export type Summary = { count: number; first: string | null; last: string | null; out: number; in: number };

export function summarize(rows: ExtractedTransaction[]): Summary {
  const dates = rows.map((r) => r.date).sort();
  return {
    count: rows.length,
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
    out: rows.filter((r) => r.amount < 0).reduce((sum, r) => sum - r.amount, 0),
    in: rows.filter((r) => r.amount > 0).reduce((sum, r) => sum + r.amount, 0),
  };
}

const keyOf = (t: { date: string; amount: number }) => `${t.date}|${t.amount.toFixed(2)}`;

// Possible duplicates in each file: a date and amount already saved on its
// account, or already in an earlier file going to the same account. A file
// that's nothing but duplicates looks like a statement uploaded before.
export function findDuplicates(
  files: { accountId: number | null; rows: ExtractedTransaction[] }[],
  saved: (accountId: number) => Set<string>
): { duplicates: number; allDuplicates: boolean }[] {
  const seen = new Map<number, Set<string>>();
  return files.map((f) => {
    if (f.accountId === null || f.rows.length === 0) return { duplicates: 0, allDuplicates: false };
    const earlier = seen.get(f.accountId) ?? new Set<string>();
    const already = saved(f.accountId);
    const duplicates = f.rows.filter((t) => already.has(keyOf(t)) || earlier.has(keyOf(t))).length;
    f.rows.forEach((t) => earlier.add(keyOf(t)));
    seen.set(f.accountId, earlier);
    return { duplicates, allDuplicates: duplicates === f.rows.length };
  });
}

// The account a file is probably for: one whose name appears in the file
// name ("Chase_Statement_Oct.pdf" -> Chase), the longest such name winning.
export function guessAccount(fileName: string, accounts: { id: number; name: string }[]): number | null {
  const name = fileName.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const hits = accounts.filter((a) => {
    const words = a.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return words.length >= 3 && ` ${name} `.includes(` ${words} `);
  });
  return hits.sort((a, b) => b.name.length - a.name.length)[0]?.id ?? null;
}

// Oldest statement first, by its closing date or else its last transaction.
export function saveOrder<T extends { read: ReadFile | null }>(files: T[]): T[] {
  const when = (f: T) => f.read?.closing ?? summarize(f.read?.rows ?? []).last ?? "";
  return [...files].sort((a, b) => when(a).localeCompare(when(b)));
}
