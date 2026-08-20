import type { ExtractedTransaction } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// A line starting with either a slash date ("07/24/26", optionally followed
// by "*" marking a posting date) or a named-month date ("Jun 13, 2026" or
// "Nov 19", year optional). Captures whichever alternative matched plus the
// rest of the line after the date.
const DATE_START =
  /^(?:(\d{1,2}\/\d{1,2}\/\d{2,4})\*?|([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?)[\s,]*(.*)$/;

// A trailing "± $amount [CR]" at the end of a line, optionally followed by a
// marker symbol some issuers print after Pay-Over-Time-eligible amounts
// (e.g. "$89.80   ⧫").
const TRAILING_AMOUNT = /([+-]?)\s*\$([\d,]+\.\d{2})\s*(CR)?\s*[⧫*]*\s*$/i;

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

// Real statement issuers (Capital One, Bilt, Amex, seen so far) all print
// credits/payments/refunds with a bare "-" sign, opposite of what you might
// assume -- so a bare "-" means credit here, not charge.
function parseAmount(sign: string, digits: string, hasCreditMarker: boolean, merchant: string): number {
  const isExplicitCredit =
    hasCreditMarker || sign === "+" || sign === "-" || /refund|credit|payment|pymt|return/i.test(merchant);
  const value = Number(digits.replace(/,/g, ""));
  // No sign at all, and not recognized as a credit/payment/refund: most
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

function extractDate(
  match: RegExpMatchArray,
  fallbackYear: number
): { date: string; rest: string } | null {
  const [, slashDate, month, day, year, rest] = match;
  if (slashDate) {
    return { date: normalizeSlashDate(slashDate), rest: rest.trim() };
  }
  if (month) {
    const monthNum = MONTHS[month.toLowerCase()];
    if (!monthNum) return null;
    const y = year ? Number(year) : fallbackYear;
    return {
      date: `${y}-${String(monthNum).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`,
      rest: rest.trim(),
    };
  }
  return null;
}

// Marks a transaction table's header row -- either the usual
// "Date   Description   Amount" (or "Trans Date   Post Date   Description
// Amount"), or a bare "Amount" / "<TableWord> Amount" line some issuers use
// instead (e.g. "Payments   Amount"). Deliberately narrow on the second
// form: a generic "ends with Amount" match also fires on value labels like
// "AutoPay Amount" (a dollar figure's label, not a table header) elsewhere
// on the statement, opening a false scope over unrelated boilerplate text.
const TABLE_HEADER =
  /\bDate\b.*\bDescription\b.*\bAmount\b|^Amount$|^(?:Payments?|Charges?|Fees?|Interest|Credits?)\s+Amount$/i;
// Marks the end of a table, e.g. "Total payments and credits in this period".
const TABLE_TOTAL = /^Total\b/i;
// Safety valve: a real transaction's description never spans this many
// lines. Without this, one misread date elsewhere in the statement could
// swallow everything up to the next dollar amount, however far away. Some
// issuers (Amex) wrap a single transaction across 7+ lines (flight
// itinerary details, ticket numbers, passenger names), so this needs
// meaningful headroom above a typical 1-2 line address block.
const MAX_PENDING_LINES = 10;

// Statements aren't reliably one transaction per line: some issuers (Bilt,
// Amex) wrap a merchant's address/details across several lines, with the
// dollar amount landing on its own line afterward. So instead of a
// single-line regex, this walks lines as a small state machine, but only
// between a table header and its closing "Total..." line -- otherwise
// incidental dates elsewhere on the statement (a due date, a footer's
// billing-cycle range) get misread as transactions.
function parseTransactions(text: string, fallbackYear: number): ExtractedTransaction[] {
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
      amount: parseAmount(amount.sign, amount.digits, amount.hasCreditMarker, merchant),
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

    const dateMatch = line.match(DATE_START);
    const dateInfo = dateMatch ? extractDate(dateMatch, fallbackYear) : null;

    if (dateInfo) {
      pending = null; // an unfinished prior transaction never found its amount; drop it
      const { date } = dateInfo;
      let rest = dateInfo.rest;

      // Drop an optional second "post date" column some issuers add, e.g.
      // "Nov 19   Nov 19   CAPITAL ONE MOBILE PYMT   - $450.00".
      const postDateMatch = rest.match(DATE_START);
      const postDateInfo = postDateMatch ? extractDate(postDateMatch, fallbackYear) : null;
      if (postDateInfo) {
        rest = postDateInfo.rest;
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
  return parseTransactions(text, findStatementYear(text));
}
