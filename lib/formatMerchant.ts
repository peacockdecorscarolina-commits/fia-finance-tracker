// Cleans up a merchant name for DISPLAY only -- never use this for
// matching/categorization (normalizeMerchantKey in db.ts handles that with
// its own, less aggressive rules). Extracted statement text is often noisy:
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
  return false;
}

// Unlike a bare digit token or a 2-letter state code (both plausible,
// if unlikely, parts of a real merchant name -- see the "IN-N-OUT" risk
// noted below), these two forms never legitimately appear inside one, so
// they're safe to drop no matter where in the string they land.
function isUnambiguousNoiseToken(token: string): boolean {
  return /^#\d+$/.test(token) || /^\d{3}[-.]?\d{3}[-.]?\d{4}$/.test(token);
}

// A statement's leftover street address usually starts with a short
// all-digits street number ("1728 BUSH RIVER RD", "100 HALLIEBUG LN"). Once
// one shows up, everything from there to the end is address, not merchant
// name -- so unlike isNoiseToken (which only trims a trailing run), this
// truncates from wherever that street number first appears. Skipped for the
// first two tokens so an actual merchant name that starts with a number
// (rare, but real -- "76" gas stations, "7-Eleven") isn't cut down to
// nothing; those are also caught earlier by the known-merchant list anyway.
function findStreetAddressStart(tokens: string[]): number {
  for (let i = 2; i < tokens.length; i++) {
    if (/^\d{1,6}$/.test(tokens[i])) return i;
  }
  return -1;
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
  { match: "AMERICAN AIRL", display: "American Airlines" }, // statements often truncate to "AIRLI" mid-column
  { match: "UNITED AIRLINES", display: "United Airlines" },
  { match: "DELTA AIR", display: "Delta Air Lines" },
  { match: "TRACTOR SUPPLY", display: "Tractor Supply" },
  { match: "H-E-B", display: "H-E-B" },
  { match: "H E B", display: "H-E-B" },
];

function matchKnownMerchant(raw: string): string | null {
  const normalized = raw.toUpperCase().replace(/[^A-Z0-9']+/g, " ").replace(/\s+/g, " ").trim();
  for (const { match, display } of KNOWN_MERCHANTS) {
    if (normalized.includes(match)) return display;
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

export function formatMerchantName(raw: string): string {
  const known = matchKnownMerchant(raw);
  if (known) return known;

  let tokens = raw.trim().split(/\s+/);
  if (tokens[0]?.toLowerCase() === "aplpay") tokens = tokens.slice(1);

  // "PRICELN*AMERICAN" -> keep only what's after the last "*": the
  // aggregator/platform name before it is noise, not the actual merchant.
  tokens = tokens.map((t) => {
    const starIndex = t.lastIndexOf("*");
    return starIndex >= 0 ? t.slice(starIndex + 1) : t;
  }).filter((t) => t.length > 0);

  tokens = tokens.filter((t) => !isUnambiguousNoiseToken(t));

  const addressStart = findStreetAddressStart(tokens);
  if (addressStart > 0) tokens = tokens.slice(0, addressStart);

  while (tokens.length > 1 && (isNoiseToken(tokens[tokens.length - 1]) || /^[^A-Za-z0-9]+$/.test(tokens[tokens.length - 1]))) {
    tokens.pop();
  }

  const cleaned = tokens.join(" ") || raw.trim();
  return titleCase(cleaned);
}
