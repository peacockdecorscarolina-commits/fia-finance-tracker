// Splitting one transaction across categories (a Costco trip: groceries and
// household). The parts are saved as transactions of their own, linked by a
// split group, so every total in the app counts them without knowing about
// splits; the group remembers the original amount for unsplitting and for
// spotting the charge again on a re-uploaded statement.

export type SplitPart = { categoryId: number | null; amount: string };

const cents = (value: number) => Math.round(value * 100);

// A typed amount ("150", "$1,050.25") as a positive number, or null.
export function parseAmount(text: string): number | null {
  const value = Number(text.replace(/[$,\s]/g, ""));
  return text.trim() && Number.isFinite(value) && value > 0 ? value : null;
}

// Where a split stands: what's left to give a category, and what's still
// wrong. `total` is the transaction's amount (negative for a charge); parts
// are typed as positive amounts.
export function checkSplit(total: number, parts: SplitPart[]): { remaining: number; problem: string | null } {
  const assigned = parts.reduce((sum, p) => sum + cents(parseAmount(p.amount) ?? 0), 0);
  const remaining = (Math.abs(cents(total)) - assigned) / 100;
  if (parts.length < 2) return { remaining, problem: "Add at least two parts." };
  if (parts.some((p) => p.categoryId === null)) return { remaining, problem: "Pick a category for each part." };
  if (parts.some((p) => parseAmount(p.amount) === null)) return { remaining, problem: "Give each part an amount." };
  if (remaining > 0) return { remaining, problem: `$${remaining.toFixed(2)} still needs a category.` };
  if (remaining < 0) return { remaining, problem: `That's $${(-remaining).toFixed(2)} more than the transaction.` };
  return { remaining: 0, problem: null };
}

// The parts as signed amounts, ready to save (charges stay negative).
export function signedParts(total: number, parts: SplitPart[]): { categoryId: number; amount: number }[] {
  const sign = total < 0 ? -1 : 1;
  return parts.map((p) => ({ categoryId: p.categoryId!, amount: (sign * cents(parseAmount(p.amount)!)) / 100 }));
}

// One visit per split group: the parts of one Costco trip are one charge.
export function visitKey(t: { id: number; splitGroup: string | null }): string {
  return t.splitGroup ?? `t${t.id}`;
}
