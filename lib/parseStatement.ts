import type { ExtractedTransaction } from "./types";

// Matches lines like: "07/02/2026    TRADER JOES #421    -$54.32" or
// "...   +$39.99 CR". No AI involved — this is a plain pattern match, so it
// won't handle every bank's layout. Expect to tune this once tested against
// real statements from different issuers.
const LINE_PATTERN =
  /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.+?)\s+([+-]?\$[\d,]+\.\d{2})\s*(CR)?\s*$/i;

function normalizeDate(raw: string): string {
  const [m, d, y] = raw.split("/").map(Number);
  const year = y < 100 ? 2000 + y : y;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseAmount(raw: string, hasCreditMarker: boolean, merchant: string): number {
  const isExplicitCredit =
    hasCreditMarker || raw.startsWith("+") || /refund|credit/i.test(merchant);
  const isExplicitCharge = raw.startsWith("-");
  const value = Number(raw.replace(/[+\-$,]/g, ""));

  if (isExplicitCredit) return value;
  if (isExplicitCharge) return -value;
  // No explicit sign: most statement line items are charges.
  return -value;
}

export function parseStatement(text: string): ExtractedTransaction[] {
  const transactions: ExtractedTransaction[] = [];

  for (const line of text.split("\n")) {
    const match = line.trim().match(LINE_PATTERN);
    if (!match) continue;

    const [, dateRaw, merchantRaw, amountRaw, creditMarker] = match;
    const merchant = merchantRaw.replace(/\s+/g, " ").trim();

    transactions.push({
      date: normalizeDate(dateRaw),
      merchant,
      amount: parseAmount(amountRaw, !!creditMarker, merchant),
      // No AI guess available in the free/on-device path — everything new
      // starts as "Other" + needsReview, resolved once via the Review
      // screen's merchant memory, then automatic for that merchant forever.
      category: "Other",
      needsReview: true,
    });
  }

  return transactions;
}
