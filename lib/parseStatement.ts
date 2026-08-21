import type { ExtractedTransaction } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// A line starting with a date, in any of three shapes seen so far:
//  - a slash date with year ("07/24/26", optionally followed by "*" marking
//    a posting date)
//  - a slash date with NO year ("12/12" -- some issuers omit it entirely
//    and expect the statement period to disambiguate)
//  - a named-month date ("Jun 13, 2026" or "Nov 19", year optional)
// Captures whichever alternative matched plus the rest of the line after
// the date. Order matters: the with-year slash pattern must be tried before
// the no-year one, or "12/12/2025" would only ever match as "12/12" with
// "/2025" left dangling in the rest.
const DATE_START =
  /^(?:(\d{1,2}\/\d{1,2}\/\d{2,4})\*?|(\d{1,2}\/\d{1,2})(?!\/)|([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?)[\s,]*(.*)$/;

// Some issuers (Wells Fargo) print a card's last 4 digits as a bare prefix
// before the date on most transaction lines, but not all of them (their own
// "Payments" section omits it) -- so this is stripped when present rather
// than folded into DATE_START, which would make every other alternative
// there ambiguous about whether a leading number is a card suffix or part
// of the date itself.
const CARD_PREFIX = /^\d{3,4}\s+(?=\d{1,2}\/\d{1,2}\b)/;

// A trailing "± $amount [CR]" at the end of a line, optionally followed by a
// marker symbol some issuers print after Pay-Over-Time-eligible amounts
// (e.g. "$89.80   ⧫"). The "$" itself is optional -- Wells Fargo prints bare
// numbers with no currency symbol at all, relying on the column header
// ("Credits" / "Charges") instead.
const TRAILING_AMOUNT = /([+-]?)\s*\$?([\d,]+\.\d{2})\s*(CR)?\s*[⧫*]*\s*$/i;

// Named-date statements sometimes print "Mon D" with no year, so infer one
// from a "Mon D, YYYY" date printed elsewhere on the statement (e.g. the
// billing cycle line). Falls back to the current year if none is found.
function findStatementYear(text: string): number {
  const match = text.match(/[A-Za-z]{3,9}\s+\d{1,2},\s*(\d{4})/);
  return match ? Number(match[1]) : new Date().getFullYear();
}

type StatementPeriod = { startMonth: number; startYear: number; endMonth: number; endYear: number };

// For no-year slash dates: read the actual year(s) from a
// "Statement Period MM/DD/YYYY to MM/DD/YYYY" line, since a billing cycle
// spanning a year boundary (e.g. Dec 2025 to Jan 2026) means a single
// fallback year would be wrong for half the transactions.
function findStatementPeriod(text: string): StatementPeriod | null {
  const slashMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+to\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (slashMatch) {
    return {
      startMonth: Number(slashMatch[1]),
      startYear: Number(slashMatch[3]),
      endMonth: Number(slashMatch[4]),
      endYear: Number(slashMatch[6]),
    };
  }
  // Named-month period, e.g. Capital One's "Dec 10, 2025 - Jan 09, 2026"
  // (separator is a hyphen, not "to").
  const namedMatch = text.match(
    /([A-Za-z]{3,9})\s+\d{1,2},\s*(\d{4})\s*(?:-|–|—|to)\s*([A-Za-z]{3,9})\s+\d{1,2},\s*(\d{4})/i
  );
  if (namedMatch) {
    const startMonth = MONTHS[namedMatch[1].toLowerCase()];
    const endMonth = MONTHS[namedMatch[3].toLowerCase()];
    if (startMonth && endMonth) {
      return {
        startMonth,
        startYear: Number(namedMatch[2]),
        endMonth,
        endYear: Number(namedMatch[4]),
      };
    }
  }
  return null;
}

function inferYearForMonth(month: number, period: StatementPeriod | null, fallbackYear: number): number {
  if (!period) return fallbackYear;
  if (month === period.endMonth) return period.endYear;
  if (month === period.startMonth) return period.startYear;
  if (period.startYear === period.endYear) return period.startYear;
  return month >= period.startMonth ? period.startYear : period.endYear;
}

function normalizeSlashDate(raw: string): string {
  const [m, d, y] = raw.split("/").map(Number);
  const year = y < 100 ? 2000 + y : y;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Real statement issuers (Capital One, Bilt, Amex, seen so far) all print
// credits/payments/refunds with a bare "-" sign, opposite of what you might
// assume -- so a bare "-" means credit here, not charge.
//
// `sectionIsCredit` overrides everything else when known: Wells Fargo's
// format has no per-line sign or currency symbol at all -- credit/charge is
// determined purely by which section heading ("Payments" / "Other Credits"
// vs. "Purchases...") a line falls under. It's null for every other format,
// where this has no effect and the existing sign/keyword logic applies.
function parseAmount(
  sign: string,
  digits: string,
  hasCreditMarker: boolean,
  merchant: string,
  sectionIsCredit: boolean | null
): number {
  const isExplicitCredit =
    hasCreditMarker ||
    sign === "+" ||
    sign === "-" ||
    sectionIsCredit === true ||
    (sectionIsCredit === null && /refund|credit|payment|pymt|return/i.test(merchant));
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
  period: StatementPeriod | null,
  fallbackYear: number
): { date: string; rest: string } | null {
  const [, slashDateWithYear, slashDateNoYear, month, day, year, rest] = match;
  if (slashDateWithYear) {
    return { date: normalizeSlashDate(slashDateWithYear), rest: rest.trim() };
  }
  if (slashDateNoYear) {
    const [m, d] = slashDateNoYear.split("/").map(Number);
    const y = inferYearForMonth(m, period, fallbackYear);
    return { date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, rest: rest.trim() };
  }
  if (month) {
    const monthNum = MONTHS[month.toLowerCase()];
    if (!monthNum) return null;
    const y = year ? Number(year) : inferYearForMonth(monthNum, period, fallbackYear);
    return {
      date: `${y}-${String(monthNum).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`,
      rest: rest.trim(),
    };
  }
  return null;
}

// Marks a transaction table's header row -- the usual
// "Date   Description   Amount" (or "Trans Date   Post Date   Description
// Amount"), a bare "Amount" / "<TableWord> Amount" line some issuers use
// instead (e.g. "Payments   Amount"), or "Description ... Credits/Charges"
// (Wells Fargo, whose amount columns are literally labeled that instead of
// "Amount"). Deliberately narrow on the "ends with <word>" forms: a generic
// "ends with Amount" match also fires on value labels like "AutoPay Amount"
// (a dollar figure's label, not a table header) elsewhere on the statement,
// opening a false scope over unrelated boilerplate text.
const TABLE_HEADER =
  /\bDate\b.*\bDescription\b.*\bAmount\b|^Amount$|^(?:Payments?|Charges?|Fees?|Interest|Credits?)\s+Amount$|\bDescription\b.*\b(?:Credits|Charges)\b/i;
// Marks the end of a table, e.g. "Total payments and credits in this period".
const TABLE_TOTAL = /^Total\b/i;
// A sub-section heading that determines credit/charge for formats with no
// per-line sign (Wells Fargo). Order-independent from TABLE_HEADER/TOTAL --
// a statement can have several of these within one table scope.
const SECTION_CREDIT_HEADING = /^(?:Payments|Other Credits|Credits)\s*$/i;
const SECTION_CHARGE_HEADING =
  /^(?:Purchases|Cash Advances|Fees Charged|Interest Charged|New Charges)\b/i;
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
function parseTransactions(
  text: string,
  period: StatementPeriod | null,
  fallbackYear: number
): ExtractedTransaction[] {
  const transactions: ExtractedTransaction[] = [];
  let pending: { date: string; parts: string[] } | null = null;
  let inTable = false;
  let sectionIsCredit: boolean | null = null;

  function finalize(date: string, parts: string[], amount: ReturnType<typeof matchTrailingAmount>) {
    if (!amount) return;
    const withLeftover = amount.leftover ? [...parts, amount.leftover] : parts;
    const merchant = withLeftover.join(" ").replace(/\s+/g, " ").trim();
    if (!merchant) return;
    transactions.push({
      date,
      merchant,
      amount: parseAmount(amount.sign, amount.digits, amount.hasCreditMarker, merchant, sectionIsCredit),
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
      sectionIsCredit = null;
      continue;
    }
    if (TABLE_TOTAL.test(line)) {
      inTable = false;
      pending = null;
      sectionIsCredit = null;
      continue;
    }
    // Checked before the inTable gate, and re-opens it: some issuers (Wells
    // Fargo) print one shared column header covering several sub-sections
    // (Payments, Other Credits, Purchases), each ending with its own
    // "TOTAL ... FOR THIS PERIOD" line -- which closes inTable -- with no
    // fresh header line before the next sub-section starts.
    //
    // Guarded on not also being a labeled dollar amount, since a real
    // section heading is a bare label -- but the same words also show up as
    // *values* elsewhere (e.g. an account-summary box's "Fees Charged   +
    // $0.00" or "Cash Advances   + $0.00" line), which would otherwise
    // false-trigger a scope open over unrelated content.
    if (!matchTrailingAmount(line)) {
      if (SECTION_CREDIT_HEADING.test(line)) {
        inTable = true;
        sectionIsCredit = true;
        continue;
      }
      if (SECTION_CHARGE_HEADING.test(line)) {
        inTable = true;
        sectionIsCredit = false;
        continue;
      }
    }
    if (!inTable) continue;

    if (pending && pending.parts.length > MAX_PENDING_LINES) {
      pending = null;
    }

    const strippedLine = line.replace(CARD_PREFIX, "");
    const dateMatch = strippedLine.match(DATE_START);
    const dateInfo = dateMatch ? extractDate(dateMatch, period, fallbackYear) : null;

    if (dateInfo) {
      pending = null; // an unfinished prior transaction never found its amount; drop it
      const { date } = dateInfo;
      let rest = dateInfo.rest;

      // Drop an optional second "post date" column some issuers add, e.g.
      // "Nov 19   Nov 19   CAPITAL ONE MOBILE PYMT   - $450.00".
      const postDateMatch = rest.match(DATE_START);
      const postDateInfo = postDateMatch ? extractDate(postDateMatch, period, fallbackYear) : null;
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
  return parseTransactions(text, findStatementPeriod(text), findStatementYear(text));
}
