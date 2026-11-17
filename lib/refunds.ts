// Matching a card refund to the purchase it undoes, so the refund lands in
// that purchase's category (a parking refund goes to Transport, not wherever
// the last "MERCHANT RETURN" line happened to be sorted).

export const REFUND_WINDOW_DAYS = 120;

export type RefundTx = { id: number; accountId: number; date: string; merchant: string; amount: number };

const cents = (v: number) => Math.round(Math.abs(v) * 100);

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
}

// Purchases a refund could be for: same account, on or before it, within
// the window, at least as big, not already taken or ruled out. Closest first:
// exact amount and same store, then exact amount, then same store, then newest.
export function refundCandidates(
  refund: RefundTx,
  purchases: RefundTx[],
  keyFor: (merchant: string) => string,
  unavailable: (purchaseId: number) => boolean = () => false
): RefundTx[] {
  const store = keyFor(refund.merchant);
  const score = (p: RefundTx) => (cents(p.amount) === cents(refund.amount) ? 2 : 0) + (keyFor(p.merchant) === store ? 1 : 0);
  return purchases
    .filter(
      (p) =>
        p.accountId === refund.accountId &&
        p.amount < 0 &&
        p.date <= refund.date &&
        daysBetween(p.date, refund.date) <= REFUND_WINDOW_DAYS &&
        cents(p.amount) >= cents(refund.amount) &&
        !unavailable(p.id)
    )
    .sort((a, b) => score(b) - score(a) || b.date.localeCompare(a.date));
}

// The purchase a refund is confidently for, or null:
// - same store and the same amount (the newest such);
// - a refund naming no store that was bought from: the only purchase of
//   exactly that amount;
// - a partial refund: the only purchase from that store.
export function confidentMatch(refund: RefundTx, candidates: RefundTx[], keyFor: (merchant: string) => string, allPurchases: RefundTx[]): RefundTx | null {
  const store = keyFor(refund.merchant);
  const exact = candidates.filter((p) => cents(p.amount) === cents(refund.amount));
  const sameStore = candidates.filter((p) => keyFor(p.merchant) === store);
  const exactSameStore = exact.find((p) => keyFor(p.merchant) === store);
  if (exactSameStore) return exactSameStore;
  const storeKnown = allPurchases.some((p) => p.accountId === refund.accountId && keyFor(p.merchant) === store);
  if (!storeKnown && exact.length === 1) return exact[0];
  if (storeKnown && sameStore.length === 1) return sameStore[0];
  return null;
}

// Every confident match, oldest refund first; each purchase is used once.
export function matchRefunds(
  refunds: RefundTx[],
  purchases: RefundTx[],
  keyFor: (merchant: string) => string,
  taken: Set<number>,
  ruledOut: (refundId: number, purchaseId: number) => boolean
): Map<number, number> {
  const used = new Set(taken);
  const matches = new Map<number, number>();
  for (const refund of [...refunds].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)) {
    const candidates = refundCandidates(refund, purchases, keyFor, (id) => used.has(id) || ruledOut(refund.id, id));
    const match = confidentMatch(refund, candidates, keyFor, purchases);
    if (match) {
      matches.set(refund.id, match.id);
      used.add(match.id);
    }
  }
  return matches;
}
