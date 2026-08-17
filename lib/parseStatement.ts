import type { ExtractedTransaction } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Matches lines like: "07/02/2026    TRADER JOES #421    -$54.32 CR"
const SLASH_LINE_PATTERN =
  /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.+?)\s+([+-]?)\s*\$([\d,]+\.\d{2})\s*(CR)?\s*$/i;

// Matches lines like: "Nov 19   Nov 19   CAPITAL ONE MOBILE PYMT   - $450.00"
// The optional second date is a "post date" column some issuers add; it's
// discarded in favor of the first (transaction) date.
const NAMED_LINE_PATTERN =
  /^([A-Za-z]{3,9}\s+\d{1,2})(?:\s+[A-Za-z]{3,9}\s+\d{1,2})?\s+(.+?)\s+([+-]?)\s*\$([\d,]+\.\d{2})\s*(CR)?\s*$/i;

// Named-date statements print "Mon D" with no year, so infer one from a
// "Mon D, YYYY" date printed elsewhere on the statement (e.g. the billing
// cycle line). Falls back to the current year if none is found.
function findStatementYear(text: string): number {
  const match = text.match(/[A-Za-z]{3,9}\s+\d{1,2},\s*(\d{4})/);
  return match ? Number(match[1]) : new Date().getFullYear();
}

function normalizeSlashDate(raw: string): string {
  const [m, d, y] = raw.split("/").map(Number);
  const year = y < 100 ? 2000 + y : y;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function normalizeNamedDate(raw: string, fallbackYear: number): string | null {
  const match = raw.match(/([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2})/);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return null;
  const day = Number(match[2]);
  return `${fallbackYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseAmount(sign: string, digits: string, hasCreditMarker: boolean, merchant: string): number {
  const isExplicitCredit =
    hasCreditMarker || sign === "+" || /refund|credit|payment|pymt/i.test(merchant);
  const value = Number(digits.replace(/,/g, ""));
  // No explicit sign, and not recognized as a credit/payment: most
  // statement line items are charges.
  return isExplicitCredit ? value : -value;
}

export function parseStatement(text: string): ExtractedTransaction[] {
  const transactions: ExtractedTransaction[] = [];
  const statementYear = findStatementYear(text);

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const slashMatch = line.match(SLASH_LINE_PATTERN);
    if (slashMatch) {
      const [, dateRaw, merchantRaw, sign, digits, creditMarker] = slashMatch;
      const merchant = merchantRaw.replace(/\s+/g, " ").trim();
      transactions.push({
        date: normalizeSlashDate(dateRaw),
        merchant,
        amount: parseAmount(sign, digits, !!creditMarker, merchant),
        // No AI guess available in the free/on-device path — everything new
        // starts as "Other" + needsReview, resolved once via the Review
        // screen's merchant memory, then automatic for that merchant forever.
        category: "Other",
        needsReview: true,
      });
      continue;
    }

    const namedMatch = line.match(NAMED_LINE_PATTERN);
    if (namedMatch) {
      const [, dateRaw, merchantRaw, sign, digits, creditMarker] = namedMatch;
      const date = normalizeNamedDate(dateRaw, statementYear);
      if (!date) continue;
      const merchant = merchantRaw.replace(/\s+/g, " ").trim();
      transactions.push({
        date,
        merchant,
        amount: parseAmount(sign, digits, !!creditMarker, merchant),
        category: "Other",
        needsReview: true,
      });
    }
  }

  return transactions;
}
