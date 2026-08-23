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

export function formatMerchantName(raw: string): string {
  let tokens = raw.trim().split(/\s+/);
  if (tokens[0]?.toLowerCase() === "aplpay") tokens = tokens.slice(1);

  // "PRICELN*AMERICAN" -> keep only what's after the last "*": the
  // aggregator/platform name before it is noise, not the actual merchant.
  tokens = tokens.map((t) => {
    const starIndex = t.lastIndexOf("*");
    return starIndex >= 0 ? t.slice(starIndex + 1) : t;
  }).filter((t) => t.length > 0);

  while (tokens.length > 1 && isNoiseToken(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  return tokens.join(" ") || raw.trim();
}
