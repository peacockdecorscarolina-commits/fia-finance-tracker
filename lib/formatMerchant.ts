// Cleans up a merchant name for DISPLAY. Matching/categorization uses
// merchantMatchText below instead -- the same noise stripping, minus the
// display-only known-merchant renames. Extracted statement text is often noisy:
// a payment-processor prefix, an embedded "AGGREGATOR*ACTUAL-MERCHANT"
// marker, a trailing phone number, city/state, or store number. This trims
// that trailing noise so "AplPay PRICELN*AMERICAN AIRLI 800-774-2354 CT
// 877-477-5807" reads as "AMERICAN AIRLI" instead.
const STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY",
  "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY", "DC", "PR",
]);

function isNoiseToken(token: string): boolean {
  if (/^\d+$/.test(token)) return true; // bare reference/store number
  if (/^\d{3}[-.]?\d{3}[-.]?\d{4}$/.test(token)) return true; // phone number
  if (/^#\d+$/.test(token)) return true; // store number ("#4506")
  if (token.length === 2 && STATE_CODES.has(token.toUpperCase())) return true; // trailing state code
  if (/\.[A-Za-z]{2,4}(\/\S*)?$/.test(token)) return true; // domain-like ("SCFB.ORG")
  if (/^[\w-]+\.[a-z]{2,4}\/\S*$/i.test(token)) return true; // URL with a path ("g.co/helppay#")
  if (LEGAL_SUFFIX.test(token)) return true; // "LLC", "INC" -- part of the legal name, not the one people use
  return false;
}

const LEGAL_SUFFIX = /^(LLC|L\.L\.C\.?|INC\.?|CORP\.?|LTD\.?)$/i;

// Unlike a bare digit token or a 2-letter state code (both plausible,
// if unlikely, parts of a real merchant name -- see the "IN-N-OUT" risk
// noted below), these two forms never legitimately appear inside one, so
// they're safe to drop no matter where in the string they land.
function isUnambiguousNoiseToken(token: string): boolean {
  return (
    /^#\d+$/.test(token) ||
    /^\d{3}[-.]?\d{3}[-.]?\d{4}$/.test(token) ||
    // A phone number split by spaces: "(803)" and "555-1212".
    /^\(\d{3}\)$/.test(token) ||
    /^\d{3}-\d{4}$/.test(token)
  );
}

// A statement's leftover street address usually starts with a short
// all-digits street number ("1728 BUSH RIVER RD", "100 HALLIEBUG LN"). Once
// one shows up, everything from there to the end is address, not merchant
// name -- so unlike isNoiseToken (which only trims a trailing run), this
// truncates from wherever that street number first appears. Skipped for the
// first two tokens so an actual merchant name that starts with a number
// (rare, but real -- "76" gas stations, "7-Eleven") isn't cut down to
// nothing; those are also caught earlier by the known-merchant list anyway.
//
// A store number works the same way: "WINGSTOP 1043 HOUSTON TX", "TACO
// BELL #031234 LEXINGTON SC" -- the city after it is location, not name. A
// number of 3+ digits (or "#" plus digits) can end the name right after its
// first word; a 1-2 digit one only from the third word on, which keeps
// "Forever 21" and "Pier 1 Imports" whole.
function findStreetAddressStart(tokens: string[]): number {
  for (let i = 1; i < tokens.length; i++) {
    if (/^#\d+$/.test(tokens[i]) || /^\d{3,}$/.test(tokens[i])) return i;
    if (i >= 2 && /^#?\d{1,2}$/.test(tokens[i])) return i;
  }
  return -1;
}

// An order or reference code: letters and 3+ digits mixed, like
// "2K4AB1234" -- different on every charge, never part of a name.
function isCodeToken(token: string): boolean {
  return token.length >= 6 && /[A-Za-z]/.test(token) && (token.match(/\d/g) ?? []).length >= 3;
}

// "WINGS275" -> "WINGS", "275": statements sometimes run the street
// number into the name with no space.
function splitGluedNumber(token: string): string[] {
  const m = token.match(/^([A-Za-z&']{3,})(\d{3,})$/);
  return m ? [m[1], m[2]] : [token];
}

// Card processors put their own short code in front of the merchant:
// "SQ *" (Square), "TST*" (Toast), "SP *" (Shopify), "PY *", "DD *"
// (DoorDash), "GOOGLE *". Everything up to the first star near the start
// is that code, not the name.
function stripProcessorPrefix(raw: string): string {
  const stripped = raw.replace(/^\s*[A-Za-z]{1,8}\s*\*\s*/, "");
  return stripped.trim() ? stripped : raw;
}

// Common merchants recognized by a substring of their statement text,
// mapped to the name people actually know them by -- statements often print
// a store number, city, or legal-entity suffix along with the brand (e.g.
// "WALMART SUPERCENTER #1234 ROUND ROCK TX", "TJMAXX 0512 AUSTIN TX"), which
// the generic trailing-noise trim below can't always fully strip since that
// noise isn't always at the very end. Checked against the raw statement
// text, so it works regardless of where in the string the noise falls.
const KNOWN_MERCHANTS: { match: string; display: string }[] = [
  { match: "WALMART", display: "Walmart" },
  { match: "WAL-MART", display: "Walmart" },
  { match: "TARGET", display: "Target" },
  { match: "TJMAXX", display: "TJ Maxx" },
  { match: "TJ MAXX", display: "TJ Maxx" },
  { match: "MARSHALLS", display: "Marshalls" },
  { match: "ROSS STORES", display: "Ross" },
  { match: "COSTCO", display: "Costco" },
  { match: "SAMS CLUB", display: "Sam's Club" },
  { match: "SAM'S CLUB", display: "Sam's Club" },
  { match: "AMAZON", display: "Amazon" },
  { match: "AMZN", display: "Amazon" },
  { match: "WHOLEFDS", display: "Whole Foods" },
  { match: "WHOLE FOODS", display: "Whole Foods" },
  { match: "TRADER JOE", display: "Trader Joe's" },
  { match: "KROGER", display: "Kroger" },
  { match: "SAFEWAY", display: "Safeway" },
  { match: "PUBLIX", display: "Publix" },
  { match: "ALDI", display: "Aldi" },
  { match: "CVS", display: "CVS" },
  { match: "WALGREENS", display: "Walgreens" },
  { match: "HOME DEPOT", display: "Home Depot" },
  { match: "HOMEDEPOT", display: "Home Depot" },
  { match: "LOWES", display: "Lowe's" },
  { match: "BEST BUY", display: "Best Buy" },
  { match: "BESTBUY", display: "Best Buy" },
  { match: "STARBUCKS", display: "Starbucks" },
  { match: "MCDONALD", display: "McDonald's" },
  { match: "CHIPOTLE", display: "Chipotle" },
  { match: "CHICK-FIL-A", display: "Chick-fil-A" },
  { match: "CHICKFILA", display: "Chick-fil-A" },
  { match: "UBER EATS", display: "Uber Eats" },
  { match: "UBER TRIP", display: "Uber" },
  { match: "UBER", display: "Uber" },
  { match: "LYFT", display: "Lyft" },
  { match: "NETFLIX", display: "Netflix" },
  { match: "SPOTIFY", display: "Spotify" },
  { match: "APPLE.COM", display: "Apple" },
  { match: "APPLE COM", display: "Apple" },
  { match: "SHELL OIL", display: "Shell" },
  { match: "CHEVRON", display: "Chevron" },
  { match: "EXXON", display: "Exxon" },
  { match: "7-ELEVEN", display: "7-Eleven" },
  { match: "7 ELEVEN", display: "7-Eleven" },
  { match: "SOUTHWEST", display: "Southwest Airlines" },
  { match: "SOUTHWES", display: "Southwest Airlines" }, // card statements often truncate to 8 chars, dropping the final "T"
  { match: "AMERICAN AIRL", display: "American Airlines" }, // statements often truncate to "AIRLI" mid-column
  { match: "UNITED AIRLINES", display: "United Airlines" },
  { match: "DELTA AIR", display: "Delta Air Lines" },
  { match: "TRACTOR SUPPLY", display: "Tractor Supply" },
  { match: "H-E-B", display: "H-E-B" },
  { match: "WM SUPERCENTER", display: "Walmart" },
  { match: "REMITLY", display: "Remitly" },
  { match: "TRADINGVIEW", display: "TradingView" },
  { match: "DUNKIN", display: "Dunkin'" },
  { match: "VENTRA", display: "Ventra" },
  { match: "AVIATIONPARKINGONLINE", display: "Airport Parking" },
  { match: "AVIATION PARKING", display: "Airport Parking" },
  { match: "SC FARM BUREAU", display: "SC Farm Bureau" },
  { match: "DOMENERGYSC", display: "Dominion Energy" },
  { match: "TESLA SUPERCHARGER", display: "Tesla Supercharger" },
  { match: "BOOKING.COM", display: "Booking.com" },
  { match: "AL-FATAH", display: "Al-Fatah" },
  { match: "AL FATAH", display: "Al-Fatah" },
  { match: "LIMELIGHT", display: "Limelight" },
  { match: "LULUSAR", display: "Lulusar" },
  { match: "GRUBHUB", display: "Grubhub" },
  { match: "FOOD PANDA", display: "Foodpanda" },
  { match: "FOODPANDA", display: "Foodpanda" },
  { match: "CHEEZIOUS", display: "Cheezious" },
  { match: "TAPTAP SEND", display: "Taptap Send" },
];

// Wells Fargo debit-card statements prefix every line with a transaction
// reference code (e.g. "7446539E00XSLHRV1") that carries no merchant info --
// always a digit-first alphanumeric run with no spaces, distinct from any
// real merchant name.
const WF_REFERENCE_CODE = /^[0-9A-Z]{10,}$/;

// Wells Fargo checking statements describe Zelle/ACH/transfer activity with
// a fixed boilerplate phrase plus embedded reference codes, dates, and
// account numbers -- none of which the generic trailing-noise trim below can
// remove, since the noise isn't confined to the end of the string. Matched
// against the raw (un-normalized) text so capitalization and punctuation in
// a captured name survive untouched.
const WF_CHECKING_PATTERNS: { pattern: RegExp; display: string | ((m: RegExpMatchArray) => string) }[] = [
  // Stops the name capture at whichever comes first: " on <date>", " ref"/"ref#", or end of string -- real statement text doesn't always include the date segment.
  { pattern: /^zelle (from|to) (.+?)(?:\s+on\s+\d|\s*ref\s*#|$)/i, display: (m) => `Zelle ${/from/i.test(m[1]) ? "From" : "To"} ${m[2].trim()}` },
  { pattern: /^jpmorgan chase ext trnsfr/i, display: "Jpmorgan Chase" },
  { pattern: /^(amex epayment ach pmt|american express ach pmt)/i, display: "Amex Payment" },
  { pattern: /^capital one (mobile pmt|crcardpmt)/i, display: "Capital One Payment" },
  { pattern: /^chase credit crd (epay|autopay)/i, display: "Chase Card Payment" },
  { pattern: /^wf credit card auto pay/i, display: "WF Card Payment" },
  { pattern: /^continental casu payroll/i, display: "Continental Payroll" },
  { pattern: /^bilt card pmt/i, display: "Bilt Card Payment" },
  { pattern: /^bilt card housing/i, display: "Bilt Housing" },
  { pattern: /^instant pmt from/i, display: "Instant Payment" },
  { pattern: /^tjx rewards payment/i, display: "TJX Rewards" },
  { pattern: /^atm cash deposit/i, display: "ATM Deposit" },
  { pattern: /^atm withdrawal/i, display: "ATM Withdrawal" },
  { pattern: /^apple cash bank xfer/i, display: "Apple Cash Transfer" },
  { pattern: /^money transfer authorized.*taptap send/i, display: "Taptap Send" },
  { pattern: /^money transfer authorized.*apple cash/i, display: "Apple Cash Transfer" },
  { pattern: /^online transfer ref.*to (.+?) (card )?xxxxxxxxxxxx\d+/i, display: (m) => `Transfer to ${m[1].trim()}` },
  { pattern: /^online transfer ref/i, display: "Online Transfer" },
  { pattern: /^jpms llc receipt/i, display: "Jpms LLC" },
];

function matchWfCheckingPattern(raw: string): string | null {
  for (const { pattern, display } of WF_CHECKING_PATTERNS) {
    const m = raw.match(pattern);
    if (m) return typeof display === "function" ? display(m) : display;
  }
  return null;
}

function normalizeForMatch(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9']+/g, " ").replace(/\s+/g, " ").trim();
}

function matchKnownMerchant(raw: string): string | null {
  const normalized = normalizeForMatch(raw);
  // The lookup's own "match" strings (e.g. "WAL-MART", "7-ELEVEN") go
  // through the same normalization as the input before comparing -- a
  // literal "WAL-MART".includes("WAL-MART") check would never fire against
  // normalized input, since the hyphen was already turned into a space
  // there, so the un-normalized pattern just silently never matched.
  for (const { match, display } of KNOWN_MERCHANTS) {
    if (normalized.includes(normalizeForMatch(match))) return display;
  }
  return null;
}

// A hyphenated run of single letters ("H-E-B") is an initialism, not a
// word -- title-casing it letter-by-letter would turn it into "H-e-b".
const INITIALISM = /^[A-Za-z](-[A-Za-z])+$/;

function titleCase(s: string): string {
  return s
    .split(" ")
    .map((word) => {
      if (!word) return word;
      if (INITIALISM.test(word)) return word.toUpperCase();
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

// The noise-stripping steps shared by the display name and the merchant
// memory key: card-processor prefixes, reference codes, street addresses,
// store numbers and the city after them, phone numbers, URLs, state codes
// and legal suffixes. Returns the original text if nothing would be left.
function cleanMerchantText(raw: string): string {
  let tokens = stripProcessorPrefix(raw.trim()).split(/\s+/).flatMap(splitGluedNumber);
  if (tokens[0]?.toLowerCase() === "aplpay") tokens = tokens.slice(1);
  if (tokens[0] && WF_REFERENCE_CODE.test(tokens[0]) && /[A-Z]/.test(tokens[0]) && /\d/.test(tokens[0])) tokens = tokens.slice(1);

  // "PRICELN*AMERICAN" -> keep only what's after the last "*": the
  // aggregator/platform name before it is noise, not the actual merchant.
  // ...unless what follows the "*" is an order code ("PRIME*2K4AB1234"),
  // in which case the name is the part before it.
  tokens = tokens
    .map((t) => {
      const starIndex = t.lastIndexOf("*");
      if (starIndex < 0) return t;
      const after = t.slice(starIndex + 1);
      return after && !isCodeToken(after) ? after : t.slice(0, starIndex);
    })
    .filter((t) => t.length > 0);
  const withoutCodes = tokens.filter((t) => !isCodeToken(t));
  if (withoutCodes.length > 0) tokens = withoutCodes;

  const addressStart = findStreetAddressStart(tokens);
  if (addressStart > 0) tokens = tokens.slice(0, addressStart);

  tokens = tokens.filter((t) => !isUnambiguousNoiseToken(t));

  // A 1-2 digit number left at the end belongs to the name ("Forever 21");
  // store and reference numbers are longer.
  while (
    tokens.length > 1 &&
    !/^\d{1,2}$/.test(tokens[tokens.length - 1]) &&
    (isNoiseToken(tokens[tokens.length - 1]) || /^[^A-Za-z0-9]+$/.test(tokens[tokens.length - 1]))
  ) {
    tokens.pop();
  }

  return tokens.join(" ") || raw.trim();
}

export function formatMerchantName(raw: string): string {
  const wfChecking = matchWfCheckingPattern(raw.trim());
  if (wfChecking) return wfChecking;

  const known = matchKnownMerchant(raw);
  if (known) return known;

  return titleCase(cleanMerchantText(raw));
}

// The text merchant memory keys on (see normalizeMerchantKey in db.ts):
// the cleaned name, so "WINGSTOP 1043 HOUSTON TX" and "WINGSTOP 2210
// DALLAS TX" are one merchant -- but deliberately without the known-
// merchant collapse above, which would lump every "AMAZON ..." (Prime,
// AWS, Fresh) into one category. Bank transfer/Zelle lines pass through
// unchanged: their names and reference numbers sit mid-string, where the
// address cut would drop the person a transfer went to.
export function merchantMatchText(raw: string): string {
  if (matchWfCheckingPattern(raw.trim())) return raw;
  return cleanMerchantText(raw);
}
