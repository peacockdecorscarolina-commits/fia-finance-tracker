import type { ExtractedTransaction } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Matches lines like: "07/02/2026    TRADER JOES #421    -$54.32 CR"
const SLASH_LINE_PATTERN =
  /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.+?)\s+([+-]?)\s*\$([\d,]+\.\d{2})\s*(CR)?\s*$/i;

// A line starting with a named date, e.g. "Jun 13, 2026" or "Nov 19"
// (year optional -- some issuers omit it and rely on the statement's
// billing-cycle line instead). Captures the rest of the line after the date.
const NAMED_DATE_START = /^([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?\b[\s,]*(.*)$/;

// A trailing "± $amount [CR]" anywhere at the end of a line.
const TRAILING_AMOUNT = /([+-]?)\s*\$([\d,]+\.\d{2})\s*(CR)?\s*$/i;

// Named-date statements sometimes print "Mon D" with no year, so infer one
// from a "Mon D, YYYY" date printed elsewhere on the statement (e.g. the
// billing cycle line). Falls back to the current year if none is found.
function findStatementYear(text: string): number {
  const match = text.match(/[A-Za-z]{3,9}\s+\d{1,2},\s*(\d{4})/);
  return match ? Number(match[1]) : new Date().getFullYear();
}

function normalizeSlashDate(raw: string): string {
  const [m, d, y] = raw.split("/").map(Number);
  const year = y < 100 ? 2000 + y : y;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseAmount(
  sign: string,
  digits: string,
  hasCreditMarker: boolean,
  merchant: string,
  minusMeansCredit: boolean
): number {
  const isExplicitCredit =
    hasCreditMarker ||
    sign === "+" ||
    (sign === "-" && minusMeansCredit) ||
    /refund|credit|payment|pymt|return/i.test(merchant);
  const value = Number(digits.replace(/,/g, ""));
  // No explicit sign, and not recognized as a credit/payment/refund: most
  // statement line items are charges.
  return isExplicitCredit ? value : -value;
}

function matchTrailingAmount(
  line: string
): { leftover: string; sign: string; digits: string; hasCreditMarker: boolean } | null {
  const match = line.match(TRAILING_AMOUNT);
  if (!match || match.index === undefined) return null;
  return {
    leftover: line.slice(0, match.index).trim(),
    sign: match[1],
    digits: match[2],
    hasCreditMarker: !!match[3],
  };
}

// Marks a transaction table's header row, e.g. "Date   Description   Amount"
// or "Trans Date   Post Date   Description   Amount".
const TABLE_HEADER = /\bDate\b.*\bDescription\b.*\bAmount\b/i;
// Marks the end of a table, e.g. "Total payments and credits in this period".
const TABLE_TOTAL = /^Total\b/i;
// Safety valve: a real transaction's description never spans this many
// lines. Without this, one misread date elsewhere in the statement could
// swallow everything up to the next dollar amount, however far away.
const MAX_PENDING_LINES = 4;

// Named-date statements aren't reliably one transaction per line: some
// issuers (e.g. Bilt) wrap a merchant's address across several lines, with
// the dollar amount landing on its own line afterward. So instead of a
// single-line regex, this walks lines as a small state machine, but only
// between a table header and its closing "Total..." line -- otherwise
// incidental dates elsewhere on the statement (a due date, a footer's
// billing-cycle range) get misread as transactions.
function parseNamedDateTransactions(text: string, fallbackYear: number): ExtractedTransaction[] {
  const transactions: ExtractedTransaction[] = [];
  let pending: { date: string; parts: string[] } | null = null;
  let inTable = false;

  function finalize(date: string, parts: string[], amount: ReturnType<typeof matchTrailingAmount>) {
    if (!amount) return;
    const withLeftover = amount.leftover ? [...parts, amount.leftover] : parts;
    const merchant = withLeftover.join(" ").replace(/\s+/g, " ").trim();
    if (!merchant) return;
    transactions.push({
      date,
      merchant,
      // Named-date statements (Capital One, Bilt) print every credit/payment
      // in their tables with a leading "-", opposite of the slash-date
      // convention below -- so here a bare "-" means credit, not charge.
      amount: parseAmount(amount.sign, amount.digits, amount.hasCreditMarker, merchant, true),
      // No AI guess available in the free/on-device path — everything new
      // starts as "Other" + needsReview, resolved once via the Review
      // screen's merchant memory, then automatic for that merchant forever.
      category: "Other",
      needsReview: true,
    });
  }

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (TABLE_HEADER.test(line)) {
      inTable = true;
      pending = null;
      continue;
    }
    if (TABLE_TOTAL.test(line)) {
      inTable = false;
      pending = null;
      continue;
    }
    if (!inTable) continue;

    if (pending && pending.parts.length > MAX_PENDING_LINES) {
      pending = null;
    }

    const dateMatch = line.match(NAMED_DATE_START);
    const month = dateMatch ? MONTHS[dateMatch[1].toLowerCase()] : undefined;

    if (dateMatch && month) {
      pending = null; // an unfinished prior transaction never found its amount; drop it
      const day = Number(dateMatch[2]);
      const year = dateMatch[3] ? Number(dateMatch[3]) : fallbackYear;
      const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      let rest = dateMatch[4].trim();
      // Drop an optional second "post date" column some issuers add, e.g.
      // "Nov 19   Nov 19   CAPITAL ONE MOBILE PYMT   - $450.00".
      const postDateMatch = rest.match(NAMED_DATE_START);
      if (postDateMatch && MONTHS[postDateMatch[1].toLowerCase()]) {
        rest = postDateMatch[4].trim();
      }

      const amount = rest ? matchTrailingAmount(rest) : null;
      if (amount) {
        finalize(date, [], amount);
      } else {
        pending = { date, parts: rest ? [rest] : [] };
      }
      continue;
    }

    if (pending) {
      const amount = matchTrailingAmount(line);
      if (amount) {
        finalize(pending.date, pending.parts, amount);
        pending = null;
      } else {
        pending.parts.push(line);
      }
    }
  }

  return transactions;
}

export function parseStatement(text: string): ExtractedTransaction[] {
  const transactions: ExtractedTransaction[] = [];
  const matchedLines = new Set<string>();

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const slashMatch = line.match(SLASH_LINE_PATTERN);
    if (!slashMatch) continue;

    const [, dateRaw, merchantRaw, sign, digits, creditMarker] = slashMatch;
    const merchant = merchantRaw.replace(/\s+/g, " ").trim();
    transactions.push({
      date: normalizeSlashDate(dateRaw),
      merchant,
      amount: parseAmount(sign, digits, !!creditMarker, merchant, false),
      category: "Other",
      needsReview: true,
    });
    matchedLines.add(rawLine);
  }

  // Run the named-date parser over whatever the slash-date pass didn't
  // already claim, so the two formats can coexist in one document.
  const remainingText = text
    .split("\n")
    .map((line) => (matchedLines.has(line) ? "" : line))
    .join("\n");
  transactions.push(...parseNamedDateTransactions(remainingText, findStatementYear(text)));

  return transactions;
}
